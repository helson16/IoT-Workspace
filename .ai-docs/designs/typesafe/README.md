# TypeSafe 语义判断集成 — 入口与索引

> ## 开新线程时，贴这一句就够
>
> ```
> 读 .ai-docs/designs/typesafe/README.md
> ```
>
> **必须是全路径。** 只写「读 README.md」没用 —— 仓库里有多个同名文件
> （另有一个 `download/README.md`），新线程还得先搜一遍才知道是哪个，
> 而"开线程只需说一句话"的意义就在于**它不用猜**。
> 本句对 TA 和 DA 通用：下面的分流表会告诉它接下来读哪几份。

> ## 接手这个工作流：按你的角色读，别全读
>
> | 你是谁 | 读什么 | 不必读 |
> |---|---|---|
> | **Test Engineer Agent (TypeSafe)**（TA）—— 语义判定 / 用例 / 验证线程 | [`STATUS.md`](./STATUS.md)（**唯一状态来源**，覆盖式）+ [`00-agent-protocol.md`](./00-agent-protocol.md)（规则） | — |
> | **平台开发 Agent**（DA）—— 且你要**碰** `command:parse` 端点、它的前端接入、或 `app.ts` 里那条路由注册行 | [`da-contract.md`](./da-contract.md)（**薄契约**，一页） | 本工作流的进度与待办（那是 TA 的，在 STATUS 里） |
> | **DA，且不碰上述任何东西** | **一份都不用读。** 只要不主动改协议 §3 里标注「TA 主责」的文件即可 | — |
>
> **状态只有一处：`STATUS.md`。本文档不写进度。**
> 它曾经写过 —— 于是写着"单测 178 条全绿""用例表三轮"过了一整个修复轮没人发现。
> 进度类内容一旦写进索引，就会变成第二种真相。**索引只写不随进度变的东西。**
>
> 本目录的作用：仓库内**接入本工作流前没有任何 AI/LLM 集成**
> （`grep -riE "openai|anthropic|typesafe|llm|langchain"` 在 `src/` 与 `backend/src/` 全空），
> 所有"智能"都是硬编码阈值 + SQL 子串匹配。这里收录在哪些位置引入 TypeSafe（System One / Jev）语义判断。

## 候选位置（按推荐顺序）

| # | 位置 | 现状锚点 | TypeSafe 形态 | 状态 |
|---|---|---|---|---|
| 1 | 自然语言 → 设备影子指令下发 | `src/components/tencent/pages/device-detail-page.tsx:295-334` 要求手写 JSON；`backend/src/routes/shadow.routes.ts` 对 `desired` **无物模型校验** | 闭集参数填充 + selection | 方案已完成，端点已实现（进度见 STATUS） |
| 2 | 自然语言 → 转发规则配置 | `message-queue-page.tsx:150-180` 手填 `identifiers`/`eventTypes`；`rule-engine.service.ts:61-74` 精确 key 匹配；`rule-engine-page.tsx:17-23` 的 mock 规则是纯自然语言描述，从未被解析 | 闭集参数填充 | 只到设计，待排期 |
| 3 | 统一日志流语义搜索 | `backend/src/routes/ops.routes.ts:121-126` 纯 `ILIKE %kw%`；`:136` 的 `level` 写死 `'info'`，非判断得出 | semantic_find（候选检索 + 选择 + Noul） | 待排期 |

## 为什么推荐先做 #1

1. **候选集是真实闭集** — 物模型属性清单天然满足 Choice「选项须覆盖答案」的要求。
2. **对错由代码判定** — `dataType`/`spec` 校验是确定性的，模型答错会被拦下。当前连这层校验都没有。
3. **写入面窄且可逆** — 只写 `desired`，本就是"人确认后再发"的路径，且有 DELETE 可清。
4. **非一次性投入** — #2 复用完全相同的机制（物模型闭集 + 参数填充）。

## 关键约束

> 这四条不随进度变，**碰这个工作流的任何文件前都适用**；安全类后果的完整清单见协议 §6。

- **API key 只能留在 `backend/`**。Next.js 侧调用会把 key 打进浏览器包；`src/lib/api/client.ts`
  是纯 HTTP 客户端，新增一个方法即可，前端接触不到凭证。
- **模型输出永远不直接触发写操作**。一律「预填 + 人工确认」，人工点发送后才走现有链路。
- **阈值必须在本仓库真实数据上标定**，不照抄文档示例值。改动门槛见协议 §8。
- **不把上游的错误细节回显给调用方** —— 上游响应体里有我们的出口 IP。

## 文档

| 文件 | 内容 | 谁读 |
|---|---|---|
| [`STATUS.md`](./STATUS.md) | **当前状态 / 未完成 / 下一步 / 阻塞 / 质量门**（覆盖式） | 双方开工前 |
| [`00-agent-protocol.md`](./00-agent-protocol.md) | **双 Agent 协作与线程收尾规范**（文件分工、归属边界、收尾与开工清单、不变量、门槛规则） | 双方 |
| [`da-contract.md`](./da-contract.md) | **DA 薄契约**：不可改的三件事、错误契约（502/50003）、响应面、共享面待决问题 | 碰端点的 DA |
| [`01-nl-shadow-command-design.md`](./01-nl-shadow-command-design.md) | #1 完整设计方案 | 改判定时 |
| [`01-nl-shadow-command-test-cases.md`](./01-nl-shadow-command-test-cases.md) | #1 落地测试用例表（A–H 组） | 改用例时 |
| [`01-nl-shadow-command-test-results.md`](./01-nl-shadow-command-test-results.md) | **#1 实测结论与证据**：问题 F-1–F-10 的定性与修法、阈值标定依据、每轮真实 API 的分布 | 改判定 / 改阈值时 |
| [`02-nl-rule-parse-design.md`](./02-nl-rule-parse-design.md) | #2 完整设计方案（只写与 #1 的差异） | 排期 #2 时 |
| [`02-nl-rule-parse-test-cases.md`](./02-nl-rule-parse-test-cases.md) | #2 落地测试用例表（T-1–T-7 组） | 排期 #2 时 |

> 命名说明：`00-`/`01-`/`02-` 前缀里的**数字是方案序号**（`01-` = 候选位置 #1），
> 不是文档顺序。`README.md` / `STATUS.md` / `da-contract.md` **不带号** —— 它们不属于任何单一方案。

## 已确立的设计约束（结论，不随进度变）

以下都是**踩过之后定下来的**，各自改了会坏；每条的实测依据在 results 文档对应小节。

- **路径字面量必须写成正则参数 `:action(command:parse)`**：find-my-way 会把裸写的 `command:parse`
  当成「静态前缀 + 名为 `parse` 的参数」，从而吞掉 `/command`、`/commandXparse` 等兄弟路由。已实测修正。
- **两条语义护栏**（`mentions_timing` / `mentions_multiple`，results 的 F-2/F-4）：**定时/条件指令不得降级为
  立即无条件执行**；**多属性指令不得只写入其中一个属性**。两者用同一手法（speculative fan-out 同批问一个
  Noul，命中即澄清），且**必须拦在取值解析之前** —— 这是"零额外延迟"与"少打一次 API"的来源。
- **两条纯 code 的护栏**：点名只读属性时不能说"这不是下发指令"（`mentionedUnavailable`）；
  校验失败的 hint 用中文名、并在未点名属性时给出"能接受该值的其它属性"（`displayReason` / `alternativeHolders`）。
  机读字段（`rejected[].identifier`）不为文案让步。
- **顶层 `confidence` 是重载的**，所以有 `meta.judgments` 把四个原始置信度摊开 —— 读表别从 `confidence` 猜。

### 一条被撤销的建议（值得记住）

F-1 最初的建议是"按值域可行性过滤候选集"（22.5 不是 int 的合法值 → 把 int 属性剔出候选）。
**该建议已撤销**：反例是「把温度设成40度」—— 过滤会把越界的 40 从 `target_temperature`
（16–32）转嫁给 `temperature`（-40–85），把一次**越界拒绝**变成对**另一个属性**的合法写入。
它系统性地偏向值域最宽的属性，且加"点名校验"救不了未点名的反例。
详见 results 文档 F-1。（**别再提这条建议。**）

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
