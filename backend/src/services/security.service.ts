/**
 * 安全认证域服务: 设备凭证管理 + 认证记录
 *
 * - 纯函数: maskSecret / buildSecurityStats / normalizeLogFilter
 * - SecurityService: 统计 / 凭证列表 / 查看密钥 / 轮换 / 禁用启用 / 认证记录
 * - recordAuthLog: 认证埋点 helper(吞错, 不阻断主流程)
 *
 * 时区约定: 今日窗口在 Node 侧计算(startOfToday), 不走 SQL now(),
 * 避开 PG session 时区(Asia/Shanghai)与 UTC wall time 的 8h 偏移问题。
 */

import type { PrismaClient } from '@prisma/client';
import { generateDeviceSecret } from '../shared/crypto.js';
import { buildMqttConfig } from './device.service.js';
import {
  DeviceNotFoundError,
  ValidationError,
} from '../shared/errors.js';

// ---------------- 常量与纯函数 ----------------

export const AUTH_TYPES = [
  'device-token',
  'mqtt-connect',
  'secret-rotate',
  'status-change',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const AUTH_RESULTS = ['success', 'failure'] as const;
export type AuthResult = (typeof AUTH_RESULTS)[number];

/** 密钥脱敏: 前 4 + **** + 后 4; 过短(<=8)全遮蔽 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

export interface DeviceStatusCounts {
  online?: number;
  offline?: number;
  'not-activated'?: number;
  disabled?: number;
  [status: string]: number | undefined;
}

export interface TodayLogCounts {
  total: number;
  success: number;
  failure: number;
}

export interface SecurityStats {
  device_total: number;
  online: number;
  disabled: number;
  today_auth_count: number;
  today_auth_failure: number;
}

/** 由设备状态计数 + 今日认证计数派生统计卡数据 */
export function buildSecurityStats(
  deviceCounts: DeviceStatusCounts,
  todayLogs: TodayLogCounts,
): SecurityStats {
  const deviceTotal = Object.values(deviceCounts).reduce<number>(
    (acc, n) => acc + (n ?? 0),
    0,
  );
  return {
    device_total: deviceTotal,
    online: deviceCounts['online'] ?? 0,
    disabled: deviceCounts['disabled'] ?? 0,
    today_auth_count: todayLogs.total,
    today_auth_failure: todayLogs.failure,
  };
}

export interface LogFilter {
  page: number;
  page_size: number;
  auth_type?: AuthType;
  result?: AuthResult;
  device_id?: string;
}

/** 归并认证记录查询参数: 枚举非法值抛 ValidationError, 边界夹取 */
export function normalizeLogFilter(query: {
  page?: number | string;
  page_size?: number | string;
  auth_type?: string;
  result?: string;
  device_id?: string;
}): LogFilter {
  const page = Math.max(1, Number(query.page) || 1);
  const rawPageSize = Number(query.page_size) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));

  let authType: AuthType | undefined;
  if (query.auth_type !== undefined && query.auth_type !== '') {
    if (!AUTH_TYPES.includes(query.auth_type as AuthType)) {
      throw new ValidationError(
        `Invalid auth_type: ${query.auth_type}`,
        [{ field: 'auth_type', message: `Must be one of: ${AUTH_TYPES.join(', ')}` }],
      );
    }
    authType = query.auth_type as AuthType;
  }

  let result: AuthResult | undefined;
  if (query.result !== undefined && query.result !== '') {
    if (!AUTH_RESULTS.includes(query.result as AuthResult)) {
      throw new ValidationError(
        `Invalid result: ${query.result}`,
        [{ field: 'result', message: `Must be one of: ${AUTH_RESULTS.join(', ')}` }],
      );
    }
    result = query.result as AuthResult;
  }

  const deviceId =
    query.device_id !== undefined && query.device_id !== ''
      ? String(query.device_id)
      : undefined;

  return { page, page_size: pageSize, auth_type: authType, result, device_id: deviceId };
}

// ---------------- 认证埋点 helper ----------------

export interface AuthLogEntry {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  authType: AuthType;
  result: AuthResult;
  reason?: string;
  ip?: string;
}

/**
 * 写认证日志(埋点): 内部吞错只打 warn, 埋点失败不阻断认证主流程。
 * productName 允许空字符串(查询失败时的降级)。
 */
export async function recordAuthLog(
  db: PrismaClient,
  entry: AuthLogEntry,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    await db.deviceAuthLog.create({
      data: {
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        productId: entry.productId,
        productName: entry.productName || '',
        authType: entry.authType,
        result: entry.result,
        reason: entry.reason?.slice(0, 256),
        ip: entry.ip?.slice(0, 45),
      },
    });
  } catch (err) {
    logger?.warn({ err, entry: { ...entry } }, 'Failed to record auth log');
  }
}

// ---------------- SecurityService ----------------

export interface CredentialItem {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: string;
  maskedSecret: string;
  lastLoginAt: Date | null;
  lastIp: string | null;
  createdAt: Date;
}

export interface CredentialDetail extends CredentialItem {
  deviceSecret: string;
  mqttConfig: ReturnType<typeof buildMqttConfig>;
}

export class SecurityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisHelper: {
      delDeviceOnline: (deviceId: string) => Promise<void>;
    },
  ) {}

  async getStats(): Promise<SecurityStats> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [statusGroups, todayLogs] = await Promise.all([
      this.prisma.device.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.deviceAuthLog.groupBy({
        by: ['result'],
        _count: { _all: true },
        where: { createdAt: { gte: startOfToday } },
      }),
    ]);

    const deviceCounts: DeviceStatusCounts = {};
    for (const g of statusGroups) {
      deviceCounts[g.status] = g._count._all;
    }
    let success = 0;
    let failure = 0;
    for (const g of todayLogs) {
      if (g.result === 'success') success = g._count._all;
      else failure += g._count._all;
    }

    return buildSecurityStats(deviceCounts, { total: success + failure, success, failure });
  }

  async listCredentials(query: {
    page?: number;
    page_size?: number;
    keyword?: string;
    status?: string;
  }): Promise<{ items: CredentialItem[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { deviceName: { contains: query.keyword, mode: 'insensitive' } },
        { product: { is: { productName: { contains: query.keyword, mode: 'insensitive' } } } },
      ];
    }

    const [devices, total] = await this.prisma.$transaction([
      this.prisma.device.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          deviceId: true,
          deviceName: true,
          deviceSecret: true,
          productId: true,
          status: true,
          lastLoginAt: true,
          lastIp: true,
          createdAt: true,
          product: { select: { productName: true } },
        },
      }),
      this.prisma.device.count({ where }),
    ]);

    return {
      items: devices.map((d: any) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        productId: d.productId,
        productName: d.product?.productName ?? d.productId,
        status: d.status,
        maskedSecret: maskSecret(d.deviceSecret),
        lastLoginAt: d.lastLoginAt,
        lastIp: d.lastIp,
        createdAt: d.createdAt,
      })),
      total,
    };
  }

  async getCredential(deviceId: string): Promise<CredentialDetail> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { product: { select: { productName: true } } },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device does not exist' }],
      );
    }

    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      productId: device.productId,
      productName: device.product?.productName ?? device.productId,
      status: device.status,
      maskedSecret: maskSecret(device.deviceSecret),
      lastLoginAt: device.lastLoginAt,
      lastIp: device.lastIp,
      createdAt: device.createdAt,
      deviceSecret: device.deviceSecret,
      mqttConfig: buildMqttConfig(
        device.productId,
        device.deviceName,
        device.deviceSecret,
      ),
    };
  }

  async rotateSecret(deviceId: string, ip?: string): Promise<{ deviceSecret: string }> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { product: { select: { productName: true } } },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device does not exist' }],
      );
    }

    const newSecret = generateDeviceSecret();
    await this.prisma.device.update({
      where: { deviceId },
      data: { deviceSecret: newSecret },
    });

    await recordAuthLog(this.prisma, {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      productId: device.productId,
      productName: device.product?.productName ?? device.productId,
      authType: 'secret-rotate',
      result: 'success',
      reason: 'Device secret rotated from console',
      ip,
    });

    return { deviceSecret: newSecret };
  }

  async setDeviceStatus(
    deviceId: string,
    action: 'disable' | 'enable',
    ip?: string,
  ): Promise<{ deviceId: string; status: string }> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { product: { select: { productName: true } } },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device does not exist' }],
      );
    }

    // 禁用 → disabled + 清 Redis 在线标记; 启用 → offline(需重新认证上线)
    const status = action === 'disable' ? 'disabled' : 'offline';
    await this.prisma.device.update({ where: { deviceId }, data: { status } });
    if (action === 'disable') {
      await this.redisHelper.delDeviceOnline(deviceId);
    }

    await recordAuthLog(this.prisma, {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      productId: device.productId,
      productName: device.product?.productName ?? device.productId,
      authType: 'status-change',
      result: 'success',
      reason: action === 'disable' ? 'Device disabled from console' : 'Device enabled from console',
      ip,
    });

    return { deviceId, status };
  }

  async listAuthLogs(filter: LogFilter): Promise<{
    items: Array<{
      id: number;
      time: Date;
      deviceId: string;
      deviceName: string;
      productName: string;
      authType: string;
      result: string;
      reason: string | null;
      ip: string | null;
    }>;
    total: number;
  }> {
    const where: any = {};
    if (filter.auth_type) where.authType = filter.auth_type;
    if (filter.result) where.result = filter.result;
    if (filter.device_id) where.deviceId = filter.device_id;

    const skip = (filter.page - 1) * filter.page_size;
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.deviceAuthLog.findMany({
        where,
        skip,
        take: filter.page_size,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.deviceAuthLog.count({ where }),
    ]);

    return {
      items: logs.map((l: any) => ({
        id: l.id,
        time: l.createdAt,
        deviceId: l.deviceId,
        deviceName: l.deviceName,
        productName: l.productName,
        authType: l.authType,
        result: l.result,
        reason: l.reason,
        ip: l.ip,
      })),
      total,
    };
  }
}
