"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type ActivityItem, type OverviewStats } from "@/lib/api/client";
import { useAppStore } from "@/stores/app-store";
import {
  FolderOpen, Cpu, Monitor, Wifi, RefreshCw, FileCode2, MessageSquare,
} from "lucide-react";

const activityStatusColor: Record<string, string> = {
  success: "bg-[#2BA471]",
  info: "bg-[#0052D9]",
  warning: "bg-[#ED7B2F]",
  error: "bg-[#BBBFC4]",
};

function StatCard({ label, value, Icon, color, bg, loading }: {
  label: string; value: number | undefined; Icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string; loading: boolean;
}) {
  return (
    <div className="bg-white rounded border border-[#E5E6EB] p-5 hover:shadow-md transition-all duration-200 cursor-pointer">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] text-[#888] mb-2.5">{label}</div>
          <div className="text-[32px] font-semibold text-[#1E293B] leading-none tracking-tight">
            {loading ? <span className="inline-block w-10 h-8 bg-[#F3F4F6] rounded animate-pulse align-middle" /> : (value ?? 0)}
          </div>
        </div>
        <div className={"w-11 h-11 rounded-lg flex items-center justify-center " + bg}>
          <Icon className={"w-5 h-5 " + color} />
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const time = new Date(item.time);
  const timeStr = isNaN(time.getTime())
    ? item.time
    : time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="flex items-center px-5 py-3 hover:bg-[#F9FAFB] transition-colors">
      <span className="text-[13px] text-[#999] w-12 flex-shrink-0 font-mono">{timeStr}</span>
      <span className={"w-[6px] h-[6px] rounded-full mr-3 flex-shrink-0 " + (activityStatusColor[item.status] || "bg-[#999]")} />
      <span className="text-[13px] text-[#333] font-medium">{item.type}</span>
      <span className="text-[13px] text-[#666] ml-2 truncate">{item.device_name}</span>
    </div>
  );
}

const quickEntries = [
  { label: "新建产品", Icon: Cpu, color: "text-[#0052D9]", bg: "bg-[#E6F0FF]", target: "product-list" },
  { label: "注册设备", Icon: Monitor, color: "text-[#2BA471]", bg: "bg-[#E8F8F0]", target: "device-list" },
  { label: "物模型定义", Icon: FileCode2, color: "text-[#ED7B2F]", bg: "bg-[#FFF3E8]", target: "product-define" },
  { label: "数据监控", Icon: Wifi, color: "text-[#7B61FF]", bg: "bg-[#F0EDFF]", target: "ops-monitor" },
  { label: "消息通信", Icon: MessageSquare, color: "text-[#00A870]", bg: "bg-[#E8F8F0]", target: "message-queue" },
  { label: "API Explorer", Icon: Cpu, color: "text-[#E34D59]", bg: "bg-[#FDECEE]", target: "cloud-dev" },
] as const;

export function OverviewPage() {
  const { setCurrentPage } = useAppStore();

  const { data: stats, isLoading, isError, error, refetch } = useQuery<OverviewStats>({
    queryKey: ["overview"],
    queryFn: () => api.getOverview(10),
    refetchInterval: 10_000,
  });

  const statCards = [
    { label: "项目总数", value: stats?.project_count, Icon: FolderOpen, color: "text-[#0052D9]", bg: "bg-[#E6F0FF]" },
    { label: "产品总数", value: stats?.product_count, Icon: Cpu, color: "text-[#2BA471]", bg: "bg-[#E8F8F0]" },
    { label: "设备总数", value: stats?.device_count, Icon: Monitor, color: "text-[#ED7B2F]", bg: "bg-[#FFF3E8]" },
    { label: "在线设备", value: stats?.online_count, Icon: Wifi, color: "text-[#7B61FF]", bg: "bg-[#F0EDFF]" },
  ];

  return (
    <div className="space-y-5">
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} loading={isLoading} />
        ))}
      </div>

      {/* Bottom: Device Activity + Quick Entries */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* Device Activity */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">设备动态</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => refetch()}
                className="text-[12px] text-[#888] hover:text-[#0052D9] flex items-center gap-1"
                title="刷新"
              >
                <RefreshCw className={"w-3.5 h-3.5 " + (isLoading ? "animate-spin" : "")} />
              </button>
              <span className="text-[12px] text-[#BBBFC4]">10s 自动刷新</span>
            </div>
          </div>
          <div className="divide-y divide-[#F0F0F0]">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center px-5 py-3">
                  <div className="w-10 h-4 bg-[#F3F4F6] rounded animate-pulse" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E5E6EB] mx-3" />
                  <div className="w-20 h-4 bg-[#F3F4F6] rounded animate-pulse" />
                  <div className="w-32 h-4 bg-[#F3F4F6] rounded animate-pulse ml-2" />
                </div>
              ))
            ) : isError ? (
              <div className="py-10 text-center">
                <div className="text-[13px] text-[#E34D59] mb-2">数据加载失败: {(error as Error).message}</div>
                <button onClick={() => refetch()} className="text-[13px] text-[#0052D9] hover:underline">
                  重新加载
                </button>
              </div>
            ) : !stats || stats.recent_activity.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[#BBBFC4]">暂无设备动态</div>
            ) : (
              stats.recent_activity.map((item, idx) => <ActivityRow key={idx} item={item} />)
            )}
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
                onClick={() => setCurrentPage(entry.target)}
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
