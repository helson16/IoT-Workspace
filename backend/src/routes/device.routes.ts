import type { FastifyInstance } from 'fastify';
import { DeviceService } from '../services/device.service.js';
import { success, successCreated, paginated } from '../shared/response.js';
import { ValidationError, DeviceNotFoundError } from '../shared/errors.js';

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

  // ============================================================
  // 全局设备接口(跨产品, 控制台设备管理页使用)
  // ============================================================

  // GET /api/v1/devices - 全局设备列表
  fastify.get('/api/v1/devices', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['online', 'offline', 'not-activated', 'disabled'] },
          keyword: { type: 'string', maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const pageSize = Number(query.page_size) || 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.keyword) {
      where.OR = [
        { deviceName: { contains: query.keyword, mode: 'insensitive' } },
        { product: { is: { productName: { contains: query.keyword, mode: 'insensitive' } } } },
      ];
    }

    const [devices, total, statusCounts] = await Promise.all([
      fastify.db.device.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          deviceId: true,
          deviceName: true,
          productId: true,
          status: true,
          firmwareVersion: true,
          tags: true,
          lastLoginAt: true,
          createdAt: true,
          product: { select: { productName: true } },
        },
      }),
      fastify.db.device.count({ where }),
      fastify.db.device.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const statusCountMap: Record<string, number> = {};
    for (const g of statusCounts) {
      statusCountMap[g.status] = g._count._all;
    }

    const resp = paginated(
      devices.map((d: any) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        productId: d.productId,
        productName: d.product?.productName ?? d.productId,
        status: d.status,
        firmwareVersion: d.firmwareVersion,
        tags: d.tags,
        lastLoginAt: d.lastLoginAt,
        createdAt: d.createdAt,
      })),
      total,
      page,
      pageSize,
    );

    // 附加状态统计(通过 headers 之外的扩展字段返回)
    const body = resp.body as any;
    body.data.status_counts = {
      online: statusCountMap['online'] ?? 0,
      offline: statusCountMap['offline'] ?? 0,
      'not-activated': statusCountMap['not-activated'] ?? 0,
      disabled: statusCountMap['disabled'] ?? 0,
    };
    reply.code(resp.statusCode).send(body);
  });

  // GET /api/v1/devices/:deviceId - 设备详情(全局 deviceId, 含产品信息)
  fastify.get('/api/v1/devices/:deviceId', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;

    const device = await fastify.db.device.findUnique({
      where: { deviceId },
      include: {
        product: {
          select: {
            productName: true,
            protocolType: true,
            nodeType: true,
            category: true,
            description: true,
          },
        },
      },
    });

    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device does not exist' }],
      );
    }

    const resp = success({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      productId: device.productId,
      productName: device.product?.productName ?? device.productId,
      status: device.status,
      firmwareVersion: device.firmwareVersion,
      tags: device.tags,
      lastLoginAt: device.lastLoginAt,
      lastLogoutAt: device.lastLogoutAt,
      createdAt: device.createdAt,
      protocol: device.product?.protocolType ?? 'MQTT',
      nodeType: device.product?.nodeType ?? 'device',
      category: device.product?.category ?? '',
      description: device.product?.description ?? '',
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/devices/:deviceId/telemetry - 最新遥测数据(属性上报历史)
  fastify.get('/api/v1/devices/:deviceId/telemetry', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const query = request.query as any;
    const limit = Number(query.limit) || 20;

    const device = await fastify.db.device.findUnique({
      where: { deviceId },
      select: { deviceId: true },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device does not exist' }],
      );
    }

    const history = await fastify.db.devicePropertyHistory.findMany({
      where: { deviceId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const resp = success(
      history.map((h: any) => ({
        id: h.id.toString(),
        identifier: h.identifier,
        value: h.value,
        timestamp: h.timestamp.toISOString(),
      })),
    );
    reply.code(resp.statusCode).send(resp.body);
  });
}

