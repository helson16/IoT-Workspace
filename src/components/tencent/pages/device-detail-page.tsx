"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Cpu, Wifi, Calendar, RefreshCw, Send, Layers,
  ChevronLeft, ChevronRight, Activity, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import {
  api, ApiError,
  type ShadowDocument, type TelemetryTrendSeries, type ThingModelSnapshot,
  type DeviceLogType, type ParseCommandResult,
} from "@/lib/api/client";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

// ---------------- 趋势图 ----------------

const SERIES_COLORS = ["#0052D9", "#00A870", "#7B61FF", "#ED7B2F", "#E34D59"];

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #E5E6EB",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
} as const;

/** 多序列按 ts 合并为统一 chart data(不同 identifier 上报时刻可能错位, 缺口由 connectNulls 处理) */
function mergeSeriesData(series: TelemetryTrendSeries[]): Array<Record<string, number | string>> {
  const byTs = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    for (const p of s.points) {
      let row = byTs.get(p.ts);
      if (!row) {
        row = { ts: p.ts };
        byTs.set(p.ts, row);
      }
      row[s.identifier] = p.value;
    }
  }
  return Array.from(byTs.values()).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function axisTimeLabel(iso: string, hours: number): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  // 24h 跨天时显示 日 HH:mm, 短窗口只显示 HH:mm
  if (hours >= 24) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function TrendCard({ deviceId }: { deviceId: string }) {
  const [hours, setHours] = useState<1 | 6 | 24>(24);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["telemetry-trend", deviceId, hours],
    queryFn: () => api.getTelemetryTrend(deviceId, hours),
    refetchInterval: 60_000,
  });

  const series = data?.series ?? [];
  const metaMap = new Map(series.map((s) => [s.identifier, s]));
  const chartData = mergeSeriesData(series);

  return (
    <div className="bg-white rounded border border-[#E5E6EB] lg:col-span-2 flex flex-col">
      <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between">
        <h3 className="text-[14px] font-medium text-[#333]">遥测趋势</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded border border-[#E5E6EB] overflow-hidden">
            {([1, 6, 24] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={
                  "px-2.5 h-6 text-[12px] transition-colors " +
                  (hours === h ? "bg-[#0052D9] text-white" : "bg-white text-[#666] hover:text-[#0052D9]")
                }
              >
                {h}h
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-[#F3F4F6] transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#888]" />
          </button>
        </div>
      </div>

      {/* 实时值 chips */}
      {series.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pt-4">
          {series.map((s, i) => {
            const last = s.points[s.points.length - 1];
            if (!last) return null;
            return (
              <div
                key={s.identifier}
                className="flex items-center gap-2 rounded border border-[#E5E6EB] px-3 py-1.5"
              >
                <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                <span className="text-[12px] text-[#888]">{s.name}</span>
                <span className="text-[15px] font-semibold text-[#333]">{last.value}{s.unit}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="p-4 flex-1 min-h-[280px]">
        {isLoading ? (
          <div className="h-[280px] bg-[#F9FAFB] rounded animate-pulse" />
        ) : isError ? (
          <div className="h-[280px] flex flex-col items-center justify-center">
            <div className="text-[13px] text-[#E34D59] mb-2">趋势加载失败: {(error as Error)?.message}</div>
            <button onClick={() => refetch()} className="text-[13px] text-[#0052D9] hover:underline">
              重新加载
            </button>
          </div>
        ) : series.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-[13px] text-[#BBBFC4]">
            暂无遥测数据, 等待设备上报...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F2" vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={(v: string) => axisTimeLabel(v, hours)}
                tick={{ fontSize: 11, fill: "#999" }}
                interval="preserveStartEnd"
                minTickGap={40}
                tickLine={false}
                axisLine={{ stroke: "#E5E6EB" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "#999" }} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => new Date(String(v)).toLocaleString("zh-CN", { hour12: false })}
                formatter={(value, name) => {
                  const meta = metaMap.get(String(name));
                  return [`${Number(value)}${meta?.unit ?? ""}`, meta?.name ?? String(name)];
                }}
              />
              <Legend formatter={(v) => metaMap.get(String(v))?.name ?? String(v)} iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {series.map((s, i) => (
                <Line
                  key={s.identifier}
                  type="monotone"
                  dataKey={s.identifier}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ---------------- 设备影子(物模型映射) ----------------

function ShadowSection({
  title, state, metaMap, tone,
}: {
  title: string;
  state: Record<string, unknown>;
  metaMap: Map<string, { name: string; unit: string | null; dataType: string }>;
  tone: "green" | "blue" | "orange";
}) {
  const toneCls = {
    green: "bg-[#E8F8F0]/40 border-[#D4EDE2] divide-[#D4EDE2]",
    blue: "bg-[#E6F0FF]/40 border-[#C5DDF7] divide-[#C5DDF7]",
    orange: "bg-[#FFF3E8]/50 border-[#F5D5BC] divide-[#F5D5BC]",
  }[tone];

  return (
    <div>
      <div className="text-[12px] text-[#888] mb-2">{title}</div>
      {Object.keys(state).length === 0 ? (
        <div className="text-[12px] text-[#BBBFC4] py-2">暂无数据</div>
      ) : (
        <div className={cn("rounded border divide-y", toneCls)}>
          {Object.entries(state).map(([k, v]) => {
            const meta = metaMap.get(k);
            return (
              <div key={k} className="flex items-center justify-between px-3 py-1.5 gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#333] font-medium truncate">
                    {meta?.name ?? k}
                    {meta?.unit && (
                      <span className="text-[11px] text-[#999] ml-1">({meta.unit})</span>
                    )}
                  </div>
                  {meta && meta.name !== k && (
                    <code className="text-[11px] text-[#BBBFC4]">{k}</code>
                  )}
                </div>
                <span className="text-[13px] font-medium text-[#333] flex-shrink-0">
                  {formatValue(v)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- 通信日志时间线 ----------------

const LOG_PAGE_SIZE = 20;

const logTypeConfig: Record<string, { label: string; dot: string; badge: string }> = {
  property: { label: "属性上报", dot: "bg-[#0052D9]", badge: "bg-[#E6F0FF] text-[#0052D9]" },
  event: { label: "事件", dot: "bg-[#ED7B2F]", badge: "bg-[#FFF3E8] text-[#ED7B2F]" },
  action: { label: "服务调用", dot: "bg-[#7B61FF]", badge: "bg-[#F0EDFF] text-[#7B61FF]" },
  forward: { label: "消息转发", dot: "bg-[#00A870]", badge: "bg-[#E8F8F0] text-[#00A870]" },
  status: { label: "上下线", dot: "bg-[#888]", badge: "bg-[#F3F4F6] text-[#666]" },
};

const LOG_TYPE_TABS: Array<{ key: DeviceLogType; label: string }> = [
  { key: "all", label: "全部" },
  { key: "property", label: "属性上报" },
  { key: "event", label: "事件" },
  { key: "action", label: "服务调用" },
  { key: "forward", label: "消息转发" },
  { key: "status", label: "上下线" },
];

function LogTimeline({ deviceId }: { deviceId: string }) {
  const [type, setType] = useState<DeviceLogType>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["device-logs", deviceId, type, page],
    queryFn: () => api.getDeviceLogs(deviceId, { type, page, page_size: LOG_PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));

  const abnormalLevel = (level: string) =>
    !["info", "success", "online", "offline"].includes(level) ? level : null;

  return (
    <div className="bg-white rounded border border-[#E5E6EB]">
      <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#0052D9]" />
          <h3 className="text-[14px] font-medium text-[#333]">通信日志</h3>
          {total > 0 && (
            <span className="text-[12px] text-[#999]">共 {total.toLocaleString()} 条</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            {LOG_TYPE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setType(tab.key); setPage(1); }}
                className={
                  "px-2.5 h-7 rounded text-[12px] border transition-colors " +
                  (type === tab.key
                    ? "bg-[#0052D9] text-white border-[#0052D9]"
                    : "bg-white text-[#666] border-[#E5E6EB] hover:border-[#0052D9] hover:text-[#0052D9]")
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-[#F3F4F6] transition-colors"
            title="刷新"
          >
            <RefreshCw className={"w-3.5 h-3.5 text-[#888] " + (isFetching ? "animate-spin" : "")} />
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#E5E6EB]" />
                <div className="h-4 bg-[#F3F4F6] rounded animate-pulse flex-1" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="py-8 text-center">
            <div className="text-[13px] text-[#E34D59] mb-2">日志加载失败: {(error as Error)?.message}</div>
            <button onClick={() => refetch()} className="text-[13px] text-[#0052D9] hover:underline">
              重新加载
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[#BBBFC4]">暂无日志记录</div>
        ) : (
          <div className="relative">
            {/* 时间线竖线 */}
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[#E5E6EB]" />
            <div className="space-y-0.5">
              {items.map((item) => {
                const cfg = logTypeConfig[item.type] ?? logTypeConfig.property;
                const abnormal = abnormalLevel(item.level);
                return (
                  <div key={item.id} className="relative flex items-center gap-3 py-1.5 pl-0 hover:bg-[#F9FAFB] rounded">
                    <span className={cn("w-[11px] h-[11px] rounded-full border-2 border-white z-10 flex-shrink-0", cfg.dot)} />
                    <span className="text-[12px] text-[#999] font-mono w-[72px] flex-shrink-0">
                      {new Date(item.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                    </span>
                    <span className={cn("text-[11px] px-1.5 py-0.5 rounded flex-shrink-0", cfg.badge)}>
                      {cfg.label}
                    </span>
                    <span className="text-[13px] text-[#333] truncate" title={item.summary}>
                      {item.summary}
                    </span>
                    {abnormal && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#FDECEE] text-[#E34D59] flex-shrink-0">
                        {abnormal}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 分页 */}
      {!isLoading && total > 0 && (
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#E5E6EB] text-[12px] text-[#666]">
          <span>共 {total.toLocaleString()} 条记录， 第 {page}/{totalPages} 页</span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
            className="px-3 h-7 flex items-center gap-1 rounded border border-[#E5E6EB] text-[12px] text-[#666] hover:border-[#0052D9] hover:text-[#0052D9] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> 上一页
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isFetching}
            className="px-3 h-7 flex items-center gap-1 rounded border border-[#E5E6EB] text-[12px] text-[#666] hover:border-[#0052D9] hover:text-[#0052D9] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一页 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- 主页面 ----------------

export function DeviceDetailPage() {
  const { selectedDeviceId, setCurrentPage } = useAppStore();
  const queryClient = useQueryClient();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdMsg, setCmdMsg] = useState("");
  const [activeTab, setActiveTab] = useState("nl");
  const [nlInput, setNlInput] = useState("");
  const [parseResult, setParseResult] = useState<ParseCommandResult | null>(null);

  const { data: device, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["device", selectedDeviceId],
    queryFn: () => api.getDevice(selectedDeviceId!),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const { data: thingModel } = useQuery<ThingModelSnapshot>({
    queryKey: ["thing-model", device?.productId],
    queryFn: () => api.getThingModel(device!.productId),
    enabled: !!device?.productId,
  });

  const { data: shadow, refetch: refetchShadow } = useQuery<ShadowDocument>({
    queryKey: ["shadow", selectedDeviceId],
    queryFn: () => api.getShadow(selectedDeviceId!),
    enabled: !!selectedDeviceId,
    refetchInterval: 5000,
  });

  const desiredMutation = useMutation({
    mutationFn: (desired: Record<string, unknown>) =>
      // 乐观锁字段是 desiredVersion (desired 专属), 不是总 version (随上报递增)
      api.updateShadowDesired(selectedDeviceId!, desired, shadow?.desiredVersion ?? 0),
    onSuccess: () => {
      setCmdMsg("✓ 期望状态已下发, 等待设备同步");
      queryClient.invalidateQueries({ queryKey: ["shadow", selectedDeviceId] });
      setTimeout(() => {
        setCmdMsg("");
        setCmdOpen(false);
        setCmdInput("");
        setParseResult(null);
        setNlInput("");
      }, 1500);
    },
    onError: (e: Error) => setCmdMsg("✗ 下发失败: " + (e instanceof ApiError ? e.message : e.message)),
  });

  // 自然语言 → command:parse 解析 (契约: 502/50003=上游故障; needs_clarification 非错误)
  const parseMutation = useMutation({
    mutationFn: (text: string) => api.parseDeviceCommand(selectedDeviceId!, text),
    onSuccess: (data) => setParseResult(data),
  });

  const handleParse = () => {
    const text = nlInput.trim();
    if (!text || parseMutation.isPending) return;
    parseMutation.mutate(text);
  };

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
  const reported = shadow?.state?.reported ?? {};
  const desiredState = shadow?.state?.desired ?? {};
  const delta = shadow?.state?.delta ?? {};

  // 物模型映射: identifier → {name, unit, dataType}
  const propMetaMap = new Map(
    (thingModel?.properties ?? []).map((p) => [
      p.identifier,
      {
        name: p.name,
        unit: typeof p.spec?.unit === "string" ? p.spec.unit : null,
        dataType: p.dataType,
      },
    ]),
  );

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
              onClick={() => { setCmdOpen(true); setCmdMsg(""); setParseResult(null); }}
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

      {/* 遥测趋势 + 设备影子 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrendCard deviceId={device.deviceId} />

        {/* Shadow State */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="px-5 py-3.5 border-b border-[#E5E6EB] flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-[#333]">设备影子</h3>
            <span className="text-[12px] text-[#BBBFC4]">version {shadow?.version ?? 0}</span>
          </div>
          <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
            <ShadowSection title="reported (设备上报)" state={reported} metaMap={propMetaMap} tone="green" />
            <ShadowSection title="desired (期望下发)" state={desiredState} metaMap={propMetaMap} tone="blue" />
            {Object.keys(delta).length > 0 && (
              <ShadowSection title="delta (待同步差异)" state={delta} metaMap={propMetaMap} tone="orange" />
            )}
          </div>
        </div>
      </div>

      {/* 通信日志时间线 */}
      <LogTimeline deviceId={device.deviceId} />

      {/* Send Command Dialog (shadow desired 下发) */}
      <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">下发指令 (影子期望状态)</DialogTitle>
          </DialogHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="py-2">
            <TabsList className="w-full text-[13px]">
              <TabsTrigger value="nl" className="gap-1.5 flex-1">
                <Sparkles className="w-3.5 h-3.5" /> 智能指令
              </TabsTrigger>
              <TabsTrigger value="json" className="flex-1">JSON</TabsTrigger>
            </TabsList>

            {/* 智能指令: 自然语言 → 解析 → 人工确认 → 下发 */}
            <TabsContent value="nl" className="mt-3 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={nlInput}
                  onChange={(e) => { setNlInput(e.target.value); setParseResult(null); }}
                  placeholder="如: 把目标温度调到25度"
                  className="h-8 text-[13px] flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleParse()}
                />
                <Button
                  onClick={handleParse}
                  disabled={parseMutation.isPending || !nlInput.trim()}
                  className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
                >
                  {parseMutation.isPending ? "解析中..." : "解析"}
                </Button>
              </div>

              {parseMutation.isPending && (
                <div className="text-[12px] text-[#BBBFC4] rounded px-3 py-2 bg-[#F3F4F6] animate-pulse">
                  正在解析指令...
                </div>
              )}

              {parseMutation.isError && (() => {
                const e = parseMutation.error as Error;
                const upstream = e instanceof ApiError && e.code === 50003;
                return (
                  <div className={cn(
                    "text-[12px] rounded px-3 py-2",
                    upstream ? "text-[#0052D9] bg-[#E6F0FF]" : "text-[#E34D59] bg-[#FDECEE]",
                  )}>
                    {upstream ? "解析服务暂时不可用, 请稍后重试" : `✗ 解析失败: ${e.message}`}
                  </div>
                );
              })()}

              {parseResult && parseResult.proposed && (
                <div className="rounded border border-[#D5E3FF] bg-[#F0F5FF] p-3 space-y-2.5">
                  <div className="text-[13px] text-[#333] leading-relaxed">{parseResult.explanation}</div>
                  <div className="rounded bg-white border border-[#E5E6EB] divide-y divide-[#F3F4F6]">
                    {Object.entries(parseResult.proposed).map(([id, v]) => {
                      const m = propMetaMap.get(id);
                      return (
                        <div key={id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                          <span className="text-[#666]">
                            {m?.name ?? id}
                            <span className="text-[11px] text-[#BBBFC4] ml-1.5 font-mono">{id}</span>
                          </span>
                          <span className="font-medium text-[#333]">
                            {String(v)}
                            {m?.unit && <span className="text-[#888] ml-0.5 font-normal">{m.unit}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#BBBFC4]">
                      {parseResult.meta.judgments
                        ? `属性置信度 ${(parseResult.meta.judgments.target_property_confidence * 100).toFixed(0)}%`
                        : ""}
                    </span>
                    <Button
                      onClick={() => desiredMutation.mutate(parseResult.proposed!)}
                      disabled={desiredMutation.isPending}
                      className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
                    >
                      {desiredMutation.isPending ? "下发中..." : "确认下发"}
                    </Button>
                  </div>
                </div>
              )}

              {parseResult && !parseResult.proposed && (
                <div className={cn(
                  "text-[12px] rounded px-3 py-2",
                  parseResult.needs_clarification
                    ? "text-[#0052D9] bg-[#E6F0FF]"
                    : "text-[#888] bg-[#F3F4F6]",
                )}>
                  {parseResult.needs_clarification
                    ? (parseResult.hint ?? "请补充更明确的指令")
                    : "未能解析出可下发的属性"}
                </div>
              )}
            </TabsContent>

            {/* JSON: 直接编辑 desired */}
            <TabsContent value="json" className="mt-3">
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
            </TabsContent>
          </Tabs>

          {cmdMsg && (
            <div className={cn(
              "text-[12px] rounded px-3 py-2",
              cmdMsg.startsWith("✓") ? "text-[#2BA471] bg-[#E8F8F0]" : "text-[#E34D59] bg-[#FDECEE]"
            )}>
              {cmdMsg}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCmdOpen(false)} className="h-8 text-[13px]">
              取消
            </Button>
            {activeTab === "json" && (
              <Button
                onClick={sendCommand}
                disabled={desiredMutation.isPending}
                className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
              >
                {desiredMutation.isPending ? "下发中..." : "发送"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
