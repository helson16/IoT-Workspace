# Task 13 设计文档 — 云存服务(数据分析页)接入真实数据

## 1. 背景与目标

`data-analysis-page.tsx`(导航入口「云存服务」, 面包屑「数据分析」)当前为纯 mock:
4 个图表占位卡片 + 3 条写死的"智能分析"。

本 Task 将其接入真实数据, 复用已有 13.4 万条属性历史 + 7,455 条事件日志:

- 数据基础(实测 2026-09-19):
  - `device_property_history`: 134,293 条(temperature / humidity / power_switch 各 ~4.5 万, 时间跨度 09-09 ~ 09-19)
  - `device_event_logs`: 7,455 条(high_temperature_alarm, eventType: warn 3,206 + alert 4,249)
  - `device_action_logs`: 0 条
- 前端已安装 `recharts@2.15.4`(node_modules 确认), 图表渲染零新增依赖
- 不新建表、不改 Prisma schema — 纯聚合查询

## 2. DB 事实(写 SQL 前必读)

| 表 | 列(驼峰, 需引号) | 类型 |
|---|---|---|
| device_property_history | "deviceId", identifier, value(jsonb 裸标量, 如 `31.4`), "timestamp" | timestamp(3) |
| device_event_logs | "deviceId", "eventId", "eventType", payload(jsonb 对象), "timestamp" | timestamp(3) |
| device_action_logs | "deviceId", action_id, status, created_at | — |

- jsonb 裸标量取数值: `(value #>> '{}')::double precision`
- 存储占用: `pg_total_relation_size('device_property_history')`(精确字节, 含索引/TOAST)

## 3. 后端设计(2 个新文件 + app.ts 注册)

### 3.1 `services/analytics.service.ts` — 纯函数(可单测)

```ts
// 桶补全: 把稀疏聚合行补成连续时间桶(含空档), 前端图表不断轴
fillTimeBuckets<T>(rows, now, unit: 'minute'|'hour'|'day', count, labelOf, valueOf) → Array<{label, value}>

// 洞察派生: 输入聚合事实, 输出结构化洞察(阈值规则见 3.4)
buildInsights(input: InsightInput) → Insight[]
```

### 3.2 `routes/analytics.routes.ts` — 4 端点(JSON Schema 校验)

1. **GET /api/v1/analytics/storage** — 存储统计
   ```jsonc
   { total_records, week_records, avg_daily_records, storage_bytes,
     breakdown: [{ label, table, records, storage_bytes }] }  // 三表各一行
   ```

2. **GET /api/v1/analytics/charts** — 4 个预定义图表, 一次返回
   | id | 名称 | 类型 | 聚合口径 |
   |---|---|---|---|
   | temp-trend | 设备温度趋势 | line | 近24h 全设备 temperature 按小时 avg |
   | daily-active | 活跃设备统计 | bar | 近7天 每日 distinct deviceId(property 上报) |
   | alarm-dist | 告警级别分布 | pie | 近30天 event_logs 按 eventType 计数 |
   | throughput | 消息吞吐量 | area | 近1h property 按分钟 count |
   - chart: `{ id, name, type, unit, time_range, refresh_interval, summary, points: [{label, value}] }`

3. **GET /api/v1/analytics/charts/:id/details** — 图表明细(「查看详情」)
   - `{ chart(同上元信息), points, raw: 最近 20 条原始记录 }`
   - raw 按图表语义取: temp-trend→temperature 原始值; daily-active→各日首末上报设备; alarm-dist→最新事件; throughput→最新 property

4. **GET /api/v1/analytics/insights** — 真实派生洞察
   | 信号 | 阈值 | severity |
   |---|---|---|
   | 今日 vs 昨日 property 条数 | 增幅>20% → 激增 / 降幅>20% → 回落 | info |
   | 近24h temperature > 物模型 spec.max | 有超限 → critical(列设备名+最近值) | critical |
   | 设备在线率 | 离线>0 → 点名离线设备 | warning |
   | 近7天告警 vs 前7天 | 增长 → warning; 下降 → info | info/warning |
   - Insight: `{ title, description, severity: info\|warning\|critical, time }`; 无超限时温度项不出现

### 3.3 注册

`app.ts` import + `register(analyticsRoutes)`, 与 ops/routes 同模式(JWT 全局钩子已覆盖)。

## 4. 前端设计

### 4.1 `client.ts` 新增

类型: `AnalyticsStorage / AnalyticsChart / AnalyticsChartPoint / AnalyticsChartDetails / AnalyticsInsight`
方法: `getAnalyticsStorage() / getAnalyticsCharts() / getAnalyticsChartDetails(id) / getAnalyticsInsights()`

### 4.2 `data-analysis-page.tsx` 全量重写

- **顶部统计卡片**(4 个, 复用概览页卡片风格):
  总消息记录 / 存储占用(格式化 KB/MB) / 近7天新增 / 日均上报量
- **图表网格 2×2**: recharts `LineChart / BarChart / PieChart / AreaChart`,
  `ResponsiveContainer height=180`; 卡片头部: 图标+名称+类型 badge+数据源/时间范围;
  底部: 刷新间隔 + 「查看详情」
- **查看详情 Dialog**: 数据点表(label/value) + 最近原始记录表
- **智能分析**: 真实 insights, severity 徽章沿用 mock 期样式(info/warning/critical)
- **数据获取**: react-query — storage/charts refetch 60s, insights 120s; loading 骨架 / 空态 / 错误重试三件套

## 5. 单测(`backend/tests/unit/analytics.service.test.ts`)

- `fillTimeBuckets`: 稀疏行补全 / 空档置 0 / 边界(全空/满)
- `buildInsights`: 四类阈值分支(激增/回落/平稳; 有超限/无超限; 有离线/全在线; 告警增/减)

## 6. 验收标准

1. backend `npm run typecheck` + `npm test`(新增用例全过) 全零
2. root `npx tsc --noEmit` + `npm run lint` 全零
3. 浏览器: 云存服务页 4 卡片有真实数字, 4 图表渲染出真实曲线/柱形/环形, 详情 Dialog 数据点与原始记录可见, 智能分析非写死内容; console 无产品错误
4. API 冒烟: 4 端点 code=0, 数字与 psql 直查一致(抽查 total_records)
