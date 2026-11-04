import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { config, isDev } from './config/index.js';
import { IotError, InternalError } from './shared/errors.js';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';

import productRoutes from './routes/product.routes.js';
import deviceRoutes from './routes/device.routes.js';
import authRoutes from './routes/auth.routes.js';
import shadowRoutes from './routes/shadow.routes.js';
import internalRoutes from './routes/internal.routes.js';
import statsRoutes from './routes/stats.routes.js';
import deviceGroupRoutes from './routes/device-group.routes.js';
import opsRoutes from './routes/ops.routes.js';
import ruleRoutes from './routes/rule.routes.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  },
});

await fastify.register(cors, {
  origin: isDev ? true : process.env['CORS_ORIGINS']?.split(',') ?? true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret'],
  credentials: true,
});

await fastify.register(jwt, {
  secret: config.jwtSecret,
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  // 内部链路(EMQX webhook / 设备模拟器 / 规则引擎转发回环)不受 IP 限流约束:
  // 其自身已有 X-Internal-Secret 鉴权, 且 dev 环境全部流量来自 127.0.0.1 同一桶,
  // 规则引擎转发会成倍放大请求数, 不豁免将误伤上报主链路。
  allowList: (request) => request.url.startsWith('/api/internal/'),
});

await fastify.register(prismaPlugin);
await fastify.register(redisPlugin);

// ============================================================
// JWT 认证保护: /api/v1/* 必须携带 Bearer Token
// 放行: /health, /api/v1/auth/*(token 签发), /api/internal/*(内部 secret 自行校验)
// ============================================================
const PUBLIC_PATH_PREFIXES = ['/api/v1/auth/'];

fastify.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0] ?? request.url;

  if (url === '/health' || url.startsWith('/api/internal/')) {
    return;
  }
  if (!url.startsWith('/api/v1/')) {
    return;
  }
  if (PUBLIC_PATH_PREFIXES.some((p) => url.startsWith(p))) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({
      code: 40101,
      message: '缺少访问令牌, 请先通过 /api/v1/auth/platform-token 获取',
      details: [],
    });
    return;
  }

  try {
    fastify.jwt.verify(authHeader.slice('Bearer '.length));
  } catch (err) {
    reply.code(401).send({
      code: 40102,
      message: '访问令牌无效或已过期',
      details: [],
    });
    return;
  }
});

fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
  if (error instanceof IotError) {
    void reply.code(error.statusCode).send({
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return;
  }

  if ('validation' in error && Array.isArray(error.validation)) {
    const details = error.validation.map((v: any) => ({
      field: v.instancePath || v.params?.missingProperty || '/',
      message: v.message ?? 'Validation failed',
    }));

    void reply.code(400).send({
      code: 40001,
      message: '请求参数验证失败',
      details,
    });
    return;
  }

  const internalError = new InternalError(
    error.message || 'Internal Server Error',
  );
  fastify.log.error({
    err: error,
    reqId: request.id,
    url: request.url,
    method: request.method,
  }, 'Unhandled error');

  void reply.code(internalError.statusCode).send({
    code: internalError.code,
    message: internalError.message,
    details: internalError.details,
  });
});

fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: Date.now(),
}));

await fastify.register(productRoutes);
await fastify.register(deviceRoutes);
await fastify.register(authRoutes);
await fastify.register(shadowRoutes);
await fastify.register(internalRoutes);
await fastify.register(statsRoutes);
await fastify.register(deviceGroupRoutes);
await fastify.register(opsRoutes);
await fastify.register(ruleRoutes);

export default fastify;
