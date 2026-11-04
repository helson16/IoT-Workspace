# Task 20: 设备详情页增强 — 遥测趋势图 / 影子物模型映射 / 通信日志时间线

## 现状审计

设备详情页(device-detail-page.tsx)当前能力:
- 设备信息卡(名称/状态/协议/类型/产品/创建时间) + 下发指令 dialog — 可用
- 设备影子卡片: reported/desired/delta 裸 key-value, 无中文名/单位, 可读性差
- 最新遥测数据: 平铺列表(最近 20 条), 无趋势可视化
- 无通信日志视图: 属性上报 34 万条 / 转发日志 8.8 万条 / 事件 1.9 万条数据沉睡, 设备维度无消费入口

## 数据源盘点(均已核实有真实数据)

| 表 | 行数 | 用途 |
|---|---|---|
| device_property_history | 340,957 | 遥测趋势(温控器 3 identifier, 5s 间隔) |
| device_shadows | 14 | 影子(已有端点) |
| forward_logs | 87,923 | 通信日志-转发(含 ruleName/result/latency) |
| device_event_logs | 18,934 | 通信日志-事件 |
| device_action_logs | 0 | 通信日志-服务调用(空表, 真实空态) |
| devices.last_login_at/logout | — | 通信日志-上下线 |
| thing_model_properties | 15 | name/unit/dataType 映射(spec 含 unit/min/max) |

## 增强方案(3 模块)

### A. 遥测趋势图(新后端端点)

`GET /api/v1/devices/:deviceId/telemetry/trend?hours=1|6|24`(默认 24)

- 后端从 device_property_history 取窗口内该设备全部行, join thing_model_properties 取 name/unit
- 纯函数 buildTelemetryTrend: 按 identifier 分组 → 过滤数值型(typeof value === 'number', bool/enum/string 不进折线) → 按 ts 升序 → 每序列均匀抽稀至 ≤240 点(保首尾), 控制响应体积(24h×3 identifier×5s≈5.2 万行 → ~720 点)
- 响应: { hours, series: [{ identifier, name, unit, points: [{ts, value}] }] }

前端: lg 2/3 卡片 = 顶部实时值 chips(每 identifier 最新值+单位) + Recharts 多序列折线(复用 data-analysis 图表样式) + 1h/6h/24h 时间范围 tab。

### B. 影子卡片物模型映射(纯前端)

- 复用已有 api.getThingModel(device.productId) 一次查询, 建 identifier → {name, unit} Map
- reported/desired/delta 行显示: 中文名(小字 identifier code) + 值 + 单位后缀
- 未在物模型定义的 key 保持裸 identifier(降级兜底)

### C. 通信日志时间线(新后端端点)

`GET /api/v1/devices/:deviceId/logs?type=all|property|event|action|forward|status&page&page_size`(默认 all/1/50)

- SQL UNION 5 类(device_id 硬过滤), 参考 ops.routes.ts 成熟模式:

| type | 来源 | level | summary |
|---|---|---|---|
| property | device_property_history | info | identifier = value |
| event | device_event_logs | eventType | eventId: payload 摘要 |
| action | device_action_logs | status | actionId 调用 · status |
| forward | forward_logs | result | ruleName · messageType · latency ms |
| status | devices last_login/logout | online/offline | 设备上线/下线 |

- 响应: { total, page, page_size, items: [{id, time, type, level, summary}] }

前端: 整行卡片, 垂直时间线(左圆点+竖线, 类型着色: property 蓝/event 橙/action 紫/forward 绿/status 灰) + 类型筛选 tab + 简单翻页(上一页/页码/下一页, 对齐设备列表分页样式)。

## 实现拆分

### 后端
1. 新建 `backend/src/services/device-detail.service.ts`:
   - 纯函数: sampleSeries(均匀抽稀保首尾), buildTelemetryTrend(分组/数值过滤/升序/抽稀)
   - DeviceDetailService 类: getTelemetryTrend / getLogs(SQL UNION)
2. `backend/src/routes/device.routes.ts` 注册 2 个新端点(JSON Schema 校验, hours enum [1,6,24])
3. 单测 `backend/tests/unit/device-detail.service.test.ts`: sampleSeries 4 用例 + buildTelemetryTrend 5 用例

### 前端
1. `src/lib/api/client.ts`: TelemetryTrendSeries/TelemetryTrendData/DeviceLogItem/DeviceLogsData 类型 + getTelemetryTrend/getDeviceLogs 方法
2. `src/components/tencent/pages/device-detail-page.tsx` 重构:
   - ShadowPanel(物模型映射) | TrendCard(实时 chips + 折线 + hours tab) 二列布局
   - 底部 LogTimeline(时间线 + 类型 tab + 分页)
   - react-query: trend 60s 刷新 / logs 手动+翻页触发 / thingModel 一次

## 验证计划
1. 质量门: root tsc+lint 0; backend typecheck+test(预计 264+9=273 用例)
2. curl 验证: trend 24h 返回 3 序列(温控器)/points≤240/name 中文+单位; logs 默认 all 含 property+forward 混排/type=forward 过滤生效
3. E2E: 设备列表进温控器详情 → 趋势图多序列渲染 + tab 切换 → 影子中文名+单位 → 时间线渲染+类型筛选+翻页 → console 无新错误
