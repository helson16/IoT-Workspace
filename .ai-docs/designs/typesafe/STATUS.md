# TypeSafe 工作流 — 当前状态

> **覆盖式文件：收尾时整体重写，不要追加。** 规则见 [`00-agent-protocol.md`](./00-agent-protocol.md)。
>
> 最后更新：**2026-10-13** ｜ 更新人：**Test Engineer Agent (TypeSafe)**

## 一句话现状

**G5 期望值已按方案①落地**：用例表把「上游拒绝」（502 + `code 50003` 且不泄露）识别为
**环境性跳过 ⏭**，不计入断言、不影响退出码；该分支反而多断言三条 F-10 契约。
G5 那条固定 ❌ 噪声清除，退出码信号恢复有效。
本轮实测：`--dry-run` 退出码 0（32 条用例）；质量门 `tsc` 0 error ｜ **273 passed (11 files)**
（`command-parse.test.ts` 84 条不变）｜ `lint` 0 error / **123 warning**。
测试数从 183/6 files 涨到 273/11 files 是 **DA 在 Task 17–20 加的**（security/api-catalog/av/
internal-callback-guard/device-detail 五个新测试文件），非本工作流改动。

前史：F-10 已修（`d3d8b7d`），端点遇上游故障受控返回 **502 + `code 50003`**，不再回显上游响应体。

**未接前端**；方案 #2 只到设计，未开工。

**前一轮同时做了线程交接规范化**（用户要求"收尾后即可关闭线程 / 开新线程只需告诉它读一个文件"）：
入口从"直接指 STATUS"改成 `.ai-docs/designs/typesafe/README.md` **按角色分流**，DA 的对外契约独立成
[`da-contract.md`](./da-contract.md)。**开新线程只需要贴这一句**（全路径，裸写 `README.md` 无效 —— 仓库里有同名文件）：

```
读 .ai-docs/designs/typesafe/README.md
```

**下一个 TA 线程**：读上面的入口 → 读本文档 → 复现质量门。

## 目标

给物联网平台引入 TypeSafe（System One / Jev）语义判断。落点按推荐顺序：

1. **自然语言 → 设备影子指令下发**（方案 #1）—— 本工作流当前主战场
2. 自然语言 → 转发规则配置（方案 #2）—— 待排期
3. 统一日志流语义搜索 —— 待排期

**当前阶段**：方案 #1 落地顺序的第 1 步 —— 只做后端端点，**不接前端、不改 shadow 路由**。

## 已完成

- 端点 `POST /api/v1/devices/:deviceId/command:parse` —— 只解析、只返回 `proposed`，**不写影子**
- 7 个纯函数 + `command-parse.test.ts` **84** 条单测（81 + 前轮 F-10 新增 3 条）
- 32 条用例表**四轮真实 API**：1.1 基线 → 1.2 补 F-2/F-3 → 1.3 补 F-1b/F-4/F-6 →
  **1.4 收尾验证**（31/32）。三条阈值都在真实数据上标定并在 1.4 复核；问题 F-1–F-10 已定性归档
- **`backend/tools/case-table.mts`** 是回归检查器：断言标志、护栏归属（按 `parse()` 守卫顺序、
  用从 service 静态导入的阈值推导）、三条不变量；不过则退出码 1
- `meta.judgments`（加法、可选）：把第一问四个原始置信度摊开，拆掉顶层 `confidence` 的重载
- **F-10 已修**（前轮）：`UpstreamServiceError`(50003/502) + 私有 `callUpstream` 包住**两个** SDK 调用点 +
  `ParseLogger` 增加必填 `error` + 路由补接线；缺 `TYPESAFE_API_KEY` 也归入同一类（不再是 400/40001）。
  详见 results §3
- **G5 环境性跳过已落地（本轮，方案①）**：`case-table.mts` 新增 `classifyNonOk()` ——
  502 + `code 50003` 且响应体不含上游特征串（与单测 T1/T2/T3 同一批 `LEAK_MARKERS`）才判
  ⏭ 跳过，不计入断言、不影响退出码；**其余任何非 200 仍是 ❌**。跳过分支非免检：
  多断言三条 F-10 契约（502 / code 50003 / 不泄露），旧的「500 + 回显上游响应体」会变 ❌。
  防全表静默变绿：整表跑时跳过条数多于实际验证条数则退出码 1。
  跳过 ≠ 通过，汇总单独列出并写明「语义未验证」。
  **本轮只做了 `--dry-run`（退出码 0，32 条用例）；实跑未做** —— 环境性跳过的真实触发
  要等下一次整表实跑（约 43 次付费调用，G5 被 WAF 拦时才走该分支），见「未完成」第 5 条
- 文档 9 篇（本目录）+ 双 Agent 协作规范（`00-agent-protocol.md`，前轮加不变量 8）
- **线程交接规范化**（前轮）：入口改为 [`README.md`](./README.md) **按角色分流**
  （TA → STATUS + 协议；DA 碰端点 → `da-contract.md`；DA 不碰 → 一份都不用读）；
  对外契约独立成 [`da-contract.md`](./da-contract.md)；协议加「环境受阻分支」与「可关闭判据」；
  **README 里那批过期进度声明已删除**（它写着"178 条全绿""三轮"，早就是 183/84、四轮了）

- 提交：`ce42438`（主体）、`9e037db`、`bb78d4e`、`a3119ee`、`2c9a119`、`1fb8cf8`、
  `d3d8b7d`（F-10 修复 + 3 条单测）、`3309eb8`（入口分角色 + DA 契约 + 协议更新）、
  `a60f7a7`（把"散文被扫进粘贴"的踩坑写进协议 §4.2）；
  **本轮（2026-10-13）：G5 环境性跳过（方案①）落在 `case-table.mts` + 本文件修订，一次提交**

## 未完成

按优先级：

1. **F-1 根因未修。** 这台设备有两个温度属性（`target_temperature` int / `temperature` float），
   中文名都含"温度"，模型会选错（A2「温度设成22.5度」命中 int，被"必须是整数"拦下）。
   目前只改了**提示文案**，**归属仍然是错的**（1.4 实测 A2 仍命中 `target_temperature`，conf 0.95）。
   彻底修法（候选集带更强区分信息 / 对歧义属性二次确认）只有方向，没有设计。
2. **F-7。** 用户用简称时（说「湿度」，物模型里叫「当前湿度」）`mentionedUnavailable` 的字面匹配不命中，
   D2 仍回「这看起来不是一条属性下发指令」。results 文档里给了 TypeSafe 原生的修法
   （加一个覆盖全部属性含只读的 `Choice`），未实施。
3. **F-9。** hint 把"用了相对表达"误归因为"用了中文数字"（C1/C2/E5 根本没给数字）。一行文案修法，未实施。
4. **F-5。** B5/B6 两条步长用例压根没走到步长校验（在 `target_property` confidence 处就澄清了），
   `isStepAligned` 的**在线**行为从未被实测覆盖 —— 属用例设计缺口，会随 F-1 一起消失。
5. **G5 环境性跳过的真实触发未经实跑验证**（代码已落地，dry-run 已过）。下次整表实跑时
   G5 若仍被 WAF 拦，应看到 ⏭ 且退出码 0 —— 那才是这条分支的第一次在线验证。
6. **前端未接**（第 1 步范围外）。
7. `jev-1.13.0` 能否作为固定版本写进配置 —— **未确认**，见「阻塞」。

## 下一步（给下一个 TA 线程）

**第 1、2 条是动手顺序，别跳。**

1. **复现现状**（开工第一件事，先于动手）：
   `cd backend && npm run typecheck && npm test && npm run lint`
   预期 `tsc` 0 error ｜ **`273 passed (11 files)`**，其中 `command-parse.test.ts` **84** 条 ｜
   `lint` 0 error / 123 warning（2026-10-13 实测值）。
   **对不上就先查 `git log`** —— 可能已被 DA 改过，先把 STATUS 改对再干活。
2. 之后按「未完成」1–4 条推进（F-1 → F-7 → F-9 → F-5）；**改判定就回写 results 文档**，
   不要只写在 STATUS。改阈值/加改 Noul/Choice 必须整表实跑（协议 §8），实跑同时顺带
   验证 G5 跳过分支的在线行为（见「未完成」第 5 条）。
3. 脚本怎么用、断言什么、阈值标定区怎么读，全写在 `backend/tools/case-table.mts` 文件头注释。
   改 `parse()` 守卫顺序时**必须同步改它**，否则表里的"护栏"列会静静地说谎。
   ⚠️ **脚本不在质量门的覆盖范围内**（见「质量门」的覆盖范围提醒）—— 改完只能靠
   `--dry-run` 自己跑一次才发现语法/类型错误，别以为 `npm test` 绿了脚本就没坏。
4. ⚠️ **给用户贴命令时，不要把 `!` 前缀一起贴进去**（Task 19 踩过）：
   shell 会把行首 `!` 当**取反运算符**，退出码被反转，`EXIT=1` 是假信号。

## 阻塞 / 风险

- **Bash 安全分类器会整体不可用（第 5 次在 Task 19、第 6 次在 Task 20）**：非只读命令（`npm run *`、`npx tsx`、`git`）
  大量被挡，且**不按"只读/非只读"干净分界** —— 同一批命令里 `npm test` 过了、`npm run typecheck` 被挡。
  **表现是"命令没跑"而不是"命令失败"** —— 别把它当成代码出问题。
  绕法（协议 §4.1）：请用户用**半角** `!` 自己执行，输出会回到会话里；跑不了的项记为「未跑」，不许当「通过」。
- **真实 API 有费用且依赖网络**：四轮共约 130 次调用。`docs.typesafe.ai` 有过被网络策略拦下的记录，
  所以版本固定问题至今没查实。
- **Cloudflare 会拦"像攻击"的输入**：G5 那条注入样式输入在**边缘**就被 403，根本到不了模型
  （Ray ID `a3f696b959ae15e5`，出口 IP `154.21.95.7`）。任何含 SQL/HTML 样式的用户输入都可能被边缘拦掉 ——
  这条风险**依然成立**（F-10 只保证它被受控地表达成 502/50003，不代表上游会收下输入）。
- **`TYPESAFE_MODEL` 是否可填具体版本号 —— 未确认。** 代码刻意不硬编码版本，
  留了 `TYPESAFE_MODEL` 注入点（同时作用于 `defaultModel` 与每次请求的 `model`）。
  确认方式：读 `client.models.list()` 的实际返回值，看 `name` 的拼写格式。
- **同仓库双 Agent 并发**：TA 与 DA 可能同时碰 `app.ts` / 共享服务，规则见协议 §3。
- **`app.ts` 的兜底分支也回显 `error.message`**（同一类泄露，另一个面）：本轮**没动它** ——
  它属 DA 的共享面，且不经过本端点。留作观察项，修不修由 DA 定。

## 给 DA（平台开发 Agent）的请求

**对外契约已独立成一份文件：[`da-contract.md`](./da-contract.md) —— 碰端点就只读那一份，别读本文档。**
（本轮把原先散在这里的契约内容搬了过去，避免同一件事两处各写一份、然后分歧。）

从本文档这边只需要知道两件**本轮变了的事**：

1. **错误契约变了（F-10）**：端点遇到上游故障或未配置 key 时返回 **HTTP 502 + `code 50003`**，
   不再返回 500、也不再回显上游响应体（那里含我们的出口 IP）。详情与文案见 `da-contract.md` §2。
2. **`data.meta.judgments`（可选）**：四个原始置信度摊开，因为顶层 `confidence` 是重载的。
   详见 `da-contract.md` §3。


## 质量门（最近一次实测）

- 命令：`cd backend && npm run typecheck && npm test && npm run lint`
- 结果：`tsc` **0 error** ｜ **273 passed (11 files)**，其中 `command-parse.test.ts` **84** 条 ｜
  `lint` **0 error / 123 warning**
- 日期：**2026-10-13**，由 TA 在 G5 环境性跳过收尾轮实测（输出落盘 `/tmp/gate-{tsc,test,lint}.txt`，
  三项退出码全 0）。
- **数值与前一轮记录（183/6 files、109 warning）不一致的原因**：DA 在 Task 17–20 新增了
  security / api-catalog / av / internal-callback-guard / device-detail 五个测试文件（+90 条），
  代码增长也带来 14 个新 warning。`command-parse.test.ts` 的 84 条**一字未动** —— 与本轮只改
  `tools/` + 文档、不碰 `src/` 与 `tests/` 相符。
- 同轮另跑：`npx tsx --env-file=.env tools/case-table.mts --dry-run` → 退出码 **0**，列出 **32** 条用例，
  G5 的 why 列显示新文案（环境性跳过说明）。**本轮脚本改了 `classifyNonOk()` 等约 100 行，
  dry-run 即它的语法守卫**（见下条覆盖范围提醒）。
- ⚠️ **覆盖范围提醒（2026-09-23 实测 `package.json` / `tsconfig.json` 得出）**：
  `typecheck` 是 `tsc --noEmit`，而 tsconfig `include` **只有 `src/**/*.ts`**（且 `exclude` 了 `tests`）；
  `lint` 是 `eslint src/ --ext .ts`。也就是说 **`tests/` 与 `tools/` 都不在质量门里** ——
  上面那个"273 passed"是 vitest 用 esbuild 转译后跑出来的，**没经过类型检查**。
  推论：改测试文件或改跑表脚本后，**质量门全绿不代表没坏**；
  脚本的守卫只有它自己的 `--dry-run`，测试的守卫是它自己跑出来的断言。
- ⚠️ **另一个缺口（Task 19 记录）**：`tests/` 里**没有任何 HTTP 夹具**（全仓库无 `.inject(`），
  所以"服务抛 IotError → 路由实际吐出 502/50003"这段接线**没有自动化覆盖**。
  被断言的是 `IotError` 自身的字段与 `toResponse()`；端到端形状由下一轮用例表实跑给出。
  （`tools/case-table.mts` 走 `app.inject` 但它是付费实跑工具，不是自动化门。）


## 关键约束（违反会出安全问题，理由见协议 §6）

- `TYPESAFE_API_KEY` 只在 `backend/.env`，**绝不进 `src/`**（会打进前端包）
- **不开** `TYPESAFE_LOG_LEVEL=debug`（SDK 打印未脱敏请求体）
- **不改动开发库**（用例表跑在既有设备上，不新建产品/设备）
- 模型输出**永不**直接写影子
- **不把上游的错误细节回显给调用方**：`err.message` 里装的是上游响应体（实测含出口 IP
  `154.21.95.7`）。对外只给固定文案 + 稳定 code，原始错误只进服务端日志（协议 §6 不变量 8）
