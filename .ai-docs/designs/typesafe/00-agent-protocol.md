# TypeSafe 工作流 — 双 Agent 协作与线程收尾规范

> 这份文件是**规则**，不写进度。三份文件分工不要混：
> - **当前状态** → [`STATUS.md`](./STATUS.md)（覆盖式，开工先读）
> - **历史** → 仓库根 [`worklog.md`](../../../worklog.md)（只追加）
> - **结论与证据** → [`01-nl-shadow-command-test-results.md`](./01-nl-shadow-command-test-results.md)（改判定时修订）

## 1. 为什么需要它

同一个仓库上有两类 Agent 在动：

- **平台开发 Agent（DA）** —— 业务功能、前端、数据库、后端主干。worklog 里 Task 2–13 是它的。
- **TypeSafe 测试/验证 Agent（TA）** —— TypeSafe 集成的配置调试、用例设计、实测、文档、问题定性。
  Task 14 是本工作流的第一条。

两边**没有共享对话上下文**：TA 的记忆只在 TA 的线程里，DA 读不到；DA 的对话 TA 也读不到。
能共享的只有仓库里的文件。所以整份规范只有一条主线：

> **凡是对另一方有影响的，必须落到文件里。没写进文件的，等于没发生。**

## 2. 三份文件的分工

| 文件 | 写法 | 作用 | 谁在什么时候读 |
|---|---|---|---|
| `STATUS.md` | **整体覆盖** | 现在在哪、下一步做什么 | 任何一方开工前，**第一件事** |
| `worklog.md` | **只追加** | 谁在什么时候做了什么 | 需要追溯时 |
| `01-...-test-results.md` | 修订，**结论必须带证据** | 判定、阈值标定依据、问题清单 | 要改判定 / 改阈值时 |

三条禁止：

- 不要把「当前进度」写进 results 文档 —— 那是会被后来的证据推翻的结论。混在一起两边都会读错。
- 不要在 STATUS 里只写"已完成"却不写**怎么验证**。没有复现命令的"已完成"等于没完成。
- 不要在 worklog 里写状态快照 —— 它是追加式日志，新线程要读十几条才知道现在在哪。

## 3. 归属边界

| 路径 | 主责 | 另一方怎么动 |
|---|---|---|
| `backend/src/services/command-parse.service.ts` | TA | 先读 STATUS 的「未完成项」，改完**同一次提交里**更新 STATUS |
| `backend/src/routes/command-parse.routes.ts` | TA | 同上 |
| `backend/tests/unit/command-parse.test.ts` | TA | DA 可以**加**用例，不得删或放宽既有断言（见 §6） |
| `backend/tools/case-table.mts` | TA | 调 `parse()` 守卫顺序时**必须同步改**，否则表里的"护栏"列会说谎（§8） |
| `.ai-docs/designs/typesafe/**` | TA | DA 可以读、可以批注；改结论前先说 |
| `backend/src/app.ts` 的注册行 | 共用 | 路径形态不可改，理由见 §6 第 5 条 |
| 其余后端 / 前端 / DB / 模拟器 | DA | TA 不碰；用例确实需要时先写进 STATUS |

## 4. 收尾（关闭线程前）清单

按顺序，缺一不可：

1. **跑质量门**，命令与结果**原文**写进 `STATUS.md`：
   `cd backend && npm run typecheck && npm test && npm run lint`
   没跑就写「未跑」。**不要把上一次的结果当这一次的**。
2. **提交**。工作区不留未提交改动；确实不能提交的，在 STATUS 里写清文件路径 + 为什么 + 怎么处置。
   **不要留在工作区里不说**。
3. **覆盖 `STATUS.md`**：现状一句话 / 已完成 / 未完成 / 下一步 / 阻塞。
   「下一步」必须具体到**命令或文件**，不能是"继续优化"。
4. **追加 `worklog.md`** 一条，`Agent:` 字段写自己的身份（见 §7）。
5. **改过判定就把 results 文档一起改**，并在 STATUS 里指明改了哪一节。
6. **凭据检查**：`git status` 里不应出现 `backend/.env`；
   `grep -rn "TYPESAFE_API_KEY" backend/src/` 只应命中读 `process.env` 的那几行，不应出现字面值。
7. **不留临时脚本**。跑用例表的脚本要么进 `backend/tools/`（可复现），要么写明已删 + 判据是什么。
   `_cases.mts` 就是删了没留复现方式，见 STATUS 的未完成项第 1 条。
   **判据**：改一次阈值，另一个人能不能不问你就重跑出同一张表。不能，就是没沉淀。

## 5. 开工（新线程）清单

1. 读 `STATUS.md`（唯一入口）。
2. 读 `worklog.md` 里**本 Agent 身份**的最后一条。
3. **先复现现状再动手**：把 STATUS 记的质量门命令自己跑一遍。
   文档写着"通过"不等于现在通过 —— 代码可能已经被另一方改过。
   实测与 STATUS 不一致时，**先把 STATUS 改对再干活**。
4. 只在 STATUS 的「下一步」上继续。要换方向，先把新计划写进 STATUS（另一方可能正依赖旧计划）。
5. 涉及语义判断的改动，先读 `01-...-design.md` 与 results 文档的对应小节，别凭直觉改问题措辞。

## 6. 不变量

改坏了会被测试拦下。**不要为了让测试变绿而改断言** —— 先判断是代码错了还是用例错了，
判断结果写进 STATUS。

| # | 不变量 | 守卫 |
|---|---|---|
| 1 | 模型输出**永不**直接写影子；端点只返回 `proposed`，人工确认后才走既有链路 | 路由不 import 影子写服务；`proposed` 只能是对象或 `null` |
| 2 | 澄清时 `proposed` 必须是 `null` —— 不允许"顺便给个建议值" | 单测断言 |
| 3 | 两条语义护栏（`mentions_timing` / `mentions_multiple`）必须**拦在取值解析之前** | "只消耗 1 次 API 调用"的用例；真实数据上 F1/F2/F3 各 1 次 |
| 4 | `rejected[].reason` 用 identifier、`hint` 用中文名 —— 机读字段不为文案让步 | `displayReason` 单测 |
| 5 | 路由必须是正则参数 `:action(command:parse)`；裸写会被 find-my-way 当成"静态前缀 + 名为 parse 的参数"，吞掉兄弟路由 | 路由注册用例 |
| 6 | `TYPESAFE_API_KEY` 只在 `backend/.env`，`src/` 里只准读 `process.env` | §4 第 6 条 |
| 7 | 不开 `TYPESAFE_LOG_LEVEL=debug` —— SDK 打印**未脱敏**请求体，物模型 + 用户原话会进日志 | 人工检查 |
| 8 | **上游/外部依赖的错误必须翻译成受控错误**：对外固定文案 + 稳定错误码，**不透传 `err.message`**（里面装着上游响应体，实测含出口 IP）；且**凡是对外发出的 5xx，服务端必须留下日志** —— `app.ts` 的 `IotError` 分支不打日志，所以日志只能在翻译处写 | 单测 T1/T2/T3（上游 reject → `UpstreamServiceError` 502/50003，`toResponse()` 不含上游内容，日志里有原始错误）；上游拒绝时**返回 502 是正确行为**，缺陷是"未捕获的 500 + 回显上游内容" |

## 7. worklog 的 `Agent:` 字段

历史 13 条全是 `Agent: Main Agent`，分不出谁做的。本工作流起改用：

- `Agent: Main Agent` —— 平台开发（DA）
- `Agent: Test Engineer Agent (TypeSafe)` —— 本工作流（TA）

`Task ID:` 保持全局递增整数。

## 8. 阈值与用例表的门槛规则

三条阈值（`CONFIDENCE_THRESHOLD` / `TIMING_THRESHOLD` / `MULTIPLE_THRESHOLD`）是在**本仓库真实数据**上
按实测分布标定的，不是抄文档示例值。因此：

- **改任何一条阈值，必须重跑 32 条用例表**，并把新分布写回 results 文档。
  单测只覆盖端点形态，覆盖不了真实分布。
- **重跑方式**（脚本在 §8 之前一度被删，导致这条规则只能靠文字复现 —— 现在落回仓库了）：

  ```bash
  cd backend
  npx tsx --env-file=.env tools/case-table.mts --dry-run     # 只列用例, 不打 API, 先确认脚本能跑
  npx tsx --env-file=.env tools/case-table.mts               # 实跑, 约 43 次付费调用
  npx tsx --env-file=.env tools/case-table.mts --only=A2,B3  # 改完一处只做定向复核
  ```

  它是**回归检查器**而不是打印器：会断言标志、**护栏归属**（用 service 同源阈值按 `parse()`
  的守卫顺序推导，不从 hint 文本反推）、以及三条不变量；有断言不过则退出码 1。
  护栏顺序改了但脚本没跟着改，表里的"护栏"列会**静静地说谎** —— 两边必须一起改。
- **加/改问题（Noul/Choice）同样要重跑**：多问一个问题会分走概率质量，
  实测已经见过 `target_property` 的 confidence 因为提问方式整簇移动。
- **不要为了"验证一下"就随手打真实 API**（要花钱，且依赖 `.env` 里的 key）。先用单测/夹具。
- **不改动开发库**：用例表跑在既有真实设备（`03d296fb…` / 产品 `prod-a1b2c3d4`）上，
  不新建产品、不新建测试设备。确有必要时先取得同意，并在 STATUS 里写下清理方式。

## 9. 双方各自要维护的一条"私有指针"

仓库文件是公共信道，但**没有人会主动去读它**。所以每个 Agent 在自己的私有记忆里放一条指针：

> "本仓库的 TypeSafe 工作流状态入口是 `.ai-docs/designs/typesafe/STATUS.md`，开工先读它。"

这是"开新线程无感恢复上下文"的真正机制：新线程启动时自动加载私有记忆 → 拿到入口路径 →
读 STATUS → 拿到现状与下一步。**规范本身不会自动生效，这条指针才会。**
