import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { success } from '../shared/response.js';
import { ChartNotFoundError } from '../shared/errors.js';
import {
  fillTimeBuckets,
  summarizeChart,
  buildInsights,
  type BucketPoint,
  type ChartId,
} from '../services/analytics.service.js';

// ---------------- 原始行类型 ----------------

interface BucketRowRaw {
  bucket: Date;
  value: number;
}

interface SizeRow {
  table_name: string;
  bytes: number;
}

interface EventTypeRow {
  event_type: string;
  value: number;
}

interface RawPropRow {
  device_id: string;
  device_name: string;
  detail: string;
  time: Date;
}

interface RawEventRow {
  device_id: string;
  device_name: string;
  event_id: string;
  event_type: string;
  payload: string;
  time: Date;
}

interface ActiveDeviceRow {
  device_id: string;
  device_name: string;
  count: number;
}

interface OverlimitAggRow {
  count: number;
  max_value: number | null;
  max_limit: number | null;
}

interface OverlimitDeviceRow {
  device_name: string;
}

// ---------------- 图表元信息 ----------------

interface ChartMeta {
  id: ChartId;
  name: string;
  type: 'line' | 'bar' | 'pie' | 'area';
  unit: string;
  data_source: string;
  time_range: string;
  refresh_interval: string;
}

const CHART_METAS: ChartMeta[] = [
  {
    id: 'temp-trend',
    name: '设备温度趋势',
    type: 'line',
    unit: '°C',
    data_source: '属性上报 · temperature',
    time_range: '最近24小时',
    refresh_interval: '1分钟',
  },
  {
    id: 'daily-active',
    name: '活跃设备统计',
    type: 'bar',
    unit: '台',
    data_source: '属性上报 · 全部设备',
    time_range: '最近7天',
    refresh_interval: '1小时',
  },
  {
    id: 'alarm-dist',
    name: '告警级别分布',
    type: 'pie',
    unit: '条',
    data_source: '事件上报 · 告警中心',
    time_range: '最近30天',
    refresh_interval: '1天',
  },
  {
    id: 'throughput',
    name: '消息吞吐量',
    type: 'area',
    unit: '条/分钟',
    data_source: '属性上报 · 全部设备',
    time_range: '最近1小时',
    refresh_interval: '1分钟',
  },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  info: '信息',
  warn: '警告',
  alert: '严重告警',
  error: '故障',
};

// timestamp 列存 UTC wall time, 一律以 UTC 基准开窗口(避免 session 时区 Asia/Shanghai 带来 8h 偏移)
const UTC_NOW = Prisma.sql`(now() AT TIME ZONE 'utc')`;

function toIso(value: Date): string {
  return new Date(value).toISOString();
}

function formatRawProp(rows: RawPropRow[]) {
  return rows.map((r) => ({
    device_id: r.device_id,
    device_name: r.device_name,
    detail: r.detail,
    time: toIso(r.time),
  }));
}

export default async function analyticsRoutes(fastify: FastifyInstance) {
  const db = fastify.db;

  // GET /api/v1/analytics/storage - 存储统计
  fastify.get('/api/v1/analytics/storage', async (_request, reply) => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [
      propCount,
      eventCount,
      actionCount,
      weekProp,
      weekEvent,
      weekAction,
      sizeRows,
    ] = await Promise.all([
      db.devicePropertyHistory.count(),
      db.deviceEventLog.count(),
      db.deviceActionLog.count(),
      db.devicePropertyHistory.count({ where: { timestamp: { gte: weekAgo } } }),
      db.deviceEventLog.count({ where: { timestamp: { gte: weekAgo } } }),
      db.deviceActionLog.count({ where: { createdAt: { gte: weekAgo } } }),
      db.$queryRaw<SizeRow[]>`
        SELECT 'device_property_history' AS table_name,
               pg_total_relation_size('device_property_history')::double precision AS bytes
        UNION ALL
        SELECT 'device_event_logs', pg_total_relation_size('device_event_logs')::double precision
        UNION ALL
        SELECT 'device_action_logs', pg_total_relation_size('device_action_logs')::double precision`,
    ]);

    const sizeMap = new Map(sizeRows.map((r) => [r.table_name, Number(r.bytes)]));
    const breakdown = [
      { label: '属性历史', table: 'device_property_history', records: propCount, storage_bytes: sizeMap.get('device_property_history') ?? 0 },
      { label: '事件日志', table: 'device_event_logs', records: eventCount, storage_bytes: sizeMap.get('device_event_logs') ?? 0 },
      { label: '服务调用日志', table: 'device_action_logs', records: actionCount, storage_bytes: sizeMap.get('device_action_logs') ?? 0 },
    ];

    const totalRecords = propCount + eventCount + actionCount;
    const weekRecords = weekProp + weekEvent + weekAction;

    const resp = success({
      total_records: totalRecords,
      week_records: weekRecords,
      avg_daily_records: Math.round((weekRecords / 7) * 10) / 10,
      storage_bytes: breakdown.reduce((a, b) => a + b.storage_bytes, 0),
      breakdown,
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/analytics/charts - 4 个预定义图表数据
  fastify.get('/api/v1/analytics/charts', async (_request, reply) => {
    const now = new Date();

    const [tempRaw, activeRaw, alarmRaw, throughputRaw] = await Promise.all([
      db.$queryRaw<BucketRowRaw[]>`
        SELECT date_trunc('hour', "timestamp") AS bucket,
               AVG((value #>> '{}')::double precision) AS value
        FROM device_property_history
        WHERE identifier = 'temperature'
          AND "timestamp" >= ${UTC_NOW} - interval '24 hours'
        GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<BucketRowRaw[]>`
        SELECT date_trunc('day', "timestamp") AS bucket,
               COUNT(DISTINCT "deviceId")::int AS value
        FROM device_property_history
        WHERE "timestamp" >= ${UTC_NOW} - interval '7 days'
        GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<EventTypeRow[]>`
        SELECT "eventType" AS event_type, COUNT(*)::int AS value
        FROM device_event_logs
        WHERE "timestamp" >= ${UTC_NOW} - interval '30 days'
        GROUP BY 1`,
      db.$queryRaw<BucketRowRaw[]>`
        SELECT date_trunc('minute', "timestamp") AS bucket, COUNT(*)::int AS value
        FROM device_property_history
        WHERE "timestamp" >= ${UTC_NOW} - interval '60 minutes'
        GROUP BY 1 ORDER BY 1`,
    ]);

    const tempPoints = fillTimeBuckets(tempRaw, now, 'hour', 24);
    const activePoints = fillTimeBuckets(activeRaw, now, 'day', 7);
    const alarmPoints: BucketPoint[] = alarmRaw.map((r) => ({
      label: EVENT_TYPE_LABELS[r.event_type] ?? r.event_type,
      value: Number(r.value),
    }));
    const throughputPoints = fillTimeBuckets(throughputRaw, now, 'minute', 60);

    const pointsOf: Record<ChartId, BucketPoint[]> = {
      'temp-trend': tempPoints,
      'daily-active': activePoints,
      'alarm-dist': alarmPoints,
      throughput: throughputPoints,
    };

    const charts = CHART_METAS.map((meta) => ({
      ...meta,
      summary: summarizeChart(meta.id, pointsOf[meta.id]),
      points: pointsOf[meta.id],
    }));

    const resp = success({ charts });
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/analytics/charts/:id/details - 图表明细(数据点 + 最近原始记录)
  fastify.get(
    '/api/v1/analytics/charts/:id/details',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const meta = CHART_METAS.find((m) => m.id === id);
      if (!meta) {
        throw new ChartNotFoundError(`图表不存在: ${id}`);
      }

      const [chartsBody, rawRows] = await Promise.all([
        // 复用图表聚合逻辑: 直接重跑该图表的查询
        (async () => {
          const now = new Date();
          if (meta.id === 'temp-trend') {
            const rows = await db.$queryRaw<BucketRowRaw[]>`
              SELECT date_trunc('hour', "timestamp") AS bucket,
                     AVG((value #>> '{}')::double precision) AS value
              FROM device_property_history
              WHERE identifier = 'temperature'
                AND "timestamp" >= ${UTC_NOW} - interval '24 hours'
              GROUP BY 1 ORDER BY 1`;
            return fillTimeBuckets(rows, now, 'hour', 24);
          }
          if (meta.id === 'daily-active') {
            const rows = await db.$queryRaw<BucketRowRaw[]>`
              SELECT date_trunc('day', "timestamp") AS bucket,
                     COUNT(DISTINCT "deviceId")::int AS value
              FROM device_property_history
              WHERE "timestamp" >= ${UTC_NOW} - interval '7 days'
              GROUP BY 1 ORDER BY 1`;
            return fillTimeBuckets(rows, now, 'day', 7);
          }
          if (meta.id === 'throughput') {
            const rows = await db.$queryRaw<BucketRowRaw[]>`
              SELECT date_trunc('minute', "timestamp") AS bucket, COUNT(*)::int AS value
              FROM device_property_history
              WHERE "timestamp" >= ${UTC_NOW} - interval '60 minutes'
              GROUP BY 1 ORDER BY 1`;
            return fillTimeBuckets(rows, now, 'minute', 60);
          }
          const rows = await db.$queryRaw<EventTypeRow[]>`
            SELECT "eventType" AS event_type, COUNT(*)::int AS value
            FROM device_event_logs
            WHERE "timestamp" >= ${UTC_NOW} - interval '30 days'
            GROUP BY 1`;
          return rows.map<BucketPoint>((r) => ({
            label: EVENT_TYPE_LABELS[r.event_type] ?? r.event_type,
            value: Number(r.value),
          }));
        })(),
        (async () => {
          if (meta.id === 'temp-trend') {
            const rows = await db.$queryRaw<RawPropRow[]>`
              SELECT p."deviceId" AS device_id, d."deviceName" AS device_name,
                     (p.identifier || ' = ' || (p.value #>> '{}')) AS detail,
                     p."timestamp" AS time
              FROM device_property_history p
              JOIN devices d ON d."deviceId" = p."deviceId"
              WHERE p.identifier = 'temperature'
              ORDER BY p.id DESC LIMIT 20`;
            return formatRawProp(rows);
          }
          if (meta.id === 'daily-active') {
            const rows = await db.$queryRaw<ActiveDeviceRow[]>`
              SELECT p."deviceId" AS device_id, d."deviceName" AS device_name,
                     COUNT(*)::int AS count
              FROM device_property_history p
              JOIN devices d ON d."deviceId" = p."deviceId"
              WHERE p."timestamp" >= date_trunc('day', ${UTC_NOW})
              GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`;
            return rows.map((r) => ({
              device_id: r.device_id,
              device_name: r.device_name,
              detail: `今日上报 ${r.count} 条`,
              time: new Date().toISOString(),
            }));
          }
          if (meta.id === 'alarm-dist') {
            const rows = await db.$queryRaw<RawEventRow[]>`
              SELECT e."deviceId" AS device_id, d."deviceName" AS device_name,
                     e."eventId" AS event_id, e."eventType" AS event_type,
                     left(e.payload::text, 120) AS payload, e."timestamp" AS time
              FROM device_event_logs e
              JOIN devices d ON d."deviceId" = e."deviceId"
              ORDER BY e.id DESC LIMIT 20`;
            return rows.map((r) => ({
              device_id: r.device_id,
              device_name: r.device_name,
              detail: `${r.event_id} · ${EVENT_TYPE_LABELS[r.event_type] ?? r.event_type} · ${r.payload}`,
              time: toIso(r.time),
            }));
          }
          const rows = await db.$queryRaw<RawPropRow[]>`
            SELECT p."deviceId" AS device_id, d."deviceName" AS device_name,
                   (p.identifier || ' = ' || (p.value #>> '{}')) AS detail,
                   p."timestamp" AS time
            FROM device_property_history p
            JOIN devices d ON d."deviceId" = p."deviceId"
            ORDER BY p.id DESC LIMIT 20`;
          return formatRawProp(rows);
        })(),
      ]);

      const resp = success({
        ...meta,
        summary: summarizeChart(meta.id, chartsBody),
        points: chartsBody,
        raw: rawRows,
      });
      reply.code(resp.statusCode).send(resp.body);
    },
  );

  // GET /api/v1/analytics/insights - 真实派生洞察
  fastify.get('/api/v1/analytics/insights', async (_request, reply) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
    const since24h = new Date(now.getTime() - 86_400_000);
    const since7d = new Date(now.getTime() - 7 * 86_400_000);
    const prev7dStart = new Date(now.getTime() - 14 * 86_400_000);

    const [
      todayMsg,
      yesterdayMsg,
      devices,
      alarmRecent,
      alarmPrev,
      overlimitAggRows,
      overlimitDevices,
    ] = await Promise.all([
      db.devicePropertyHistory.count({ where: { timestamp: { gte: todayStart } } }),
      db.devicePropertyHistory.count({
        where: { timestamp: { gte: yesterdayStart, lt: todayStart } },
      }),
      db.device.findMany({ select: { status: true, deviceName: true } }),
      db.deviceEventLog.count({
        where: { timestamp: { gte: since7d }, eventType: { in: ['warn', 'error', 'alert'] } },
      }),
      db.deviceEventLog.count({
        where: { timestamp: { gte: prev7dStart, lt: since7d }, eventType: { in: ['warn', 'error', 'alert'] } },
      }),
      db.$queryRaw<OverlimitAggRow[]>`
        SELECT COUNT(*)::int AS count,
               MAX((p.value #>> '{}')::double precision) AS max_value,
               MAX((t.spec ->> 'max')::double precision) AS max_limit
        FROM device_property_history p
        JOIN devices d ON d."deviceId" = p."deviceId"
        JOIN thing_model_properties t
          ON t."productId" = d."productId" AND t.identifier = p.identifier
        WHERE p.identifier = 'temperature' AND p."timestamp" >= ${since24h}
          AND (p.value #>> '{}')::double precision > (t.spec ->> 'max')::double precision`,
      db.$queryRaw<OverlimitDeviceRow[]>`
        SELECT d."deviceName" AS device_name
        FROM device_property_history p
        JOIN devices d ON d."deviceId" = p."deviceId"
        JOIN thing_model_properties t
          ON t."productId" = d."productId" AND t.identifier = p.identifier
        WHERE p.identifier = 'temperature' AND p."timestamp" >= ${since24h}
          AND (p.value #>> '{}')::double precision > (t.spec ->> 'max')::double precision
        GROUP BY 1 ORDER BY 1 LIMIT 3`,
    ]);

    const agg = overlimitAggRows[0];
    const insights = buildInsights({
      today_messages: todayMsg,
      yesterday_messages: yesterdayMsg,
      overlimit: {
        count: agg?.count ?? 0,
        device_names: overlimitDevices.map((r) => r.device_name),
        latest_value: agg?.max_value ?? null,
        max_limit: agg?.max_limit ?? null,
      },
      online: {
        total: devices.length,
        online: devices.filter((d) => d.status === 'online').length,
        offline_names: devices
          .filter((d) => d.status === 'offline')
          .map((d) => d.deviceName),
      },
      alarm_recent7: alarmRecent,
      alarm_prev7: alarmPrev,
      generated_at: now,
    });

    const resp = success({ insights });
    reply.code(resp.statusCode).send(resp.body);
  });
}
