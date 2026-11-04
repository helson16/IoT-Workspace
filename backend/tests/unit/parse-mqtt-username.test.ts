import { describe, it, expect } from 'vitest';
import { parseMqttUsername } from '../../src/routes/internal.routes.js';

// ---------------- MQTT username 解析(EMQX auth hook 与 internal 回调共用) ----------------

describe('parseMqttUsername', () => {
  it('合法格式: {productId}{deviceName};{sdkAppId} 正确切分', () => {
    expect(parseMqttUsername('prod-a1b2c3d4living-room-thermo-01;12010126')).toEqual({
      productId: 'prod-a1b2c3d4',
      deviceName: 'living-room-thermo-01',
    });
  });

  it('deviceName 含分号以外的特殊字符(连字符)正常', () => {
    expect(parseMqttUsername('prod-a1b2c3d4front-door-cam-01;12010126')).toEqual({
      productId: 'prod-a1b2c3d4',
      deviceName: 'front-door-cam-01',
    });
  });

  it('缺分号: 返回 null', () => {
    expect(parseMqttUsername('prod-a1b2c3d4living-room-thermo-01')).toBeNull();
  });

  it('前缀长度恰好 13(只有 productId, 无 deviceName): 返回 null', () => {
    expect(parseMqttUsername('prod-a1b2c3d4;12010126')).toBeNull();
  });

  it('前缀长度 14(productId 13 + 1 字符 deviceName): 合法', () => {
    expect(parseMqttUsername('prod-a1b2c3d4x;12010126')).toEqual({
      productId: 'prod-a1b2c3d4',
      deviceName: 'x',
    });
  });

  it('非字符串输入(undefined/数字/对象): 返回 null', () => {
    expect(parseMqttUsername(undefined)).toBeNull();
    expect(parseMqttUsername(123)).toBeNull();
    expect(parseMqttUsername({})).toBeNull();
    expect(parseMqttUsername('')).toBeNull();
  });

  it('空 deviceName 的多段 clientid 误传场景不误伤: username 分号后多余段不影响前缀切分', () => {
    // clientid 是 4 段式, 误当 username 传入时前缀切分逻辑一致(仅取首个分号前)
    expect(parseMqttUsername('prod-a1b2c3d4dev-01;12010126;prod-a1b2c3d4;1790000000')).toEqual({
      productId: 'prod-a1b2c3d4',
      deviceName: 'dev-01',
    });
  });
});
