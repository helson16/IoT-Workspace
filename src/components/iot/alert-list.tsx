"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Info, XCircle, Bell } from "lucide-react";

const levelConfig: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  info: { icon: Info, color: "text-sky-600", bg: "bg-sky-50 border-sky-200" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  critical: { icon: XCircle, color: "text-red-600", bg: "bg-red-50 border-red-200" },
};

interface Alert {
  id: string;
  level: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
  device?: { name: string; type: string } | null;
  rule?: { name: string; metricKey: string } | null;
}

export function AlertList() {
  const queryClient = useQueryClient();

  const { data: alerts, isLoading } = useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: () => fetch("/api/alerts?limit=30").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const acknowledgeAlert = async (id: string) => {
    await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  const unacknowledged = alerts?.filter((a) => !a.acknowledged) || [];
  const acknowledged = alerts?.filter((a) => a.acknowledged) || [];

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-4 w-4" />
            告警中心
            {unacknowledged.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unacknowledged.length} 条未处理
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">加载中...</div>
        ) : !alerts || alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">暂无告警记录</div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {alerts.map((alert) => {
              const cfg = levelConfig[alert.level] || levelConfig.info;
              const LevelIcon = cfg.icon;
              return (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${cfg.bg} ${alert.acknowledged ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <LevelIcon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={alert.level === "critical" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {alert.level === "critical" ? "严重" : alert.level === "warning" ? "警告" : "信息"}
                        </Badge>
                        {alert.device && (
                          <span className="text-xs text-muted-foreground">
                            {alert.device.name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(alert.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{alert.message}</p>
                      {!alert.acknowledged && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 text-xs gap-1"
                          onClick={() => acknowledgeAlert(alert.id)}
                        >
                          <CheckCircle2 className="h-3 w-3" /> 标记已处理
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
