import type { PrismaClient, Prisma } from '@prisma/client';
import {
  RuleNotFoundError,
  RuleNameConflictError,
  ProductNotFoundError,
  ValidationError,
} from '../shared/errors.js';

/**
 * 消息转发规则管理 — CRUD + 每规则今日统计 + 转发日志 + 总览指标 + 消息主题统计
 */

export interface RuleListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  productId: string;
  productName: string;
  messageType: string;
  filter: Record<string, unknown>;
  targetType: string;
  targetConfig: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  todayCount: number;
  todaySuccessRate: number | null; // 0-100, null=今日无转发
}

export interface RuleInput {
  name: string;
  description?: string | null;
  productId: string;
  messageType: string;
  filter?: Record<string, unknown>;
  targetType: string;
  targetConfig: Record<string, unknown>;
  status?: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export class ForwardRuleService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- 规则 CRUD ----------

  async list(): Promise<RuleListItem[]> {
    const rules = await this.prisma.forwardRule.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const logStats = await this.prisma.forwardLog.groupBy({
      by: ['ruleId', 'result'],
      where: { createdAt: { gte: startOfToday() } },
      _count: { _all: true },
    });
    const todayMap = new Map<string, { total: number; success: number }>();
    for (const s of logStats) {
      const entry = todayMap.get(s.ruleId) ?? { total: 0, success: 0 };
      entry.total += s._count._all;
      if (s.result === 'success') entry.success += s._count._all;
      todayMap.set(s.ruleId, entry);
    }

    const products = await this.prisma.product.findMany({
      select: { productId: true, productName: true },
    });
    const productNameMap = new Map(products.map((p) => [p.productId, p.productName]));

    return rules.map((r) => {
      const today = todayMap.get(r.id) ?? { total: 0, success: 0 };
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        productId: r.productId,
        productName: productNameMap.get(r.productId) ?? r.productId,
        messageType: r.messageType,
        filter: (r.filter ?? {}) as Record<string, unknown>,
        targetType: r.targetType,
        targetConfig: (r.targetConfig ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        todayCount: today.total,
        todaySuccessRate: today.total > 0 ? Math.round((today.success / today.total) * 100) : null,
      };
    });
  }

  async create(input: RuleInput): Promise<RuleListItem> {
    await this.validateInput(input);
    await this.assertNameAvailable(input.name);

    const rule = await this.prisma.forwardRule.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        productId: input.productId,
        messageType: input.messageType,
        filter: (input.filter ?? {}) as Prisma.InputJsonValue,
        targetType: input.targetType,
        targetConfig: input.targetConfig as Prisma.InputJsonValue,
        status: input.status ?? 'enabled',
      },
    });

    const product = await this.prisma.product.findUnique({
      where: { productId: input.productId },
      select: { productName: true },
    });

    return {
      ...rule,
      filter: (rule.filter ?? {}) as Record<string, unknown>,
      targetConfig: (rule.targetConfig ?? {}) as Record<string, unknown>,
      productName: product?.productName ?? input.productId,
      todayCount: 0,
      todaySuccessRate: null,
    };
  }

  async update(ruleId: string, input: RuleInput): Promise<RuleListItem> {
    const existing = await this.prisma.forwardRule.findUnique({ where: { id: ruleId } });
    if (!existing) throw new RuleNotFoundError(`转发规则不存在: ${ruleId}`);

    await this.validateInput(input);
    if (input.name.trim() !== existing.name) {
      await this.assertNameAvailable(input.name);
    }

    await this.prisma.forwardRule.update({
      where: { id: ruleId },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        productId: input.productId,
        messageType: input.messageType,
        filter: (input.filter ?? {}) as Prisma.InputJsonValue,
        targetType: input.targetType,
        targetConfig: input.targetConfig as Prisma.InputJsonValue,
      },
    });
    return this.listOne(ruleId);
  }

  async delete(ruleId: string): Promise<void> {
    const existing = await this.prisma.forwardRule.findUnique({ where: { id: ruleId } });
    if (!existing) throw new RuleNotFoundError(`转发规则不存在: ${ruleId}`);
    await this.prisma.forwardRule.delete({ where: { id: ruleId } });
  }

  async toggleStatus(ruleId: string, status: string): Promise<RuleListItem> {
    const existing = await this.prisma.forwardRule.findUnique({ where: { id: ruleId } });
    if (!existing) throw new RuleNotFoundError(`转发规则不存在: ${ruleId}`);
    if (status !== 'enabled' && status !== 'disabled') {
      throw new ValidationError('状态只允许 enabled / disabled');
    }
    await this.prisma.forwardRule.update({ where: { id: ruleId }, data: { status } });
    return this.listOne(ruleId);
  }

  // ---------- 转发日志 ----------

  async listLogs(query: {
    result?: string;
    ruleId?: string;
    messageType?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where = {
      ...(query.result === 'success' || query.result === 'failed' ? { result: query.result } : {}),
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      ...(query.messageType === 'property' || query.messageType === 'event'
        ? { messageType: query.messageType }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.forwardLog.count({ where }),
      this.prisma.forwardLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 解析设备名(日志只存 deviceId 哈希)
    const deviceIds = [...new Set(items.map((l) => l.deviceId))];
    const deviceRows = deviceIds.length
      ? await this.prisma.device.findMany({
          where: { deviceId: { in: deviceIds } },
          select: { deviceId: true, deviceName: true },
        })
      : [];
    const deviceNameMap = new Map(deviceRows.map((d) => [d.deviceId, d.deviceName]));

    return {
      total,
      page,
      page_size: pageSize,
      items: items.map((l) => ({
        id: l.id.toString(),
        rule_id: l.ruleId,
        rule_name: l.ruleName,
        device_id: l.deviceId,
        device_name: deviceNameMap.get(l.deviceId) ?? l.deviceId.slice(0, 12),
        message_type: l.messageType,
        topic: l.topic,
        payload: l.payload,
        result: l.result,
        error_msg: l.errorMsg,
        latency_ms: l.latencyMs,
        time: l.createdAt,
      })),
    };
  }

  // ---------- 总览指标 ----------

  async stats() {
    const dayStart = startOfToday();

    const [ruleCount, enabledCount, todayLogs] = await Promise.all([
      this.prisma.forwardRule.count(),
      this.prisma.forwardRule.count({ where: { status: 'enabled' } }),
      this.prisma.forwardLog.groupBy({
        by: ['result'],
        where: { createdAt: { gte: dayStart } },
        _count: { _all: true },
      }),
    ]);

    const todayTotal = todayLogs.reduce((acc, s) => acc + s._count._all, 0);
    const todaySuccess = todayLogs
      .filter((s) => s.result === 'success')
      .reduce((acc, s) => acc + s._count._all, 0);

    return {
      rule_count: ruleCount,
      enabled_count: enabledCount,
      today_forward_count: todayTotal,
      today_success_rate: todayTotal > 0 ? Math.round((todaySuccess / todayTotal) * 100) : null,
    };
  }

  // ---------- 消息主题统计(真实数据聚合) ----------

  async topics() {
    const rows = await this.prisma.$queryRaw<Array<{
      productId: string;
      kind: string;
      messages: number;
      lastActive: Date;
    }>>`
      SELECT product_id AS "productId",
             kind,
             COUNT(*)::int AS messages,
             MAX(ts) AS "lastActive"
      FROM (
        SELECT d."productId" AS product_id, 'property' AS kind, h."timestamp" AS ts
        FROM device_property_history h JOIN devices d ON h."deviceId" = d."deviceId"
        UNION ALL
        SELECT d."productId" AS product_id, 'event' AS kind, e."timestamp" AS ts
        FROM device_event_logs e JOIN devices d ON e."deviceId" = d."deviceId"
      ) t
      GROUP BY product_id, kind
    `;

    const products = await this.prisma.product.findMany({
      select: { productId: true, productName: true },
    });
    const productNameMap = new Map(products.map((p) => [p.productId, p.productName]));

    return rows
      .map((r) => ({
        topic:
          r.kind === 'event'
            ? `$thing/up/${r.productId}/+/event/post`
            : `$thing/up/${r.productId}/+/property/post`,
        type: r.kind === 'event' ? '设备事件' : '设备上报',
        product_id: r.productId,
        product_name: productNameMap.get(r.productId) ?? r.productId,
        messages: Number(r.messages),
        last_active: r.lastActive,
      }))
      .sort((a, b) => b.messages - a.messages);
  }

  // ---------- 内部辅助 ----------

  private async listOne(ruleId: string): Promise<RuleListItem> {
    const all = await this.list();
    const found = all.find((r) => r.id === ruleId);
    if (!found) throw new RuleNotFoundError(`转发规则不存在: ${ruleId}`);
    return found;
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.prisma.forwardRule.findUnique({ where: { name } });
    if (existing) throw new RuleNameConflictError(`规则名称已存在: ${name}`);
  }

  private async validateInput(input: RuleInput): Promise<void> {
    if (!input.name || input.name.trim().length === 0 || input.name.trim().length > 64) {
      throw new ValidationError('规则名称长度需在 1-64 之间');
    }
    if (input.messageType !== 'property' && input.messageType !== 'event') {
      throw new ValidationError('消息类型只允许 property / event');
    }
    if (input.targetType !== 'http' && input.targetType !== 'republish') {
      throw new ValidationError('转发方式只允许 http / republish');
    }

    const product = await this.prisma.product.findUnique({
      where: { productId: input.productId },
      select: { productId: true },
    });
    if (!product) throw new ProductNotFoundError(`产品不存在: ${input.productId}`);

    if (input.targetType === 'http') {
      const url = String(input.targetConfig?.url ?? '');
      if (!/^https?:\/\//.test(url)) {
        throw new ValidationError('HTTP 转发目标必须是以 http:// 或 https:// 开头的 URL');
      }
    } else {
      const topic = String(input.targetConfig?.topic ?? '');
      if (topic.trim().length === 0 || topic.length > 255) {
        throw new ValidationError('重新发布目标 topic 不能为空且不超过 255 字符');
      }
    }

    const filter = input.filter ?? {};
    if (filter.identifiers !== undefined && !Array.isArray(filter.identifiers)) {
      throw new ValidationError('筛选条件 identifiers 必须是字符串数组');
    }
    if (filter.eventTypes !== undefined && !Array.isArray(filter.eventTypes)) {
      throw new ValidationError('筛选条件 eventTypes 必须是字符串数组');
    }
  }
}
