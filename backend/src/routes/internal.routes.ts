import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { ShadowService } from '../services/shadow.service.js';
import { RuleEngineService } from '../services/rule-engine.service.js';
import { recordAuthLog } from '../services/security.service.js';
import { AvService } from '../services/av.service.js';
import { thingModelValidator } from '../shared/validator.js';
import { success } from '../shared/response.js';
import { UnauthorizedError, PropertyValueInvalidError, DeviceNotFoundError } from '../shared/errors.js';

export default async function internalRoutes(fastify: FastifyInstance) {
  // Internal auth middleware
  const internalAuth = async (request: any) => {
    const secret = request.headers['x-internal-secret'];
    if (!secret || !config.internalSecret) {
      throw new UnauthorizedError('缺少内部认证凭据');
    }
    const { timingSafeEqual } = await import('../shared/crypto.js');
    if (!timingSafeEqual(String(secret), config.internalSecret)) {
      throw new UnauthorizedError('内部认证失败');
    }
  };

  const ruleEngine = new RuleEngineService(fastify.db);

  // POST /api/internal/mqtt/property-report - 设备属性上报回调
  fastify.post('/api/internal/mqtt/property-report', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'product_id', 'device_name', 'payload'],
        properties: {
          device_id: { type: 'string' },
          product_id: { type: 'string' },
          device_name: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'params'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              params: { type: 'object' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, product_id, payload } = request.body as any;
    const params = payload.params;

    // 1. Load thing model properties for validation
    const properties = await fastify.db.thingModelProperty.findMany({
      where: { productId: product_id },
      orderBy: { sortOrder: 'asc' },
    });

    // 2. Validate property values against thing model
    if (properties.length > 0) {
      const validation = thingModelValidator.validatePropertyValues(
        properties.map((p: any) => ({
          identifier: p.identifier,
          dataType: p.dataType,
          spec: p.spec,
          accessMode: p.accessMode,
        })),
        params,
      );
      if (!validation.valid && validation.errors && validation.errors.length > 0) {
        throw new PropertyValueInvalidError('属性值校验失败', validation.errors);
      }
    }

    // 3. Update device shadow reported state
    const shadowService = new ShadowService(fastify.db, fastify);
    await shadowService.updateReported(device_id, params);

    // 4. Write to property history
    const now = new Date();
    const historyRecords = Object.entries(params).map(([key, value]) => ({
      deviceId: device_id,
      identifier: key,
      value: value as any,
      timestamp: now,
    }));

    if (historyRecords.length > 0) {
      await fastify.db.devicePropertyHistory.createMany({ data: historyRecords });
    }

    // 5. Refresh device online status in Redis
    await fastify.setDeviceOnline(device_id);

    // 6. 规则引擎分发(失败不影响上报主链路)
    const device = await fastify.db.device.findUnique({
      where: { deviceId: device_id },
      select: { deviceName: true, productId: true },
    });
    if (device) {
      void ruleEngine.dispatch({
        productId: device.productId,
        deviceId: device_id,
        deviceName: device.deviceName,
        messageType: 'property',
        payload: params,
      });
    }

    const resp = success({ received: true, properties_count: Object.keys(params).length });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/event-report - 设备事件上报回调
  fastify.post('/api/internal/mqtt/event-report', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'params'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              params: {
                type: 'object',
                required: ['event_id', 'event_type', 'output_params'],
                properties: {
                  event_id: { type: 'string' },
                  event_type: { type: 'string' },
                  event_time: { type: 'number' },
                  output_params: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const { event_id, event_type, output_params } = payload.params;

    await fastify.db.deviceEventLog.create({
      data: {
        deviceId: device_id,
        eventId: event_id,
        eventType: event_type,
        payload: output_params,
      },
    });

    await fastify.setDeviceOnline(device_id);

    // 规则引擎分发(失败不影响上报主链路)
    const device = await fastify.db.device.findUnique({
      where: { deviceId: device_id },
      select: { deviceName: true, productId: true },
    });
    if (device) {
      void ruleEngine.dispatch({
        productId: device.productId,
        deviceId: device_id,
        deviceName: device.deviceName,
        messageType: 'event',
        payload: {
          eventId: event_id,
          eventType: event_type,
          outputParams: output_params,
        },
      });
    }

    const resp = success({ received: true, event_id });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/av-report - 设备音视频事件上报回调
  // 摄像头设备录制/截图/回放完成后的元数据上报(仅元数据, 无真实视频流)。
  // 与 EMQX Webhook 调用本服务的路径一致, 供设备模拟器 / 真实网关使用。
  fastify.post('/api/internal/mqtt/av-report', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'events'],
        properties: {
          device_id: { type: 'string' },
          events: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              required: ['event_type'],
              properties: {
                event_type: { type: 'string', maxLength: 32 },
                status: { type: 'string', maxLength: 16 },
                file_name: { type: 'string', maxLength: 255 },
                file_size: { type: 'number' },
                duration_sec: { type: 'number' },
                stream_protocol: { type: 'string', maxLength: 16 },
                detail: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, events } = request.body as any;

    // 校验设备存在(取 deviceName 供文件名兜底), 不存在则 404
    const device = await fastify.db.device.findUnique({
      where: { deviceId: device_id },
      select: { deviceName: true },
    });
    if (!device) {
      throw new DeviceNotFoundError(`设备 ${device_id} 不存在`);
    }

    const avService = new AvService(fastify.db);
    const { received } = await avService.recordEvents(device_id, device.deviceName, events);

    await fastify.setDeviceOnline(device_id);

    const resp = success({ received: true, count: received });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/action-reply - 设备行为调用回复
  fastify.post('/api/internal/mqtt/action-reply', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method', 'clientToken'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              code: { type: 'integer' },
              msg: { type: 'string' },
              data: { type: 'object' },
              version: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const { code: respCode, data, msg } = payload;

    const status = respCode === 0 ? 'success' : 'failed';

    await fastify.db.deviceActionLog.updateMany({
      where: { deviceId: device_id, callId: payload.clientToken, status: 'pending' },
      data: {
        status,
        outputParams: data?.output_params ?? {},
        errorCode: respCode !== 0 ? String(respCode) : null,
        errorMsg: respCode !== 0 ? msg : null,
        executedAt: new Date(),
      },
    });

    const resp = success({ received: true, call_id: payload.clientToken, status });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/shadow-update - 设备影子更新回调
  fastify.post('/api/internal/mqtt/shadow-update', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'payload'],
        properties: {
          device_id: { type: 'string' },
          payload: {
            type: 'object',
            required: ['method'],
            properties: {
              method: { type: 'string' },
              clientToken: { type: 'string' },
              version: { type: 'string' },
              payload: {
                type: 'object',
                properties: {
                  state: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id, payload } = request.body as any;
    const reported = payload.payload?.state?.reported;

    if (reported && typeof reported === 'object' && Object.keys(reported).length > 0) {
      const shadowService = new ShadowService(fastify.db, fastify);
      await shadowService.updateReported(device_id, reported);
    }

    const resp = success({ received: true });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/online - 设备上线通知
  fastify.post('/api/internal/mqtt/online', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          client_id: { type: 'string' },
          ip_address: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id } = request.body as any;

    await fastify.db.device.update({
      where: { deviceId: device_id },
      data: { status: 'online', lastLoginAt: new Date() },
    }).catch(() => { /* device may not exist in DB yet */ });

    await fastify.setDeviceOnline(device_id);

    const resp = success({ status: 'online', device_id });
    reply.code(resp.statusCode).send(resp.body);
  });

  // POST /api/internal/mqtt/offline - 设备离线通知
  fastify.post('/api/internal/mqtt/offline', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
          client_id: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    await internalAuth(request);

    const { device_id } = request.body as any;

    await fastify.db.device.update({
      where: { deviceId: device_id },
      data: { status: 'offline', lastLogoutAt: new Date() },
    }).catch(() => {});

    await fastify.delDeviceOnline(device_id);

    const resp = success({ status: 'offline', device_id });
    reply.code(resp.statusCode).send(resp.body);
  });

  // ============================================================
  // POST /api/internal/echo - 转发目标回显端点
  // ============================================================
  // 作为规则引擎 HTTP 转发的演示/联调目标, 原样返回收到的载荷。
  // 受 X-Internal-Secret 保护; 演示规则转发的 URL 需附带该 Header 时,
  // 可由目标方自行鉴权(本端点仅回显, 不产生副作用)。
  // 注: 规则引擎转发的请求不含 X-Internal-Secret, 此处对 echo 放宽鉴权
  // 仅限 dev 演示用途。
  // ============================================================
  fastify.post('/api/internal/echo', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const resp = success({ received: true, echo: body, received_at: new Date().toISOString() });
    reply.code(resp.statusCode).send(resp.body);
  });

  // ============================================================
  // POST /api/internal/mqtt/auth - EMQX HTTP Authentication Hook
  // ============================================================
  // EMQX 在设备 CONNECT 时调用此接口。
  // 请求体由 EMQX 发送: { clientid, username, password }
  //
  // username 格式: {productId}{deviceName};{sdkAppId}
  //   例: "prod-a1b2c3d4dev-mock-01;12010126"
  // password 格式: {deviceSecret};hmacsha256
  //   例: "a3f8e2c1...;hmacsha256"
  //
  // 返回: HTTP 200 = 允许连接, HTTP 4xx/5xx = 拒绝连接
  // ============================================================
  fastify.post('/api/internal/mqtt/auth', async (request, reply) => {
    const { username, password, clientid } = request.body as any;

    fastify.log.debug({ clientid, username }, 'EMQX auth request');

    // 1. 校验 X-Internal-Secret（EMQX 配置中注入的 Header）
    const secret = request.headers['x-internal-secret'];
    if (!secret || !config.internalSecret) {
      reply.code(401).send();
      return;
    }
    const { timingSafeEqual, generateDeviceId } = await import('../shared/crypto.js');
    if (!timingSafeEqual(String(secret), config.internalSecret)) {
      reply.code(401).send();
      return;
    }

    // 2. 从 username 解析 productId + deviceName
    //    格式: {productId}{deviceName};{sdkAppId}
    //    productId 固定格式 prod-xxxxxxxx("prod-" 5 字符 + 8 hex = 13 字符,
    //    与 generateProductId() 一致; 此前误写 11 会导致解析错位认证必败)
    const semicolonIdx = username.indexOf(';');
    if (semicolonIdx === -1) {
      fastify.log.warn({ username }, 'Invalid username format: missing semicolon');
      reply.code(401).send();
      return;
    }
    const prefixPart = username.substring(0, semicolonIdx);

    const PRODUCT_ID_LEN = 13;
    if (prefixPart.length <= PRODUCT_ID_LEN) {
      fastify.log.warn({ username }, 'Invalid username format: too short');
      reply.code(401).send();
      return;
    }

    const productId = prefixPart.substring(0, PRODUCT_ID_LEN);
    const deviceName = prefixPart.substring(PRODUCT_ID_LEN);

    // 3. 从 password 提取 deviceSecret（去掉 ";hmacsha256" 后缀）
    const secretSuffix = ';hmacsha256';
    if (!password || !password.endsWith(secretSuffix)) {
      fastify.log.warn({ clientid }, 'Invalid password format: missing hmacsha256 suffix');
      reply.code(401).send();
      return;
    }
    const deviceSecret = password.substring(0, password.length - secretSuffix.length);

    // 4. 查找设备并校验密钥
    try {
      const device = await fastify.db.device.findUnique({
        where: {
          uq_device_product_name: { productId, deviceName },
        },
        select: {
          deviceId: true,
          deviceSecret: true,
          status: true,
          product: { select: { productName: true } },
        },
      });

      // 认证埋点: mqtt-connect 成功/失败均写 device_auth_logs(deviceId 为确定性 sha256)
      const logIp = request.ip;
      const logBase = (result: 'success' | 'failure', reason?: string) => ({
        deviceId: generateDeviceId(productId, deviceName),
        deviceName,
        productId,
        productName: device?.product?.productName ?? '',
        authType: 'mqtt-connect' as const,
        result,
        reason,
        ip: logIp,
      });

      if (!device) {
        fastify.log.warn({ productId, deviceName, clientid }, 'EMQX auth: device not found');
        void recordAuthLog(fastify.db, logBase('failure', 'Device not found'), fastify.log);
        reply.code(401).send();
        return;
      }

      if (device.status === 'disabled') {
        fastify.log.warn({ deviceId: device.deviceId }, 'EMQX auth: device is disabled');
        void recordAuthLog(fastify.db, logBase('failure', 'Device is disabled'), fastify.log);
        reply.code(403).send();
        return;
      }

      if (!timingSafeEqual(device.deviceSecret, deviceSecret)) {
        fastify.log.warn({ deviceId: device.deviceId }, 'EMQX auth: secret mismatch');
        void recordAuthLog(fastify.db, logBase('failure', 'Secret mismatch'), fastify.log);
        reply.code(401).send();
        return;
      }

      // 5. 认证成功 — 更新设备状态 + Redis 在线标记(顺带记录认证 IP)
      await fastify.db.device.update({
        where: { deviceId: device.deviceId },
        data: { status: 'online', lastLoginAt: new Date(), lastIp: request.ip },
      });
      await fastify.setDeviceOnline(device.deviceId);
      void recordAuthLog(fastify.db, logBase('success'), fastify.log);

      fastify.log.info(
        { deviceId: device.deviceId, productId, deviceName, clientid },
        'EMQX auth: device authenticated successfully',
      );

      // EMQX HTTP Auth: 200 = allow
      reply.code(200).send({ result: 'allow' });
    } catch (err) {
      fastify.log.error({ err, username, clientid }, 'EMQX auth: internal error');
      reply.code(500).send();
    }
  });
}
