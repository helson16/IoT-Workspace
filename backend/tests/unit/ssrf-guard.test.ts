import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPrivateHost, validateForwardUrl } from '../../src/shared/ssrf-guard.js';

// ---------------- isPrivateHost 字面量判定 ----------------

describe('isPrivateHost', () => {
  it('本机/回环 host 拒绝', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('LOCALHOST')).toBe(true);
    expect(isPrivateHost('api.localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('127.8.8.8')).toBe(true); // 127/8 整段
    expect(isPrivateHost('0.0.0.0')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true); // 云元数据端点
  });

  it('私有网段 IPv4 拒绝', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('10.255.255.255')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('100.64.0.1')).toBe(true); // CGNAT
  });

  it('IPv6 本地地址拒绝', () => {
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('::')).toBe(true);
    expect(isPrivateHost('::ffff:10.0.0.1')).toBe(true); // IPv4-mapped
    expect(isPrivateHost('fe80::1')).toBe(true); // 链路本地
    expect(isPrivateHost('fd00::1')).toBe(true); // ULA
    expect(isPrivateHost('[::1]')).toBe(true); // URL 字面量带方括号
  });

  it('公网地址/域名放行', () => {
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('1.1.1.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false); // 172.16/12 边界外
    expect(isPrivateHost('172.15.0.1')).toBe(false);
    expect(isPrivateHost('203.0.113.10')).toBe(false); // TEST-NET-3
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('2606:4700::1111')).toBe(false); // 公网 IPv6
  });
});

// ---------------- validateForwardUrl ----------------

describe('validateForwardUrl', () => {
  // 桩掉 DNS: 默认域名解析到公网 IP
  const publicLookup = vi.fn(async () => ['93.184.216.34']);
  const rebindingLookup = vi.fn(async () => ['93.184.216.34', '10.0.0.8']);

  beforeEach(() => {
    publicLookup.mockClear();
    rebindingLookup.mockClear();
  });

  it('公网 http/https URL 通过(域名 DNS 解析为公网)', async () => {
    expect(await validateForwardUrl('http://example.com/hook', publicLookup)).toEqual({ ok: true });
    expect(await validateForwardUrl('https://example.com:8443/hook', publicLookup)).toEqual({ ok: true });
    expect(await validateForwardUrl('https://203.0.113.10/hook')).toEqual({ ok: true }); // 字面量不走 DNS
  });

  it('格式非法/协议不支持/携带凭据拒绝', async () => {
    expect((await validateForwardUrl('not-a-url')).ok).toBe(false);
    expect((await validateForwardUrl('ftp://example.com/f')).ok).toBe(false);
    expect((await validateForwardUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await validateForwardUrl('http://user:pass@example.com/')).ok).toBe(false);
  });

  it('内网字面量拒绝(不经 DNS)', async () => {
    const res = await validateForwardUrl('http://192.168.1.1/router', publicLookup);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain('192.168.1.1');
    expect(publicLookup).not.toHaveBeenCalled();
  });

  it('域名解析到内网地址拒绝(多 A 记录含一条内网即拒绝)', async () => {
    const res = await validateForwardUrl('http://rebind.example.com/hook', rebindingLookup);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain('10.0.0.8');
  });

  it('域名解析失败 fail-closed 拒绝', async () => {
    const failingLookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const res = await validateForwardUrl('http://nx.example.com/hook', failingLookup);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain('域名解析失败');
  });
});
