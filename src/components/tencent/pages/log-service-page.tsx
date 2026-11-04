"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { api, type AvStats, type AvEventItem, type AvEventQuery, type AvTrendData } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Video, Camera, Play, HardDrive, Clock, CheckCircle, RefreshCw, Search,
  ChevronLeft, ChevronRight, PieChart as PieChartIcon,
} from "lucide-react";

type TypeFilter = NonNullable<AvEventQuery["event_type"]>;
type StatusFilter = NonNullable<AvEventQuery["status"]>;

const typeLabels: Record<string, string> = {
  recording: "录制", snapshot: "截图", playback: "回放",
};

const typeStyles: Record<string, string> = {
  recording: "bg-[#E6F0FF] text-[#0052D9]",
  snapshot: "bg-[#E0F7F4] text-[#008C7A]",
  playback: "bg-[#EEE9FF] text-[#7B61FF]",
};

const statusStyles: Record<string, string> = {
  success: "bg-[#E8F8F0] text-[#00A870]",
  failed: "bg-[#FDECEE] text-[#E34D59]",
};

const statusLabels: Record<string, string> = { success: "成功", failed: "失败" };

// ---------------- 图表 ----------------

const tooltipStyle = {
  border: "1px solid #E5E6EB",
  borderRadius: 4,
  fontSize: 12,
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
};

const seriesMeta = [
  { key: "recording", name: "录制", color: "#0052D9" },
  { key: "snapshot", name: "截图", color: "#00A870" },
  { key: "playback", name: "回放", color: "#7B61FF" },
] as const;

function TrendChart({ data }: { data?: AvTrendData }) {
  const buckets = data?.buckets ?? [];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={buckets} margin={{ top: 5, right: 10, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
        <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#999" }} interval={3} tickLine={false} axisLine={{ stroke: "#E5E6EB" }} />
        <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} 次`, String(name)]} />
        <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 12, color: "#666" }}>{String(v)}</span>} />
        {seriesMeta.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stackId="1"
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.18}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function TypePie({ stats }: { stats?: AvStats }) {
  const data = stats
    ? [
        { name: "录制", value: stats.today_recording },
        { name: "截图", value: stats.today_snapshot },
        { name: "回放", value: stats.today_playback },
      ]
    : [];
  const total = data.reduce((a, b) => a + b.value, 0);
  if (total === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <PieChartIcon className="w-8 h-8 text-[#E5E6EB] mx-auto mb-2" />
          <p className="text-[12px] text-[#BBBFC4]">今日暂无事件</p>
        </div>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={68}
          paddingAngle={2}
          isAnimationActive={false}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={seriesMeta[i].color} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} 次`, String(name)]} />
        <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 12, color: "#666" }}>{String(v)}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function StatCard({
  label, value, sub, icon: Icon,
}: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white rounded border border-[#E5E6EB] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-[#888]">{label}</span>
        <Icon className="w-4 h-4 text-[#BBBFC4]" />
      </div>
      <div className="text-[22px] font-semibold text-[#333] leading-none">{value}</div>
      {sub ? <p className="text-[11px] text-[#999] mt-1.5">{sub}</p> : null}
    </div>
  );
}

export function LogServicePage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } =
    useQuery<AvStats>({
      queryKey: ["av-stats"],
      queryFn: () => api.getAvStats(),
      refetchInterval: 10_000,
    });

  const { data: trend, isLoading: trendLoading, isError: trendError, refetch: refetchTrend } =
    useQuery<AvTrendData>({
      queryKey: ["av-trend"],
      queryFn: () => api.getAvTrend(24),
      refetchInterval: 10_000,
    });

  const { data: events, isLoading: eventsLoading, isError: eventsError, refetch: refetchEvents } =
    useQuery({
      queryKey: ["av-events", typeFilter, statusFilter, search, page],
      queryFn: () =>
        api.getAvEvents({
          event_type: typeFilter,
          status: statusFilter,
          keyword: search || undefined,
          page,
          page_size: 20,
        }),
      placeholderData: keepPreviousData,
      refetchInterval: 10_000,
    });

  const handleFilter = () => setPage(1);
  const totalPages = events ? Math.max(1, Math.ceil(events.total / events.page_size)) : 1;
  const items: AvEventItem[] = events?.items ?? [];

  return (
    <div className="space-y-4">
      {/* 统计卡 */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-4 h-[92px] animate-pulse">
              <div className="h-3 w-16 rounded bg-[#F3F4F6] mb-3" />
              <div className="h-6 w-20 rounded bg-[#E5E6EB]" />
            </div>
          ))}
        </div>
      ) : statsError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">音视频统计加载失败</p>
          <Button onClick={() => refetchStats()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="今日录制" value={String(stats.today_recording)} sub="次" icon={Video} />
          <StatCard label="今日截图" value={String(stats.today_snapshot)} sub="次" icon={Camera} />
          <StatCard label="今日回放" value={String(stats.today_playback)} sub="次" icon={Play} />
          <StatCard label="云存空间" value={fmtSize(stats.storage_bytes)} sub={`累计 ${stats.total_events} 条事件`} icon={HardDrive} />
          <StatCard label="今日回放时长" value={fmtDuration(stats.today_duration_sec)} sub={`活跃设备 ${stats.device_count} 台`} icon={Clock} />
          <StatCard
            label="事件成功率"
            value={stats.success_rate === null ? "—" : `${(stats.success_rate * 100).toFixed(1)}%`}
            sub={`今日 ${stats.today_events} 条`}
            icon={CheckCircle}
          />
        </div>
      ) : null}

      {/* 图表行: 24h 趋势 + 今日类型分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded border border-[#E5E6EB] p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-[#333]">24 小时事件趋势</span>
            <span className="text-[11px] text-[#999]">按小时统计(UTC)</span>
          </div>
          <div className="h-[220px]">
            {trendError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <p className="text-[13px] text-[#E34D59]">趋势数据加载失败</p>
                <Button onClick={() => refetchTrend()} variant="outline" className="h-8 text-[13px] gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> 重新加载
                </Button>
              </div>
            ) : trendLoading ? (
              <div className="h-full w-full animate-pulse rounded bg-[#F3F4F6]" />
            ) : (
              <TrendChart data={trend} />
            )}
          </div>
        </div>
        <div className="bg-white rounded border border-[#E5E6EB] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-[#333]">今日类型分布</span>
            <span className="text-[11px] text-[#999]">共 {stats?.today_events ?? 0} 次</span>
          </div>
          <div className="h-[220px]">
            {statsLoading ? (
              <div className="h-full w-full animate-pulse rounded bg-[#F3F4F6]" />
            ) : (
              <TypePie stats={stats} />
            )}
          </div>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="bg-white rounded border border-[#E5E6EB] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BBBFC4]" />
            <input
              type="text"
              placeholder="搜索设备名称、文件名..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); handleFilter(); }}
              className="w-full h-8 pl-8 pr-3 rounded border border-[#E5E6EB] text-[13px] text-[#333] placeholder:text-[#BBBFC4] outline-none focus:border-[#0052D9] transition-colors bg-[#F7F8FA]"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as TypeFilter); handleFilter(); }}>
            <SelectTrigger className="w-[110px] h-8 text-[13px]">
              <SelectValue placeholder="事件类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="recording">录制</SelectItem>
              <SelectItem value="snapshot">截图</SelectItem>
              <SelectItem value="playback">回放</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); handleFilter(); }}>
            <SelectTrigger className="w-[110px] h-8 text-[13px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-8 text-[13px] gap-1.5 border-[#E5E6EB]" onClick={() => refetchEvents()}>
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </Button>
        </div>
      </div>

      {/* 事件列表 */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        {eventsError ? (
          <div className="p-8 text-center">
            <p className="text-[14px] text-[#E34D59] mb-3">事件列表加载失败</p>
            <Button onClick={() => refetchEvents()} variant="outline" className="h-8 text-[13px] gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> 重新加载
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tc-table">
              <thead>
                <tr>
                  <th style={{ width: 165 }}>时间</th>
                  <th style={{ width: 150 }}>设备</th>
                  <th style={{ width: 110 }}>所属产品</th>
                  <th style={{ width: 70 }}>类型</th>
                  <th>文件名</th>
                  <th style={{ width: 85 }}>大小</th>
                  <th style={{ width: 85 }}>时长</th>
                  <th style={{ width: 80 }}>协议</th>
                  <th style={{ width: 70 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {eventsLoading ? (
                  [0, 1, 2, 3, 4].map((i) => (
                    <tr key={`sk-${i}`}>
                      <td colSpan={9} className="py-3">
                        <div className="h-4 rounded bg-[#F3F4F6] animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <p className="text-[13px] text-[#888] mb-1">暂无音视频事件</p>
                      <p className="text-[12px] text-[#BBBFC4]">摄像头设备上报录制/截图/回放后将在此展示</p>
                    </td>
                  </tr>
                ) : (
                  items.map((ev) => (
                    <tr key={ev.id}>
                      <td>
                        <span className="text-[12px] font-mono text-[#888] flex items-center gap-1">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          {fmtTime(ev.timestamp)}
                        </span>
                      </td>
                      <td><code className="text-[12px] text-[#666] font-mono">{ev.device_name}</code></td>
                      <td><span className="text-[12px] text-[#666]">{ev.product_name}</span></td>
                      <td><span className={cn("tc-badge", typeStyles[ev.event_type])}>{typeLabels[ev.event_type]}</span></td>
                      <td><span className="text-[12px] text-[#888] font-mono truncate inline-block max-w-[260px] align-middle">{ev.file_name ?? "—"}</span></td>
                      <td><span className="text-[12px] text-[#666]">{fmtSize(ev.file_size)}</span></td>
                      <td><span className="text-[12px] text-[#666]">{fmtDuration(ev.duration_sec)}</span></td>
                      <td><span className="text-[12px] text-[#666]">{ev.stream_protocol}</span></td>
                      <td><span className={cn("tc-badge", statusStyles[ev.status])}>{statusLabels[ev.status]}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E6EB]">
          <span className="text-[12px] text-[#888]">
            共 {events?.total ?? 0} 条事件{events ? `, 第 ${events.page}/${totalPages} 页` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" className="h-7 text-[12px] gap-1 border-[#E5E6EB]"
              disabled={page <= 1 || eventsLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> 上一页
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-[12px] gap-1 border-[#E5E6EB]"
              disabled={page >= totalPages || eventsLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页 <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
