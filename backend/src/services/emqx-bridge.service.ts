import { config } from '../config/index.js';

type FastifyLogger = {
  debug: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
} | undefined;

/**
 * EMQX 管理 API 桥(仅下行推送用)。
 *
 * 通过 POST {EMQX_API_BASE}/api/v5/publish 把云端消息推到设备订阅的下行 topic。
 * - EMQX_API_KEY / EMQX_API_SECRET 未配置时整体 no-op(调试日志提示), 不影响主链路
 * - 调用方一律 fire-and-forget: 推送失败只记 warn, 不抛错(与规则引擎 dispatch 同模式)
 */
export class EmqxBridgeService {
  private readonly enabled: boolean;
  private readonly authHeader: string;

  constructor() {
    this.enabled = Boolean(config.emqxApiKey && config.emqxApiSecret);
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.emqxApiKey}:${config.emqxApiSecret}`).toString('base64');
  }

  /** 推送 JSON payload 到指定 topic。返回是否成功(未启用/失败均 false)。 */
  async publish(topic: string, payload: object, log?: FastifyLogger): Promise<boolean> {
    if (!this.enabled) {
      log?.debug({ topic }, 'EMQX bridge disabled (EMQX_API_KEY not configured), skip publish');
      return false;
    }
    try {
      const res = await fetch(`${config.emqxApiBase}/api/v5/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify({
          topic,
          payload: JSON.stringify(payload),
          qos: 1,
          payload_encoding: 'plain',
          retain: false,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        if (log) log.warn({ topic, status: res.status }, 'EMQX publish failed');
        else console.warn('[emqx-bridge]', `EMQX publish failed: ${topic} -> ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      if (log) log.warn({ topic, err: (err as Error).message }, 'EMQX publish error');
      else console.warn('[emqx-bridge]', `EMQX publish error: ${topic} -> ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * 推送影子 desired 通知到 `$shadow/get/accepted/{ProductId}/{DeviceName}`。
   * payload 形状参考 backend-design/json-payload-examples/12-shadow-mqtt-cloud-reply.json。
   */
  async publishShadowAccepted(
    productId: string,
    deviceName: string,
    doc: {
      version: number;
      desiredVersion: number;
      desired: Record<string, unknown>;
      delta: Record<string, unknown>;
    },
    log?: FastifyLogger,
  ): Promise<boolean> {
    return this.publish(
      `$shadow/get/accepted/${productId}/${deviceName}`,
      {
        method: 'shadow.get.accepted',
        clientToken: `cloud-${Date.now()}`,
        version: String(doc.version),
        payload: {
          state: { desired: doc.desired, delta: doc.delta },
          desiredVersion: doc.desiredVersion,
          version: doc.version,
          timestamp: Date.now(),
        },
      },
      log,
    );
  }
}
