/**
 * API Explorer 路由: 平台 API 目录 / 在线调试代理 / 调用历史
 *
 * 在线调试实现: fastify.inject() 进程内完整生命周期执行目标路由
 * (含目标路由自身的 JWT 校验与 schema 校验), 透传调用者 Authorization。
 * 白名单 = 目录 invocable 条目; method/path 模板由后端决定, 前端只填参数值。
 */

import type { FastifyInstance } from 'fastify';
import {
  API_CATALOG,
  API_GROUPS,
  ApiExplorerService,
  buildInvokeRequest,
  findApiById,
  truncateForStore,
} from '../services/api-catalog.service.js';
import { success } from '../shared/response.js';
import { ApiNotFoundError } from '../shared/errors.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export default async function apiExplorerRoutes(fastify: FastifyInstance) {
  const service = new ApiExplorerService(fastify.db);

  // GET /api/v1/api-explorer/catalog - API 目录(分组 + 全部条目)
  fastify.get('/api/v1/api-explorer/catalog', {}, async (_request, reply) => {
    const invocableCount = API_CATALOG.filter((e) => e.invocable).length;
    const resp = success({
      groups: API_GROUPS,
      apis: API_CATALOG,
      total: API_CATALOG.length,
      invocable_count: invocableCount,
    });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/v1/api-explorer/invoke - 在线调试代理
  fastify.post(
    '/api/v1/api-explorer/invoke',
    {
      schema: {
        body: {
          type: 'object',
          required: ['api_id'],
          properties: {
            api_id: { type: 'string', minLength: 1, maxLength: 64 },
            path_params: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 256 },
            },
            query_params: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 256 },
            },
            body: { type: ['object', 'array', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const {
        api_id: apiId,
        path_params: pathParams,
        query_params: queryParams,
        body: invokeBody,
      } = request.body as {
        api_id: string;
        path_params?: Record<string, string>;
        query_params?: Record<string, string>;
        body?: Record<string, unknown> | unknown[] | null;
      };

      const entry = findApiById(API_CATALOG, apiId);
      if (!entry || !entry.invocable) {
        throw new ApiNotFoundError(`API 不存在或不可调试: ${apiId}`);
      }

      const built = buildInvokeRequest(entry, {
        path: pathParams,
        query: queryParams,
      });

      const hasBody = BODY_METHODS.has(built.method) && invokeBody != null;
      const authorization = request.headers.authorization ?? '';

      const start = performance.now();
      const res = await fastify.inject({
        method: built.method,
        url: built.url,
        headers: {
          authorization,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(hasBody ? { payload: JSON.stringify(invokeBody) } : {}),
      });
      const durationMs = Math.max(1, Math.round(performance.now() - start));

      const payload = res.payload;
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(payload);
      } catch {
        responseBody = payload;
      }

      const stored = truncateForStore(payload);
      await service.recordInvoke({
        apiId: entry.id,
        method: built.method,
        path: built.url,
        statusCode: res.statusCode,
        durationMs,
        requestBody: hasBody
          ? JSON.stringify(invokeBody).slice(0, 2048)
          : null,
        responseBody: stored.text,
        truncated: stored.truncated,
      });

      const resp = success({
        api_id: entry.id,
        status_code: res.statusCode,
        duration_ms: durationMs,
        request_url: built.url,
        response_body: responseBody,
      });
      reply.code(resp.statusCode).send(resp.body);
    },
  );

  // GET /api/v1/api-explorer/history - 最近调用记录 + 全表统计
  fastify.get(
    '/api/v1/api-explorer/history',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const query = request.query as { limit?: number };
      const limit = query.limit ?? 20;

      const [items, stats] = await Promise.all([
        service.listHistory(limit),
        service.getStats(),
      ]);

      const resp = success({
        items: items.map((l) => ({
          id: l.id,
          api_id: l.apiId,
          method: l.method,
          path: l.path,
          status_code: l.statusCode,
          duration_ms: l.durationMs,
          truncated: l.truncated,
          time: l.createdAt,
        })),
        stats,
      });
      reply.code(resp.statusCode).send(resp.body);
    },
  );
}
