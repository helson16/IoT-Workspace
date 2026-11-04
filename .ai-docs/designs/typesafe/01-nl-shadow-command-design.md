# 方案 #1 — 自然语言 → 设备影子指令下发

## 0. 边界（先定死）

**做什么**：用户在设备详情页用一句话描述意图，系统解析成 `desired` 键值对，**预填**进现有 JSON
输入框，由用户确认后点「发送」走现有链路。

**不做什么**：
- 不自动下发。模型输出永远不直接触发 `updateShadowDesired`。
- 不支持定时、条件、批量多设备（V1 明确拒绝并给出提示）。
- 不生成自由文本解释 —— 面向用户的文案由 code 模板拼装。

这条边界是有意设计的：解析错了 = 用户看到预填内容不对，改掉即可；而不是垃圾写进设备影子。

---

## 1. 端到端数据流

```
用户输入 "把目标温度调到20度"
        │
        ▼
[前端] POST /api/v1/devices/:deviceId/command:parse  { text }
        │
        ▼
[后端] ① device.productId → 物模型快照 → 组装可写属性候选集
        │
        ▼
[后端] ② TypeSafe 第一次请求：intent(Noul) + target_property(Choice)
        │
        ├─ intent=false 或 property=__none__ → 短路，needs_clarification
        ▼
[后端] ③ 按选中属性的 dataType 构造取值候选 → TypeSafe 第二次请求
        │
        ▼
[后端] ④ 确定性校验（物模型 spec）→ 通过则产出 proposed
        │
        ▼
[前端] 预填 JSON 输入框 → 用户确认 → 走现有 PUT /api/v1/shadows/:deviceId
```

**校验在 ④，不在模型里。** 模型只负责选，对错由 code 用物模型 spec 判定。

---

## 2. 候选集（state）组装

数据源已现成：`backend/src/services/product.service.ts:203` 的 `getThingModelSnapshot(productId)`；
前端也已有 `api.getThingModel(productId)`（`src/lib/api/client.ts:427`）。

### 可写属性筛选（候选集质量的命门）

```ts
// accessMode === 'r' 的属性绝不能进候选 —— 模型选不出没给它的选项
const writable = snapshot.properties.filter(
  p => p.accessMode === 'rw' || p.accessMode === 'w'
);
```

### spec 结构（来自 `product-define-page.tsx:99-146`）

| dataType | spec 字段 | 候选携带信息 |
|---|---|---|
| `int` / `long` / `float` / `double` | `{min?, max?, step?, unit?}` | 范围 + 单位 |
| `string` | `{maxLength?}` | 长度上限 |
| `bool` | `{"0":"关","1":"开"}` | 两个标签 |
| `enum` | `{enumList:[{value,label}]}` | 取值清单 |
| `timestamp` | `{unit:"ms"\|"s"}` | 单位 |

### state 形状

```json
{
  "request": { "text": "把目标温度调到20度", "device_name": "温控器-01" },
  "writable_properties": [
    { "identifier": "target_temperature", "name": "目标温度", "dataType": "float",
      "description": "设定目标温度", "spec": { "min": 5, "max": 40, "step": 0.5, "unit": "°C" } },
    { "identifier": "power_switch", "name": "电源开关", "dataType": "bool",
      "spec": { "0": "关", "1": "开" } }
  ],
  "current_state": { "reported": { "target_temperature": 24 }, "desired": {} }
}
```

`current_state` 非必需但便宜且有用：模型能识别「已经是 20 度」这类 no-op。

**预算**：文档说明 state + questions 共享约 32k tokens。一个产品的可写属性通常十几个，放得下。
若某产品属性特别多，按 `sortOrder` 截断 —— **但截断即丢候选**，此时必须标记"候选可能不全"，
让 code 走 `needs_clarification`，而不是让模型硬猜。

---

## 3. Questions 设计

### 为什么是两次请求（而非一次）

考虑过并**否决**的方案：一次请求里同时问「选哪个属擵」和「设成什么值」。

反例即上文 state：
- `target_temperature` 合法值是 5~40 的连续区间
- `power_switch` 合法值是 `{0, 1}`

若把取值候选并成一个 Choice 选项集 `{"20":…, "0":…, "1":…}`，**模型不知道这些选项属于哪个属性**
—— 每个属性有自己的取值域，选项集却只有一个。这会引入真实歧义，违背 Choice「选项界限清楚」的要求。

文档明确允许此处拆分：

> 只有当你的 code 确实需要先拿到第一个答案才能构造第二个问题时，才做第二次请求 ——
> 去取更多 state、决定 state 里有什么、或选择下一个问题的选项。

第二问的选项恰恰依赖第一问的答案。且第一问本身有独立价值：`intent=false` 或
`property=__none__` 时直接短路，省掉第二次调用。

**代价**：单次约 100ms（文档量级），两次约 200ms + 两趟网络。可接受，但前端必须有加载态。

### 第一次请求

```ts
const first = await client.systemOne({
  state,
  questions: {
    intent_actionable: noul(
      "`request.text` 是否在请求修改 `writable_properties` 中某个属性的期望状态？" +
      "而不是查询当前值、询问设备状态、闲聊，或提到一个不在清单里的属性。",
      {
        true:  "在请求下发/设置某个属性的值",
        false: "是查询、闲聊、涉及不可写属性，或与属性下发无关",
      }
    ),
    target_property: choice(
      "`request.text` 想修改 `writable_properties` 里的哪个属性？",
      {
        // 每个选项带上 name / dataType / 范围 —— 选项说明就是消歧依据
        target_temperature: "目标温度，float，范围 5~40 °C",
        power_switch:       "电源开关，bool，0=关 1=开",
        __none__:           "以上都不是，或无法从文本确定",
      }
    ),
  },
});
```

已确认的签名（JS SDK 文档）：
- `noul(instructions, criteria?)`，`criteria` 为 `{true, false}` 对象
- `choice(instructions, {option: description})`，选项 → 说明的映射

**`__none__` 必须有。** 模型选不出没给它的选项，逃逸口是硬要求而非可选项。

**短路规则（code）**：

```ts
if (first.answers.intent_actionable.noul <= 0.5)      → 返回「这不是一条下发指令」
if (first.answers.target_property.choice === '__none__') → needs_clarification
if (first.answers.target_property.confidence < T)     → needs_clarification
```

`T` 需在真实数据上标定，初值取 0.8 左右。

### 第二次请求（按 dataType 分支构造）

**bool — 闭集，直接问**

```ts
choice("`request.text` 要把「电源开关」设成哪个状态？", {
  "1": "开", "0": "关", __none__: "文本没有表达要开还是关",
})
```

**enum — 闭集，直接问**

```ts
choice("`request.text` 要把「工作模式」设成哪个值？", {
  cool: "制冷", heat: "制热", auto: "自动", __none__: "无法确定",
})
```

**数值 / string — 连续，先抽候选再选**

文档 `pre_parsed_value_extraction` 的形状：正则捞候选片段 → 模型选 → code 归一化。

```ts
// ① code 正则抽 span
const spans = extractValueSpans(text);  // "把目标温度调到20度" → [{raw:"20", start:7, end:9}]

// ② 模型选
choice("`request.text` 要把「目标温度」设成哪个值？", {
  "20": "文本中出现的数值 20",
  __none__: "文本没有给出明确的目标值",
})
```

**正则有零个 span，或模型选了 `__none__`** → 直接 `needs_clarification` 让用户手填。
**不要让模型自由生成数值** —— System One 的定位是 select 而非 generate，让它"生成一个 20"
超出其设计用法，也绕开了校验的必要性。

### 可选加分项（同一批请求，零额外延迟）

speculative fan-out：

```ts
mentions_timing: noul("`request.text` 是否包含定时或条件（如「5分钟后」「当温度超过30度时」）？")
```

用不上就丢弃；命中时返回「V1 暂不支持定时下发」，好过默默吞掉用户的一半意图。

---

## 4. 确定性校验层（code owns — 安全网）

拿到 `{identifier, rawValue}` 后、写任何东西之前全部校验：

```ts
function validate(prop: ThingModelProperty, raw: string): Result {
  const spec = prop.spec ?? {};
  switch (prop.dataType) {
    case 'int': case 'long': {
      const n = Number(raw);
      if (!Number.isInteger(n)) return fail('必须是整数');
      if (spec.min !== undefined && n < spec.min) return fail(`低于下限 ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) return fail(`超过上限 ${spec.max}`);
      if (spec.step !== undefined && (n - (spec.min ?? 0)) % spec.step !== 0)
        return fail(`不是步长 ${spec.step} 的整数倍`);
      return ok(n);
    }
    case 'float': case 'double': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fail('不是合法数值');
      // min/max 同 int
      return ok(n);
    }
    case 'bool': {
      if (raw === '1' || raw === spec['1']) return ok(1);
      if (raw === '0' || raw === spec['0']) return ok(0);
      return fail('不是合法的布尔取值');
    }
    case 'enum': {
      const list = (spec.enumList as {value:string}[]) ?? [];
      if (!list.some(e => e.value === raw)) return fail('不在枚举取值范围内');
      return ok(raw);
    }
    case 'string': {
      if (spec.maxLength !== undefined && raw.length > (spec.maxLength as number))
        return fail(`超过 ${spec.maxLength} 字符`);
      return ok(raw);
    }
    case 'timestamp': { /* 数值 + unit */ }
    default: return fail(`不支持的 dataType: ${prop.dataType}`);
  }
}
```

再加两条防御（不信任模型输出）：
- `identifier` 必须同时存在于**本次候选集**与**该产品可写属性全集** —— 前者防越界，后者防候选集被截断时的漏网。
- 产出对象只允许 1 个键（V1 单属性）。任何路径带出第二个键一律丢弃。

校验失败 → **不返回 `desired`**，返回 `rejected` 带原因。

---

## 5. 响应契约

```ts
interface ParseCommandResponse {
  /** 校验通过、可直接预填进 desired 的键值对；失败时为 null */
  proposed: Record<string, unknown> | null;
  /** 由 code 模板拼装，非模型生成 */
  explanation: string;
  target_property: string | null;
  confidence: number;
  /** 模型给出了值但被 spec 拦下 */
  rejected: Array<{ identifier: string; reason: string }>;
  /** 用户提到但候选集里没有的属性名（用于「你是不是想设置 XXX？」） */
  unknown: string[];
  needs_clarification: boolean;
  /** 给用户的下一步提示 */
  hint: string | null;
}
```

`explanation` / `hint` 全部由 code 模板生成（如 `` `将 ${name}(${identifier}) 设为 ${value}${unit}` ``）。
理由同 `analytics.service.ts:134-232` 的洞察生成：文案是展示层，不该自由生成，
否则校验通过的机器可读值和给人看的句子可能对不上。

---

## 6. 前端改动点

`src/components/tencent/pages/device-detail-page.tsx:295-334` 的对话框，新增一条输入路径：

1. 新增「用自然语言描述」输入框（`textarea`，句子比 JSON 长）。
2. 输入 → 防抖 → 调 parse 端点 → 把 `proposed` 用 `JSON.stringify` 预填进现有 `cmdInput`。
3. 显示 `explanation`；`rejected` / `needs_clarification` 时显示 `hint`。
4. 用户点「发送」走**现有的** `desiredMutation`（`:70-80`），带 `shadow?.version ?? 0`。

**不动版本乐观锁。** `shadow.service.ts:113-117` 的 `desiredVersion` 冲突检测保持原样 ——
自然语言路径与手填路径在这一点上必须完全一致。

解析失败 / 超时 → 降级为「解析失败，请手动填写」，输入框保持可用。**不要把失败变成阻断。**

---

## 7. 凭证与依赖

- SDK `@typesafe-ai/sdk` 装在 **`backend/`**（`backend/package.json`），Node 20+ 要求。
- `TYPESAFE_API_KEY` 放 `backend/.env`，只被 Fastify 读。**绝不能**出现在 `src/`，
  否则会进浏览器包。SDK 从环境变量取名，不要传参。
- 现有架构天然有利：`src/lib/api/client.ts` 已是纯 HTTP 客户端，加一个方法即可。

---

## 8. 落地顺序

1. **只做后端**：`POST /api/v1/devices/:deviceId/command:parse`，用 curl 打，不接前端。
2. 跑 `01-nl-shadow-command-test-cases.md` 的用例表，记录实际行为。
3. 用第 2 步结果标定 `confidence` 阈值 —— 文档明确要求在自己的数据上评估，别照抄。
4. 接前端预填 + 人工确认。
5. 观察真实使用，再考虑支持多属性。

---

## 9. 风险与未验证事项

**风险**
- **延迟**：两次请求 ≈ 200ms + 网络，必须有加载态和「仍可手填」的退路。
- **候选集质量决定成败**。`accessMode` 过滤错、候选被截断，模型再怎么选都是错的 ——
  且这种错误看起来像"模型笨"。用例表 H 组专测此项。
- 文档明确警告：结构化输出保证的是接口，不是真实准确率。

**未验证**
- `score()` 确切返回结构（`criteria` 从 0 索引、至少两项已读到；`legend` 字段仅在 primitives
  页出现，JS SDK 页未确认）。V1 用不到 Score，不影响。
- 一次 `systemOne` 调用的实际 token 计费、并发限制、模型 id 是否需显式指定。
- TypeSafe 服务在当前网络环境的可达性 —— 第 1 步先用 curl 验通再往下做。
