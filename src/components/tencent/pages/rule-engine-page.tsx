"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  api,
  type SecurityCredentialItem,
  type SecurityCredentialDetail,
  type SecurityAuthLogItem,
  type SecurityStats,
} from "@/lib/api/client";
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
import {
  ShieldCheck, ShieldAlert, ShieldX, KeyRound, RefreshCw,
  Eye, RotateCw, Ban, CheckCircle2, Copy, Check, Search,
} from "lucide-react";

// ---------------- 工具 ----------------

const statusLabels: Record<string, string> = {
  online: "在线",
  offline: "离线",
  "not-activated": "未激活",
  disabled: "已禁用",
};

const statusDot: Record<string, string> = {
  online: "bg-[#2BA471]",
  offline: "bg-[#BBBFC4]",
  "not-activated": "bg-[#ED7B2F]",
  disabled: "bg-[#E34D59]",
};

const authTypeLabels: Record<string, string> = {
  "device-token": "设备令牌认证",
  "mqtt-connect": "MQTT 连接认证",
  "secret-rotate": "密钥轮换",
  "status-change": "状态变更",
};

const authTypeBadge: Record<string, string> = {
  "device-token": "bg-[#E6F0FF] text-[#0052D9]",
  "mqtt-connect": "bg-[#E8F3FF] text-[#0066CC]",
  "secret-rotate": "bg-[#FFF7E8] text-[#ED7B2F]",
  "status-change": "bg-[#F3F4F6] text-[#666]",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------- 统计卡片 ----------------

function StatsCards({ stats }: { stats: SecurityStats }) {
  const cards = [
    {
      label: "设备总数",
      icon: ShieldCheck,
      value: stats.device_total.toLocaleString(),
      unit: "台",
      tip: "平台内全部设备",
    },
    {
      label: "在线设备",
      icon: CheckCircle2,
      value: stats.online.toLocaleString(),
      unit: "台",
      tip: "当前 Redis 在线状态对应的设备计数",
    },
    {
      label: "已禁用设备",
      icon: ShieldX,
      value: stats.disabled.toLocaleString(),
      unit: "台",
      tip: "禁用后设备认证将被拒绝",
    },
    {
      label: "今日认证次数",
      icon: ShieldAlert,
      value: stats.today_auth_count.toLocaleString(),
      unit: "次",
      tip: stats.today_auth_failure > 0 ? `今日失败 ${stats.today_auth_failure} 次` : "今日无失败认证",
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
          <p
            className={cn(
              "text-[11px] mt-2 truncate",
              c.label === "今日认证次数" && stats.today_auth_failure > 0
                ? "text-[#E34D59]"
                : "text-[#999]",
            )}
          >
            {c.tip}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------- 查看密钥 Dialog ----------------

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默(非 https 环境)
    }
  };
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-[12px] text-[#888] w-20 flex-shrink-0">{label}</span>
      <code className="flex-1 min-w-0 text-[12px] text-[#333] bg-[#F7F8FA] rounded px-2 py-1 font-mono break-all">
        {value}
      </code>
      <button
        onClick={copy}
        className="w-6 h-6 flex items-center justify-center rounded text-[#888] hover:text-[#0052D9] hover:bg-[#F3F4F6] flex-shrink-0"
        title="复制"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-[#2BA471]" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function CredentialDialog({
  deviceId,
  onClose,
}: {
  deviceId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["security-credential", deviceId],
    queryFn: () => api.getSecurityCredential(deviceId as string),
    enabled: !!deviceId,
  });

  const detail: SecurityCredentialDetail | undefined = data;

  return (
    <Dialog open={!!deviceId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] text-[#333] flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#0052D9]" />
            设备密钥
          </DialogTitle>
        </DialogHeader>

        {isLoading || !detail ? (
          <div className="py-8 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 rounded bg-[#F3F4F6] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="bg-[#FFF7E8] border border-[#FFE4C2] rounded px-3 py-2 text-[12px] text-[#ED7B2F]">
              设备采用一机一密认证方式，密钥仅在设备烧录与控制台查看时可见，请妥善保管。
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#333] mb-1">设备信息</p>
              <div className="flex items-center gap-4 text-[12px] text-[#666] mb-1">
                <span>设备名称：{detail.deviceName}</span>
                <span>所属产品：{detail.productName}</span>
              </div>
              <div className="flex items-center gap-4 text-[12px] text-[#888]">
                <span>最近上线：{fmtDateTime(detail.lastLoginAt)}</span>
                <span>认证 IP：{detail.lastIp ?? "-"}</span>
              </div>
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#333] mb-1">设备密钥</p>
              <CopyRow label="deviceSecret" value={detail.deviceSecret} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#333] mb-1">MQTT 连接配置</p>
              <CopyRow label="Host" value={`${detail.mqttConfig.host}:${detail.mqttConfig.port}`} />
              <CopyRow label="clientId" value={detail.mqttConfig.clientId} />
              <CopyRow label="username" value={detail.mqttConfig.username} />
              <CopyRow label="password" value={detail.mqttConfig.password} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-8 text-[13px]">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- 设备凭证 Tab ----------------

function CredentialsTab({
  onViewSecret,
  onRotate,
  onToggleStatus,
}: {
  onViewSecret: (deviceId: string) => void;
  onRotate: (device: SecurityCredentialItem) => void;
  onToggleStatus: (device: SecurityCredentialItem) => void;
}) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["security-credentials", { keyword: searchText, page }],
    queryFn: () =>
      api.getSecurityCredentials({ page, page_size: 20, keyword: searchText || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const statusMutation = useMutation({
    mutationFn: (input: { deviceId: string; action: "disable" | "enable" }) =>
      api.setSecurityDeviceStatus(input.deviceId, input.action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["security-credentials"] });
      void queryClient.invalidateQueries({ queryKey: ["security-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["security-auth-logs"] });
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="bg-white rounded border border-[#E5E6EB]">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-4 border-b border-[#E5E6EB]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#BBBFC4] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="搜索设备名称 / 产品名称"
            className="h-8 text-[13px] w-56 pl-8"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearchText(keyword);
                setPage(1);
              }
            }}
          />
        </div>
        <Button
          variant="outline"
          className="h-8 text-[13px] gap-1.5"
          onClick={() => {
            setSearchText(keyword);
            setPage(1);
          }}
        >
          查询
        </Button>
        <div className="flex-1" />
        <span className="text-[12px] text-[#888]">共 {total} 台设备</span>
      </div>

      {isError ? (
        <div className="p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">凭证列表加载失败</p>
          <Button onClick={() => refetch()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : (
        <>
          <table className="tc-table">
            <thead>
              <tr>
                <th>设备名称</th>
                <th>所属产品</th>
                <th>状态</th>
                <th>密钥(脱敏)</th>
                <th>最近上线</th>
                <th>认证 IP</th>
                <th style={{ width: "230px" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><div className="h-4 bg-[#F3F4F6] rounded animate-pulse w-4/5" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="py-10 text-center text-[13px] text-[#999]">
                      {searchText ? "未找到匹配的设备" : "暂无设备，请先在设备管理页注册设备"}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr key={d.deviceId}>
                    <td className="font-medium text-[#333]">{d.deviceName}</td>
                    <td className="text-[#666]">{d.productName}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-[12px]">
                        <span className={cn("w-1.5 h-1.5 rounded-full", statusDot[d.status] ?? "bg-[#BBBFC4]")} />
                        {statusLabels[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="font-mono text-[12px] text-[#888]">{d.maskedSecret}</td>
                    <td className="text-[#666]">{fmtDateTime(d.lastLoginAt)}</td>
                    <td className="text-[#666] font-mono text-[12px]">{d.lastIp ?? "-"}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onViewSecret(d.deviceId)}
                          className="tc-link-btn"
                        >
                          <Eye className="w-3.5 h-3.5" /> 查看密钥
                        </button>
                        <button
                          onClick={() => onRotate(d)}
                          className="tc-link-btn"
                          disabled={statusMutation.isPending}
                        >
                          <RotateCw className="w-3.5 h-3.5" /> 轮换
                        </button>
                        {d.status === "disabled" ? (
                          <button
                            onClick={() => onToggleStatus(d)}
                            className="tc-link-btn text-[#2BA471] hover:text-[#20885D]"
                            disabled={statusMutation.isPending}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> 启用
                          </button>
                        ) : (
                          <button
                            onClick={() => onToggleStatus(d)}
                            className="tc-link-btn text-[#E34D59] hover:text-[#C9353F]"
                            disabled={statusMutation.isPending}
                          >
                            <Ban className="w-3.5 h-3.5" /> 禁用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3 p-4 border-t border-[#E5E6EB] text-[12px] text-[#888]">
              <span>第 {page} / {totalPages} 页</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- 认证记录 Tab ----------------

function AuthLogsTab() {
  const [authType, setAuthType] = useState("");
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["security-auth-logs", { authType, result, page }],
    queryFn: () =>
      api.getSecurityAuthLogs({
        page,
        page_size: 20,
        auth_type: authType || undefined,
        result: result || undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const items: SecurityAuthLogItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="bg-white rounded border border-[#E5E6EB]">
      {/* 筛选栏 */}
      <div className="flex items-center gap-2 p-4 border-b border-[#E5E6EB]">
        <select
          className="h-8 text-[13px] rounded border border-[#DCDEE2] bg-white px-2 text-[#333] focus:outline-none focus:border-[#0052D9]"
          value={authType}
          onChange={(e) => {
            setAuthType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部认证方式</option>
          <option value="device-token">设备令牌认证</option>
          <option value="mqtt-connect">MQTT 连接认证</option>
          <option value="secret-rotate">密钥轮换</option>
          <option value="status-change">状态变更</option>
        </select>
        <select
          className="h-8 text-[13px] rounded border border-[#DCDEE2] bg-white px-2 text-[#333] focus:outline-none focus:border-[#0052D9]"
          value={result}
          onChange={(e) => {
            setResult(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
        </select>
        <div className="flex-1" />
        <span className="text-[12px] text-[#888]">共 {total} 条记录</span>
      </div>

      {isError ? (
        <div className="p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">认证记录加载失败</p>
          <Button onClick={() => refetch()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : (
        <>
          <table className="tc-table">
            <thead>
              <tr>
                <th style={{ width: "170px" }}>时间</th>
                <th>设备名称</th>
                <th>所属产品</th>
                <th>认证方式</th>
                <th>结果</th>
                <th>原因</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><div className="h-4 bg-[#F3F4F6] rounded animate-pulse w-4/5" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="py-10 text-center text-[13px] text-[#999]">
                      暂无认证记录，设备认证后将在此展示
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((l) => (
                  <tr key={l.id}>
                    <td className="text-[#666] font-mono text-[12px]">{fmtDateTime(l.time)}</td>
                    <td className="font-medium text-[#333]">{l.deviceName}</td>
                    <td className="text-[#666]">{l.productName || "-"}</td>
                    <td>
                      <span className={cn("tc-badge", authTypeBadge[l.authType] ?? "bg-[#F3F4F6] text-[#666]")}>
                        {authTypeLabels[l.authType] ?? l.authType}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-[12px]">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            l.result === "success" ? "bg-[#2BA471]" : "bg-[#E34D59]",
                          )}
                        />
                        <span className={l.result === "success" ? "text-[#2BA471]" : "text-[#E34D59]"}>
                          {l.result === "success" ? "成功" : "失败"}
                        </span>
                      </span>
                    </td>
                    <td className="text-[#888] max-w-[180px] truncate" title={l.reason ?? ""}>
                      {l.reason ?? "-"}
                    </td>
                    <td className="text-[#666] font-mono text-[12px]">{l.ip ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3 p-4 border-t border-[#E5E6EB] text-[12px] text-[#888]">
              <span>第 {page} / {totalPages} 页</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- 页面主体 ----------------

export function SecurityAuthPage() {
  const [tab, setTab] = useState<"credentials" | "logs">("credentials");
  const [viewDeviceId, setViewDeviceId] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<SecurityCredentialItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<SecurityCredentialItem | null>(null);
  const [rotateResult, setRotateResult] = useState<{ deviceName: string; secret: string } | null>(null);

  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } =
    useQuery<SecurityStats>({
      queryKey: ["security-stats"],
      queryFn: () => api.getSecurityStats(),
      refetchInterval: 10_000,
    });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["security-credentials"] });
    void queryClient.invalidateQueries({ queryKey: ["security-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["security-auth-logs"] });
  };

  const rotateMutation = useMutation({
    mutationFn: (deviceId: string) => api.rotateDeviceSecret(deviceId),
    onSuccess: (data, deviceId) => {
      const deviceName = rotateTarget?.deviceName ?? deviceId;
      setRotateResult({ deviceName, secret: data.deviceSecret });
      setRotateTarget(null);
      refreshAll();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { deviceId: string; action: "disable" | "enable" }) =>
      api.setSecurityDeviceStatus(input.deviceId, input.action),
    onSuccess: () => {
      setDisableTarget(null);
      refreshAll();
    },
  });

  return (
    <div className="space-y-4">
      {/* 统计卡片 */}
      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[112px] animate-pulse">
              <div className="h-3 w-20 rounded bg-[#F3F4F6] mb-4" />
              <div className="h-7 w-28 rounded bg-[#E5E6EB]" />
            </div>
          ))}
        </div>
      ) : statsError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">安全统计加载失败</p>
          <Button onClick={() => refetchStats()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : stats ? (
        <StatsCards stats={stats} />
      ) : null}

      {/* Tabs */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="flex border-b border-[#E5E6EB]">
          {(
            [
              { key: "credentials", label: "设备凭证" },
              { key: "logs", label: "认证记录" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-5 h-11 text-[13px] border-b-2 -mb-px transition-colors",
                tab === t.key
                  ? "text-[#0052D9] border-[#0052D9] font-medium"
                  : "text-[#666] border-transparent hover:text-[#333]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容(表格卡片自带边框, 负 margin 融合 tab 头) */}
      <div className="-mt-4">
        {tab === "credentials" ? (
          <CredentialsTab
            onViewSecret={setViewDeviceId}
            onRotate={setRotateTarget}
            onToggleStatus={(device) => {
              if (device.status === "disabled") {
                statusMutation.mutate({ deviceId: device.deviceId, action: "enable" });
              } else {
                setDisableTarget(device);
              }
            }}
          />
        ) : (
          <AuthLogsTab />
        )}
      </div>

      {/* 查看密钥 */}
      <CredentialDialog deviceId={viewDeviceId} onClose={() => setViewDeviceId(null)} />

      {/* 轮换确认 */}
      <Dialog open={!!rotateTarget} onOpenChange={(open) => !open && setRotateTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">轮换设备密钥</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#666]">
              确定轮换设备 <span className="text-[#333] font-medium">{rotateTarget?.deviceName}</span>（{rotateTarget?.productName}）的密钥？
            </p>
            <div className="bg-[#FDECEE] border border-[#F9D6DA] rounded px-3 py-2 text-[12px] text-[#E34D59]">
              轮换后旧密钥立即失效，正在连接的设备将断开，需烧录新密钥后重新认证上线。
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)} className="h-8 text-[13px]">取消</Button>
            <Button
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
              disabled={rotateMutation.isPending}
              onClick={() => rotateTarget && rotateMutation.mutate(rotateTarget.deviceId)}
            >
              {rotateMutation.isPending ? "轮换中..." : "确认轮换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 轮换结果 */}
      <Dialog open={!!rotateResult} onOpenChange={(open) => !open && setRotateResult(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">密钥轮换成功</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#666]">
              设备 <span className="text-[#333] font-medium">{rotateResult?.deviceName}</span> 的新密钥如下，请立即烧录到设备（仅此一次完整展示）：
            </p>
            <CopyRow label="新密钥" value={rotateResult?.secret ?? ""} />
          </div>
          <DialogFooter>
            <Button
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
              onClick={() => setRotateResult(null)}
            >
              我已保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 禁用确认 */}
      <Dialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">禁用设备</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#666]">
              确定禁用设备 <span className="text-[#333] font-medium">{disableTarget?.deviceName}</span>（{disableTarget?.productName}）？
            </p>
            <div className="bg-[#FDECEE] border border-[#F9D6DA] rounded px-3 py-2 text-[12px] text-[#E34D59]">
              禁用后该设备的所有认证请求（设备令牌 / MQTT 连接）都将被拒绝，直至重新启用。
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableTarget(null)} className="h-8 text-[13px]">取消</Button>
            <Button
              className="h-8 px-4 bg-[#E34D59] hover:bg-[#C9353F] text-white text-[13px]"
              disabled={statusMutation.isPending}
              onClick={() =>
                disableTarget && statusMutation.mutate({ deviceId: disableTarget.deviceId, action: "disable" })
              }
            >
              {statusMutation.isPending ? "处理中..." : "确认禁用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
