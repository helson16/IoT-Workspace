import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  matchRules,
  buildTopic,
  executeTarget,
  RuleEngineService,
  type RuleRecord,
  type UpstreamMessage,
  type FetchImpl,
} from '../../src/services/rule-engine.service.js';

// ---------------- 测试夹具 ----------------

function makeRule(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: 'rule-1',
    name: '测试规则',
    status: 'enabled',
    productId: 'prod-a1b2c3d4',
    messageType: 'property',
    filter: {},
    targetType: 'http',
    targetConfig: { url: 'http://target.example.com/hook' },
    ...overrides,
  };
}

function makeMsg(overrides: Partial<UpstreamMessage> = {}): UpstreamMessage {
  return {
    productId: 'prod-a1b2c3d4',
    deviceId: 'dev-0001',
    deviceName: 'dev001',
    messageType: 'property',
    payload: { temperature: 25.1, humidity: 60 },
    ...overrides,
  };
}

const okResponse = () => new Response('{"ok":true}', { status: 200 });

// ---------------- matchRules ----------------

describe('matchRules', () => {
  it('匹配同产品同类型的启用规则', () => {
    const rules = [makeRule()];
    expect(matchRules(rules, makeMsg())).toHaveLength(1);
  });

  it('跳过已禁用规则', () => {
    const rules = [makeRule({ status: 'disabled' })];
    expect(matchRules(rules, makeMsg())).toHaveLength(0);
  });

  it('跳过产品不匹配的规则', () => {
    const rules = [makeRule({ productId: 'prod-other000' })];
    expect(matchRules(rules, makeMsg())).toHaveLength(0);
  });

  it('跳过消息类型不匹配的规则', () => {
    const rules = [makeRule({ messageType: 'event' })];
    expect(matchRules(rules, makeMsg())).toHaveLength(0);
  });

  it('property 无 identifiers 筛选 = 转发全部', () => {
    const rules = [makeRule({ filter: {} })];
    expect(matchRules(rules, makeMsg())).toHaveLength(1);
  });

  it('property identifiers 与上报键有交集即匹配', () => {
    const rules = [makeRule({ filter: { identifiers: ['temperature'] } })];
    expect(matchRules(rules, makeMsg())).toHaveLength(1);

    const rules2 = [makeRule({ filter: { identifiers: ['pressure'] } })];
    expect(matchRules(rules2, makeMsg())).toHaveLength(0);
  });

  it('event 规则按 eventType 筛选', () => {
    const msg = makeMsg({
      messageType: 'event',
      payload: { eventId: 'high_temp', eventType: 'warn', outputParams: {} },
    });
    const match = makeRule({
      messageType: 'event',
      filter: { eventTypes: ['warn', 'alert'] },
    });
    const noMatch = makeRule({
      messageType: 'event',
      filter: { eventTypes: ['info'] },
    });
    const all = makeRule({ messageType: 'event', filter: {} });

    expect(matchRules([match], msg)).toHaveLength(1);
    expect(matchRules([noMatch], msg)).toHaveLength(0);
    expect(matchRules([all], msg)).toHaveLength(1);
  });

  it('多个规则只返回匹配子集', () => {
    const rules = [
      makeRule({ id: 'a', name: 'A' }),
      makeRule({ id: 'b', status: 'disabled' }),
      makeRule({ id: 'c', productId: 'prod-other000' }),
    ];
    const matched = matchRules(rules, makeMsg());
    expect(matched.map((r) => r.id)).toEqual(['a']);
  });
});

// ---------------- buildTopic ----------------

describe('buildTopic', () => {
  it('property 消息组装 property/post topic', () => {
    expect(buildTopic(makeMsg())).toBe(
      '$thing/up/prod-a1b2c3d4/dev001/property/post',
    );
  });

  it('event 消息组装 event/{eventId} topic', () => {
    const msg = makeMsg({
      messageType: 'event',
      payload: { eventId: 'high_temp', eventType: 'warn' },
    });
    expect(buildTopic(msg)).toBe('$thing/up/prod-a1b2c3d4/dev001/event/high_temp');
  });
});

// ---------------- executeTarget ----------------

describe('executeTarget', () => {
  it('http 目标 2xx 返回 success 并计算耗时', async () => {
    const fetcher: FetchImpl = vi.fn(async () => okResponse());
    const outcome = await executeTarget(makeRule(), makeMsg(), fetcher);
    expect(outcome.result).toBe('success');
    expect(outcome.errorMsg).toBeNull();
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('http 目标非 2xx 返回 failed 且带状态码', async () => {
    const fetcher: FetchImpl = vi.fn(
      async () => new Response('err', { status: 502 }),
    );
    const outcome = await executeTarget(makeRule(), makeMsg(), fetcher);
    expect(outcome.result).toBe('failed');
    expect(outcome.errorMsg).toBe('目标返回 HTTP 502');
  });

  it('http 网络异常返回 failed 且带错误信息', async () => {
    const fetcher: FetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const outcome = await executeTarget(makeRule(), makeMsg(), fetcher);
    expect(outcome.result).toBe('failed');
    expect(outcome.errorMsg).toBe('ECONNREFUSED');
  });

  it('http 目标未配置 URL 返回 failed', async () => {
    const fetcher: FetchImpl = vi.fn(async () => okResponse());
    const outcome = await executeTarget(
      makeRule({ targetConfig: {} }),
      makeMsg(),
      fetcher,
    );
    expect(outcome.result).toBe('failed');
    expect(outcome.errorMsg).toBe('规则未配置转发 URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('republish 目标模拟成功', async () => {
    const outcome = await executeTarget(
      makeRule({ targetType: 'republish', targetConfig: { topic: '$thing/down/x/y' } }),
      makeMsg(),
      vi.fn(),
    );
    expect(outcome.result).toBe('success');
  });

  it('未知目标类型返回 failed', async () => {
    const outcome = await executeTarget(
      makeRule({ targetType: 'kafka' }),
      makeMsg(),
      vi.fn(),
    );
    expect(outcome.result).toBe('failed');
    expect(outcome.errorMsg).toContain('未知转发类型');
  });

  it('转发请求体包含规则与消息上下文', async () => {
    const fetcher: FetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.rule_id).toBe('rule-1');
      expect(body.device_name).toBe('dev001');
      expect(body.payload.temperature).toBe(25.1);
      return okResponse();
    });
    await executeTarget(makeRule(), makeMsg(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------- dispatch ----------------

describe('RuleEngineService.dispatch', () => {
  function makeDb(rules: RuleRecord[]) {
    const written: Array<{ ruleId: string; result: string; latencyMs: number }> = [];
    const prisma = {
      forwardRule: {
        findMany: vi.fn(async () => rules),
      },
      forwardLog: {
        createMany: vi.fn(async ({ data }: { data: Array<{ ruleId: string; result: string }> }) => {
          for (const d of data) {
            written.push({ ...d, latencyMs: 0 } as never);
          }
          return { count: data.length };
        }),
      },
    };
    return { prisma, written };
  }

  it('匹配规则并写转发日志', async () => {
    const { prisma, written } = makeDb([
      makeRule({ id: 'a', name: 'A' }),
      makeRule({ id: 'b', name: 'B', status: 'disabled' }),
    ]);
    const fetcher: FetchImpl = vi.fn(async () => okResponse());
    const engine = new RuleEngineService(prisma as unknown as PrismaClient, fetcher);

    const count = await engine.dispatch(makeMsg());
    expect(count).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0]?.ruleId).toBe('a');
    expect(written[0]?.result).toBe('success');
  });

  it('无匹配规则时不写日志', async () => {
    const { prisma, written } = makeDb([makeRule({ productId: 'prod-other000' })]);
    const engine = new RuleEngineService(prisma as unknown as PrismaClient, vi.fn());

    const count = await engine.dispatch(makeMsg());
    expect(count).toBe(0);
    expect(written).toHaveLength(0);
  });

  it('转发失败只落 failed 日志不抛错', async () => {
    const { prisma, written } = makeDb([makeRule()]);
    const fetcher: FetchImpl = vi.fn(async () => new Response('err', { status: 500 }));
    const engine = new RuleEngineService(prisma as unknown as PrismaClient, fetcher);

    const count = await engine.dispatch(makeMsg());
    expect(count).toBe(1);
    expect(written[0]?.result).toBe('failed');
  });

  it('数据库异常时兜底返回 0 不抛错', async () => {
    const prisma = {
      forwardRule: {
        findMany: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const engine = new RuleEngineService(prisma as unknown as PrismaClient, vi.fn());

    await expect(engine.dispatch(makeMsg())).resolves.toBe(0);
  });
});
