"use client";

import { useState } from "react";
import {
  Search, RefreshCw, Plus, MoreHorizontal, ChevronRight, Check,
} from "lucide-react";

const devices = [
  { name: "客厅温控器-01", product: "智能温控器", status: "online", lastOnline: "2025-08-25 10:30", firmware: "v2.1.3", created: "2025-08-15" },
  { name: "卧室温控器-02", product: "智能温控器", status: "online", lastOnline: "2025-08-25 10:28", firmware: "v2.1.3", created: "2025-08-15" },
  { name: "智能门锁-DL01", product: "智能门锁", status: "online", lastOnline: "2025-08-25 10:25", firmware: "v1.8.0", created: "2025-08-12" },
  { name: "网关设备-GW01", product: "工业网关", status: "online", lastOnline: "2025-08-25 10:32", firmware: "v2.3.1", created: "2025-08-10" },
  { name: "门禁传感器-D1", product: "智能门锁", status: "online", lastOnline: "2025-08-25 10:20", firmware: "v1.5.2", created: "2025-08-12" },
  { name: "智能灯控-LC01", product: "智能灯控", status: "offline", lastOnline: "2025-08-24 18:00", firmware: "v1.2.0", created: "2025-08-05" },
  { name: "烟感探测器-SM02", product: "环境传感器", status: "offline", lastOnline: "2025-08-24 09:00", firmware: "v1.0.5", created: "2025-08-08" },
  { name: "摄像头-CAM01", product: "智能门锁", status: "inactive", lastOnline: "—", firmware: "—", created: "2025-08-12" },
];

const statusConfig: Record<string, { dot: string; label: string; textColor: string; bg: string }> = {
  online: { dot: "tc-status-online", label: "在线", textColor: "text-[#2BA471]", bg: "bg-[#E8F8F0]" },
  offline: { dot: "tc-status-offline", label: "离线", textColor: "text-[#999]", bg: "bg-[#F3F4F6]" },
  inactive: { dot: "tc-status-inactive", label: "未激活", textColor: "text-[#E34D59]", bg: "bg-[#FDECEE]" },
};

type DeviceStatus = "all" | "online" | "offline" | "inactive";

export function DeviceListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeviceStatus>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const totalCount = devices.length;
  const onlineCount = devices.filter((d) => d.status === "online").length;
  const offlineCount = devices.filter((d) => d.status === "offline").length;
  const inactiveCount = devices.filter((d) => d.status === "inactive").length;

  const filtered = devices.filter((d) => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (search && !d.name.includes(search) && !d.product.includes(search)) return false;
    return true;
  });

  const toggleAll = () => {
    if (checked.size === filtered.length) setChecked(new Set());
    else setChecked(new Set(filtered.map((d) => d.name)));
  };
  const toggleOne = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索设备名称"
                className="pl-9 pr-3 h-[32px] w-[240px] text-[13px] border border-[#E5E6EB] rounded bg-[#F7F8FA] placeholder:text-[#BBBFC4] focus:outline-none focus:border-[#0052D9]"
              />
            </div>
            <div className="flex items-center gap-1">
              {(["all", "online", "offline", "inactive"] as DeviceStatus[]).map((s) => {
                const cfg = statusConfig[s];
                const isActive = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
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
            <button className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors">
              <RefreshCw className="w-4 h-4 text-[#666]" />
            </button>
            <button className="flex items-center gap-1.5 bg-[#0052D9] text-white text-[13px] px-3 h-[32px] rounded hover:bg-[#0045B8] transition-colors">
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
                    className={"w-4 h-4 rounded border flex items-center justify-center cursor-pointer " + (checked.size === filtered.length ? "bg-[#0052D9] border-[#0052D9]" : "border-[#C9CDD4] bg-white")}
                    onClick={toggleAll}
                  >
                    {checked.size === filtered.length && <Check className="w-3 h-3 text-white" />}
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
              {filtered.map((d) => {
                const cfg = statusConfig[d.status];
                return (
                  <tr key={d.name}>
                    <td>
                      <div
                        className={"w-4 h-4 rounded border flex items-center justify-center cursor-pointer " + (checked.has(d.name) ? "bg-[#0052D9] border-[#0052D9]" : "border-[#C9CDD4] bg-white")}
                        onClick={() => toggleOne(d.name)}
                      >
                        {checked.has(d.name) && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </td>
                    <td className="text-[14px] font-medium text-[#333]">{d.name}</td>
                    <td className="text-[13px] text-[#666]">{d.product}</td>
                    <td>
                      <span className={"tc-badge " + cfg.bg + " " + cfg.textColor}>
                        <span className={"tc-status-dot " + cfg.dot} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="text-[13px] text-[#888]">{d.lastOnline}</td>
                    <td className="text-[13px] text-[#666] font-mono">{d.firmware}</td>
                    <td className="text-[13px] text-[#888]">{d.created}</td>
                    <td>
                      <button className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors">
                        <MoreHorizontal className="w-4 h-4 text-[#999]" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E6EB]">
          <span className="text-[12px] text-[#999]">共 {filtered.length} 条记录</span>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded text-[13px] bg-[#0052D9] text-white">1</button>
          </div>
        </div>
      </div>
    </div>
  );
}
