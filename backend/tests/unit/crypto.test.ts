import { describe, it, expect } from 'vitest';
import {
  generateDeviceSecret,
  generateDeviceId,
  generateProductId,
  timingSafeEqual,
  buildMqttClientId,
  buildMqttUsername,
  buildMqttPassword,
} from '../../src/shared/crypto.js';

describe('generateDeviceSecret', () => {
  it('生成 64 位十六进制密钥', () => {
    const secret = generateDeviceSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('每次生成不重复', () => {
    expect(generateDeviceSecret()).not.toBe(generateDeviceSecret());
  });
});

describe('generateDeviceId', () => {
  it('对同一 productId/deviceName 结果确定', () => {
    const a = generateDeviceId('prod-a1b2c3d4', 'living-room-thermo-01');
    const b = generateDeviceId('prod-a1b2c3d4', 'living-room-thermo-01');
    expect(a).toBe(b);
  });

  it('长度为 64 且不同输入产生不同 ID', () => {
    const a = generateDeviceId('prod-a1b2c3d4', 'dev-1');
    const b = generateDeviceId('prod-a1b2c3d4', 'dev-2');
    const c = generateDeviceId('prod-other', 'dev-1');
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('generateProductId', () => {
  it('格式为 prod- + 8 位十六进制', () => {
    const id = generateProductId();
    expect(id).toMatch(/^prod-[0-9a-f]{8}$/);
    expect(generateProductId()).not.toBe(id);
  });
});

describe('timingSafeEqual', () => {
  it('相等字符串返回 true', () => {
    expect(timingSafeEqual('secret-abc', 'secret-abc')).toBe(true);
  });

  it('不相等字符串返回 false', () => {
    expect(timingSafeEqual('secret-abc', 'secret-xyz')).toBe(false);
  });

  it('长度不同返回 false(不抛异常)', () => {
    expect(timingSafeEqual('short', 'a-much-longer-secret')).toBe(false);
  });

  it('空字符串相等返回 true', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('MQTT 凭证构建', () => {
  it('clientId 格式: {productId}{deviceName};{sdkAppId};{certId};{expiryTs}', () => {
    expect(buildMqttClientId('prod-a1b2c3d4', 'dev-1', '12010126', 'cert-01', 1893456000)).toBe(
      'prod-a1b2c3d4dev-1;12010126;cert-01;1893456000',
    );
  });

  it('username 格式: {productId}{deviceName};{sdkAppId}', () => {
    expect(buildMqttUsername('prod-a1b2c3d4', 'dev-1', '12010126')).toBe(
      'prod-a1b2c3d4dev-1;12010126',
    );
  });

  it('password 附加 hmacsha256 后缀', () => {
    expect(buildMqttPassword('my-secret')).toBe('my-secret;hmacsha256');
  });
});
