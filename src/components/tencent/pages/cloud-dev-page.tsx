"use client";

import { FileCode2, Terminal, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const mockFunctions = [
  { name: "device_data_handler", runtime: "Node.js 16", memory: "128MB", timeout: "3s", triggers: 45210, status: "running", lastDeploy: "2025-08-20 14:30" },
  { name: "alert_notification", runtime: "Python 3.9", memory: "256MB", timeout: "5s", triggers: 142, status: "running", lastDeploy: "2025-08-18 09:15" },
  { name: "data_aggregator", runtime: "Node.js 16", memory: "512MB", timeout: "10s", triggers: 8920, status: "stopped", lastDeploy: "2025-08-15 16:00" },
];

export function CloudDevPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#888]">
          云函数开发环境，支持设备数据的云端处理逻辑
        </div>
        <Button className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5">
          <FileCode2 className="w-3.5 h-3.5" />
          新建函数
        </Button>
      </div>

      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th>函数名称</th>
                <th>运行环境</th>
                <th>内存</th>
                <th>超时</th>
                <th>触发次数</th>
                <th>状态</th>
                <th>最近部署</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {mockFunctions.map((fn) => (
                <tr key={fn.name}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[#0052D9]" />
                      <span className="font-medium text-[#333] font-mono">{fn.name}</span>
                    </div>
                  </td>
                  <td><span className="tc-badge bg-[#F0EDFF] text-[#7B61FF]">{fn.runtime}</span></td>
                  <td><span className="text-[13px] text-[#666]">{fn.memory}</span></td>
                  <td><span className="text-[13px] text-[#666]">{fn.timeout}</span></td>
                  <td><span className="text-[13px] text-[#333]">{fn.triggers.toLocaleString()}</span></td>
                  <td>
                    <span className={cn(
                      "tc-badge",
                      fn.status === "running" ? "bg-[#E8F8F0] text-[#2BA471]" : "bg-[#F3F4F6] text-[#888]"
                    )}>
                      {fn.status === "running" ? "运行中" : "已停止"}
                    </span>
                  </td>
                  <td><span className="text-[13px] text-[#888]">{fn.lastDeploy}</span></td>
                  <td>
                    <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
