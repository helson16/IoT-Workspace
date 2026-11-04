const _port = process.env['PORT'] ?? '3200';
const _host = process.env['HOST'] ?? '0.0.0.0';
const _nodeEnv = process.env['NODE_ENV'] ?? 'development';
const _logLevel = process.env['LOG_LEVEL'] ?? 'debug';
const _databaseUrl = process.env['DATABASE_URL'] ?? '';
const _redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const _jwtSecret = process.env['JWT_SECRET'] ?? '';
const _jwtExpiresIn = process.env['JWT_EXPIRES_IN'] ?? '24h';
const _deviceTokenExpiresIn = process.env['DEVICE_TOKEN_EXPIRES_IN'] ?? '24h';
const _appKey = process.env['APP_KEY'] ?? '';
const _appSecret = process.env['APP_SECRET'] ?? '';
const _mqttBrokerHost = process.env['MQTT_BROKER_HOST'] ?? 'localhost';
// 默认走 EMQX TLS 监听(ssl:default @8883, 自签证书见 tools/emqx-setup.mts ensureTls);
// 明文回退: MQTT_BROKER_PORT=1883 + MQTT_BROKER_SSL=false(tcp:default)
const _mqttBrokerPort = process.env['MQTT_BROKER_PORT'] ?? '8883';
const _mqttBrokerSsl = process.env['MQTT_BROKER_SSL'] ?? 'true';
const _mqttSdkAppId = process.env['MQTT_SDK_APP_ID'] ?? '12010126';
// EMQX 管理 API(下行推送 /api/v5/publish 用), 未配置 key 时 emqx-bridge 为 no-op
const _emqxApiBase = process.env['EMQX_API_BASE'] ?? 'http://127.0.0.1:18083';
const _emqxApiKey = process.env['EMQX_API_KEY'] ?? '';
const _emqxApiSecret = process.env['EMQX_API_SECRET'] ?? '';
const _internalSecret = process.env['INTERNAL_SECRET'] ?? '';
const _shadowCacheTtl = process.env['SHADOW_CACHE_TTL'] ?? '300';

if (!_jwtSecret) {
  throw new Error(
    'JWT_SECRET environment variable is required but was not provided.',
  );
}

export const config = {
  port: parseInt(_port, 10) || 3200,
  host: _host,
  nodeEnv: _nodeEnv,
  logLevel: _logLevel,
  databaseUrl: _databaseUrl,
  redisUrl: _redisUrl,
  jwtSecret: _jwtSecret,
  jwtExpiresIn: _jwtExpiresIn,
  deviceTokenExpiresIn: _deviceTokenExpiresIn,
  appKey: _appKey,
  appSecret: _appSecret,
  mqttBrokerHost: _mqttBrokerHost,
  mqttBrokerPort: parseInt(_mqttBrokerPort, 10) || 8883,
  mqttBrokerSsl: _mqttBrokerSsl === 'true' || _mqttBrokerSsl === '1',
  mqttSdkAppId: _mqttSdkAppId,
  emqxApiBase: _emqxApiBase,
  emqxApiKey: _emqxApiKey,
  emqxApiSecret: _emqxApiSecret,
  internalSecret: _internalSecret,
  shadowCacheTtl: parseInt(_shadowCacheTtl, 10) || 300,
} as const;

export const isDev: boolean = config.nodeEnv !== 'production';
