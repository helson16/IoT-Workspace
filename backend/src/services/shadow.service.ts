import type { PrismaClient } from '@prisma/client';
import {
  DeviceNotFoundError,
  ShadowVersionConflictError,
} from '../shared/errors.js';
import type { ShadowDocument } from '../types/index.js';
import { EmqxBridgeService } from './emqx-bridge.service.js';

interface RedisHelper {
  getShadowCache: (deviceId: string) => Promise<string | null>;
  setShadowCache: (deviceId: string, data: string) => Promise<void>;
  delShadowCache: (deviceId: string) => Promise<void>;
}

interface ShadowMetadata {
  reported: Record<string, { timestamp: number }>;
  desired: Record<string, { timestamp: number }>;
}

export class ShadowService {
  // EMQX 下行推送桥(fire-and-forget, 未配置 API key 时为 no-op)
  private readonly emqxBridge = new EmqxBridgeService();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisHelper: RedisHelper,
  ) {}

  computeDelta(
    desired: Record<string, any>,
    reported: Record<string, any>,
  ): Record<string, any> {
    const delta: Record<string, any> = {};
    for (const key of Object.keys(desired)) {
      if (
        !(key in reported) ||
        JSON.stringify(desired[key]) !== JSON.stringify(reported[key])
      ) {
        delta[key] = desired[key];
      }
    }
    return delta;
  }

  async getShadow(deviceId: string): Promise<ShadowDocument> {
    // Cache-aside: check Redis first
    try {
      const cached = await this.redisHelper.getShadowCache(deviceId);
      if (cached) {
        // 旧缓存可能没有 desiredVersion 字段 (2026-10-13 加入), 缺失时按 0 兜底, TTL 过期后自然刷新
        const doc = JSON.parse(cached) as ShadowDocument;
        return { ...doc, desiredVersion: doc.desiredVersion ?? 0 };
      }
    } catch {
      // Cache miss or Redis error — fall through to DB
    }

    const shadow = await this.prisma.deviceShadow.findUnique({
      where: { deviceId },
    });
    if (!shadow) {
      throw new DeviceNotFoundError(
        `Shadow not found for device: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device shadow does not exist' }],
      );
    }

    const reported = (shadow.reported as Record<string, any>) ?? {};
    const desired = (shadow.desired as Record<string, any>) ?? {};
    const metadata = (shadow.metadata as unknown as ShadowMetadata) ?? {
      reported: {},
      desired: {},
    };

    const delta = this.computeDelta(desired, reported);
    const version = Math.max(shadow.desiredVersion, shadow.reportedVersion);

    const doc: ShadowDocument = {
      deviceId: shadow.deviceId,
      state: {
        reported,
        desired,
        delta,
      },
      metadata: {
        reported: metadata.reported ?? {},
        desired: metadata.desired ?? {},
      },
      version,
      desiredVersion: shadow.desiredVersion,
      timestamp: Date.now(),
    };

    // Populate cache
    try {
      await this.redisHelper.setShadowCache(
        deviceId,
        JSON.stringify(doc),
      );
    } catch {
      // Ignore cache write errors
    }

    return doc;
  }

  async updateDesired(
    deviceId: string,
    desired: Record<string, any>,
    expectedVersion: number,
  ): Promise<ShadowDocument> {
    const shadow = await this.prisma.deviceShadow.findUnique({
      where: { deviceId },
      include: { device: { select: { productId: true, deviceName: true } } },
    });
    if (!shadow) {
      throw new DeviceNotFoundError(
        `Shadow not found for device: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device shadow does not exist' }],
      );
    }

    // Optimistic lock on desiredVersion
    if (shadow.desiredVersion !== expectedVersion) {
      throw new ShadowVersionConflictError(
        `Desired version conflict: expected ${expectedVersion}, actual ${shadow.desiredVersion}`,
        [
          {
            field: 'version',
            message: `Current desired version is ${shadow.desiredVersion}`,
          },
        ],
      );
    }

    const currentDesired = (shadow.desired as Record<string, any>) ?? {};
    const currentReported = (shadow.reported as Record<string, any>) ?? {};
    const currentMetadata = (shadow.metadata as unknown as ShadowMetadata) ?? {
      reported: {},
      desired: {},
    };

    const now = Date.now();

    // Merge new desired keys into existing desired
    const mergedDesired = { ...currentDesired, ...desired };

    // Update metadata for each modified desired key
    const desiredMeta = { ...currentMetadata.desired };
    for (const key of Object.keys(desired)) {
      desiredMeta[key] = { timestamp: now };
    }

    const newMetadata: ShadowMetadata = {
      reported: currentMetadata.reported,
      desired: desiredMeta,
    };

    const delta = this.computeDelta(mergedDesired, currentReported);
    const newDesiredVersion = shadow.desiredVersion + 1;

    const updated = await this.prisma.deviceShadow.update({
      where: { deviceId },
      data: {
        desired: mergedDesired,
        desiredVersion: newDesiredVersion,
        lastDesiredAt: new Date(),
        metadata: newMetadata as any,
      },
    });

    const version = Math.max(newDesiredVersion, updated.reportedVersion);

    const doc: ShadowDocument = {
      deviceId: updated.deviceId,
      state: {
        reported: (updated.reported as Record<string, any>) ?? {},
        desired: (updated.desired as Record<string, any>) ?? {},
        delta,
      },
      metadata: {
        reported: (updated.metadata as unknown as ShadowMetadata).reported ?? {},
        desired: (updated.metadata as unknown as ShadowMetadata).desired ?? {},
      },
      version,
      desiredVersion: newDesiredVersion,
      timestamp: now,
    };

    // Invalidate and repopulate cache
    try {
      await this.redisHelper.setShadowCache(
        deviceId,
        JSON.stringify(doc),
      );
    } catch {
      // Ignore cache errors
    }

    // 下行通知: 推送 desired 变化到设备订阅的 $shadow/get/accepted/{p}/{n}
    // (fire-and-forget, 未配置 EMQX API key 或推送失败均不影响主链路)
    void this.emqxBridge.publishShadowAccepted(
      shadow.device.productId,
      shadow.device.deviceName,
      {
        version,
        desiredVersion: newDesiredVersion,
        desired: mergedDesired,
        delta,
      },
    );

    return doc;
  }

  async updateReported(
    deviceId: string,
    reported: Record<string, any>,
  ): Promise<ShadowDocument> {
    const shadow = await this.prisma.deviceShadow.findUnique({
      where: { deviceId },
    });
    if (!shadow) {
      throw new DeviceNotFoundError(
        `Shadow not found for device: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device shadow does not exist' }],
      );
    }

    const currentDesired = (shadow.desired as Record<string, any>) ?? {};
    const currentReported = (shadow.reported as Record<string, any>) ?? {};
    const currentMetadata = (shadow.metadata as unknown as ShadowMetadata) ?? {
      reported: {},
      desired: {},
    };

    const now = Date.now();

    // Merge new reported keys into existing reported
    const mergedReported = { ...currentReported, ...reported };

    // Update metadata for each modified reported key
    const reportedMeta = { ...currentMetadata.reported };
    for (const key of Object.keys(reported)) {
      reportedMeta[key] = { timestamp: now };
    }

    // Remove satisfied desired keys: keys where reported now matches desired
    const newDesired = { ...currentDesired };
    const desiredMeta = { ...currentMetadata.desired };
    for (const key of Object.keys(reported)) {
      if (key in newDesired) {
        if (JSON.stringify(mergedReported[key]) === JSON.stringify(newDesired[key])) {
          delete newDesired[key];
          delete desiredMeta[key];
        }
      }
    }

    const newMetadata: ShadowMetadata = {
      reported: reportedMeta,
      desired: desiredMeta,
    };

    const delta = this.computeDelta(newDesired, mergedReported);
    const newReportedVersion = shadow.reportedVersion + 1;

    const updated = await this.prisma.deviceShadow.update({
      where: { deviceId },
      data: {
        reported: mergedReported,
        desired: newDesired,
        reportedVersion: newReportedVersion,
        lastReportedAt: new Date(),
        metadata: newMetadata as any,
      },
    });

    const version = Math.max(updated.desiredVersion, newReportedVersion);

    const doc: ShadowDocument = {
      deviceId: updated.deviceId,
      state: {
        reported: (updated.reported as Record<string, any>) ?? {},
        desired: (updated.desired as Record<string, any>) ?? {},
        delta,
      },
      metadata: {
        reported: (updated.metadata as unknown as ShadowMetadata).reported ?? {},
        desired: (updated.metadata as unknown as ShadowMetadata).desired ?? {},
      },
      version,
      desiredVersion: updated.desiredVersion,
      timestamp: now,
    };

    // Invalidate and repopulate cache
    try {
      await this.redisHelper.setShadowCache(
        deviceId,
        JSON.stringify(doc),
      );
    } catch {
      // Ignore cache errors
    }

    return doc;
  }

  async clearDesired(deviceId: string): Promise<void> {
    const shadow = await this.prisma.deviceShadow.findUnique({
      where: { deviceId },
      include: { device: { select: { productId: true, deviceName: true } } },
    });
    if (!shadow) {
      throw new DeviceNotFoundError(
        `Shadow not found for device: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device shadow does not exist' }],
      );
    }

    const currentMetadata = (shadow.metadata as unknown as ShadowMetadata) ?? {
      reported: {},
      desired: {},
    };

    await this.prisma.deviceShadow.update({
      where: { deviceId },
      data: {
        desired: {},
        desiredVersion: 0,
        lastDesiredAt: new Date(),
        metadata: {
          reported: currentMetadata.reported,
          desired: {},
        } as any,
      },
    });

    // Invalidate cache
    try {
      await this.redisHelper.delShadowCache(deviceId);
    } catch {
      // Ignore cache errors
    }

    // 下行通知: desired 已清空, 推送空 delta 通知设备(fire-and-forget)
    void this.emqxBridge.publishShadowAccepted(
      shadow.device.productId,
      shadow.device.deviceName,
      {
        version: shadow.reportedVersion,
        desiredVersion: 0,
        desired: {},
        delta: {},
      },
    );
  }

  async getDelta(deviceId: string): Promise<Record<string, any>> {
    const shadow = await this.prisma.deviceShadow.findUnique({
      where: { deviceId },
    });
    if (!shadow) {
      throw new DeviceNotFoundError(
        `Shadow not found for device: ${deviceId}`,
        [{ field: 'deviceId', message: 'Device shadow does not exist' }],
      );
    }

    const reported = (shadow.reported as Record<string, any>) ?? {};
    const desired = (shadow.desired as Record<string, any>) ?? {};

    return this.computeDelta(desired, reported);
  }
}
