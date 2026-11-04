import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const now = new Date();
  const oneHourAgo = new Date(Date.now() - 3600 * 1000);
  const oneDayAgo = new Date(Date.now() - 86400 * 1000);

  const [
    totalDevices,
    onlineDevices,
    warningDevices,
    offlineDevices,
    totalGroups,
    unacknowledgedAlerts,
    recentTelemetryCount,
    devicesByType,
    devicesByGroup,
  ] = await Promise.all([
    db.device.count(),
    db.device.count({ where: { status: "online" } }),
    db.device.count({ where: { status: "warning" } }),
    db.device.count({ where: { status: "offline" } }),
    db.deviceGroup.count(),
    db.alert.count({ where: { acknowledged: false } }),
    db.telemetry.count({ where: { timestamp: { gte: oneHourAgo } } }),
    db.device.groupBy({ by: ["type"], _count: { type: true } }),
    db.device.groupBy({ by: ["groupId"], _count: { groupId: true } }),
  ]);

  // Get alerts by level for recent 24h
  const alertCounts = await db.alert.groupBy({
    by: ["level"],
    where: { createdAt: { gte: oneDayAgo } },
    _count: { level: true },
  });

  // Get recent alerts
  const recentAlerts = await db.alert.findMany({
    where: { createdAt: { gte: oneDayAgo } },
    include: { device: { select: { name: true } }, rule: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Get latest telemetry per device (last seen)
  const latestDeviceData = await db.device.findMany({
    where: { status: { in: ["online", "warning"] } },
    include: {
      group: { select: { name: true, color: true } },
      telemetry: {
        orderBy: { timestamp: "desc" },
        take: 1,
      },
    },
    take: 6,
    orderBy: { lastSeenAt: "desc" },
  });

  return NextResponse.json({
    summary: {
      totalDevices,
      onlineDevices,
      warningDevices,
      offlineDevices,
      totalGroups,
      unacknowledgedAlerts,
      recentTelemetryCount,
    },
    devicesByType,
    devicesByGroup,
    alertCounts,
    recentAlerts,
    latestDeviceData,
  });
}