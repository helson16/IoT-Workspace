import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { success } from '../shared/response.js';

interface HourlyRow {
  hour: Date;
  count: number;
}

interface LogRow {
  id: string;
  time: Date;
  type: string;
  device_id: string;
  device_name: string;
  product_name: string;
  level: string;
  summary: string;
}

interface CountRow {
  count: number;
}

const LOG_TYPES = ['all', 'property', 'event', 'action', 'status'] as const;

export default async function opsRoutes(fastify: FastifyInstance) {
  const db = fastify.db;

  // GET /api/v1/ops/metrics - 平台运行指标 + 24h 消息趋势
  fastify.get('/api/v1/ops/metrics', async (_request, reply) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [devices, messagesToday, eventsToday, alarmsToday, actionsToday, hourlyRaw] =
      await Promise.all([
        db.device.findMany({ select: { status: true } }),
        db.devicePropertyHistory.count({ where: { timestamp: { gte: todayStart } } }),
        db.deviceEventLog.count({ where: { timestamp: { gte: todayStart } } }),
        db.deviceEventLog.count({
          where: { timestamp: { gte: todayStart }, eventType: { in: ['warn', 'error', 'alert'] } },
        }),
        db.deviceActionLog.count({ where: { createdAt: { gte: todayStart } } }),
        db.$queryRaw<HourlyRow[]>`
          SELECT date_trunc('hour', timestamp) AS hour, COUNT(*)::int AS count
          FROM device_property_history
          WHERE timestamp >= (now() AT TIME ZONE 'utc') - interval '24 hours'
          GROUP BY 1
          ORDER BY 1`,
      ]);

    const statusCount: Record<string, number> = {};
    for (const d of devices) {
      statusCount[d.status] = (statusCount[d.status] ?? 0) + 1;
    }
    const deviceTotal = devices.length;
    const online = statusCount['online'] ?? 0;

    // 补全近 24 个小时桶(含空档)
    const hourMap = new Map<string, number>();
    for (const row of hourlyRaw) {
      hourMap.set(new Date(row.hour).toISOString().slice(0, 13), Number(row.count));
    }
    const hourlyMessages: Array<{ hour: string; count: number }> = [];
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now.getTime() - i * 3600_000);
      h.setMinutes(0, 0, 0);
      const key = h.toISOString().slice(0, 13);
      hourlyMessages.push({ hour: key + ':00:00Z', count: hourMap.get(key) ?? 0 });
    }

    const resp = success({
      device_total: deviceTotal,
      online,
      offline: statusCount['offline'] ?? 0,
      not_activated: statusCount['not-activated'] ?? 0,
      disabled: statusCount['disabled'] ?? 0,
      online_rate: deviceTotal > 0 ? online / deviceTotal : 0,
      messages_today: messagesToday,
      events_today: eventsToday,
      alarms_today: alarmsToday,
      actions_today: actionsToday,
      hourly_messages: hourlyMessages,
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/ops/logs - 统一日志流(属性上报/事件/服务调用/上下线)
  fastify.get('/api/v1/ops/logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...LOG_TYPES], default: 'all' },
          device_id: { type: 'string', maxLength: 128 },
          keyword: { type: 'string', maxLength: 64 },
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as {
      type?: string;
      device_id?: string;
      keyword?: string;
      page?: number;
      page_size?: number;
    };
    const page = q.page ?? 1;
    const pageSize = q.page_size ?? 50;
    const logType = q.type ?? 'all';

    const conditions: Prisma.Sql[] = [];
    if (logType !== 'all') {
      conditions.push(Prisma.sql`t.type = ${logType}`);
    }
    if (q.device_id) {
      conditions.push(Prisma.sql`t.device_id = ${q.device_id}`);
    }
    if (q.keyword) {
      const kw = `%${q.keyword}%`;
      conditions.push(
        Prisma.sql`(t.device_name ILIKE ${kw} OR t.product_name ILIKE ${kw} OR t.summary ILIKE ${kw})`,
      );
    }
    const whereSql = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const [rows, totalRows] = await Promise.all([
      db.$queryRaw<LogRow[]>(Prisma.sql`
        SELECT * FROM (
          SELECT p.id::text AS id, p.timestamp AS time, 'property' AS type,
                 p."deviceId" AS device_id, d."deviceName" AS device_name, pr."productName" AS product_name,
                 'info' AS level, (p.identifier || ' = ' || p.value::text) AS summary
          FROM device_property_history p
          JOIN devices d ON d."deviceId" = p."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT e.id::text, e.timestamp, 'event', e."deviceId", d."deviceName", pr."productName",
                 e."eventType", (e."eventId" || ': ' || left(e.payload::text, 100))
          FROM device_event_logs e
          JOIN devices d ON d."deviceId" = e."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT a.id::text, a.created_at, 'action', a."deviceId", d."deviceName", pr."productName",
                 a.status, (a.action_id || ' 调用 · ' || a.status)
          FROM device_action_logs a
          JOIN devices d ON d."deviceId" = a."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT ('login-' || d."deviceId"), d.last_login_at, 'status', d."deviceId", d."deviceName", pr."productName",
                 'online', '设备上线'
          FROM devices d
          JOIN products pr ON pr."productId" = d."productId"
          WHERE d.last_login_at IS NOT NULL
          UNION ALL
          SELECT ('logout-' || d."deviceId"), d.last_logout_at, 'status', d."deviceId", d."deviceName", pr."productName",
                 'offline', '设备下线'
          FROM devices d
          JOIN products pr ON pr."productId" = d."productId"
          WHERE d.last_logout_at IS NOT NULL
        ) t
        ${whereSql}
        ORDER BY t.time DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `),
      db.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT p.id::text AS id, 'property' AS type, p."deviceId" AS device_id, d."deviceName" AS device_name, pr."productName" AS product_name,
                 (p.identifier || ' = ' || p.value::text) AS summary
          FROM device_property_history p
          JOIN devices d ON d."deviceId" = p."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT e.id::text, 'event', e."deviceId", d."deviceName", pr."productName", (e."eventId" || ': ' || left(e.payload::text, 100))
          FROM device_event_logs e
          JOIN devices d ON d."deviceId" = e."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT a.id::text, 'action', a."deviceId", d."deviceName", pr."productName", (a.action_id || ' 调用 · ' || a.status)
          FROM device_action_logs a
          JOIN devices d ON d."deviceId" = a."deviceId"
          JOIN products pr ON pr."productId" = d."productId"
          UNION ALL
          SELECT d."deviceId"::text, 'status', d."deviceId", d."deviceName", pr."productName", '设备上线'
          FROM devices d JOIN products pr ON pr."productId" = d."productId" WHERE d.last_login_at IS NOT NULL
          UNION ALL
          SELECT d."deviceId"::text, 'status', d."deviceId", d."deviceName", pr."productName", '设备下线'
          FROM devices d JOIN products pr ON pr."productId" = d."productId" WHERE d.last_logout_at IS NOT NULL
        ) t
        ${whereSql}
      `),
    ]);

    const resp = success({
      total: totalRows[0]?.count ?? 0,
      page,
      page_size: pageSize,
      items: rows.map((r) => ({
        id: r.id,
        time: r.time,
        type: r.type,
        device_id: r.device_id,
        device_name: r.device_name,
        product_name: r.product_name,
        level: r.level,
        summary: r.summary,
      })),
    });
    reply.code(resp.statusCode).send(resp.body);
  });
}
