"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  Radio,
  WifiOff,
  Layers,
  Zap,
} from "lucide-react";

interface Stats {
  totalDevices: number;
  onlineDevices: number;
  warningDevices: number;
  offlineDevices: number;
  totalGroups: number;
  unacknowledgedAlerts: number;
  recentTelemetryCount: number;
}

export function StatsCards({ stats }: { stats: Stats }) {
  const cards = [
    {
      title: "设备总数",
      value: stats.totalDevices,
      icon: Layers,
      color: "text-slate-600",
      bg: "bg-slate-50",
    },
    {
      title: "在线",
      value: stats.onlineDevices,
      icon: Radio,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      title: "告警",
      value: stats.warningDevices,
      icon: AlertTriangle,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "离线",
      value: stats.offlineDevices,
      icon: WifiOff,
      color: "text-red-500",
      bg: "bg-red-50",
    },
    {
      title: "未处理告警",
      value: stats.unacknowledgedAlerts,
      icon: AlertTriangle,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      title: "实时数据流",
      value: stats.recentTelemetryCount,
      icon: Activity,
      color: "text-cyan-600",
      bg: "bg-cyan-50",
      subtitle: "/ 小时",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.title} className="border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <div className={`${card.bg} p-1.5 rounded-md`}>
              <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{card.value}</span>
              {card.subtitle && (
                <span className="text-xs text-muted-foreground">
                  {card.subtitle}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge
      variant={connected ? "default" : "destructive"}
      className="gap-1.5"
    >
      <Zap className="h-3 w-3" />
      {connected ? "实时已连接" : "实时已断开"}
    </Badge>
  );
}
