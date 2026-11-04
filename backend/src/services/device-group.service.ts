import type { PrismaClient } from '@prisma/client';
import {
  GroupNotFoundError,
  GroupNameConflictError,
  ValidationError,
} from '../shared/errors.js';

export interface GroupListItem {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: Date;
  updatedAt: Date;
  deviceCount: number;
}

export interface GroupMemberDevice {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: string;
  lastLoginAt: Date | null;
}

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class DeviceGroupService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<GroupListItem[]> {
    const groups = await this.prisma.deviceGroup.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { devices: true } } },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      color: g.color,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      deviceCount: g._count.devices,
    }));
  }

  async create(input: {
    name: string;
    description?: string | null;
    color?: string;
  }): Promise<GroupListItem> {
    await this.assertNameAvailable(input.name);

    const group = await this.prisma.deviceGroup.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? '#0052D9',
      },
    });
    return { ...group, deviceCount: 0 };
  }

  async update(
    groupId: string,
    input: { name?: string; description?: string | null; color?: string },
  ): Promise<GroupListItem> {
    const existing = await this.prisma.deviceGroup.findUnique({
      where: { id: groupId },
    });
    if (!existing) {
      throw new GroupNotFoundError(`Device group not found: ${groupId}`);
    }

    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(input.name);
    }

    const group = await this.prisma.deviceGroup.update({
      where: { id: groupId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      include: { _count: { select: { devices: true } } },
    });

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      deviceCount: group._count.devices,
    };
  }

  async delete(groupId: string): Promise<void> {
    const existing = await this.prisma.deviceGroup.findUnique({
      where: { id: groupId },
    });
    if (!existing) {
      throw new GroupNotFoundError(`Device group not found: ${groupId}`);
    }
    // Device.groupId 由外键 onDelete: SetNull 自动置空
    await this.prisma.deviceGroup.delete({ where: { id: groupId } });
  }

  async listDevices(groupId: string): Promise<GroupMemberDevice[]> {
    const group = await this.prisma.deviceGroup.findUnique({
      where: { id: groupId },
      include: {
        devices: {
          orderBy: { createdAt: 'asc' },
          include: { product: { select: { productName: true } } },
        },
      },
    });
    if (!group) {
      throw new GroupNotFoundError(`Device group not found: ${groupId}`);
    }
    return group.devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      productId: d.productId,
      productName: d.product?.productName ?? d.productId,
      status: d.status,
      lastLoginAt: d.lastLoginAt,
    }));
  }

  /**
   * 全量替换分组成员: device_ids 列表即组内最终成员集合。
   * 设备不存在时整体拒绝(事务), 不做部分成功。
   */
  async setDevices(groupId: string, deviceIds: string[]): Promise<void> {
    const group = await this.prisma.deviceGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      throw new GroupNotFoundError(`Device group not found: ${groupId}`);
    }

    if (deviceIds.length > 0) {
      const found = await this.prisma.device.findMany({
        where: { deviceId: { in: deviceIds } },
        select: { deviceId: true },
      });
      if (found.length !== deviceIds.length) {
        const foundIds = new Set(found.map((d) => d.deviceId));
        const missing = deviceIds.filter((id) => !foundIds.has(id));
        throw new ValidationError('Some devices do not exist', [
          { field: 'device_ids', message: `Unknown devices: ${missing.join(', ')}` },
        ]);
      }
    }

    await this.prisma.$transaction([
      // 先清空当前成员(含其他组中可能被移入的设备)
      this.prisma.device.updateMany({
        where: { groupId },
        data: { groupId: null },
      }),
      // 再设置目标成员(设备从原组移出是 updateMany 的自然结果)
      ...(deviceIds.length > 0
        ? [
            this.prisma.device.updateMany({
              where: { deviceId: { in: deviceIds } },
              data: { groupId },
            }),
          ]
        : []),
    ]);
  }

  private async assertNameAvailable(name: string): Promise<void> {
    if (!name.trim()) {
      throw new ValidationError('Group name is required', [
        { field: 'name', message: 'Name cannot be empty' },
      ]);
    }
    if (name.length > 64) {
      throw new ValidationError('Group name too long', [
        { field: 'name', message: 'Name must be at most 64 characters' },
      ]);
    }
    const conflict = await this.prisma.deviceGroup.findUnique({
      where: { name },
    });
    if (conflict) {
      throw new GroupNameConflictError(`Group name already exists: ${name}`);
    }
  }

  validateColor(color: string | undefined): string | undefined {
    if (color === undefined) return undefined;
    if (!COLOR_PATTERN.test(color)) {
      throw new ValidationError('Invalid color format', [
        { field: 'color', message: 'Color must be a hex value like #0052D9' },
      ]);
    }
    return color;
  }
}
