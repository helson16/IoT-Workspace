# Task 16 设计文档: 音视频服务页接入真实数据(模拟音视频元数据链路)

> 日期: 2026-09-26 | 页面: log-service-page.tsx(音视频服务, 最后一个 mock 页)

## 0. 目标与边界

- **目标**: 音视频服务页 100% 真实数据 —— 摄像头设备产生的录制/截图/回放事件元数据真实入库, 页面从后端 API 读取。
- **边界(与既定方向一致)**: 只模拟**元数据链路**(事件记录: 文件名/大小/时长/协议/状态), 不传真实视频流、不做流媒体转发、不做 OSS 真实存储。与 sim-device 模拟遥测的模式完全一致。
- **禁止**: 前端造假(mock 数据/随机数)。

## 1. 数据模型(Prisma 新增)

```prisma
// 14. 音视频事件记录表 (AV Event Logs)
model AvEventLog {
  id            BigInt   @id @default(autoincrement())
  deviceId      String   @map("device_id") @db.VarChar(128)
  eventType     String   @map("event_type") @db.VarChar(32) // recording | snapshot | playback
  status        String   @db.VarChar(16)                    // success | failed
  fileName      String?  @map("file_name") @db.VarChar(255)
  fileSize      Int      @default(0) @map("file_size")      // bytes
  durationSec   Int      @default(0) @map("duration_sec")   // 秒(录制/回放), 截图为 0
  streamProtocol String  @default("RTMP") @map("stream_protocol") @db.VarChar(16) // RTMP | HLS | WebRTC
  detail        Json     @default("{}")
  timestamp     DateTime @default(now())

  device        Device   @relation(fields: [deviceId], references: [deviceId], onDelete: Cascade)

  @@index([deviceId, timestamp(sort: Desc)], map: "idx_av_logs_device_ts")
  @@index([eventType], map: "idx_av_logs_type")
  @@index([timestamp(sort: Desc)], map: "idx_av_logs_ts")
  @@map("av_event_logs")
}
```

- Device 模型反向加 `avLogs AvEventLog[]`。
- 单表即可(录制/截图/回放字段差异小, 用 eventType 区分), 不拆多表 —— 12 张既有表都是这种"事件流水"模式。
- 列名蛇形 @map, 新表无历史驼峰引号怪癖。
- `prisma db push` + `generate`。

## 2. 后端

### 2.1 services/av.service.ts(纯函数, 可单测)

- `parseAvEvent(raw)` — 校验并规范化: eventType ∈ {recording, snapshot, playback}; status ∈ {success, failed}; fileSize/durationSec ≥ 0 上限校验; recording/playback 必须有 durationSec>0, snapshot durationSec 强制 0; fileName 可选字符串截断; 协议 ∈ {RTMP, HLS, WebRTC}。非法 → ValidationError。
- `buildFileName(eventType, deviceName, ts)` — 确定性文件名生成(设备侧未带 fileName 时兜底), 如 `front-door-cam-01_20260926110932.mp4/.jpg`。
- `summarizeAvEvents(rows, todayStart)` — 输入原始行, 输出统计: 今日各类型次数、总事件数、总存储字节、今日总时长(秒)、成功率、涉及设备数。今日窗口由 Node 侧计算后传入(避开 PG 时区 8h 偏移坑, 与 ops.routes.ts 一致)。

### 2.2 internal.routes.ts 新增回调端点

- `POST /api/internal/mqtt/av-report` — 设备音视频事件上报(X-Internal-Secret 鉴权, JSON Schema 校验)。
- Body: `{ device_id, events: [{ event_type, status?, file_name?, file_size?, duration_sec?, stream_protocol?, detail? }] }` — 支持批量(一次上报多条), 也兼容单条。
- 逻辑: parseAvEvent 逐条校验 → createMany → setDeviceOnline。与 property-report/event-report 同模式(不拦截 disabled 设备 —— 与既有 internal 回调行为一致, known issue)。

### 2.3 routes/av.routes.ts(JWT 保护, /api/v1/av/*)

- `GET /api/v1/av/stats` — 统计卡数据。今日窗口 Node 侧算; 用 $queryRaw 汇总(join devices/products 取设备/产品数)。
- `GET /api/v1/av/events` — 分页事件列表。query: event_type(all|recording|snapshot|playback), status(all|success|failed), device_id, keyword(匹配设备名/文件名), page, page_size(默认 20, max 100)。join devices/products 返回 device_name/product_name。orderBy timestamp DESC。
- app.ts 注册 avRoutes。

## 3. 模拟器(tests/sim-device.js 扩展)

- 默认设备列表改为: `['living-room-thermo-01', 'front-door-cam-01', 'back-yard-cam-02']`。
- 名含 `-cam-` 的设备走 `SimCamera` 类:
  - **幂等自注册**: 启动时 list products(page_size=100) 找 `智能摄像头`; 无则 POST /api/v1/products 创建(category: 视频监控, network_type: WiFi)。设备注册 POST register, 409(已存在)则改用 GET 详情拿 deviceId; 成功则直接用返回值。之后上线(internal/mqtt/online)。
  - **周期上报**: 每 tick 按随机权重生成 1 条事件 → POST /api/internal/mqtt/av-report:
    - 45% recording: duration 30~300s, file_size 5~80MB, 协议 RTMP/HLS 随机, 95% success
    - 35% snapshot: file_size 100~500KB, duration 0, 98% success
    - 20% playback: duration 10~600s, file_size 0(回放不产生新存储), 90% success
    - failed 时 detail 里带 error_code/error_msg。
  - 失败事件 status=failed + detail.errorCode, 供页面成功率统计。
- 温控器逻辑不动。**改完后需重启模拟器 job**(tsx watch 只 watch 后端)。

## 4. 前端

### 4.1 client.ts

类型: `AvStats`, `AvEventItem`, `AvEventQuery`; 方法: `getAvStats()`, `getAvEvents(query)`(追加到 api 对象末尾)。

### 4.2 log-service-page.tsx 全量重写(音视频服务)

- 顶部统计卡行: 今日录制 / 今日截图 / 今日回放 / 总存储空间 / 今日回放时长 / 成功率(或事件成功率)。
- 工具栏: 类型 Select(全部/录制/截图/回放) + 状态 Select(全部/成功/失败) + 搜索框(设备名/文件名) + 刷新按钮。
- 事件表格(tc-table): 时间、设备、所属产品、类型(badge: 录制蓝/截图青/回放紫)、文件名(mono)、文件大小(humanize)、时长、协议、状态(badge)。
- react-query useQuery + 骨架屏 + 空态 + 错误重试三件套; 分页(上一页/下一页 + 共 N 条)。
- 类型/状态/搜索变更 → refetch; 30s 自动刷新可选(与 ops 页一致用 refetchInterval)。

## 5. 测试与质量门

- 新增 `backend/src/services/av.service.test.ts`: parseAvEvent(合法/每种类型/非法枚举/负数/截图强制时长0/文件名兜底)、buildFileName、summarizeAvEvents(空集/混合/今日窗口过滤)。
- 质量门: root `npx tsc --noEmit` + `npm run lint` = 0; backend `npm run typecheck` + `npm test` 全过(235+新增)。

## 6. E2E 验收

1. 重启模拟器 → 确认 av_event_logs 有新数据(psql 计数)。
2. 页面: 统计卡数字与 DB 一致; 列表渲染真实事件; 类型/状态筛选、搜索、分页生效; console 0 错误(已归档噪音除外)。
3. curl 验证 /api/v1/av/stats、/api/v1/av/events 响应形状。

## 7. 交付

worklog.md 追加 Task 16 记录 + git commit(feat: ...av service...)。
