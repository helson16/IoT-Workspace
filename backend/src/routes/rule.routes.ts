import type { FastifyInstance } from 'fastify';
import { ForwardRuleService } from '../services/forward-rule.service.js';
import { success, successCreated } from '../shared/response.js';

const NAME_PATTERN = '^[^\\s].{0,63}$'; // 非空白开头, ≤64 字符

export default async function ruleRoutes(fastify: FastifyInstance) {
  const service = new ForwardRuleService(fastify.db);

  const ruleBodySchema = {
    type: 'object',
    required: ['name', 'product_id', 'message_type', 'target_type', 'target_config'],
    properties: {
      name: { type: 'string', pattern: NAME_PATTERN },
      description: { type: 'string', maxLength: 256 },
      product_id: { type: 'string', minLength: 1 },
      message_type: { type: 'string', enum: ['property', 'event'] },
      filter: {
        type: 'object',
        properties: {
          identifiers: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 32 },
          eventTypes: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 16 },
        },
        additionalProperties: false,
      },
      target_type: { type: 'string', enum: ['http', 'republish'] },
      target_config: {
        type: 'object',
        properties: {
          url: { type: 'string', maxLength: 512 },
          topic: { type: 'string', maxLength: 255 },
        },
        additionalProperties: false,
      },
      status: { type: 'string', enum: ['enabled', 'disabled'] },
    },
    additionalProperties: false,
  } as const;

  type RuleBody = {
    name: string;
    description?: string;
    product_id: string;
    message_type: string;
    filter?: { identifiers?: string[]; eventTypes?: string[] };
    target_type: string;
    target_config: { url?: string; topic?: string };
    status?: string;
  };

  const toServiceInput = (body: RuleBody) => ({
    name: body.name,
    description: body.description ?? null,
    productId: body.product_id,
    messageType: body.message_type,
    filter: (body.filter ?? {}) as Record<string, unknown>,
    targetType: body.target_type,
    targetConfig: body.target_config as Record<string, unknown>,
    status: body.status,
  });

  // GET /api/v1/forward-rules - 规则列表(含今日转发统计)
  fastify.get('/api/v1/forward-rules', async (_request, reply) => {
    const rules = await service.list();
    const resp = success(rules);
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/forward-rules - 创建规则
  fastify.post('/api/v1/forward-rules', {
    schema: { body: ruleBodySchema },
  }, async (request, reply) => {
    const rule = await service.create(toServiceInput(request.body as RuleBody));
    const resp = successCreated(rule);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PUT /api/v1/forward-rules/:id - 更新规则
  fastify.put('/api/v1/forward-rules/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: ruleBodySchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = await service.update(id, toServiceInput(request.body as RuleBody));
    const resp = success(rule);
    reply.code(resp.statusCode).send(resp.body);
  });

  // PATCH /api/v1/forward-rules/:id/status - 启停切换
  fastify.patch('/api/v1/forward-rules/:id/status', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['enabled', 'disabled'] } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status: ruleStatus } = request.body as { status: string };
    const rule = await service.toggleStatus(id, ruleStatus);
    const resp = success(rule);
    reply.code(resp.statusCode).send(resp.body);
  });

  // DELETE /api/v1/forward-rules/:id - 删除规则
  fastify.delete('/api/v1/forward-rules/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.delete(id);
    reply.code(200).send({ code: 0, message: 'success', data: null });
  });

  // GET /api/v1/forward-rules/logs - 转发日志(分页+筛选)
  fastify.get('/api/v1/forward-rules/logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          result: { type: 'string', enum: ['success', 'failed'] },
          rule_id: { type: 'string' },
          message_type: { type: 'string', enum: ['property', 'event'] },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as {
      result?: string;
      rule_id?: string;
      message_type?: string;
      page?: number;
      page_size?: number;
    };
    const logs = await service.listLogs({
      result: q.result,
      ruleId: q.rule_id,
      messageType: q.message_type,
      page: q.page,
      pageSize: q.page_size,
    });
    const resp = success(logs);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/forward-rules/stats - 总览指标
  fastify.get('/api/v1/forward-rules/stats', async (_request, reply) => {
    const stats = await service.stats();
    const resp = success(stats);
    reply.code(resp.statusCode).send(resp.body);
  });

  // GET /api/v1/forward-rules/topics - 消息主题统计(真实聚合)
  fastify.get('/api/v1/forward-rules/topics', async (_request, reply) => {
    const topics = await service.topics();
    const resp = success(topics);
    reply.code(resp.statusCode).send(resp.body);
  });
}
