"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type AnalyticsChart,
  type AnalyticsInsight,
  type AnalyticsStorage,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Database, HardDrive, TrendingUp, Activity, BarChart3, Clock,
  RefreshCw, PieChart as PieChartIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

// ---------------- 工具 ----------------

const chartTypeLabels: Record<string, string> = {
  line: "折线图",
  bar: "柱状图",
  pie: "饼图",
  area: "面积图",
};

const severityStyle: Record<string, string> = {
  info: "bg-[#E6F0FF] text-[#0052D9]",
  warning: "bg-[#FFF3E8] text-[#ED7B2F]",
  critical: "bg-[#FDECEE] text-[#E34D59]",
};

const severityLabels: Record<string, string> = {
  info: "信息",
  warning: "警告",
  critical: "严重",
};

const pieColors = ["#0052D9", "#ED7B2F", "#E34D59", "#00A870", "#7B61FF"];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 图表 X 轴 label: ISO(UTC) → 本地短格式 */
function axisLabel(iso: string, kind: "hour" | "day" | "minute"): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  if (kind === "day") return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (kind === "minute") return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getHours())}:00`;
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #E5E6EB",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
} as const;

// ---------------- 统计卡片 ----------------

function StorageCards({ storage }: { storage: AnalyticsStorage }) {
  const cards = [
    {
      label: "消息总记录数",
      icon: Database,
      value: storage.total_records.toLocaleString(),
      unit: "条",
      tip: storage.breakdown.map((b) => `${b.label} ${b.records.toLocaleString()}`).join(" · "),
    },
    {
      label: "存储占用",
      icon: HardDrive,
      value: formatBytes(storage.storage_bytes),
      unit: "",
      tip: storage.breakdown.map((b) => `${b.label} ${formatBytes(b.storage_bytes)}`).join(" · "),
    },
    {
      label: "近7天新增记录",
      icon: TrendingUp,
      value: storage.week_records.toLocaleString(),
      unit: "条",
      tip: "属性历史 + 事件 + 服务调用日志",
    },
    {
      label: "日均上报量",
      icon: Activity,
      value: storage.avg_daily_records.toLocaleString(),
      unit: "条/天",
      tip: "按近7天新增记录折算",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded border border-[#E5E6EB] p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] text-[#888]">{c.label}</span>
            <c.icon className="w-4 h-4 text-[#BBBFC4]" />
          </div>
          <div className="flex items-end gap-1">
            <span className="text-[24px] font-semibold text-[#333] leading-none">{c.value}</span>
            {c.unit && <span className="text-[12px] text-[#888] mb-0.5">{c.unit}</span>}
          </div>
          <p className="text-[11px] text-[#999] mt-2 truncate" title={c.tip}>{c.tip}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------- 图表卡片 ----------------

function ChartBody({ chart }: { chart: AnalyticsChart }) {
  if (chart.type === "line") {
    const data = chart.points.map((p) => ({ label: axisLabel(p.label, "hour"), value: p.value }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#999" }} interval={3} tickLine={false} axisLine={{ stroke: "#E5E6EB" }} />
          <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={48} domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}°C`, "平均温度"]} />
          <Line type="monotone" dataKey="value" stroke="#0052D9" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "bar") {
    const data = chart.points.map((p) => ({ label: axisLabel(p.label, "day"), value: p.value }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={{ stroke: "#E5E6EB" }} />
          <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 台`, "活跃设备"]} />
          <Bar dataKey="value" fill="#0052D9" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "pie") {
    const data = chart.points.map((p) => ({ name: p.label, value: p.value }));
    const total = chart.points.reduce((a, b) => a + b.value, 0);
    if (total === 0) {
      return (
        <div className="h-full flex items-center justify-center text-[12px] text-[#BBBFC4]">
          <div className="text-center">
            <PieChartIcon className="w-8 h-8 text-[#E5E6EB] mx-auto mb-2" />
            近30天无事件记录
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
              <Cell key={entry.name} fill={pieColors[i % pieColors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} 条`, String(name)]} />
          <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 12, color: "#666" }}>{String(v)}</span>} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  const data = chart.points.map((p) => ({ label: axisLabel(p.label, "minute"), value: p.value }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0052D9" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#0052D9" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#999" }} interval={9} tickLine={false} axisLine={{ stroke: "#E5E6EB" }} />
        <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 条`, "消息"]} />
        <Area type="monotone" dataKey="value" stroke="#0052D9" strokeWidth={1.5} fill="url(#throughputGrad)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------- 主页面 ----------------

export function DataAnalysisPage() {
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: storage, isLoading: storageLoading, isError: storageError, refetch: refetchStorage } =
    useQuery<AnalyticsStorage>({
      queryKey: ["analytics-storage"],
      queryFn: () => api.getAnalyticsStorage(),
      refetchInterval: 60_000,
    });

  const { data: chartsRes, isLoading: chartsLoading, isError: chartsError, refetch: refetchCharts } =
    useQuery({ queryKey: ["analytics-charts"], queryFn: () => api.getAnalyticsCharts(), refetchInterval: 60_000 });

  const { data: insightsRes, isLoading: insightsLoading, isError: insightsError, refetch: refetchInsights } =
    useQuery({ queryKey: ["analytics-insights"], queryFn: () => api.getAnalyticsInsights(), refetchInterval: 120_000 });

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ["analytics-chart-details", detailId],
    queryFn: () => api.getAnalyticsChartDetails(detailId as string),
    enabled: !!detailId,
  });

  const charts = chartsRes?.charts ?? [];
  const insights = insightsRes?.insights ?? [];

  return (
    <div className="space-y-5">
      {/* 存储统计卡片 */}
      {storageLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[112px] animate-pulse">
              <div className="h-3 w-20 rounded bg-[#F3F4F6] mb-4" />
              <div className="h-7 w-28 rounded bg-[#E5E6EB]" />
            </div>
          ))}
        </div>
      ) : storageError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">存储统计加载失败</p>
          <Button onClick={() => refetchStorage()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : storage ? (
        <StorageCards storage={storage} />
      ) : null}

      {/* 图表网格 */}
      {chartsLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[320px] animate-pulse">
              <div className="h-4 w-32 rounded bg-[#F3F4F6] mb-5" />
              <div className="h-[200px] rounded bg-[#F3F4F6]" />
            </div>
          ))}
        </div>
      ) : chartsError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">图表数据加载失败</p>
          <Button onClick={() => refetchCharts()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {charts.map((chart) => (
            <div key={chart.id} className="bg-white rounded border border-[#E5E6EB] p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#0052D9]" />
                  <h4 className="text-[14px] font-medium text-[#333]">{chart.name}</h4>
                </div>
                <span className="tc-badge bg-[#F3F4F6] text-[#666]">{chartTypeLabels[chart.type] ?? chart.type}</span>
              </div>
              <div className="flex items-center gap-4 mb-2 text-[12px] text-[#888]">
                <span>数据源：{chart.data_source}</span>
                <span>时间范围：{chart.time_range}</span>
              </div>
              <p className="text-[12px] text-[#666] mb-3">{chart.summary}</p>
              <div className="h-[180px] min-w-0">
                <ChartBody chart={chart} />
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-[#BBBFC4] flex items-center gap-1">
                  <Clock className="w-3 h-3" /> 每{chart.refresh_interval}刷新
                </span>
                <button
                  className="text-[12px] text-[#0052D9] hover:underline"
                  onClick={() => setDetailId(chart.id)}
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 智能分析 */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between">
          <h3 className="text-[14px] font-medium text-[#333]">智能分析</h3>
          <span className="text-[11px] text-[#BBBFC4]">基于真实上报数据实时派生</span>
        </div>
        {insightsLoading ? (
          <div className="px-5 py-4 space-y-4 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-5 w-10 rounded bg-[#F3F4F6]" />
                <div className="flex-1">
                  <div className="h-4 w-40 rounded bg-[#F3F4F6] mb-2" />
                  <div className="h-3 w-full rounded bg-[#F3F4F6]" />
                </div>
              </div>
            ))}
          </div>
        ) : insightsError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] text-[#E34D59] mb-3">智能分析加载失败</p>
            <Button onClick={() => refetchInsights()} variant="outline" className="h-8 text-[13px] gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> 重新加载
            </Button>
          </div>
        ) : insights.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#BBBFC4]">暂无分析洞察</div>
        ) : (
          <div className="divide-y divide-[#F0F0F0]">
            {insights.map((insight: AnalyticsInsight) => (
              <div key={insight.title} className="px-5 py-4 hover:bg-[#F9FAFB] transition-colors">
                <div className="flex items-start gap-3">
                  <span className={cn("tc-badge mt-0.5 flex-shrink-0", severityStyle[insight.severity])}>
                    {severityLabels[insight.severity]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#333]">{insight.title}</div>
                    <p className="text-[12px] text-[#888] mt-1 leading-relaxed">{insight.description}</p>
                  </div>
                  <span className="text-[11px] text-[#BBBFC4] flex-shrink-0">{fmtDateTime(insight.time)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图表详情 Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="sm:max-w-[680px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">
              {details ? `${details.name} · 详情` : "图表详情"}
            </DialogTitle>
          </DialogHeader>
          {detailsLoading || !details ? (
            <div className="space-y-3 py-2 animate-pulse">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-8 rounded bg-[#F3F4F6]" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[12px] text-[#666]">{details.summary}</p>
              <div>
                <h5 className="text-[13px] font-medium text-[#333] mb-2">
                  聚合数据点（{details.points.length} 项）
                </h5>
                <div className="max-h-[180px] overflow-y-auto rounded border border-[#E5E6EB]">
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>{details.type === "pie" ? "级别" : "时间"}</th>
                        <th>数值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.points.map((p, i) => (
                        <tr key={`${p.label}-${i}`}>
                          <td>
                            {details.type === "pie"
                              ? p.label
                              : details.type === "bar"
                                ? axisLabel(p.label, "day")
                                : details.type === "line"
                                  ? axisLabel(p.label, "hour")
                                  : axisLabel(p.label, "minute")}
                          </td>
                          <td>
                            {details.type === "line" ? p.value.toFixed(1) : p.value.toLocaleString()} {details.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h5 className="text-[13px] font-medium text-[#333] mb-2">最近原始记录（{details.raw.length} 条）</h5>
                <div className="max-h-[220px] overflow-y-auto rounded border border-[#E5E6EB]">
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>设备</th>
                        <th>内容</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.raw.map((r) => (
                        <tr key={`${r.device_id}-${r.time}`}>
                          <td>{r.device_name}</td>
                          <td className="max-w-[280px] truncate" title={r.detail}>{r.detail}</td>
                          <td className="whitespace-nowrap">{fmtDateTime(r.time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
