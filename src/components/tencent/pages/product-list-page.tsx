"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Product } from "@/lib/api/client";
import {
  Search, RefreshCw, Download, Plus, MoreHorizontal, Trash2,
  Monitor, ChevronRight, X,
} from "lucide-react";

const nodeTypeLabel: Record<string, string> = {
  device: "直连设备",
  gateway: "网关设备",
  "sub-device": "子设备",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("zh-CN");
}

export function ProductListPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  // 表单状态
  const [form, setForm] = useState({
    product_name: "",
    category: "",
    protocol_type: "MQTT",
    network_type: "WiFi",
    node_type: "device",
    description: "",
  });
  const [formError, setFormError] = useState("");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.getProducts(1, 50),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createProduct({
        product_name: form.product_name.trim(),
        category: form.category.trim() || undefined,
        protocol_type: form.protocol_type,
        network_type: form.network_type,
        node_type: form.node_type,
        description: form.description.trim() || undefined,
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ product_name: "", category: "", protocol_type: "MQTT", network_type: "WiFi", node_type: "device", description: "" });
      setFormError("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e: Error) => setFormError(e instanceof ApiError ? e.message : e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (productId: string) => api.deleteProduct(productId),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const products = data?.items ?? [];
  const filtered = products.filter(
    (p) => !search || p.productName.includes(search) || (p.category ?? "").includes(search)
  );

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
        <span className="text-[#333]">产品管理</span>
      </div>

      {/* Page Title + Actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-semibold text-[#1E293B]">产品管理</h2>
        <button
          onClick={() => { setCreateOpen(true); setFormError(""); }}
          className="flex items-center gap-1.5 bg-[#0052D9] text-white text-[14px] px-4 h-[32px] rounded hover:bg-[#0045B8] transition-colors"
        >
          <Plus className="w-4 h-4" /> 新建产品
        </button>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E6EB]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#BBBFC4]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索产品名称或品类"
              className="pl-9 pr-3 h-[32px] w-[280px] text-[13px] border border-[#E5E6EB] rounded bg-[#F7F8FA] placeholder:text-[#BBBFC4] focus:outline-none focus:border-[#0052D9]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-[13px] text-[#666] hover:text-[#333] px-3 h-[32px]"
            >
              <RefreshCw className={"w-3.5 h-3.5 " + (isFetching ? "animate-spin" : "")} /> 刷新
            </button>
            <button className="flex items-center gap-1.5 text-[13px] text-[#666] hover:text-[#333] px-3 h-[32px]">
              <Download className="w-3.5 h-3.5" /> 导出
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th style={{ width: "18%" }}>产品名称</th>
                <th style={{ width: "14%" }}>产品ID</th>
                <th style={{ width: "12%" }}>设备类型</th>
                <th style={{ width: "10%" }}>通信协议</th>
                <th style={{ width: "10%" }}>设备数</th>
                <th style={{ width: "10%" }}>在线数</th>
                <th style={{ width: "14%" }}>创建时间</th>
                <th style={{ width: "12%" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
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
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="py-12 text-center text-[13px] text-[#BBBFC4]">
                      {search ? "未找到匹配的产品" : "暂无产品, 点击右上角「新建产品」创建"}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Monitor className="w-5 h-5 text-[#0052D9] flex-shrink-0" />
                        <div>
                          <div className="text-[14px] font-medium text-[#333]">{p.productName}</div>
                          <div className="text-[12px] text-[#999]">({p.category})</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-[13px] text-[#888] bg-[#F7F8FA] px-2 py-0.5 rounded font-mono">
                        {p.productId}
                      </span>
                    </td>
                    <td className="text-[13px] text-[#666]">
                      {nodeTypeLabel[p.nodeType] ?? p.nodeType}
                      {p.nodeType === "gateway" && (
                        <span className="inline-block ml-1 w-3.5 h-3.5 rounded-full border border-[#0052D9]" title="网关设备" />
                      )}
                    </td>
                    <td>
                      <span className={"tc-badge " + (p.protocolType === "MQTT" ? "tc-badge-mqtt" : p.protocolType === "CoAP" ? "tc-badge-coap" : "tc-badge-http")}>
                        {p.protocolType}
                      </span>
                    </td>
                    <td className="text-[14px] font-medium text-[#333] text-center">{p.deviceCount ?? 0}</td>
                    <td className="text-center">
                      <span className="text-[14px] font-medium text-[#2BA471]">{p.onlineCount ?? 0}</span>
                      <span className="text-[13px] text-[#999]"> / {p.deviceCount ?? 0}</span>
                    </td>
                    <td className="text-[13px] text-[#888]">{formatDate(p.createdAt)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors"
                          title="删除产品"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="w-4 h-4 text-[#999] hover:text-[#E34D59]" />
                        </button>
                        <button className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors" title="更多">
                          <MoreHorizontal className="w-4 h-4 text-[#999]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E6EB]">
          <span className="text-[12px] text-[#999]">共 {filtered.length} 条记录</span>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded text-[13px] bg-[#0052D9] text-white">1</button>
            <span className="text-[12px] text-[#999] px-1">/</span>
            <span className="text-[12px] text-[#999] px-1">1 页</span>
          </div>
        </div>
      </div>

      {/* Create Product Dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCreateOpen(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E6EB]">
              <h3 className="text-[16px] font-semibold text-[#333]">新建产品</h3>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded hover:bg-[#F3F4F6]">
                <X className="w-4 h-4 text-[#999]" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">
                  产品名称 <span className="text-[#E34D59]">*</span>
                </label>
                <input
                  value={form.product_name}
                  onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                  placeholder="如: 智能温控器"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">产品品类</label>
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="如: 智能家电"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">设备类型</label>
                  <select
                    value={form.node_type}
                    onChange={(e) => setForm({ ...form, node_type: e.target.value })}
                    className={inputCls}
                  >
                    <option value="device">直连设备</option>
                    <option value="gateway">网关设备</option>
                    <option value="sub-device">子设备</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">通信协议</label>
                  <select
                    value={form.protocol_type}
                    onChange={(e) => setForm({ ...form, protocol_type: e.target.value })}
                    className={inputCls}
                  >
                    <option>MQTT</option>
                    <option>CoAP</option>
                    <option>HTTP</option>
                    <option>WebSocket</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">联网方式</label>
                  <select
                    value={form.network_type}
                    onChange={(e) => setForm({ ...form, network_type: e.target.value })}
                    className={inputCls}
                  >
                    <option>WiFi</option>
                    <option>Cellular</option>
                    <option>Ethernet</option>
                    <option>BLE</option>
                    <option>LoRa</option>
                    <option>NB-IoT</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">产品描述</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="简要描述产品功能"
                  rows={3}
                  className="w-full text-[13px] border border-[#E5E6EB] rounded px-3 py-2 bg-white placeholder:text-[#BBBFC4] focus:outline-none focus:border-[#0052D9] resize-none"
                />
              </div>
              {formError && (
                <div className="text-[12px] text-[#E34D59] bg-[#FDECEE] rounded px-3 py-2">{formError}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#E5E6EB]">
              <button
                onClick={() => setCreateOpen(false)}
                className="px-4 h-[32px] text-[13px] border border-[#E5E6EB] rounded text-[#666] hover:border-[#0052D9] hover:text-[#0052D9] transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!form.product_name.trim()) {
                    setFormError("产品名称不能为空");
                    return;
                  }
                  createMutation.mutate();
                }}
                disabled={createMutation.isPending}
                className="px-4 h-[32px] text-[13px] bg-[#0052D9] text-white rounded hover:bg-[#0045B8] transition-colors disabled:opacity-60"
              >
                {createMutation.isPending ? "创建中..." : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-[400px]">
            <div className="px-6 py-5">
              <h3 className="text-[15px] font-semibold text-[#333] mb-2">确认删除产品</h3>
              <p className="text-[13px] text-[#666]">
                将删除产品「{deleteTarget.productName}」及其下所有设备、物模型与影子数据, 此操作不可恢复。
              </p>
              {deleteMutation.isError && (
                <div className="text-[12px] text-[#E34D59] mt-2">
                  删除失败: {(deleteMutation.error as Error)?.message}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#E5E6EB]">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 h-[32px] text-[13px] border border-[#E5E6EB] rounded text-[#666] hover:border-[#0052D9] hover:text-[#0052D9]"
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.productId)}
                disabled={deleteMutation.isPending}
                className="px-4 h-[32px] text-[13px] bg-[#E34D59] text-white rounded hover:bg-[#C9353F] disabled:opacity-60"
              >
                {deleteMutation.isPending ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
