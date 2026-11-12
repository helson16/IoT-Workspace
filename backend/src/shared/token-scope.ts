/**
 * JWT scope 权限边界判定。
 *
 * 设备 token 与平台 token 使用同一 jwtSecret 签发, 验签只能证明"来源可信",
 * 不能证明"权限对等"。/api/v1/* 平台 API 仅允许 scope=platform 的平台 token
 * 访问; 设备 token(scope=device) 若混入平台 API, 可横向读取任意设备凭据。
 */

export type JwtScopePayload = { scope?: unknown };

/** 判定 JWT payload 是否为平台 token(scope === 'platform') */
export function isPlatformToken(payload: JwtScopePayload | null | undefined): boolean {
  return payload?.scope === 'platform';
}
