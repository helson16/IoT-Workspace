import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ShadowService } from '../../src/services/shadow.service.js';
import { DeviceNotFoundError, ShadowVersionConflictError } from '../../src/shared/errors.js';
import type { ShadowDocument } from '../../src/types/index.js';

// ---------------- 内存 mock ----------------

interface ShadowRow {
  deviceId: string;
  reported: Record<string, unknown>;
  desired: Record<string, unknown>;
  desiredVersion: number;
  reportedVersion: number;
  metadata: { reported: Record<string, unknown>; desired: Record<string, unknown> };
  lastDesiredAt: Date | null;
  lastReportedAt: Date | null;
}

function createPrismaMock(rows: ShadowRow[]) {
  const store = new Map(rows.map((r) => [r.deviceId, structuredClone(r)]));
  const prisma = {
    deviceShadow: {
      findUnique: vi.fn(async ({ where }: { where: { deviceId: string } }) => {
        const row = store.get(where.deviceId);
        return row ? structuredClone(row) : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { deviceId: string }; data: object }) => {
        const row = store.get(where.deviceId);
        if (!row) throw new Error(`row not found: ${where.deviceId}`);
        const updated = { ...row, ...data } as ShadowRow;
        store.set(where.deviceId, updated);
        return structuredClone(updated);
      }),
    },
  };
  return { prisma, store };
}

function createRedisMock() {
  const cache = new Map<string, string>();
  return {
    cache,
    getShadowCache: vi.fn(async (id: string) => cache.get(id) ?? null),
    setShadowCache: vi.fn(async (id: string, data: string) => {
      cache.set(id, data);
    }),
    delShadowCache: vi.fn(async (id: string) => {
      cache.delete(id);
    }),
  };
}

function makeService(rows: ShadowRow[]) {
  const { prisma, store } = createPrismaMock(rows);
  const redis = createRedisMock();
  const service = new ShadowService(prisma as unknown as PrismaClient, {
    getShadowCache: redis.getShadowCache,
    setShadowCache: redis.setShadowCache,
    delShadowCache: redis.delShadowCache,
  });
  return { service, prisma: prisma.deviceShadow, redis, store };
}

const baseRow: ShadowRow = {
  deviceId: 'dev-001',
  reported: { temperature: 25 },
  desired: {},
  desiredVersion: 0,
  reportedVersion: 5,
  metadata: { reported: {}, desired: {} },
  lastDesiredAt: null,
  lastReportedAt: null,
};

// ---------------- computeDelta ----------------

describe('ShadowService.computeDelta', () => {
  const { service } = makeService([]);

  it('reported 缺失的 desired key 进入 delta', () => {
    const delta = service.computeDelta({ target: 26, mode: 'auto' }, { temperature: 25 });
    expect(delta).toEqual({ target: 26, mode: 'auto' });
  });

  it('reported 已满足的 desired key 不进入 delta', () => {
    const delta = service.computeDelta({ target: 26 }, { target: 26 });
    expect(delta).toEqual({});
  });

  it('值不同(深层比较)进入 delta', () => {
    const delta = service.computeDelta({ config: { a: 1 } }, { config: { a: 2 } });
    expect(delta).toEqual({ config: { a: 1 } });
  });

  it('desired 为空时 delta 为空(reported 多余字段不影响)', () => {
    expect(service.computeDelta({}, { temperature: 25 })).toEqual({});
  });
});

// ---------------- updateDesired ----------------

describe('ShadowService.updateDesired', () => {
  it('合并 desired + 版本递增 + 生成 delta + 缓存写入', async () => {
    const { service, redis } = makeService([structuredClone(baseRow)]);

    const doc = await service.updateDesired('dev-001', { target: 26 }, 0);

    expect(doc.state.desired).toEqual({ target: 26 });
    expect(doc.state.delta).toEqual({ target: 26 }); // reported 无 target
    expect(doc.version).toBe(5); // max(desiredVersion 0→1, reportedVersion 5)
    expect(doc.metadata.desired.target).toBeDefined();
    expect(redis.setShadowCache).toHaveBeenCalled();
  });

  it('多次下发按 key 合并而非整体替换', async () => {
    const { service, store } = makeService([structuredClone(baseRow)]);

    await service.updateDesired('dev-001', { target: 26 }, 0);
    await service.updateDesired('dev-001', { mode: 'auto' }, 1);

    expect(store.get('dev-001')?.desired).toEqual({ target: 26, mode: 'auto' });
  });

  it('版本不匹配抛出 ShadowVersionConflictError(乐观锁)', async () => {
    const { service } = makeService([structuredClone(baseRow)]);

    await expect(service.updateDesired('dev-001', { target: 26 }, 99)).rejects.toThrow(
      ShadowVersionConflictError,
    );
  });

  it('设备不存在抛出 DeviceNotFoundError', async () => {
    const { service } = makeService([structuredClone(baseRow)]);
    await expect(service.updateDesired('dev-404', { target: 26 }, 0)).rejects.toThrow(
      DeviceNotFoundError,
    );
  });
});

// ---------------- updateReported ----------------

describe('ShadowService.updateReported', () => {
  it('上报满足 desired 后该 key 自动从 desired 清除', async () => {
    const row: ShadowRow = {
      ...structuredClone(baseRow),
      desired: { target: 26 },
      desiredVersion: 1,
    };
    const { service, store } = makeService([row]);

    const doc = await service.updateReported('dev-001', { target: 26 });

    expect(doc.state.reported).toEqual({ temperature: 25, target: 26 });
    expect(doc.state.desired).toEqual({}); // 已满足 → 清除
    expect(doc.state.delta).toEqual({});
    expect(store.get('dev-001')?.desired).toEqual({});
  });

  it('上报值与 desired 不一致时 desired 保留', async () => {
    const row: ShadowRow = {
      ...structuredClone(baseRow),
      desired: { target: 26 },
      desiredVersion: 1,
    };
    const { service } = makeService([row]);

    const doc = await service.updateReported('dev-001', { target: 20 });

    expect(doc.state.desired).toEqual({ target: 26 });
    expect(doc.state.delta).toEqual({ target: 26 });
  });

  it('reportedVersion 递增且 reported 按 key 合并', async () => {
    const { service } = makeService([structuredClone(baseRow)]);

    const doc = await service.updateReported('dev-001', { humidity: 60 });

    expect(doc.state.reported).toEqual({ temperature: 25, humidity: 60 });
    expect(doc.version).toBe(6); // max(desiredVersion 0, reportedVersion 6)
  });
});

// ---------------- getShadow cache-aside ----------------

describe('ShadowService.getShadow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('首次查 DB 并写缓存, 二次命中缓存不再查 DB', async () => {
    const { service, prisma, redis } = makeService([structuredClone(baseRow)]);

    const first = await service.getShadow('dev-001');
    expect(first.state.reported).toEqual({ temperature: 25 });
    expect(prisma.findUnique).toHaveBeenCalledTimes(1);
    expect(redis.cache.size).toBe(1);

    const second = await service.getShadow('dev-001');
    expect(second.state.reported).toEqual({ temperature: 25 });
    expect(prisma.findUnique).toHaveBeenCalledTimes(1); // 未再查库
  });

  it('影子不存在抛出 DeviceNotFoundError', async () => {
    const { service } = makeService([structuredClone(baseRow)]);
    await expect(service.getShadow('dev-404')).rejects.toThrow(DeviceNotFoundError);
  });

  it('缓存返回的文档透传', async () => {
    const { service, redis } = makeService([structuredClone(baseRow)]);
    const cached: ShadowDocument = {
      deviceId: 'dev-001',
      state: { reported: { stale: true }, desired: {}, delta: {} },
      metadata: { reported: {}, desired: {} },
      version: 99,
      timestamp: 1,
    };
    redis.cache.set('dev-001', JSON.stringify(cached));

    const doc = await service.getShadow('dev-001');
    expect(doc.version).toBe(99);
    expect(doc.state.reported).toEqual({ stale: true });
  });
});

// ---------------- clearDesired ----------------

describe('ShadowService.clearDesired', () => {
  it('清空 desired 并重置版本, 同时清缓存', async () => {
    const row: ShadowRow = {
      ...structuredClone(baseRow),
      desired: { target: 26, mode: 'auto' },
      desiredVersion: 3,
    };
    const { service, redis, store } = makeService([row]);

    await service.clearDesired('dev-001');

    const cleared = store.get('dev-001');
    expect(cleared?.desired).toEqual({});
    expect(cleared?.desiredVersion).toBe(0);
    expect(redis.delShadowCache).toHaveBeenCalledWith('dev-001');
  });
});
