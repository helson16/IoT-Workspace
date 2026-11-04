# IoT Explorer Work Log

---
Task ID: 2
Agent: Main Agent
Task: 高保真还原腾讯云 IoT Explorer 控制台

Work Log:
- 使用 VLM 分析 7 张参考截图，提取像素级 UI 规范
- 重写全局 CSS 设计系统（#0052D9 品牌蓝、#232936 侧边栏、#F3F4F6 内容背景）
- 创建 Zustand store 管理客户端路由（12 个页面）
- 构建侧边栏：腾讯云品牌、设备接入子菜单展开、蓝色激活指示器、图标收缩模式
- 构建顶部导航栏：面包屑、Ctrl+K 搜索、通知铃铛、用户头像
- 实现概览页：4 统计卡片（项目3/产品10/设备218/在线133）+ 设备动态时间线 + 2×3 快捷入口网格
- 实现产品管理页：面包屑、搜索框+刷新+导出、表格含协议Badge/在线数绿色高亮
- 实现设备管理页：状态统计栏、全部/在线/离线/未激活 Tab、复选框、状态点
- 实现移动端响应式：汉堡菜单 + 侧边栏滑出 + 半透明遮罩层
- 浏览器验证三个核心页面全部 200 正常渲染

Stage Summary:
- 3 个核心页面像素级还原（概览/产品管理/设备管理）
- 11 个子页面完整实现
- 移动端响应式布局完成
- 设计系统参数：sidebar 200px/#232936, topbar 56px, card border-radius 4px, table header #F7F8FA

---
Task ID: 3
Agent: Main Agent
Task: 物模型解析与设备影子（Device Shadow）系统架构设计

Work Log:
- 读取现有项目状态（Prisma schema 6 模型、11 个 API routes）
- 设计 PostgreSQL DDL 脚本：10 张表（products, devices, thing_model_properties/events/actions, device_shadows, device_property_history, device_event_logs, device_action_logs）+ 自动更新触发器 + 4 条示例产品 + 8 条物模型属性/3 事件/3 行为
- 编写物模型 JSON Schema（draft-07）：支持 10 种数据类型、属性/事件/行为三大类定义，兼容腾讯云协议
- 编写 17 个 JSON 协议交互样例：物模型定义、属性上报/下发/回复、事件上报、行为调用/回复、影子 HTTP/MQTT 完整交互、设备注册/鉴权
- 设计 23 个 REST API 路由：产品 CRUD + 物模型管理、设备注册/鉴权/管理、影子 CRUD、6 个 MQTT 内部回调
- 编写统一响应格式 + 15 个错误码 + 完整安全设计（一机一密 + TLS + 时序攻击防护 + ACL）
- 编写接口与数据流转设计说明：ER 图、影子状态同步时序图、delta 计算逻辑、缓存策略、后续 5 阶段规划

Stage Summary:
- 交付物全部保存至 backend-design/ 目录（4 个主文件 + 17 个 JSON 样例）
- 涵盖数据库设计、物模型协议规范、API 架构、设备影子数据流转、安全认证五大模块
- 技术选型：Fastify 5 + PostgreSQL 15 + EMQX 5 + Redis 7 + Prisma 6

---
Task ID: 4
Agent: Main Agent
Task: Fastify + TypeScript 后端服务骨架搭建与核心接口实现

Work Log:
- 初始化 backend/ 工程目录（package.json 18 依赖、tsconfig ESM+Node16、eslint.config.mjs、.prettierrc）
- Prisma schema 转换：将 schema.sql 的 10 张 DDL 表精确映射为 Prisma schema（9 模型，含所有索引、唯一约束、级联删除）
- config 层：16 个环境变量读取，JWT_SECRET 空值安全检查
- plugins 层：prisma.ts（fp 插件 + $connect/$disconnect 生命周期）、redis.ts（ioredis + 6 个影子/在线状态 helper + module augmentation）
- shared/errors.ts：13 个错误类（IotError 基类 + 40001~50002 全覆盖），toResponse() 统一格式
- shared/crypto.ts：7 个函数（generateDeviceSecret/Id/ProductId、timingSafeEqual、buildMqttClientId/Username/Password）
- shared/response.ts：4 个响应辅助（success/successCreated/paginated/error）+ 3 个接口定义
- shared/validator.ts：ThingModelValidator 类（AJV 校验物模型定义 + 运行时属性值/行为参数校验，支持 10 种数据类型）
- services/product.service.ts：7 个方法（create 含事务物模型拆分、list 分页、getById、update 含物模型替换、delete、getThingModelSnapshot、updateThingModel）
- services/device.service.ts：7 个方法（register 含密钥生成+影子初始化+MQTT配置构建、batchRegister、list omit secret、getByName、deleteByName、updateStatus、authenticate 含 JWT 签发+Redis 在线标记）
- services/shadow.service.ts：6 个方法（getShadow cache-aside、updateDesired 乐观锁+per-key metadata、updateReported 自动清除已满足 desired、clearDesired、getDelta、computeDelta 纯函数）
- routes/product.routes.ts：7 个端点（POST/GET/GET:ID/PUT/DELETE 产品 + GET/PUT 物模型），全部 JSON Schema 校验
- routes/device.routes.ts：6 个端点（register/batch-register/list/get/delete/status）
- routes/auth.routes.ts：2 个端点（设备一机一密认证 + 平台 AppKey/AppSecret Token 签发）
- routes/shadow.routes.ts：4 个端点（GET shadow/PUT desired/DELETE desired/GET delta）
- routes/internal.routes.ts：6 个端点（MQTT 回调：property-report 含物模型校验+历史写入、event-report、action-reply、shadow-update、online、offline），X-Internal-Secret 鉴权
- app.ts：插件注册链（cors→jwt→rateLimit→prisma→redis）+ 三级错误处理（IotError/Fastify validation/catch-all）+ /health
- tsc --noEmit 零错误通过

Stage Summary:
- 18 个源文件、9 个 Prisma 模型、23 个 API 端点完整实现
- TypeScript 严格模式零编译错误
- 三层架构：routes(校验+编排) → services(业务逻辑) → plugins(基础设施)

---
Task ID: 5
Agent: Main Agent
Task: 基础设施搭建、EMQX 认证集成与 E2E 联调脚本

Work Log:
- 编写 docker-compose.yml：PostgreSQL 15 (pgdata volume) + Redis 7 (AOF+LRU) + EMQX 5.8.3 (1883/8883/8083/18083)
- EMQX 通过环境变量配置 HTTP Auth Backend 指向 host.docker.internal:3200/api/internal/mqtt/auth
- 编写 init-infra.sh：Docker 前置检查 → 容器启动 → 健康检查轮询（PG/Redis/EMQX）→ prisma db push → prisma generate → 端口汇总输出
- 添加 EMQX Auth Hook 到 internal.routes.ts：解析 username `{productId}{deviceName};{sdkAppId}` 提取凭据、password 去掉 `;hmacsha256` 后缀、timingSafeEqual 校验密钥、更新设备状态+Redis在线标记、返回 200/401/403/500 给 EMQX
- 编写 tests/mock-device.js：自动获取平台 Token → 创建产品+物模型 → 注册设备 → MQTT 一机一密连接 EMQX → 订阅 3 个下行 Topic → 每 5s 正弦波+噪声温度上报 → 高温告警事件触发 → 属性下发回复 → 行为调用回复 → 影子 delta 同步 → REST Shadow API 演示
- 编写 PHASE3_README.md：架构图、3 步启动流程、6 个手动 API 验证命令、端口凭证汇总表、5 类故障排查、数据流转 8 项检查清单
- tsc --noEmit 零错误

Stage Summary:
- 4 个交付物：docker-compose.yml、init-infra.sh、tests/mock-device.js、PHASE3_README.md
- EMQX HTTP Auth 完整闭环：设备 CONNECT → EMQX → Fastify auth endpoint → DB 密钥校验 → 200/401
- mock-device.js 实现完整设备生命周期：注册 → 认证 → 上报 → 接收指令 → 影子同步

---
Task ID: 6
Agent: Main Agent
Task: 前后端联调 — 前端控制台接入真实后端 API（无 Docker 环境）

Work Log:
- 环境自诊断：本机无 Docker，PG 16 + Redis 7 改用 Homebrew 原生实例（initdb 初始化 + 最简配置启动）；Bun 不可用改用 Node v22 + npm
- 后端 JWT 认证保护：app.ts 新增全局 onRequest hook（放行 /health、/api/v1/auth/*、/api/internal/*，其余 v1 路由强制 Bearer，401 返回 40101）
- 新增 stats.routes.ts：GET /api/v1/stats/overview 聚合产品/设备计数 + 设备动态（event_logs + property_history + lastLoginAt 派生上线事件合并取最近 10 条）
- device.routes.ts 扩展 3 个全局端点：GET /devices（跨产品列表，status/keyword 筛选 + status_counts）、GET /devices/:id（详情）、GET /devices/:id/telemetry（最新遥测）
- product.service.ts 列表增加 deviceCount/onlineCount 聚合
- 编写 backend/prisma/seed.ts：4 产品（温控器/照明灯/网关/工业传感器，含完整物模型）+ 12 设备（6 在线/4 离线/2 未激活）+ 影子初始化
- 前端 API 层 src/lib/api/client.ts：平台 Token 自动获取缓存 + 401 刷新重试一次 + {code,message,data} 统一解包 + 全量类型定义
- 四页面接入真实 API（保持 UI 不变仅换数据源）：概览（10s 轮询）、产品管理（新建产品 Dialog + 删除）、设备管理（注册设备 Dialog + 后端筛选/搜索）、设备详情（5s 轮询遥测 + 影子 desired 下发）；统一 loading/空态/错误重试
- 编写 tests/sim-device.js 设备模拟器：无 EMQX 场景经 internal HTTP 回调模拟设备上线/属性上报（正弦波温湿度）/高温告警事件/离线，数据链路与 EMQX Webhook 完全等价
- tsconfig.json 根目录排除 backend/（避免前后端 Prisma client 类型合并冲突）
- E2E 验证：API 冒烟（token/overview/products/devices/detail/shadow/telemetry 全部 code=0）+ 浏览器视觉验证 7/7 PASS（含 8s 实时数据变化 temperature 24.7→25.9）+ 双端 tsc --noEmit 零错误 + 未认证请求 401 拦截

Stage Summary:
- 数据流转闭环打通：sim-device → internal API → 物模型校验 → 影子/历史表 → 前端轮询渲染
- 设计文档：.ai-docs/designs/frontend-backend-integration-design.md（含 7 项验收标准全部实测 PASS）
- 服务运行：Next.js(:3000) + Fastify(:3200) + PG(:5432) + Redis(:6379) + 模拟器（5s 周期上报）

---
Task ID: 7
Agent: Main Agent
Task: 后端单元测试补齐 + 物模型 Schema 缺陷修复

Work Log:
- 新增 backend/vitest.config.ts（内联空 PostCSS 配置）修复 vitest 启动向根目录搜索 postcss.config.mjs 导致的 "Invalid PostCSS Plugin" 崩溃
- tests/unit/crypto.test.ts（12 用例）：设备密钥/ID 确定性、productId 格式、timingSafeEqual（含长度不等不抛异常）、MQTT clientId/username/password 拼装格式
- tests/unit/validator.test.ts（23 用例）：validatePropertyValues 覆盖 int/float/string/bool/enum/timestamp 六类边界（min/max/非整数/NaN/maxLength/pattern/枚举越界/负时间戳）+ 未知 identifier 忽略 + 多错误聚合；validateDefinition 合法/非法/官方示例回归
- tests/unit/shadow.service.test.ts（15 用例，内存 mock Prisma/Redis）：computeDelta 深比较、updateDesired 合并+版本递增+乐观锁冲突、updateReported 满足 desired 自动清除、getShadow cache-aside 二次命中不查库、clearDesired 重置
- 修复循环 #1 发现并修复 schema 真实缺陷：backend-design/thing-model-schema.json 各 spec oneOf 分支缺少 additionalProperties:false，任意 spec 对象同时匹配多分支导致 validateDefinition 对官方示例（8 属性）100% 失败；为 NumSpec/StringSpec/BoolSpec/EnumSpec/TimestampSpec/StructSpec/ArraySpec 七个分支补充 additionalProperties:false 并添加官方示例+混杂字段两个回归用例
- 修正测试断言：ShadowDocument.version = max(desiredVersion, reportedVersion) 而非单一递增
- 50/50 用例通过；后端 tsc --noEmit 零错误；运行中服务冒烟（health + overview code=0）正常

Stage Summary:
- 测试覆盖三大纯逻辑模块：crypto（凭证）/ validator（物模型校验）/ shadow（影子状态机），共 50 用例
- 发现并修复 validateDefinition 全量拒绝真实负载的 schema oneOf 缺陷（单测核心价值验证）
- npm test 可重复执行，PostCSS 崩溃已消除

---
Task ID: 8
Agent: Main Agent
Task: IDE Problems 面板 18 个诊断清零（tsconfig 孤儿文件误报 + ESLint 修复）

Work Log:
- 定位 18 = 9（backend/tests 被 root 与 backend 两个 tsconfig 同时排除 → IDE 用默认 ES5/CommonJS 选项检查 → TS18028/TS2307/TS1343 误报）+ 4（examples/websocket 与 mini-services/mqtt-service 孤儿文件 socket.io 未装 → TS2307）+ 5（ESLint 3 错误 2 警告）
- 新增 backend/tests/tsconfig.json（extends 主配置 + noEmit + rootDir 提升至 backend/ + 覆盖 exclude 避免父级 "tests" 排除自身），9 个误报清零
- 新增 examples/websocket/tsconfig.json（paths @/* → ../../src/* + types:["node"]）与 mini-services/mqtt-service/tsconfig.json，各配 shims.d.ts 声明 socket.io（遗留演示目录依赖未安装），4 个误报清零
- page.tsx：移动端菜单关闭从 useEffect setState 重构为 React 官方「render 期间调整 state」模式（prevPage 对比），消除级联渲染
- use-mobile.ts：matchMedia 初始化改经 onChange() 回调统一路径
- carousel.tsx（shadcn vendored，无业务引用）：embla 官方模式加精准 eslint-disable 注释
- tests/mock-device.js：移除无用 eslint-disable；修复 JS 文件中的 TS 断言 `value as number` → `Number(value)`；3 处未用 topic 参数改 _topic
- backend/eslint.config.mjs：匿名默认导出改为先赋值变量（消除 import/no-anonymous-default-export 警告）

Stage Summary:
- ESLint 0 问题；root/backend/tests 三个 tsc 项目 + 两个遗留目录 tsc 全部零错误；50/50 单测通过
- 浏览器冒烟：导航切换正常（产品页/设备页 12 行），render 期 state 调整无死循环，console 仅剩 dev HMR 噪音
- 教训：tsconfig exclude 会连带 IDE 孤儿文件误报 — 每个含 TS 的目录都应有归属 tsconfig 或 shim

Follow-up（同日，console 2 错误追查）:
- 实验定性 net::ERR_ABORTED /?_rsc=<id> 与 / 两条错误：Next.js dev 模式 HMR 产物（连续快速保存 → 前一次 Fast Refresh 的 RSC fetch 被中断），非产品缺陷
- 证据链：新标签纯净加载+静置 15s = 0 错误；真实节奏 4 页导航 = 0 错误；连续两次文件编辑 → 错误必现；还原后无新增。生产构建（next build）无 HMR，不存在此问题
- 流程改进（用户要求）：此后每步改动后立即检查 console + IDE 诊断，错误当场定性（缺陷/dev 噪音/工具注入），不积压到任务末尾

---
Task ID: 9
Agent: Main Agent
Task: 物模型管理页面接入真实后端（Task 8 设计文档）

Work Log:
- 前端： store +selectedProductId/setSelectedProductId；client +getThingModel/updateThingModel + 物模型类型；ApiError 补 details 透传（服务端字段级错误可展示）
- 产品列表操作列 +「物模型」入口（FileCode2）
- product-define-page 全量重写： 属性/事件/服务三区块真实数据，spec 按类型渲染（数值范围/枚举项/bool 文案/时间戳单位），新增/编辑共用对话框（数值/字符串/布尔/枚举/时间型动态字段，标识符唯一性+格式 2-64 长度校验），删除确认，loading 骨架/error 重试/empty 引导
- **关键缺陷发现： PUT /thing-model 从未打通** — thing-model-schema.json 用官方字段（id/type/mode/desc），而全链路（DB/GET/seed）用 API 字段（identifier/dataType/accessMode/description），任何合法 PUT 都被 42201 拒绝。前端联调第一步即暴露
- 修复： validator.ts 新增纯函数 toSchemaThingModel（API→Schema 字段适配，spec 原样透传），updateThingModel 校验前转换、存储逻辑不变；+4 单测（54/54 通过），文档化 schema 不校验 min>max 语义（前端负责）
- 浏览器验证（智能照明灯）： 新增（float 0~100%）→ v2；编辑（改名+范围 0~50%）→ v3；删除 → v4 恢复 3 属性；返回列表导航正常；console 0 产品错误

Stage Summary:
- PUT 物模型端点首次端到端打通（version 递增链路验证）
- lint 0 / root tsc 0 / backend tsc 0 / 54 单测通过
- 教训： 端点写完 ≠ 打通，schema 校验的入参风格必须与自家 API 返回风格对齐（或加适配层）
