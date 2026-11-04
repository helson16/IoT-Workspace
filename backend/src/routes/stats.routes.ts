import type { FastifyInstance } from 'fastify';
import { success } from '../shared/response.js';

export default async function statsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/stats/overview - 控制台概览统计 + 最近设备动态
  fastify.get('/api/v1/stats/overview', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          activity_limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as any;
    const activityLimit = Number(query.activity_limit) || 10;

    // 1. 聚合统计(并行)
    const [productCount, deviceCount, onlineCount, statusCounts, recentEvents, recentHistory, recentLogins] =
      await Promise.all([
        fastify.db.product.count(),
        fastify.db.device.count(),
        fastify.db.device.count({ where: { status: 'online' } }),
        fastify.db.device.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        fastify.db.deviceEventLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: activityLimit,
          include: {
            device: { select: { deviceName: true } },
          },
        }),
        fastify.db.devicePropertyHistory.findMany({
          orderBy: { timestamp: 'desc' },
          take: activityLimit * 3,
          include: {
            device: { select: { deviceName: true } },
          },
        }),
        fastify.db.device.findMany({
          where: { lastLoginAt: { not: null } },
          orderBy: { lastLoginAt: 'desc' },
          take: activityLimit,
          select: { deviceId: true, deviceName: true, status: true, lastLoginAt: true, lastLogoutAt: true },
        }),
      ]);

    // 2. 组装设备动态时间线: 事件上报 / 属性上报 / 设备上线
    type Activity = {
      timestamp: Date;
      type: string;
      device_name: string;
      status: 'success' | 'info' | 'warning' | 'error';
      detail: string;
    };

    const activities: Activity[] = [];

    for (const ev of recentEvents) {
      activities.push({
        timestamp: ev.timestamp,
        type: ev.eventType === 'alert' ? '告警触发' : ev.eventType === 'error' ? '故障上报' : '事件上报',
        device_name: ev.device?.deviceName ?? ev.deviceId,
        status: ev.eventType === 'alert' ? 'warning' : ev.eventType === 'error' ? 'error' : 'info',
        detail: `事件 ${ev.eventId}`,
      });
    }

    // 属性上报按 (device, 时间) 去重 — 同一批上报合并为一条
    const seenReportBatches = new Set<string>();
    for (const h of recentHistory) {
      const batchKey = `${h.deviceId}:${Math.floor(h.timestamp.getTime() / 1000)}`;
      if (seenReportBatches.has(batchKey)) continue;
      seenReportBatches.add(batchKey);
      activities.push({
        timestamp: h.timestamp,
        type: '属性上报',
        device_name: h.device?.deviceName ?? h.deviceId,
        status: 'info',
        detail: `${h.identifier} = ${JSON.stringify(h.value)}`,
      });
    }

    for (const d of recentLogins) {
      if (d.lastLoginAt) {
        activities.push({
          timestamp: d.lastLoginAt,
          type: '设备上线',
          device_name: d.deviceName,
          status: 'success',
          detail: d.status === 'online' ? '当前在线' : '已离线',
        });
      }
    }

    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const topActivities = activities.slice(0, activityLimit).map((a) => ({
      time: a.timestamp.toISOString(),
      type: a.type,
      device_name: a.device_name,
      status: a.status,
      detail: a.detail,
    }));

    const statusCountMap: Record<string, number> = {};
    for (const g of statusCounts) {
      statusCountMap[g.status] = g._count._all;
    }

    const resp = success({
      project_count: 1, // 单项目模式(与控制台一致)
      product_count: productCount,
      device_count: deviceCount,
      online_count: onlineCount,
      offline_count: statusCountMap['offline'] ?? 0,
      not_activated_count: statusCountMap['not-activated'] ?? 0,
      disabled_count: statusCountMap['disabled'] ?? 0,
      recent_activity: topActivities,
    });
    reply.code(resp.statusCode).send(resp.body);
  });
}
