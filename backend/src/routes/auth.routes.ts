import type { FastifyInstance } from 'fastify';
import { DeviceService } from '../services/device.service.js';
import { success } from '../shared/response.js';
import { UnauthorizedError, DeviceAuthError } from '../shared/errors.js';
import { timingSafeEqual } from '../shared/crypto.js';
import { config } from '../config/index.js';
import jwt from 'jsonwebtoken';
import type { JwtDevicePayload } from '../types/index.js';

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/device - 设备认证获取连接令牌
  fastify.post('/api/v1/auth/device', {
    schema: {
      body: {
        type: 'object',
        required: ['product_id', 'device_name', 'device_secret'],
        properties: {
          product_id: { type: 'string', minLength: 1 },
          device_name: { type: 'string', minLength: 1 },
          device_secret: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { product_id, device_name, device_secret } = request.body as any;
    const service = new DeviceService(fastify.db, fastify);
    const result = await service.authenticate({ product_id, device_name, device_secret });
    const resp = success(result);
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/auth/platform-token - 获取平台API Token
  fastify.post('/api/v1/auth/platform-token', {
    schema: {
      body: {
        type: 'object',
        required: ['app_key', 'app_secret'],
        properties: {
          app_key: { type: 'string' },
          app_secret: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { app_key, app_secret } = request.body as any;

    if (app_key !== config.appKey) {
      throw new UnauthorizedError('AppKey 无效');
    }
    if (!timingSafeEqual(app_secret, config.appSecret)) {
      throw new UnauthorizedError('AppSecret 无效');
    }

    const token = fastify.jwt.sign(
      { appKey: app_key, scope: 'platform' },
      { expiresIn: config.jwtExpiresIn },
    );

    const resp = success({
      access_token: token,
      expires_in: 86400,
      token_type: 'Bearer',
    });
    reply.code(resp.statusCode).send(resp.body);
  });
}
