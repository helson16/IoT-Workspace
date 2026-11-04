# Task 15 设计文档: 开发中心 — API Explorer 在线调试

> 日期: 2026-09-25 | 页面: 侧边栏「开发中心」(cloud-dev key, CloudDevPage)
> 前身: mock 云函数列表页(无真实数据支撑) → 重写为 API Explorer

## 1. 目标

将开发中心从 mock 云函数表演重写为**平台 API Explorer**:
- 左侧 API 分类树: 枚举本服务全部 REST 端点(按域分组)
- 右侧 API 文档面板: 方法/路径/描述/参数说明
- 在线调试: 填参数 → 发送请求 → 展示真实响应(状态码/耗时/响应体)
- 调用历史: 持久化到 PG, 展示最近调用 + 统计

全部数据真实: 目录来自后端静态枚举的真实路由, 调试请求经代理端点真实执行本服务路由, 历史来自真实调用记录。

## 2. 后端设计

### 2.1 数据模型 (Prisma 新增)

```prisma
model ApiInvokeLog {
  id            Int      @id @default(autoincrement())
  apiId         String   @map("api_id") @db.VarChar(64)
  method        String   @db.VarChar(8)
  path          String   @db.VarChar(512)   // 实际请求 URL(含 query)
  statusCode    Int      @map("status_code")
  durationMs    Int      @map("duration_ms")
  requestBody   String?  @map("request_body") @db.Text
  responseBody  String?  @map("response_body") @db.Text  // 截断至 8KB
  truncated     Boolean  @default(false)
  createdAt     DateTime @default(now()) @map("created_at")
  @@index([createdAt(sort: Desc)])
  @@map("api_invoke_logs")
}
```

### 2.2 目录元数据 (api-catalog.service.ts 纯静态 + 纯函数)

```ts
interface ApiParamDoc { name: string; type: string; description: string; example?: string }
interface ApiCatalogEntry {
  id: string;              // "products.list"
  group: string;           // 分组 key: auth|products|devices|shadows|groups|stats|ops|rules|analytics|security|tools|internal
  name: string;            // 中文名
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
  path: string;            // 模板: /api/v1/products/:productId
  description: string;
  invocable: boolean;      // internal 组为 false, 仅文档展示
  pathParams?: ApiParamDoc[];
  queryParams?: ApiParamDoc[];
  bodyExample?: Record<string, unknown>;  // POST/PUT/PATCH 的可编辑初始 body
}
```

分组与条目(共 59):
| 分组 | 条目数 | invocable |
|---|---|---|
| 认证授权 auth | 2 | ✓ |
| 产品管理 products | 7 | ✓ |
| 设备管理 devices | 9 | ✓ |
| 设备影子 shadows | 4 | ✓ |
| 设备分组 device-groups | 6 | ✓ |
| 数据统计 stats | 1 | ✓ |
| 监控运维 ops | 2 | ✓ |
| 消息转发 forward-rules | 8 | ✓ |
| 数据分析 analytics | 4 | ✓ |
| 安全认证 security | 6 | ✓ |
| 调试工具 tools (command:parse) | 1 | ✓ |
| 内部回调 internal (EMQX webhook) | 9 | ✗ 文档展示 |

纯函数:
- `findApiById(catalog, id)` — 定位条目
- `buildInvokeRequest(entry, params)` — path_params 替换(encodeURIComponent) + query_params 白名单过滤拼接 + 校验必填 path 参数齐全 → { method, url, body } ; 缺参抛 ValidationError
- `truncateForStore(text, maxLen)` — 截断 + 标志
- `buildGroupMeta()` — 分组中文名/排序/描述

### 2.3 端点 (api-explorer.routes.ts, JWT 保护)

1. `GET /api/v1/api-explorer/catalog` → { groups: [...], apis: [...], total, invocable_count }
2. `POST /api/v1/api-explorer/invoke`
   - body: `{ api_id, path_params?, query_params?, body? }`
   - 校验: api_id 存在且 invocable; method 取自目录条目(前端不可指定, 防篡改); query 只拼接目录声明的参数名
   - 执行: `fastify.inject({ method, url, headers: { authorization: 透传当前用户 token } })` — 进程内完整生命周期(含目标路由自身的 schema 校验), 无网络开销
   - 递归防护: api-explorer 域自身不在目录 → 天然不可达
   - 记录 ApiInvokeLog(响应体截断 8KB), 返回 `{ status_code, duration_ms, request_url, response_body }`(response_body 为解析后的 JSON 或原始字符串)
3. `GET /api/v1/api-explorer/history?limit=20` → { items: [...], stats: { total_invokes, success_rate, avg_duration_ms } }

### 2.4 安全边界

- 白名单 = 目录 invocable 条目, path/query/body 三层全部按条目声明约束
- inject 透传调用者的 Authorization, 目标路由按自身权限链执行(JWT 保护/参数校验照常)
- internal 域(X-Internal-Secret)不开放调试, 仅文档
- 响应体入库截断 8KB, 防大响应撑爆表

## 3. 前端设计 (cloud-dev-page.tsx 全量重写)

布局(viewport ≥ 1008px):
- 头部: 说明文字 + 统计徽章(API 总数 / 可调试数 / 历史调用数 / 成功率)
- 左栏(~248px): API 分类树, 分组可折叠, 条目显示方法徽章(GET 绿/POST 蓝/PUT 橙/PATCH 紫/DELETE 红)+名称; 顶部搜索框过滤
- 右栏:
  - API 文档卡: 方法徽章 + 路径(等宽字体) + 描述 + 参数表(path/query/body 示例)
  - 调试面板: path 参数输入框 × N, query 参数输入框 × N, POST/PUT/PATCH 显示 body JSON textarea(预填 bodyExample 可编辑)
  - 「发送请求」按钮(loading 态) → 响应区: 状态码徽章(2xx 绿/4xx 橙/5xx 红) + 耗时 + 响应体 JSON pretty-print
  - internal 条目: 调试面板替换为"内部接口不开放在线调试"提示
- 底部: 最近调用历史表(方法/路径/状态码/耗时/时间), invoke 成功后自动刷新, 点击行可跳转选中对应 API

数据流: react-query `['api-catalog']` / `['api-history']`; invoke 为 useMutation, onSuccess 失效 history。

## 4. 质量门

- root: `npx tsc --noEmit` + `npm run lint` = 0
- backend: `npm run typecheck` 0 + `npm test` 全过(新增 api-catalog.service.test.ts)

## 5. 验收 (E2E)

1. 面包屑「云端开发」+ 页面渲染, 目录树 12 分组
2. 选中 GET /api/v1/stats/overview → 发送 → 200 + 响应体含 device_count
3. 选中 GET /api/v1/products → 发送 → 200 + 产品数组(与 DB 一致)
4. 带查询参数: GET /api/v1/devices?page_size=5 → 返回 5 条
5. POST 端点: 注册/统计类安全端点(如 GET security/stats) → 200
6. 错误路径: POST invoke 缺 path 参数 → 400 参数校验错误; 调用不存在 api_id → 404
7. 历史表出现上述调用记录, 状态码/耗时正确, 成功率统计非空
8. internal 分组条目无发送按钮, 显示提示
9. DB: api_invoke_logs 行数与页面历史一致
10. console 0 错误(排除已知 HMR/工具注入噪音)
