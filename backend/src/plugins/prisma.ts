import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: import('@prisma/client').PrismaClient;
  }
}

export default fp(
  async function prismaPlugin(fastify: FastifyInstance) {
    const prisma = new PrismaClient({
      log:
        config.nodeEnv === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });

    await prisma.$connect();

    fastify.decorate('db', prisma);

    fastify.addHook('onClose', async (instance: FastifyInstance) => {
      await instance.db.$disconnect();
    });
  },
  { name: 'prisma' },
);
