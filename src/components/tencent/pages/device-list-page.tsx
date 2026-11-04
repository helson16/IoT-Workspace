"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type DeviceItem } from "@/lib/api/client";
import { useAppStore } from "@/stores/app-store";
import {
  Search, RefreshCw, Plus, MoreHorizontal, ChevronRight, ChevronLeft, Check, X,
} from "lucide-react";

const statusConfig: Record<string, { dot: string; label: string; textColor: string; bg: string }> = {
  online: { dot: "tc-status-online", label: "在线", textColor: "text-[#2BA471]", bg: "bg-[#E8F8F0]" },
  offline: { dot: "tc-status-offline", label: "离线", textColor: "text-[#999]", bg: "bg-[#F3F4F6]" },
  "not-activated": { dot: "tc-status-inactive", label: "未激活", textColor: "text-[#E34D59]", bg: "bg-[#FDECEE]" },
  disabled: { dot: "tc-status-inactive", label: "已禁用", textColor: "text-[#E34D59]", bg: "bg-[#FDECEE]" },
};

type DeviceStatus = "all" | "online" | "offline" | "not-activated";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function DeviceListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeviceStatus>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [formError, setFormError] = useState("");
  const [registeredSecret, setRegisteredSecret] = useState<{ name: string; secret: string } | null>(null);

  const queryClient = useQueryClient();
  const { setSelectedDeviceId } = useAppStore();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["devices", { status: statusFilter === "all" ? undefined : statusFilter, keyword: search || undefined, page }],
    queryFn: () =>
      api.getDevices({
        page,
        page_size: 50,
        status: statusFilter === "all" ? undefined : statusFilter,
        keyword: search || undefined,
      }),
    refetchInterval: 10_000,
  });

  const { data: productsData } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.getProducts(1, 100),
  });

  const registerMutation = useMutation({
    mutationFn: () => api.registerDevice(selectedProduct, deviceName.trim()),
    onSuccess: (result) => {
      setRegisteredSecret({ name: result.deviceName, secret: result.deviceSecret });
      setDeviceName("");
      setFormError("");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => setFormError(e instanceof ApiError ? e.message : e.message),
  });

  const devices: DeviceItem[] = data?.items ?? [];
  const counts = data?.status_counts ?? {};
  const totalCount = data?.total ?? 0;
  const onlineCount = counts["online"] ?? 0;
  const offlineCount = counts["offline"] ?? 0;
  const inactiveCount = counts["not-activated"] ?? 0;

  const toggleAll = () => {
    if (checked.size === devices.length) setChecked(new Set());
    else setChecked(new Set(devices.map((d) => d.deviceId)));
  };
  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inputCls =
    "h-[32px] w-full text-[13px] border border-[#E5E6EB] rounded px-3 bg-white placeholder:text-[#BBBFC4] focus:outline-none focus:border-[#0052D9]";

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-[#888]">
        <span>物联网开发平台</span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span>设备接入</span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#333]">设备管理</span>
      </div>

      {/* Page Title */}
      <h2 className="text-[20px] font-semibold text-[#1E293B]">设备管理</h2>

      {/* Status Stats Bar */}
      <div className="flex items-center gap-6 text-[13px] text-[#666]">
        <span className="flex items-center gap-1.5">
          <span className="w-[6px] h-[6px] rounded-full bg-[#0052D9]" />
          设备总数 <b className="text-[#333]">{totalCount}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="tc-status-online" />
          在线 <b className="text-[#2BA471]">{onlineCount}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="tc-status-offline" />
          离线 <b>{offlineCount}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="tc-status-inactive" />
          未激活 <b className="text-[#E34D59]">{inactiveCount}</b>
        </span>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E6EB]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#BBBFC4]" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索设备名称"
                className="pl-9 pr-3 h-[32px] w-[240px] text-[13px] border border-[#E5E6EB] rounded bg-[#F7F8FA] placeholder:text-[#BBBFC4] focus:outline-none focus:border-[#0052D9]"
              />
            </div>
            <div className="flex items-center gap-1">
              {(["all", "online", "offline", "not-activated"] as DeviceStatus[]).map((s) => {
                const cfg = statusConfig[s];
                const isActive = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={
                      "px-3 h-[32px] rounded text-[13px] border transition-colors " +
                      (isActive
                        ? "bg-[#0052D9] text-white border-[#0052D9]"
                        : "bg-white text-[#666] border-[#E5E6EB] hover:border-[#0052D9] hover:text-[#0052D9]")
                    }
                  >
                    {s === "all" ? "全部" : cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors"
              title="刷新"
            >
              <RefreshCw className={"w-4 h-4 text-[#666] " + (isFetching ? "animate-spin" : "")} />
            </button>
            <button
              onClick={() => { setRegisterOpen(true); setFormError(""); setRegisteredSecret(null); }}
              className="flex items-center gap-1.5 bg-[#0052D9] text-white text-[13px] px-3 h-[32px] rounded hover:bg-[#0045B8] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 注册设备
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th style={{ width: "40px" }}>
                  <div
                    className={"w-4 h-4 rounded border flex items-center justify-center cursor-pointer " + (checked.size === devices.length && devices.length > 0 ? "bg-[#0052D9] border-[#0052D9]" : "border-[#C9CDD4] bg-white")}
                    onClick={toggleAll}
                  >
                    {checked.size === devices.length && devices.length > 0 && <Check className="w-3 h-3 text-white" />}
                  </div>
                </th>
                <th>设备名称</th>
                <th>所属产品</th>
                <th>状态</th>
                <th>最后上线时间</th>
                <th>固件版本</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}><div className="h-4 bg-[#F3F4F6] rounded animate-pulse w-4/5" /></td>
                    ))}
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={8}>
                    <div className="py-10 text-center">
                      <div className="text-[13px] text-[#E34D59] mb-2">数据加载失败: {(error as Error)?.message}</div>
                      <button onClick={() => refetch()} className="text-[13px] text-[#0052D9] hover:underline">重新加载</button>
                    </div>
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="py-12 text-center text-[13px] text-[#BBBFC4]">
                      {search || statusFilter !== "all" ? "未找到匹配的设备" : "暂无设备, 点击右上角「注册设备」添加"}
                    </div>
                  </td>
                </tr>
              ) : (
                devices.map((d) => {
                  const cfg = statusConfig[d.status] ?? statusConfig.offline;
                  return (
                    <tr key={d.deviceId} className="cursor-pointer" onClick={() => setSelectedDeviceId(d.deviceId)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div
                          className={"w-4 h-4 rounded border flex items-center justify-center cursor-pointer " + (checked.has(d.deviceId) ? "bg-[#0052D9] border-[#0052D9]" : "border-[#C9CDD4] bg-white")}
                          onClick={() => toggleOne(d.deviceId)}
                        >
                          {checked.has(d.deviceId) && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </td>
                      <td className="text-[14px] font-medium text-[#333]">{d.deviceName}</td>
                      <td className="text-[13px] text-[#666]">{d.productName}</td>
                      <td>
                        <span className={"tc-badge " + cfg.bg + " " + cfg.textColor}>
                          <span className={"tc-status-dot " + cfg.dot} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="text-[13px] text-[#888]">{formatDateTime(d.lastLoginAt)}</td>
                      <td className="text-[13px] text-[#666] font-mono">{d.firmwareVersion || "—"}</td>
                      <td className="text-[13px] text-[#888]">{formatDateTime(d.createdAt).split(" ")[0]}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors"
                          onClick={() => setSelectedDeviceId(d.deviceId)}
                          title="查看详情"
                        >
                          <MoreHorizontal className="w-4 h-4 text-[#999]" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E6EB]">
          <span className="text-[12px] text-[#999]">
            共 {totalCount} 条记录{data ? `, 第 ${page}/${Math.max(1, Math.ceil(totalCount / data.page_size))} 页` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setPage((p) => Math.max(1, p - 1)); setChecked(new Set()); }}
              disabled={page <= 1 || isLoading}
              className="px-3 h-7 flex items-center gap-1 rounded border border-[#E5E6EB] text-[12px] text-[#666] hover:border-[#0052D9] hover:text-[#0052D9] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E5E6EB] disabled:hover:text-[#666] transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> 上一页
            </button>
            <button
              onClick={() => { setPage((p) => p + 1); setChecked(new Set()); }}
              disabled={!data || page >= Math.ceil(totalCount / data.page_size) || isLoading}
              className="px-3 h-7 flex items-center gap-1 rounded border border-[#E5E6EB] text-[12px] text-[#666] hover:border-[#0052D9] hover:text-[#0052D9] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E5E6EB] disabled:hover:text-[#666] transition-colors"
            >
              下一页 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Register Device Dialog */}
      {registerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRegisterOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-[480px]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E6EB]">
              <h3 className="text-[16px] font-semibold text-[#333]">注册设备</h3>
              <button onClick={() => setRegisterOpen(false)} className="p-1 rounded hover:bg-[#F3F4F6]">
                <X className="w-4 h-4 text-[#999]" />
              </button>
            </div>

            {registeredSecret ? (
              <div className="px-6 py-5">
                <div className="text-[13px] text-[#2BA471] bg-[#E8F8F0] rounded px-3 py-2 mb-4">
                  ✓ 设备「{registeredSecret.name}」注册成功! 设备密钥仅展示一次, 请妥善保管:
                </div>
                <div className="bg-[#F7F8FA] rounded p-3 font-mono text-[12px] text-[#333] break-all border border-[#E5E6EB]">
                  {registeredSecret.secret}
                </div>
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => setRegisterOpen(false)}
                    className="px-4 h-[32px] text-[13px] bg-[#0052D9] text-white rounded hover:bg-[#0045B8]"
                  >
                    完成
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-[13px] text-[#666] mb-1.5">
                      所属产品 <span className="text-[#E34D59]">*</span>
                    </label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">请选择产品</option>
                      {(productsData?.items ?? []).map((p) => (
                        <option key={p.productId} value={p.productId}>
                          {p.productName} ({p.productId})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] text-[#666] mb-1.5">
                      设备名称 <span className="text-[#E34D59]">*</span>
                    </label>
                    <input
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      placeholder="仅字母/数字/中划线/下划线, 如: thermo-05"
                      className={inputCls + " font-mono"}
                    />
                  </div>
                  {formError && (
                    <div className="text-[12px] text-[#E34D59] bg-[#FDECEE] rounded px-3 py-2">{formError}</div>
                  )}
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#E5E6EB]">
                  <button
                    onClick={() => setRegisterOpen(false)}
                    className="px-4 h-[32px] text-[13px] border border-[#E5E6EB] rounded text-[#666] hover:border-[#0052D9] hover:text-[#0052D9]"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedProduct) { setFormError("请选择所属产品"); return; }
                      if (!deviceName.trim()) { setFormError("设备名称不能为空"); return; }
                      registerMutation.mutate();
                    }}
                    disabled={registerMutation.isPending}
                    className="px-4 h-[32px] text-[13px] bg-[#0052D9] text-white rounded hover:bg-[#0045B8] disabled:opacity-60"
                  >
                    {registerMutation.isPending ? "注册中..." : "确定"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
