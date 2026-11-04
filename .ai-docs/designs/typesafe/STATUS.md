# TypeSafe 工作流 — 当前状态

> **覆盖式文件：收尾时整体重写，不要追加。** 规则见 [`00-agent-protocol.md`](./00-agent-protocol.md)。
>
> 最后更新：**2026-09-23** ｜ 更新人：**Test Engineer Agent (TypeSafe)**

## 一句话现状

方案 #1（自然语言 → 设备影子指令）**后端第 1 步已完成并提交**（三轮真实 API 验证）。
工作区里有**两批未提交改动**等着收尾：① 治理规范（协议 + 本文件）
② 本轮用例表脚本落回仓库 + `meta.judgments`。
**这两批都还没跑过质量门，脚本也只做到"写完"没做到"跑通"**（Bash 非只读命令被安全分类器
挡了整整一轮）。所以**下一步不是开发，是先把这两批验证并提交掉**。
**未接前端**；方案 #2 只到设计，未开工。

## 目标

给物联网平台引入 TypeSafe（System One / Jev）语义判断。落点按推荐顺序：

1. **自然语言 → 设备影子指令下发**（方案 #1）—— 本工作流当前主战场
2. 自然语言 → 转发规则配置（方案 #2）—— 待排期
3. 统一日志流语义搜索 —— 待排期

**当前阶段**：方案 #1 落地顺序的第 1 步 —— 只做后端端点，**不接前端、不改 shadow 路由**。

## 已完成

- 端点 `POST /api/v1/devices/:deviceId/command:parse` —— 只解析、只返回 `proposed`，**不写影子**
- 7 个纯函数 + `command-parse.test.ts` 79 条单测（**本轮的 2 条新测试尚未跑过**）
- 32 条用例表跑**三轮真实 API**（修复前基线 → 补 F-2/F-3 → 补 F-1b/F-4/F-6）；
  三条阈值都在真实数据上标定；问题 F-1–F-9 已定性归档
- 文档 6 篇（本目录）
- 双 Agent 协作规范（`00-agent-protocol.md`）+ 本状态文件
- 提交：`ce42438`（主体）+ `9e037db`（worklog 补记），都在 `main`
- ⚠️ **治理规范（`00-agent-protocol.md` / 本文件 / worklog Task 15 / README 指针）当时没提交成功** ——
  实测 `git log` 的 HEAD 仍是 `9e037db`，这几份文件现在还在工作区里未跟踪/未提交。
  它和下面「本轮的未提交改动」是两批，收尾时一并处理。
- **本轮的未提交改动**（见「未完成」第 1 条）：
  - `backend/src/services/command-parse.service.ts` —— 新增 `ParseJudgments` 与 `meta.judgments`
  - `backend/tests/unit/command-parse.test.ts` —— 新增 2 条测试
  - `backend/tools/case-table.mts` —— 用例表回归检查器（**新建**）

## 未完成

按优先级：

1. **【最该先做 · 不是开发是收尾】把工作区里两批未提交改动验证并提交。**
   两批：① 治理规范（协议 + 本文件 + worklog Task 15 + README 指针，当时没提交成功）
   ② 用例表脚本 + `meta.judgments` + 2 条测试。**下面三步都是机械动作，顺序不能换：**
   1. `cd backend && npm run typecheck && npm test && npm run lint`
      —— 预期 `tsc` 0 error ｜ **180 passed (6 files)**（79 + 2）｜ `lint` 0 error / 109 warning。
      **若 `180` 对不上，先看是不是新写的 2 条测试挂了**，别急着改别的。
   2. `npx tsx --env-file=.env tools/case-table.mts --dry-run`（在 `backend/` 下）
      —— 只列 32 条用例、不打 API、退出码应为 0。**这一步是在验证脚本本身能跑起来**
      （写它的那一轮 Bash 非只读命令全程被安全分类器挡着，只做到"写完"，没做到"跑通"）。
   3. 提交（`.commit-msg.txt` 在仓库根，已写好；**别用 `git add -A`**，会把消息文件本身提交进去）：
      ```bash
      cd /Users/helson/AIworkspace/IoT_Workspace
      git add backend/src/services/command-parse.service.ts backend/tests/unit/command-parse.test.ts \
              backend/tools .ai-docs/designs/typesafe worklog.md \
        && git commit -F .commit-msg.txt && rm .commit-msg.txt
      ```
   4. 收尾之后再**实跑一次用例表**（去掉 `--dry-run`，约 43 次付费调用），
      把输出贴回 `01-nl-shadow-command-test-results.md` 作为第 4 轮记录。
      **这一步只验证断言，不改行为**；有断言不过就是真回归，按输出里的 ❌ 逐条查。
      没有实跑之前，"32 条仍全部符合期望"这句话不成立 —— 别在文档里写它。
2. **F-1 根因未修。** 这台设备有两个温度属性（`target_temperature` int / `temperature` float），
   中文名都含"温度"，模型会选错（A2「温度设成22.5度」命中 int，被"必须是整数"拦下）。
   目前只改了**提示文案**（hint 里指出"你是不是想设「当前温度」"），**归属仍然是错的**。
   彻底修法（候选集带更强区分信息 / 对歧义属性二次确认）只有方向，没有设计。
3. **F-7。** 用户用简称时（说「湿度」，物模型里叫「当前湿度」）`mentionedUnavailable` 的字面匹配不命中，
   D2 仍回「这看起来不是一条属性下发指令」。results 文档里给了 TypeSafe 原生的修法
   （加一个覆盖全部属性含只读的 `Choice`），未实施。
4. **F-9。** hint 把"用了相对表达"误归因为"用了中文数字"（C1/C2/E5 根本没给数字）。一行文案修法，未实施。
5. **F-5。** B5/B6 两条步长用例压根没走到步长校验（在 `target_property` confidence 处就澄清了），
   `isStepAligned` 的**在线**行为从未被实测覆盖 —— 属用例设计缺口，会随 F-1 一起消失。
6. **前端未接**（第 1 步范围外）。
7. `jev-1.13.0` 能否作为固定版本写进配置 —— **未确认**，见「阻塞」。

## 下一步（给下一个 TA 线程）

**第 1 条是动手前的第一件事，也是当前唯一阻塞项 —— 它做完之前不要开始任何新开发。**

1. **收尾**：按「未完成」第 1 条的 4 步走（质量门 → dry-run → 提交 → 实跑用例表）。
   开工先 `git log --oneline -3` 与 `git status --short` 对一眼：**若工作区已经是干净的、
   且 HEAD 上有用例表脚本那次提交，说明上一轮线程已把它做完了**，直接跳到第 2 条。
2. **复现现状**：`cd backend && npm run typecheck && npm test && npm run lint`
   预期 `tsc` 0 error ｜ `180 passed (6 files)` ｜ `lint` 0 error / 109 warning。
   **对不上就先查 `git log`** —— 可能已被 DA 改过，先把 STATUS 改对再干活。
3. **脚本怎么用**：用法、断言什么、阈值标定区怎么读，全写在
   `backend/tools/case-table.mts` 文件头注释（第 1–45 行）。改 `parse()` 守卫顺序时**必须同步改它**。
4. 之后按「未完成」的 2–4 条推进（F-1 → F-7 → F-9 → F-5）；
   **改判定就回写 results 文档**，不要只写在 STATUS。

## 阻塞 / 风险

- **真实 API 有费用且依赖网络**：三轮共 43 次调用；`docs.typesafe.ai` 有过被网络策略拦下
  （"Unable to verify if domain is safe to fetch"）的记录，所以 §5 的版本固定问题至今没查实。
- **`TYPESAFE_MODEL` 是否可填具体版本号 —— 未确认。** 代码刻意不硬编码版本，
  留了 `TYPESAFE_MODEL` 注入点（同时作用于 `defaultModel` 与每次请求的 `model`）。
  确认方式：读 `client.models.list()` 的实际返回值，看 `name` 的拼写格式。
- **同仓库双 Agent 并发**：TA 与 DA 可能同时碰 `app.ts` / 共享服务，规则见协议 §3。

## 给 DA（平台开发 Agent）的请求

- **本轮改了端点响应面（加法）**：`data.meta` 多了可选字段 `judgments`
  （`{intent_actionable, mentions_timing, mentions_multiple, target_property_confidence}`）。
  四个原始置信度原样摊开 —— 顶层 `confidence` 是**重载**的（护栏命中时装的是"触发护栏那个问题的
  置信度"，正常路径装的是属性置信度），读表时分不清谁是谁。前端如果要用，直接读 `judgments`，
  不要从 `confidence` 猜。**未调用模型就短路的路径没有这个字段**（如"无可写属性"），前端要判空。
- 若要**接前端**：先读协议 §6 的不变量，尤其两条 ——
  ① `proposed` 只能是对象或 `null`；
  ② **`needs_clarification: true` 不是错误**，要把 `hint` 展示给人看（"请明确给出数字"这类是可操作提示），
  不要当异常弹窗。
- 保持 `app.ts` 里那条路由注册的正则形态 `:action(command:parse)`，理由见协议 §6 第 5 条。
- 前端**不要**直连 TypeSafe：key 在 `backend/.env`，前端只调本端点。
- 这台开发库的设备被我用作用例表夹具（只读，没写任何数据）；如果你要删 `prod-a1b2c3d4` 下的设备，
  知会一声，用例表会需要换设备重标阈值。

## 质量门（最近一次实测）

- 命令：`cd backend && npm run typecheck && npm test && npm run lint`
- 结果：`tsc` 0 error ｜ `178 passed (6 files)`，其中 `command-parse.test.ts` 79 条 ｜
  `lint` **0 error / 109 warning**
- 日期：2026-09-21，由 TA 记录。
- ⚠️ **这一行是上一轮改动之前的实测值，不是当前工作区的值。** 当前工作区多了 2 条测试
  （预期 180）与一个 `tools/*.mts`，**尚未跑过质量门**。
  **下一个线程开工时须自行重跑复核，不要采信本行。**

## 关键约束（违反会出安全问题，理由见协议 §6）

- `TYPESAFE_API_KEY` 只在 `backend/.env`，**绝不进 `src/`**（会打进前端包）
- **不开** `TYPESAFE_LOG_LEVEL=debug`（SDK 打印未脱敏请求体）
- **不改动开发库**（用例表跑在既有设备上，不新建产品/设备）
- 模型输出**永不**直接写影子
