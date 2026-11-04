#!/usr/bin/env node
/**
 * emqx-setup.mts — EMQX 5.8 接入配置脚本(幂等, 可重复执行)
 *
 * 配置内容(全部通过 EMQX 管理 REST API, 无需 Dashboard 手工操作):
 *   1. HTTP authn          → POST http://127.0.0.1:3200/api/internal/mqtt/auth (设备一机一密连接鉴权)
 *   2. HTTP connector      → 后端 base url (所有数据集成 action 共用)
 *   3. 6 个 HTTP action    → 上行 4 类消息 + 上下线 2 类系统事件, 转发到 internal 回调端点
 *   4. 6 条 rule           → topic/事件 到 action 的绑定(SQL: SELECT ... FROM ...)
 *   5. API key             → 后端下行推送(POST /api/v5/publish)凭据, 创建后需手工填入 backend/.env
 *
 * EMQX 5.8 系统事件主题用旧版命名: $events/client_connected / $events/client_disconnected
 * (新版斜杠格式 $events/client/connected 是 5.10+, 勿改)
 * $av/up/event/+/+ 是本平台自定义 AV 上行 topic(backend-design/DESIGN.md 无 AV 规范)
 *
 * 运行: cd backend && npx tsx --env-file=.env tools/emqx-setup.mts
 * 必需环境变量: INTERNAL_SECRET
 * 可选环境变量: EMQX_API_BASE(默认 http://127.0.0.1:18083)
 *               EMQX_ADMIN_USER / EMQX_ADMIN_PASS(默认 admin/public, Dashboard 初始凭据)
 */

const EMQX_BASE = process.env.EMQX_API_BASE || 'http://127.0.0.1:18083';
const ADMIN_USER = process.env.EMQX_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.EMQX_ADMIN_PASS || 'public';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const BACKEND_BASE = process.env.BACKEND_BASE || 'http://127.0.0.1:3200';

if (!INTERNAL_SECRET) {
  console.error('❌ 缺少 INTERNAL_SECRET 环境变量(从 backend/.env 提供, 用法: npx tsx --env-file=.env tools/emqx-setup.mts)');
  process.exit(1);
}

// EMQX 5.8 管理 API 不接受 admin/public 直接 Basic 认证:
// 须先 POST /api/v5/login 换取 Bearer token, 全程用 token 调用。
let ADMIN_TOKEN = '';

async function login(): Promise<void> {
  const res = await fetch(`${EMQX_BASE}/api/v5/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    signal: AbortSignal.timeout(5_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.token) {
    throw new Error(`登录失败(${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  }
  ADMIN_TOKEN = json.token;
  console.log(`✓ EMQX 管理 API 登录成功(${ADMIN_USER}@${EMQX_BASE}, 版本 ${json.version ?? '?'}, ${json.license?.edition ?? ''})`);
}

async function emqxApi<T = any>(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${EMQX_BASE}/api/v5${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { status: res.status, json };
}

// ---------------- 1. authn ----------------

async function ensureAuthn(): Promise<void> {
  const { json } = await emqxApi('GET', '/authentication');
  const list: any[] = Array.isArray(json) ? json : (json as any)?.data ?? [];
  const existing = list.find((a: any) => a.backend === 'http' && a.mechanism === 'password_based');

  const authnBody = {
    mechanism: 'password_based',
    backend: 'http',
    enable: true,
    method: 'post',
    url: `${BACKEND_BASE}/api/internal/mqtt/auth`,
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: {
      username: '${username}',
      password: '${password}',
      clientid: '${clientid}',
    },
    request_timeout: '5s',
  };

  if (existing) {
    await emqxApi('PUT', `/authentication/${encodeURIComponent(existing.id)}`, authnBody);
    console.log(`✓ authn 已存在, 更新: ${existing.id}`);
  } else {
    await emqxApi('POST', '/authentication', authnBody);
    console.log('✓ authn 已创建: HTTP password_based → /api/internal/mqtt/auth');
  }
}

// ---------------- 2. connector ----------------

const CONNECTOR_NAME = 'iot_backend';

async function ensureConnector(): Promise<void> {
  const { json } = await emqxApi('GET', '/connectors?type=http');
  const list: any[] = Array.isArray(json) ? json : (json as any)?.data ?? [];
  const existing = list.find((c: any) => c.name === CONNECTOR_NAME);

  const body = {
    type: 'http',
    name: CONNECTOR_NAME,
    enable: true,
    url: BACKEND_BASE,
    headers: { 'content-type': 'application/json' },
  };

  if (existing) {
    // PUT 的 body 不接受 name/type(已在路径中), 只发可更新字段
    await emqxApi('PUT', `/connectors/${encodeURIComponent(`http:${CONNECTOR_NAME}`)}`, {
      enable: true,
      url: BACKEND_BASE,
      headers: { 'content-type': 'application/json' },
    });
    console.log(`✓ connector 已存在, 更新: http:${CONNECTOR_NAME} → ${BACKEND_BASE}`);
  } else {
    await emqxApi('POST', '/connectors', body);
    console.log(`✓ connector 已创建: http:${CONNECTOR_NAME} → ${BACKEND_BASE}`);
  }
}

// ---------------- 3. actions + rules ----------------

// action.parameters.body 为模板字符串: ${payload} 不加引号 → EMQX 展开为原始 JSON 对象
interface ActionDef {
  name: string;
  path: string;
  bodyTemplate: string;
  ruleId: string;
  sql: string;
}

const ACTION_DEFS: ActionDef[] = [
  {
    name: 'property_report',
    path: '/api/internal/mqtt/property-report',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","payload":${payload}}',
    ruleId: 'up_property',
    sql: 'SELECT payload, username, clientid FROM "$thing/up/property/+/+"',
  },
  {
    name: 'event_report',
    path: '/api/internal/mqtt/event-report',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","payload":${payload}}',
    ruleId: 'up_event',
    sql: 'SELECT payload, username, clientid FROM "$thing/up/event/+/+"',
  },
  {
    name: 'shadow_update',
    path: '/api/internal/mqtt/shadow-update',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","payload":${payload}}',
    ruleId: 'up_shadow',
    sql: 'SELECT payload, username, clientid FROM "$shadow/update/+/+"',
  },
  {
    name: 'av_report',
    path: '/api/internal/mqtt/av-report',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","events":${payload}}',
    ruleId: 'up_av',
    sql: 'SELECT payload, username, clientid FROM "$av/up/event/+/+"',
  },
  {
    name: 'client_online',
    path: '/api/internal/mqtt/online',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","ip_address":"${peerhost}"}',
    ruleId: 'evt_connected',
    sql: 'SELECT username, clientid, peerhost FROM "$events/client_connected"',
  },
  {
    name: 'client_offline',
    path: '/api/internal/mqtt/offline',
    bodyTemplate: '{"username":"${username}","client_id":"${clientid}","reason":"${reason}"}',
    ruleId: 'evt_disconnected',
    sql: 'SELECT username, clientid, reason FROM "$events/client_disconnected"',
  },
];

async function ensureActionsAndRules(): Promise<void> {
  const { json: actionsJson } = await emqxApi('GET', '/actions?type=http');
  const actions: any[] = Array.isArray(actionsJson) ? actionsJson : (actionsJson as any)?.data ?? [];
  const { json: rulesJson } = await emqxApi('GET', '/rules');
  const rules: any[] = Array.isArray(rulesJson) ? rulesJson : (rulesJson as any)?.data ?? [];

  for (const def of ACTION_DEFS) {
    const actionBody = {
      type: 'http',
      name: def.name,
      connector: CONNECTOR_NAME,
      enable: true,
      parameters: {
        path: def.path,
        method: 'post',
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        body: def.bodyTemplate,
        max_retries: 2,
        request_timeout: '15s',
      },
    };

    const actionId = `http:${def.name}`;
    if (actions.some((a: any) => a.name === def.name)) {
      // PUT 的 body 不接受 type/name(已在路径中), 只发可更新字段
      await emqxApi('PUT', `/actions/${encodeURIComponent(actionId)}`, {
        enable: true,
        connector: CONNECTOR_NAME,
        parameters: {
          path: def.path,
          method: 'post',
          headers: { 'x-internal-secret': INTERNAL_SECRET },
          body: def.bodyTemplate,
          max_retries: 2,
          request_timeout: '15s',
        },
      });
      console.log(`✓ action 已存在, 更新: ${actionId} → ${def.path}`);
    } else {
      await emqxApi('POST', '/actions', actionBody);
      console.log(`✓ action 已创建: ${actionId} → ${def.path}`);
    }

    const ruleBody = {
      id: def.ruleId,
      enable: true,
      sql: def.sql,
      actions: [actionId],
    };
    if (rules.some((r: any) => r.id === def.ruleId)) {
      await emqxApi('PUT', `/rules/${encodeURIComponent(def.ruleId)}`, ruleBody);
      console.log(`  └ rule 已存在, 更新: ${def.ruleId}`);
    } else {
      await emqxApi('POST', '/rules', ruleBody);
      console.log(`  └ rule 已创建: ${def.ruleId}`);
    }
  }
}

// ---------------- 4. API key(后端下行推送凭据) ----------------

const API_KEY_NAME = 'iotBackend';

async function ensureApiKey(): Promise<void> {
  const { json } = await emqxApi('GET', '/api_key');
  const list: any[] = Array.isArray(json) ? json : (json as any)?.data ?? [];
  if (list.some((k: any) => k.name === API_KEY_NAME)) {
    console.log(`✓ API key 已存在: ${API_KEY_NAME}(secret 只在创建时显示一次; 若丢失可先删除再重跑本脚本)`);
    return;
  }
  const { json: created } = await emqxApi('POST', '/api_key', {
    name: API_KEY_NAME,
    desc: 'IoT 后端下行推送(shadow $shadow/get/accepted)',
    enable: true,
  });
  console.log('✓ API key 已创建(请手工填入 backend/.env):');
  console.log(`    EMQX_API_KEY=${(created as any).api_key}`);
  console.log(`    EMQX_API_SECRET=${(created as any).api_secret}`);
}

// ---------------- main ----------------

async function main(): Promise<void> {
  console.log(`EMQX 配置脚本: ${EMQX_BASE} | 后端: ${BACKEND_BASE}\n`);

  // 前置: 登录(兼可达检查)
  try {
    await login();
  } catch (err) {
    console.error(`❌ EMQX API 登录失败(${EMQX_BASE})。请先启动: brew services start emqx`);
    console.error(`  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  await ensureAuthn();
  await ensureConnector();
  await ensureActionsAndRules();
  await ensureApiKey();

  console.log('\n全部配置完成。校验:');
  console.log('  - EMQX Dashboard (http://localhost:18083) → Access Control / Integration 查看上述条目');
  console.log('  - backend/.env 填入 EMQX_API_KEY / EMQX_API_SECRET 后重启后端, 下行推送即生效');
}

main().catch((err: Error) => {
  console.error('❌ 配置失败:', err.message);
  process.exit(1);
});
