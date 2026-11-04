# Task 17 设计文档: 修复 2 个记录在案的 known issue

> 日期: 2026-09-26 | 类型: 缺陷修复(用户已批准)

## Issue 1: ops.routes.ts 的 8h 时间窗口偏移

**根因**(DB 实验已证实, 2026-09-26):
- `device_property_history.timestamp` 等列存 **UTC wall time**(max_ts 04:40:53 与 `now() AT TIME ZONE 'utc'` 04:40:55 一致)
- PG session 时区 = Asia/Shanghai → raw SQL 里 `now() - interval '24 hours'` 的 now() 是 timestamptz, 比较时按 session 时区取**本地 wall time**(12:40), 与列的 UTC wall time(04:40) 相差 8h
- 实测: buggy 窗口 14478 条 vs 正确窗口 27522 条, **漏掉 13044 条(约 8 小时数据)** → 监控运维页 24h 消息趋势图左侧 8 小时恒为空

**范围**: 全后端 grep 仅 1 处遗漏 — [ops.routes.ts](../../backend/src/routes/ops.routes.ts) L47(hourly_messages 查询)。analytics.routes.ts 已在 Task 13 用 `Prisma.sql\`(now() AT TIME ZONE 'utc')\`` 修复; Node 侧 todayStart + Prisma where 的模式无偏移(Prisma 发送 UTC ISO, 与列的 UTC wall time 语义一致, 已被 av stats 验证)。

**修复**: L47 `WHERE timestamp >= now() - interval '24 hours'` → `WHERE timestamp >= (now() AT TIME ZONE 'utc') - interval '24 hours'`。hour bucket 的 `date_trunc('hour', timestamp)` 对 UTC wall time 截断本身正确, 不动。

## Issue 2: internal 回调不拦截 disabled 设备

**现象**: 被禁用的设备若仍活跃, online/property-report 等回调会把它置回 online、继续写历史数据 —— 与 EMQX auth hook(已拒 disabled, 403)语义矛盾, 属安全域缺陷。

**修复点**(internal.routes.ts 全部 7 个 mqtt 回调):

| 端点 | 现行为 | 修后 |
|---|---|---|
| property-report / event-report / av-report / action-reply / shadow-update / online | 不拦 | 设备存在且 disabled → 403 ForbiddenError(40301, 与 EMQX auth 一致) |
| offline | 覆盖 status='offline' | disabled 设备**不被覆盖**(保持 disabled), Redis 在线清除照做 |

**设备不存在的容忍行为保持现状**(online 回调原有 catch-ignore, EMQX webhook 乱序场景), 即: 查不到设备 → 不拦, 由后续逻辑自然处理。

**实现**: 纯函数 `shouldBlockCallback(deviceExists: boolean, status: string): boolean`(internal.routes.ts 内) + 每 回调前 `SELECT status FROM devices WHERE deviceId` 一次判断; offline 的 update 加 `AND status != 'disabled'` 条件(updateMany where)。

## 验证计划

1. 单测: shouldBlockCallback 4 用例(不存在/disabled/online/offline)。
2. curl: psql 禁用 hallway-thermo-04(offline 态, 不影响模拟器) → online/property-report 403 + DB 状态仍 disabled → offline 回调后状态不被覆盖 → 恢复原状态。
3. E2E: 监控运维页 24h 趋势图 24 个桶都有数据(修复前左侧 8 桶恒空) + 页面无回归; console 0 新错误。
4. 质量门: root tsc/lint 0; backend typecheck 0; test 255+4/259 全过。
