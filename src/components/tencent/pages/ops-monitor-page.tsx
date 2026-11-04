"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, type OpsMetrics, type OpsLogItem } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity, Cpu, BellRing, Zap, RefreshCw, Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

type LogTab = "all" | "property" | "event" | "action" | "status";

const tabs: { key: LogTab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "property", label: "属性上报" },
  { key: "event", label: "事件" },
  { key: "action", label: "服务调用" },
  { key: "status", label: "上下线" },
];

const typeLabels: Record<string, string> = {
  property: "属性上报", event: "事件", action: "服务调用", status: "上下线",
};

const levelStyles: Record<string, string> = {
  info: "bg-[#E6F0FF] text-[#0052D9]",
  warn: "bg-[#FFF3E8] text-[#ED7B2F]",
  alert: "bg-[#FFF3E8] text-[#ED7B2F]",
  error: "bg-[#FDECEE] text-[#E34D59]",
  success: "bg-[#E8F8F0] text-[#00A870]",
  online: "bg-[#E8F8F0] text-[#00A870]",
  offline: "bg-[#F3F4F6] text-[#888]",
  pending: "bg-[#F3F4F6] text-[#888]",
};

const levelLabels: Record<string, string> = {
  info: "信息", warn: "告警", alert: "告警", error: "故障", success: "成功",
  online: "上线", offline: "下线", pending: "等待",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtHour(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

export function OpsMonitorPage() {
  const [tab, setTab] = useState<LogTab>("all");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const { data: metrics, isLoading: metricsLoading, isError: metricsError, refetch: refetchMetrics } =
    useQuery<OpsMetrics>({
      queryKey: ["ops-metrics"],
      queryFn: () => api.getOpsMetrics(),
      refetchInterval: 10_000,
    });

  const { data: logs, isLoading: logsLoading, isError: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ["ops-logs", tab, keyword, page],
    queryFn: () => api.getOpsLogs({ type: tab, keyword: keyword || undefined, page, page_size: 50 }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  const handleTab = (t: LogTab) => {
    setTab(t);
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setKeyword(v);
    setPage(1);
  };

  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / logs.page_size)) : 1;
  const items = logs?.items ?? [];
  const chartData = (metrics?.hourly_messages ?? []).map((h) => ({
    hour: fmtHour(h.hour),
    count: h.count,
  }));

  return (
    <div className="space-y-4">
      {/* 指标卡 */}
      {metricsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[112px] animate-pulse">
              <div className="h-3 w-20 rounded bg-[#F3F4F6] mb-4" />
              <div className="h-7 w-28 rounded bg-[#E5E6EB]" />
            </div>
          ))}
        </div>
      ) : metricsError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">运行指标加载失败</p>
          <Button onClick={() => refetchMetrics()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : metrics ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#888]">设备在线率</span>
              <Activity className="w-4 h-4 text-[#BBBFC4]" />
            </div>
            <div className="flex items-end gap-1 mb-3">
              <span className="text-[24px] font-semibold text-[#333] leading-none">
                {Math.round(metrics.online_rate * 100)}%
              </span>
              <span className="text-[12px] text-[#888] mb-0.5">{metrics.online}/{metrics.device_total} 在线</span>
            </div>
            <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div className="h-full bg-[#00A870] rounded-full transition-all duration-700" style={{ width: `${metrics.online_rate * 100}%` }} />
            </div>
          </div>
          <div className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#888]">今日消息数(属性上报)</span>
              <Cpu className="w-4 h-4 text-[#BBBFC4]" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-[24px] font-semibold text-[#333] leading-none">
                {metrics.messages_today.toLocaleString()}
              </span>
              <span className="text-[12px] text-[#888] mb-0.5">条</span>
            </div>
            <p className="text-[11px] text-[#999] mt-2">离线 {metrics.offline} · 未激活 {metrics.not_activated}</p>
          </div>
          <div className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#888]">今日事件 / 告警</span>
              <BellRing className="w-4 h-4 text-[#BBBFC4]" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-[24px] font-semibold text-[#333] leading-none">{metrics.events_today}</span>
              <span className={cn("text-[13px] mb-0.5 ml-1", metrics.alarms_today > 0 ? "text-[#ED7B2F] font-medium" : "text-[#888]")}>
                / {metrics.alarms_today} 告警
              </span>
            </div>
            <p className="text-[11px] text-[#999] mt-2">含 warn / error 级别事件</p>
          </div>
          <div className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-[#888]">今日服务调用</span>
              <Zap className="w-4 h-4 text-[#BBBFC4]" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-[24px] font-semibold text-[#333] leading-none">{metrics.actions_today}</span>
              <span className="text-[12px] text-[#888] mb-0.5">次</span>
            </div>
            <p className="text-[11px] text-[#999] mt-2">设备动作指令下发记录</p>
          </div>
        </div>
      ) : null}

      {/* 24h 消息趋势 */}
      <div className="bg-white rounded border border-[#E5E6EB] p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[14px] font-medium text-[#333]">近 24 小时消息趋势</span>
          <span className="text-[12px] text-[#888]">每小时属性上报条数 · 10s 自动刷新</span>
        </div>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0052D9" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#0052D9" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#999" }} interval={3} tickLine={false} axisLine={{ stroke: "#E5E6EB" }} />
              <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={50} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E6EB", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
                formatter={(v) => [`${v} 条`, "消息"]}
                labelFormatter={(l) => `${l} 时段`}
              />
              <Area type="monotone" dataKey="count" stroke="#0052D9" strokeWidth={1.5} fill="url(#msgGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 统一日志流 */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3 border-b border-[#E5E6EB] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTab(t.key)}
                className={cn(
                  "px-3 h-7 rounded text-[13px] transition-colors",
                  tab === t.key
                    ? "bg-[#0052D9] text-white"
                    : "text-[#666] hover:bg-[#F3F4F6]",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative w-[220px]">
            <Search className="w-3.5 h-3.5 text-[#999] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={keyword}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索设备 / 产品 / 内容"
              className="h-8 text-[13px] pl-8"
            />
          </div>
        </div>

        {logsError ? (
          <div className="py-12 text-center">
            <p className="text-[14px] text-[#E34D59] mb-3">日志加载失败</p>
            <Button onClick={() => refetchLogs()} variant="outline" className="h-8 text-[13px] gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> 重新加载
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tc-table">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>时间</th>
                    <th style={{ width: 90 }}>类型</th>
                    <th>设备</th>
                    <th style={{ width: 110 }}>产品</th>
                    <th style={{ width: 80 }}>状态</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  {logsLoading && items.length === 0 ? (
                    [...Array(10)].map((_, i) => (
                      <tr key={i}>
                        <td colSpan={6} className="py-2.5">
                          <div className="h-4 rounded bg-[#F3F4F6] animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-[13px] text-[#999]">
                        暂无匹配日志
                      </td>
                    </tr>
                  ) : items.map((l: OpsLogItem) => (
                    <tr key={l.id}>
                      <td className="text-[12px] text-[#888] font-mono">{fmtTime(l.time)}</td>
                      <td>
                        <span className="text-[12px] text-[#666]">{typeLabels[l.type] ?? l.type}</span>
                      </td>
                      <td className="text-[13px] text-[#333]">{l.device_name}</td>
                      <td className="text-[12px] text-[#888]">{l.product_name}</td>
                      <td>
                        <span className={cn("tc-badge", levelStyles[l.level] ?? levelStyles.info)}>
                          {levelLabels[l.level] ?? l.level}
                        </span>
                      </td>
                      <td className="text-[12px] text-[#666] font-mono max-w-[380px] truncate" title={l.summary}>
                        {l.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#E5E6EB]">
              <span className="text-[12px] text-[#888]">
                共 {logs?.total.toLocaleString() ?? "-"} 条 · 第 {page}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || logsLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 text-[12px] gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> 上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || logsLoading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 text-[12px] gap-1"
                >
                  下一页 <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
