import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: import('ioredis').Redis;
    getShadowCache(deviceId: string): Promise<string | null>;
    setShadowCache(deviceId: string, data: string): Promise<void>;
    delShadowCache(deviceId: string): Promise<void>;
    setDeviceOnline(deviceId: string): Promise<void>;
    delDeviceOnline(deviceId: string): Promise<void>;
    isDeviceOnline(deviceId: string): Promise<boolean>;
  }
}

export default fp(
  async function redisPlugin(fastify: FastifyInstance) {
    const redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    await redis.connect();

    fastify.decorate('redis', redis);

    fastify.decorate('getShadowCache', async (deviceId: string): Promise<string | null> => {
      return redis.get(`shadow:${deviceId}`);
    });

    fastify.decorate('setShadowCache', async (deviceId: string, data: string): Promise<void> => {
      await redis.set(`shadow:${deviceId}`, data, 'EX', config.shadowCacheTtl);
    });

    fastify.decorate('delShadowCache', async (deviceId: string): Promise<void> => {
      await redis.del(`shadow:${deviceId}`);
    });

    fastify.decorate('setDeviceOnline', async (deviceId: string): Promise<void> => {
      await redis.set(`device:online:${deviceId}`, Date.now().toString(), 'EX', 90);
    });

    fastify.decorate('delDeviceOnline', async (deviceId: string): Promise<void> => {
      await redis.del(`device:online:${deviceId}`);
    });

    fastify.decorate('isDeviceOnline', async (deviceId: string): Promise<boolean> => {
      const result = await redis.exists(`device:online:${deviceId}`);
      return result === 1;
    });

    fastify.addHook('onClose', async (instance: FastifyInstance) => {
      await instance.redis.quit();
    });
  },
  { name: 'redis' },
);
