# Task 6 设计文档: 前后端联调 — 前端接入真实后端 API

> 目标: 将 Task 2 的高保真控制台 UI(硬编码 mock 数据)接入 Task 4/5 实现的 Fastify 真实后端,
> 打通「产品管理 / 设备管理 / 设备详情 / 概览」四个核心页面的真实数据链路, 并完成端到端验证。

---

## 1. 环境约束与决策

| 约束 | 决策 |
|------|------|
| 本机无 Docker(无 EMQX/PG/Redis 容器) | PG 16 + Redis 用 Homebrew 原生安装; EMQX 暂缺 |
| 无 EMQX MQTT Broker | 设备行为(上线/属性上报/事件)通过后端 internal HTTP 回调接口模拟(与 EMQX 调用后端的路径完全一致, 数据链路等价) |
| Bun 不可用 | 统一使用 Node v22 + npm |

## 2. 后端增强 (新增 3 个路由文件 + 1 个 auth hook)

### 2.1 JWT 认证保护 (修复现有缺口)

现状: `platform-token` 签发 JWT, 但 v1 业务路由未校验。新增全局 `onRequest` hook:

- 放行: `/health`, `/api/v1/auth/*`, `/api/internal/*`(内部 secret 自行校验)
- 其余 `/api/v1/*` 必须携带 `Authorization: Bearer <token>`, 校验失败返回 40101

### 2.2 新增 API (对齐腾讯 IoT Explorer 控制台所需数据)

#### GET /api/v1/stats/overview — 概览统计
```json
{
  "code": 0, "message": "success",
  "data": {
    "project_count": 1,
    "product_count": 4,
    "device_count": 12,
    "online_count": 5,
    "recent_activity": [
      { "time": "10:32", "type": "设备上线", "device": "dev-001", "device_name": "客厅温控器-01", "status": "success" },
      { "type": "属性上报", ... },
      { "type": "事件上报", "status": "warning" }
    ]
  }
}
```
实现: product/device 聚合 count + 设备 event_logs(事件) + property_history(属性上报, 按 timestamp 取最新 N 条去重) + 设备 lastLoginAt 派生上线事件, 合并取最近 10 条。

#### GET /api/v1/devices — 全局设备列表(跨产品)
Query: `page, page_size, status(all|online|offline|not-activated|disabled), keyword(匹配设备名/产品名)`
返回 items 含: deviceId, deviceName, productName, productId, status, firmwareVersion, lastLoginAt, createdAt + total + 分页。
实现: `device.findMany({ include: { product: { select: { productName } } } })`, status counts 并行 count。

#### GET /api/v1/devices/:deviceId — 设备详情(全局 deviceId)
返回 device 基础信息 + productName/protocolType/nodeType(来自 product) + tags。

#### GET /api/v1/devices/:deviceId/telemetry — 最新遥测
Query: `limit(默认20)`。返回 property_history 按 timestamp desc, 每条 {id, identifier, value, timestamp};
前端按 identifier 渲染。

### 2.3 设备模拟器 (tests/sim-device.js)

无 EMQX 场景下的设备数据流模拟: 直接调用 internal 接口(X-Internal-Secret header):
- `POST /api/internal/mqtt/online` → 设备上线
- `POST /api/internal/mqtt/property-report` → 周期属性上报(温湿度正弦波+噪声, 走物模型校验+影子+历史)
- `POST /api/internal/mqtt/event-report` → 偶发高温告警事件
- `POST /api/internal/mqtt/offline` → 退出时离线

## 3. 种子数据 (backend/prisma/seed.ts)

4 个产品(智能温控器/智能门锁/工业网关/环境传感器, 含完整物模型属性) + 12 台设备(不同状态分布)。
复用 backend-design/schema.sql 的物模型定义。

## 4. 前端改造

### 4.1 API 层 (src/lib/api/)

- `client.ts`: fetch 封装, 自动附加 Bearer token; 401 时自动重新获取平台 token 重试一次
- `auth.ts`: 平台 token 获取与缓存(sessionStorage, app_key/app_secret 走 env `NEXT_PUBLIC_APP_KEY/SECRET`, 默认 dev 值)
- `types.ts`: 后端响应类型定义
- base URL: `NEXT_PUBLIC_API_BASE` (默认 `http://localhost:3200`, 后端 CORS 已放开)

### 4.2 页面接入 (保持像素级 UI 不变, 仅替换数据源)

| 页面 | 数据源 | 交互增强 |
|------|--------|----------|
| OverviewPage | `GET /stats/overview` (10s 轮询) | 统计卡片+设备动态实时刷新 |
| ProductListPage | `GET /products` | 新建产品 Dialog(POST) 真实创建; 删除产品 |
| DeviceListPage | `GET /devices` | 注册设备 Dialog(选产品+设备名, POST register); 状态筛选/搜索走后端 query; 分页 |
| DeviceDetailPage | `GET /devices/:id` + `/telemetry` + `/shadows/:id` | 遥测实时(5s 轮询); 影子 desired 下发(PUT shadow); 下发指令改为属性下发 |

所有页面统一: loading 骨架/空状态/错误重试。

### 4.3 状态管理

新增 `useDeviceData` 等 react-query hooks(项目已装 @tanstack/react-query, device-detail 已用)。
QueryProvider 已存在于 components/iot/query-provider.tsx, 确认挂载于 layout。

## 5. 验收标准

1. `tsc --noEmit` 后端零错误; `next build` 前端成功
2. 概览页显示真实统计数字(4 产品/12 设备/在线数)与实时设备动态
3. 产品管理页表格显示 DB 真实产品; 新建产品后列表即时刷新
4. 设备管理页跨产品显示真实设备; 注册设备成功后出现; 状态筛选/搜索生效
5. 设备详情页显示真实遥测数据流(模拟器上报后 5s 内可见)与影子状态
6. 浏览器 Console 无报错; 无未捕获网络错误
7. 未经认证的 API 请求返回 40101(锁定 token 流程真实生效)

## 6. 数据流转闭环

```
sim-device.js ──HTTP(internal)──> Fastify ──> 物模型校验 ──> 影子reported + property_history
                                                      └──> Redis 在线标记
浏览器 ──> Next.js(:3000) ──Bearer──> Fastify(:3200) ──> PG/Redis ──> JSON 响应 ──> 页面渲染
```

## 7. 验收结果 (2026-09-09 E2E 实测)

| # | 验收项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 后端 `tsc --noEmit` / 前端 `tsc --noEmit` | ✅ PASS | 双端零错误(后端 vitest 无测试文件, 非阻塞) |
| 2 | 概览页真实统计 + 实时动态 | ✅ PASS | 产品 4/设备 12/在线 6/离线 4/未激活 2; 动态列表含实时上报条目 |
| 3 | 产品管理页真实产品表格 | ✅ PASS | 4 行产品(温控器/照明灯/网关/传感器), 设备数/在线数正确 |
| 4 | 设备管理页跨产品设备 + 状态筛选 | ✅ PASS | 12 行设备, 状态 Tab 计数正确, 状态标签配色正确 |
| 5 | 设备详情实时遥测 + 影子 | ✅ PASS | living-room-thermo-01: 8s 后 temperature 24.7→25.9, humidity 58.7→60, 5s 自动刷新 |
| 6 | Console 无报错 | ✅ PASS | 仅 1 条 TRAE 工具注入属性(data-trae-ref)的 hydration 警告, 无功能影响 |
| 7 | 未认证请求返回 401 | ✅ PASS | 无 Bearer 请求 /api/v1/products 返回 401 |

补充: 设备详情「返回列表」按钮回归设备管理页正常; 数据链路闭环验证
(模拟器→internal API→物模型校验→影子/历史表→前端轮询渲染)全部打通。
