import { describe, it, expect } from 'vitest';
import { checkTopicAcl } from '../../src/routes/internal.routes.js';

// username = {productId 13 字符}{deviceName};{sdkAppId}
const USER = 'prod-a1b2c3d4living-room-thermo-01;12010126';
const OTHER = 'prod-45e6cba1front-door-cam-01;12010126';

// ---------------- publish ----------------

describe('checkTopicAcl.publish', () => {
  it('允许自己的 $thing/up/property topic', () => {
    expect(checkTopicAcl(USER, '$thing/up/property/prod-a1b2c3d4/living-room-thermo-01', 'publish')).toBe('allow');
  });

  it('允许自己的 $thing/up/event topic', () => {
    expect(checkTopicAcl(USER, '$thing/up/event/prod-a1b2c3d4/living-room-thermo-01', 'publish')).toBe('allow');
  });

  it('允许自己的 $shadow/update topic', () => {
    expect(checkTopicAcl(USER, '$shadow/update/prod-a1b2c3d4/living-room-thermo-01', 'publish')).toBe('allow');
  });

  it('允许自己的 $av/up/event topic', () => {
    expect(checkTopicAcl(USER, '$av/up/event/prod-a1b2c3d4/living-room-thermo-01', 'publish')).toBe('allow');
  });

  it('拒绝发布其他设备的 topic', () => {
    expect(
      checkTopicAcl(USER, '$thing/up/property/prod-45e6cba1/front-door-cam-01', 'publish'),
    ).toBe('deny');
  });

  it('拒绝发布 $SYS 系统主题', () => {
    expect(checkTopicAcl(USER, '$SYS/broker/uptime', 'publish')).toBe('deny');
  });

  it('拒绝 deviceName 部分匹配但整体不对的 topic', () => {
    // 前缀含设备名但 productId 段错位
    expect(
      checkTopicAcl(USER, '$thing/up/property/prod-a1b2c3d4living-room-thermo-01', 'publish'),
    ).toBe('deny');
  });

  it('拒绝带通配符或后缀追加的 publish topic(全等语义)', () => {
    expect(
      checkTopicAcl(USER, '$thing/up/property/prod-a1b2c3d4/living-room-thermo-01/extra', 'publish'),
    ).toBe('deny');
    expect(checkTopicAcl(USER, '$thing/up/property/#', 'publish')).toBe('deny');
  });
});

// ---------------- subscribe ----------------

describe('checkTopicAcl.subscribe', () => {
  it('允许自己的 $thing/down/property topic', () => {
    expect(
      checkTopicAcl(USER, '$thing/down/property/prod-a1b2c3d4/living-room-thermo-01', 'subscribe'),
    ).toBe('allow');
  });

  it('允许自己的 $thing/down/action topic', () => {
    expect(
      checkTopicAcl(USER, '$thing/down/action/prod-a1b2c3d4/living-room-thermo-01', 'subscribe'),
    ).toBe('allow');
  });

  it('允许自己的 $shadow/get/accepted topic 及后缀追加(republish 目标)', () => {
    expect(
      checkTopicAcl(USER, '$shadow/get/accepted/prod-a1b2c3d4/living-room-thermo-01', 'subscribe'),
    ).toBe('allow');
    expect(
      checkTopicAcl(
        USER,
        '$thing/down/property/prod-a1b2c3d4/living-room-thermo-01/republish',
        'subscribe',
      ),
    ).toBe('allow');
  });

  it('拒绝订阅其他设备的下行 topic', () => {
    expect(
      checkTopicAcl(USER, '$thing/down/property/prod-45e6cba1/front-door-cam-01', 'subscribe'),
    ).toBe('deny');
  });

  it('拒绝全量通配订阅', () => {
    expect(checkTopicAcl(USER, '#', 'subscribe')).toBe('deny');
    expect(checkTopicAcl(USER, '$thing/#', 'subscribe')).toBe('deny');
  });
});

// ---------------- 非设备客户端与非法输入 ----------------

describe('checkTopicAcl 三态边界', () => {
  it('dashboard 等非设备 username 格式 → ignore(交回 file 兜底)', () => {
    expect(checkTopicAcl('dashboard', '$SYS/#', 'subscribe')).toBe('ignore');
    expect(checkTopicAcl(OTHER.split(';')[0] + '2;12010126', 't/1', 'publish')).not.toBe('ignore'); // 仍是合法设备格式
  });

  it('username 非字符串 / 缺分号 → ignore', () => {
    expect(checkTopicAcl(undefined, 't/1', 'publish')).toBe('ignore');
    expect(checkTopicAcl(123, 't/1', 'publish')).toBe('ignore');
    expect(checkTopicAcl('no-semicolon', 't/1', 'publish')).toBe('ignore');
  });

  it('topic/action 非字符串 → ignore', () => {
    expect(checkTopicAcl(USER, undefined, 'publish')).toBe('ignore');
    expect(checkTopicAcl(USER, 't/1', undefined)).toBe('ignore');
  });

  it('未知 action → deny', () => {
    expect(checkTopicAcl(USER, 't/1', 'unknown')).toBe('deny');
  });
});
