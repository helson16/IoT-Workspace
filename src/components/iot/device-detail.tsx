"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Radio, WifiOff, AlertTriangle, Send,
  CheckCircle2, XCircle, Clock, Thermometer, Droplets,
  Gauge, Sun, Wind, ShieldAlert, Cpu, HardDrive,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { useMQTT } from "@/hooks/use-mqtt";

const statusConfig: Record<string, { icon: typeof Radio; color: string; label: string }> = {
  online: { icon: Radio, color: "bg-emerald-100 text-emerald-700", label: "在线" },
  offline: { icon: WifiOff, color: "bg-slate-100 text-slate-500", label: "离线" },
  warning: { icon: AlertTriangle, color: "bg-amber-100 text-amber-700", label: "告警" },
  error: { icon: WifiOff, color: "bg-red-100 text-red-700", label: "异常" },
};

const metricIcons: Record<string, typeof Thermometer> = {
  temperature: Thermometer, humidity: Droplets, pressure: Gauge,
  illuminance: Sun, wind_speed: Wind, smoke_level: ShieldAlert,
  cpu_usage: Cpu, memory_usage: HardDrive,
};

interface Device {
  id: string; name: string; type: string; status: string;
  protocol: string; ipAddress?: string; macAddress?: string;
  firmware?: string; location?: string; properties: string;
  lastSeenAt?: string; group?: { name: string; color: string } | null;
}

interface TelemetryItem {
  id: string; key: string; value: number; unit?: string; timestamp: string;
}

interface CommandItem {
  id: string; command: string; status: string;
  createdAt: string; executedAt?: string;
}

interface DeviceDetailProps { deviceId: string; onBack: () => void; }

export function DeviceDetail({ deviceId, onBack }: DeviceDetailProps) {
  const queryClient = useQueryClient();
  const { latestTelemetry, onTelemetry, sendCommand } = useMQTT();
  const [realtimeValues, setRealtimeValues] = useState<Record<string, number>>({});
  const [commandInput, setCommandInput] = useState("");
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);

  const deviceUrl = "/api/devices/" + deviceId;
  const telemetryUrl = "/api/devices/" + deviceId + "/telemetry?hours=6&limit=200";
  const commandsUrl = "/api/devices/" + deviceId + "/commands";

  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ["device", deviceId] as const,
    queryFn: () => fetch(deviceUrl).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: telemetryData } = useQuery({
    queryKey: ["telemetry", deviceId],
    queryFn: () => fetch(telemetryUrl).then((r) => r.json()),
  });

  const { data: commands } = useQuery({
    queryKey: ["commands", deviceId] as const,
    queryFn: () => fetch(commandsUrl).then((r) => r.json()),
  });

  useEffect(() => {
    if (!device) return;
    const unsub = onTelemetry((data) => {
      if (data.device === device.name) {
        setRealtimeValues((prev) => ({ ...prev, [data.key]: data.value }));
      }
    });
    return unsub;
  }, [device, onTelemetry]);

  const handleSendCommand = async () => {
    if (!commandInput.trim() || !device) return;
    sendCommand(device.name, commandInput);
    setCommandInput("");
    setCommandDialogOpen(false);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["commands", deviceId] });
    }, 2000);
  };

  if (deviceLoading || !device) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        加载设备详情...
      </div>
    );
  }

  const cfg = statusConfig[device.status] || statusConfig.offline;
  const StatusIcon = cfg.icon;
  const props = JSON.parse(device.properties || "{}");
  const metricKeys = telemetryData?.metricKeys || [];
  const latestValues = telemetryData?.latestValues || [];

  const displayValues: Record<string, { value: number; unit: string }> = {};
  for (const lv of latestValues) {
    const mk = metricKeys.find((m: { key: string }) => m.key === lv.key);
    displayValues[lv.key] = {
      value: realtimeValues[lv.key] ?? lv._max.value ?? 0,
      unit: mk?.unit || "",
    };
  }

  const chartData: Record<string, unknown[]> = {};
  if (telemetryData?.telemetry) {
    for (const point of telemetryData.telemetry as TelemetryItem[]) {
      const timeKey = new Date(point.timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit",
      });
      if (!chartData[point.key]) chartData[point.key] = [];
      chartData[point.key].push({ time: timeKey, value: point.value });
    }
  }

  const commandStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{device.name}</h2>
            <Badge variant="secondary" className={cfg.color + " border-0"}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {cfg.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{device.description || device.type}</p>
        </div>
        <Dialog open={commandDialogOpen} onOpenChange={setCommandDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> 发送指令
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{"发送指令到 " + device.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="输入指令名称，如: reboot, getStatus, setConfig"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendCommand()}
              />
              <div className="flex gap-2">
                {["reboot", "getStatus", "getConfig"].map((cmd) => (
                  <Button key={cmd} variant="outline" size="sm"
                    onClick={() => setCommandInput(cmd)}>
                    {cmd}
                  </Button>
                ))}
              </div>
              <Button onClick={handleSendCommand} className="w-full">发送</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "协议", value: device.protocol },
          { label: "位置", value: device.location || "-" },
          { label: "固件", value: device.firmware || "-" },
          { label: "IP 地址", value: device.ipAddress || "-" },
          { label: "MAC 地址", value: device.macAddress || "-" },
          { label: "分组", value: device.group?.name || "-" },
          { label: "最后上线", value: device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString("zh-CN") : "-" },
          { label: "设备ID", value: device.id.slice(0, 8) + "..." },
        ].map((item) => (
          <div key={item.label} className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="text-sm font-medium mt-0.5 truncate">{item.value}</div>
          </div>
        ))}
      </div>

      {Object.keys(displayValues).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(displayValues).map(([key, { value, unit }]) => {
            const Icon = metricIcons[key] || Gauge;
            return (
              <Card key={key} className="border-slate-200">
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{key}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{unit}</span>
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {typeof value === "number" ? value.toFixed(1) : value}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Tabs defaultValue="charts" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="charts">趋势图表</TabsTrigger>
          <TabsTrigger value="commands">指令记录</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-4 mt-4">
          {Object.keys(chartData).length === 0 ? (
            <Card className="border-slate-200">
              <CardContent className="py-12 text-center text-muted-foreground">
                暂无历史遥测数据
              </CardContent>
            </Card>
          ) : (
            Object.entries(chartData).map(([key, data]) => {
              const mk = (metricKeys as Array<{ key: string; unit: string }>).find(
                (m) => m.key === key
              );
              const Icon = metricIcons[key] || Gauge;
              return (
                <Card key={key} className="border-slate-200">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {key} {mk?.unit ? "(" + mk.unit + ")" : ""}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 px-4">
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }}
                            interval={Math.floor(data.length / 6)} />
                          <YAxis tick={{ fontSize: 10 }} width={50} />
                          <Tooltip contentStyle={{
                            fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0",
                          }} />
                          <Line type="monotone" dataKey="value" stroke="#0ea5e9"
                            strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="commands" className="mt-4">
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              {!commands || (commands as CommandItem[]).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">暂无指令记录</div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(commands as CommandItem[]).map((cmd) => (
                    <div key={cmd.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      {commandStatusIcon(cmd.status)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{cmd.command}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(cmd.createdAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                      <Badge
                        variant={cmd.status === "success" ? "default" : cmd.status === "failed" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {cmd.status === "success" ? "成功" : cmd.status === "failed" ? "失败" : "执行中"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
