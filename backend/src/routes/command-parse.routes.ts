/**
 * 自然语言指令解析路由 (方案 #1 第 8 节第 1 步)
 *
 * 只做解析, **不写影子** — 下发仍走 PUT /api/v1/shadows/:deviceId。
 * 本端点产出 proposed, 由前端预填进对话框, 人工确认后再下发。
 */
import type { FastifyInstance } from 'fastify';
import { success } from '../shared/response.js';
import { createCommandParseService } from '../services/command-parse.service.js';

/** 请求体上限: 一句自然语言描述不该更长 */
const TEXT_MAX_LENGTH = 500;

export default async function commandParseRoutes(fastify: FastifyInstance) {
  const service = createCommandParseService(fastify.db, {
    info: (obj, msg) => fastify.log.info(obj, msg),
    warn: (obj, msg) => fastify.log.warn(obj, msg),
  });

  // POST /api/v1/devices/:deviceId/command:parse - 自然语言 → desired 解析
  //
  // 路径末尾的字面量 `command:parse` 必须写成正则参数 `:action(command:parse)`:
  // find-my-way 会把裸写的 `command:parse` 解析成「静态前缀 command + 名为 parse 的参数」,
  // 从而吞掉 /command、/commandXparse、/command-parse 等所有同前缀路径。
  // 用正则参数把整个字面量钉死, 才能既保留带冒号的 URL 又不误伤兄弟路由。
  fastify.post('/api/v1/devices/:deviceId/:action(command:parse)', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string', maxLength: 128 } },
      },
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: TEXT_MAX_LENGTH },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const { text } = request.body as { text: string };
    const result = await service.parse(deviceId, text);
    const resp = success(result);
    reply.code(resp.statusCode).send(resp.body);
  });
}
