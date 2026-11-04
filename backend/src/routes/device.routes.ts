import type { FastifyInstance } from 'fastify';
import { DeviceService } from '../services/device.service.js';
import { success, successCreated, paginated } from '../shared/response.js';
import { ValidationError } from '../shared/errors.js';

export default async function deviceRoutes(fastify: FastifyInstance) {
  const service = new DeviceService(fastify.db, fastify);

  // POST /api/v1/products/:productId/devices/register - 注册设备
  fastify.post('/api/v1/products/:productId/devices/register', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['device_name'],
        properties: {
          device_name: { type: 'string', minLength: 1, maxLength: 128 },
          tags: { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const body = request.body as any;
    const device = await service.register(productId, body);
    const resp = successCreated(device);
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/products/:productId/devices/batch-register - 批量注册
  fastify.post('/api/v1/products/:productId/devices/batch-register', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['devices'],
        properties: {
          devices: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              required: ['device_name'],
              properties: {
                device_name: { type: 'string', minLength: 1, maxLength: 128 },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const { devices } = request.body as any;
    const results = await service.batchRegister(productId, devices);
    const resp = successCreated(results);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/products/:productId/devices - 获取设备列表
  fastify.get('/api/v1/products/:productId/devices', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const pageSize = Number(query.page_size) || 20;
    const result = await service.list(productId, {
      page,
      page_size: pageSize,
      status: query.status,
    });
    const resp = paginated(result.items, result.total, page, pageSize);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/products/:productId/devices/:deviceName - 获取设备详情
  fastify.get('/api/v1/products/:productId/devices/:deviceName', {
    schema: {
      params: {
        type: 'object',
        required: ['productId', 'deviceName'],
        properties: {
          productId: { type: 'string' },
          deviceName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { productId, deviceName } = request.params as any;
    const device = await service.getByName(productId, deviceName);
    const resp = success(device);
    reply.code(resp.statusCode).send(resp.body);
  });

  // DELETE /api/v1/products/:productId/devices/:deviceName - 删除设备
  fastify.delete('/api/v1/products/:productId/devices/:deviceName', {
    schema: {
      params: {
        type: 'object',
        required: ['productId', 'deviceName'],
        properties: {
          productId: { type: 'string' },
          deviceName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { productId, deviceName } = request.params as any;
    await service.deleteByName(productId, deviceName);
    reply.code(200).send({ code: 0, message: 'success', data: null });
  });

  // PATCH /api/v1/products/:productId/devices/:deviceName/status - 变更设备状态
  fastify.patch('/api/v1/products/:productId/devices/:deviceName/status', {
    schema: {
      params: {
        type: 'object',
        required: ['productId', 'deviceName'],
        properties: {
          productId: { type: 'string' },
          deviceName: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['online', 'offline', 'not-activated', 'disabled'],
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { productId, deviceName } = request.params as any;
    const { status } = request.body as any;
    const device = await service.updateStatus(productId, deviceName, status);
    const resp = success(device);
    reply.code(resp.statusCode).send(resp.body);
  });
}
