import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { config, isDev } from './config/index.js';
import { IotError, ValidationError, InternalError } from './shared/errors.js';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';

import productRoutes from './routes/product.routes.js';
import deviceRoutes from './routes/device.routes.js';
import authRoutes from './routes/auth.routes.js';
import shadowRoutes from './routes/shadow.routes.js';
import internalRoutes from './routes/internal.routes.js';

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
});

await fastify.register(prismaPlugin);
await fastify.register(redisPlugin);

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

export default fastify;
