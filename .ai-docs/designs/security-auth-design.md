# 安全认证页（设备凭证管理 + 认证记录）设计文档 — Task 14

## 1. 背景与目标

侧边栏「安全」（key: `rule-engine`，Shield 图标）当前渲染的是 mock 转发规则页（`rule-engine-page.tsx`），
而转发规则域已由「消息通信」页（`message-queue-page.tsx`）以真实数据完整覆盖。本任务将该页面
**重写为安全认证管理页**，成为第 10 个真实数据页面：

- 设备凭证管理：查看设备密钥（含 MQTT 连接配置）、轮换密钥、禁用/启用设备
- 认证记录流：统一记录所有认证事件（设备令牌认证 / MQTT 连接认证 / 密钥轮换 / 状态变更），含成功与失败

数据基础：`devices` 表已有 `deviceSecret` / `status` / `lastLoginAt` / `lastIp`；认证入口有两条真实链路
（`POST /api/v1/auth/device` 一机一密换 token、`POST /api/internal/mqtt/auth` EMQX 连接认证 hook），
两者均已正确拒绝 disabled 设备，但**无任何持久化认证记录** —— 本任务补齐。

## 2. 数据库：新增 `device_auth_logs` 表

沿用 `forward_logs` 的模式（denormalize 冗余字段，避免列表页 join），Prisma schema 新增模型：

```prisma
model DeviceAuthLog {
  id          Int      @id @default(autoincrement())
  deviceId    String   @map("device_id") @db.VarChar(128)
  deviceName  String   @map("device_name") @db.VarChar(128)
  productId   String   @map("product_id") @db.VarChar(64)
  productName String   @map("product_name") @db.VarChar(128)
  authType    String   @map("auth_type") @db.VarChar(32)   // device-token | mqtt-connect | secret-rotate | status-change
  result      String   @db.VarChar(16)                     // success | failure
  reason      String?  @db.VarChar(256)                    // 失败原因
  ip          String?  @db.VarChar(45)
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([deviceId, createdAt(sort: Desc)], map: "idx_auth_logs_device")
  @@index([createdAt(sort: Desc)], map: "idx_auth_logs_created")
  @@index([authType], map: "idx_auth_logs_type")
  @@map("device_auth_logs")
}
```

- 变更方式：`npx prisma db push`（项目无 migrations 目录，纯新增表，安全）
- 认证方式取值固定四种：`device-token`（REST 换 token）、`mqtt-connect`（MQTT 连接认证）、
  `secret-rotate`（密钥轮换审计）、`status-change`（禁用/启用审计）。轮换与状态变更固定 `success`。

## 3. 后端：security.service.ts + security.routes.ts

### 3.1 纯函数（可单测）

- `maskSecret(secret: string): string` — 前 4 + `****` + 后 4，短密钥全 `****`
- `buildSecurityStats(deviceCounts, todayLogs): SecurityStats` — 由设备 groupBy 计数 + 今日日志计数
  （total/success/failure）派生统计卡数据；今日窗口用 `createdAt >= startOfToday`（由调用方计算，
  **不走 SQL now()**，避开 PG session 时区 8h 偏移的坑）
- `normalizeLogFilter(query): LogFilter` — 归一并校验 auth_type/result 枚举，非法值抛 ValidationError
- `AUTH_TYPE_LABELS` — 常量映射（前端各自维护，后端仅供日志用途）

### 3.2 SecurityService 类方法

| 方法 | 说明 |
|---|---|
| `getStats()` | 设备状态计数 + 今日认证统计 |
| `listCredentials(query)` | 分页设备凭证列表（**不含 secret**），含 productName/lastIp/lastLoginAt |
| `getCredential(deviceId)` | 单设备详情：deviceSecret 明文 + MQTT 连接配置（复用 device.service 的 `buildMqttConfig`，需 export） |
| `rotateSecret(deviceId)` | 生成新密钥并 update；写 `secret-rotate` 日志 |
| `setDeviceStatus(deviceId, action)` | `disable` → status=disabled + 清 Redis 在线标记；`enable` → status=offline（需重新认证上线）；写 `status-change` 日志 |
| `listAuthLogs(filter)` | 分页认证记录，按 createdAt 倒序 |

### 3.3 路由（全部挂 `/api/v1/security`，JWT 全局保护自动生效）

| 端点 | 说明 |
|---|---|
| `GET /api/v1/security/stats` | 统计卡数据 |
| `GET /api/v1/security/credentials` | 凭证列表（query: page/page_size/keyword/status） |
| `GET /api/v1/security/credentials/:deviceId` | 查看密钥 + MQTT 配置 |
| `POST /api/v1/security/credentials/:deviceId/rotate` | 轮换密钥 |
| `PATCH /api/v1/security/devices/:deviceId/status` | 禁用/启用（body: `{action: 'disable'\|'enable'}`） |
| `GET /api/v1/security/auth-logs` | 认证记录（query: page/page_size/auth_type/result/device_id） |

### 3.4 埋点（写 device_auth_logs）

导出 `recordAuthLog(db, entry)` helper（内部 try/catch 吞错并 warn 日志，**埋点失败不阻断主流程**）：

1. `auth.routes.ts` POST /auth/device — try/catch 包裹 service.authenticate：成功写 `device-token/success`，
   DeviceAuthError 写 `device-token/failure`（含原因），然后 rethrow
2. `internal.routes.ts` MQTT auth hook — 4 个出口各写一条：设备不存在 / disabled / 密钥不匹配
   （`mqtt-connect/failure`），认证成功（`mqtt-connect/success`）；成功时同时更新 `lastIp = request.ip`
3. security.service 的 rotate / setDeviceStatus — 直接在 service 内写审计日志

附带小增强：`DeviceAuthInput` 增加可选 `ip`，`authenticate()` 成功时一并写 `lastIp`（auth.routes 传入 request.ip）。

## 4. 前端

### 4.1 API 层（client.ts）

类型：`SecurityStats` / `SecurityCredentialItem` / `SecurityCredentialDetail` / `SecurityAuthLogItem`
方法：`getSecurityStats` / `getSecurityCredentials` / `getSecurityCredential` / `rotateDeviceSecret` /
`setSecurityDeviceStatus` / `getSecurityAuthLogs`

### 4.2 页面重写（rule-engine-page.tsx → SecurityAuthPage）

- 组件重命名 `SecurityAuthPage`，更新 `page.tsx` 映射；`top-nav.tsx` 面包屑 `rule-engine: 规则引擎 → 安全认证`
- 布局：
  - **4 统计卡**：设备总数 / 在线设备 / 已禁用 / 今日认证（副标题：失败 n 次）
  - **Tab「设备凭证」**：表格（设备名 / 所属产品 / 状态 / 最近上线 / 最近认证 IP / 操作），
    操作：查看密钥、轮换密钥、禁用（红色，confirm Dialog）/ 启用
  - **Tab「认证记录」**：筛选（认证方式 select + 结果 select + 刷新），表格
    （时间 / 设备 / 所属产品 / 认证方式 badge / 结果（成功绿点 / 失败红点+原因 tooltip）/ IP），分页
- Dialog：
  - 查看密钥：deviceId、deviceSecret（等宽字体 + 复制按钮 navigator.clipboard）、MQTT host/port/clientId/username/password、安全提示文案
  - 轮换确认：警告「旧密钥立即失效，设备需更新密钥后重连」
  - 禁用确认：警告「禁用后设备认证将被拒绝」
- react-query：stats 10s 轮询；列表/日志 15s；空态/骨架/错误重试三件套；操作后 invalidate 相关 query
- 类名沿用 `tc-table` / `tc-badge`

## 5. 验收标准

1. `npx prisma db push` 成功，`device_auth_logs` 表建立
2. 质量门：root `tsc --noEmit` + `lint` 0 错误；backend `typecheck` 0 + `npm test` 全过（新增 security.service.test.ts）
3. E2E：统计卡为真实数值；凭证表 ≥ 12 台设备；查看密钥与 DB 实际值一致；轮换后 DB 密钥变化且认证记录新增
   `secret-rotate` 条目；禁用设备后状态变化 + 记录新增 + 再次用旧密钥认证被拒（403/失败记录）；认证记录
   Tab 展示真实事件流（E2E 前用 curl 走真实链路生成 device-token 成功/失败 + mqtt-connect 事件）；console 0 错误
4. worklog 追加 Task 14 条目，git 提交（英文 conventional commit）

## 6. 风险与边界

- **只做加法**：不改既有表结构、不动 ops.routes 的已知 8h 偏移问题（known issue 另行处理）
- 模拟器只走 internal/online 链路（非 mqtt/auth hook），不会自动产生 mqtt-connect 记录 —— E2E 数据
  由真实 API 调用生成，页面本身不造假数据
- 禁用正在模拟上报的设备会被 online 回调置回 online（internal 回调未校验 disabled，属另一安全域问题，
  本轮不改，E2E 选非活跃设备操作）；补：property-report 链路同样不拦截 disabled 设备，记录为 known issue
- lastIp 仅在新认证事件时更新，存量数据为 null（表格显示 `-`）
