# API 接口架构设计

> 第一阶段：物模型解析与设备影子系统 · Node.js / TypeScript 技术栈

---

## 1. 技术选型与项目结构

### 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js 20+ (ESM) | 与前端 Next.js 共享类型系统 |
| 框架 | Fastify 5 | 高性能、Schema 校验内置 |
| ORM | Prisma 6 | 与前端项目统一 |
| 数据库 | PostgreSQL 15+ | JSONB 支持物模型存储 |
| MQTT Broker | EMQX 5 | 设备消息接入层 |
| 缓存 | Redis 7 | 设备在线状态、影子热缓存 |
| 鉴权 | HMAC-SHA256 + JWT | 设备一机一密 + API Token |
| 校验 | JSON Schema (Ajv) | 物模型协议校验 |
| 日志 | pino | 结构化高性能日志 |

### 目录结构

```
backend/
├── src/
│   ├── index.ts                    # Fastify 入口
│   ├── config.ts                   # 环境变量配置
│   ├── app.ts                      # Fastify 实例注册
│   ├── plugins/                    # Fastify 插件
│   │   ├── prisma.ts               # Prisma 客户端插件
│   │   ├── redis.ts                # Redis 客户端插件
│   │   ├── mqtt-client.ts          # EMQX 管理接口客户端
│   │   └── auth.ts                 # API Token 鉴权插件
│   ├── modules/                    # 业务模块（按领域划分）
│   │   ├── product/                # 产品管理
│   │   │   ├── product.service.ts
│   │   │   ├── product.router.ts
│   │   │   ├── product.schema.ts   # Fastify JSON Schema
│   │   │   └── thing-model.service.ts
│   │   ├── device/                 # 设备管理
│   │   │   ├── device.service.ts
│   │   │   ├── device.router.ts
│   │   │   ├── device.schema.ts
│   │   │   └── device-auth.service.ts
│   │   └── shadow/                 # 设备影子
│   │       ├── shadow.service.ts
│   │       ├── shadow.router.ts
│   │       └── shadow.schema.ts
│   ├── mqtt/                       # MQTT 消息处理层
│   │   ├── handler.ts              # EMQX Webhook / MQTT Bridge
│   │   ├── topics.ts               # Topic 常量定义
│   │   ├── property-handler.ts     # 属性上报/下发处理
│   │   ├── event-handler.ts        # 事件上报处理
│   │   ├── action-handler.ts       # 行为调用处理
│   │   └── shadow-handler.ts       # 影子同步处理
│   ├── shared/                     # 共享工具
│   │   ├── errors.ts               # 自定义错误类
│   │   ├── crypto.ts               # 密钥生成、HMAC签名
│   │   ├── validator.ts            # 物模型校验器
│   │   └── mqtt-config-builder.ts  # MQTT连接参数构建
│   └── types/                      # 类型定义
│       └── index.ts                # 共享类型
├── prisma/
│   └── schema.prisma               # 数据库 Schema（复用 backend-design/schema.sql）
├── test/
│   ├── unit/
│   └── integration/
├── tsconfig.json
└── package.json
```

---

## 2. API 路由总览

### 基础路径

```
Production:  https://{api-gateway}/api/v1
Staging:     http://localhost:3200/api/v1
```

### 路由表

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| **产品管理** | | | |
| POST | `/products` | 创建产品 | Platform Token |
| GET | `/products` | 获取产品列表 | Platform Token |
| GET | `/products/:productId` | 获取产品详情 | Platform Token |
| PUT | `/products/:productId` | 更新产品信息 | Platform Token |
| DELETE | `/products/:productId` | 删除产品 | Platform Token |
| PUT | `/products/:productId/thing-model` | 更新物模型定义 | Platform Token |
| GET | `/products/:productId/thing-model` | 获取物模型定义 | Platform Token |
| **设备管理** | | | |
| POST | `/products/:productId/devices/register` | 注册设备（一机一密） | Platform Token |
| POST | `/products/:productId/devices/batch-register` | 批量注册设备 | Platform Token |
| GET | `/products/:productId/devices` | 获取设备列表 | Platform Token |
| GET | `/products/:productId/devices/:deviceName` | 获取设备详情 | Platform Token |
| DELETE | `/products/:productId/devices/:deviceName` | 删除设备 | Platform Token |
| PATCH | `/products/:productId/devices/:deviceName/status` | 变更设备状态 | Platform Token |
| **设备鉴权** | | | |
| POST | `/auth/device` | 设备认证获取连接令牌 | Device Secret |
| POST | `/auth/platform-token` | 获取平台API Token | AppKey/AppSecret |
| **设备影子** | | | |
| GET | `/shadows/:deviceId` | 获取设备影子 | Platform Token |
| PUT | `/shadows/:deviceId` | 更新期望状态(desired) | Platform Token |
| DELETE | `/shadows/:deviceId/desired` | 清除期望状态 | Platform Token |
| GET | `/shadows/:deviceId/delta` | 仅获取差异(delta) | Platform Token |
| **MQTT 内部回调** | | | |
| POST | `/internal/mqtt/property-report` | 设备属性上报回调 | Internal Secret |
| POST | `/internal/mqtt/event-report` | 设备事件上报回调 | Internal Secret |
| POST | `/internal/mqtt/action-reply` | 设备行为调用回复 | Internal Secret |
| POST | `/internal/mqtt/shadow-update` | 设备影子更新回调 | Internal Secret |
| POST | `/internal/mqtt/online` | 设备上线通知 | Internal Secret |
| POST | `/internal/mqtt/offline` | 设备离线通知 | Internal Secret |

---

## 3. 接口详细设计

### 3.1 创建产品

```
POST /api/v1/products
Authorization: Bearer {platform_token}
```

**Request Body:**

```json
{
  "product_name": "智能温控器",
  "category": "智能家电",
  "protocol_type": "MQTT",
  "network_type": "WiFi",
  "data_protocol": "MQTT-JSON",
  "auth_type": "one-machine-one-secret",
  "node_type": "device",
  "description": "支持温度采集与远程控温的智能恒温器",
  "thing_model": { /* 完整物模型JSON，结构见 01-thing-model-definition.json */ }
}
```

**Response (201):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "product_id": "prod-a1b2c3d4",
    "product_name": "智能温控器",
    "category": "智能家电",
    "protocol_type": "MQTT",
    "network_type": "WiFi",
    "auth_type": "one-machine-one-secret",
    "node_type": "device",
    "thing_model_version": 1,
    "status": "active",
    "created_at": "2024-08-25T10:00:00.000Z"
  }
}
```

**业务逻辑:**
1. 校验 `thing_model` JSON 是否符合 `thing-model-schema.json` 规范
2. 生成 `product_id`（格式 `prod-{8位随机hex}`）
3. 将物模型中的 `properties/events/actions` 拆分写入对应的 thing_model_* 表
4. 在 EMQX 中创建产品级 ACL 规则
5. 返回产品信息

---

### 3.2 设备注册（一机一密）

```
POST /api/v1/products/:productId/devices/register
Authorization: Bearer {platform_token}
```

**Request Body:**

```json
{
  "device_name": "thermostat-living-room",
  "tags": {
    "location": "客厅",
    "floor": "1F"
  }
}
```

**Response (201):** 结构见 `15-device-register-response.json`

**业务逻辑:**
1. 校验产品存在且 `auth_type = one-machine-one-secret`
2. 校验 `device_name` 在产品下唯一（仅允许字母、数字、连字符、下划线）
3. 生成 `device_secret`（32字节随机hex，使用 `crypto.randomBytes(32).toString('hex')`）
4. 计算 `device_id` = `SHA256(product_id + "/" + device_name)` 的前64位hex
5. 在 EMQX 中注册设备凭证（username = productId + deviceName, password = deviceSecret）
6. 构建 MQTT 连接参数（client_id, username, topic 列表）
7. 初始化设备影子（空 reported/desired）
8. 返回设备信息 + 凭证 + MQTT 连接配置

**client_id 格式**（兼容腾讯云）:
```
{ProductId}{DeviceName};{sdkAppId};{deviceCertId};{expiryTimestamp}
```

---

### 3.3 设备鉴权

```
POST /api/v1/auth/device
```

**Request Body:** 结构见 `16-device-auth-request.json`

**Response (200):** 结构见 `17-device-auth-response.json`

**业务逻辑:**
1. 根据 `product_id + device_name` 查找设备
2. 比对 `device_secret`（常量时间比较，防时序攻击）
3. 校验设备状态（disabled 的设备拒绝连接）
4. 生成 JWT access_token（payload 包含 device_id, product_id, iat, exp）
5. 在 Redis 中写入在线状态 `device:online:{device_id}` -> TTL = token 有效期
6. 更新 devices 表的 `last_login_at` 和 `status = online`
7. 返回 token + MQTT 连接参数

---

### 3.4 获取设备影子

```
GET /api/v1/shadows/:deviceId
Authorization: Bearer {platform_token}
```

**Response (200):** 结构见 `08-shadow-get-response.json`

**业务逻辑:**
1. 先查 Redis 缓存（key: `shadow:{device_id}`），命中则直接返回
2. 未命中则查 PostgreSQL device_shadows 表
3. 实时计算 `delta = desired - reported`（遍历 desired 的每个 key，对比 reported 中的值）
4. 组装完整影子文档（state.reported + state.desired + state.delta + metadata）
5. 回写 Redis 缓存，TTL = 5 分钟
6. 返回影子文档

---

### 3.5 更新设备影子（期望状态）

```
PUT /api/v1/shadows/:deviceId
Authorization: Bearer {platform_token}
```

**Request Body:** 结构见 `09-shadow-update-desired.json`

**Response (200):** 结构见 `10-shadow-update-response.json`

**业务逻辑:**
1. 乐观锁校验：请求中的 `version` 必须等于数据库中的 `desired_version`
2. 合并新的 desired 到现有 desired（支持部分更新）
3. 重新计算 delta
4. 递增 `desired_version` 和 `version`
5. 更新 metadata 中对应字段的 `desired_ts`
6. 写入 PostgreSQL + 更新 Redis 缓存
7. **关键步骤**：如果 delta 非空，通过 EMQX HTTP API 向设备推送影子更新通知（MQTT 消息到 `$shadow/get/accepted/{ProductId}/{DeviceName}` topic）
8. 返回更新后的完整影子文档

---

### 3.6 清除期望状态

```
DELETE /api/v1/shadows/:deviceId/desired
Authorization: Bearer {platform_token}
```

**Response (200):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "device_id": "prod-a1b2c3d4/thermostat-living-room",
    "version": 9,
    "timestamp": 1692960300000
  }
}
```

**业务逻辑:**
1. 将 desired 重置为 `{}`
2. 递增版本号
3. 清除 Redis 缓存

---

### 3.7 获取差异（仅 delta）

```
GET /api/v1/shadows/:deviceId/delta
Authorization: Bearer {platform_token}
```

**Response (200):**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "device_id": "prod-a1b2c3d4/thermostat-living-room",
    "state": {
      "delta": {
        "target_temperature": 22,
        "power_switch": 0
      }
    },
    "metadata": {
      "desired": {
        "target_temperature": { "timestamp": 1692960200000 },
        "power_switch": { "timestamp": 1692960200000 }
      }
    },
    "version": 8,
    "timestamp": 1692960200000
  }
}
```

---

## 4. MQTT 内部回调接口

这些接口由 EMQX Webhook 或 MQTT Bridge 在设备消息到达时调用，不对外暴露。

### 4.1 设备属性上报回调

```
POST /api/internal/mqtt/property-report
X-Internal-Secret: {configured_secret}
```

**Request Body:**

```json
{
  "device_id": "prod-a1b2c3d4/thermostat-living-room",
  "product_id": "prod-a1b2c3d4",
  "device_name": "thermostat-living-room",
  "payload": {
    "method": "thing.event.property.post",
    "clientToken": "c8a0e5f7-3b21-4d6e-9f12-a8b7c6d5e4f3",
    "version": "1.0",
    "params": {
      "temperature": 25.6,
      "humidity": 60.2,
      "power_switch": 1,
      "working_mode": "cool",
      "fan_speed": "auto",
      "error_code": 0,
      "voltage": 220.3
    }
  }
}
```

**处理流程:**
1. 根据 device_id 查询产品物模型定义（从 thing_model_properties 表）
2. 按物模型定义校验 `params` 中每个属性的数据类型和取值范围
3. 校验通过后，更新 device_shadows.reported（合并，递增 reported_version）
4. 写入 device_property_history 表（时序数据）
5. 重新计算 delta，如果 desired 中有被满足的 key，从 desired 中移除
6. 更新 Redis 缓存和在线时间戳
7. 如果产生了 delta 变化，通过 SSE/WebSocket 推送给前端实时面板

---

### 4.2 设备上线/离线通知

```
POST /api/internal/mqtt/online
POST /api/internal/mqtt/offline
```

**处理流程 (online):**
1. 更新 devices.status = 'online', last_login_at = NOW()
2. 写入 Redis: `device:online:{device_id}` -> timestamp

**处理流程 (offline):**
1. 更新 devices.status = 'offline', last_logout_at = NOW()
2. 删除 Redis 在线标记

---

## 5. 核心服务层代码架构

### 5.1 设备注册服务 (device-auth.service.ts)

```typescript
// ===== 核心方法签名 =====

interface DeviceAuthService {
  /** 注册设备，生成一机一密凭证 */
  registerDevice(params: RegisterDeviceInput): Promise<RegisterDeviceOutput>;

  /** 设备鉴权，返回JWT和MQTT连接参数 */
  authenticateDevice(params: DeviceAuthInput): Promise<DeviceAuthOutput>;

  /** 生成设备密钥 */
  generateDeviceSecret(): string;

  /** 生成设备ID */
  generateDeviceId(productId: string, deviceName: string): string;

  /** 构建MQTT连接配置 */
  buildMqttConfig(device: Device, product: Product): MqttConnectConfig;
}

interface RegisterDeviceInput {
  productName: string;
  deviceName: string;
  productId: string;
  tags?: Record<string, string>;
}

interface RegisterDeviceOutput {
  deviceId: string;
  deviceName: string;
  deviceSecret: string;
  productId: string;
  status: 'not-activated';
  mqttConfig: MqttConnectConfig;
  createdAt: string;
}

interface MqttConnectConfig {
  host: string;
  port: number;
  ssl: boolean;
  clientId: string;
  username: string;
  password: string;
  subscribeTopics: string[];
  publishTopic: string;
}
```

### 5.2 设备影子服务 (shadow.service.ts)

```typescript
// ===== 核心方法签名 =====

interface ShadowService {
  /** 获取完整设备影子 */
  getShadow(deviceId: string): Promise<ShadowDocument>;

  /** 更新期望状态（desired） */
  updateDesired(deviceId: string, desired: Record<string, any>, expectedVersion: number): Promise<ShadowDocument>;

  /** 更新上报状态（reported），由MQTT回调调用 */
  updateReported(deviceId: string, reported: Record<string, any>): Promise<ShadowDocument>;

  /** 清除期望状态 */
  clearDesired(deviceId: string): Promise<void>;

  /** 仅获取delta */
  getDelta(deviceId: string): Promise<ShadowDeltaDocument>;

  /** 计算 delta = desired - reported */
  computeDelta(desired: Record<string, any>, reported: Record<string, any>): Record<string, any>;
}

interface ShadowDocument {
  deviceId: string;
  state: {
    reported: Record<string, any>;
    desired: Record<string, any>;
    delta: Record<string, any>;
  };
  metadata: {
    reported: Record<string, { timestamp: number }>;
    desired: Record<string, { timestamp: number }>;
  };
  version: number;
  timestamp: number;
}
```

### 5.3 物模型校验服务 (validator.ts)

```typescript
// ===== 核心方法签名 =====

interface ThingModelValidator {
  /** 校验完整物模型定义是否符合 Schema */
  validateThingModelDefinition(model: unknown): ValidationResult;

  /** 校验设备上报的属性值是否符合物模型定义 */
  validatePropertyValues(
    productId: string,
    params: Record<string, any>
  ): Promise<ValidationResult>;

  /** 校验行为调用输入参数 */
  validateActionInput(
    productId: string,
    actionId: string,
    inputParams: Record<string, any>
  ): Promise<ValidationResult>;

  /** 获取产品的物模型快照（用于前端渲染面板） */
  getThingModelSnapshot(productId: string): Promise<ThingModelSnapshot>;
}

interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    field: string;
    message: string;
    expected?: string;
    received?: any;
  }>;
}
```

---

## 6. 统一响应格式

### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": { /* 业务数据 */ }
}
```

### 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 150,
    "page": 1,
    "page_size": 20,
    "items": [ /* 列表数据 */ ]
  }
}
```

### 错误响应

```json
{
  "code": 40001,
  "message": "设备名称已存在",
  "details": [
    {
      "field": "device_name",
      "message": "该产品下已存在同名设备"
    }
  ]
}
```

### 错误码表

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| 0 | 200/201 | 成功 |
| 40001 | 400 | 参数校验失败 |
| 40101 | 401 | 未提供认证信息 |
| 40102 | 401 | Token 已过期 |
| 40103 | 401 | 设备密钥错误 |
| 40301 | 403 | 无操作权限 |
| 40401 | 404 | 产品不存在 |
| 40402 | 404 | 设备不存在 |
| 40901 | 409 | 设备名称冲突 |
| 42201 | 422 | 物模型定义不合法 |
| 42202 | 422 | 属性值校验失败 |
| 40902 | 409 | 影子版本冲突（乐观锁） |
| 50001 | 500 | 内部服务错误 |
| 50002 | 500 | MQTT Broker 连接失败 |

---

## 7. 安全设计

### 7.1 一机一密认证流程

```
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────┐
│  开发者   │     │  IoT 后端    │     │  EMQX    │     │   设备   │
│ (Console) │     │  (Fastify)  │     │ (Broker) │     │          │
└────┬─────┘     └──────┬───────┘     └────┬─────┘     └────┬─────┘
     │                   │                  │                │
     │ 1. 注册设备请求    │                  │                │
     │──────────────────>│                  │                │
     │                   │                  │                │
     │                   │ 2. 生成DeviceSecret               │
     │                   │ 注册EMQX凭证     │                │
     │                   │─────────────────>│                │
     │                   │<─────────────────│                │
     │                   │                  │                │
     │<──────────────────│                  │                │
     │ 3. 返回凭证+MQTT配置                  │                │
     │                   │                  │                │
     │ 4. 烧录DeviceSecret到设备             │                │
     │─────────────────────────────────────────────────────>│
     │                   │                  │                │
     │                   │                  │  5. MQTT CONNECT │
     │                   │                  │<───────────────│
     │                   │                  │  (username=productId+deviceName) │
     │                   │                  │  (password=deviceSecret) │
     │                   │                  │                │
     │                   │                  │ 6. 认证通过     │
     │                   │                  │───────────────>│
     │                   │                  │                │
     │                   │  7. Webhook: 在线通知             │
     │                   │<─────────────────│                │
     │                   │                  │                │
```