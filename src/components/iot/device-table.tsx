"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, MoreHorizontal, Eye, Trash2, Radio, WifiOff, AlertTriangle } from "lucide-react";

interface Device {
  id: string;
  name: string;
  type: string;
  status: string;
  protocol: string;
  location?: string;
  lastSeenAt?: string;
  group?: { name: string; color: string } | null;
}

const statusConfig: Record<string, { icon: typeof Radio; color: string; label: string }> = {
  online: { icon: Radio, color: "bg-emerald-100 text-emerald-700", label: "在线" },
  offline: { icon: WifiOff, color: "bg-slate-100 text-slate-500", label: "离线" },
  warning: { icon: AlertTriangle, color: "bg-amber-100 text-amber-700", label: "告警" },
  error: { icon: WifiOff, color: "bg-red-100 text-red-700", label: "异常" },
};

const typeLabels: Record<string, string> = {
  sensor: "传感器",
  actuator: "执行器",
  gateway: "网关",
  camera: "摄像头",
};

interface DeviceTableProps {
  onSelectDevice: (device: Device) => void;
}

export function DeviceTable({ onSelectDevice }: DeviceTableProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["devices", search, typeFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      return fetch(`/api/devices?${params}`).then((r) => r.json());
    },
  });

  const devices: Device[] = data?.devices || [];
  const total = data?.pagination?.total || 0;

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除此设备？")) return;
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg">设备列表</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索设备..."
                className="pl-9 h-9 w-48"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-28">
                <SelectValue placeholder="类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="sensor">传感器</SelectItem>
                <SelectItem value="actuator">执行器</SelectItem>
                <SelectItem value="gateway">网关</SelectItem>
                <SelectItem value="camera">摄像头</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-28">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="online">在线</SelectItem>
                <SelectItem value="offline">离线</SelectItem>
                <SelectItem value="warning">告警</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            加载中...
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">没有找到设备</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>设备名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>协议</TableHead>
                  <TableHead className="hidden md:table-cell">位置</TableHead>
                  <TableHead className="hidden lg:table-cell">分组</TableHead>
                  <TableHead className="hidden lg:table-cell">最后上线</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device: Device) => {
                  const cfg = statusConfig[device.status] || statusConfig.offline;
                  const StatusIcon = cfg.icon;
                  return (
                    <TableRow
                      key={device.id}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => onSelectDevice(device)}
                    >
                      <TableCell>
                        <StatusIcon className={`h-4 w-4 ${cfg.color.split(" ")[1]}`} />
                      </TableCell>
                      <TableCell className="font-medium">{device.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {typeLabels[device.type] || device.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`${cfg.color} border-0 text-xs`}>
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.protocol}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {device.location || "-"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {device.group && (
                          <span className="text-xs" style={{ color: device.group.color }}>
                            {device.group.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {device.lastSeenAt
                          ? new Date(device.lastSeenAt).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectDevice(device); }}>
                              <Eye className="mr-2 h-4 w-4" /> 查看详情
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={(e) => { e.stopPropagation(); handleDelete(device.id); }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> 删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3 text-xs text-muted-foreground text-right">
          共 {total} 台设备
        </div>
      </CardContent>
    </Card>
  );
}
