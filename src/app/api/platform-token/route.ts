import { NextResponse } from "next/server";

/**
 * 平台 Token 签发代理(服务端)。
 *
 * APP_KEY/APP_SECRET 仅存在于本进程的环境变量(无 NEXT_PUBLIC_ 前缀, 不会打进
 * 浏览器 bundle)。浏览器侧统一通过本端点换取平台 token, 凭证不再暴露给前端。
 *
 * 环境变量(见 .env.local):
 *   APP_KEY / APP_SECRET  平台应用凭证(与 backend/.env 保持一致)
 *   API_BASE              后端地址, 默认 http://localhost:3200
 */
const API_BASE = process.env.API_BASE || "http://localhost:3200";
const APP_KEY = process.env.APP_KEY || "";
const APP_SECRET = process.env.APP_SECRET || "";

export async function POST() {
  if (!APP_KEY || !APP_SECRET) {
    return NextResponse.json(
      { code: 50001, message: "平台凭证未配置(APP_KEY/APP_SECRET)", data: null },
      { status: 500 },
    );
  }

  const upstream = await fetch(`${API_BASE}/api/v1/auth/platform-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_key: APP_KEY, app_secret: APP_SECRET }),
  });

  const json = await upstream.json().catch(() => ({
    code: -1,
    message: `平台 Token 服务不可用 (HTTP ${upstream.status})`,
    data: null,
  }));

  // token 属于短期凭证, 禁止中间层缓存
  return NextResponse.json(json, {
    status: upstream.ok ? 200 : upstream.status,
    headers: { "Cache-Control": "no-store" },
  });
}
