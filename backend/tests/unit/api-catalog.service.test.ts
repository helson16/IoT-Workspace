import { describe, it, expect } from 'vitest';
import {
  API_CATALOG,
  API_GROUPS,
  findApiById,
  buildInvokeRequest,
  truncateForStore,
  buildHistoryStats,
  ApiExplorerService,
} from '../../src/services/api-catalog.service.js';
import { ValidationError } from '../../src/shared/errors.js';
import type { ApiCatalogEntry } from '../../src/services/api-catalog.service.js';

// ---------------- API_CATALOG 结构 ----------------

describe('API_CATALOG 结构', () => {
  it('条目 id 全局唯一', () => {
    const ids = API_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个条目的 group 都有分组元数据', () => {
    const groupKeys = new Set(API_GROUPS.map((g) => g.key));
    for (const entry of API_CATALOG) {
      expect(groupKeys.has(entry.group)).toBe(true);
    }
  });

  it('每个分组至少有一个条目', () => {
    const used = new Set(API_CATALOG.map((e) => e.group));
    for (const g of API_GROUPS) {
      expect(used.has(g.key)).toBe(true);
    }
  });

  it('可调试条目均在 /api/v1/ 域, 不可调试条目均在 /api/internal/ 域', () => {
    for (const entry of API_CATALOG) {
      if (entry.invocable) {
        expect(entry.path.startsWith('/api/v1/')).toBe(true);
      } else {
        expect(entry.path.startsWith('/api/internal/')).toBe(true);
      }
    }
  });

  it('path 模板参数与 pathParams 声明一致', () => {
    for (const entry of API_CATALOG) {
      const declared = new Set((entry.pathParams ?? []).map((p) => p.name));
      // 只提取路径段参数(/:param), 不误抓 command:parse 这类段内字面量
      const inPath = new Set(
        (entry.path.match(/\/:([A-Za-z]+)/g) ?? []).map((s) => s.slice(2)),
      );
      expect(declared).toEqual(inPath);
    }
  });
});

// ---------------- findApiById ----------------

describe('findApiById', () => {
  it('按 id 命中目录条目', () => {
    const entry = findApiById(API_CATALOG, 'products.list');
    expect(entry?.name).toBe('产品列表');
    expect(entry?.method).toBe('GET');
  });

  it('未命中返回 undefined', () => {
    expect(findApiById(API_CATALOG, 'no.such.api')).toBeUndefined();
  });
});

// ---------------- buildInvokeRequest ----------------

function getEntry(id: string): ApiCatalogEntry {
  const entry = findApiById(API_CATALOG, id);
  if (!entry) throw new Error(`test fixture missing: ${id}`);
  return entry;
}

describe('buildInvokeRequest', () => {
  it('无参数 GET 原样返回路径', () => {
    const req = buildInvokeRequest(getEntry('stats.overview'), {});
    expect(req).toEqual({ method: 'GET', url: '/api/v1/stats/overview' });
  });

  it('替换路径参数并拼接声明的 query 参数', () => {
    const req = buildInvokeRequest(getEntry('devices.product-list'), {
      path: { productId: 'prod-abc12345' },
      query: { page: '2', page_size: '5' },
    });
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/api/v1/products/prod-abc12345/devices?page=2&page_size=5');
  });

  it('未声明的 query 参数被白名单丢弃', () => {
    const req = buildInvokeRequest(getEntry('devices.list'), {
      query: { page_size: '5', hack: '1; DROP TABLE' },
    });
    expect(req.url).toBe('/api/v1/devices?page_size=5');
  });

  it('空值 query 参数不拼接', () => {
    const req = buildInvokeRequest(getEntry('devices.list'), {
      query: { keyword: '   ', status: 'online' },
    });
    expect(req.url).toBe('/api/v1/devices?status=online');
  });

  it('路径参数值做 URL 编码', () => {
    const req = buildInvokeRequest(getEntry('devices.get'), {
      path: { deviceId: 'dev x/y' },
    });
    expect(req.url).toBe('/api/v1/devices/dev%20x%2Fy');
  });

  it('缺少必填路径参数抛 ValidationError', () => {
    expect(() =>
      buildInvokeRequest(getEntry('products.get'), { path: {} }),
    ).toThrow(ValidationError);
  });

  it('路径参数为空白字符串同样抛错', () => {
    expect(() =>
      buildInvokeRequest(getEntry('products.get'), {
        path: { productId: '   ' },
      }),
    ).toThrow(ValidationError);
  });

  it('多路径参数需全部提供, 缺任何一个都抛错', () => {
    const entry = getEntry('devices.delete');
    expect(() =>
      buildInvokeRequest(entry, { path: { productId: 'p1' } }),
    ).toThrow(ValidationError);
    const ok = buildInvokeRequest(entry, {
      path: { productId: 'p1', deviceName: 'd1' },
    });
    expect(ok.url).toBe('/api/v1/products/p1/devices/d1');
  });

  it('internal 条目(不可调试)抛 ValidationError', () => {
    expect(() =>
      buildInvokeRequest(getEntry('internal.echo'), {}),
    ).toThrow(ValidationError);
  });

  it('method 固定取目录条目, 不受入参影响', () => {
    const req = buildInvokeRequest(getEntry('products.create'), {});
    expect(req.method).toBe('POST');
  });
});

// ---------------- truncateForStore ----------------

describe('truncateForStore', () => {
  it('短文本不截断', () => {
    const r = truncateForStore('{"ok":true}');
    expect(r).toEqual({ text: '{"ok":true}', truncated: false });
  });

  it('恰好等于 maxLen 不截断', () => {
    const text = 'a'.repeat(100);
    expect(truncateForStore(text, 100)).toEqual({
      text,
      truncated: false,
    });
  });

  it('超长文本截断并打标志与后缀', () => {
    const text = 'a'.repeat(150);
    const r = truncateForStore(text, 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(100 + 20);
    expect(r.text.endsWith('…(truncated)')).toBe(true);
  });
});

// ---------------- buildHistoryStats ----------------

describe('buildHistoryStats', () => {
  it('无调用时比率与均值均为 null', () => {
    expect(buildHistoryStats(0, 0, null)).toEqual({
      total_invokes: 0,
      success_count: 0,
      success_rate: null,
      avg_duration_ms: null,
    });
  });

  it('成功率保留一位小数, 平均耗时取整', () => {
    expect(buildHistoryStats(3, 2, 12.6)).toEqual({
      total_invokes: 3,
      success_count: 2,
      success_rate: 66.7,
      avg_duration_ms: 13,
    });
  });

  it('全部成功时成功率为 100', () => {
    expect(buildHistoryStats(5, 5, 3.2).success_rate).toBe(100);
  });
});

// ---------------- ApiExplorerService (stub Prisma) ----------------

function makeStubDb() {
  const calls = {
    create: [] as any[],
    findManyArgs: [] as any[],
    countArgs: [] as any[],
    aggregateArgs: [] as any[],
  };
  return {
    calls,
    apiInvokeLog: {
      create: async (args: any) => {
        calls.create.push(args);
        return args.data;
      },
      findMany: async (args: any) => {
        calls.findManyArgs.push(args);
        return [
          {
            id: 1,
            apiId: 'stats.overview',
            method: 'GET',
            path: '/api/v1/stats/overview',
            statusCode: 200,
            durationMs: 8,
            truncated: false,
            createdAt: new Date('2026-09-25T00:00:00Z'),
          },
        ];
      },
      count: async (args?: any) => {
        calls.countArgs.push(args ?? null);
        // 第 1 次 = 总数, 第 2 次 = 成功数
        return calls.countArgs.length === 1 ? 4 : 3;
      },
      aggregate: async (args: any) => {
        calls.aggregateArgs.push(args);
        return { _avg: { durationMs: 12.4 } };
      },
    },
  };
}

describe('ApiExplorerService', () => {
  it('recordInvoke 写入 api_invoke_logs', async () => {
    const db = makeStubDb();
    const service = new ApiExplorerService(db as any);
    await service.recordInvoke({
      apiId: 'stats.overview',
      method: 'GET',
      path: '/api/v1/stats/overview',
      statusCode: 200,
      durationMs: 8,
    });
    expect(db.calls.create).toHaveLength(1);
    expect(db.calls.create[0].data.apiId).toBe('stats.overview');
    expect(db.calls.create[0].data.statusCode).toBe(200);
  });

  it('recordInvoke 对超长 path 截断到 512 字符', async () => {
    const db = makeStubDb();
    const service = new ApiExplorerService(db as any);
    const longPath = `/api/v1/devices?keyword=${'x'.repeat(600)}`;
    await service.recordInvoke({
      apiId: 'devices.list',
      method: 'GET',
      path: longPath,
      statusCode: 200,
      durationMs: 8,
    });
    expect(db.calls.create[0].data.path.length).toBeLessThanOrEqual(512);
  });

  it('listHistory 按时间倒序取 limit 条', async () => {
    const db = makeStubDb();
    const service = new ApiExplorerService(db as any);
    const items = await service.listHistory(15);
    expect(items).toHaveLength(1);
    expect(db.calls.findManyArgs[0].take).toBe(15);
    expect(db.calls.findManyArgs[0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });

  it('getStats 聚合总数/成功数/均值', async () => {
    const db = makeStubDb();
    const service = new ApiExplorerService(db as any);
    const stats = await service.getStats();
    expect(stats).toEqual({
      total_invokes: 4,
      success_count: 3,
      success_rate: 75,
      avg_duration_ms: 12,
    });
  });
});
