"use client";

import { useAppStore } from "@/stores/app-store";
import {
  FolderOpen, Cpu, Monitor, Wifi,
} from "lucide-react";

const statCards = [
  { label: "项目总数", value: 3, Icon: FolderOpen, color: "text-[#0052D9]", bg: "bg-[#E6F0FF]" },
  { label: "产品总数", value: 10, Icon: Cpu, color: "text-[#2BA471]", bg: "bg-[#E8F8F0]" },
  { label: "设备总数", value: 218, Icon: Monitor, color: "text-[#ED7B2F]", bg: "bg-[#FFF3E8]" },
  { label: "在线设备", value: 133, Icon: Wifi, color: "text-[#7B61FF]", bg: "bg-[#F0EDFF]" },
];

const activityLog = [
  { time: "10:32", type: "设备上线", device: "网关设备-GW01", status: "success" },
  { time: "10:28", type: "属性上报", device: "卧室温控器-02", status: "info" },
  { time: "10:25", type: "设备上线", device: "智能门锁-DL03", status: "success" },
  { time: "10:18", type: "告警触发", device: "烟感探测器-SM02", status: "warning" },
  { time: "10:15", type: "固件升级", device: "温湿度传感器-TH05", status: "info" },
  { time: "10:10", type: "设备离线", device: "摄像头-CAM01", status: "error" },
  { time: "09:58", type: "属性上报", device: "空调控制器-AC01", status: "info" },
  { time: "09:45", type: "设备上线", device: "智能灯控-LC02", status: "success" },
];

const quickEntries = [
  { label: "新建产品", Icon: Cpu, color: "text-[#0052D9]", bg: "bg-[#E6F0FF]" },
  { label: "注册设备", Icon: Monitor, color: "text-[#2BA471]", bg: "bg-[#E8F8F0]" },
  { label: "固件升级", Icon: FolderOpen, color: "text-[#ED7B2F]", bg: "bg-[#FFF3E8]" },
  { label: "数据监控", Icon: Wifi, color: "text-[#7B61FF]", bg: "bg-[#F0EDFF]" },
  { label: "设备日志", Icon: FolderOpen, color: "text-[#00A870]", bg: "bg-[#E8F8F0]" },
  { label: "API Explorer", Icon: Cpu, color: "text-[#E34D59]", bg: "bg-[#FDECEE]" },
];

const statusIconColor: Record<string, string> = {
  success: "bg-[#2BA471]",
  info: "bg-[#0052D9]",
  warning: "bg-[#ED7B2F]",
  error: "bg-[#BBBFC4]",
};

export function OverviewPage() {
  const { setCurrentPage } = useAppStore();

  return (
    <div className="space-y-5">
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded border border-[#E5E6EB] p-5 hover:shadow-md transition-all duration-200 cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] text-[#888] mb-2.5">{card.label}</div>
                <div className="text-[32px] font-semibold text-[#1E293B] leading-none tracking-tight">
                  {card.value}
                </div>
              </div>
              <div className={"w-11 h-11 rounded-lg flex items-center justify-center " + card.bg}>
                <card.Icon className={"w-5 h-5 " + card.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom: Device Activity + Quick Entries */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* Device Activity */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">设备动态</h3>
            <button className="text-[12px] text-[#0052D9] hover:underline">查看全部</button>
          </div>
          <div className="divide-y divide-[#F0F0F0]">
            {activityLog.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center px-5 py-3 hover:bg-[#F9FAFB] transition-colors"
              >
                <span className="text-[13px] text-[#999] w-12 flex-shrink-0 font-mono">
                  {item.time}
                </span>
                <span
                  className={"w-[6px] h-[6px] rounded-full mr-3 flex-shrink-0 " + (statusIconColor[item.status] || "bg-[#999]")}
                />
                <span className="text-[13px] text-[#333] font-medium">{item.type}</span>
                <span className="text-[13px] text-[#666] ml-2 truncate">{item.device}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Entries */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">快捷入口</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 p-4">
            {quickEntries.map((entry) => (
              <button
                key={entry.label}
                onClick={() => {
                  if (entry.label === "新建产品" || entry.label === "API Explorer") setCurrentPage("product-list");
                  else if (entry.label === "注册设备") setCurrentPage("device-list");
                  else if (entry.label === "设备日志") setCurrentPage("log-service");
                }}
                className="flex flex-col items-center gap-2.5 p-3 rounded hover:bg-[#F9FAFB] hover:shadow-sm transition-all duration-200 group"
              >
                <div className={"w-10 h-10 rounded-lg flex items-center justify-center " + entry.bg + " group-hover:scale-110 transition-transform"}>
                  <entry.Icon className={"w-5 h-5 " + entry.color} />
                </div>
                <span className="text-[12px] text-[#666] group-hover:text-[#333] transition-colors">
                  {entry.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
