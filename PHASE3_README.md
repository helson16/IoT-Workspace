# Phase 3: 基础设施搭建与 E2E 联调指南

> 本文档描述如何拉起本地基础设施（PostgreSQL / Redis / EMQX）、迁移数据库、启动后端服务，并运行模拟设备完成端到端联调。

---

## 架构总览

```
┌──────────────┐     HTTP      ┌──────────────────┐     HTTP Auth     ┌──────────┐
│  mock-device │─────────────>│  Fastify Backend  │<────────────────│   EMQX   │
│  (tests/)    │              │  :3200            │                  │  :1883   │
│              │              │                   │                  │          │
│              │  MQTT TLS    │  ┌─────────────┐  │                  │  Dashboard│
│              │<────────────>│  │ EMQX Auth   │  │──────────────────│  :18083  │
└──────────────┘              │  │ Hook        │  │                  └──────────┘
                              │  └─────────────┘  │
                              │  ┌─────────────┐  │
                              │  │ Shadow      │  │     ┌──────────┐
                              │  │ Service     │  │     │  Redis   │
                              │  └──────┬──────┘  │────>│  :6379   │
                              │         │         │     └──────────┘
                              │  ┌──────┴──────┐  │
                              │  │ Prisma ORM  │  │     ┌──────────┐
                              │  └──────┬──────┘  │────>│ PostgreSQL│
                              └─────────┼────────┘     │  :5432   │
                                        │              └──────────┘
```

---

## 前置条件

| 工具 | 版本 | 检查命令 |
|------|------|----------|
| Docker | 24+ | `docker --version` |
| Docker Compose | v2 | `docker compose version` |
| Node.js | 20+ | `node --version` |
| npm | 10+ | `npm --version` |

---

## Step 1: 一键拉起基础设施

```bash
# 在项目根目录执行
bash init-infra.sh
```

该脚本会自动完成：
1. 拉起 PostgreSQL 15 + Redis 7 + EMQX 5.x 三个容器
2. 等待所有容器通过健康检查
3. 执行 `prisma db push` 将 9 个模型同步到 PostgreSQL
4. 生成 Prisma Client

成功后输出：
```
========================================
  IoT Explorer Infrastructure Ready!
========================================

  PostgreSQL:  localhost:5432  (postgres/postgres / iot_explorer)
  Redis:       localhost:6379
  EMQX MQTT:   localhost:1883  (TCP)
  EMQX SSL:    localhost:8883  (TLS)
  EMQX WS:     localhost:8083  (WebSocket)
  EMQX Dash:   http://localhost:18083  (admin / public123)
```

**常用管理命令：**
```bash
bash init-infra.sh --stop    # 停止容器（保留数据）
bash init-infra.sh --reset    # 停止并清除所有数据卷
```

---

## Step 2: 启动后端服务

```bash
cd backend
cp .env .env.local   # 可选: 修改配置
npm run dev
```

服务启动后监听 `http://localhost:3200`。验证健康检查：

```bash
curl -s http://localhost:3200/health | jq
# { "status": "ok", "timestamp": 1700000000000 }
```

---

## Step 3: 验证 EMQX 认证集成

EMQX 的 HTTP Auth 后端已配置指向 `http://host.docker.internal:3200/api/internal/mqtt/auth`。

**验证流程：**

1. 打开 EMQX Dashboard: http://localhost:18083 (admin / public123)
2. 进入 **Authentication** → **Password Based** → **HTTP**
3. 确认配置项：
   - URL: `http://host.docker.internal:3200/api/internal/mqtt/auth`
   - Method: POST
   - Headers 包含 `X-Internal-Secret: dev-internal-secret`

**未注册设备连接测试（应被拒绝）：**

```bash
# 使用错误的凭证连接 — 应该被 EMQX 拒绝
mosquitto_sub \
  -h localhost -p 1883 \
  -i "fake-device" \
  -u "prod-xxxxxxxxfake;12010126" \
  -P "fakesecret;hmacsha256" \
  -t "test/topic" \
  -v
# 预期输出: Connection refused: Not authorized
```

---

## Step 4: 运行模拟设备 E2E 联调

### 4.1 启动模拟设备

```bash
# 确保后端服务正在运行 (Step 2)
# 然后在新终端执行:
node tests/mock-device.js
```

### 4.2 预期执行流程

```
[10:00:00.000] [AUTH]   Getting platform token...
[10:00:00.050] [AUTH]   Token obtained

[10:00:00.100] [PRODUCT] Creating smart thermostat product...
[10:00:00.300] [PRODUCT] Product created (productId: prod-a1b2c3d4)

[10:00:00.350] [DEVICE]  Registering device...
[10:00:00.500] [DEVICE]  Device registered (secret: a3f8e2c1...)

[10:00:00.550] [MQTT]   Connecting to mqtt://localhost:1883...
[10:00:01.200] [MQTT]   Connected to EMQX successfully!
[10:00:01.250] [MQTT]   Subscribed to 3 topics
 10:00:01.250] [MQTT]     → $iot/prod-a1b2c3d4dev-xxx/property/down
[10:00:01.250] [MQTT]     → $iot/prod-a1b2c3d4dev-xxx/action/down
[10:00:01.250] [MQTT]     → $iot/prod-a1b2c3d4dev-xxx/shadow/accepted

[10:00:06.300] [REPORT] #1 temp=24.3°C humidity=58.1%
[10:00:11.300] [REPORT] #2 temp=23.8°C humidity=62.4%
[10:00:16.300] [REPORT] #3 temp=25.1°C humidity=55.7%
```

### 4.3 自定义参数

```bash
# 指定后端 API 地址和 MQTT Broker
API_BASE=http://192.168.1.100:3200 MQTT_HOST=192.168.1.100 node tests/mock-device.js
```

---

## Step 5: 手动验证 API

以下命令可在后端运行期间执行，验证各接口工作正常。

### 5.1 获取平台 Token

```bash
curl -s -X POST http://localhost:3200/api/v1/auth/platform-token \
  -H 'Content-Type: application/json' \
  -d '{"app_key":"iot-explorer-app-key","app_secret":"iot-explorer-app-secret"}' | jq
```

### 5.2 查看产品列表

```bash
TOKEN=$(curl -s -X POST http://localhost:3200/api/v1/auth/platform-token \
  -H 'Content-Type: application/json' \
  -d '{"app_key":"iot-explorer-app-key","app_secret":"iot-explorer-app-secret"}' | jq -r '.data.access_token')

curl -s http://localhost:3200/api/v1/products \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 5.3 查看设备列表

```bash
curl -s "http://localhost:3200/api/v1/products/{productId}/devices" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 5.4 查看设备影子

```bash
curl -s "http://localhost:3200/api/v1/shadows/{deviceId}" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 5.5 更新影子期望状态（触发设备同步）

```bash
curl -s -X PUT "http://localhost:3200/api/v1/shadows/{deviceId}" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"target_temperature":18,"power_switch":0}},"version":3}' | jq
```

执行后观察 mock-device.js 终端，设备应收到影子 delta 并回复 reported 状态更新。

### 5.6 查看 EMQX 在线设备

在 EMQX Dashboard 中：
1. 进入 **Clients** 页面
2. 可看到已连接的设备 client_id
3. 进入 **Subscriptions** 页面查看设备订阅的 Topic

---

## 端口与凭证汇总

| 服务 | 地址 | 凭据 |
|------|------|------|
| Fastify Backend | `http://localhost:3200` | — |
| PostgreSQL | `localhost:5432` | postgres / postgres (DB: iot_explorer) |
| Redis | `localhost:6379` | 无密码 |
| EMQX MQTT | `localhost:1883` | 一机一密（设备注册时获取） |
| EMQX Dashboard | `http://localhost:18083` | admin / public123 |
| 内部 Webhook Secret | Header: `X-Internal-Secret` | `dev-internal-secret` |

---

## 故障排查

### EMQX 连接失败 (Not Authorized)

1. 确认后端服务正在运行 (`curl localhost:3200/health`)
2. 检查 docker-compose 中 `EMQX_AUTHENTICATION__1__HTTP__URL` 是否指向 `host.docker.internal:3200`
3. 检查 `.env` 中 `INTERNAL_SECRET` 是否与 docker-compose 中的 `X-Internal-Secret` 一致
4. 查看 Fastify 日志中是否有 `EMQX auth: device not found` 或 `secret mismatch`

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
docker exec iot-postgres pg_isready -U postgres

# 手动连接
docker exec -it iot-postgres psql -U postgres -d iot_explorer -c "\dt"
```

### Prisma 迁移失败

```bash
cd backend
npx prisma db push --force-reset   # 强制重置（清除所有数据）
npx prisma generate
```

### Redis 连接失败

```bash
docker exec iot-redis redis-cli ping
# 应返回 PONG
```

---

## 数据流转验证检查清单

完成 E2E 联调后，逐项确认以下数据流转已打通：

- [ ] **设备注册**: `POST /api/v1/products/:id/devices/register` 返回 MQTT 连接配置
- [ ] **EMQX 认证**: 设备使用返回的 clientId/username/password 连接 MQTT 成功
- [ ] **属性上报**: 模拟设备每 5 秒发布属性，后端日志显示收到
- [ ] **影子同步**: `GET /api/v1/shadows/:id` 返回最新的 reported 状态
- [ ] **期望下发**: `PUT /api/v1/shadows/:id` 设置 desired，设备收到 delta 并同步
- [ ] **属性历史**: 多次上报后，时序数据写入 `device_property_history` 表
- [ ] **事件上报**: 温度超 30°C 时触发高温告警事件
- [ ] **EMQX Dashboard**: 可在 Clients 页面看到在线设备