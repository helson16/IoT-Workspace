import type { PrismaClient } from '@prisma/client';
import { generateProductId } from '../shared/crypto.js';
import { thingModelValidator } from '../shared/validator.js';
import {
  ProductNotFoundError,
  ThingModelInvalidError,
  InternalError,
} from '../shared/errors.js';
import type {
  CreateProductInput,
  ProductBasic,
  ThingModelSnapshot,
} from '../types/index.js';

function mapProductToBasic(product: any): ProductBasic {
  return {
    productId: product.productId,
    productName: product.productName,
    category: product.category,
    protocolType: product.protocolType,
    networkType: product.networkType,
    dataProtocol: product.dataProtocol,
    authType: product.authType,
    nodeType: product.nodeType,
    description: product.description,
    status: product.status,
    thingModelVersion: product.thingModelVersion,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export class ProductService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateProductInput): Promise<ProductBasic> {
    if (input.thing_model) {
      const result = thingModelValidator.validateDefinition(input.thing_model);
      if (!result.valid) {
        throw new ThingModelInvalidError(
          'Thing model definition is invalid',
          result.errors?.map((e) => ({ field: e.field, message: e.message })),
        );
      }
    }

    const productId = generateProductId();
    const thingModel = input.thing_model ?? {};

    const product = await this.prisma.product.create({
      data: {
        productId,
        productName: input.product_name,
        category: input.category ?? 'Custom',
        protocolType: input.protocol_type ?? 'MQTT',
        networkType: input.network_type ?? 'WiFi',
        dataProtocol: input.data_protocol ?? 'MQTT-JSON',
        authType: input.auth_type ?? 'one-machine-one-secret',
        nodeType: input.node_type ?? 'device',
        description: input.description ?? null,
        thingModel,
        thingModelVersion: 1,
      },
    });

    // Persist thing model sub-tables if arrays exist
    const properties = (thingModel as any).properties;
    const events = (thingModel as any).events;
    const actions = (thingModel as any).actions;

    if (
      (Array.isArray(properties) && properties.length > 0) ||
      (Array.isArray(events) && events.length > 0) ||
      (Array.isArray(actions) && actions.length > 0)
    ) {
      await this.upsertThingModelTables(productId, thingModel);
    }

    return mapProductToBasic(product);
  }

  async list(query: {
    page?: number;
    page_size?: number;
    status?: string;
  }): Promise<{ items: ProductBasic[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    // 附加设备统计(总数/在线数)
    const productIds = products.map((p: any) => p.productId);
    const deviceGroups = await this.prisma.device.groupBy({
      by: ['productId', 'status'],
      where: { productId: { in: productIds } },
      _count: { _all: true },
    });
    const statsMap = new Map<string, { total: number; online: number }>();
    for (const g of deviceGroups) {
      const s = statsMap.get(g.productId) ?? { total: 0, online: 0 };
      s.total += g._count._all;
      if (g.status === 'online') s.online = g._count._all;
      statsMap.set(g.productId, s);
    }

    return {
      items: products.map((p: any) => ({
        ...mapProductToBasic(p),
        deviceCount: statsMap.get(p.productId)?.total ?? 0,
        onlineCount: statsMap.get(p.productId)?.online ?? 0,
      })),
      total,
    };
  }

  async getById(productId: string): Promise<ProductBasic> {
    const product = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!product) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }
    return mapProductToBasic(product);
  }

  async update(
    productId: string,
    data: Partial<CreateProductInput>,
  ): Promise<ProductBasic> {
    const existing = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!existing) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }

    const updateData: any = {};
    if (data.product_name !== undefined) updateData.productName = data.product_name;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.protocol_type !== undefined) updateData.protocolType = data.protocol_type;
    if (data.network_type !== undefined) updateData.networkType = data.network_type;
    if (data.data_protocol !== undefined) updateData.dataProtocol = data.data_protocol;
    if (data.auth_type !== undefined) updateData.authType = data.auth_type;
    if (data.node_type !== undefined) updateData.nodeType = data.node_type;
    if (data.description !== undefined) updateData.description = data.description;

    if (data.thing_model) {
      const result = thingModelValidator.validateDefinition(data.thing_model);
      if (!result.valid) {
        throw new ThingModelInvalidError(
          'Thing model definition is invalid',
          result.errors?.map((e) => ({ field: e.field, message: e.message })),
        );
      }
      updateData.thingModel = data.thing_model;
      await this.upsertThingModelTables(productId, data.thing_model);
    }

    const updated = await this.prisma.product.update({
      where: { productId },
      data: updateData,
    });

    return mapProductToBasic(updated);
  }

  async delete(productId: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!existing) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }
    await this.prisma.product.delete({
      where: { productId },
    });
  }

  async getThingModelSnapshot(productId: string): Promise<ThingModelSnapshot> {
    const product = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!product) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }

    const [properties, events, actions] = await this.prisma.$transaction([
      this.prisma.thingModelProperty.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.thingModelEvent.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.thingModelAction.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return {
      productId,
      version: product.thingModelVersion,
      properties: properties as any,
      events: events as any,
      actions: actions as any,
    };
  }

  async updateThingModel(
    productId: string,
    thingModel: any,
  ): Promise<ThingModelSnapshot> {
    const result = thingModelValidator.validateDefinition(thingModel);
    if (!result.valid) {
      throw new ThingModelInvalidError(
        'Thing model definition is invalid',
        result.errors?.map((e) => ({ field: e.field, message: e.message })),
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { productId },
    });
    if (!product) {
      throw new ProductNotFoundError(
        `Product not found: ${productId}`,
        [{ field: 'productId', message: 'Product does not exist' }],
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Delete existing sub-table entries
      await tx.thingModelProperty.deleteMany({ where: { productId } });
      await tx.thingModelEvent.deleteMany({ where: { productId } });
      await tx.thingModelAction.deleteMany({ where: { productId } });

      // Create new entries
      const properties = Array.isArray(thingModel.properties)
        ? thingModel.properties
        : [];
      const events = Array.isArray(thingModel.events) ? thingModel.events : [];
      const actions = Array.isArray(thingModel.actions) ? thingModel.actions : [];

      for (let i = 0; i < properties.length; i++) {
        const prop = properties[i];
        await tx.thingModelProperty.create({
          data: {
            productId,
            identifier: prop.identifier,
            name: prop.name,
            dataType: prop.dataType,
            accessMode: prop.accessMode ?? 'rw',
            description: prop.description ?? null,
            spec: prop.spec ?? {},
            required: prop.required ?? false,
            sortOrder: prop.sortOrder ?? i,
          },
        });
      }

      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        await tx.thingModelEvent.create({
          data: {
            productId,
            identifier: evt.identifier,
            name: evt.name,
            eventType: evt.eventType ?? 'info',
            description: evt.description ?? null,
            outputParams: evt.outputParams ?? [],
            sortOrder: evt.sortOrder ?? i,
          },
        });
      }

      for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        await tx.thingModelAction.create({
          data: {
            productId,
            identifier: act.identifier,
            name: act.name,
            description: act.description ?? null,
            inputParams: act.inputParams ?? [],
            outputParams: act.outputParams ?? [],
            asyncFlag: act.asyncFlag ?? false,
            callStrategy: act.callStrategy ?? 'direct',
            sortOrder: act.sortOrder ?? i,
          },
        });
      }

      // Update the product itself
      return tx.product.update({
        where: { productId },
        data: {
          thingModel,
          thingModelVersion: { increment: 1 },
        },
      });
    });

    const [properties, events, actions] = await this.prisma.$transaction([
      this.prisma.thingModelProperty.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.thingModelEvent.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.thingModelAction.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return {
      productId,
      version: updated.thingModelVersion,
      properties: properties as any,
      events: events as any,
      actions: actions as any,
    };
  }

  private async upsertThingModelTables(
    productId: string,
    thingModel: any,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.thingModelProperty.deleteMany({ where: { productId } });
      await tx.thingModelEvent.deleteMany({ where: { productId } });
      await tx.thingModelAction.deleteMany({ where: { productId } });

      const properties = Array.isArray(thingModel.properties)
        ? thingModel.properties
        : [];
      const events = Array.isArray(thingModel.events) ? thingModel.events : [];
      const actions = Array.isArray(thingModel.actions) ? thingModel.actions : [];

      for (let i = 0; i < properties.length; i++) {
        const prop = properties[i];
        await tx.thingModelProperty.create({
          data: {
            productId,
            identifier: prop.identifier,
            name: prop.name,
            dataType: prop.dataType,
            accessMode: prop.accessMode ?? 'rw',
            description: prop.description ?? null,
            spec: prop.spec ?? {},
            required: prop.required ?? false,
            sortOrder: prop.sortOrder ?? i,
          },
        });
      }

      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        await tx.thingModelEvent.create({
          data: {
            productId,
            identifier: evt.identifier,
            name: evt.name,
            eventType: evt.eventType ?? 'info',
            description: evt.description ?? null,
            outputParams: evt.outputParams ?? [],
            sortOrder: evt.sortOrder ?? i,
          },
        });
      }

      for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        await tx.thingModelAction.create({
          data: {
            productId,
            identifier: act.identifier,
            name: act.name,
            description: act.description ?? null,
            inputParams: act.inputParams ?? [],
            outputParams: act.outputParams ?? [],
            asyncFlag: act.asyncFlag ?? false,
            callStrategy: act.callStrategy ?? 'direct',
            sortOrder: act.sortOrder ?? i,
          },
        });
      }
    });
  }
}
