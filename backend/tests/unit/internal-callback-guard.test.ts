import { describe, it, expect } from 'vitest';
import { shouldBlockCallback } from '../../src/routes/internal.routes.js';

// ---------------- disabled 设备回调拦截判定 ----------------

describe('shouldBlockCallback', () => {
  it('设备不存在: 不拦(EMQX webhook 乱序容忍, 由后续逻辑处理)', () => {
    expect(shouldBlockCallback(false, undefined)).toBe(false);
  });

  it('设备存在且 disabled: 拦(与 EMQX auth hook 拒绝语义一致)', () => {
    expect(shouldBlockCallback(true, 'disabled')).toBe(true);
  });

  it('设备存在且 online/offline/not-activated: 不拦', () => {
    expect(shouldBlockCallback(true, 'online')).toBe(false);
    expect(shouldBlockCallback(true, 'offline')).toBe(false);
    expect(shouldBlockCallback(true, 'not-activated')).toBe(false);
  });

  it('设备存在但 status 异常值(防御): 不拦, 交由既有流程', () => {
    expect(shouldBlockCallback(true, 'unknown')).toBe(false);
  });
});
