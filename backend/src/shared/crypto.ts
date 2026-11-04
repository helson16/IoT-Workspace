import { randomBytes, createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

export function generateDeviceId(productId: string, deviceName: string): string {
  const input = `${productId}/${deviceName}`;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.slice(0, 64);
}

export function generateProductId(): string {
  return `prod-${randomBytes(4).toString('hex')}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}

export function buildMqttClientId(
  productId: string,
  deviceName: string,
  sdkAppId: string,
  certId: string,
  expiryTs: number,
): string {
  return `${productId}${deviceName};${sdkAppId};${certId};${expiryTs}`;
}

export function buildMqttUsername(
  productId: string,
  deviceName: string,
  sdkAppId: string,
): string {
  return `${productId}${deviceName};${sdkAppId}`;
}

export function buildMqttPassword(deviceSecret: string): string {
  return `${deviceSecret};hmacsha256`;
}
