import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * 规则引擎 — 设备上行消息转发
 *
 * 数据流: internal 上报回调 → dispatch() → 规则匹配 → 转发执行 → 日志落库
 * 转发失败不影响上报主链路(只落 failed 日志)。
 */

export interface UpstreamMessage {
  productId: string;
  deviceId: string;
  deviceName: string;
  messageType: 'property' | 'event';
  /** property: 上报的 params; event: { eventId, eventType, outputParams } */
  payload: Record<string, unknown>;
}

export interface RuleRecord {
  id: string;
  name: string;
  status: string;
  productId: string;
  messageType: string;
  filter: Prisma.JsonValue;
  targetType: string;
  targetConfig: Prisma.JsonValue;
}

export interface TargetResult {
  result: 'success' | 'failed';
  errorMsg: string | null;
  latencyMs: number;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const HTTP_TIMEOUT_MS = 5_000;

/** 组装真实的 MQTT topic 展示 */
export function buildTopic(msg: UpstreamMessage): string {
  if (msg.messageType === 'event') {
    const eventId = String(msg.payload['eventId'] ?? 'event');
    return `$thing/up/${msg.productId}/${msg.deviceName}/event/${eventId}`;
  }
  return `$thing/up/${msg.productId}/${msg.deviceName}/property/post`;
}

/** 规则匹配: 产品 + 消息类型 + 启用状态 + 筛选条件 */
export function matchRules(rules: RuleRecord[], msg: UpstreamMessage): RuleRecord[] {
  return rules.filter((rule) => {
    if (rule.status !== 'enabled') return false;
    if (rule.productId !== msg.productId) return false;
    if (rule.messageType !== msg.messageType) return false;

    const filter = (rule.filter ?? {}) as {
      identifiers?: unknown;
      eventTypes?: unknown;
    };

    if (msg.messageType === 'property') {
      const identifiers = Array.isArray(filter.identifiers)
        ? filter.identifiers.map(String).filter(Boolean)
        : [];
      if (identifiers.length === 0) return true;
      const reportedKeys = Object.keys(msg.payload);
      return identifiers.some((id) => reportedKeys.includes(id));
    }

    const eventTypes = Array.isArray(filter.eventTypes)
      ? filter.eventTypes.map(String).filter(Boolean)
      : [];
    if (eventTypes.length === 0) return true;
    return eventTypes.includes(String(msg.payload['eventType'] ?? ''));
  });
}

/** 执行转发目标(http: POST JSON; republish: 无 EMQX 环境模拟成功) */
export async function executeTarget(
  rule: RuleRecord,
  msg: UpstreamMessage,
  fetchImpl: FetchImpl = fetch,
): Promise<TargetResult> {
  const started = Date.now();
  const config = (rule.targetConfig ?? {}) as { url?: unknown; topic?: unknown };

  if (rule.targetType === 'http') {
    const url = typeof config.url === 'string' ? config.url : '';
    if (!url) {
      return { result: 'failed', errorMsg: '规则未配置转发 URL', latencyMs: 0 };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rule_id: rule.id,
            rule_name: rule.name,
            device_id: msg.deviceId,
            device_name: msg.deviceName,
            product_id: msg.productId,
            message_type: msg.messageType,
            topic: buildTopic(msg),
            payload: msg.payload,
            forwarded_at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          return {
            result: 'failed',
            errorMsg: `目标返回 HTTP ${res.status}`,
            latencyMs: Date.now() - started,
          };
        }
        return { result: 'success', errorMsg: null, latencyMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        result: 'failed',
        errorMsg: aborted ? `转发超时(${HTTP_TIMEOUT_MS}ms)` : (err instanceof Error ? err.message : String(err)),
        latencyMs: Date.now() - started,
      };
    }
  }

  if (rule.targetType === 'republish') {
    // 无 EMQX 环境: 模拟消息重发布成功
    return { result: 'success', errorMsg: null, latencyMs: Date.now() - started };
  }

  return { result: 'failed', errorMsg: `未知转发类型: ${rule.targetType}`, latencyMs: 0 };
}

export class RuleEngineService {
  constructor(
    private readonly db: PrismaClient,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  /**
   * 消息分发入口 — 匹配规则并逐条转发, 全程兜底不抛错。
   * 返回写入的日志条数(便于测试与调试)。
   */
  async dispatch(msg: UpstreamMessage): Promise<number> {
    try {
      const rules = await this.db.forwardRule.findMany({
        where: { productId: msg.productId, messageType: msg.messageType },
      });
      const matched = matchRules(rules as unknown as RuleRecord[], msg);
      if (matched.length === 0) return 0;

      const topic = buildTopic(msg);
      const logs: Prisma.ForwardLogCreateManyInput[] = [];

      for (const rule of matched) {
        const outcome = await executeTarget(rule as unknown as RuleRecord, msg, this.fetchImpl);
        logs.push({
          ruleId: rule.id,
          ruleName: rule.name,
          deviceId: msg.deviceId,
          messageType: msg.messageType,
          topic,
          payload: msg.payload as Prisma.InputJsonValue,
          result: outcome.result,
          errorMsg: outcome.errorMsg,
          latencyMs: outcome.latencyMs,
        });
      }

      await this.db.forwardLog.createMany({ data: logs });
      return logs.length;
    } catch (err) {
      // 规则引擎故障不阻断上报主链路
      console.error('[rule-engine] dispatch failed:', err);
      return 0;
    }
  }
}
