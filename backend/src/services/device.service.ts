import type { PrismaClient } from '@prisma/client';
import ms from 'ms';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import {
  generateDeviceSecret,
  generateDeviceId,
  buildMqttClientId,
  buildMqttUsername,
  buildMqttPassword,
  timingSafeEqual,
} from '../shared/crypto.js';
import {
  ProductNotFoundError,
  DeviceNotFoundError,
  DeviceNameConflictError,
  DeviceAuthError,
  ValidationError,
  InternalError,
} from '../shared/errors.js';
import type {
  DeviceBasic,
  RegisterDeviceInput,
  RegisterDeviceOutput,
  DeviceAuthInput,
  DeviceAuthOutput,
  MqttConnectConfig,
  JwtDevicePayload,
} from '../types/index.js';

const DEVICE_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function mapDeviceToBasic(device: any): DeviceBasic {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    productId: device.productId,
    status: device.status,
    firmwareVersion: device.firmwareVersion,
    tags: device.tags,
    lastLoginAt: device.lastLoginAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

function buildMqttConfig(
  productId: string,
  deviceName: string,
  deviceSecret: string,
): MqttConnectConfig {
  const expiryTs = Math.floor(Date.now() / 1000) + 86400;
  return {
    host: config.mqttBrokerHost,
    port: config.mqttBrokerPort,
    ssl: config.mqttBrokerSsl,
    clientId: buildMqttClientId(
      productId,
      deviceName,
      config.mqttSdkAppId,
      productId,
      expiryTs,
    ),
    username: buildMqttUsername(productId, deviceName, config.mqttSdkAppId),
    password: buildMqttPassword(deviceSecret),
    subscribeTopics: [
      `$iot/${productId}/${deviceName}/property/down`,
      `$iot/${productId}/${deviceName}/action/down`,
      `$iot/${productId}/${deviceName}/shadow/accepted`,
    ],
    publishTopic: `$iot/${productId}/${deviceName}/property/up`,
  };
}

export class DeviceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redisHelper: {
      getShadowCache: (deviceId: string) => Promise<string | null>;
      setShadowCache: (deviceId: string, data: string) => Promise<void>;
      delShadowCache: (deviceId: string) => Promise<void>;
      setDeviceOnline: (deviceId: string) => Promise<void>;
      delDeviceOnline: (deviceId: string) => Promise<void>;
      isDeviceOnline: (deviceId: string) => Promise<boolean>;
    },
  ) {}

  async register(
    productId: string,
    input: RegisterDeviceInput,
  ): Promise<RegisterDeviceOutput> {
    const product = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!product) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }

    if (product.authType !== 'one-machine-one-secret') {
      throw new ValidationError(
        `Product auth type '${product.authType}' is not supported for this operation`,
        [{ field: 'authType', message: 'Only one-machine-one-secret is supported' }],
      );
    }

    if (!DEVICE_NAME_RE.test(input.device_name)) {
      throw new ValidationError(
        'device_name must be 1-128 characters and contain only letters, digits, hyphens, and underscores',
        [{ field: 'device_name', message: 'Invalid device_name format' }],
      );
    }

    const existing = await this.prisma.device.findUnique({
      where: {
        uq_device_product_name: {
          productId,
          deviceName: input.device_name,
        },
      },
    });
    if (existing) {
      throw new DeviceNameConflictError(
        `Device name '${input.device_name}' already exists in product ${productId}`,
        [{ field: 'device_name', message: 'Device name is already taken' }],
      );
    }

    const deviceSecret = generateDeviceSecret();
    const deviceId = generateDeviceId(productId, input.device_name);

    const device = await this.prisma.device.create({
      data: {
        deviceId,
        deviceName: input.device_name,
        deviceSecret,
        productId,
        status: 'not-activated',
        tags: input.tags ?? {},
      },
    });

    // Create empty shadow for the device
    await this.prisma.deviceShadow.create({
      data: {
        deviceId,
        reported: {},
        desired: {},
        reportedVersion: 0,
        desiredVersion: 0,
        metadata: {
          reported: {},
          desired: {},
        },
      },
    });

    const mqttConfig = buildMqttConfig(productId, input.device_name, deviceSecret);

    return {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceSecret,
      productId: device.productId,
      status: device.status,
      mqttConfig,
      createdAt: device.createdAt.toISOString(),
    };
  }

  async list(
    productId: string,
    query: {
      page?: number;
      page_size?: number;
      status?: string;
    },
  ): Promise<{ items: DeviceBasic[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = { productId };
    if (query.status) {
      where.status = query.status;
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
          productId: true,
          status: true,
          firmwareVersion: true,
          tags: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.device.count({ where }),
    ]);

    return {
      items: devices.map(mapDeviceToBasic),
      total,
    };
  }

  async getByName(productId: string, deviceName: string): Promise<DeviceBasic> {
    const device = await this.prisma.device.findUnique({
      where: {
        uq_device_product_name: { productId, deviceName },
      },
      select: {
        deviceId: true,
        deviceName: true,
        productId: true,
        status: true,
        firmwareVersion: true,
        tags: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceName} in product ${productId}`,
        [{ field: 'deviceName', message: 'Device does not exist' }],
      );
    }
    return mapDeviceToBasic(device);
  }

  async deleteByName(productId: string, deviceName: string): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: {
        uq_device_product_name: { productId, deviceName },
      },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceName} in product ${productId}`,
        [{ field: 'deviceName', message: 'Device does not exist' }],
      );
    }
    await this.prisma.device.delete({
      where: { deviceId: device.deviceId },
    });
  }

  async updateStatus(
    productId: string,
    deviceName: string,
    status: string,
  ): Promise<DeviceBasic> {
    const device = await this.prisma.device.findUnique({
      where: {
        uq_device_product_name: { productId, deviceName },
      },
    });
    if (!device) {
      throw new DeviceNotFoundError(
        `Device not found: ${deviceName} in product ${productId}`,
        [{ field: 'deviceName', message: 'Device does not exist' }],
      );
    }

    const updated = await this.prisma.device.update({
      where: { deviceId: device.deviceId },
      data: { status },
      select: {
        deviceId: true,
        deviceName: true,
        productId: true,
        status: true,
        firmwareVersion: true,
        tags: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return mapDeviceToBasic(updated);
  }

  async batchRegister(
    productId: string,
    items: RegisterDeviceInput[],
  ): Promise<RegisterDeviceOutput[]> {
    const results: RegisterDeviceOutput[] = [];
    for (const item of items) {
      const result = await this.register(productId, item);
      results.push(result);
    }
    return results;
  }

  async authenticate(input: DeviceAuthInput): Promise<DeviceAuthOutput> {
    const device = await this.prisma.device.findUnique({
      where: {
        uq_device_product_name: {
          productId: input.product_id,
          deviceName: input.device_name,
        },
      },
    });
    if (!device) {
      throw new DeviceAuthError(
        'Device authentication failed',
        [{ field: 'credentials', message: 'Invalid product_id or device_name' }],
      );
    }

    if (device.status === 'disabled') {
      throw new DeviceAuthError(
        'Device is disabled',
        [{ field: 'status', message: 'Device has been disabled' }],
      );
    }

    if (!timingSafeEqual(device.deviceSecret, input.device_secret)) {
      throw new DeviceAuthError(
        'Device authentication failed',
        [{ field: 'credentials', message: 'Invalid device_secret' }],
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const payload: JwtDevicePayload = {
      deviceId: device.deviceId,
      productId: device.productId,
      deviceName: device.deviceName,
    };

    const expiresInSeconds = Math.floor(Number(ms(config.deviceTokenExpiresIn as any)) / 1000);

    const accessToken = jwt.sign(payload, config.jwtSecret as string, {
      expiresIn: expiresInSeconds,
    });

    // Decode to get actual expiry for calculating expires_in
    const decoded = jwt.decode(accessToken) as { exp: number };
    const expiresIn = decoded.exp - now;

    // Update device status and login timestamp
    await this.prisma.device.update({
      where: { deviceId: device.deviceId },
      data: {
        status: 'online',
        lastLoginAt: new Date(),
      },
    });

    // Mark device online in Redis
    await this.redisHelper.setDeviceOnline(device.deviceId);

    const mqttConfig = buildMqttConfig(
      device.productId,
      device.deviceName,
      device.deviceSecret,
    );

    return {
      access_token: accessToken,
      expires_in: expiresIn,
      mqttConfig,
    };
  }
}
