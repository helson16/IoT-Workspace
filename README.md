# IoT Explorer — 物联网设备管理平台

高仿腾讯云 IoT Explorer 的全栈物联网控制台：设备经 **MQTT over TLS** 接入 EMQX，实现物模型管理、设备影子（Device Shadow）、规则引擎转发、自然语言指令下发（TypeSafe）的完整闭环。

**技术栈**：Next.js 14 · Fastify 5 (TypeScript) · PostgreSQL + Prisma · Redis · EMQX 5.8 · MQTT 5

---

## 核心特性

- **设备接入**：一机一密认证（EMQX HTTP Authn）+ 设备级 Topic ACL（HTTP Authorizer）+ TLS 8883（自签 CA，支持明文 1883 回退）
- **物模型**：10 种数据类型的属性/事件/行为定义，JSON Schema 校验（draft-07），上下行全链路校验
- **设备影子**：desired/reported 双状态 + 乐观锁（desiredVersion）+ delta 计算 + Redis 缓存（cache-aside）
- **规则引擎**：HTTP 转发 + MQTT Republish 双通道，占位符模板（`{productId}`/`{deviceName}`），转发日志与延迟统计
- **自然语言指令**：TypeSafe 双 Agent 工作流，自然语言 → 设备影子 desired 指令解析（人工确认后才落影子）
- **实时数据**：设备上下线事件（EMQX 系统事件落库）、遥测历史、事件日志、行为日志、音视频元数据
- **控制台 UI**：12 个页面高保真还原腾讯云控制台，全量接真实 API

## 架构

```mermaid
flowchart TB
    subgraph DEV["设备层 (ESP32 / 模拟器 tests/sim-device.js)"]
        D1["温控器 / 摄像头等设备<br/>一机一密: username {p}{n};{sdkAppId}<br/>password {secret};hmacsha256"]
    end

    subgraph EMQX["EMQX 5.8 (brew, 8883 TLS / 1883 明文)"]
        L["Listeners<br/>ssl:default @8883 (自签 CA)<br/>tcp:default @1883"]
        AU["HTTP Authentication<br/>POST /api/internal/mqtt/auth"]
        AC["HTTP Authorization (设备级 ACL)<br/>POST /api/internal/mqtt/acl"]
        DI["数据集成 Actions + Rules<br/>property / event / av / online / offline"]
        RE["规则引擎 Republish<br/>(平台侧转发目标)"]
        L --> AU
        L --> AC
        L --> DI
    end

    subgraph BE["后端 Fastify 5 (:3200)"]
        IR["Internal Routes (X-Internal-Secret)<br/>auth / acl / property-report / event-report<br/>av-report / online / offline / shadow-update"]
        SRV["13 Services<br/>device / shadow / rule-engine / security<br/>analytics / av / command-parse(TypeSafe) ..."]
        EB["EmqxBridge<br/>管理 API 发布下行"]
        IR --> SRV
        SRV --> EB
    end

    subgraph DATA["数据层"]
        PG[("PostgreSQL 15<br/>15 张表 / Prisma 6")]
        RD[("Redis 7<br/>影子缓存 / 在线状态")]
    end

    subgraph FE["前端 Next.js 14 (:3000)"]
        UI["12 页面控制台<br/>Zustand 客户端路由 / 10s 轮询"]
        TS["TypeSafe 指令 Dialog<br/>自然语言 → 影子 desired"]
    end

    D1 -- "mqtts 连接 + 上行发布<br/>$thing/up/property|event/{p}/{n}<br/>$shadow/update/{p}/{n}<br/>$av/up/event/{p}/{n}" --> L
    DI -- "HTTP 回调" --> IR
    EB -- "下行推送<br/>$shadow/get/accepted/{p}/{n}" --> D1
    SRV --> PG
    SRV --> RD
    AU -.-> IR
    AC -.-> IR
    UI -- "REST API (Bearer platform token)" --> SRV
    TS -- "指令解析 / 影子更新" --> SRV
    RE -. "republish 转发" .-> L
```

**Topic 体系**：

| 方向 | Topic | 说明 |
|---|---|---|
| 上行 | `$thing/up/property/{p}/{n}` | 属性上报 |
| 上行 | `$thing/up/event/{p}/{n}` | 事件上报（含高温告警） |
| 上行 | `$shadow/update/{p}/{n}` | 影子 reported 更新 |
| 上行 | `$av/up/event/{p}/{n}` | 音视频元数据 |
| 下行 | `$thing/down/property/{p}/{n}` | 属性设置 |
| 下行 | `$thing/down/action/{p}/{n}` | 行为调用 |
| 下行 | `$shadow/get/accepted/{p}/{n}` | 影子 desired 通知 |

`{p}` = productId（13 字符），`{n}` = deviceName。ACL 规则：设备只能发布自己的 4 个上行 topic、订阅自己的 3 个下行前缀；非设备客户端（如 dashboard）走 EMQX file source 兜底放行。

## 快速开始（macOS / Homebrew）

### 0. 基础依赖

```bash
brew install postgresql@15 redis emqx/binary/emqx   # EMQX 5.8.x（注意: 5.9+ 转 BUSL）
brew services start postgresql@15 redis emqx
npm install && cd backend && npm install && cd ..
```

### 1. 数据库

```bash
createdb iot_explorer
cd backend
npm run db:push        # Prisma 同步 15 张表
npm run db:seed        # 4 产品 + 12 设备 + 物模型示例数据
cd ..
```

### 2. EMQX 一键配置（认证 / ACL / 数据集成 / TLS 证书）

```bash
cd backend
npx tsx --env-file=.env tools/emqx-setup.mts
# 幂等可重跑；含 --rollback-acl 回滚 ACL 配置
```

该脚本完成：HTTP 认证源 → 数据集成 connector/actions/rules（消息转发后端）→ 管理 API Key → HTTP ACL authorizer + 链顺序 → 自签 CA/服务端证书（`backend/.certs/`）+ TLS listener（8883）。

### 3. 配置环境变量

根目录 `backend/.env`（参照 [backend-design/api-architecture.md](backend-design/api-architecture.md)），关键项：

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iot_explorer?schema=public
JWT_SECRET=<必填>
APP_KEY=<必填, 自定义标识>
APP_SECRET=<必填, openssl rand -hex 32 生成, 与根目录 .env.local 保持一致>
INTERNAL_SECRET=<必填, openssl rand -hex 24 生成>  # EMQX 回调密钥
EMQX_API_KEY / EMQX_API_SECRET          # emqx-setup.mts 生成
MQTT_BROKER_PORT=8883
MQTT_BROKER_SSL=true
```

### 4. 启动

```bash
# 终端 1: 后端 (:3200)
cd backend && npm run dev

# 终端 2: 前端 (:3000)
npm run dev

# 终端 3: 设备模拟器 (mqtts 3 设备持续上报)
node tests/sim-device.js                # 明文回退: MQTT_URL=mqtt://localhost:1883 node tests/sim-device.js
```

打开 http://localhost:3000 — 概览页 10s 轮询可见实时设备数据。

## 项目结构

```
├── src/                          # Next.js 前端
│   ├── components/tencent/pages/ # 12 个控制台页面
│   └── lib/api/                  # 平台 Token 管理 + API client
├── backend/
│   ├── src/routes/               # 14 个路由模块 (65 个端点)
│   ├── src/services/             # 13 个业务服务
│   ├── src/shared/               # 错误码 / crypto / 物模型校验器
│   ├── prisma/                   # schema (15 模型) + seed
│   ├── tests/unit/               # 302 个单测 (vitest)
│   └── tools/emqx-setup.mts      # EMQX 一键配置脚本
├── tests/sim-device.js           # 设备模拟器 (MQTT/HTTP 双模式)
├── backend-design/               # 架构设计文档 + DDL + 17 个协议样例
└── docker-compose.yml            # PG + Redis + EMQX (可选 Docker 方案)
```

## 质量与测试

```bash
cd backend
npm run typecheck   # tsc 零错误
npm test            # vitest: 302 用例全过
npm run lint        # ESLint
```

覆盖：物模型校验、影子 delta/乐观锁、ACL 规则（17 用例）、规则引擎（26 用例）、指令解析等核心模块。

## 文档索引

- [backend-design/](backend-design/) — 架构设计（API 规范 / DDL / 物模型 JSON Schema / 17 个协议交互样例）
- [PHASE3_README.md](PHASE3_README.md) — 基础设施启动与故障排查
- [worklog.md](worklog.md) — 24 个 Task 的完整开发日志（需求 → 方案 → 验证 → 提交）

## 已知限制与路线图

- [ ] **EMQX 生命周期**：brew formula 2026-11-30 后 disable（5.9+ 转 BUSL），需 pin 5.8.8 或迁移方案
- [ ] 进程守护（launchd/pm2）— 当前为手动前台/后台进程
- [ ] 多用户与角色体系 — 当前仅全局 app_key
- [ ] CI/CD — 质量门暂为手工执行
- [ ] mTLS 双向认证、1883 明文口收口
- [ ] 规则引擎 action 下行调用链路
