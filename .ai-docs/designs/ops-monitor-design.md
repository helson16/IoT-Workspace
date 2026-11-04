# Task 11 设计文档: 监控运维页面接入真实数据

> 目标: 将 ops-monitor-page(纯 mock: 假 CPU/内存指标 + 假事件流)接入真实运维数据 —
> 统一日志流(属性上报/事件/服务调用/上下线) + 平台运行指标 + 24h 消息趋势, 对齐腾讯云 IoT Explorer「监控运维」。

## 1. 数据基础(已存在)

| 表 | 现有数据 | 用途 |
|----|---------|------|
| device_property_history | 76k+ 行, 模拟器持续写入 | 消息量指标 + 属性上报日志 + 24h 趋势 |
| device_event_logs | 4k+ 行(含高温告警) | 事件日志 + 告警计数 |
| device_action_logs | 服务调用记录 | 服务调用日志 |
| devices.last_login_at / last_logout_at | 上下线时间戳 | 上下线事件(每设备最新一次) |

## 2. 后端新端点(ops.routes.ts, JWT 保护)

### GET /api/v1/ops/metrics
```json
{ "device_total": 12, "online": 6, "offline": 4, "not_activated": 2, "disabled": 0,
  "online_rate": 0.5,
  "messages_today": 8640, "events_today": 12, "alarms_today": 3, "actions_today": 0,
  "hourly_messages": [{ "hour": "2026-09-16T12:00:00Z", "count": 360 }, ...24 项] }
```
- messages_today: property_history 今日 0 点起计数
- alarms_today: event_logs 今日 eventType in (warn,error)
- hourly_messages: date_trunc('hour') 近 24h 聚合, JS 补零

### GET /api/v1/ops/logs?type=all|property|event|action|status&device_id=&page=&page_size=
统一日志流(UNION ALL 原生 SQL):
```json
{ "total": 80657, "page": 1, "page_size": 50,
  "items": [{ "id": "...", "time": "...", "type": "property", "device_id": "...",
              "device_name": "...", "product_name": "...", "level": "info",
              "summary": "temperature = 23.3" }] }
```
- type=all 四类 UNION; 单 type 仅查该类
- 排序 time DESC; BigInt id 转 text(避免 JSON 序列化崩溃)
- level: property=info / event=eventType / action=status / status=online|offline
- page_size 上限 100(吸取 Task 10 教训, 前端只用 ≤100)

## 3. 前端重写(ops-monitor-page.tsx)

- **指标卡 x4**(真实): 在线率(online/total+进度条) / 今日消息 / 今日事件·告警 / 今日服务调用
- **24h 消息趋势**: recharts AreaChart, hourly_messages
- **统一日志流**: Tab 筛选(全部/属性上报/事件/服务调用/上下线) + 设备搜索框 + 状态 badge(info蓝/warn橙/error红/online绿/offline灰) + 分页 + 10s 自动刷新
- loading 骨架 / error 重试 / empty
- API client: getOpsMetrics / getOpsLogs + 类型

## 4. 验收标准

1. 指标卡数字与 DB 实况一致(在线率 = online/total)
2. 趋势图 24 个小时点, 当前小时计数随模拟器增长
3. 日志流四类真实记录混杂, Tab 筛选正确
4. 设备搜索过滤生效; 分页翻页正确
5. 10s 自动刷新无闪烁; console 0 新错误; lint/tsc 0; 单测通过
