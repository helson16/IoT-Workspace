# Task 18 设计文档: 音视频服务页数据可视化增强

> 日期: 2026-09-27 | 类型: 功能增强(用户选定方向: 数据可视化)

## 0. 背景与选点

页面图表现状: ops-monitor 1 个 AreaChart / data-analysis 4 种图表 / **音视频服务页 0 图表**(仅统计卡+表格, 但它拥有最丰富的流水数据: 3 万+ AV 事件, 三类型 × 成败 × 协议多维度)。

本轮聚焦音视频页, 增两个图表(与页面既有 10s 自动刷新节奏一致):

1. **24h AV 事件趋势 — 堆叠面积图**(recording/snapshot/playback 三色分层的每小时事件数), 数据来源: 新端点 `GET /api/v1/av/trend?hours=24`
2. **今日事件类型分布 — 饼图**(录制/截图/回放占比), 数据来源: 复用既有 `GET /api/v1/av/stats` 的 today_* 字段, **零后端改动**

## 1. 后端: GET /api/v1/av/trend (av.routes.ts)

- Query: `hours`(integer, 1~168, 默认 24)
- 实现: av.service.ts 新增纯函数 `buildHourlyTrend(rows, hours, now)` — 输入原始行(event_type, timestamp), 输出定长 hours+1 个桶(补零, 与 ops 页 hourly_messages 补零口径一致), 每桶 `{ hour: 'HH:00', recording, snapshot, playback }`
- SQL: `$queryRaw` 按 `date_trunc('hour', timestamp)` 分桶, 窗口 `>= (now() AT TIME ZONE 'utc') - interval '${hours} hours'`(UTC now, 吸取 Task 17 8h 偏移教训; hours 用 Prisma.join/参数化防注入 — interval 参数不能直接绑定, 用白名单整数校验后模板拼接)
- AvService.getTrend(hours): 查询 + 调纯函数
- 返回: `{ hours, buckets: [{ hour, recording, snapshot, playback }] }`

## 2. 前端: log-service-page.tsx 增图表区

布局: 统计卡行下方插入一行两卡片(与腾讯云控制台风格一致, lg 以上 2/3 + 1/3):

- **左卡「24 小时事件趋势」**: Recharts `AreaChart` + 三个 `Area stackId="1"`(录制 #0052D9 蓝 / 截图 #00A870 绿 / 回放 #7B61FF 紫), X 轴 HH:00, 统一 Tooltip+CartesianGrid(样式抄 ops-monitor 页)
- **右卡「今日类型分布」**: `PieChart` + `Pie`(三 Cell 同色系) + 居中 Legend; 空态(今日 0 事件)显示占位文案(样式抄 data-analysis 页 PieEmpty)
- client.ts: `AvTrendBucket`/`AvTrendData` 类型 + `getAvTrend(hours?)` 方法
- react-query: `["av-trend"]` key, refetchInterval 10s(与 stats/events 同节奏); 骨架/错误重试与页面既有三件套一致

## 3. 测试与验证

- 单测: `buildHourlyTrend` 纯函数(空集全零桶/分桶计数/边界含/桶数定长/标签格式) ~5 用例
- 质量门: root tsc/lint 0; backend typecheck 0; test 259+5/264
- curl: trend 默认 24h 与 hours=2 形状; psql 交叉核对某小时桶计数
- E2E: 两图表渲染(面积图有面积/饼图有扇区)、数字与 DB 一致、console 0 新错误

## 4. 不做的事

- 不动其他页面图表(ops/data-analysis 已够用)
- 不加时间范围切换器(hours 参数预留但不做 UI, 避免过度设计)
- 饼图不做点击下钻
