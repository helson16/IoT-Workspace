"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Cpu, Wifi, Calendar, RefreshCw, Send, Layers } from "lucide-react";
import { api, type ShadowDocument, type TelemetryPoint } from "@/lib/api/client";
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
  "not-activated": { label: "未激活", color: "text-[#E34D59]" },
  disabled: { label: "已禁用", color: "text-[#E34D59]" },
};

const protocolBadge: Record<string, string> = {
  MQTT: "tc-badge-mqtt",
  CoAP: "tc-badge-coap",
  HTTP: "tc-badge-http",
  WebSocket: "tc-badge-ws",
};

const nodeTypeLabel: Record<string, string> = {
  device: "直连设备",
  gateway: "网关设备",
  "sub-device": "子设备",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function DeviceDetailPage() {
  const { selectedDeviceId, setCurrentPage } = useAppStore();
  const queryClient = useQueryClient();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdMsg, setCmdMsg] = useState("");

  const { data: device, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["device", selectedDeviceId],
    queryFn: () => api.getDevice(selectedDeviceId!),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const { data: telemetry } = useQuery<TelemetryPoint[]>({
    queryKey: ["telemetry", selectedDeviceId],
    queryFn: () => api.getTelemetry(selectedDeviceId!, 20),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const { data: shadow, refetch: refetchShadow } = useQuery<ShadowDocument>({
    queryKey: ["shadow", selectedDeviceId],
    queryFn: () => api.getShadow(selectedDeviceId!),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const desiredMutation = useMutation({
    mutationFn: (desired: Record<string, unknown>) =>
      api.updateShadowDesired(selectedDeviceId!, desired, shadow?.version ?? 0),
    onSuccess: () => {
      setCmdMsg("✓ 期望状态已下发, 等待设备同步");
      queryClient.invalidateQueries({ queryKey: ["shadow", selectedDeviceId] });
      setTimeout(() => { setCmdMsg(""); setCmdOpen(false); setCmdInput(""); }, 1500);
    },
    onError: (e: Error) => setCmdMsg("✗ 下发失败: " + e.message),
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center animate-pulse">
        <div className="text-[13px] text-[#BBBFC4]">加载中...</div>
      </div>
    );
  }

  if (isError || !device) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center">
        <div className="text-[13px] text-[#BBBFC4] mb-1">
          {isError ? `设备加载失败: ${(error as Error)?.message}` : "设备不存在"}
        </div>
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
  const telemetryList = telemetry ?? [];
  const reported = shadow?.state?.reported ?? {};
  const desiredState = shadow?.state?.desired ?? {};
  const delta = shadow?.state?.delta ?? {};

  const sendCommand = () => {
    try {
      const parsed = JSON.parse(cmdInput);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setCmdMsg("✗ 请输入 JSON 对象, 如: {\"target_temperature\": 20}");
        return;
      }
      desiredMutation.mutate(parsed);
    } catch {
      setCmdMsg("✗ JSON 格式错误, 如: {\"target_temperature\": 20}");
    }
  };

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
                <h2 className="text-[20px] font-semibold text-[#333]">{device.deviceName}</h2>
                <span className={cn("flex items-center gap-1.5 text-[13px]", st.color)}>
                  <span className={cn("tc-status-dot",
                    device.status === "online" ? "tc-status-online" : device.status === "offline" ? "tc-status-offline" : "tc-status-inactive"
                  )} />
                  {st.label}
                </span>
              </div>
              <p className="text-[13px] text-[#888] mt-0.5">
                {device.description || `${device.productName} · ${device.deviceId.slice(0, 16)}...`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => { refetch(); refetchShadow(); }}
              variant="outline"
              size="sm"
              className="h-8 text-[13px] gap-1.5 border-[#E5E6EB]"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 刷新
            </Button>
            <Button
              onClick={() => { setCmdOpen(true); setCmdMsg(""); }}
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
            <span className="text-[#333]">{nodeTypeLabel[device.nodeType] ?? device.nodeType}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Layers className="w-4 h-4 text-[#BBBFC4]" />
            <span className="text-[#888]">产品：</span>
            <span className="text-[#333]">{device.productName}</span>
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

      {/* Shadow + Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Shadow State */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[#333]">设备影子</h3>
            <span className="text-[12px] text-[#BBBFC4]">version {shadow?.version ?? 0}</span>
          </div>
          <div className="p-4 space-y-4 max-h-[360px] overflow-y-auto">
            <div>
              <div className="text-[12px] text-[#888] mb-2">reported (设备上报)</div>
              {Object.keys(reported).length === 0 ? (
                <div className="text-[12px] text-[#BBBFC4] py-2">暂无数据</div>
              ) : (
                <div className="bg-[#E8F8F0]/40 rounded border border-[#D4EDE2] divide-y divide-[#D4EDE2]">
                  {Object.entries(reported).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5">
                      <code className="text-[12px] text-[#666]">{k}</code>
                      <span className="text-[13px] font-medium text-[#333]">{formatValue(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[12px] text-[#888] mb-2">desired (期望下发)</div>
              {Object.keys(desiredState).length === 0 ? (
                <div className="text-[12px] text-[#BBBFC4] py-2">暂无期望值</div>
              ) : (
                <div className="bg-[#E6F0FF]/40 rounded border border-[#C5DDF7] divide-y divide-[#C5DDF7]">
                  {Object.entries(desiredState).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5">
                      <code className="text-[12px] text-[#666]">{k}</code>
                      <span className="text-[13px] font-medium text-[#333]">{formatValue(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {Object.keys(delta).length > 0 && (
              <div>
                <div className="text-[12px] text-[#888] mb-2">delta (待同步差异)</div>
                <div className="bg-[#FFF3E8]/50 rounded border border-[#F5D5BC] divide-y divide-[#F5D5BC]">
                  {Object.entries(delta).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5">
                      <code className="text-[12px] text-[#666]">{k}</code>
                      <span className="text-[13px] font-medium text-[#333]">{formatValue(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Telemetry */}
        <div className="bg-white rounded border border-[#E5E6EB] lg:col-span-2">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[#333]">最新遥测数据</h3>
            <span className="text-[12px] text-[#BBBFC4]">5s 自动刷新</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {telemetryList.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[#BBBFC4]">
                暂无遥测数据, 等待设备上报...
              </div>
            ) : (
              telemetryList.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-5 py-2.5 border-b border-[#F0F0F0] last:border-0"
                >
                  <div>
                    <span className="text-[13px] text-[#333] font-mono">{t.identifier}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[14px] font-medium text-[#333]">{formatValue(t.value)}</span>
                    <div className="text-[11px] text-[#BBBFC4]">
                      {new Date(t.timestamp).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Send Command Dialog (shadow desired 下发) */}
      <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">下发指令 (影子期望状态)</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="block text-[13px] text-[#666] mb-1.5">
              期望属性 (JSON 对象, 将写入设备影子 desired)
            </label>
            <Input
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              placeholder='如：{"target_temperature": 20, "power_switch": 1}'
              className="h-8 text-[13px] font-mono"
              onKeyDown={(e) => e.key === "Enter" && sendCommand()}
            />
            {cmdMsg && (
              <div className={cn(
                "text-[12px] mt-2 rounded px-3 py-2",
                cmdMsg.startsWith("✓") ? "text-[#2BA471] bg-[#E8F8F0]" : "text-[#E34D59] bg-[#FDECEE]"
              )}>
                {cmdMsg}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCmdOpen(false)} className="h-8 text-[13px]">
              取消
            </Button>
            <Button
              onClick={sendCommand}
              disabled={desiredMutation.isPending}
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
            >
              {desiredMutation.isPending ? "下发中..." : "发送"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
