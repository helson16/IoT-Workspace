# Task 10 设计文档: 设备分组(全栈)

> 目标: 打通「设备分组」三层断链 — 前端页面已有 UI 骨架但请求不存在的 `/api/groups`(无鉴权/路径错误),
> 后端零分组端点, 数据库无分组表。实现 Group CRUD + 设备成员管理, 对齐腾讯云 IoT Explorer「设备分组」。

## 1. 现状与差距

| 层 | 现状 | 目标 |
|----|------|------|
| DB | 无 DeviceGroup 表 | DeviceGroup 表 + Device.groupId FK(SetNull) |
| 后端 | 零端点 | /api/v1/device-groups CRUD + 成员管理 |
| 前端 | device-groups-page 打 `/api/groups`(死端点) | 真实 API + 成员管理对话框 |

## 2. 数据模型 (Prisma)

```prisma
model DeviceGroup {
  id          String   @id @default(cuid())
  name        String   @unique @db.VarChar(64)
  description String?
  color       String   @default("#0052D9") @db.VarChar(16)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  devices     Device[]
  @@map("device_groups")
}
// Device: + groupId String? @map("group_id")
//         + group DeviceGroup? @relation(fields: [groupId], references: [id], onDelete: SetNull)
```

迁移方式: `prisma db push`(dev 环境, 无 migration 文件惯例, 与项目现状一致)。

## 3. 后端 API 契约

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/device-groups | 列表(含 deviceCount, 按 createdAt asc) |
| POST | /api/v1/device-groups | `{ name*, description?, color? }` → name 唯一, color 须 `^#[0-9A-Fa-f]{6}$` |
| PUT | /api/v1/device-groups/:id | 同上字段可选 |
| DELETE | /api/v1/device-groups/:id | 组删除, 设备 groupId 置空(SetNull) |
| GET | /api/v1/device-groups/:id/devices | 组内设备(DeviceItem 列表) |
| PUT | /api/v1/device-groups/:id/devices | `{ device_ids: string[] }` **全量替换**成员 |

- JWT 全局保护(已有 hook 自动覆盖)
- 错误: 40401 组不存在 / 40901 名称重复 / 40001 参数校验
- 新文件: routes/device-group.routes.ts + services/device-group.service.ts, app.ts 注册

## 4. 前端变更

### 4.1 API client
- `DeviceGroup { id, name, description, color, createdAt, deviceCount }`
- api.getDeviceGroups / createDeviceGroup / updateDeviceGroup / deleteDeviceGroup / getGroupDevices / setGroupDevices

### 4.2 device-groups-page.tsx 重写
- **卡片网格**: 色点 + 名称 + 描述 + 设备数 + 操作(编辑/删除/管理设备)
- **新建/编辑对话框**: name* / description / 8 色预设色板(保留现有交互)
- **删除确认**: 提示组内设备将自动解绑
- **成员管理对话框**(核心新增):
  - 左侧: 组内设备列表(设备名/产品/状态, 移除按钮)
  - 底部「添加设备」: 多选未入组设备(搜索过滤) → 批量加入
  - 提交走 PUT devices 全量替换
- loading 骨架 / error 重试 / empty 引导

## 5. 验收标准

1. 新建分组(名称+颜色) → 卡片出现; API 复查持久化
2. 名称重复 → 内联报错(40901)
3. 编辑分组名称 → 卡片更新
4. 添加 2 台设备到组 → 成员列表正确, 设备数 +2
5. 移除 1 台 → 设备数 -1
6. 删除分组 → 卡片消失; 组内设备 groupId 自动置空(设备管理页设备仍在)
7. 每步 console 0 新错误; lint/tsc 0; 后端单测通过

## 6. 范围外(记 follow-up)
- 设备列表页加「分组」列/筛选项
- 分组批量指令下发
