"use client";

import { useState } from "react";
import { Search, Download, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const mockLogs = [
  { id: "1", time: "2025-08-25 11:09:32.456", level: "INFO", device: "TH-SENSOR-001/dev001", action: "属性上报", detail: "temp_val=23.5, hum_val=65.2" },
  { id: "2", time: "2025-08-25 11:09:28.123", level: "INFO", device: "GW-V2-001/gw001", action: "数据上报", detail: "devices=5, rssi=-45" },
  { id: "3", time: "2025-08-25 11:09:15.789", level: "INFO", device: "LOCK-001/dev003", action: "命令下发", detail: "lock_cmd=unlock" },
  { id: "4", time: "2025-08-25 11:09:12.001", level: "WARN", device: "LOCK-001/dev003", action: "事件上报", detail: "door_opened by admin" },
  { id: "5", time: "2025-08-25 11:09:05.334", level: "INFO", device: "TH-SENSOR-001/dev005", action: "属性上报", detail: "temp_val=25.1, hum_val=58.7" },
  { id: "6", time: "2025-08-25 11:08:58.002", level: "ERROR", device: "SMOKE-001/dev012", action: "告警事件", detail: "smoke_detected, level=2" },
  { id: "7", time: "2025-08-25 11:08:45.456", level: "INFO", device: "TH-SENSOR-001/dev002", action: "命令下发", detail: "rpt_int=60" },
  { id: "8", time: "2025-08-25 11:08:30.000", level: "WARN", device: "TH-SENSOR-001/dev008", action: "设备重连", detail: "reconnect after 30s timeout" },
  { id: "9", time: "2025-08-25 11:08:12.567", level: "INFO", device: "LOCK-001/dev003", action: "属性上报", detail: "battery=85, lock_status=locked" },
  { id: "10", time: "2025-08-25 11:07:58.234", level: "ERROR", device: "SMOKE-001/dev015", action: "设备离线", detail: "connection timeout, last seen 10m ago" },
];

const levelStyle: Record<string, string> = {
  INFO: "bg-[#E6F0FF] text-[#0052D9]",
  WARN: "bg-[#FFF3E8] text-[#ED7B2F]",
  ERROR: "bg-[#FDECEE] text-[#E34D59]",
};

export function LogServicePage() {
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = mockLogs.filter((log) => {
    if (levelFilter !== "all" && log.level !== levelFilter) return false;
    if (search && !log.detail.includes(search) && !log.device.includes(search)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded border border-[#E5E6EB] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BBBFC4]" />
            <input
              type="text"
              placeholder="搜索日志内容、设备名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded border border-[#E5E6EB] text-[13px] text-[#333] placeholder:text-[#BBBFC4] outline-none focus:border-[#0052D9] transition-colors bg-[#F7F8FA]"
            />
          </div>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[110px] h-8 text-[13px]">
              <SelectValue placeholder="日志级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="INFO">INFO</SelectItem>
              <SelectItem value="WARN">WARN</SelectItem>
              <SelectItem value="ERROR">ERROR</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-8 text-[13px] gap-1.5 border-[#E5E6EB]">
            <Download className="w-3.5 h-3.5" /> 导出日志
          </Button>
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th style={{ width: 180 }}>时间</th>
                <th style={{ width: 70 }}>级别</th>
                <th style={{ width: 200 }}>设备</th>
                <th style={{ width: 100 }}>操作类型</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span className="text-[12px] font-mono text-[#888] flex items-center gap-1">
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      {log.time}
                    </span>
                  </td>
                  <td><span className={cn("tc-badge", levelStyle[log.level])}>{log.level}</span></td>
                  <td><code className="text-[12px] text-[#666] font-mono">{log.device}</code></td>
                  <td><span className="text-[13px] text-[#666]">{log.action}</span></td>
                  <td><span className="text-[12px] text-[#888] font-mono">{log.detail}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E6EB]">
          <span className="text-[12px] text-[#888]">共 {filtered.length} 条日志</span>
        </div>
      </div>
    </div>
  );
}