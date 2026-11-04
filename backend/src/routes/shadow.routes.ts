import type { FastifyInstance } from 'fastify';
import { ShadowService } from '../services/shadow.service.js';
import { success } from '../shared/response.js';

export default async function shadowRoutes(fastify: FastifyInstance) {
  const service = new ShadowService(fastify.db, fastify);

  // GET /api/v1/shadows/:deviceId - 获取设备影子
  fastify.get('/api/v1/shadows/:deviceId', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const shadow = await service.getShadow(deviceId);
    const resp = success(shadow);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PUT /api/v1/shadows/:deviceId - 更新期望状态(desired)
  fastify.put('/api/v1/shadows/:deviceId', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['state', 'version'],
        properties: {
          state: {
            type: 'object',
            required: ['desired'],
            properties: {
              desired: { type: 'object' },
            },
            additionalProperties: false,
          },
          version: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const { state, version } = request.body as any;
    const shadow = await service.updateDesired(deviceId, state.desired, version);
    const resp = success(shadow);
    reply.code(resp.statusCode).send(resp.body);
  });

  // DELETE /api/v1/shadows/:deviceId/desired - 清除期望状态
  fastify.delete('/api/v1/shadows/:deviceId/desired', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const result = await service.clearDesired(deviceId);
    const resp = success(result);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/shadows/:deviceId/delta - 仅获取差异(delta)
  fastify.get('/api/v1/shadows/:deviceId/delta', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const delta = await service.getDelta(deviceId);
    const resp = success(delta);
    reply.code(resp.statusCode).send(resp.body);
  });
}
