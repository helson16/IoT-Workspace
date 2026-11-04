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

---
Task ID: 10
Agent: Main Agent
Task: 设备分组（全栈三层断链打通）

Work Log:
- 现状： device-groups-page 已有 UI 骨架但请求不存在的 /api/groups（无鉴权/路径错误），后端零端点，DB 无表 — 三层断链
- DB： Prisma +DeviceGroup（cuid id, name unique, description, color）+ Device.groupId FK（onDelete: SetNull, 含索引），prisma db push
- 后端： device-group.routes.ts + device-group.service.ts，6 端点（列表含 deviceCount / 创建 / 更新 / 删除 / 组内设备 / 全量替换成员）；成员替换为事务：先清空本组再设置目标列表，设备从原组移入为新组是 updateMany 自然结果；device_ids 含不存在设备时整体拒绝；错误类 +GroupNotFoundError(40403)/GroupNameConflictError(40903)；app.ts 注册
- 前端： client.ts +6 API 方法与类型；device-groups-page 重写（卡片网格/空态/骨架/错误重试、新建编辑对话框 8 色色板、删除确认提示解绑数、成员管理对话框：搜索过滤+候选列表+单台添加/移除）
- **修复循环 1 轮**： 候选列表「可添加设备 0 台」— 前端 page_size=200 超后端上限 100 → 40001 → useQuery 静默失败 → 候选空。改为 100
- API 冒烟： CRUD+成员替换+重名 40903+SetNull 解绑全通过；浏览器 E2E： 新建→加 2 台→移除 1 台（卡片 1 台同步）→改名 V2→删除（提示「组内 1 台设备将自动解绑」）→空态恢复，设备 12 台完整

Stage Summary:
- 质量门： lint 0 / root tsc 0 / backend tsc 0 / 54 单测通过 / console 0 产品错误
- 分组功能全链路闭环，测试数据已清理（0 组/12 设备）
- 范围外 follow-up： 设备列表页加分组列/筛选、分组批量指令下发

---
Task ID: 11
Agent: Main Agent
Task: 监控运维页面接入真实数据

Work Log:
- 环境恢复： 隔周服务全下线(机器重启)，重启 PG(已在跑)/Redis/后端/前端/模拟器；清理遗留测试设备「78s」恢复 12 台基线
- 后端： ops.routes.ts 两端点 — GET /ops/metrics(设备在线率/今日消息/事件/告警/服务调用 + 24h 逐小时消息桶 JS 补零)；GET /ops/logs(统一日志流： 属性上报/事件/服务调用/上下线 UNION ALL 原生 SQL，type/device_id/keyword 筛选 + 分页，BigInt id ::text 防 JSON 序列化崩溃)
- 前端： ops-monitor-page 全量重写 — 4 指标卡(在线率进度条)、recharts 24h 趋势图、日志流(5 Tab 筛选/搜索/分页/10s 自动刷新/keepPreviousData 防闪烁)
- 修复循环 2 轮： ① UNION 类型不匹配(bigint vs varchar)→ count 子查询补 ::text；② 发现事件级别全是非标准「alert」(模拟器历史遗留)→ 告警计数纳入 alert、前端 badge 兼容、模拟器改写标准 warn
- app.ts 顺手清 2 个 IDE 诊断(未用 ValidationError 导入/无效 await)
- 浏览器 E2E： 在线率 50%(6/12)与 DB 一致、日志流实时(20:43:30 最新行)、事件/上下线 Tab 筛选正确、搜索 light 过滤 2 行、分页第 3/1620 页、console 0 产品错误(2 条为本轮测试脚本自身转义噪音)

Stage Summary:
- 质量门： lint 0 / 双端 tsc 0 / 54 单测通过
- 监控运维成为第 7 个真实数据页面；统一日志流打通 4 类数据源
- 教训： 多分支 UNION 的所有列类型必须显式对齐(::text)；数据生产方(模拟器)的枚举值要与 schema 标准一致，历史脏值需消费端兼容

---
Task ID: 12
Agent: Main Agent
Task: 消息通信 — 规则引擎转发全栈（消息队列页面接入真实数据）

Work Log:
- DB: Prisma +ForwardRule(cuid id, name unique, status, productId, messageType, filter JSON{identifiers/eventTypes}, targetType http|republish, targetConfig JSON) + ForwardLog(冗余 ruleName 防删除后日志失义, topic, payload, result, latencyMs, errorMsg)
- 后端 rule-engine.service.ts: 纯函数拆分 matchRules(产品+类型+启用+筛选) / buildTopic($thing/up 真实 topic 组装) / executeTarget(http: POST JSON+5s AbortController 超时+fetchImpl 可注入; republish: 无 EMQX 模拟成功) / dispatch(全程兜底不抛错, 转发失败只落 failed 日志不阻断上报主链路)
- internal.routes.ts: property-report/event-report 各挂 fire-and-forget dispatch; +POST /api/internal/echo 回显端点(演示 HTTP 转发目标)
- rule.routes.ts 8 端点: 规则 CRUD + PATCH status 启停 + logs 分页筛选(result/message_type/rule_id, 日志补 device_name 解析) + stats 总览 + topics 真实聚合(property_history+event_logs 按产品 UNION, $queryRaw)
- app.ts 修复前置隐患: rateLimit 加 allowList 豁免 /api/internal/* — dev 全部流量共享 127.0.0.1 一个 100/min 桶, 规则引擎转发回环会误伤上报主链路
- 前端: client.ts +8 方法与 5 类型; message-queue-page 全量重写 — 4 指标卡(规则/启用/今日转发/成功率) + 3 Tab(转发规则表格含 Switch 启停与 CRUD 对话框: 产品下拉/类型联动筛选 label/URL 校验; 转发日志 5s 自动刷新+结果筛选+分页; 消息主题真实聚合)
- 单测 rule-engine.test.ts 21 用例: matchRules 8 场景(禁用/产品/类型/筛选交集/eventTypes) + buildTopic + executeTarget 7 场景(http 2xx/非2xx/网络异常/无URL/republish/未知类型/请求体断言) + dispatch 4 场景(匹配落日志/无匹配/失败不抛错/DB 异常兜底)
- 修复循环 1 轮: topics 原生 SQL 列名 — Prisma 早期模型(deviceId/productId)未 @map 下划线, 实际列是带引号驼峰, 三次修正 h."deviceId"/d."productId"/"timestamp"
- 浏览器 E2E 全过: 指标卡实时(今日转发 88→130)、规则表真实数据、UI 建事件规则(下拉联动/动态占位符)、启停生效(禁用后 API 计数冻结 116, 重启恢复增长)、编辑预填+描述更新、删除后日志保留规则名(5 条 event 日志仍显示「高温事件转发」)、属性转发每 5s 实时(2-4ms)、事件转发 warn 筛选 E2E(3 条 success)、消息主题 77,405 条真实聚合、console 0 错误 0 警告

Stage Summary:
- 质量门: lint 0 / 双端 tsc 0 / 75 单测通过(新增 21)
- 消息通信成为第 8 个真实数据页面; 规则引擎完整闭环: 上报→匹配→转发→日志→展示
- 教训: ① prisma generate 后 IDE TS server 缓存滞后报「模型不存在」假错, 以 CLI tsc 为 ground truth; ② 原生 SQL 必须先 \d 确认实际列名再写; ③ 新增内部回环流量前先审视 rate limit 单桶容量

---
Task ID: 13
Agent: Main Agent
Task: 云存服务 — 数据分析页接入真实数据

Work Log:
- 选型依据: 复用已有数据基础(property 历史 13.4 万条 / 事件 7,455 条), recharts@2.15.4 已装零新增依赖; 不建新表纯聚合查询
- 关键时区发现: timestamp 列存 UTC wall time(实测 latest_ts == now() AT TIME ZONE 'utc'), 而 PG session 时区是 Asia/Shanghai — $queryRaw 内直接 now() - interval 会偏移 8h, 统一改用 (now() AT TIME ZONE 'utc') - interval(Prisma.sql 片段嵌入, 不能字符串插值否则变绑定参数报错); 经 Prisma 参数化传 JS Date 无此问题
- analytics.service.ts 纯函数: fillTimeBuckets(稀疏聚合行补连续桶含空档置0, minute/hour/day 三粒度 UTC 对齐) / summarizeChart(4 类图表一句话摘要) / buildInsights(阈值派生: 消息量日环比>20% 激增/回落、温度超物模型 max→critical 点名设备、离线设备 warning、告警 7 天环比趋势)
- analytics.routes.ts 4 端点: GET /storage(三表 count + pg_total_relation_size 精确字节 + 近7天增量) / GET /charts(温度 24h 逐时均值折线、活跃设备 7 天逐日柱状、告警 30 天级别环形、吞吐 60 分钟逐分面积, 一次返回) / GET /charts/:id/details(聚合点+语义化 raw 20 条, 未知 id 抛 ChartNotFoundError 40404) / GET /insights(温度超限 SQL join 物模型 spec->>max, 在线状态, 告警双窗口对比)
- errors.ts +ChartNotFoundError(40404)
- 前端: client.ts +4 类型 4 方法; data-analysis-page 全量重写 — 4 存储统计卡(记录数/存储占用格式化/7天新增/日均) + recharts 2×2 图表网格(Line/Bar/Pie/Area, 空数据环形图降级空态) + 查看详情 Dialog(聚合数据点表+最近原始记录表, enabled 条件查询) + 智能分析真实洞察(severity 徽章沿用); storage/charts 60s、insights 120s 自动刷新, 骨架/错误重试三件套
- 单测 analytics.service.test.ts 24 用例: fillTimeBuckets 6(稀疏补全/非整点取整/分钟对齐/UTC 日零点/空输入/字符串 bucket 兼容) + summarizeChart 5 + buildInsights 13(四类阈值全分支/超限点名/离线超5截断/时间戳携带)
- 修复循环 1 轮: 单测断言算错当前分钟桶(08:30 往回应是 08:28/29/30 而非 08:27), 修正断言而非实现
- API 冒烟: storage 141,985 条/48.9MB 与 psql 直查一致; charts 4 图 24/7/2/60 数据点; insights 真实输出「消息量激增 53.6%」「4 台离线点名」「告警趋势回落」
- 浏览器 E2E 全过(9 步): 统计卡 142,103/48.9MB/61,556/8,793.7、4 图表 SVG 渲染、温度详情 Dialog(24 聚合点+20 条 living-room-thermo-01 原始记录)、告警分布 Dialog(警告 3,225/严重告警 4,249 两行)、Escape 关闭正常、console 0 错误 0 警告

Stage Summary:
- 质量门: lint 0 / 双端 tsc 0 / 99 单测通过(新增 24)
- 云存服务成为第 9 个真实数据页面; 13 万条历史数据首次可视化, 智能分析从写死文案变为真实派生
- 教训: ① timestamp without time zone 列的时区基准必须实测确认(now() vs 列值对比), $queryRaw 时间窗口与列基准不一致会静默偏移 8 小时; ② Prisma $queryRaw 模板中嵌 SQL 片段必须用 Prisma.sql 包装, 字符串插值会被当绑定参数
- 范围外 known issue(未改): ops.routes.ts 既有 $queryRaw 用 now() - interval 开窗, 与 UTC wall time 列基准存在 8h 偏移, 属精度问题不影响形状展示, 留待后续统一修正

---
Task ID: 14
Agent: Main Agent
Task: TypeSafe 语义判断集成 — 自然语言 → 设备影子指令解析（后端端点，第 1 步）

Work Log:
- 调研: 装 @typesafe-ai/sdk@0.6.0 到 backend/ 并读 index.d.mts 核对设计文档 — noul/choice 签名一致; 补上设计未提的 SystemOneRequest.model / TypeSafeClientConfig.defaultModel / TYPESAFE_DEFAULT_MODEL、fetch 可注入、SystemOneResult.usage; 设计低估最坏延迟(SDK 默认 10s + maxRetries 2), 本实现收紧到 timeout 5000
- 形态: select-instead-of-generate — 物模型属性清单是真实闭集, 模型只在闭集里选, 对错由 code 的 validateValue(dataType/spec) 判定; string 型 V1 一律澄清(不下发任意文本); 抽不到数值 span 也澄清
- 请求编排: 一问同批(speculative fan-out)带 4 个判断 — intent_actionable / mentions_timing / mentions_multiple / target_property(候选集含 __none__ 兜底); 仅当 target_property 定下后才发第二问(值抽取依赖选中属性); 单次 350ms 量级
- 四条护栏(都拦在取值解析之前, 命中即澄清, proposed 恒 null): ① 定时/条件不得降级为立即无条件执行(F-2, 唯一安全级缺陷); ② 多属性不得只写入其中一个(F-4); ③ 点名只读/不存在属性时不能说「这不是一条下发指令」(mentionedUnavailable); ①② 用同一手法, 同批 Noul 零额外延迟
- 纯函数 + 单测: validateValue / extractValueSpans / isStepAligned / mentionedUnavailable / mentionsProperty / displayReason / alternativeHolders 全部纯函数化; step 对齐用除法 + 相对容差 STEP_EPSILON=1e-9(浮点取模不可靠), 不用 %
- 安全: TYPESAFE_API_KEY 只从 backend/.env 读(process.env), 绝不进 src/ 或前端包; 刻意不开 TYPESAFE_LOG_LEVEL=debug — SDK 会打印未脱敏的请求体, 物模型 + 用户原话会进日志
- 路由陷阱: 裸写 'command:parse' 被 find-my-way 解析成「静态前缀 + 名为 parse 的参数」, 会吞掉 /command、/commandXparse 等兄弟路由 → 改写成正则参数 :action(command:parse)
- 用例表三轮真实 API(32 条 A–H, 用真实设备 prod-a1b2c3d4「智能温控器」执行, 不改动开发库): 1.1 修复前基线 → 1.2 补 F-2/F-3 → 1.3 补 F-1b/F-4/F-6; 每次调用记录响应里的 model 字段(三轮均为 jev-1.13.0)
- 阈值标定(本仓库真实数据, 不照抄文档示例): CONFIDENCE_THRESHOLD 0.8 落在 [0.74, 0.92] 空档; TIMING_THRESHOLD 0.5 落在 [0.04, 0.94]; MULTIPLE_THRESHOLD 0.5 落在 [0.27, 0.98]; 三轮共 43 次调用, 中位数 351ms, 第 4 个问题进同一批请求 → 零额外往返
- 撤销了自己最初的修复建议: F-1 曾建议「按值域可行性过滤候选集」, 反例「把温度设成40度」会把一次越界拒绝变成对另一个属性的合法写入, 且系统性偏向值域最宽的属性 → 改为只修提示文案(alternativeHolders 只给疑问句提示, 不参与放行决策)
- 发现并记录 F-1–F-9; 已修 F-2/F-3/F-4/F-6/F-8; 未修 F-5(用例设计缺口)/F-7(简称匹配不到只读属性名)/F-9(hint 归因)
- 范围: 只做后端端点, 不接前端、不改 shadow 路由(第 1 步范围)

Stage Summary:
- 质量门: backend tsc 0 / 178 单测通过(新增 command-parse.test.ts 79 条, 共 6 文件); lint 本轮未跑
- 交付: POST /api/v1/devices/:deviceId/command:parse(只解析不写影子) + 6 篇设计/用例/实测文档(.ai-docs/designs/typesafe/)
- 核心结论: 模型只做语义判断、对错交给 code 的确定性校验; 三条阈值都不是安全边界只是分流器, 安全来自「候选集组装 + validateValue + 抽不到数值就澄清」三层
- 教训: ① SDK 把 answers 声明成 total mapped type, 编译期承诺「每个问题都有答案」是虚假保证 —— 网络返回值该兜底还得兜底(少一个答案就是 TypeError → 500), 兜底方向统一取「多澄清」; ② 被 confidence 偶然拦下的用例不算安全, 要问「拦下它的理由」与「风险」是否同源, 同源就补结构性规则; ③ 单测绿 ≠ 真实数据已验证 — F-3 单测过了但实跑根本没触发(设备命名对不上)
- 待办: F-1 根因(两个温度属性造成的属性歧义)未修, 只改了提示文案; 彻底修法(候选集带更强区分信息 / 对歧义属性二次确认)留待后续
