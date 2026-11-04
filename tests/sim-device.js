#!/usr/bin/env node
/**
 * sim-device.js — 设备数据流模拟器(MQTT / HTTP 双模式)
 *
 * SIM_MODE=mqtt(默认): 走真实 EMQX MQTT 链路 ——
 *   设备用一机一密通过 EMQX HTTP auth hook 鉴权连接(broker 地址 MQTT_URL),
 *   上行发布到 $thing/$shadow/$av topic, 由 EMQX 数据集成(action+rule)转发到后端 internal 端点;
 *   上下线由 EMQX $events/client_connected|disconnected 系统事件落库, 连接即上线、断开即离线。
 *   云端下行(影子 desired 变化)通过订阅 $shadow/get/accepted/{p}/{n} 接收。
 *
 * SIM_MODE=http(回退通道, 无 EMQX 环境用): 直接 POST 后端 internal 回调接口,
 *   与 EMQX Webhook 调用后端的路径完全一致:
 *     POST /api/internal/mqtt/online | property-report | event-report | av-report | offline
 *
 * 两类模拟设备(按设备名分派):
 *   - 温控器(默认 living-room-thermo-01): 周期属性上报 + 周期性高温告警
 *   - 摄像头(名字含 "-cam", 默认 front-door-cam-01 / back-yard-cam-02):
 *     幂等自注册"智能摄像头"产品与设备, 周期上报 AV 事件元数据(无真实视频流)
 *
 * 用法: node tests/sim-device.js [设备名...]   (缺省 = 温控器 + 两个摄像头)
 * 环境变量: SIM_MODE(mqtt|http, 默认 mqtt) MQTT_URL(默认 mqtts://localhost:8883, 明文回退 mqtt://localhost:1883)
 *           SERVER_ROOT_CA(默认 backend/.certs/ca.pem)
 *           API_BASE(默认 http://localhost:3200) INTERNAL_SECRET(默认 dev-internal-secret)
 */

import mqtt from 'mqtt';
import fs from 'node:fs';

const SIM_MODE = (process.env.SIM_MODE || 'mqtt').toLowerCase();
// 默认走 EMQX TLS 监听(mqtts @8883, CA=backend/.certs/ca.pem); 明文回退: MQTT_URL=mqtt://localhost:1883
const MQTT_URL = process.env.MQTT_URL || 'mqtts://localhost:8883';
const SERVER_ROOT_CA = process.env.SERVER_ROOT_CA
  || new URL('../backend/.certs/ca.pem', import.meta.url).pathname;
const SDK_APP_ID = process.env.MQTT_SDK_APP_ID || '12010126';
const API_BASE = process.env.API_BASE || 'http://localhost:3200';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'dev-internal-secret';
const PRODUCT_ID = 'prod-a1b2c3d4'; // 智能温控器
const CAMERA_PRODUCT_NAME = '智能摄像头';
const REPORT_INTERVAL_MS = Number(process.env.REPORT_INTERVAL_MS || 5000);
const SPIKE_EVERY_N = 6; // 每 N 次上报制造一次高温尖峰(触发告警)

const DEFAULT_TARGETS = ['living-room-thermo-01', 'front-door-cam-01', 'back-yard-cam-02'];

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function log(tag, msg) {
  console.log(`[${ts()}] [${tag.padEnd(7)}] ${msg}`);
}

async function api(path, { method = 'GET', body, internal = false, noThrow = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (internal) headers['X-Internal-Secret'] = INTERNAL_SECRET;
  else headers['Authorization'] = `Bearer ${await getPlatformToken()}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (noThrow) return { ok: res.ok, status: res.status, json };
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// ---------------- 平台 Token(缓存) ----------------
let tokenCache = { token: null, exp: 0 };
async function getPlatformToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const res = await fetch(`${API_BASE}/api/v1/auth/platform-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_key: process.env.APP_KEY || 'iot-explorer-app-key',
      app_secret: process.env.APP_SECRET || 'iot-explorer-app-secret',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`platform-token failed: ${JSON.stringify(json)}`);
  tokenCache = { token: json.data.access_token, exp: Date.now() + json.data.expires_in * 1000 };
  return tokenCache.token;
}

// ---------------- 摄像头产品幂等注册 ----------------
let cameraProductIdCache = null;
async function ensureCameraProduct() {
  if (cameraProductIdCache) return cameraProductIdCache;

  const list = await api('/api/v1/products?page=1&page_size=100');
  const found = (list.data.items || []).find(
    (p) => p.productName === CAMERA_PRODUCT_NAME,
  );
  if (found) {
    cameraProductIdCache = found.productId;
    log('AV-PROD', `产品已存在: ${CAMERA_PRODUCT_NAME} (${found.productId})`);
    return cameraProductIdCache;
  }

  const created = await api('/api/v1/products', {
    method: 'POST',
    body: {
      product_name: CAMERA_PRODUCT_NAME,
      category: '视频监控',
      protocol_type: 'MQTT',
      network_type: 'WiFi',
      description: '模拟摄像头产品: 上报录制/截图/回放事件元数据(无真实视频流)',
    },
  });
  cameraProductIdCache = created.data.productId;
  log('AV-PROD', `产品已创建: ${CAMERA_PRODUCT_NAME} (${cameraProductIdCache})`);
  return cameraProductIdCache;
}

// ---------------- 温控器模拟 ----------------
class SimDevice {
  constructor(deviceName) {
    this.deviceName = deviceName;
    this.productId = PRODUCT_ID;
    this.deviceId = null;
    this.client = null; // mqtt 模式下的 MQTT 连接
    this.counter = 0;
    this.baseTemp = 23 + Math.random() * 2;
    this.baseHum = 52 + Math.random() * 5;
  }

  async init() {
    // 从平台查询设备(须已由种子数据/页面注册创建)
    const json = await api(`/api/v1/products/${this.productId}/devices/${this.deviceName}`);
    this.deviceId = json.data.deviceId;
    log('DEVICE', `${this.deviceName} -> deviceId=${this.deviceId.slice(0, 12)}...`);

    // 上线: mqtt 模式连 EMQX(auth hook 鉴权成功即落库上线); http 模式显式调上线回调
    if (SIM_MODE === 'mqtt') {
      await this.mqttConnect();
    } else {
      await this.online();
    }
  }

  // ---- MQTT 连接(一机一密: username {p}{n};{sdkAppId} / password {secret};hmacsha256) ----
  async mqttConnect() {
    const cred = await api(`/api/v1/security/credentials/${this.deviceId}`);
    const secret = cred.data.deviceSecret;
    if (!secret) throw new Error('未取到 deviceSecret, 无法构造 MQTT 密码');

    const username = `${this.productId}${this.deviceName};${SDK_APP_ID}`;
    const password = `${secret};hmacsha256`;
    const clientId = `${this.productId}${this.deviceName};${SDK_APP_ID};${this.productId};${Math.floor(Date.now() / 1000) + 86400}`;

    await new Promise((resolve, reject) => {
      // mqtts: 信任自签 CA(单向 TLS); mqtt: 明文直连(开发回退)
      const tlsOpts = MQTT_URL.startsWith('mqtts')
        ? { ca: fs.readFileSync(SERVER_ROOT_CA), rejectUnauthorized: true }
        : {};
      const client = mqtt.connect(MQTT_URL, {
        clientId,
        username,
        password,
        keepalive: 30,
        clean: true,
        reconnectPeriod: 5000, // 断线自动重连(auth hook 重新鉴权)
        ...tlsOpts,
      });
      const timer = setTimeout(() => {
        reject(new Error(`MQTT 连接超时(${MQTT_URL}), 请确认 EMQX 已启动`));
      }, 10_000);

      client.on('connect', () => {
        clearTimeout(timer);
        this.client = client;
        this.subscribeDown();
        log('ONLINE', `${this.deviceName} MQTT 已连接 → ${MQTT_URL}`);
        resolve();
      });
      client.on('error', (err) => {
        log('MQTT-ERR', `${this.deviceName}: ${err.message}`);
        clearTimeout(timer);
        reject(err);
      });
      client.on('reconnect', () => log('MQTT', `${this.deviceName} 断线, 重连中...`));
      client.on('message', (topic, payload) => {
        log('DOWN', `${this.deviceName} ← ${topic}: ${payload.toString().slice(0, 200)}`);
      });
    });
  }

  // 订阅云端下行: 属性设置 / 行为调用 / 影子 desired 通知(见 DESIGN.md §3.2)
  subscribeDown() {
    const p = this.productId;
    const n = this.deviceName;
    const downTopics = [
      `$thing/down/property/${p}/${n}`,
      `$thing/down/action/${p}/${n}`,
      `$shadow/get/accepted/${p}/${n}`,
    ];
    this.client.subscribe(downTopics, { qos: 1 }, (err) => {
      if (err) log('SUB-ERR', `${this.deviceName} 订阅下行失败: ${err.message}`);
      else log('SUB', `${this.deviceName} 已订阅 ${downTopics.length} 个下行 topic`);
    });
  }

  /** 上行 topic 前缀构造: kind in {property, event} → $thing/up/{kind}/{p}/{n} */
  upTopic(kind) {
    return `$thing/up/${kind}/${this.productId}/${this.deviceName}`;
  }

  /** MQTT 发布(QoS 1, 触发 EMQX 数据集成转发到后端) */
  publishJson(topic, payload) {
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  async online() {
    await api('/api/internal/mqtt/online', {
      method: 'POST',
      internal: true,
      body: {
        device_id: this.deviceId,
        client_id: `${this.productId}${this.deviceName};12010126`,
        ip_address: '127.0.0.1',
      },
    });
    log('ONLINE', `${this.deviceName} 已上线`);
  }

  nextReport() {
    this.counter += 1;
    const t = this.counter / 6;
    let temp = this.baseTemp + Math.sin(t) * 3 + (Math.random() - 0.5);
    // 周期性高温尖峰 → 触发告警事件
    const spike = this.counter % SPIKE_EVERY_N === 0;
    if (spike) temp = 30.5 + Math.random() * 2;
    const hum = Math.max(
      5,
      Math.min(95, this.baseHum + Math.cos(t / 2) * 7 + (Math.random() - 0.5) * 3),
    );
    return { temp: Number(temp.toFixed(1)), hum: Number(hum.toFixed(1)), spike };
  }

  async reportOnce() {
    const { temp, hum, spike } = this.nextReport();

    if (SIM_MODE === 'mqtt') {
      // 1. 属性上报($thing/up/property, EMQX action 模板展开 payload 转发后端)
      this.publishJson(this.upTopic('property'), {
        method: 'thing.event.property.post',
        clientToken: `sim-${Date.now()}`,
        params: { temperature: temp, humidity: hum, power_switch: 1 },
      });
      log('REPORT', `#${this.counter} ${this.deviceName} temp=${temp}°C humidity=${hum}% (mqtt)`);

      // 2. 高温告警事件($thing/up/event)
      if (spike) {
        this.publishJson(this.upTopic('event'), {
          method: 'thing.event.high_temperature_alarm.post',
          clientToken: `sim-evt-${Date.now()}`,
          params: {
            event_id: 'high_temperature_alarm',
            event_type: 'warn',
            event_time: Date.now(),
            output_params: { current_temp: temp, threshold: 30 },
          },
        });
        log('EVENT', `🔥 ${this.deviceName} 高温告警 current_temp=${temp}°C (mqtt)`);
      }
      return;
    }

    // ---- HTTP 模式(原链路) ----
    // 1. 属性上报
    await api('/api/internal/mqtt/property-report', {
      method: 'POST',
      internal: true,
      body: {
        device_id: this.deviceId,
        product_id: PRODUCT_ID,
        device_name: this.deviceName,
        payload: {
          method: 'thing.event.property.post',
          clientToken: `sim-${Date.now()}`,
          params: { temperature: temp, humidity: hum, power_switch: 1 },
        },
      },
    });
    log('REPORT', `#${this.counter} ${this.deviceName} temp=${temp}°C humidity=${hum}%`);

    // 2. 高温告警事件
    if (spike) {
      await api('/api/internal/mqtt/event-report', {
        method: 'POST',
        internal: true,
        body: {
          device_id: this.deviceId,
          payload: {
            method: 'thing.event.high_temperature_alarm.post',
            clientToken: `sim-evt-${Date.now()}`,
            params: {
              event_id: 'high_temperature_alarm',
              event_type: 'warn',
              event_time: Date.now(),
              output_params: { current_temp: temp, threshold: 30 },
            },
          },
        },
      });
      log('EVENT', `🔥 ${this.deviceName} 高温告警 current_temp=${temp}°C`);
    }
  }

  async offline() {
    if (SIM_MODE === 'mqtt' && this.client) {
      // 断开 MQTT → EMQX $events/client_disconnected → 后端落库离线
      await new Promise((resolve) => this.client.end(true, resolve));
      log('OFFLINE', `${this.deviceName} MQTT 已断开(EMQX webhook 自动落离线)`);
      return;
    }
    await api('/api/internal/mqtt/offline', {
      method: 'POST',
      internal: true,
      body: { device_id: this.deviceId, reason: 'simulator exit' },
    });
    log('OFFLINE', `${this.deviceName} 已离线`);
  }
}

// ---------------- 摄像头模拟(AV 元数据链路) ----------------
class SimCamera extends SimDevice {
  constructor(deviceName) {
    super(deviceName);
    this.productId = null;
  }

  async init() {
    // 幂等自注册: 产品 → 设备(已注册则查询) → 上线
    this.productId = await ensureCameraProduct();

    const reg = await api(`/api/v1/products/${this.productId}/devices/register`, {
      method: 'POST',
      body: { device_name: this.deviceName },
      noThrow: true,
    });
    if (reg.ok) {
      this.deviceId = reg.json.data.deviceId;
      log('AV-DEV', `${this.deviceName} 已注册 -> deviceId=${this.deviceId.slice(0, 12)}...`);
    } else {
      // 409 冲突 = 设备已存在, 改用详情接口拿 deviceId
      const detail = await api(
        `/api/v1/products/${this.productId}/devices/${this.deviceName}`,
        { noThrow: true },
      );
      if (!detail.ok) throw new Error(`注册/查询设备失败: ${JSON.stringify(reg.json)}`);
      this.deviceId = detail.json.data.deviceId;
      log('AV-DEV', `${this.deviceName} 已存在 -> deviceId=${this.deviceId.slice(0, 12)}...`);
    }

    // 上线: mqtt 模式连 EMQX; http 模式显式调上线回调
    if (SIM_MODE === 'mqtt') {
      await this.mqttConnect();
    } else {
      await this.online();
    }
  }

  // 随机生成一条 AV 事件元数据(录制/截图/回放, 含少量失败样本)
  nextAvEvent() {
    this.counter += 1;
    const roll = Math.random();

    let eventType, durationSec, fileSize, streamProtocol, successRate;
    if (roll < 0.45) {
      // 录制: 30~300s, 5~80MB
      eventType = 'recording';
      durationSec = 30 + Math.floor(Math.random() * 271);
      fileSize = 5 * 1024 * 1024 + Math.floor(Math.random() * 75 * 1024 * 1024);
      streamProtocol = Math.random() < 0.5 ? 'RTMP' : 'HLS';
      successRate = 0.95;
    } else if (roll < 0.8) {
      // 截图: 100~500KB, 时长恒 0
      eventType = 'snapshot';
      durationSec = 0;
      fileSize = 100 * 1024 + Math.floor(Math.random() * 400 * 1024);
      streamProtocol = 'RTMP';
      successRate = 0.98;
    } else {
      // 回放: 10~600s, 不产生新存储
      eventType = 'playback';
      durationSec = 10 + Math.floor(Math.random() * 591);
      fileSize = 0;
      streamProtocol = Math.random() < 0.5 ? 'HLS' : 'WebRTC';
      successRate = 0.9;
    }

    const success = Math.random() < successRate;
    const ext = eventType === 'snapshot' ? 'jpg' : 'mp4';
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(
      now.getMinutes(),
    ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

    return {
      event_type: eventType,
      status: success ? 'success' : 'failed',
      file_name: `${this.deviceName}_${stamp}.${ext}`,
      file_size: fileSize,
      duration_sec: durationSec,
      stream_protocol: streamProtocol,
      detail: success
        ? { channel: 0, resolution: eventType === 'snapshot' ? '1920x1080' : '1280x720' }
        : { error_code: 5001, error_msg: 'storage write timeout' },
    };
  }

  async reportOnce() {
    const event = this.nextAvEvent();
    const flag = event.status === 'success' ? '' : ' ✗failed';
    const logLine =
      `#${this.counter} ${this.deviceName} ${event.event_type} ` +
      `${event.duration_sec}s ${(event.file_size / 1024).toFixed(0)}KB ${event.stream_protocol}${flag}`;

    if (SIM_MODE === 'mqtt') {
      // AV 上行($av/up/event, 自定义扩展 topic): 发布裸数组, EMQX action 模板 "events":${payload} 展开
      this.publishJson(`$av/up/event/${this.productId}/${this.deviceName}`, [event]);
      log('AV', `${logLine} (mqtt)`);
      return;
    }

    await api('/api/internal/mqtt/av-report', {
      method: 'POST',
      internal: true,
      body: { device_id: this.deviceId, events: [event] },
    });
    log('AV', logLine);
  }
}

// ---------------- 主循环 ----------------
function isCamera(name) {
  return name.includes('-cam');
}

async function main() {
  console.log(`\n=== IoT 设备模拟器 ===`);
  console.log(
    `API: ${API_BASE} | 模式: ${SIM_MODE.toUpperCase()}` +
      (SIM_MODE === 'mqtt' ? ` | MQTT: ${MQTT_URL}` : '') +
      ` | 上报间隔: ${REPORT_INTERVAL_MS}ms\n`,
  );

  // 健康检查
  const health = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error('❌ 后端服务不可达, 请先启动: cd backend && npm run dev');
    process.exit(1);
  }
  if (SIM_MODE === 'mqtt') {
    console.log('提示: MQTT 模式需 EMQX 已启动并已跑过 backend/tools/emqx-setup.mts 配置');
    console.log('      连接失败时可用 SIM_MODE=http 回退到 HTTP 直调链路\n');
  }

  const devices = [];
  for (const name of targets) {
    const d = isCamera(name) ? new SimCamera(name) : new SimDevice(name);
    try {
      await d.init();
      devices.push(d);
    } catch (e) {
      console.error(`❌ 设备 ${name} 初始化失败: ${e.message}`);
    }
  }
  if (devices.length === 0) {
    console.error('❌ 无可用模拟设备, 退出');
    process.exit(1);
  }

  // 周期上报
  const timer = setInterval(async () => {
    for (const d of devices) {
      try {
        await d.reportOnce();
      } catch (e) {
        console.error(`[${ts()}] [ERROR] ${d.deviceName} 上报失败: ${e.message}`);
      }
    }
  }, REPORT_INTERVAL_MS);

  // 优雅退出
  const shutdown = async () => {
    clearInterval(timer);
    console.log('\n正在离线所有模拟设备...');
    for (const d of devices) {
      try { await d.offline(); } catch { /* ignore */ }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`\n模拟运行中, Ctrl+C 退出...\n`);
}

main().catch((e) => {
  console.error('❌ 模拟器异常退出:', e.message);
  process.exit(1);
});
