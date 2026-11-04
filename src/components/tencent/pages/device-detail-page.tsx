"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Cpu, Wifi, MapPin, Calendar, RefreshCw, Send } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const statusMap: Record<string, { label: string; color: string }> = {
  online: { label: "在线", color: "text-[#2BA471]" },
  offline: { label: "离线", color: "text-[#BBBFC4]" },
  warning: { label: "告警", color: "text-[#E34D59]" },
  error: { label: "异常", color: "text-[#E34D59]" },
};

const protocolBadge: Record<string, string> = {
  MQTT: "tc-badge-mqtt",
  CoAP: "tc-badge-coap",
  HTTP: "tc-badge-http",
  WebSocket: "tc-badge-ws",
};

export function DeviceDetailPage() {
  const { selectedDeviceId, setCurrentPage } = useAppStore();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");

  const { data: device, isLoading, refetch } = useQuery({
    queryKey: ["device", selectedDeviceId],
    queryFn: () =>
      fetch(`/api/devices/${selectedDeviceId}`).then((r) => r.json()),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const { data: telemetry } = useQuery({
    queryKey: ["telemetry", selectedDeviceId],
    queryFn: () =>
      fetch(`/api/devices/${selectedDeviceId}/telemetry?limit=20`).then((r) =>
        r.json()
      ),
    enabled: !!selectedDeviceId,
    refetchInterval: 10000,
  });

  const { data: commands } = useQuery({
    queryKey: ["commands", selectedDeviceId],
    queryFn: () =>
      fetch(`/api/devices/${selectedDeviceId}/commands?limit=10`).then((r) =>
        r.json()
      ),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center animate-pulse">
        <div className="text-[13px] text-[#BBBFC4]">加载中...</div>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center">
        <div className="text-[13px] text-[#BBBFC4]">设备不存在</div>
        <Button
          variant="link"
          className="text-[13px] text-[#0052D9] mt-2"
          onClick={() => setCurrentPage("device-list")}
        >
          返回设备列表
        </Button>
      </div>
    );
  }

  const st = statusMap[device.status] || statusMap.offline;
  const telemetryList = telemetry?.telemetry || [];
  const commandList = commands?.commands || [];

  return (
    <div className="space-y-4">
      {/* Back & Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCurrentPage("device-list")}
          className="flex items-center gap-1 text-[13px] text-[#888] hover:text-[#0052D9] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
      </div>

      {/* Device Info Card */}
      <div className="bg-white rounded border border-[#E5E6EB] p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#E6F0FF] flex items-center justify-center">
              <Cpu className="w-6 h-6 text-[#0052D9]" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-[20px] font-semibold text-[#333]">{device.name}</h2>
                <span className={cn("flex items-center gap-1.5 text-[13px]", st.color)}>
                  <span className={cn("tc-status-dot",
                    device.status === "online" ? "tc-status-online" : device.status === "offline" ? "tc-status-offline" : "tc-status-inactive"
                  )} />
                  {st.label}
                </span>
              </div>
              <p className="text-[13px] text-[#888] mt-0.5">{device.description || "无描述"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => refetch()}
              variant="outline"
              size="sm"
              className="h-8 text-[13px] gap-1.5 border-[#E5E6EB]"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 刷新
            </Button>
            <Button
              onClick={() => setCmdOpen(true)}
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> 下发指令
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-[#E5E6EB]">
          <div className="flex items-center gap-2 text-[13px]">
            <Wifi className="w-4 h-4 text-[#BBBFC4]" />
            <span className="text-[#888]">协议：</span>
            <span className={cn("tc-badge", protocolBadge[device.protocol] || "tc-badge-mqtt")}>{device.protocol}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Cpu className="w-4 h-4 text-[#BBBFC4]" />
            <span className="text-[#888]">类型：</span>
            <span className="text-[#333]">{device.type}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <MapPin className="w-4 h-4 text-[#BBBFC4]" />
            <span className="text-[#888]">位置：</span>
            <span className="text-[#333]">{device.location || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Calendar className="w-4 h-4 text-[#BBBFC4]" />
            <span className="text-[#888]">创建：</span>
            <span className="text-[#333]">
              {new Date(device.createdAt).toLocaleDateString("zh-CN")}
            </span>
          </div>
        </div>
      </div>

      {/* Telemetry & Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Telemetry */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">最新遥测数据</h3>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {telemetryList.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[#BBBFC4]">
                暂无遥测数据
              </div>
            ) : (
              telemetryList.map((t: { id: string; key: string; value: number; unit: string | null; timestamp: string }) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-5 py-2.5 border-b border-[#F0F0F0] last:border-0"
                >
                  <div>
                    <span className="text-[13px] text-[#333]">{t.key}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[14px] font-medium text-[#333]">{t.value}</span>
                    <span className="text-[12px] text-[#888] ml-1">{t.unit || ""}</span>
                    <div className="text-[11px] text-[#BBBFC4]">
                      {new Date(t.timestamp).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Commands */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">指令记录</h3>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {commandList.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[#BBBFC4]">
                暂无指令记录
              </div>
            ) : (
              commandList.map((c: { id: string; command: string; status: string; createdAt: string }) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-5 py-2.5 border-b border-[#F0F0F0] last:border-0"
                >
                  <div>
                    <code className="text-[12px] text-[#666] font-mono">{c.command}</code>
                  </div>
                  <div className="text-right">
                    <span className={cn("tc-badge",
                      c.status === "success" ? "bg-[#E8F8F0] text-[#2BA471]" :
                      c.status === "failed" ? "bg-[#FDECEE] text-[#E34D59]" :
                      "bg-[#FFF3E8] text-[#ED7B2F]"
                    )}>
                      {c.status === "success" ? "成功" : c.status === "failed" ? "失败" : "发送中"}
                    </span>
                    <div className="text-[11px] text-[#BBBFC4] mt-1">
                      {new Date(c.createdAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Send Command Dialog */}
      <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">下发指令</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="block text-[13px] text-[#666] mb-1.5">指令内容</label>
            <Input
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              placeholder='如：{"rpt_int": 30}'
              className="h-8 text-[13px] font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCmdOpen(false)} className="h-8 text-[13px]">
              取消
            </Button>
            <Button className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]">
              发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
