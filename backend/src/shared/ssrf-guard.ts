import { promises as dnsPromises } from 'node:dns';

/**
 * SSRF 防护 — 规则引擎 HTTP 转发目标 URL 校验。
 *
 * target_config.url 由用户在创建/更新转发规则时指定, dispatch 时由后端发起
 * 请求。若不校验, 攻击者可让后端访问内网服务(数据库/EMQX 管理 API/云元数据
 * 端点), 因此在规则保存与转发执行两个时点均需校验:
 *   1. 字面量检查: localhost / 私有 IPv4 / IPv6 本地地址(同步)
 *   2. DNS 解析后检查: 域名解析出的所有 IP 均不得为内网地址(fail-closed)
 */

export type DnsLookup = (hostname: string) => Promise<string[]>;

/** 是否为 IPv4 字面量 */
function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** 是否为 IPv6 字面量(含 IPv4-mapped 形式) */
function isIpv6(host: string): boolean {
  return host.includes(':');
}

/** 判断 IPv4 地址是否为内网/保留地址 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // 解析异常按内网处理(fail-closed)
  }
  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8(未指定) / 10/8(内网) / 127/8(回环) / 169.254/16(链路本地+云元数据)
  if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) return true;
  // 100.64/10(运营商级 NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 172.16/12(内网)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16(内网)
  if (a === 192 && b === 168) return true;
  return false;
}

/** 判断 IPv6 地址是否为本地/保留地址 */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // 未指定 / 回环
  // IPv4-mapped(::ffff:a.b.c.d) → 按内嵌 IPv4 判断
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1] as string);
  const first = parseInt((lower.split(':')[0] ?? '0'), 16);
  // fc00::/7(ULA) / fe80::/10(链路本地)
  if (!Number.isNaN(first)) {
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
  }
  return false;
}

/** 判断主机名/IP 字面量是否指向内网或本机(纯函数, 可单测) */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // IPv6 字面量去掉方括号
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (isIpv4(h)) return isPrivateIpv4(h);
  if (isIpv6(h)) return isPrivateIpv6(h);
  return false;
}

/** 默认 DNS 解析: 返回主机名对应的全部 IP(fail-closed: 解析异常返回 []) */
const defaultLookup: DnsLookup = async (hostname) => {
  const results = await dnsPromises.lookup(hostname, { all: true });
  return results.map((r) => r.address);
};

export type UrlGuardResult = { ok: true } | { ok: false; reason: string };

/**
 * 校验转发目标 URL 是否安全(非内网/本机/回环)。
 * lookup 参数可注入, 便于单测桩掉 DNS。
 */
export async function validateForwardUrl(
  url: string,
  lookup: DnsLookup = defaultLookup,
): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: '转发 URL 格式无效' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `不支持的协议: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: '转发 URL 不允许携带认证信息' };
  }

  const host = parsed.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    return { ok: false, reason: `禁止转发到内网/本机地址: ${host}` };
  }

  // 域名: 解析后逐个 IP 校验(所有 A/AAAA 记录都必须是公网地址)
  if (!isIpv4(host) && !isIpv6(host)) {
    let addresses: string[];
    try {
      addresses = await lookup(host);
    } catch {
      return { ok: false, reason: `域名解析失败: ${host}` };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: `域名解析失败: ${host}` };
    }
    const bad = addresses.filter((ip) => isPrivateHost(ip));
    if (bad.length > 0) {
      return { ok: false, reason: `域名 ${host} 解析到内网地址: ${bad.join(', ')}` };
    }
  }

  return { ok: true };
}
