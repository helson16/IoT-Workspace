#!/usr/bin/env node
/**
 * sim-device.js — 设备数据流模拟器(无 EMQX 环境)
 *
 * 通过后端 internal HTTP 回调接口模拟设备行为(与 EMQX Webhook 调用后端的路径完全一致):
 *   POST /api/internal/mqtt/online         设备上线
 *   POST /api/internal/mqtt/property-report 属性上报(走物模型校验 → 影子 reported → 历史表)
 *   POST /api/internal/mqtt/event-report    事件上报(高温告警)
 *   POST /api/internal/mqtt/offline         设备离线
 *
 * 用法: node tests/sim-device.js [设备名...]   (默认 living-room-thermo-01)
 * 环境变量: API_BASE(默认 http://localhost:3200) INTERNAL_SECRET(默认 dev-internal-secret)
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3200';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'dev-internal-secret';
const PRODUCT_ID = 'prod-a1b2c3d4'; // 智能温控器
const REPORT_INTERVAL_MS = Number(process.env.REPORT_INTERVAL_MS || 5000);
const SPIKE_EVERY_N = 6; // 每 N 次上报制造一次高温尖峰(触发告警)

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['living-room-thermo-01'];

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
function log(tag, msg) {
  console.log(`[${ts()}] [${tag.padEnd(7)}] ${msg}`);
}

async function api(path, { method = 'GET', body, internal = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (internal) headers['X-Internal-Secret'] = INTERNAL_SECRET;
  else headers['Authorization'] = `Bearer ${await getPlatformToken()}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
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

// ---------------- 设备模拟 ----------------
class SimDevice {
  constructor(deviceName) {
    this.deviceName = deviceName;
    this.deviceId = null;
    this.counter = 0;
    this.baseTemp = 23 + Math.random() * 2;
    this.baseHum = 52 + Math.random() * 5;
  }

  async init() {
    // 从平台查询设备(须已由种子数据/页面注册创建)
    const json = await api(`/api/v1/products/${PRODUCT_ID}/devices/${this.deviceName}`);
    this.deviceId = json.data.deviceId;
    log('DEVICE', `${this.deviceName} -> deviceId=${this.deviceId.slice(0, 12)}...`);

    // 上线
    await api('/api/internal/mqtt/online', {
      method: 'POST',
      internal: true,
      body: {
        device_id: this.deviceId,
        client_id: `${PRODUCT_ID}${this.deviceName};12010126`,
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
              event_type: 'alert',
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
    await api('/api/internal/mqtt/offline', {
      method: 'POST',
      internal: true,
      body: { device_id: this.deviceId, reason: 'simulator exit' },
    });
    log('OFFLINE', `${this.deviceName} 已离线`);
  }
}

async function main() {
  console.log(`\n=== IoT 设备模拟器 ===`);
  console.log(`API: ${API_BASE} | 上报间隔: ${REPORT_INTERVAL_MS}ms\n`);

  // 健康检查
  const health = await fetch(`${API_BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error('❌ 后端服务不可达, 请先启动: cd backend && npm run dev');
    process.exit(1);
  }

  const devices = [];
  for (const name of targets) {
    const d = new SimDevice(name);
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
