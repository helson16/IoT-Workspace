# 方案 #2 — 自然语言 → 转发规则配置

> 复用 #1 的机制（闭集参数填充 + 确定性校验层 + 预填人工确认）。
> 本文只写**与 #1 的差异**，相同部分不再重复，见
> [`01-nl-shadow-command-design.md`](./01-nl-shadow-command-design.md)。

## 0. 边界

**做什么**：在消息通信页用一句话描述转发需求，解析成转发规则表单字段，**预填**进现有新建规则
对话框，用户确认后走现有 `POST /api/v1/forward-rules`。

**不做什么**：
- 不自动创建规则。规则一旦启用就会持续转发真实设备数据，必须人工确认。
- 不支持规则引擎表达不了的条件（见第 3 节 —— 这是本方案的核心）。
- 不让模型产出 URL（见第 8 节）。

---

## 1. 与 #1 的结构性差异

| | #1 影子指令 | #2 转发规则 |
|---|---|---|
| 候选闭集 | 物模型属性（一个） | 产品 × 消息类型 × identifier/eventType（**三层联动**） |
| 写错后果 | 值越界 → 被 spec 拦下 | **URL 合法但指向错误 → 数据外泄，校验层拦不住** |
| 能力边界 | 数据模型完全表达得了 | **数据模型表达不了用户在描述里说的大部分东西** |
| 校验层缺口 | 无校验（需新建） | 已有校验（`validateInput`），但**不校验 identifier 是否存在** |

第三行是本方案的重点。

---

## 2. 数据流

```
用户输入 "把温控器产品的所有温度上报转发到 https://hooks.example.com/iot"
        │
        ▼
[后端] ① 取产品列表 + 各自物模型 → 组装候选集
        │
        ▼
[后端] ② TypeSafe 第一次请求：
        ├─ 5 个能力边界 Noul（见第 3 节）
        ├─ target_product  (Choice)
        └─ message_type    (Choice: property | event)
        │
        ├─ 任一边界 Noul 命中 → 短路，返回「规则引擎不支持 XXX」
        ▼
[后端] ③ 按 productId + messageType 取出该产品的 identifier / eventType 闭集
        │  + 正则抽取 URL span
        │  → TypeSafe 第二次请求：filter_items(Choice) + target_type(Choice) + target_span(Choice)
        ▼
[后端] ④ 确定性校验（复用并扩展 validateInput）
        ▼
[前端] 预填规则表单 → 用户确认 → 走现有 POST /api/v1/forward-rules
```

---

## 3. 能力边界映射（本方案核心）

`ForwardRule` 的 `filter` 只有 `{identifiers?, eventTypes?}` 两个字段
（`backend/prisma/schema.prisma:245`，`rule-engine.service.ts:56-75`）。
而用户在自然语言里会自然地说出下面这些东西 —— **规则引擎一个都表达不了**：

| # | NL 里会出现 | 例子 | 为何表达不了 | Noul |
|---|---|---|---|---|
| 1 | **阈值条件** | "温度超过40°C时转发" | filter 无阈值字段；`matchRules` 只看键是否存在，不看值 | `mentions_threshold` |
| 2 | **设备状态变更** | "设备离线超过10分钟时通知" | `messageType` 只有 `property`/`event`，无上下线 | `mentions_device_status` |
| 3 | **指定设备** | "只转发 device-001 的数据" | `ForwardRule` **没有 deviceId 字段**，只能按产品圈定 | `mentions_specific_device` |
| 4 | **时间/调度** | "每天8点汇总转发" | 无调度能力 | `mentions_schedule` |
| 5 | **复合条件** | "温度高且湿度低时" | filter 是单层数组，无与或 | `mentions_compound_condition` |

**这一节不是可选项。** 实测 `rule-engine-page.tsx:17-23` 的 mock 规则里，
5 条有 4 条描述的都是规则引擎做不到的事：

```
r1 "温度超过40°C时触发告警"        → 阈值条件（表达不了）
r3 "设备离线超过10分钟时通知"       → 设备状态变更（表达不了）
r5 "烟雾报警时自动通知消防系统"      → 事件可表达，但"通知消防系统"是下游的事 ✓
r2 "所有设备数据存储至对象存储"      → 可表达 ✓
```

**如果只在第二次请求里问 identifier，用户说"温度超过40°C时转发"会得到一个
`{identifiers:['temperature']}` 的规则 —— 把该产品所有温度上报都转发出去。**
用户以为设了阈值，实际没有。这是静默的语义降级，比报错危险得多。

所以 5 个 Noul 全部放在**第一次请求**、在获取 identifier 之前，命中任一即短路：

```ts
client.systemOne({
  state: { request, products /* 产品清单，不含物模型 */ },
  questions: {
    mentions_threshold: noul(
      "`request.text` 是否包含对属性取值、数值大小或比较的条件（如「超过40°C」「低于阈值」「大于」）？" +
      "注意：仅按属性名筛选（如「转发温度数据」）不算条件。",
      { true: "含数值/取值条件", false: "只按属性或事件类型筛选，或无条件" }
    ),
    mentions_device_status: noul(
      "`request.text` 是否涉及设备上下线、离线、连接状态，而不是属性上报或事件上报？",
      { true: "涉及上下线/在线状态", false: "涉及属性或事件数据" }
    ),
    mentions_specific_device: noul(
      "`request.text` 是否指向某个具体设备（如「device-001」「那台温控器」），而不是整个产品下的所有设备？",
      { true: "指向具体设备", false: "面向整个产品或未指定" }
    ),
    mentions_schedule: noul(
      "`request.text` 是否包含时间、定时或周期性（如「每天8点」「每小时」「5分钟后」）？",
      { true: "含时间/调度", false: "无时间相关表述" }
    ),
    mentions_compound_condition: noul(
      "`request.text` 是否要求同时满足多个条件（如「温度高且湿度低」「并且」「或者」）？",
      { true: "含复合条件", false: "单一条件或无附加条件" }
    ),
    // ... target_product / message_type 同批
  },
});
```

短路时返回**具体**的 hint，而不是笼统的失败：

```ts
const BOUNDARY_HINTS = {
  mentions_threshold:         '转发规则只支持按「属性/事件类型」筛选，不支持数值阈值。阈值判断请用告警规则或在下游系统实现。',
  mentions_device_status:     '转发规则只支持属性上报与事件上报，不支持设备上下线消息。',
  mentions_specific_device:   '转发规则按「产品」圈定范围，不支持指定单个设备。',
  mentions_schedule:          '转发规则是实时触发的，不支持定时或周期调度。',
  mentions_compound_condition:'转发规则只支持单个筛选维度，不支持多条件的与/或组合。',
};
```

用 Noul 而非 Choice 是有意的：这 5 类可以**同时**命中（"设备离线超过10分钟时每天汇总"），
需要各自独立的概率，而不是互斥选择。

---

## 4. 候选集与两次请求

### 第一次请求的 state

```json
{
  "request": { "text": "把温控器产品的所有温度上报转发到 https://hooks.example.com/iot" },
  "products": [
    { "productId": "prod-thermo01", "productName": "温控器", "category": "SmartHome" },
    { "productId": "prod-smoke01",  "productName": "烟雾探测器", "category": "Security" }
  ]
}
```

**只放产品清单，不放物模型。** 物模型在第二次请求才需要，提前塞进来会挤占预算。

### 为什么仍是两次请求

identifier 闭集依赖 `productId`，eventType 闭集还额外依赖 `messageType` ——
和 #1 一样，第二问的选项依赖第一问的答案，是文档点名的合法拆分场景。

**单次请求的优化空间**：若产品数量少、物模型小（把全部产品的 identifier/eventType
并集塞进一个 Choice），可以合并成一次。判据：候选条目总 token **< 8k** 时才合并。
合并后模型可能选出「A 产品的 identifier + B 产品」这种不一致组合 ——
**校验层能检出（第 5 节），但会变成 needs_clarification 而非直接成功**。
所以合并是省一次往返、换更高澄清率，需实测权衡后再定。**V1 先按两次实现。**

### 第二次请求

```ts
client.systemOne({
  state: {
    request,
    product: { productId: "prod-thermo01", productName: "温控器" },
    message_type: "property",
    // 来自物模型，已按 message_type 过滤
    candidate_items: [
      { identifier: "target_temperature", name: "目标温度" },
      { identifier: "current_temperature", name: "当前温度" },
      { identifier: "humidity", name: "湿度" }
    ],
    // 正则从原文抽出的 URL span
    url_candidates: ["https://hooks.example.com/iot"]
  },
  questions: {
    // 筛选是**多标签**：每个候选一项 Noul，而不是一个 Choice
    filter_target_temperature: noul("`request.text` 的筛选范围包含「目标温度」吗？"),
    filter_current_temperature: noul("`request.text` 的筛选范围包含「当前温度」吗？"),
    filter_humidity:            noul("`request.text` 的筛选范围包含「湿度」吗？"),
    filter_all: noul(
      "`request.text` 是否指该产品的全部属性上报，而不限于某几个属性（如「所有属性」「全部数据」「不筛选」）？",
      { true: "泛指全部，未限定属性", false: "限定在具体属性上" }
    ),

    target_type: choice(
      "`request.text` 要求转发到哪里？",
      { http: "HTTP Webhook（文本中给出了 URL）", republish: "消息重新发布到 MQTT topic", __none__: "文本未指明" }
    ),
    target_span: choice(
      "`request.text` 中的转发地址是 `url_candidates` 里的哪个？",
      { "https://hooks.example.com/iot": "文本中出现的 URL", __none__: "文本中没有可用的 URL" }
    ),
  },
});
```

**为什么筛选用「每候选一项 Noul」而不是一个 Choice**：`filter.identifiers` 是**数组**，
`matchRules` 用 `identifiers.some(...)` 匹配（`rule-engine.service.ts:67`），即**或**语义。
"转发温度和湿度" 要产出 `['target_temperature','humidity']` —— Choice 只能选一个，表达不了。
文档对「多个标签可能同时成立」的场景明确建议：*用 Noul，每个标签一个*。

**`filter_all` 与「具体项」的优先级由 code 定死**（不让模型决定）：

```ts
const specifics = candidates.filter(c => answers[`filter_${c.identifier}`].noul > T);
if (specifics.length > 0)             → filter = { identifiers: specifics.map(c => c.identifier) };
else if (answers.filter_all.noul > T) → filter = {};   // 空 = 全部匹配
else                                  → needs_clarification;
```

具体项优先：它是用户显式点名的、更窄的范围；说了「全部」的人不会再去点名一个属性。

> ⚠️ `filter = {}` 的语义：`rule-engine.service.ts:65` 的
> `if (identifiers.length === 0) return true` —— 空数组 = **全部转发**，不是"不转发"。
> 这是最容易写反的一处，测试用例 T-4 组专测。

**候选数多时的成本**：Noul 便宜且并行，但 50 个属性就是 50 个问题。若某产品物模型属性数
超过阈值（建议 20），退化为「两次请求选一次 Choice」或直接走 `filter_all` 语义，不要无脑铺开。

---

## 5. 确定性校验层

### 复用已有的

`forward-rule.service.ts:314-350` 的 `validateInput` 已经做了：名称长度、`messageType` 枚举、
`targetType` 枚举、产品存在性、URL 必须 `^https?://`、topic 非空 ≤255、filter 必须是数组。
**解析端点产出的对象直接走这个方法**，不重复实现。

### 补一个真实缺口

**`validateInput` 不校验 identifier 是否存在于物模型。** 它只检查
`filter.identifiers` 是字符串数组（`:344-346`），不检查数组里的值。

后果：手填路径下用户打错一个 identifier（`temp_val` 写成 `temp_value`），规则能建成功、
能启用，但 `matchRules` 永远匹配不上 —— **一条永不触发的规则，没有任何提示**。

这是手填路径既有问题，NL 路径会**放大**它（模型幻觉出的 identifier 听起来很合理）。
所以解析端点必须补：

```ts
// 新增：校验 filter 项确实存在于该产品物模型
const snapshot = await productService.getThingModelSnapshot(productId);
const validSet = messageType === 'property'
  ? new Set(snapshot.properties.map(p => p.identifier))
  : new Set(snapshot.events.map(e => e.identifier));

for (const item of filterItems) {
  if (!validSet.has(item)) → rejected.push({ item, reason: `产品「${productName}」的物模型中不存在该${label}` });
}
```

> **建议同时把这个校验加进 `validateInput`**（属于第 7 节的后续项，不是本方案强制范围）——
> 它对手填路径同样是净收益，且能拦住 D 组之外的更多错误。

### 其余校验

- `productId` 必须同时存在于候选集与数据库。
- 每个通过阈值 `T` 的 `filter_*` Noul，其 identifier 都必须存在于物模型（上一段已覆盖）。
- `specifics` 与 `filter_all` 的优先级按第 4 节的规则定死；两者都没过阈值 → 澄清，
  **绝不默认成 `{}`**（`{}` 是"全部转发"，默认成它等于静默放大范围）。
- `target_type === 'http'` 时 URL **必须来自 `url_candidates`**（第 8 节）。

---

## 6. 响应契约

```ts
interface ParseRuleResponse {
  /** 可直接预填进规则表单的字段；被拦下时为 null */
  proposed: {
    product_id: string;
    message_type: 'property' | 'event';
    filter: Record<string, unknown>;   // {} 表示全部
    target_type: 'http' | 'republish';
    target_config: Record<string, unknown>;
  } | null;
  /** code 模板生成 */
  explanation: string;
  /** 命中的能力边界，键同 BOUNDARY_HINTS */
  boundaries: string[];
  unknown: string[];
  needs_clarification: boolean;
  hint: string | null;
}
```

`explanation` 由 code 拼装，例如：
`将「温控器」产品的全部属性上报转发至 https://hooks.example.com/iot`。

---

## 7. 前端

`src/components/tencent/pages/message-queue-page.tsx` 的新建/编辑对话框：

1. 顶部加一个「用自然语言描述转发需求」`textarea`。
2. 调解析端点，把 `proposed` 映射进现有 `form` 状态（`:90-100` 的 `emptyForm` 结构）。
3. `boundaries` 命中时，用 `hint` 明确告知**规则引擎不支持**，并说明替代方案
   （例如阈值 → 用告警规则）。让用户知道不是"没听懂"，而是"这个平台做不到"。
4. 用户确认后走现有 `saveMutation`（`:186-200`），**名称仍需手填**
   —— `name` 有 unique 约束（`assertNameAvailable`），让模型起名会撞名且难解释。
   可从文本截取一个默认名，但必须让用户可改。

**同样不动** `assertNameAvailable`（`:309-312`）和版本相关的既有逻辑。

---

## 8. 风险：URL 是 #2 独有的数据外泄面

#1 里模型答错会被 spec 校验拦下。#2 里**答错一个 URL 会通过所有校验** ——
它是合法 URL、非空、长度合规，然后规则启用后持续把真实设备数据 POST 到那个地址。

这是 #2 与 #1 最本质的风险差异，必须单独处理：

1. **不让模型产出 URL。** 只用正则从用户原文抽 span（`pre_upload_value_extraction` 的模式），
   模型的作用退化为「在已抽出的候选里选」。这样 URL 一定是用户自己打出来的字符串。
2. **`target_config.url` 必须 ∈ `url_candidates`。** 校验层强制，杜绝任何生成路径。
3. **确认界面把完整 URL 显著展示**，不要截断 —— 这是用户唯一能发现「是不是打错了域名」的机会。
4. **建议增加域名允许列表**（平台级配置）。这是 policy，属于 code 不属于模型，
   和文档"保持策略显式"的立场一致。V1 可先不做，但应在方案里留位。

`republish` 的 topic 同理适用，但危害小得多（转发到自己 MQTT 集群内）。

---

## 9. 落地顺序

1. 只做后端 `POST /api/v1/forward-rules:parse`，curl 打。
2. 跑 [`02-nl-rule-parse-test-cases.md`](./02-nl-rule-parse-test-cases.md)。
3. **重点看第 3 节 5 个边界 Noul 的召回率** —— 漏报（该拦没拦）比误报危险得多。
   漏报一个 `mentions_threshold` 就产出一条用户以为有阈值、实际没有的规则。
4. 接前端预填 + 人工确认。
5. 之后再考虑给 `validateInput` 补 identifier 存在性校验（第 5 节）。

---

## 10. 未验证

- 产品数量与物模型规模未知，无法判断第 4 节「单次请求」优化是否可行 —— 需先量。
- 5 个边界 Noul 的实际召回率未测，这是本方案成败的关键指标。
- 域名的正则抽取对中文标点/全角字符的鲁棒性未测（见测试用例 T-3 组）。
