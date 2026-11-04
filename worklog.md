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
