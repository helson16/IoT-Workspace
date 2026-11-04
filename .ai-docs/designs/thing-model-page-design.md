# Task 8 设计文档: 物模型管理页面接入真实后端

> 目标: 将 `product-define-page.tsx`(纯 mock)接入后端 `GET/PUT /api/v1/products/:productId/thing-model`,
> 实现属性/事件/服务的真实展示与属性级 CRUD, 对齐腾讯云 IoT Explorer「产品定义」页布局。

## 1. 现状与差距

| 项 | 现状 | 目标 |
|----|------|------|
| 页面数据 | 硬编码 5 条 mock 属性 | GET thing-model 快照(properties/events/actions) |
| 产品上下文 | 硬编码标题「智能温湿度传感器」 | 从产品列表跳入, store 记录 selectedProductId |
| 新增属性 | 对话框确定无 onSubmit | 提交 PUT 全量更新 |
| 编辑/删除 | 按钮无 handler | 行内编辑对话框 + 删除确认 |
| API client | 无 thing-model 方法 | +getThingModel/updateThingModel |

## 2. 后端契约(已存在, 不改动)

- `GET /api/v1/products/:id/thing-model` → `{ productId, version: number, properties[], events[], actions[] }`
  - property: `{ id, productId, identifier, name, dataType, accessMode, description, spec, required, sortOrder }`
  - event: `{ ..., eventType: 'info'|'warn'|'error', outputParams[] }`
  - action: `{ ..., asyncFlag, callStrategy, inputParams[], outputParams[] }`
- `PUT /api/v1/products/:id/thing-model` body: `{ version: "1.0"(协议版本, ^\d+\.\d+$), properties, events, actions }`
  - 全量替换子表; DB thingModelVersion 自动 increment(快照版本, 非乐观锁)
  - validateDefinition 校验: spec 按 dataType 匹配 oneOf(数值 min/max/step/unit | enum enumList | bool 0/1 映射 | string maxLength | timestamp format)

## 3. 前端变更

### 3.1 store (`app-store.ts`)
- +`selectedProductId: string | null`, +`setSelectedProductId(id)` → 跳转 product-define 页

### 3.2 API client (`client.ts`)
- 类型: `ThingModelProperty/Event/Action/ThingModelSnapshot`
- `api.getThingModel(productId)`, `api.updateThingModel(productId, body)`

### 3.3 产品列表 (`product-list-page.tsx`)
- 操作列「更多」占位按钮 → 「物模型」入口(FileCode2 图标), 点击 setSelectedProductId(p.productId)

### 3.4 物模型页 (`product-define-page.tsx`) 全量重写
- **头部**: 产品名 + productId + 属性/事件/服务计数 + 「新增属性」按钮
- **属性表**: 名称 / 标识符(code) / 数据类型(彩色 badge) / 取值范围(spec 按类型渲染) / 读写 / 描述 / 操作(编辑+删除)
  - spec 渲染: 数值型 `-40 ~ 85 °C · 步长 0.1`; enum 展示前 3 个枚举项 + 「N 项」; bool `0=关 1=开`; string `≤255 字符`
- **事件表**: 名称 / 标识符 / 事件类型 badge(info 蓝/warn 橙/error 红) / 触发参数 / 描述
- **服务表**: 名称 / 标识符 / 调用方式(同步/异步) / 入参/出参数 / 描述
- **新增/编辑对话框**(共用): name*, identifier*(唯一性校验), dataType, accessMode, 数值型→min/max/step/unit, enum→枚举项编辑(≥1 项), bool→0/1 映射文案, description
- **提交**: 取当前快照 → 数组替换/追加 → PUT(version 固定 "1.0") → invalidate refetch
- **状态**: loading(骨架) / error(重试) / empty(引导新增) / mutation pending(按钮 loading) / 服务端 400 错误展示(字段级)

## 4. 验收标准

1. 产品列表点「物模型」→ 进入对应产品物模型页, 属性/事件/服务三区块渲染真实数据(智能温控器 6 属性 1 事件 1 服务)
2. 新增属性(含数值范围) → 表格新行出现 → GET 复查持久化
3. 编辑属性(改名称/范围) → 表格更新
4. 删除属性 → 确认后行消失
5. 标识符重复提交 → 对话框内联报错, 不发请求
6. 每步操作后 console 0 新错误, lint/tsc 0 问题
