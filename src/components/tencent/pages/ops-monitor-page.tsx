"use client";

import { Activity, Cpu, HardDrive, Wifi, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const systemMetrics = [
  { label: "CPU使用率", value: 23, unit: "%", max: 100, color: "bg-[#0052D9]", icon: Cpu },
  { label: "内存使用", value: 67, unit: "%", max: 100, color: "bg-[#7B61FF]", icon: HardDrive },
  { label: "网络带宽", value: 45, unit: "%", max: 100, color: "bg-[#2BA471]", icon: Wifi },
  { label: "API调用量/min", value: 1280, unit: "/min", max: 5000, color: "bg-[#ED7B2F]", icon: Activity },
];

const recentEvents = [
  { time: "11:09:30", type: "设备上线", device: "TH-SENSOR-001/dev005", status: "success" },
  { time: "11:08:58", type: "告警触发", device: "SMOKE-001/dev012", status: "warning" },
  { time: "11:08:30", type: "设备重连", device: "TH-SENSOR-001/dev008", status: "warning" },
  { time: "11:07:58", type: "设备离线", device: "SMOKE-001/dev015", status: "error" },
  { time: "11:05:20", type: "规则执行", device: "系统", status: "success" },
  { time: "11:02:15", type: "设备上线", device: "LOCK-001/dev003", status: "success" },
  { time: "10:58:40", type: "API限流", device: "系统", status: "warning" },
  { time: "10:55:10", type: "固件升级", device: "GW-V2-001/gw001", status: "success" },
];

const statusStyle: Record<string, string> = {
  success: "bg-[#E8F8F0] text-[#2BA471]",
  warning: "bg-[#FFF3E8] text-[#ED7B2F]",
  error: "bg-[#FDECEE] text-[#E34D59]",
};

export function OpsMonitorPage() {
  return (
    <div className="space-y-5">
      {/* System Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {systemMetrics.map((m) => (
          <div key={m.label} className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#888]">{m.label}</span>
              <m.icon className="w-4 h-4 text-[#BBBFC4]" />
            </div>
            <div className="flex items-end gap-1 mb-3">
              <span className="text-[24px] font-semibold text-[#333] leading-none">{m.value.toLocaleString()}</span>
              <span className="text-[12px] text-[#888] mb-0.5">{m.unit}</span>
            </div>
            <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-700", m.color)}
                style={{ width: `${Math.min(100, (m.value / m.max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* API Metrics */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">API 调用统计</h3>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-[20px] font-semibold text-[#2BA471]">128,450</div>
                <div className="text-[12px] text-[#888] mt-0.5">今日调用</div>
              </div>
              <div className="text-center">
                <div className="text-[20px] font-semibold text-[#ED7B2F]">23</div>
                <div className="text-[12px] text-[#888] mt-0.5">错误次数</div>
              </div>
              <div className="text-center">
                <div className="text-[20px] font-semibold text-[#333]">45ms</div>
                <div className="text-[12px] text-[#888] mt-0.5">平均响应</div>
              </div>
            </div>
            <div className="h-[140px] bg-[#F9FAFB] rounded border border-dashed border-[#E5E6EB] flex items-center justify-center">
              <span className="text-[12px] text-[#BBBFC4]">API调用趋势图</span>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">系统事件</h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {recentEvents.map((evt, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-2.5 border-b border-[#F0F0F0] last:border-0 hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn("tc-badge", statusStyle[evt.status])}>{evt.type}</span>
                  <span className="text-[12px] font-mono text-[#666] truncate">{evt.device}</span>
                </div>
                <span className="text-[11px] text-[#BBBFC4] flex-shrink-0 ml-2 font-mono">{evt.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
