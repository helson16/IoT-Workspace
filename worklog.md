# IoT Explorer Work Log

---
Task ID: 1
Agent: Main Agent
Task: 全面搭建 IoT Explorer 项目

Work Log:
- 探索项目目录，发现工作区为空（仅有初始 git commit）
- 搜索 Harness GitHub 环境搭建工具（FabrizioCafolla/harness-coding）作为参考
- 初始化 Fullstack 开发环境（Next.js 16 + Turbopack + shadcn/ui + Prisma）
- 设计并创建 Prisma 数据模型（Device/DeviceGroup/Telemetry/Command/AlertRule/Alert）
- 编写 seed 脚本，生成 14 台设备、4 个分组、3744 条遥测数据、5 条告警规则、3 条告警
- 参考 Harness Coding 模板搭建 DevContainer 环境（.devcontainer/Dockerfile + docker-compose.yml + devcontainer.json）
- 创建 justfile 任务运行器（setup/db-push/seed/mqtt/lint/db-reset）
- 创建 MQTT WebSocket mini-service（端口 3003，模拟 9 种设备指标实时推送）
- 创建 8 个 API 路由（设备 CRUD/遥测查询/指令发送/分组管理/仪表盘统计/告警管理）
- 创建 6 个 IoT 组件（StatsCards/DeviceTable/DeviceDetail/AlertList/GroupPanel/RealtimeFeed）
- 创建 useMQTT 自定义 Hook（Socket.IO 实时数据订阅）
- 浏览器验证：设备列表、设备详情（含 Recharts 趋势图）、告警中心、分组筛选全部正常

Stage Summary:
- 项目从零搭建完成，包含完整的 IoT 设备管理功能
- 技术栈: Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma + Socket.IO + Recharts
- 数据: 14 台模拟设备，3744 条历史遥测数据点
- 实时: MQTT WebSocket 服务每 2 秒推送模拟数据
- 环境工具: DevContainer + justfile（Harness 风格）
