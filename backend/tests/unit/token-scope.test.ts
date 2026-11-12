import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { isPlatformToken } from '../../src/shared/token-scope.js';
import type { JwtDevicePayload } from '../../src/types/index.js';

// ---------------- 设备 JWT scope 权限边界 ----------------

const SECRET = 'test-secret';

describe('isPlatformToken scope 边界', () => {
  it('设备 token(含 deviceId 等字段, scope=device) 被拒绝', () => {
    const payload: JwtDevicePayload = {
      deviceId: 'device-1',
      productId: 'product-1',
      deviceName: 'sensor',
      scope: 'device',
    };
    const token = jwt.sign(payload, SECRET);
    const decoded = jwt.decode(token) as { scope?: string };
    expect(isPlatformToken(decoded)).toBe(false);
  });

  it('平台 token(scope=platform) 通过', () => {
    const token = jwt.sign({ appKey: 'k', scope: 'platform' }, SECRET);
    const decoded = jwt.decode(token) as { scope?: string };
    expect(isPlatformToken(decoded)).toBe(true);
  });

  it('旧版无 scope 字段的 token 一律拒绝(fail-closed)', () => {
    expect(isPlatformToken({})).toBe(false);
    expect(isPlatformToken(null)).toBe(false);
    expect(isPlatformToken(undefined)).toBe(false);
  });

  it('scope 值非字符串时拒绝', () => {
    expect(isPlatformToken({ scope: 1 })).toBe(false);
    expect(isPlatformToken({ scope: null })).toBe(false);
  });
});
