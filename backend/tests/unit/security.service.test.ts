import { describe, it, expect } from 'vitest';
import {
  maskSecret,
  buildSecurityStats,
  normalizeLogFilter,
  recordAuthLog,
  SecurityService,
} from '../../src/services/security.service.js';
import { ValidationError } from '../../src/shared/errors.js';

// ---------------- maskSecret ----------------

describe('maskSecret', () => {
  it('长密钥保留前 4 后 4, 中间以 **** 遮蔽', () => {
    expect(maskSecret('a3f8e2c1d4b5a6970e8f')).toBe('a3f8****0e8f');
  });

  it('恰好 8 字符的密钥全遮蔽', () => {
    expect(maskSecret('12345678')).toBe('****');
  });

  it('过短密钥全遮蔽', () => {
    expect(maskSecret('abc')).toBe('****');
  });

  it('9 字符密钥保留首尾各 4', () => {
    expect(maskSecret('123456789')).toBe('1234****6789');
  });
});

// ---------------- buildSecurityStats ----------------

describe('buildSecurityStats', () => {
  it('由状态计数与今日日志计数派生统计卡数据', () => {
    const stats = buildSecurityStats(
      { online: 6, offline: 4, 'not-activated': 2, disabled: 1 },
      { total: 42, success: 38, failure: 4 },
    );
    expect(stats).toEqual({
      device_total: 13,
      online: 6,
      disabled: 1,
      today_auth_count: 42,
      today_auth_failure: 4,
    });
  });

  it('缺失的状态计为 0', () => {
    const stats = buildSecurityStats({}, { total: 0, success: 0, failure: 0 });
    expect(stats).toEqual({
      device_total: 0,
      online: 0,
      disabled: 0,
      today_auth_count: 0,
      today_auth_failure: 0,
    });
  });

  it('未知状态也计入设备总数', () => {
    const stats = buildSecurityStats(
      { online: 1, 'weird-status': 3 },
      { total: 0, success: 0, failure: 0 },
    );
    expect(stats.device_total).toBe(4);
  });

  it('失败数取 failure 而非 total-success 差值(以显式计数为准)', () => {
    const stats = buildSecurityStats(
      { online: 1 },
      { total: 10, success: 6, failure: 4 },
    );
    expect(stats.today_auth_failure).toBe(4);
  });
});

// ---------------- normalizeLogFilter ----------------

describe('normalizeLogFilter', () => {
  it('缺省参数归一为 page=1, page_size=20', () => {
    expect(normalizeLogFilter({})).toEqual({
      page: 1,
      page_size: 20,
      auth_type: undefined,
      result: undefined,
      device_id: undefined,
    });
  });

  it('字符串数字被解析, page_size 上限 100, 非法回退默认', () => {
    expect(normalizeLogFilter({ page: '3', page_size: '500' })).toMatchObject({
      page: 3,
      page_size: 100,
    });
    // page_size 0/非数字 → 默认 20
    expect(normalizeLogFilter({ page: '0', page_size: '0' })).toMatchObject({
      page: 1,
      page_size: 20,
    });
    expect(normalizeLogFilter({ page: 'abc', page_size: '1' })).toMatchObject({
      page: 1,
      page_size: 1,
    });
  });

  it('合法枚举与 device_id 透传', () => {
    expect(
      normalizeLogFilter({
        auth_type: 'mqtt-connect',
        result: 'failure',
        device_id: 'abc123',
      }),
    ).toEqual({
      page: 1,
      page_size: 20,
      auth_type: 'mqtt-connect',
      result: 'failure',
      device_id: 'abc123',
    });
  });

  it('空字符串视为未筛选', () => {
    expect(normalizeLogFilter({ auth_type: '', result: '' })).toMatchObject({
      auth_type: undefined,
      result: undefined,
    });
  });

  it('非法 auth_type 抛 ValidationError', () => {
    expect(() => normalizeLogFilter({ auth_type: 'hack' })).toThrow(ValidationError);
  });

  it('非法 result 抛 ValidationError', () => {
    expect(() => normalizeLogFilter({ result: 'maybe' })).toThrow(ValidationError);
  });

  it('非法 page(非数字)回退为 1', () => {
    expect(normalizeLogFilter({ page: 'abc' })).toMatchObject({ page: 1 });
  });
});

// ---------------- recordAuthLog ----------------

describe('recordAuthLog', () => {
  function makeDb(fail = false) {
    const db: any = {
      lastEntry: null,
      deviceAuthLog: {
        create: async (args: any) => {
          if (fail) throw new Error('db down');
          db.lastEntry = args.data;
          return args.data;
        },
      },
    };
    return db;
  }

  it('写入日志并截断超长 reason/ip', async () => {
    const db = makeDb();
    await recordAuthLog(db, {
      deviceId: 'd1',
      deviceName: 'dev-01',
      productId: 'prod-xxxx',
      productName: '温控器',
      authType: 'device-token',
      result: 'failure',
      reason: 'x'.repeat(300),
      ip: 'y'.repeat(60),
    });
    expect(db.lastEntry.reason).toHaveLength(256);
    expect(db.lastEntry.ip).toHaveLength(45);
    expect(db.lastEntry).toMatchObject({
      deviceId: 'd1',
      authType: 'device-token',
      result: 'failure',
    });
  });

  it('productName 空字符串被原样接受(降级路径)', async () => {
    const db = makeDb();
    await recordAuthLog(db, {
      deviceId: 'd1',
      deviceName: 'ghost',
      productId: 'p',
      productName: '',
      authType: 'mqtt-connect',
      result: 'failure',
      reason: 'Device not found',
    });
    expect(db.lastEntry.productName).toBe('');
  });

  it('埋点失败时吞错不抛出(不阻断认证主流程)', async () => {
    const warns: string[] = [];
    await recordAuthLog(
      makeDb(true),
      {
        deviceId: 'd1',
        deviceName: 'dev-01',
        productId: 'p',
        productName: '',
        authType: 'mqtt-connect',
        result: 'success',
      },
      { warn: (_obj, msg) => warns.push(msg) },
    );
    expect(warns).toHaveLength(1);
  });

  it('无 logger 时埋点失败也静默', async () => {
    await expect(
      recordAuthLog(makeDb(true), {
        deviceId: 'd1',
        deviceName: 'dev-01',
        productId: 'p',
        productName: '',
        authType: 'secret-rotate',
        result: 'success',
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------- SecurityService(rotate / status) ----------------

describe('SecurityService', () => {
  const DEVICE = {
    deviceId: 'dev-hash-1',
    deviceName: 'living-room-01',
    productId: 'prod-xxxx',
    status: 'online',
    deviceSecret: 'old-secret-value',
    product: { productName: '温控器' },
  };

  function makeDb(device: any = DEVICE) {
    const calls: Record<string, any[]> = {
      deviceUpdate: [],
      authLogCreate: [],
      delOnline: [],
    };
    const db = {
      device: {
        findUnique: async () => device,
        update: async (args: any) => {
          calls.deviceUpdate.push(args);
          return device;
        },
      },
      deviceAuthLog: {
        create: async (args: any) => {
          calls.authLogCreate.push(args.data);
          return args.data;
        },
      },
    } as any;
    return { db, calls };
  }

  const redis = {
    delDeviceOnline: async (_id: string): Promise<void> => {},
  };

  it('rotateSecret 更新密钥并写 secret-rotate 审计日志', async () => {
    const { db, calls } = makeDb();
    const svc = new SecurityService(db, redis);
    const result = await svc.rotateSecret('dev-hash-1', '127.0.0.1');

    expect(result.deviceSecret).not.toBe('old-secret-value');
    expect(result.deviceSecret.length).toBeGreaterThanOrEqual(32);
    expect(calls.deviceUpdate[0].data.deviceSecret).toBe(result.deviceSecret);
    expect(calls.authLogCreate[0]).toMatchObject({
      authType: 'secret-rotate',
      result: 'success',
      deviceId: 'dev-hash-1',
      ip: '127.0.0.1',
    });
  });

  it('disable 置 disabled 并清 Redis 在线标记', async () => {
    const { db, calls } = makeDb();
    const delOnline: string[] = [];
    const svc = new SecurityService(db, {
      delDeviceOnline: async (id): Promise<void> => {
        delOnline.push(id);
      },
    });
    const result = await svc.setDeviceStatus('dev-hash-1', 'disable', '127.0.0.1');

    expect(result.status).toBe('disabled');
    expect(calls.deviceUpdate[0].data.status).toBe('disabled');
    expect(delOnline).toEqual(['dev-hash-1']);
    expect(calls.authLogCreate[0]).toMatchObject({
      authType: 'status-change',
      reason: 'Device disabled from console',
    });
  });

  it('enable 置 offline 且不动 Redis 标记(需重新认证上线)', async () => {
    const { db, calls } = makeDb();
    const delOnline: string[] = [];
    const svc = new SecurityService(db, {
      delDeviceOnline: async (id): Promise<void> => {
        delOnline.push(id);
      },
    });
    const result = await svc.setDeviceStatus('dev-hash-1', 'enable');

    expect(result.status).toBe('offline');
    expect(calls.deviceUpdate[0].data.status).toBe('offline');
    expect(delOnline).toHaveLength(0);
    expect(calls.authLogCreate[0].reason).toBe('Device enabled from console');
  });

  it('设备不存在时抛 DeviceNotFoundError', async () => {
    const { db } = makeDb(null);
    const svc = new SecurityService(db, redis);
    await expect(svc.rotateSecret('ghost')).rejects.toThrow(/not found/i);
    await expect(svc.setDeviceStatus('ghost', 'disable')).rejects.toThrow(/not found/i);
    await expect(svc.getCredential('ghost')).rejects.toThrow(/not found/i);
  });

  it('getCredential 返回明文密钥与 MQTT 配置', async () => {
    const { db } = makeDb();
    const svc = new SecurityService(db, redis);
    const detail = await svc.getCredential('dev-hash-1');

    expect(detail.deviceSecret).toBe('old-secret-value');
    expect(detail.maskedSecret).toBe(maskSecret('old-secret-value'));
    expect(detail.mqttConfig).toMatchObject({
      clientId: expect.stringContaining('living-room-01'),
      username: expect.any(String),
      password: expect.any(String),
    });
  });

  it('listCredentials 返回脱敏密钥, 不含明文', async () => {
    const { db } = makeDb();
    const findMany = async () => [DEVICE];
    const count = async () => 1;
    db.device.findMany = findMany;
    db.device.count = count;
    db.$transaction = async (ops: any[]) => Promise.all(ops.map((op: any) => op));
    // $transaction 传入的是 prisma promise 对象, 这里直接改为可调用数组
    const svc = new SecurityService(db, redis);
    const result = await svc.listCredentials({});

    expect(result.total).toBe(1);
    expect(result.items[0].maskedSecret).toBe(maskSecret('old-secret-value'));
    expect(JSON.stringify(result.items)).not.toContain('old-secret-value');
  });
});
