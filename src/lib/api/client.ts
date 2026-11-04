/**
 * Fastify 后端 API 客户端
 *
 * - 自动附加平台 Bearer Token(通过 /api/v1/auth/platform-token 获取, 内存缓存 + 401 自动刷新重试)
 * - 统一解包 { code, message, data } 响应格式, 非 0 code 抛 ApiError
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3200";
const APP_KEY = process.env.NEXT_PUBLIC_APP_KEY || "iot-explorer-app-key";
const APP_SECRET = process.env.NEXT_PUBLIC_APP_SECRET || "iot-explorer-app-secret";

export class ApiError extends Error {
  code: number;
  details?: Array<{ field: string; message: string }>;
  constructor(message: string, code: number, details?: Array<{ field: string; message: string }>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  details?: Array<{ field: string; message: string }>;
}

// ---------------- 平台 Token 管理 ----------------

let tokenCache: { token: string; exp: number } | null = null;
let tokenRequest: Promise<string> | null = null;

async function requestPlatformToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) {
    return tokenCache.token;
  }
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const res = await fetch(`${API_BASE}/api/v1/auth/platform-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_key: APP_KEY, app_secret: APP_SECRET }),
    });
    const json = (await res.json()) as ApiEnvelope<{
      access_token: string;
      expires_in: number;
    }>;
    if (!res.ok || json.code !== 0) {
      throw new ApiError(json.message || "获取平台凭证失败", json.code ?? -1);
    }
    tokenCache = {
      token: json.data.access_token,
      exp: Date.now() + json.data.expires_in * 1000,
    };
    return tokenCache.token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

function invalidateToken() {
  tokenCache = null;
}

// ---------------- 通用请求 ----------------

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { _retried?: boolean } = {},
): Promise<T> {
  const token = await requestPlatformToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // 401 → token 失效, 刷新后重试一次
  if (res.status === 401 && !init._retried) {
    invalidateToken();
    return apiFetch<T>(path, { ...init, _retried: true });
  }

  const json = (await res.json().catch(() => ({
    code: -1,
    message: `HTTP ${res.status}`,
  }))) as ApiEnvelope<T>;

  if (!res.ok || json.code !== 0) {
    throw new ApiError(json.message || `请求失败 (HTTP ${res.status})`, json.code ?? -1, json.details);
  }
  return json.data;
}

// ---------------- 类型定义 ----------------

export interface Product {
  productId: string;
  productName: string;
  category: string;
  protocolType: string;
  networkType: string;
  nodeType: string;
  description: string | null;
  status: string;
  deviceCount?: number;
  onlineCount?: number;
  createdAt: string;
}

export interface DeviceItem {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: "online" | "offline" | "not-activated" | "disabled";
  firmwareVersion: string;
  tags: Record<string, unknown>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DeviceListData {
  total: number;
  page: number;
  page_size: number;
  items: DeviceItem[];
  status_counts: Record<string, number>;
}

export interface DeviceDetail extends DeviceItem {
  lastLogoutAt: string | null;
  protocol: string;
  nodeType: string;
  category: string;
  description: string;
}

export interface TelemetryPoint {
  id: string;
  identifier: string;
  value: unknown;
  timestamp: string;
}

export interface ShadowDocument {
  deviceId: string;
  state: {
    reported: Record<string, unknown>;
    desired: Record<string, unknown>;
    delta: Record<string, unknown>;
  };
  metadata: unknown;
  version: number;
}

export interface ActivityItem {
  time: string;
  type: string;
  device_name: string;
  status: "success" | "info" | "warning" | "error";
  detail: string;
}

export interface OverviewStats {
  project_count: number;
  product_count: number;
  device_count: number;
  online_count: number;
  offline_count: number;
  not_activated_count: number;
  disabled_count: number;
  recent_activity: ActivityItem[];
}

// ---------------- 物模型 ----------------

export interface ThingModelProperty {
  id?: number;
  identifier: string;
  name: string;
  dataType: string;
  accessMode: string;
  description?: string | null;
  spec: Record<string, unknown>;
  required?: boolean;
  sortOrder?: number;
}

export interface ThingModelEventParam {
  identifier: string;
  name: string;
  dataType: string;
  spec?: Record<string, unknown>;
}

export interface ThingModelEvent {
  id?: number;
  identifier: string;
  name: string;
  eventType: string;
  description?: string | null;
  outputParams: ThingModelEventParam[];
  sortOrder?: number;
}

export interface ThingModelAction {
  id?: number;
  identifier: string;
  name: string;
  description?: string | null;
  inputParams: ThingModelEventParam[];
  outputParams: ThingModelEventParam[];
  asyncFlag?: boolean;
  callStrategy?: string;
  sortOrder?: number;
}

export interface ThingModelSnapshot {
  productId: string;
  version: number;
  properties: ThingModelProperty[];
  events: ThingModelEvent[];
  actions: ThingModelAction[];
}

// ---------------- 设备分组 ----------------

export interface DeviceGroup {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  deviceCount: number;
}

export interface GroupMemberDevice {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: string;
  lastLoginAt: string | null;
}

// ---------------- 消息转发(规则引擎) ----------------

export interface ForwardRuleItem {
  id: string;
  name: string;
  description: string | null;
  status: string; // enabled | disabled
  productId: string;
  productName: string;
  messageType: string; // property | event
  filter: { identifiers?: string[]; eventTypes?: string[] };
  targetType: string; // http | republish
  targetConfig: { url?: string; topic?: string };
  createdAt: string;
  updatedAt: string;
  todayCount: number;
  todaySuccessRate: number | null; // 0-100, null=今日无转发
}

export interface ForwardRuleInput {
  name: string;
  description?: string;
  product_id: string;
  message_type: string;
  filter?: { identifiers?: string[]; eventTypes?: string[] };
  target_type: string;
  target_config: { url?: string; topic?: string };
  status?: string;
}

export interface ForwardLogItem {
  id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  device_name: string;
  message_type: string;
  topic: string;
  payload: Record<string, unknown>;
  result: string; // success | failed
  error_msg: string | null;
  latency_ms: number;
  time: string;
}

export interface ForwardStats {
  rule_count: number;
  enabled_count: number;
  today_forward_count: number;
  today_success_rate: number | null;
}

export interface MessageTopicItem {
  topic: string;
  type: string;
  product_id: string;
  product_name: string;
  messages: number;
  last_active: string;
}

// ---------------- 监控运维 ----------------

export interface OpsMetrics {
  device_total: number;
  online: number;
  offline: number;
  not_activated: number;
  disabled: number;
  online_rate: number;
  messages_today: number;
  events_today: number;
  alarms_today: number;
  actions_today: number;
  hourly_messages: Array<{ hour: string; count: number }>;
}

export interface OpsLogItem {
  id: string;
  time: string;
  type: "property" | "event" | "action" | "status";
  device_id: string;
  device_name: string;
  product_name: string;
  level: string;
  summary: string;
}

export interface OpsLogQuery {
  type?: "all" | "property" | "event" | "action" | "status";
  device_id?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}

// ---------------- 数据分析(云存服务) ----------------

export interface AnalyticsStorage {
  total_records: number;
  week_records: number;
  avg_daily_records: number;
  storage_bytes: number;
  breakdown: Array<{ label: string; table: string; records: number; storage_bytes: number }>;
}

export interface AnalyticsChartPoint {
  label: string;
  value: number;
}

export interface AnalyticsChart {
  id: string;
  name: string;
  type: "line" | "bar" | "pie" | "area";
  unit: string;
  data_source: string;
  time_range: string;
  refresh_interval: string;
  summary: string;
  points: AnalyticsChartPoint[];
}

export interface AnalyticsRawRecord {
  device_id: string;
  device_name: string;
  detail: string;
  time: string;
}

export interface AnalyticsChartDetails extends AnalyticsChart {
  raw: AnalyticsRawRecord[];
}

export interface AnalyticsInsight {
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  time: string;
}

// ---------------- 安全认证 ----------------

export interface SecurityStats {
  device_total: number;
  online: number;
  disabled: number;
  today_auth_count: number;
  today_auth_failure: number;
}

export interface SecurityCredentialItem {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: "online" | "offline" | "not-activated" | "disabled";
  maskedSecret: string;
  lastLoginAt: string | null;
  lastIp: string | null;
  createdAt: string;
}

export interface SecurityMqttConfig {
  host: string;
  port: number;
  ssl: boolean;
  clientId: string;
  username: string;
  password: string;
  subscribeTopics: string[];
  publishTopic: string;
}

export interface SecurityCredentialDetail {
  deviceId: string;
  deviceName: string;
  productId: string;
  productName: string;
  status: string;
  deviceSecret: string;
  lastLoginAt: string | null;
  lastIp: string | null;
  mqttConfig: SecurityMqttConfig;
}

export type SecurityAuthType = "device-token" | "mqtt-connect" | "secret-rotate" | "status-change";

export interface SecurityAuthLogItem {
  id: number;
  time: string;
  deviceId: string;
  deviceName: string;
  productName: string;
  authType: SecurityAuthType;
  result: "success" | "failure";
  reason: string | null;
  ip: string | null;
}

// ---------------- API 方法 ----------------

export const api = {
  // 概览
  getOverview: (activityLimit = 10) =>
    apiFetch<OverviewStats>(`/api/v1/stats/overview?activity_limit=${activityLimit}`),

  // 产品
  getProducts: (page = 1, pageSize = 20) =>
    apiFetch<{ total: number; page: number; page_size: number; items: Product[] }>(
      `/api/v1/products?page=${page}&page_size=${pageSize}`,
    ),
  createProduct: (body: {
    product_name: string;
    category?: string;
    protocol_type?: string;
    network_type?: string;
    node_type?: string;
    description?: string;
  }) =>
    apiFetch<Product>("/api/v1/products", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteProduct: (productId: string) =>
    apiFetch<null>(`/api/v1/products/${productId}`, { method: "DELETE" }),

  // 物模型
  getThingModel: (productId: string) =>
    apiFetch<ThingModelSnapshot>(`/api/v1/products/${productId}/thing-model`),
  updateThingModel: (
    productId: string,
    body: {
      version: string;
      profile?: Record<string, unknown>;
      properties: ThingModelProperty[];
      events: ThingModelEvent[];
      actions: ThingModelAction[];
    },
  ) =>
    apiFetch<ThingModelSnapshot>(`/api/v1/products/${productId}/thing-model`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // 设备分组
  getDeviceGroups: () => apiFetch<DeviceGroup[]>("/api/v1/device-groups"),
  createDeviceGroup: (body: { name: string; description?: string; color?: string }) =>
    apiFetch<DeviceGroup>("/api/v1/device-groups", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDeviceGroup: (
    groupId: string,
    body: { name?: string; description?: string; color?: string },
  ) =>
    apiFetch<DeviceGroup>(`/api/v1/device-groups/${groupId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteDeviceGroup: (groupId: string) =>
    apiFetch<null>(`/api/v1/device-groups/${groupId}`, { method: "DELETE" }),
  getGroupDevices: (groupId: string) =>
    apiFetch<GroupMemberDevice[]>(`/api/v1/device-groups/${groupId}/devices`),
  setGroupDevices: (groupId: string, deviceIds: string[]) =>
    apiFetch<null>(`/api/v1/device-groups/${groupId}/devices`, {
      method: "PUT",
      body: JSON.stringify({ device_ids: deviceIds }),
    }),

  // 监控运维
  getOpsMetrics: () => apiFetch<OpsMetrics>("/api/v1/ops/metrics"),
  getOpsLogs: (query: OpsLogQuery = {}) => {
    const params = new URLSearchParams();
    if (query.type) params.set("type", query.type);
    if (query.device_id) params.set("device_id", query.device_id);
    if (query.keyword) params.set("keyword", query.keyword);
    if (query.page) params.set("page", String(query.page));
    if (query.page_size) params.set("page_size", String(query.page_size));
    const qs = params.toString();
    return apiFetch<{
      total: number;
      page: number;
      page_size: number;
      items: OpsLogItem[];
    }>(`/api/v1/ops/logs${qs ? `?${qs}` : ""}`);
  },

  // 设备(全局)
  getDevices: (params: {
    page?: number;
    page_size?: number;
    status?: string;
    keyword?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.page_size) qs.set("page_size", String(params.page_size));
    if (params.status) qs.set("status", params.status);
    if (params.keyword) qs.set("keyword", params.keyword);
    return apiFetch<DeviceListData>(`/api/v1/devices?${qs.toString()}`);
  },
  getDevice: (deviceId: string) => apiFetch<DeviceDetail>(`/api/v1/devices/${deviceId}`),
  getTelemetry: (deviceId: string, limit = 20) =>
    apiFetch<TelemetryPoint[]>(`/api/v1/devices/${deviceId}/telemetry?limit=${limit}`),

  // 设备注册
  registerDevice: (productId: string, deviceName: string) =>
    apiFetch<{
      deviceId: string;
      deviceName: string;
      deviceSecret: string;
      productId: string;
      status: string;
    }>(`/api/v1/products/${productId}/devices/register`, {
      method: "POST",
      body: JSON.stringify({ device_name: deviceName }),
    }),

  // 设备影子
  getShadow: (deviceId: string) => apiFetch<ShadowDocument>(`/api/v1/shadows/${deviceId}`),
  updateShadowDesired: (deviceId: string, desired: Record<string, unknown>, version: number) =>
    apiFetch<ShadowDocument>(`/api/v1/shadows/${deviceId}`, {
      method: "PUT",
      body: JSON.stringify({ state: { desired }, version }),
    }),

  // 消息转发(规则引擎)
  getForwardRules: () => apiFetch<ForwardRuleItem[]>("/api/v1/forward-rules"),
  createForwardRule: (body: ForwardRuleInput) =>
    apiFetch<ForwardRuleItem>("/api/v1/forward-rules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateForwardRule: (ruleId: string, body: ForwardRuleInput) =>
    apiFetch<ForwardRuleItem>(`/api/v1/forward-rules/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  toggleForwardRule: (ruleId: string, status: string) =>
    apiFetch<ForwardRuleItem>(`/api/v1/forward-rules/${ruleId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteForwardRule: (ruleId: string) =>
    apiFetch<null>(`/api/v1/forward-rules/${ruleId}`, { method: "DELETE" }),
  getForwardLogs: (query: { result?: string; rule_id?: string; page?: number; page_size?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.result) params.set("result", query.result);
    if (query.rule_id) params.set("rule_id", query.rule_id);
    if (query.page) params.set("page", String(query.page));
    if (query.page_size) params.set("page_size", String(query.page_size));
    const qs = params.toString();
    return apiFetch<{
      total: number;
      page: number;
      page_size: number;
      items: ForwardLogItem[];
    }>(`/api/v1/forward-rules/logs${qs ? `?${qs}` : ""}`);
  },
  getForwardStats: () => apiFetch<ForwardStats>("/api/v1/forward-rules/stats"),
  getMessageTopics: () => apiFetch<MessageTopicItem[]>("/api/v1/forward-rules/topics"),

  // 数据分析(云存服务)
  getAnalyticsStorage: () => apiFetch<AnalyticsStorage>("/api/v1/analytics/storage"),
  getAnalyticsCharts: () => apiFetch<{ charts: AnalyticsChart[] }>("/api/v1/analytics/charts"),
  getAnalyticsChartDetails: (chartId: string) =>
    apiFetch<AnalyticsChartDetails>(`/api/v1/analytics/charts/${chartId}/details`),
  getAnalyticsInsights: () =>
    apiFetch<{ insights: AnalyticsInsight[] }>("/api/v1/analytics/insights"),

  // 安全认证
  getSecurityStats: () => apiFetch<SecurityStats>("/api/v1/security/stats"),
  getSecurityCredentials: (
    params: { page?: number; page_size?: number; keyword?: string; status?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.page_size) qs.set("page_size", String(params.page_size));
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.status) qs.set("status", params.status);
    return apiFetch<{
      total: number;
      page: number;
      page_size: number;
      items: SecurityCredentialItem[];
    }>(`/api/v1/security/credentials?${qs.toString()}`);
  },
  getSecurityCredential: (deviceId: string) =>
    apiFetch<SecurityCredentialDetail>(`/api/v1/security/credentials/${deviceId}`),
  rotateDeviceSecret: (deviceId: string) =>
    apiFetch<{ deviceId: string; deviceSecret: string; message: string }>(
      `/api/v1/security/credentials/${deviceId}/rotate`,
      { method: "POST" },
    ),
  setSecurityDeviceStatus: (deviceId: string, action: "disable" | "enable") =>
    apiFetch<{ deviceId: string; status: string }>(
      `/api/v1/security/devices/${deviceId}/status`,
      { method: "PATCH", body: JSON.stringify({ action }) },
    ),
  getSecurityAuthLogs: (
    query: { page?: number; page_size?: number; auth_type?: string; result?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (query.page) qs.set("page", String(query.page));
    if (query.page_size) qs.set("page_size", String(query.page_size));
    if (query.auth_type) qs.set("auth_type", query.auth_type);
    if (query.result) qs.set("result", query.result);
    return apiFetch<{
      total: number;
      page: number;
      page_size: number;
      items: SecurityAuthLogItem[];
    }>(`/api/v1/security/auth-logs?${qs.toString()}`);
  },
};
