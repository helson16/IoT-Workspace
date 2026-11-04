import type { FastifyInstance } from 'fastify';
import {
  SecurityService,
  normalizeLogFilter,
} from '../services/security.service.js';
import { success } from '../shared/response.js';
import { ValidationError } from '../shared/errors.js';

export default async function securityRoutes(fastify: FastifyInstance) {
  const service = new SecurityService(fastify.db, {
    delDeviceOnline: (deviceId: string) => fastify.delDeviceOnline(deviceId),
  });

  // GET /api/v1/security/stats - 安全统计卡数据
  fastify.get('/api/v1/security/stats', {}, async (_request, reply) => {
    const stats = await service.getStats();
    const resp = success(stats);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/security/credentials - 设备凭证列表(不含密钥明文)
  fastify.get('/api/v1/security/credentials', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          keyword: { type: 'string', maxLength: 128 },
          status: { type: 'string', enum: ['online', 'offline', 'not-activated', 'disabled'] },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const pageSize = Number(query.page_size) || 20;
    const result = await service.listCredentials({
      page,
      page_size: pageSize,
      keyword: query.keyword,
      status: query.status,
    });
    const resp = success({
      items: result.items.map((c) => ({
        deviceId: c.deviceId,
        deviceName: c.deviceName,
        productId: c.productId,
        productName: c.productName,
        status: c.status,
        maskedSecret: c.maskedSecret,
        lastLoginAt: c.lastLoginAt,
        lastIp: c.lastIp,
        createdAt: c.createdAt,
      })),
      total: result.total,
      page,
      page_size: pageSize,
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/security/credentials/:deviceId - 查看设备密钥 + MQTT 连接配置
  fastify.get('/api/v1/security/credentials/:deviceId', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const detail = await service.getCredential(deviceId);
    const resp = success({
      deviceId: detail.deviceId,
      deviceName: detail.deviceName,
      productId: detail.productId,
      productName: detail.productName,
      status: detail.status,
      deviceSecret: detail.deviceSecret,
      lastLoginAt: detail.lastLoginAt,
      lastIp: detail.lastIp,
      mqttConfig: detail.mqttConfig,
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/security/credentials/:deviceId/rotate - 轮换设备密钥
  fastify.post('/api/v1/security/credentials/:deviceId/rotate', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const result = await service.rotateSecret(deviceId, request.ip);
    const resp = success({
      deviceId,
      deviceSecret: result.deviceSecret,
      message: '密钥已轮换, 旧密钥立即失效',
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // PATCH /api/v1/security/devices/:deviceId/status - 禁用/启用设备
  fastify.patch('/api/v1/security/devices/:deviceId/status', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['disable', 'enable'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as any;
    const { action } = request.body as any;
    if (action !== 'disable' && action !== 'enable') {
      throw new ValidationError('action must be disable or enable', [
        { field: 'action', message: 'Invalid action' },
      ]);
    }
    const result = await service.setDeviceStatus(deviceId, action, request.ip);
    const resp = success(result);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/security/auth-logs - 认证记录流
  fastify.get('/api/v1/security/auth-logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          auth_type: {
            type: 'string',
            enum: ['device-token', 'mqtt-connect', 'secret-rotate', 'status-change'],
          },
          result: { type: 'string', enum: ['success', 'failure'] },
          device_id: { type: 'string', maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const filter = normalizeLogFilter(request.query as any);
    const result = await service.listAuthLogs(filter);
    const resp = success({
      items: result.items.map((l) => ({
        id: l.id,
        time: l.time,
        deviceId: l.deviceId,
        deviceName: l.deviceName,
        productName: l.productName,
        authType: l.authType,
        result: l.result,
        reason: l.reason,
        ip: l.ip,
      })),
      total: result.total,
      page: filter.page,
      page_size: filter.page_size,
    });
    reply.code(resp.statusCode).send(resp.body);
  });
}
