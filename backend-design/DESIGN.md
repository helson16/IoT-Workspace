# 物联网平台 · 第一阶段设计说明

> **物模型解析与设备影子（Device Shadow）系统** · 接口与数据流转设计

---

## 一、系统架构总览

### 1.1 整体分层

```
┌────────────────────────────────────────────────────────────────┐
│                      前端应用层 (Next.js)                       │
│   概览面板 │ 产品管理 │ 设备管理 │ 物模型编辑器 │ 影子调试工具      │
└──────────────────────┬─────────────────────────────────────────┘
                       │ HTTPS / WebSocket
┌──────────────────────┴─────────────────────────────────────────┐
│                    API 网关 / 负载均衡                          │
│              Nginx / API Gateway / Ingress                     │
└──────────────────────┬─────────────────────────────────────────┘
                       │
┌──────────────────────┴─────────────────────────────────────────┐
│                  IoT 后端服务 (Fastify)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │产品管理  │  │设备管理  │  │设备影子  │  │ MQTT消息处理 │   │
│  │Module    │  │Module    │  │Module    │  │ Module       │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │              │                │           │
│  ┌────┴──────────────┴──────────────┴────────────────┴──────┐  │
│  │              共享服务层 (Services)                        │  │
│  │  物模型校验器 │ 密钥生成器 │ MQTT配置构建器 │ 影子计算   │  │
│  └──────────────────────────┬──────────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────┴─────┐         ┌────┴─────┐         ┌────┴─────┐
   │PostgreSQL │         │  Redis   │         │  EMQX 5  │
   │          │         │          │         │ (Broker)  │
   │ 关系数据  │         │ 缓存/状态 │         │ 设备接入  │
   │ 物模型    │         │ 在线标记  │         │ 消息路由  │
   │ 设备影子  │         │ 影子热数据│         │ ACL控制  │
   │ 时序历史  │         │          │         │          │
   └──────────┘         └──────────┘         └────┬─────┘
                                                   │
                                          ┌────────┴────────┐
                                          │    MQTT 设备     │
                                          │ 温控器 / 传感器   │
                                          │ 网关 / 照明灯    │
                                          └─────────────────┘
```

### 1.2 技术选型理由

| 组件 | 选型 | 理由 |
|------|------|------|
| 后端框架 | **Fastify 5** | 启动速度是 Express 的 2-3 倍；内置 JSON Schema 校验与序列化；插件生态成熟；TypeScript 一等公民支持 |
| 数据库 | **PostgreSQL 15+** | JSONB 原生支持物模型灵活存储；GIN 索引加速 JSON 查询；事务完整性保障影子更新原子性 |
| MQTT Broker | **EMQX 5** | 单节点 500 万连接；内置 AuthN/AuthZ HTTP Hook；支持 $share 共享订阅；提供 REST API 管理接口 |
| 缓存 | **Redis 7** | 设备在线状态 O(1) 查询；影子热数据缓存减少 DB 压力；Pub/Sub 支持跨服务实时推送 |
| ORM | **Prisma 6** | 类型安全的数据库访问；与前端项目共享 Prisma Client；Migration 管理成熟 |

---

## 二、数据库设计要点

### 2.1 表关系 ER 图

```
┌──────────────┐       1:N        ┌──────────────┐
│   products   │────────────────>│   devices    │
│              │                  │              │
│ product_id PK│                  │ device_id PK │
│ product_name │                  │ device_name  │
│ category     │                  │ device_secret│
│ auth_type    │                  │ product_id FK│
│ node_type    │                  │ status       │
│ thing_model_ │                  │ last_login_at│
│   version    │                  │ tags JSONB   │
└──────┬───────┘                  └──────┬───────┘
       │                                 │
       │ 1:N                             │ 1:1
       │                                 │
┌──────┴───────────┐           ┌────────┴───────────┐
│thing_model_      │           │  device_shadows    │
│  properties      │           │                    │
│                  │           │ device_id PK/FK    │
│ product_id FK    │           │ reported JSONB     │
│ identifier       │           │ desired JSONB      │
│ name             │           │ reported_version   │
│ data_type        │           │ desired_version    │
│ access_mode      │           │ metadata JSONB     │
│ spec JSONB       │           └────────────────────┘
└──────────────────┘
┌──────────────────┐
│thing_model_      │           ┌────────────────────┐
│  events          │           │device_property_    │
│                  │           │  history           │
│ product_id FK    │           │                    │
│ identifier       │ 1:N       │ device_id FK       │
│ event_type       │<──────────│ identifier         │
│ output_params    │  devices  │ value JSONB        │
└──────────────────┘           │ timestamp          │
                               └────────────────────┘
┌──────────────────┐
│thing_model_      │           ┌────────────────────┐
│  actions         │           │device_action_logs  │
│                  │           │                    │
│ product_id FK    │           │ call_id            │
│ identifier       │           │ device_id FK       │
│ input_params     │           │ action_id          │
│ output_params    │           │ status             │
│ async_flag       │           │ input_params JSONB │
└──────────────────┘           │ output_params JSONB│
                               └────────────────────┘
```

### 2.2 设计决策说明

**为什么物模型采用「关系表 + JSONB spec」混合模式，而非纯 JSON？**

纯 JSON 存储物模型虽然灵活，但无法利用数据库索引进行高效查询。例如「查找所有包含温度属性的产品」这类需求，在纯 JSON 模式下需要全表扫描。采用关系表存储标识符、名称、类型等核心字段，JSONB 存储类型规格（spec），既保证了结构化查询能力，又保留了灵活性。同时，产品表仍保留一份完整的物模型 JSON 副本（`thing_model` 字段，本阶段 DDL 中未显式列出，建议在 Products 表增加此字段），用于前端一次性获取完整定义。

**为什么设备影子单独建表，而非嵌入设备表？**

设备影子是高频读写的热点数据（每次设备上报都更新 reported，每次前端操作都更新 desired）。如果嵌入设备表，任何影子更新都会触发设备整行的 UPDATE，造成不必要的锁竞争和 WAL 写入。单独建表可以：
1. 影子操作与设备元数据操作互不干扰
2. 对影子表使用更细粒度的锁策略
3. 影子数据可以独立做 Redis 热缓存

**为什么 reported_version 和 desired_version 分开？**

reported 由设备上报驱动递增，desired 由云端应用驱动递增。两者更新来源不同，并发冲突场景也不同。分开版本号可以实现更精确的乐观锁控制：
- 更新 desired 时只需校验 `desired_version`
- 更新 reported 时只需校验 `reported_version`
- 完整影子文档的 `version` = `max(reported_version, desired_version)`

### 2.3 索引策略

| 索引 | 类型 | 场景 |
|------|------|------|
| `idx_devices_product_id` | B-Tree | 按产品查设备列表（最高频） |
| `idx_devices_status` | B-Tree | 按状态筛选设备 |
| `idx_devices_tags` | GIN | 按标签搜索设备（JSONB） |
| `idx_tm_props_product` | B-Tree | 按产品加载物模型属性 |
| `idx_prop_hist_device_id_ts` | 复合 B-Tree | 时序查询：设备+属性+时间范围 |
| `idx_shadows_last_reported` | B-Tree | 按最近上报时间排序 |

---

## 三、物模型协议设计

### 3.1 协议格式

物模型数据交互遵循腾讯云 IoT Hub 协议规范，所有 MQTT 消息均为 JSON 格式，包含以下公共字段：

```json
{
  "method": "thing.{type}.{action}",
  "clientToken": "UUID（请求去重）",
  "version": "1.0",
  "params": { /* 业务参数 */ },
  "code": 0,       // 响应时存在
  "msg": "success" // 响应时存在
}
```

### 3.2 Topic 规范

| 方向 | Topic 模板 | 说明 |
|------|-----------|------|
| 设备→云端 | `$thing/up/property/{ProductId}/{DeviceName}` | 属性上报 / 属性设置回复 |
| 云端→设备 | `$thing/down/property/{ProductId}/{DeviceName}` | 属性设置下发 |
| 设备→云端 | `$thing/up/event/{ProductId}/{DeviceName}` | 事件上报 |
| 云端→设备 | `$thing/down/action/{ProductId}/{DeviceName}` | 行为调用下发 |
| 设备→云端 | `$thing/up/action/{ProductId}/{DeviceName}` | 行为调用回复 |
| 设备→云端 | `$shadow/get/{ProductId}/{DeviceName}` | 设备请求获取影子 |
| 云端→设备 | `$shadow/get/accepted/{ProductId}/{DeviceName}` | 影子获取响应 |
| 设备→云端 | `$shadow/update/{ProductId}/{DeviceName}` | 设备上报 reported |

### 3.3 数据类型与校验规则

物模型定义了 10 种数据类型，每种类型在设备上报时需要执行对应的校验逻辑：

| 类型 | 校验规则 |
|------|---------|
| `int` | 必须为整数，且在 spec.min ~ spec.max 范围内 |
| `long` | 同 int，但范围扩大到 64 位 |
| `float` / `double` | 必须为数值，在 min~max 范围内，精度受 step 约束 |
| `string` | 长度不超过 spec.maxLength，可选正则匹配 spec.pattern |
| `bool` | 必须为 0 或 1（整数）或 true/false（布尔） |
| `enum` | 值必须在 spec.enumList 的 value 集合中 |
| `timestamp` | 必须为有效时间戳（秒或毫秒，由 spec.unit 决定） |
| `struct` | 必须为对象，每个 member 按其类型递归校验 |
| `array` | 必须为数组，元素按 itemType 递归校验，长度不超过 spec.maxSize |

### 3.4 物模型校验流程

```
设备上报 JSON
       │
       ▼
┌──────────────┐     失败      ┌──────────────┐
│ 1. JSON 解析  │──────────────>│ 丢弃消息，记录 │
│    语法校验   │              │ 协议层错误日志 │
└──────┬───────┘              └──────────────┘
       │ 通过
       ▼
┌──────────────┐     失败      ┌──────────────┐
│ 2. method     │──────────────>│ 返回错误码    │
│    路由分发   │              │ code=40001    │
└──────┬───────┘              └──────────────┘
       │
       ▼
┌──────────────┐     失败      ┌──────────────┐
│ 3. 加载产品   │──────────────>│ 返回错误码    │
│    物模型定义 │              │ code=40401    │
└──────┬───────┘              └──────────────┘
       │
       ▼
┌──────────────┐     失败      ┌──────────────┐
│ 4. 逐属性校验  │──────────────>│ 记录校验失败  │
│    类型+范围   │              │ 丢弃不合法字段 │
│    (validator) │              │ 保留合法字段  │
└──────┬───────┘              └──────────────┘
       │ 通过
       ▼
┌──────────────┐
│ 5. 写入数据库  │
│    - shadow   │
│    - history  │
└──────────────┘
```

---

## 四、设备影子数据流转

### 4.1 核心概念

设备影子是设备在云端的「虚拟副本」，解决的核心问题是：**设备离线时，云端如何缓存对设备的控制意图，并在设备上线后自动同步？**

影子包含三个状态集合：
- **reported**：设备上报的真实状态（设备是 truth source）
- **desired**：云端期望设备达到的目标状态（应用层是 truth source）
- **delta**：desired 与 reported 的差集，即设备尚未同步的状态（系统计算得出）

### 4.2 状态同步时序图

```
   应用(前端)          IoT后端          EMQX          设备
      │                  │              │              │
      │ 1.PUT /shadows   │              │              │
      │  desired:{temp:22}│             │              │
      │─────────────────>│              │              │
      │                  │              │              │
      │                  │ 2. 更新DB    │              │
      │                  │ 计算 delta   │              │
      │                  │ delta:{temp:22}            │
      │                  │              │              │
      │<─────────────────│              │              │
      │ 3. 返回完整影子    │              │              │
      │  (含delta)        │              │              │
      │                  │              │              │
      │                  │ 4. 推送delta │              │
      │                  │ (如设备在线)  │              │
      │                  │─────────────>│              │
      │                  │              │ 5. MQTT PUBLISH
      │                  │              │ $shadow/get/  │
      │                  │              │ accepted      │
      │                  │              │──────────────>│
      │                  │              │              │
      │                  │              │              │ 6. 设备执行
      │                  │              │              │    temp→22
      │                  │              │              │
      │                  │              │ 7. MQTT PUBLISH
      │                  │              │ $shadow/update│
      │                  │              │ reported:{temp:22}
      │                  │              │<──────────────│
      │                  │              │              │
      │                  │ 8. Webhook   │              │
      │                  │<─────────────│              │
      │                  │              │              │
      │                  │ 9. 更新reported              │
      │                  │    清除desired[temp]        │
      │                  │    delta→{}                 │
      │                  │              │              │
      │ 10. SSE推送      │              │              │
      │  影子已同步      │              │              │
      │<─────────────────│              │              │
```

### 4.3 Delta 计算逻辑

Delta 的计算规则：**遍历 desired 中的每个 key，如果 reported 中不存在该 key，或 reported[key] !== desired[key]，则该 key 属于 delta。**

```typescript
function computeDelta(
  desired: Record<string, any>,
  reported: Record<string, any>
): Record<string, any> {
  const delta: Record<string, any> = {};
  for (const key of Object.keys(desired)) {
    if (
      !(key in reported) ||
      !deepEqual(desired[key], reported[key])
    ) {
      delta[key] = desired[key];
    }
  }
  return delta;
}
```

### 4.4 影子版本控制（乐观锁）

设备影子的每次更新都携带版本号，用于防止并发写入冲突：

- **更新 desired**：请求必须携带 `version`，后端校验 `version === desired_version`，通过后 `desired_version++`
- **更新 reported**（设备回调）：后端校验内部记录的版本，通过后 `reported_version++`
- **返回的 version** = `max(reported_version, desired_version)`

如果版本不匹配，返回错误码 `40902`（影子版本冲突），客户端需要重新获取最新影子后再试。

### 4.5 缓存策略

```
┌─────────────────────────────────────────────────┐
│                 Redis 缓存层                     │
│                                                  │
│  Key: shadow:{device_id}                        │
│  Value: 完整 ShadowDocument JSON                 │
│  TTL: 5 分钟（任意写操作刷新TTL）                 │
│                                                  │
│  写策略: Write-Through                           │
│    - 更新DB → 更新Redis → 返回                   │
│    - 保证DB和Redis强一致                          │
│                                                  │
│  读策略: Cache-Aside                             │
│    - 先读Redis → 命中则返回                       │
│    - 未命中 → 读DB → 写Redis → 返回              │
│                                                  │
│  Key: device:online:{device_id}                  │
│  Value: timestamp                                │
│  TTL: 90 秒（心跳续期）                           │
└─────────────────────────────────────────────────┘
```

---

## 五、一机一密认证流程

### 5.1 密钥生成

```typescript
import { randomBytes, createHash } from 'crypto';

// 设备密钥：32字节随机Hex
function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex'); // 64位hex字符串
}

// 设备ID：productId + deviceName 的 SHA256 前64位
function generateDeviceId(productId: string, deviceName: string): string {
  const raw = productId + '/' + deviceName;
  return createHash('sha256').update(raw).digest('hex').substring(0, 64);
}
```

### 5.2 MQTT 连接认证

设备通过 MQTT CONNECT 报文进行认证：

```
MQTT CONNECT:
  client_id  = {ProductId}{DeviceName};{sdkAppId};{certId};{expiryTs}
  username   = {ProductId}{DeviceName};{sdkAppId}
  password   = {DeviceSecret};hmacsha256
```

EMQX 配置 HTTP Auth Hook，将 CONNECT 请求转发到 IoT 后端进行验证：

```
POST /api/internal/mqtt/auth
{
  "clientid": "prod-a1b2c3d4thermostat-01;12010126;12345;1693046400",
  "username": "prod-a1b2c3d4thermostat-01;12010126",
  "password": "a3f8e2c1...;hmacsha256"
}
```

后端处理：
1. 从 clientid/username 解析出 productId + deviceName
2. 查询数据库获取存储的 device_secret
3. 使用 `crypto.timingSafeEqual()` 常量时间比较 password 中的 secret 部分
4. 返回 `{ result: 'allow' }` 或 `{ result: 'deny' }`

### 5.3 安全要点

| 要点 | 措施 |
|------|------|
| 密钥存储 | DeviceSecret 仅在注册时返回一次，数据库存储时使用 HMAC-SHA256 哈希（或由 EMQX 内置的 bcrypt 管理） |
| 传输安全 | MQTT 强制使用 TLS 1.2+ (port 8883) |
| 时序攻击 | 密钥比较使用 `crypto.timingSafeEqual()` |
| ACL 控制 | EMQX 配置产品级 ACL 规则，设备只能发布/订阅自己ProductId下的 Topic |
| 密钥轮换 | 预留 `PATCH /devices/:id/secret` 接口用于密钥轮换 |

---

## 六、文件清单与交付物索引

```
backend-design/
├── DESIGN.md                              # 本文档：接口与数据流转设计说明
├── schema.sql                             # PostgreSQL DDL 建表脚本（10张表 + 触发器 + 示例数据）
├── thing-model-schema.json               # 物模型定义 JSON Schema（用于 Ajv 校验）
├── api-architecture.md                    # API 接口架构设计（路由表 + 请求/响应 + 错误码）
└── json-payload-examples/                 # 协议交互 JSON 样例
    ├── 01-thing-model-definition.json     # 物模型完整定义示例
    ├── 02-device-property-report.json     # 设备属性上报
    ├── 03-cloud-property-set.json         # 云端属性设置下发
    ├── 04-device-property-set-reply.json  # 设备属性设置回复
    ├── 05-device-event-report.json        # 设备事件上报
    ├── 06-cloud-action-invoke.json        # 云端行为调用下发
    ├── 07-device-action-reply.json        # 设备行为调用响应
    ├── 08-shadow-get-response.json        # HTTP获取设备影子响应
    ├── 09-shadow-update-desired.json      # HTTP更新期望状态请求
    ├── 10-shadow-update-response.json     # 影子更新响应（含delta）
    ├── 11-shadow-mqtt-device-get.json     # MQTT方式设备获取影子
    ├── 12-shadow-mqtt-cloud-reply.json    # MQTT方式云端返回影子
    ├── 13-shadow-mqtt-device-reported.json # MQTT方式设备上报reported
    ├── 14-device-register-request.json    # 设备注册请求
    ├── 15-device-register-response.json   # 设备注册响应（含MQTT配置）
    ├── 16-device-auth-request.json        # 设备鉴权请求
    └── 17-device-auth-response.json       # 设备鉴权响应（含Token）
```

---

## 七、后续阶段规划

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **当前 Phase 1** | 物模型解析 + 设备影子 | — |
| Phase 2 | 数据流转管道（规则引擎 + 时序存储 TDengine） | Phase 1 |
| Phase 3 | 告警中心（告警规则 + 通知渠道 + 告警静默） | Phase 2 |
| Phase 4 | 固件升级（OTA 分包 + 差分升级 + 批量任务） | Phase 1 |
| Phase 5 | 设备分组 + 空间管理 + 权限控制（RBAC） | Phase 1 |