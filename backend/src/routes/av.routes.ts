import type { FastifyInstance } from 'fastify';
import { success } from '../shared/response.js';
import { AvService, AV_EVENT_TYPES, AV_STATUSES } from '../services/av.service.js';

export default async function avRoutes(fastify: FastifyInstance) {
  const service = new AvService(fastify.db);

  // GET /api/v1/av/stats - 音视频统计卡(今日录制/截图/回放、存储、时长、成功率)
  fastify.get('/api/v1/av/stats', async (_request, reply) => {
    const stats = await service.getStats();
    const resp = success(stats);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/av/trend - AV 事件小时趋势(hours 小时窗口, 默认 24)
  fastify.get('/api/v1/av/trend', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          hours: { type: 'integer', minimum: 1, maximum: 168, default: 24 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as { hours?: number };
    const trend = await service.getTrend(q.hours ?? 24);
    const resp = success(trend);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/av/events - 音视频事件分页列表
  fastify.get('/api/v1/av/events', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          event_type: { type: 'string', enum: ['all', ...AV_EVENT_TYPES], default: 'all' },
          status: { type: 'string', enum: ['all', ...AV_STATUSES], default: 'all' },
          device_id: { type: 'string', maxLength: 128 },
          keyword: { type: 'string', maxLength: 128 },
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as {
      event_type?: string;
      status?: string;
      device_id?: string;
      keyword?: string;
      page?: number;
      page_size?: number;
    };

    const result = await service.listEvents({
      event_type: q.event_type,
      status: q.status,
      device_id: q.device_id,
      keyword: q.keyword,
      page: q.page ?? 1,
      page_size: q.page_size ?? 20,
    });

    const resp = success(result);
    reply.code(resp.statusCode).send(resp.body);
  });
}
