import type { FastifyInstance } from 'fastify';
import { DeviceGroupService } from '../services/device-group.service.js';
import { success } from '../shared/response.js';

const COLOR_PATTERN = '^#[0-9A-Fa-f]{6}$';

export default async function deviceGroupRoutes(fastify: FastifyInstance) {
  const service = new DeviceGroupService(fastify.db);

  // GET /api/v1/device-groups - 分组列表(含设备数)
  fastify.get('/api/v1/device-groups', async (_request, reply) => {
    const groups = await service.list();
    const resp = success(groups);
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/device-groups - 创建分组
  fastify.post('/api/v1/device-groups', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          description: { type: 'string', maxLength: 256 },
          color: { type: 'string', pattern: COLOR_PATTERN },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      color?: string;
    };
    const group = await service.create({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      color: service.validateColor(body.color),
    });
    const resp = success(group);
    reply.code(201).send(resp.body);
  });

  // PUT /api/v1/device-groups/:id - 更新分组
  fastify.put('/api/v1/device-groups/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          description: { type: 'string', maxLength: 256 },
          color: { type: 'string', pattern: COLOR_PATTERN },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      color?: string;
    };
    const group = await service.update(id, {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined
        ? { description: body.description.trim() || null }
        : {}),
      ...(body.color !== undefined
        ? { color: service.validateColor(body.color) }
        : {}),
    });
    const resp = success(group);
    reply.code(resp.statusCode).send(resp.body);
  });

  // DELETE /api/v1/device-groups/:id - 删除分组(设备自动解绑)
  fastify.delete('/api/v1/device-groups/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.delete(id);
    reply.code(200).send({ code: 0, message: 'success', data: null });
  });

  // GET /api/v1/device-groups/:id/devices - 组内设备列表
  fastify.get('/api/v1/device-groups/:id/devices', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const devices = await service.listDevices(id);
    const resp = success(devices);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PUT /api/v1/device-groups/:id/devices - 全量替换分组成员
  fastify.put('/api/v1/device-groups/:id/devices', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['device_ids'],
        properties: {
          device_ids: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            maxItems: 500,
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { device_ids: string[] };
    await service.setDevices(id, body.device_ids);
    reply.code(200).send({ code: 0, message: 'success', data: null });
  });
}
