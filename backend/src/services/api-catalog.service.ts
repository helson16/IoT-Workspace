/**
 * API Explorer 域服务: 平台 API 目录 + 在线调试调用记录
 *
 * - API_CATALOG: 静态枚举本服务全部 REST 端点(与 routes/*.routes.ts 一一对应)
 * - 纯函数: findApiById / buildInvokeRequest / truncateForStore / buildHistoryStats
 * - ApiExplorerService: 调用记录写入 / 历史查询 / 统计
 *
 * 安全边界: invoke 请求只接受目录条目 id, method/path 模板由后端目录决定,
 * path/query 参数按条目声明白名单拼接, 前端无法注入任意 URL。
 */

import type { PrismaClient } from '@prisma/client';
import { ValidationError } from '../shared/errors.js';

// ---------------- 类型与常量 ----------------

export interface ApiParamDoc {
  name: string;
  type: 'string' | 'integer' | 'object' | 'array' | 'enum';
  description: string;
  example?: string;
  required?: boolean;
}

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiCatalogEntry {
  id: string;
  group: string;
  name: string;
  method: ApiMethod;
  path: string; // 模板路径, 如 /api/v1/products/:productId
  description: string;
  invocable: boolean; // false = 仅文档展示(internal 域)
  pathParams?: ApiParamDoc[];
  queryParams?: ApiParamDoc[];
  bodyExample?: Record<string, unknown>;
}

export interface ApiGroupMeta {
  key: string;
  name: string;
  description: string;
}

export const API_GROUPS: ApiGroupMeta[] = [
  { key: 'auth', name: '认证授权', description: '设备认证与平台访问令牌签发' },
  { key: 'products', name: '产品管理', description: '产品 CRUD 与物模型管理' },
  { key: 'devices', name: '设备管理', description: '设备注册 / 列表 / 详情 / 状态' },
  { key: 'shadows', name: '设备影子', description: '影子文档查询与期望状态下发' },
  { key: 'groups', name: '设备分组', description: '分组管理与成员维护' },
  { key: 'stats', name: '数据统计', description: '控制台概览聚合统计' },
  { key: 'ops', name: '监控运维', description: '运维指标与统一日志流' },
  { key: 'rules', name: '消息转发', description: '规则引擎转发规则与日志' },
  { key: 'analytics', name: '数据分析', description: '云存数据聚合图表与洞察' },
  { key: 'security', name: '安全认证', description: '设备凭证与认证审计' },
  { key: 'tools', name: '调试工具', description: '命令解析等开发辅助接口' },
  { key: 'internal', name: '内部回调', description: 'EMQX / 设备链路内部接口(X-Internal-Secret 鉴权, 不开放在线调试)' },
];

const pageParam: ApiParamDoc = { name: 'page', type: 'integer', description: '页码(从 1 开始)', example: '1' };
const pageSizeParam: ApiParamDoc = { name: 'page_size', type: 'integer', description: '每页条数(1-100)', example: '20' };

const deviceListQuery: ApiParamDoc[] = [
  pageParam,
  pageSizeParam,
  { name: 'status', type: 'enum', description: '设备状态筛选', example: 'online' },
  { name: 'keyword', type: 'string', description: '设备名/产品名模糊搜索', example: '' },
];

export const API_CATALOG: ApiCatalogEntry[] = [
  // ---------------- 认证授权 ----------------
  {
    id: 'auth.device',
    group: 'auth',
    name: '设备认证',
    method: 'POST',
    path: '/api/v1/auth/device',
    description: '设备一机一密认证, 签发设备级 JWT 并标记在线',
    invocable: true,
    bodyExample: { product_id: '', device_name: '', device_secret: '' },
  },
  {
    id: 'auth.platform-token',
    group: 'auth',
    name: '获取平台令牌',
    method: 'POST',
    path: '/api/v1/auth/platform-token',
    description: 'AppKey/AppSecret 换取平台访问令牌(Bearer Token)',
    invocable: true,
    bodyExample: { app_key: 'iot-explorer-app-key', app_secret: 'iot-explorer-app-secret' },
  },

  // ---------------- 产品管理 ----------------
  {
    id: 'products.list',
    group: 'products',
    name: '产品列表',
    method: 'GET',
    path: '/api/v1/products',
    description: '分页获取产品列表, 含设备数/在线数聚合',
    invocable: true,
    queryParams: [pageParam, pageSizeParam],
  },
  {
    id: 'products.get',
    group: 'products',
    name: '产品详情',
    method: 'GET',
    path: '/api/v1/products/:productId',
    description: '获取指定产品详情',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
  },
  {
    id: 'products.create',
    group: 'products',
    name: '创建产品',
    method: 'POST',
    path: '/api/v1/products',
    description: '创建产品, 可携带 thing_model 一并导入物模型',
    invocable: true,
    bodyExample: {
      product_name: '新产品',
      category: '环境监测',
      protocol_type: 'MQTT',
      network_type: 'WiFi',
      node_type: 'device',
    },
  },
  {
    id: 'products.update',
    group: 'products',
    name: '更新产品',
    method: 'PUT',
    path: '/api/v1/products/:productId',
    description: '更新产品基础信息',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
    bodyExample: { product_name: '新产品', description: '更新后的描述' },
  },
  {
    id: 'products.delete',
    group: 'products',
    name: '删除产品',
    method: 'DELETE',
    path: '/api/v1/products/:productId',
    description: '删除产品(级联删除其设备与物模型)',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
  },
  {
    id: 'products.thing-model.get',
    group: 'products',
    name: '查询物模型',
    method: 'GET',
    path: '/api/v1/products/:productId/thing-model',
    description: '获取产品物模型快照(属性/事件/行为)',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
  },
  {
    id: 'products.thing-model.update',
    group: 'products',
    name: '更新物模型',
    method: 'PUT',
    path: '/api/v1/products/:productId/thing-model',
    description: '全量替换产品物模型定义',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
    bodyExample: {
      properties: [
        { identifier: 'temperature', name: '温度', dataType: 'float', accessMode: 'r', spec: { min: -40, max: 80, unit: '°C' } },
      ],
      events: [],
      actions: [],
    },
  },

  // ---------------- 设备管理 ----------------
  {
    id: 'devices.list',
    group: 'devices',
    name: '全局设备列表',
    method: 'GET',
    path: '/api/v1/devices',
    description: '跨产品分页设备列表, 含各状态计数',
    invocable: true,
    queryParams: deviceListQuery,
  },
  {
    id: 'devices.get',
    group: 'devices',
    name: '设备详情',
    method: 'GET',
    path: '/api/v1/devices/:deviceId',
    description: '按全局 deviceId 获取设备详情(含产品信息)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },
  {
    id: 'devices.telemetry',
    group: 'devices',
    name: '设备遥测',
    method: 'GET',
    path: '/api/v1/devices/:deviceId/telemetry',
    description: '获取设备最新遥测数据点',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
    queryParams: [{ name: 'limit', type: 'integer', description: '返回条数上限', example: '20' }],
  },
  {
    id: 'devices.register',
    group: 'devices',
    name: '注册设备',
    method: 'POST',
    path: '/api/v1/products/:productId/devices/register',
    description: '在指定产品下注册设备, 返回设备密钥与 MQTT 连接配置',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
    bodyExample: { device_name: 'new-device-01' },
  },
  {
    id: 'devices.batch-register',
    group: 'devices',
    name: '批量注册设备',
    method: 'POST',
    path: '/api/v1/products/:productId/devices/batch-register',
    description: '批量注册设备(单次最多 50 台)',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
    bodyExample: { devices: [{ device_name: 'batch-device-01' }] },
  },
  {
    id: 'devices.product-list',
    group: 'devices',
    name: '产品设备列表',
    method: 'GET',
    path: '/api/v1/products/:productId/devices',
    description: '获取指定产品下的设备列表',
    invocable: true,
    pathParams: [{ name: 'productId', type: 'string', description: '产品 ID', example: '', required: true }],
    queryParams: deviceListQuery,
  },
  {
    id: 'devices.product-get',
    group: 'devices',
    name: '产品设备详情',
    method: 'GET',
    path: '/api/v1/products/:productId/devices/:deviceName',
    description: '按产品 ID + 设备名获取设备(含密钥)',
    invocable: true,
    pathParams: [
      { name: 'productId', type: 'string', description: '产品 ID', example: '', required: true },
      { name: 'deviceName', type: 'string', description: '设备名称', example: '', required: true },
    ],
  },
  {
    id: 'devices.delete',
    group: 'devices',
    name: '删除设备',
    method: 'DELETE',
    path: '/api/v1/products/:productId/devices/:deviceName',
    description: '删除指定设备(级联清理影子与历史)',
    invocable: true,
    pathParams: [
      { name: 'productId', type: 'string', description: '产品 ID', example: '', required: true },
      { name: 'deviceName', type: 'string', description: '设备名称', example: '', required: true },
    ],
  },
  {
    id: 'devices.status',
    group: 'devices',
    name: '更新设备状态',
    method: 'PATCH',
    path: '/api/v1/products/:productId/devices/:deviceName/status',
    description: '变更设备状态(online/offline/not-activated/disabled)',
    invocable: true,
    pathParams: [
      { name: 'productId', type: 'string', description: '产品 ID', example: '', required: true },
      { name: 'deviceName', type: 'string', description: '设备名称', example: '', required: true },
    ],
    bodyExample: { status: 'disabled' },
  },

  // ---------------- 设备影子 ----------------
  {
    id: 'shadows.get',
    group: 'shadows',
    name: '查询影子',
    method: 'GET',
    path: '/api/v1/shadows/:deviceId',
    description: '获取设备影子文档(reported/desired/delta)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },
  {
    id: 'shadows.update',
    group: 'shadows',
    name: '下发期望状态',
    method: 'PUT',
    path: '/api/v1/shadows/:deviceId',
    description: '更新影子 desired 状态(乐观锁 version 校验)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
    bodyExample: { state: { desired: { switch: true } }, version: 0 },
  },
  {
    id: 'shadows.clear-desired',
    group: 'shadows',
    name: '清除期望状态',
    method: 'DELETE',
    path: '/api/v1/shadows/:deviceId/desired',
    description: '清除影子全部期望状态',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },
  {
    id: 'shadows.delta',
    group: 'shadows',
    name: '查询增量',
    method: 'GET',
    path: '/api/v1/shadows/:deviceId/delta',
    description: '获取影子 delta(reported 与 desired 的差异)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },

  // ---------------- 设备分组 ----------------
  {
    id: 'groups.list',
    group: 'groups',
    name: '分组列表',
    method: 'GET',
    path: '/api/v1/device-groups',
    description: '获取全部设备分组(含设备数)',
    invocable: true,
  },
  {
    id: 'groups.create',
    group: 'groups',
    name: '创建分组',
    method: 'POST',
    path: '/api/v1/device-groups',
    description: '创建设备分组',
    invocable: true,
    bodyExample: { name: '新分组', description: '分组描述', color: '#0052D9' },
  },
  {
    id: 'groups.update',
    group: 'groups',
    name: '更新分组',
    method: 'PUT',
    path: '/api/v1/device-groups/:id',
    description: '更新分组名称/描述/颜色',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '分组 ID(UUID)', example: '', required: true }],
    bodyExample: { name: '更新后的分组', description: '新描述' },
  },
  {
    id: 'groups.delete',
    group: 'groups',
    name: '删除分组',
    method: 'DELETE',
    path: '/api/v1/device-groups/:id',
    description: '删除分组(不解绑设备)',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '分组 ID(UUID)', example: '', required: true }],
  },
  {
    id: 'groups.devices',
    group: 'groups',
    name: '分组成员列表',
    method: 'GET',
    path: '/api/v1/device-groups/:id/devices',
    description: '获取分组成员设备列表',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '分组 ID(UUID)', example: '', required: true }],
  },
  {
    id: 'groups.set-devices',
    group: 'groups',
    name: '全量替换分组成员',
    method: 'PUT',
    path: '/api/v1/device-groups/:id/devices',
    description: '以 device_ids 数组全量替换分组成员',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '分组 ID(UUID)', example: '', required: true }],
    bodyExample: { device_ids: [] },
  },

  // ---------------- 数据统计 ----------------
  {
    id: 'stats.overview',
    group: 'stats',
    name: '概览统计',
    method: 'GET',
    path: '/api/v1/stats/overview',
    description: '控制台概览: 产品/设备计数与最近设备动态',
    invocable: true,
  },

  // ---------------- 监控运维 ----------------
  {
    id: 'ops.metrics',
    group: 'ops',
    name: '运维指标',
    method: 'GET',
    path: '/api/v1/ops/metrics',
    description: '设备在线率/消息量/告警等运维指标汇总',
    invocable: true,
  },
  {
    id: 'ops.logs',
    group: 'ops',
    name: '统一日志流',
    method: 'GET',
    path: '/api/v1/ops/logs',
    description: '属性上报/事件/服务调用/上下线统一日志查询',
    invocable: true,
    queryParams: [
      { name: 'type', type: 'enum', description: '日志类型(property/event/action/status/all)', example: 'all' },
      { name: 'device_id', type: 'string', description: '按设备 ID 过滤', example: '' },
      { name: 'keyword', type: 'string', description: '设备名/产品名/摘要模糊搜索', example: '' },
      pageParam,
      { name: 'page_size', type: 'integer', description: '每页条数(默认 50)', example: '50' },
    ],
  },

  // ---------------- 消息转发 ----------------
  {
    id: 'rules.list',
    group: 'rules',
    name: '转发规则列表',
    method: 'GET',
    path: '/api/v1/forward-rules',
    description: '获取全部消息转发规则(含今日转发统计)',
    invocable: true,
  },
  {
    id: 'rules.create',
    group: 'rules',
    name: '创建转发规则',
    method: 'POST',
    path: '/api/v1/forward-rules',
    description: '创建消息转发规则(HTTP 转发或 MQTT 重发布)',
    invocable: true,
    bodyExample: {
      name: '新规则',
      product_id: '',
      message_type: 'property',
      target_type: 'http',
      target_config: { url: 'http://localhost:3200/api/internal/echo' },
    },
  },
  {
    id: 'rules.update',
    group: 'rules',
    name: '更新转发规则',
    method: 'PUT',
    path: '/api/v1/forward-rules/:id',
    description: '更新转发规则配置',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '规则 ID(UUID)', example: '', required: true }],
    bodyExample: {
      name: '更新后的规则',
      product_id: '',
      message_type: 'property',
      target_type: 'http',
      target_config: { url: 'http://localhost:3200/api/internal/echo' },
    },
  },
  {
    id: 'rules.toggle',
    group: 'rules',
    name: '启停规则',
    method: 'PATCH',
    path: '/api/v1/forward-rules/:id/status',
    description: '启用/停用转发规则',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '规则 ID(UUID)', example: '', required: true }],
    bodyExample: { status: 'disabled' },
  },
  {
    id: 'rules.delete',
    group: 'rules',
    name: '删除转发规则',
    method: 'DELETE',
    path: '/api/v1/forward-rules/:id',
    description: '删除转发规则',
    invocable: true,
    pathParams: [{ name: 'id', type: 'string', description: '规则 ID(UUID)', example: '', required: true }],
  },
  {
    id: 'rules.logs',
    group: 'rules',
    name: '转发日志',
    method: 'GET',
    path: '/api/v1/forward-rules/logs',
    description: '消息转发执行日志(支持按规则/结果过滤)',
    invocable: true,
    queryParams: [
      { name: 'result', type: 'enum', description: '执行结果(success/failed)', example: '' },
      { name: 'rule_id', type: 'string', description: '按规则 ID 过滤', example: '' },
      pageParam,
      pageSizeParam,
    ],
  },
  {
    id: 'rules.stats',
    group: 'rules',
    name: '转发统计',
    method: 'GET',
    path: '/api/v1/forward-rules/stats',
    description: '规则数量与今日转发统计',
    invocable: true,
  },
  {
    id: 'rules.topics',
    group: 'rules',
    name: 'Topic 概览',
    method: 'GET',
    path: '/api/v1/forward-rules/topics',
    description: '各产品消息 Topic 与流量概览',
    invocable: true,
  },

  // ---------------- 数据分析 ----------------
  {
    id: 'analytics.storage',
    group: 'analytics',
    name: '存储统计',
    method: 'GET',
    path: '/api/v1/analytics/storage',
    description: '云存数据存储统计(记录数/存储量/明细表分布)',
    invocable: true,
  },
  {
    id: 'analytics.charts',
    group: 'analytics',
    name: '聚合图表',
    method: 'GET',
    path: '/api/v1/analytics/charts',
    description: '4 个预定义聚合图表(温度趋势/消息量/事件分布/上报排行)',
    invocable: true,
  },
  {
    id: 'analytics.chart-details',
    group: 'analytics',
    name: '图表明细',
    method: 'GET',
    path: '/api/v1/analytics/charts/:id/details',
    description: '指定图表的数据点与最近原始记录',
    invocable: true,
    pathParams: [
      { name: 'id', type: 'enum', description: '图表 ID(temp-trend/message-trend/event-dist/report-rank)', example: 'temp-trend', required: true },
    ],
  },
  {
    id: 'analytics.insights',
    group: 'analytics',
    name: '智能洞察',
    method: 'GET',
    path: '/api/v1/analytics/insights',
    description: '由真实数据派生的运营洞察',
    invocable: true,
  },

  // ---------------- 安全认证 ----------------
  {
    id: 'security.stats',
    group: 'security',
    name: '安全统计',
    method: 'GET',
    path: '/api/v1/security/stats',
    description: '设备总量/在线/禁用与今日认证统计',
    invocable: true,
  },
  {
    id: 'security.credentials',
    group: 'security',
    name: '设备凭证列表',
    method: 'GET',
    path: '/api/v1/security/credentials',
    description: '设备凭证分页列表(密钥脱敏)',
    invocable: true,
    queryParams: [
      pageParam,
      pageSizeParam,
      { name: 'keyword', type: 'string', description: '设备名/ID 模糊搜索', example: '' },
      { name: 'status', type: 'enum', description: '设备状态筛选', example: '' },
    ],
  },
  {
    id: 'security.credential-detail',
    group: 'security',
    name: '查看设备密钥',
    method: 'GET',
    path: '/api/v1/security/credentials/:deviceId',
    description: '查看设备密钥明文与 MQTT 连接配置',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },
  {
    id: 'security.rotate',
    group: 'security',
    name: '轮换设备密钥',
    method: 'POST',
    path: '/api/v1/security/credentials/:deviceId/rotate',
    description: '轮换设备密钥, 旧密钥立即失效(会写入认证审计)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
  },
  {
    id: 'security.device-status',
    group: 'security',
    name: '禁用/启用设备',
    method: 'PATCH',
    path: '/api/v1/security/devices/:deviceId/status',
    description: '禁用或启用设备(disable 会清在线标记, enable 恢复为 offline)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
    bodyExample: { action: 'disable' },
  },
  {
    id: 'security.auth-logs',
    group: 'security',
    name: '认证记录',
    method: 'GET',
    path: '/api/v1/security/auth-logs',
    description: '设备认证审计记录流(支持按类型/结果过滤)',
    invocable: true,
    queryParams: [
      pageParam,
      pageSizeParam,
      { name: 'auth_type', type: 'enum', description: '认证类型(device-token/mqtt-connect/secret-rotate/status-change)', example: '' },
      { name: 'result', type: 'enum', description: '认证结果(success/failure)', example: '' },
      { name: 'device_id', type: 'string', description: '按设备 ID 过滤', example: '' },
    ],
  },

  // ---------------- 调试工具 ----------------
  {
    id: 'tools.command-parse',
    group: 'tools',
    name: '自然语言命令解析',
    method: 'POST',
    path: '/api/v1/devices/:deviceId/command:parse',
    description: '将自然语言指令解析为物模型行为调用(调试用)',
    invocable: true,
    pathParams: [{ name: 'deviceId', type: 'string', description: '设备 ID', example: '', required: true }],
    bodyExample: { text: '把温度调到 26 度' },
  },

  // ---------------- 内部回调(仅文档) ----------------
  {
    id: 'internal.property-report',
    group: 'internal',
    name: '属性上报回调',
    method: 'POST',
    path: '/api/internal/mqtt/property-report',
    description: 'EMQX 设备属性上报回调(物模型校验 + 历史写入)',
    invocable: false,
  },
  {
    id: 'internal.event-report',
    group: 'internal',
    name: '事件上报回调',
    method: 'POST',
    path: '/api/internal/mqtt/event-report',
    description: 'EMQX 设备事件上报回调',
    invocable: false,
  },
  {
    id: 'internal.action-reply',
    group: 'internal',
    name: '行为回复回调',
    method: 'POST',
    path: '/api/internal/mqtt/action-reply',
    description: 'EMQX 设备行为调用回复回调',
    invocable: false,
  },
  {
    id: 'internal.shadow-update',
    group: 'internal',
    name: '影子更新回调',
    method: 'POST',
    path: '/api/internal/mqtt/shadow-update',
    description: 'EMQX 设备影子 reported 上报回调',
    invocable: false,
  },
  {
    id: 'internal.online',
    group: 'internal',
    name: '上线回调',
    method: 'POST',
    path: '/api/internal/mqtt/online',
    description: 'EMQX 设备上线事件回调',
    invocable: false,
  },
  {
    id: 'internal.offline',
    group: 'internal',
    name: '下线回调',
    method: 'POST',
    path: '/api/internal/mqtt/offline',
    description: 'EMQX 设备下线事件回调',
    invocable: false,
  },
  {
    id: 'internal.mqtt-auth',
    group: 'internal',
    name: 'MQTT 连接认证',
    method: 'POST',
    path: '/api/internal/mqtt/auth',
    description: 'EMQX HTTP Auth Backend: 设备一机一密连接鉴权',
    invocable: false,
  },
  {
    id: 'internal.echo',
    group: 'internal',
    name: '回声测试',
    method: 'POST',
    path: '/api/internal/echo',
    description: '内部连通性测试端点(规则引擎转发目标示例)',
    invocable: false,
  },
];

// ---------------- 纯函数 ----------------

export function findApiById(
  catalog: ApiCatalogEntry[],
  id: string,
): ApiCatalogEntry | undefined {
  return catalog.find((e) => e.id === id);
}

export interface InvokeParams {
  path?: Record<string, string>;
  query?: Record<string, string>;
}

export interface BuiltInvokeRequest {
  method: ApiMethod;
  url: string; // 含 query string 的实际 URL
}

/**
 * 由目录条目 + 用户参数构建实际请求:
 * - path 参数: 必填校验 + encodeURIComponent 替换
 * - query 参数: 只拼接条目声明过的参数名(白名单), 空值丢弃
 * - method 固定取目录条目, 前端不可指定
 */
export function buildInvokeRequest(
  entry: ApiCatalogEntry,
  params: InvokeParams,
): BuiltInvokeRequest {
  if (!entry.invocable) {
    throw new ValidationError(`API ${entry.id} 不开放在线调试`, [
      { field: 'api_id', message: 'Internal APIs are read-only in explorer' },
    ]);
  }

  let url = entry.path;
  const pathValues = params.path ?? {};
  for (const p of entry.pathParams ?? []) {
    const value = (pathValues[p.name] ?? '').trim();
    if (!value) {
      throw new ValidationError(`缺少路径参数: ${p.name}`, [
        { field: `path.${p.name}`, message: `Required path param "${p.name}" is empty` },
      ]);
    }
    url = url.replace(`:${p.name}`, encodeURIComponent(value));
  }

  const search = new URLSearchParams();
  const queryValues = params.query ?? {};
  for (const q of entry.queryParams ?? []) {
    const value = (queryValues[q.name] ?? '').trim();
    if (value) search.set(q.name, value);
  }
  const qs = search.toString();

  return { method: entry.method, url: qs ? `${url}?${qs}` : url };
}

export const MAX_RESPONSE_STORE_BYTES = 8192;

/** 响应体入库截断: 超长截断并打标志 */
export function truncateForStore(
  text: string,
  maxLen = MAX_RESPONSE_STORE_BYTES,
): { text: string; truncated: boolean } {
  if (text.length <= maxLen) return { text, truncated: false };
  return { text: `${text.slice(0, maxLen)}…(truncated)`, truncated: true };
}

export interface HistoryStats {
  total_invokes: number;
  success_count: number;
  success_rate: number | null; // 0-100, null=无调用
  avg_duration_ms: number | null;
}

/** 由全表计数与均值派生历史统计 */
export function buildHistoryStats(
  total: number,
  success: number,
  avgDuration: number | null,
): HistoryStats {
  return {
    total_invokes: total,
    success_count: success,
    success_rate: total === 0 ? null : Math.round((success / total) * 1000) / 10,
    avg_duration_ms: avgDuration === null ? null : Math.round(avgDuration),
  };
}

// ---------------- Service ----------------

export interface RecordInvokeInput {
  apiId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestBody?: string | null;
  responseBody?: string | null;
  truncated?: boolean;
}

export class ApiExplorerService {
  constructor(private readonly db: PrismaClient) {}

  async recordInvoke(input: RecordInvokeInput): Promise<void> {
    await this.db.apiInvokeLog.create({
      data: {
        apiId: input.apiId,
        method: input.method,
        path: input.path.slice(0, 512),
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        requestBody: input.requestBody ?? null,
        responseBody: input.responseBody ?? null,
        truncated: input.truncated ?? false,
      },
    });
  }

  async listHistory(limit: number): Promise<
    Array<{
      id: number;
      apiId: string;
      method: string;
      path: string;
      statusCode: number;
      durationMs: number;
      truncated: boolean;
      createdAt: Date;
    }>
  > {
    return this.db.apiInvokeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        apiId: true,
        method: true,
        path: true,
        statusCode: true,
        durationMs: true,
        truncated: true,
        createdAt: true,
      },
    });
  }

  /** 全表统计: 总调用数 / 成功数(<400) / 平均耗时 */
  async getStats(): Promise<HistoryStats> {
    const [total, success, agg] = await Promise.all([
      this.db.apiInvokeLog.count(),
      this.db.apiInvokeLog.count({ where: { statusCode: { lt: 400 } } }),
      this.db.apiInvokeLog.aggregate({ _avg: { durationMs: true } }),
    ]);
    return buildHistoryStats(total, success, agg._avg.durationMs ?? null);
  }
}
