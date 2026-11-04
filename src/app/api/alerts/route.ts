import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const acknowledged = url.searchParams.get("acknowledged");
  const limit = parseInt(url.searchParams.get("limit") || "50");

  const where: Record<string, unknown> = {};
  if (level) where.level = level;
  if (acknowledged !== null) where.acknowledged = acknowledged === "true";

  const alerts = await db.alert.findMany({
    where,
    include: {
      device: { select: { name: true, type: true } },
      rule: { select: { name: true, metricKey: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(alerts);
}