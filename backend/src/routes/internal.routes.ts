import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { ShadowService } from '../services/shadow.service.js';
import { thingModelValidator } from '../shared/validator.js';
import { success, successCreated } from '../shared/response.js';
import { UnauthorizedError, DeviceNotFoundError, PropertyValueInvalidError } from '../shared/errors.js';

export default async function internalRoutes(fastify: FastifyInstance) {
  // Internal auth middleware
  const internalAuth = async (request: any) => {
    const secret = request.headers['x-internal-secret'];
    if (!secret || !config.internalSecret) {
      throw new UnauthorizedError('缺少内部认证凭据');
    }
    const { timingSafeEqual } = await import('../shared/crypto.js');
    if (!timingSafeEqual(String(secret), config.internalSecret)) {
      throw new UnauthorizedError('内部认证失败');
    }
  };

  // POST /api/internal/mqtt/property-report - 设备属性上报回调
  fastify.post('/api/internal/mqtt/property-report', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'product_id', 'device_name', 'payload'],
        properties: {
          device_id: { type: 'string' },
          product_id: { type: 'string' },
          device_name: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'params'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              params: { type: 'object' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, product_id, payload } = request.body as any;
    const params = payload.params;

    // 1. Load thing model properties for validation
    const properties = await fastify.db.thingModelProperty.findMany({
      where: { productId: product_id },
      orderBy: { sortOrder: 'asc' },
    });

    // 2. Validate property values against thing model
    if (properties.length > 0) {
      const validation = thingModelValidator.validatePropertyValues(
        properties.map((p: any) => ({
          identifier: p.identifier,
          dataType: p.dataType,
          spec: p.spec,
          accessMode: p.accessMode,
        })),
        params,
      );
      if (!validation.valid && validation.errors && validation.errors.length > 0) {
        throw new PropertyValueInvalidError('属性值校验失败', validation.errors);
      }
    }

    // 3. Update device shadow reported state
    const shadowService = new ShadowService(fastify.db, fastify);
    await shadowService.updateReported(device_id, params);

    // 4. Write to property history
    const now = new Date();
    const historyRecords = Object.entries(params).map(([key, value]) => ({
      deviceId: device_id,
      identifier: key,
      value: value as any,
      timestamp: now,
    }));

    if (historyRecords.length > 0) {
      await fastify.db.devicePropertyHistory.createMany({ data: historyRecords });
    }

    // 5. Refresh device online status in Redis
    await fastify.setDeviceOnline(device_id);

    const resp = success({ received: true, properties_count: Object.keys(params).length });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/event-report - 设备事件上报回调
  fastify.post('/api/internal/mqtt/event-report', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'params'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              params: {
                type: 'object',
                required: ['event_id', 'event_type', 'output_params'],
                properties: {
                  event_id: { type: 'string' },
                  event_type: { type: 'string' },
                  event_time: { type: 'number' },
                  output_params: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const { event_id, event_type, output_params } = payload.params;

    await fastify.db.deviceEventLog.create({
      data: {
        deviceId: device_id,
        eventId: event_id,
        eventType: event_type,
        payload: output_params,
      },
    });

    await fastify.setDeviceOnline(device_id);

    const resp = success({ received: true, event_id });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/action-reply - 设备行为调用回复
  fastify.post('/api/internal/mqtt/action-reply', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'clientToken'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              code: { type: 'integer' },
              msg: { type: 'string' },
              data: { type: 'object' },
              version: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const { code: respCode, data, msg } = payload;

    const status = respCode === 0 ? 'success' : 'failed';

    await fastify.db.deviceActionLog.updateMany({
      where: { deviceId: device_id, callId: payload.clientToken, status: 'pending' },
      data: {
        status,
        outputParams: data?.output_params ?? {},
        errorCode: respCode !== 0 ? String(respCode) : null,
        errorMsg: respCode !== 0 ? msg : null,
        executedAt: new Date(),
      },
    });

    const resp = success({ received: true, call_id: payload.clientToken, status });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/shadow-update - 设备影子更新回调
  fastify.post('/api/internal/mqtt/shadow-update', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              payload: {
                type: 'object',
                properties: {
                  state: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const reported = payload.payload?.state?.reported;

    if (reported && typeof reported === 'object' && Object.keys(reported).length > 0) {
      const shadowService = new ShadowService(fastify.db, fastify);
      await shadowService.updateReported(device_id, reported);
    }

    const resp = success({ received: true });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/online - 设备上线通知
  fastify.post('/api/internal/mqtt/online', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          client_id: { type: 'string' },
          ip_address: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id } = request.body as any;

    await fastify.db.device.update({
      where: { deviceId: device_id },
      data: { status: 'online', lastLoginAt: new Date() },
    }).catch(() => { /* device may not exist in DB yet */ });

    await fastify.setDeviceOnline(device_id);

    const resp = success({ status: 'online', device_id });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/offline - 设备离线通知
  fastify.post('/api/internal/mqtt/offline', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          client_id: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id } = request.body as any;

    await fastify.db.device.update({
      where: { deviceId: device_id },
      data: { status: 'offline', lastLogoutAt: new Date() },
    }).catch(() => {});

    await fastify.delDeviceOnline(device_id);

    const resp = success({ status: 'offline', device_id });
    reply.code(resp.statusCode).send(resp.body);
  });
}
