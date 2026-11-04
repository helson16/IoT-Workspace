import type { FastifyInstance } from 'fastify';
import { ProductService } from '../services/product.service.js';
import { success, successCreated, paginated } from '../shared/response.js';

export default async function productRoutes(fastify: FastifyInstance) {
  const service = new ProductService(fastify.db);

  // POST /api/v1/products - 创建产品
  fastify.post('/api/v1/products', {
    schema: {
      body: {
        type: 'object',
        required: ['product_name'],
        properties: {
          product_name: { type: 'string', minLength: 1, maxLength: 128 },
          category: { type: 'string', maxLength: 64 },
          protocol_type: { type: 'string', enum: ['MQTT', 'CoAP', 'HTTP', 'WebSocket'] },
          network_type: { type: 'string', enum: ['WiFi', 'Cellular', 'Ethernet', 'BLE', 'ZigBee', 'LoRa', 'NB-IoT'] },
          data_protocol: { type: 'string' },
          auth_type: { type: 'string', enum: ['one-machine-one-secret', 'ticket-auth'] },
          node_type: { type: 'string', enum: ['device', 'gateway', 'sub-device'] },
          description: { type: 'string' },
          thing_model: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as any;
    const product = await service.create(body);
    const resp = successCreated(product);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/products - 获取产品列表
  fastify.get('/api/v1/products', {
    schema: {
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
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const pageSize = Number(query.page_size) || 20;
    const result = await service.list({ page, page_size: pageSize, status: query.status });
    const resp = paginated(result.items, result.total, page, pageSize);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/products/:productId - 获取产品详情
  fastify.get('/api/v1/products/:productId', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const product = await service.getById(productId);
    const resp = success(product);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PUT /api/v1/products/:productId - 更新产品信息
  fastify.put('/api/v1/products/:productId', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          product_name: { type: 'string', minLength: 1, maxLength: 128 },
          category: { type: 'string' },
          protocol_type: { type: 'string' },
          network_type: { type: 'string' },
          data_protocol: { type: 'string' },
          auth_type: { type: 'string' },
          node_type: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived', 'developing'] },
          thing_model: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const body = request.body as any;
    const product = await service.update(productId, body);
    const resp = success(product);
    reply.code(resp.statusCode).send(resp.body);
  });

  // DELETE /api/v1/products/:productId - 删除产品
  fastify.delete('/api/v1/products/:productId', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    await service.delete(productId);
    reply.code(200).send({ code: 0, message: 'success', data: null });
  });

  // GET /api/v1/products/:productId/thing-model - 获取物模型定义
  fastify.get('/api/v1/products/:productId/thing-model', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const snapshot = await service.getThingModelSnapshot(productId);
    const resp = success(snapshot);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PUT /api/v1/products/:productId/thing-model - 更新物模型定义
  fastify.put('/api/v1/products/:productId/thing-model', {
    schema: {
      params: {
        type: 'object',
        required: ['productId'],
        properties: { productId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['version', 'properties'],
        properties: {
          version: { type: 'string' },
          profile: { type: 'object' },
          properties: { type: 'array', items: { type: 'object' } },
          events: { type: 'array', items: { type: 'object' } },
          actions: { type: 'array', items: { type: 'object' } },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { productId } = request.params as any;
    const body = request.body as any;
    const snapshot = await service.updateThingModel(productId, body);
    const resp = success(snapshot);
    reply.code(resp.statusCode).send(resp.body);
  });
}
