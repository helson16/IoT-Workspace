# Task 12 设计文档 — 消息通信（规则引擎转发 + 消息队列页面）

## 目标

将「消息通信」页面（message-queue-page）从 mock 数据切换为真实后端，核心能力为**规则引擎消息转发**：

设备上行消息（属性上报 / 事件上报）→ 规则匹配（产品 + 消息类型 + 筛选条件）→ 转发执行（HTTP Webhook / 消息重新发布）→ 转发日志落库 → 前端实时展示。

## 数据模型（2 张新表）

```
forward_rules                          forward_logs
├─ id (cuid)                           ├─ id (bigint autoincrement)
├─ name (unique, ≤64)                  ├─ rule_id / rule_name（冗余名称，防规则删除后日志失义）
├─ description                         ├─ device_id
├─ status: enabled|disabled            ├─ message_type: property|event
├─ product_id (转发来源产品)            ├─ topic（真实组装的 MQTT topic）
├─ message_type: property|event        ├─ payload (Json)
├─ filter: Json                        ├─ result: success|failed
│   {identifiers?: string[],           ├─ error_msg
│    eventTypes?: string[]}            ├─ latency_ms
├─ target_type: http|republish         └─ created_at
├─ target_config: Json
│   http: {url} / republish: {topic}
└─ created_at / updated_at
```

## 后端

### 1. rule-engine.service.ts

纯函数拆分（便于单测）：

- `matchRules(rules, msg)` — 依次匹配：productId 相同 + messageType 相同 + status=enabled + 筛选条件（property: identifiers 为空=全部，否则 params 命中任一 identifier；event: eventTypes 同理）
- `buildTopic(productId, deviceName, messageType, eventId?)` — `$thing/up/{productId}/{deviceName}/property/post` 或 `$thing/up/{productId}/{deviceName}/event/{eventId}`
- `executeTarget(rule, msg, fetchImpl?)` — http: POST JSON（5s AbortController 超时，2xx=success）；republish: 无 EMQX 环境直接 success（模拟发布）
- `dispatch(db, msg)` — 取规则 → matchRules → 逐条 executeTarget → 写 forward_logs（含 latencyMs）。**转发失败不抛错**，只落 failed 日志（规则引擎不影响上报主链路）

fetchImpl 可注入（单测用 fake fetch，不依赖网络）。

### 2. internal.routes.ts 挂载

property-report（写完历史后）与 event-report 各加一行 `void ruleEngine.dispatch(...)` fire-and-forget（错误内部兜底），上报主链路零延迟增加。

新增 `POST /api/internal/echo`：X-Internal-Secret 保护的回显端点，作为演示/联调 HTTP 转发目标。

### 3. rule.routes.ts（/api/v1，JWT 保护）

| 端点 | 说明 |
|---|---|
| GET /forward-rules | 列表 + 每规则今日转发数/成功率（logs groupBy） |
| POST /forward-rules | 创建（校验产品存在、http 目标 URL 格式） |
| PUT /forward-rules/:id | 更新 |
| DELETE /forward-rules/:id | 删除（日志保留，靠冗余 rule_name 展示） |
| PATCH /forward-rules/:id/status | 启停切换 |
| GET /forward-rules/logs | 分页日志（result/message_type/rule_id 筛选） |
| GET /forward-rules/stats | rule_count/enabled_count/today_forward_count/today_success_rate |
| GET /forward-rules/topics | 真实主题统计：property_history + event_logs 按产品聚合（$queryRaw，UNION 分支 ::int 对齐）组装 topic 展示 |

新增错误类：RuleNotFoundError(40404) / RuleNameConflictError(40904)。

### 4. app.ts 修复（前置隐患）

`@fastify/rate-limit` 全局 100/min 按 IP 计数，本机所有流量共用一个桶。sim 上报 + 前端轮询 + 新增转发回环（echo 也是请求）将逼近上限。加 `allowList` 豁免 `/api/internal/*`（内部链路受 X-Internal-Secret 保护，可信）。

## 前端

message-queue-page.tsx 全量重写：

- **指标卡**：转发规则数 / 启用中 / 今日转发 / 今日成功率（stats 接口）
- **Tab 1 转发规则**：表格（名称/产品/消息类型/筛选/转发目标/今日转发+成功率/状态 Switch/编辑/删除）+ 新建/编辑 Dialog（产品下拉、类型 radio、筛选输入（逗号分隔，动态 label）、目标类型切换 URL/Topic 输入、描述、启停）+ 删除确认
- **Tab 2 转发日志**：结果筛选（全部/成功/失败）+ 表格（时间/规则/设备/类型/结果 badge/耗时/载荷 JSON）+ 分页 + 5s 自动刷新
- **Tab 3 消息主题**：真实 topic 列表（产品级聚合，消息数 + 最近活跃）

client.ts 新增 8 个方法与对应类型。

## 验收标准

1. 质量门全零（root tsc+lint；backend typecheck+test）
2. UI 创建 HTTP 转发规则（指向 echo）后，sim-device 每 5s 上报 → 转发日志 5s 内出现 success 记录（含真实 latency）
3. 筛选条件生效：只转发指定 identifier 的属性消息
4. 启停/编辑/删除全流程正常，删除后日志仍显示规则名
5. 消息主题 Tab 显示真实聚合数据（非 mock）
6. 浏览器 console 零新增产品错误
