import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const hours = parseInt(url.searchParams.get("hours") || "24");
  const limit = parseInt(url.searchParams.get("limit") || "500");
  const since = new Date(Date.now() - hours * 3600 * 1000);

  const where: Record<string, unknown> = { deviceId: id, timestamp: { gte: since } };
  if (key) where.key = key;

  const telemetry = await db.telemetry.findMany({
    where,
    orderBy: { timestamp: "asc" },
    take: limit,
  });

  // Get distinct metric keys for this device
  const metricKeys = await db.telemetry.findMany({
    where: { deviceId: id },
    distinct: ["key"],
    select: { key: true, unit: true },
  });

  // Get latest value for each key
  const latestValues = await db.telemetry.groupBy({
    by: ["key"],
    where: { deviceId: id },
    _max: { value: true, timestamp: true },
  });

  return NextResponse.json({ telemetry, metricKeys, latestValues });
}
