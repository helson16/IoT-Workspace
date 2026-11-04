"use client";

import { useState } from "react";
import {
  Search, RefreshCw, Download, Plus, MoreHorizontal,
  Monitor, ChevronRight,
} from "lucide-react";

const products = [
  { name: "智能温控器", category: "家电", id: "prod-001", type: "直连设备", protocol: "MQTT", total: 45, online: 38, created: "2025-08-15" },
  { name: "智能门锁", category: "安防", id: "prod-002", type: "直连设备", protocol: "MQTT", total: 32, online: 28, created: "2025-08-12" },
  { name: "工业网关", category: "工业", id: "prod-003", type: "网关设备", protocol: "CoAP", total: 12, online: 10, created: "2025-08-10" },
  { name: "环境传感器", category: "环境", id: "prod-004", type: "直连设备", protocol: "MQTT", total: 56, online: 42, created: "2025-08-08" },
  { name: "智能灯控", category: "照明", id: "prod-005", type: "直连设备", protocol: "HTTP", total: 73, online: 15, created: "2025-08-05" },
];

export function ProductListPage() {
  const [search, setSearch] = useState("");

  const filtered = products.filter(
    (p) => !search || p.name.includes(search) || p.category.includes(search)
  );

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
        <button className="flex items-center gap-1.5 bg-[#0052D9] text-white text-[14px] px-4 h-[32px] rounded hover:bg-[#0045B8] transition-colors">
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
            <button className="flex items-center gap-1.5 text-[13px] text-[#666] hover:text-[#333] px-3 h-[32px]">
              <RefreshCw className="w-3.5 h-3.5" /> 刷新
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
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Monitor className="w-5 h-5 text-[#0052D9] flex-shrink-0" />
                      <div>
                        <div className="text-[14px] font-medium text-[#333]">{p.name}</div>
                        <div className="text-[12px] text-[#999]">({p.category})</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="text-[13px] text-[#888] bg-[#F7F8FA] px-2 py-0.5 rounded font-mono">
                      {p.id}
                    </span>
                  </td>
                  <td className="text-[13px] text-[#666]">
                    {p.type}
                    {p.type === "网关设备" && (
                      <span className="inline-block ml-1 w-3.5 h-3.5 rounded-full border border-[#0052D9]" title="网关设备" />
                    )}
                  </td>
                  <td>
                    <span className={"tc-badge " + (p.protocol === "MQTT" ? "tc-badge-mqtt" : p.protocol === "CoAP" ? "tc-badge-coap" : "tc-badge-http")}>
                      {p.protocol}
                    </span>
                  </td>
                  <td className="text-[14px] font-medium text-[#333] text-center">{p.total}</td>
                  <td className="text-center">
                    <span className="text-[14px] font-medium text-[#2BA471]">{p.online}</span>
                    <span className="text-[13px] text-[#999]"> / {p.total}</span>
                  </td>
                  <td className="text-[13px] text-[#888]">{p.created}</td>
                  <td>
                    <button className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors">
                      <MoreHorizontal className="w-4 h-4 text-[#999]" />
                    </button>
                  </td>
                </tr>
              ))}
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
    </div>
  );
}
