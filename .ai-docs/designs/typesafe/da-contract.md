# DA 契约 — `command:parse` 端点与 TypeSafe 集成

> **谁该读这份**：平台开发 Agent（DA），且你要**碰**这三样里的任何一个 ——
> `POST /api/v1/devices/:deviceId/command:parse`、它的前端接入、或 `backend/src/app.ts` 里那条路由注册行。
>
> **不碰这些就不必读**。TypeSafe 的进度 / 未完成项 / 下一步**不在本文档**，在 [`STATUS.md`](./STATUS.md)。
>
> 这份是**契约**不是状态：只写「你不能改什么」「改了要同步什么」。由 TA 维护，**极少改动** ——
> 若你发现某条与实际代码不符，那是缺陷，请先知会 TA。

## 1. 不可改的三件事

| 项 | 为什么 |
|---|---|
| 路由注册必须保持正则形态 `:action(command:parse)` | find-my-way 会把裸写的 `command:parse` 当成「静态前缀 `command` + 名为 `parse` 的参数」，从而**吞掉 `/command`、`/commandXparse`、`/command-parse` 等兄弟路由**。已实测。 |
| `command-parse.service.ts` 的**守卫顺序**（intent → timing → multiple，且都拦在取值解析之前） | 顺序一改，用例表里的「护栏」列就会用错的阈值推导 —— 它会**静静地说谎**，没人会发现。要改就必须**同一次提交**里改 `backend/tools/case-table.mts`。 |
| 四条阈值（`INTENT_` / `TIMING_` / `MULTIPLE_` / `CONFIDENCE_THRESHOLD`） | 是在**本仓库真实数据**上标定的，不是抄文档示例值。改任何一条，必须重跑 32 条用例表并把新分布写回 results 文档。 |

这三个文件（service / routes / case-table）主责是 TA（协议 §3）。你要改，先读 STATUS 的「未完成项」，
并在**同一次提交里**更新 STATUS。

## 2. 错误契约（接前端必读）

端点遇到**上游故障**（超时 / 429 / 5xx / Cloudflare 边缘拦截）或**未配置 key** 时，返回：

```json
HTTP/1.1 502 Bad Gateway
{ "code": 50003, "message": "解析服务暂时不可用, 请稍后重试", "details": [] }
```

- 两条文案：`解析服务暂时不可用, 请稍后重试`（上游故障）/ `解析服务未配置, 请联系管理员`（缺 key）。
- **不要把它当「指令非法」提示** —— 它与用户输入无关，应提示「稍后重试」。
- 分支请认 **`code`**（`50003` 稳定），**不要认文案**。
- 注意：这让上游故障与语义判定结果彻底分开 —— `502/50003` 一律是"不是你的输入有问题"。
- （旧行为是 **500 且把上游响应体原样回显**给调用方，其中含我们的出口 IP。已修，见 results §3 的 F-10。）

## 3. 响应面

- 成功：`{ code: 0, message: "success", data: {...} }`
- `data.proposed` **只能是对象或 `null`**。
- **`needs_clarification: true` 不是错误**：把 `hint` 展示给人看（「请明确给出数字」这类是**可操作提示**），
  不要当异常弹窗。
- `data.meta.judgments`（可选）：`{intent_actionable, mentions_timing, mentions_multiple, target_property_confidence}`。
  顶层 `confidence` 是**重载**的（护栏命中时装的是"触发护栏那个问题的置信度"，正常路径装的是属性置信度），
  读表时分不清谁是谁 —— 要用就直读 `judgments`，别从 `confidence` 猜。
  **未调用模型就短路的路径没有这个字段**（如「无可写属性」），要判空。

## 4. 别人依赖你守的两条

- **`TYPESAFE_API_KEY` 只在 `backend/.env`**，绝不进 `src/`（Next.js 侧会把 key 打进浏览器包）。
  前端**不要**直连 TypeSafe，只调本端点。
- **模型输出永不直接写影子**：端点只返回 `proposed`，人工确认后才走既有链路。

## 5. 夹具：别删这台设备

用例表跑在**既有真实设备**上（`03d296fb…` / 产品 `prod-a1b2c3d4`「智能温控器」，只读，**没写任何数据**）。
你要删它下面的设备，先知会一声 —— 否则 32 条用例表得换设备并**重标全部阈值**。

## 6. 一处已知的共享面问题（留给 DA 决定）

`app.ts` 的**兜底错误分支**同样把 `error.message` 原样回显给调用方 —— 与 F-10 是**同一类泄露，但另一个面**
（不经过本端点，影响所有路由）。TA 没有动它：它属你的共享面，且不在本工作流范围内。
修不修由你定；若修，注意别顺带改掉协议 §6 里已确立的不变量。
