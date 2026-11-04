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
};
