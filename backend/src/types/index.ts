// Product types
export interface ProductBasic {
  productId: string;
  productName: string;
  category: string;
  protocolType: string;
  networkType: string;
  dataProtocol: string;
  authType: string;
  nodeType: string;
  description: string | null;
  status: string;
  thingModelVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  product_name: string;
  category?: string;
  protocol_type?: string;
  network_type?: string;
  data_protocol?: string;
  auth_type?: string;
  node_type?: string;
  description?: string;
  thing_model?: any;
}

// Device types
export interface DeviceBasic {
  deviceId: string;
  deviceName: string;
  productId: string;
  status: string;
  firmwareVersion: string;
  tags: any;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterDeviceInput {
  device_name: string;
  tags?: Record<string, string>;
}

export interface MqttConnectConfig {
  host: string;
  port: number;
  ssl: boolean;
  clientId: string;
  username: string;
  password: string;
  subscribeTopics: string[];
  publishTopic: string;
}

export interface RegisterDeviceOutput {
  deviceId: string;
  deviceName: string;
  deviceSecret: string;
  productId: string;
  status: string;
  mqttConfig: MqttConnectConfig;
  createdAt: string;
}

export interface DeviceAuthInput {
  product_id: string;
  device_name: string;
  device_secret: string;
  /** 认证来源 IP(可选, 用于 lastIp 记录与认证日志) */
  ip?: string;
}

export interface DeviceAuthOutput {
  access_token: string;
  expires_in: number;
  mqttConfig: MqttConnectConfig;
}

// Shadow types
export interface ShadowDocument {
  deviceId: string;
  state: {
    reported: Record<string, any>;
    desired: Record<string, any>;
    delta: Record<string, any>;
  };
  metadata: {
    reported: Record<string, { timestamp: number }>;
    desired: Record<string, { timestamp: number }>;
  };
  version: number;
  /** desired 专属版本 (乐观锁用)。PUT desired 的 version 字段校验的是它, 不是总 version */
  desiredVersion: number;
  timestamp: number;
}

export interface UpdateDesiredInput {
  state: {
    desired: Record<string, any>;
  };
  version: number;
}

// Thing Model types
export interface ThingModelProperty {
  id: number;
  productId: string;
  identifier: string;
  name: string;
  dataType: string;
  accessMode: string;
  description: string | null;
  spec: any;
  required: boolean;
  sortOrder: number;
}

export interface ThingModelEvent {
  id: number;
  productId: string;
  identifier: string;
  name: string;
  eventType: string;
  description: string | null;
  outputParams: any;
  sortOrder: number;
}

export interface ThingModelAction {
  id: number;
  productId: string;
  identifier: string;
  name: string;
  description: string | null;
  inputParams: any;
  outputParams: any;
  asyncFlag: boolean;
  callStrategy: string;
  sortOrder: number;
}

export interface ThingModelSnapshot {
  productId: string;
  version: number;
  properties: ThingModelProperty[];
  events: ThingModelEvent[];
  actions: ThingModelAction[];
}

// JWT payload
export interface JwtDevicePayload {
  deviceId: string;
  productId: string;
  deviceName: string;
}

export interface JwtPlatformPayload {
  appKey: string;
  scope: 'platform';
}

// Pagination
export interface PaginationQuery {
  page?: number;
  page_size?: number;
  status?: string;
}
