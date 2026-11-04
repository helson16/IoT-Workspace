/**
 * mock-device.js — 物联网虚拟设备 E2E 联调脚本
 *
 * 功能:
 *   1. 通过 REST API 创建产品 + 注册设备
 *   2. 使用一机一密凭证通过 EMQX 连接 MQTT
 *   3. 定时上报温度/湿度属性（符合物模型 JSON Schema）
 *   4. 订阅属性下发 / 行为下发 / 影子同步 Topic
 *   5. 收到控制指令后自动回复
 *
 * 用法: node tests/mock-device.js [--api http://localhost:3200] [--mqtt localhost:1883]
 */

import mqtt from 'mqtt';
import { randomUUID } from 'crypto';

// ---- Config ----
const API_BASE = process.env['API_BASE'] || 'http://localhost:3200';
const MQTT_HOST = process.env['MQTT_HOST'] || 'localhost';
const MQTT_PORT = parseInt(process.env['MQTT_PORT'] || '1883', 10);
const APP_KEY = 'iot-explorer-app-key';
const APP_SECRET = 'iot-explorer-app-secret';
const REPORT_INTERVAL_MS = 5000; // 5s 上报间隔

// ---- Helpers ----
function log(tag, msg, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] [${tag}] ${msg}${dataStr}`);
}

async function api(method, path, body) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`API ${method} ${path} failed: ${json.message} (code=${json.code})`);
  }
  return json.data;
}

// ---- State ----
const state = {
  token: null,
  product: null,
  device: null,
  mqttConfig: null,
  client: null,
  keepAliveTimer: null,
  reportCounter: 0,
  baseTemp: 22.0,
};

// ============================================================
// Step 1: 获取平台 Token
// ============================================================
async function getPlatformToken() {
  log('AUTH', 'Getting platform token...');
  const data = await api('POST', '/api/v1/auth/platform-token', {
    app_key: APP_KEY,
    app_secret: APP_SECRET,
  });
  state.token = data.access_token;
  log('AUTH', 'Token obtained', { expires_in: data.expires_in });
}

// ============================================================
// Step 2: 创建产品（智能温控器 + 物模型）
// ============================================================
async function createProduct() {
  log('PRODUCT', 'Creating smart thermostat product...');
  const thingModel = {
    version: '1.0',
    properties: [
      { id: 'temperature', name: '当前温度', type: 'float', mode: 'rw', required: true,
        spec: { min: -40, max: 85, step: 0.1, unit: '°C', unitName: '摄氏度' } },
      { id: 'humidity', name: '当前湿度', type: 'float', mode: 'r', required: true,
        spec: { min: 0, max: 100, step: 0.1, unit: '%', unitName: '百分比' } },
      { id: 'target_temperature', name: '目标温度', type: 'int', mode: 'rw', required: true,
        spec: { min: 16, max: 32, step: 1, unit: '°C', unitName: '摄氏度' } },
      { id: 'power_switch', name: '电源开关', type: 'bool', mode: 'rw', required: true,
        spec: { '0': '关', '1': '开' } },
      { id: 'working_mode', name: '工作模式', type: 'enum', mode: 'rw', required: true,
        spec: { enumList: [
          { value: 'auto', label: '自动' },
          { value: 'cool', label: '制冷' },
          { value: 'heat', label: '制热' },
        ] } },
      { id: 'error_code', name: '故障码', type: 'int', mode: 'r', required: false,
        spec: { min: 0, max: 65535 } },
    ],
    events: [
      { id: 'high_temperature_alarm', name: '高温告警', type: 'warn',
        outputParams: [
          { identifier: 'current_temp', name: '当前温度', dataType: 'float' },
          { identifier: 'threshold', name: '告警阈值', dataType: 'float' },
        ] },
    ],
    actions: [
      { id: 'set_temperature', name: '设置温度',
        inputParams: [{ identifier: 'target_temp', name: '目标温度', dataType: 'int', spec: { min: 16, max: 32 } }],
        outputParams: [] },
      { id: 'reboot', name: '重启设备',
        inputParams: [],
        outputParams: [{ identifier: 'result', name: '执行结果', dataType: 'bool' }] },
    ],
  };

  state.product = await api('POST', '/api/v1/products', {
    product_name: `E2E温控器-${Date.now().toString(36)}`,
    category: '智能家电',
    protocol_type: 'MQTT',
    network_type: 'WiFi',
    data_protocol: 'MQTT-JSON',
    auth_type: 'one-machine-one-secret',
    node_type: 'device',
    description: 'E2E 联调测试用虚拟温控器',
    thing_model: thingModel,
  });
  log('PRODUCT', 'Product created', {
    productId: state.product.productId,
    name: state.product.productName,
  });
}

// ============================================================
// Step 3: 注册设备
// ============================================================
async function registerDevice() {
  log('DEVICE', 'Registering device...');
  const deviceName = `dev-mock-${Date.now().toString(36)}`;
  state.device = await api('POST', `/api/v1/products/${state.product.productId}/devices/register`, {
    device_name: deviceName,
    tags: { location: 'E2E测试环境', test: 'true' },
  });
  state.mqttConfig = state.device.mqttConfig;
  log('DEVICE', 'Device registered', {
    deviceId: state.device.deviceId,
    deviceName: state.device.deviceName,
    secretPreview: state.device.deviceSecret.substring(0, 8) + '...',
  });
}

// ============================================================
// Step 4: 连接 MQTT Broker（通过 EMQX 一机一密认证）
// ============================================================
function connectMqtt() {
  return new Promise((resolve, reject) => {
    const cfg = state.mqttConfig;
    log('MQTT', `Connecting to mqtt://${MQTT_HOST}:${MQTT_PORT}...`);
    log('MQTT', `  clientId: ${cfg.clientId}`);
    log('MQTT', `  username: ${cfg.username}`);

    const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
      clientId: cfg.clientId,
      username: cfg.username,
      password: cfg.password,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    client.on('connect', () => {
      log('MQTT', 'Connected to EMQX successfully!');
      state.client = client;
      resolve();
    });

    client.on('error', (err) => {
      log('MQTT', 'Connection error', { message: err.message });
      reject(err);
    });

    client.on('close', () => {
      log('MQTT', 'Connection closed');
    });

    client.on('reconnect', () => {
      log('MQTT', 'Reconnecting...');
    });

    // ---- 订阅下行 Topic ----
    client.on('connect', () => {
      const topics = cfg.subscribeTopics;
      client.subscribe(topics, { qos: 1 }, (err) => {
        if (err) {
          log('MQTT', 'Subscribe failed', { error: err.message });
        } else {
          log('MQTT', `Subscribed to ${topics.length} topics`);
          topics.forEach((t) => log('MQTT', `  → ${t}`));
        }
      });
    });

    // ---- 处理属性下发（云端 → 设备） ----
    client.on('message', (topic, message) => {
      const payload = JSON.parse(message.toString());

      if (topic.includes('/property/down')) {
        handlePropertyDown(topic, payload);
      } else if (topic.includes('/action/down')) {
        handleActionDown(topic, payload);
      } else if (topic.includes('/shadow/accepted')) {
        handleShadowSync(topic, payload);
      } else {
        log('MSG', `Received on unknown topic: ${topic}`, payload);
      }
    });
  });
}

// ============================================================
// Step 5: 定时上报属性
// ============================================================
function startPropertyReporting() {
  log('REPORT', `Starting property report every ${REPORT_INTERVAL_MS}ms`);

  state.keepAliveTimer = setInterval(() => {
    if (!state.client || !state.client.connected) return;

    state.reportCounter++;
    // 模拟温度波动: 基础温度 + 正弦波 + 随机噪声
    const noise = (Math.random() - 0.5) * 1.0;
    const wave = Math.sin(state.reportCounter * 0.2) * 3;
    const temperature = parseFloat((state.baseTemp + wave + noise).toFixed(1));
    const humidity = parseFloat((55 + Math.sin(state.reportCounter * 0.15) * 15 + (Math.random() - 0.5) * 5).toFixed(1));

    const payload = {
      method: 'thing.event.property.post',
      clientToken: randomUUID(),
      version: '1.0',
      params: {
        temperature,
        humidity,
        power_switch: 1,
        working_mode: 'cool',
        target_temperature: 24,
        error_code: 0,
      },
    };

    const topic = state.mqttConfig.publishTopic;
    state.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        log('REPORT', 'Publish failed', { error: err.message });
      } else {
        log('REPORT', `#${state.reportCounter} temp=${temperature}°C humidity=${humidity}%`);
      }
    });

    // 模拟高温告警事件（温度超过 30 时触发）
    if (temperature > 30 && state.reportCounter % 3 === 0) {
      const eventPayload = {
        method: 'thing.event.warn.post',
        clientToken: randomUUID(),
        version: '1.0',
        params: {
          event_id: 'high_temperature_alarm',
          event_type: 'warn',
          event_time: Date.now(),
          output_params: {
            current_temp: temperature,
            threshold: 30.0,
          },
        },
      };
      state.client.publish(topic, JSON.stringify(eventPayload), { qos: 1 });
      log('EVENT', 'High temperature alarm!', { current_temp: temperature, threshold: 30.0 });
    }
  }, REPORT_INTERVAL_MS);
}

// ============================================================
// 下行消息处理
// ============================================================

function handlePropertyDown(_topic, payload) {
  log('DOWN', 'Property set command received', payload);

  // 模拟设备执行: 更新本地状态后上报回复
  const replyPayload = {
    method: 'thing.property.set.reply',
    clientToken: payload.clientToken,
    version: '1.0',
    code: 0,
    msg: 'success',
    data: {},
  };

  const replyTopic = state.mqttConfig.publishTopic;
  state.client.publish(replyTopic, JSON.stringify(replyPayload), { qos: 1 });
  log('DOWN', 'Property set reply sent', { clientToken: payload.clientToken });

  // 如果设置了目标温度，更新基础温度
  if (payload.params?.target_temperature !== undefined) {
    state.baseTemp = payload.params.target_temperature;
    log('DOWN', `Target temperature updated to ${state.baseTemp}°C`);
  }
}

function handleActionDown(_topic, payload) {
  log('ACTION', `Action invoked: ${payload.params?.action_id || 'unknown'}`, payload);

  const actionId = payload.params?.action_id || 'unknown';
  let outputParams = {};
  let code = 0;
  let msg = 'success';

  if (actionId === 'set_temperature') {
    const newTemp = payload.params?.input_params?.target_temp;
    if (newTemp !== undefined && newTemp >= 16 && newTemp <= 32) {
      state.baseTemp = newTemp;
      outputParams = { result: true };
      log('ACTION', `Temperature set to ${newTemp}°C`);
    } else {
      code = 1001;
      msg = 'Invalid target temperature';
      log('ACTION', 'Invalid temperature value', { target_temp: newTemp });
    }
  } else if (actionId === 'reboot') {
    log('ACTION', 'Rebooting device... (simulated)');
    outputParams = { result: true };
  } else {
    code = 1002;
    msg = `Unknown action: ${actionId}`;
  }

  const replyPayload = {
    method: 'thing.action.invoke.reply',
    clientToken: payload.clientToken,
    version: '1.0',
    code,
    msg,
    data: { output_params: outputParams },
  };

  const replyTopic = state.mqttConfig.publishTopic;
  state.client.publish(replyTopic, JSON.stringify(replyPayload), { qos: 1 });
  log('ACTION', 'Action reply sent', { actionId, code, msg });
}

function handleShadowSync(_topic, payload) {
  const delta = payload.payload?.state?.delta;
  if (delta && Object.keys(delta).length > 0) {
    log('SHADOW', 'Delta received (desired state to sync)', delta);

    // 模拟设备同步: 将 desired 状态应用到本地后上报 reported
    const reported = {};
    for (const [key, value] of Object.entries(delta)) {
      reported[key] = value;
      if (key === 'target_temperature') {
        state.baseTemp = Number(value);
      }
    }

    const shadowUpdate = {
      method: 'shadow.update',
      clientToken: randomUUID(),
      version: '1.0',
      payload: {
        state: { reported },
        version: payload.payload?.version || 0,
      },
    };

    const shadowTopic = `$iot/${state.product.productId}/${state.device.deviceName}/shadow/update`;
    state.client.publish(shadowTopic, JSON.stringify(shadowUpdate), { qos: 1 });
    log('SHADOW', 'Shadow reported update sent', reported);
  } else {
    log('SHADOW', 'Shadow sync: no delta (state is in sync)');
  }
}

// ============================================================
// Shadow 查询演示（通过 REST API 触发）
// ============================================================
async function demoShadowRest() {
  log('SHADOW', '--- Shadow REST API Demo ---');

  // 获取当前影子
  const shadow = await api('GET', `/api/v1/shadows/${state.device.deviceId}`);
  log('SHADOW', 'Current shadow', {
    reported: shadow.state?.reported,
    desired: shadow.state?.desired,
    delta: shadow.state?.delta,
    version: shadow.version,
  });

  // 更新期望状态
  const updated = await api('PUT', `/api/v1/shadows/${state.device.deviceId}`, {
    state: { desired: { target_temperature: 20, power_switch: 1 } },
    version: shadow.version,
  });
  log('SHADOW', 'Desired updated', {
    new_desired: updated.state?.desired,
    delta: updated.state?.delta,
    new_version: updated.version,
  });

  // 获取 delta
  const deltaResult = await api('GET', `/api/v1/shadows/${state.device.deviceId}/delta`);
  log('SHADOW', 'Delta check', { delta: deltaResult.state?.delta });
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   IoT Explorer — Mock Device E2E Test          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  log('CFG', `API: ${API_BASE}  MQTT: ${MQTT_HOST}:${MQTT_PORT}`);
  console.log('');

  try {
    // Step 1-3: REST API 注册
    await getPlatformToken();
    await createProduct();
    await registerDevice();

    console.log('');
    log('---', 'Registration complete. Connecting MQTT...');
    console.log('');

    // Step 4: MQTT 连接（通过 EMQX 一机一密认证）
    await connectMqtt();

    console.log('');
    log('---', 'MQTT connected. Starting property reports...');
    console.log('');

    // Step 5: 定时上报
    startPropertyReporting();

    // Step 6: 等几轮上报后演示 Shadow REST API
    setTimeout(async () => {
      try {
        await demoShadowRest();
      } catch (err) {
        log('SHADOW', 'Demo failed', { error: err.message });
      }
    }, 8000);

    // 保持运行
    log('INFO', 'Mock device is running. Press Ctrl+C to stop.');
    console.log('');

  } catch (err) {
    log('FATAL', 'Initialization failed', { message: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('');
  log('INFO', 'Shutting down...');
  if (state.keepAliveTimer) clearInterval(state.keepAliveTimer);
  if (state.client) {
    state.client.end(true, () => {
      log('INFO', 'MQTT disconnected. Goodbye!');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

main();
