# TypeSafe 语义判断集成 — 方案索引

> 现状：仓库内**没有任何 AI/LLM 集成**（`grep -riE "openai|anthropic|typesafe|llm|langchain"` 在 `src/` 与 `backend/src/` 全空）。
> 所有"智能"目前都是硬编码阈值 + SQL 子串匹配。本目录收录在这些位置引入 TypeSafe
> （System One / Jev）语义判断的方案。

## 候选位置（按推荐顺序）

| # | 位置 | 现状锚点 | TypeSafe 形态 | 状态 |
|---|---|---|---|---|
| 1 | 自然语言 → 设备影子指令下发 | `src/components/tencent/pages/device-detail-page.tsx:295-334` 要求手写 JSON；`backend/src/routes/shadow.routes.ts` 对 `desired` **无物模型校验** | 闭集参数填充 + selection | 方案已完成 |
| 2 | 自然语言 → 转发规则配置 | `message-queue-page.tsx:150-180` 手填 `identifiers`/`eventTypes`；`rule-engine.service.ts:61-74` 精确 key 匹配；`rule-engine-page.tsx:17-23` 的 mock 规则是纯自然语言描述，从未被解析 | 闭集参数填充 | 待排期 |
| 3 | 统一日志流语义搜索 | `backend/src/routes/ops.routes.ts:121-126` 纯 `ILIKE %kw%`；`:136` 的 `level` 写死 `'info'`，非判断得出 | semantic_find（候选检索 + 选择 + Noul） | 待排期 |

## 为什么推荐先做 #1

1. **候选集是真实闭集** — 物模型属性清单天然满足 Choice「选项须覆盖答案」的要求。
2. **对错由代码判定** — `dataType`/`spec` 校验是确定性的，模型答错会被拦下。当前连这层校验都没有。
3. **写入面窄且可逆** — 只写 `desired`，本就是"人确认后再发"的路径，且有 DELETE 可清。
4. **非一次性投入** — #2 复用完全相同的机制（物模型闭集 + 参数填充）。

## 关键约束

- **API key 只能留在 `backend/`**。Next.js 侧调用会把 key 打进浏览器包；`src/lib/api/client.ts`
  是纯 HTTP 客户端，新增一个方法即可，前端接触不到凭证。
- **模型输出永远不直接触发写操作**。一律「预填 + 人工确认」，人工点发送后才走现有链路。
- **阈值必须在本仓库真实数据上标定**，不照抄文档示例值。

## 文档

| 文件 | 内容 |
|---|---|
| [`01-nl-shadow-command-design.md`](./01-nl-shadow-command-design.md) | #1 完整设计方案 |
| [`01-nl-shadow-command-test-cases.md`](./01-nl-shadow-command-test-cases.md) | #1 落地测试用例表（A–H 组） |
| [`01-nl-shadow-command-test-results.md`](./01-nl-shadow-command-test-results.md) | **#1 用例表实测结果**（三轮真实 API：修复前基线 + 两次修复后重跑；模型版本、发现的问题 F-1–F-9、阈值标定依据） |
| [`02-nl-rule-parse-design.md`](./02-nl-rule-parse-design.md) | #2 完整设计方案（只写与 #1 的差异） |
| [`02-nl-rule-parse-test-cases.md`](./02-nl-rule-parse-test-cases.md) | #2 落地测试用例表（T-1–T-7 组） |

## 实现状态

- 后端端点 `POST /api/v1/devices/:deviceId/command:parse` 已实现（`backend/src/services/command-parse.service.ts`
  + `backend/src/routes/command-parse.routes.ts`），只解析不写影子，前端未接（第 1 步范围）。
- 路径字面量必须写成正则参数 `:action(command:parse)`：find-my-way 会把裸写的 `command:parse`
  当成「静态前缀 + 名为 `parse` 的参数」，从而吞掉 `/command`、`/commandXparse` 等兄弟路由。
  已实测修正。
- 实测发现的两处安全护栏（详见 results 文档 F-2/F-4）：**定时/条件指令不得降级为立即无条件执行**；
  **多属性指令不得只写入其中一个属性**。两者都用同一手法（speculative fan-out 同批问一个 Noul，
  命中即澄清，且拦在取值解析之前），零额外延迟。两条都已在真实数据上验证（F2/F3、F1）。
- 另有两条纯 code 的护栏：点名只读属性时不能说"这不是下发指令"（`mentionedUnavailable`）；
  校验失败的 hint 用中文名、并在未点名属性时给出"能接受该值的其它属性"（`displayReason`
  / `alternativeHolders`）。
- 32 条用例表已跑三轮（修复前基线 + 补完 F-2/F-3 后重跑 + 补完 F-1b/F-4/F-6 后重跑，
  见 results 文档第 1.1/1.2/1.3 节，三轮都是真实 API）。三轮都没有一条用例产出会写坏设备的
  `proposed`；每一批修复都在真实数据上验证过（唯一例外见下面的 F-3）：
  - **F-2/F-3**：F2/F3 由误产出转为澄清，且少打一次 API（证明守卫拦在取值解析之前）。
  - **F-4**：F1 由"被属性 confidence 偶然拦下"转为 `mentions_multiple` 0.98 结构化拦下，
    30 条单属性用例无一误伤（最高 0.27）—— 阈值 0.5 落在 [0.27, 0.98] 的空档里。
  - **F-1b/F-6**：A2 的 hint 指向真实存在的「当前温度」而 `rejected[].identifier` 不变；
    B3/B4 用中文名；B4 因已点名属性而不给"试试别的属性"的建议。
  - **F-3 仍有例外**：它只有单测级证据，真实设备上没被打到（用例命名对不上，见 F-7）。
- 单测 **178 条全绿**（6 个文件，`command-parse.test.ts` 79 条），`tsc --noEmit` 干净，
  **这是第三批修复（F-1b / F-4 / F-6）落码后的状态**，已复核。
- **未修复的低优先级项**：F-5（步长用例没打到步长校验，属用例设计缺口）、
  F-7（简称匹配不到只读属性名）、F-9（hint 把"相对表达"误归因为"用了中文数字"）。
  三条都不影响放行判定，理由分别见 results 文档。

### 一条被撤销的建议（值得记住）

F-1 最初的建议是"按值域可行性过滤候选集"（22.5 不是 int 的合法值 → 把 int 属性剔出候选）。
**该建议已撤销**：反例是「把温度设成40度」—— 过滤会把越界的 40 从 `target_temperature`
（16–32）转嫁给 `temperature`（-40–85），把一次**越界拒绝**变成对**另一个属性**的合法写入。
它系统性地偏向值域最宽的属性，且加"点名校验"救不了未点名的反例。
现改为只修提示文案，`proposed` 保持 `null`。详见 results 文档 F-1。

### 两个方案的判据不同

| | #1 影子指令 | #2 转发规则 |
|---|---|---|
| 最危险失败 | 值越界未被拦下 | **边界 Noul 漏报** → 产出用户以为有条件、实际没有的规则 |
| 校验层 | 需新建（当前 `desired` 无物模型校验） | 已存在（`validateInput`），但**不校验 identifier 是否存在** |
| 独有风险 | — | **URL 通过全部校验但指向错误 → 数据外泄** |
| 硬门槛 | A 组全绿 | T-2 组零漏报 |

## 外部参考

- 文档索引：https://docs.typesafe.ai/llms.txt
- 构建指南：https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
- 问题原语：https://docs.typesafe.ai/primitives.md
- JS SDK：https://docs.typesafe.ai/sdk/javascript.md

> 注：`cookbooks/function_calling.md` 与 `cookbooks/semantic_find.md` 撰写时取回被拦截，
> 相关形态描述来自上述已确认页面。动手前请先核对。
