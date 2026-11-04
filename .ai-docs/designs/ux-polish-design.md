# Task 19 设计文档: 控制台体验优化(第 1 轮)

> 日期: 2026-09-28 | 类型: UX 修复与一致性(用户选定方向: 控制台体验优化)

## 0. 审计结论(基于 12 页面横向 grep + 逐点核验)

做得好的(不动): 空态文案/骨架屏/错误重试三件套高度一致; 时间格式统一本地时间; tc-table/tc-badge 类名统一。

发现 3 类真实缺陷:

### P1 概览页快捷入口错乱(overview-page.tsx L53-60, L135-152)
- 「固件升级」: onClick 无对应分支 = **死按钮**(功能也不存在, Task 16 follow-up 已从侧边栏移除该错标)
- 「API Explorer」→ 跳 product-list, **应跳 cloud-dev**(开发中心)
- 「设备日志」→ 跳 log-service, 但该页现已是**音视频服务**, 设备日志实际在 ops-monitor
- 根因: onClick 用 label 字符串匹配分发, 新增/改名页面时无类型约束, 错配无告警

### P2 设备列表无分页(device-list-page.tsx)
- 固定 `page: 1, page_size: 50`, 页脚显示「共 N 条记录」但无翻页控件
- 设备超 50 台时第 51+ 条永久不可见(功能缺口); 其余 4 个表格页(ops/rule-engine/message-queue/log-service)均有分页, 唯独设备管理页缺失

### P3 大数字格式不统一
- ops-monitor/message-queue/rule-engine 统计卡用 `toLocaleString()`(千分位)
- log-service(音视频)统计卡与页脚(数千~数万量级)裸排: `共 2956 条事件` vs ops 的 `共 12,354 条`

## 1. 修复方案

### 1.1 快捷入口数据驱动化(overview-page.tsx)
quickEntries 每项带 `target` 页面 key, onClick 统一 `setCurrentPage(entry.target)`:
| 入口 | target | 说明 |
|---|---|---|
| 新建产品 | product-list | 不变 |
| 注册设备 | device-list | 不变 |
| 物模型定义 | product-define | 替换死按钮「固件升级」 |
| 数据监控 | ops-monitor | 由 device-list 改指监控运维 |
| 消息通信 | message-queue | 替换错配「设备日志」 |
| API Explorer | cloud-dev | 修复错配 |

图标: 物模型定义=FileCode2, 消息通信=MessageSquare(新 import), 其余复用。

### 1.2 设备列表分页(device-list-page.tsx)
- 新增 `page` state, 纳入 queryKey + queryFn; page_size 保持 50(不改变现有密度)
- search/statusFilter 变更时 `setPage(1)`(与 log-service 模式一致); 翻页时清空勾选集(checked 跨页语义混乱)
- 页脚加 上一页/下一页 + `第 x/y 页`(抄 log-service ChevronLeft/Right 模式)

### 1.3 数字千分位(log-service-page.tsx)
- 6 统计卡中今日录制/截图/回放值、事件数 sub、TypePie 头部「共 N 次」、页脚「共 N 条事件」→ `toLocaleString()`

## 2. 验证
- 质量门: root tsc/lint 0; backend 无改动(test 264/264 基线不动)
- E2E: 概览页 6 个入口逐个点击验证落点正确; 设备管理页翻页控件渲染(14 台设备时禁用态)且统计/表格无回归; 音视频页数字千分位显示; console 0 新错误

## 3. 不做的事
- 不重构三件套组件化(现状已一致, 抽象无净收益)
- 不动 product-list 分页(产品数个位数, 客户端过滤已够)
- 不做暗色模式/国际化(超范围)
