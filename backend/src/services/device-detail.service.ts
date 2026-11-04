import { Prisma, type PrismaClient } from '@prisma/client';
import { DeviceNotFoundError } from '../shared/errors.js';

// ============================================================
// 纯函数(可单测)
// ============================================================

/** 均匀抽稀序列至 maxPoints 个点(保首尾); 不足则原样返回 */
export function sampleSeries<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints < 1) return [];
  if (points.length <= maxPoints) return [...points];
  if (maxPoints === 1) return [points[0]];
  const result: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

export interface TelemetryRow {
  identifier: string;
  value: unknown;
  timestamp: Date;
}

export interface TrendPoint {
  ts: string;
  value: number;
}

export interface TrendSeries {
  identifier: string;
  name: string;
  unit: string;
  points: TrendPoint[];
}

export interface ThingModelPropertyBrief {
  identifier: string;
  name: string;
  unit: string | null;
}

/**
 * 构建遥测趋势序列:
 * - 按 identifier 分组, 仅保留数值型值(bool/enum/string 不适合折线)
 * - 组内按时间升序, 均匀抽稀至每序列 ≤ maxPoints
 */
export function buildTelemetryTrend(
  rows: TelemetryRow[],
  propMeta: ThingModelPropertyBrief[],
  maxPoints = 240,
): TrendSeries[] {
  const metaMap = new Map(propMeta.map((p) => [p.identifier, p]));
  const groups = new Map<string, TrendPoint[]>();
  for (const row of rows) {
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) continue;
    let bucket = groups.get(row.identifier);
    if (!bucket) {
      bucket = [];
      groups.set(row.identifier, bucket);
    }
    bucket.push({ ts: row.timestamp.toISOString(), value: row.value });
  }
  const series: TrendSeries[] = [];
  for (const [identifier, points] of groups) {
    points.sort((a, b) => a.ts.localeCompare(b.ts));
    const meta = metaMap.get(identifier);
    series.push({
      identifier,
      name: meta?.name ?? identifier,
      unit: meta?.unit ?? '',
      points: sampleSeries(points, maxPoints),
    });
  }
  // 按物模型定义顺序排列(未定义的排最后, 按 identifier 字典序)
  const orderIndex = new Map(propMeta.map((p, i) => [p.identifier, i]));
  series.sort((a, b) => {
    const ai = orderIndex.get(a.identifier) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(b.identifier) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.identifier.localeCompare(b.identifier);
  });
  return series;
}

// ============================================================
// Service
// ============================================================

interface LogRow {
  id: string;
  time: Date;
  type: string;
  level: string;
  summary: string;
}

interface CountRow {
  count: number;
}

const LOG_TYPES = ['all', 'property', 'event', 'action', 'forward', 'status'] as const;

export class DeviceDetailService {
  constructor(private readonly db: PrismaClient) {}

  /** 遥测趋势: 窗口内该设备属性历史, 按物模型映射 name/unit, 抽稀后返回 */
  async getTelemetryTrend(deviceId: string, hours: number) {
    const device = await this.db.device.findUnique({
      where: { deviceId },
      select: { deviceId: true, productId: true },
    });
    if (!device) {
      throw new DeviceNotFoundError(`Device not found: ${deviceId}`, [
        { field: 'deviceId', message: 'Device does not exist' },
      ]);
    }

    const since = new Date(Date.now() - hours * 3600_000);
    const [rows, props] = await Promise.all([
      this.db.devicePropertyHistory.findMany({
        where: { deviceId, timestamp: { gte: since } },
        select: { identifier: true, value: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
      }),
      this.db.thingModelProperty.findMany({
        where: { productId: device.productId },
        select: { identifier: true, name: true, spec: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const propMeta: ThingModelPropertyBrief[] = props.map((p: any) => ({
      identifier: p.identifier,
      name: p.name,
      unit: typeof p.spec?.unit === 'string' ? p.spec.unit : null,
    }));

    const series = buildTelemetryTrend(rows, propMeta);
    return { hours, series };
  }

  /** 设备通信日志: UNION 5 类(属性/事件/服务调用/转发/上下线) */
  async getLogs(deviceId: string, logType: string, page: number, pageSize: number) {
    const device = await this.db.device.findUnique({
      where: { deviceId },
      select: { deviceId: true },
    });
    if (!device) {
      throw new DeviceNotFoundError(`Device not found: ${deviceId}`, [
        { field: 'deviceId', message: 'Device does not exist' },
      ]);
    }

    const conditions: Prisma.Sql[] = [Prisma.sql`t.device_id = ${deviceId}`];
    if (logType !== 'all') {
      conditions.push(Prisma.sql`t.type = ${logType}`);
    }
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [rows, totalRows] = await Promise.all([
      this.db.$queryRaw<LogRow[]>(Prisma.sql`
        SELECT * FROM (
          SELECT p.id::text AS id, p."deviceId" AS device_id, p.timestamp AS time,
                 'property' AS type, 'info' AS level, (p.identifier || ' = ' || p.value::text) AS summary
          FROM device_property_history p
          WHERE p."deviceId" = ${deviceId}
          UNION ALL
          SELECT e.id::text, e."deviceId", e.timestamp, 'event', e."eventType",
                 (e."eventId" || ': ' || left(e.payload::text, 100))
          FROM device_event_logs e
          WHERE e."deviceId" = ${deviceId}
          UNION ALL
          SELECT a.id::text, a."deviceId", a.created_at, 'action', a.status,
                 (a.action_id || ' 调用 · ' || a.status)
          FROM device_action_logs a
          WHERE a."deviceId" = ${deviceId}
          UNION ALL
          SELECT f.id::text, f.device_id, f.created_at, 'forward', f.result,
                 (f.rule_name || ' · ' || f.message_type || ' · ' || f.latency_ms || 'ms')
          FROM forward_logs f
          WHERE f.device_id = ${deviceId}
          UNION ALL
          SELECT ('login-' || d."deviceId"), d."deviceId", d.last_login_at, 'status', 'online', '设备上线'
          FROM devices d
          WHERE d."deviceId" = ${deviceId} AND d.last_login_at IS NOT NULL
          UNION ALL
          SELECT ('logout-' || d."deviceId"), d."deviceId", d.last_logout_at, 'status', 'offline', '设备下线'
          FROM devices d
          WHERE d."deviceId" = ${deviceId} AND d.last_logout_at IS NOT NULL
        ) t
        ${whereSql}
        ORDER BY t.time DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `),
      this.db.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT p.id::text AS id, 'property' AS type, p."deviceId" AS device_id
          FROM device_property_history p
          WHERE p."deviceId" = ${deviceId}
          UNION ALL
          SELECT e.id::text, 'event', e."deviceId"
          FROM device_event_logs e
          WHERE e."deviceId" = ${deviceId}
          UNION ALL
          SELECT a.id::text, 'action', a."deviceId"
          FROM device_action_logs a
          WHERE a."deviceId" = ${deviceId}
          UNION ALL
          SELECT f.id::text, 'forward', f.device_id
          FROM forward_logs f
          WHERE f.device_id = ${deviceId}
          UNION ALL
          SELECT ('login-' || d."deviceId"), 'status', d."deviceId"
          FROM devices d
          WHERE d."deviceId" = ${deviceId} AND d.last_login_at IS NOT NULL
          UNION ALL
          SELECT ('logout-' || d."deviceId"), 'status', d."deviceId"
          FROM devices d
          WHERE d."deviceId" = ${deviceId} AND d.last_logout_at IS NOT NULL
        ) t
        ${whereSql}
      `),
    ]);

    return {
      total: totalRows[0]?.count ?? 0,
      page,
      page_size: pageSize,
      items: rows.map((r) => ({
        id: r.id,
        time: r.time,
        type: r.type,
        level: r.level,
        summary: r.summary,
      })),
    };
  }
}

export { LOG_TYPES };
