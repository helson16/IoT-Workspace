"use client";

import { Inbox, ArrowUpRight, ArrowDownRight, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const mockTopics = [
  { name: "$thing/up/TH-SENSOR-001/+/property/post", type: "设备上报", messages: 12847, lastActive: "2秒前" },
  { name: "$thing/down/TH-SENSOR-001/+/property/post", type: "云端下发", messages: 3245, lastActive: "15秒前" },
  { name: "$thing/up/LOCK-001/+/event", type: "设备事件", messages: 892, lastActive: "1分钟前" },
  { name: "$thing/up/GW-V2-001/+/data", type: "网关数据", messages: 45210, lastActive: "5秒前" },
];

const recentMessages = [
  { id: "1", topic: "$thing/up/TH-SENSOR-001/dev001/property/post", direction: "up", payload: '{"temp_val": 23.5, "hum_val": 65.2}', time: "2025-08-25 11:09:32" },
  { id: "2", topic: "$thing/up/GW-V2-001/gw001/data", direction: "up", payload: '{"devices": 5, "rssi": -45}', time: "2025-08-25 11:09:28" },
  { id: "3", topic: "$thing/down/LOCK-001/dev003/property/post", direction: "down", payload: '{"lock_cmd": "unlock"}', time: "2025-08-25 11:09:15" },
  { id: "4", topic: "$thing/up/LOCK-001/dev003/event", direction: "up", payload: '{"event": "door_opened", "user": "admin"}', time: "2025-08-25 11:09:12" },
  { id: "5", topic: "$thing/up/TH-SENSOR-001/dev005/property/post", direction: "up", payload: '{"temp_val": 25.1, "hum_val": 58.7}', time: "2025-08-25 11:09:05" },
  { id: "6", topic: "$thing/up/SMOKE-001/dev012/event", direction: "up", payload: '{"event": "smoke_detected", "level": 2}', time: "2025-08-25 11:08:58" },
  { id: "7", topic: "$thing/down/TH-SENSOR-001/dev002/property/post", direction: "down", payload: '{"rpt_int": 60}', time: "2025-08-25 11:08:45" },
];

export function MessageQueuePage() {
  return (
    <div className="space-y-4">
      {/* Topic Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Topics */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">消息主题</h3>
            <span className="text-[12px] text-[#888]">{mockTopics.length} 个主题</span>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {mockTopics.map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3 border-b border-[#F0F0F0] last:border-0 hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="min-w-0 flex-1 mr-4">
                  <div className="text-[13px] text-[#333] font-mono truncate">{t.name}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="tc-badge bg-[#F3F4F6] text-[#666]">{t.type}</span>
                    <span className="text-[12px] text-[#888]">{t.lastActive}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[16px] font-semibold text-[#333]">{t.messages.toLocaleString()}</div>
                  <div className="text-[11px] text-[#888]">消息数</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Messages */}
        <div className="bg-white rounded border border-[#E5E6EB]">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E6EB]">
            <h3 className="text-[14px] font-medium text-[#333]">最新消息</h3>
            <Button variant="outline" size="sm" className="h-7 text-[12px] gap-1 border-[#E5E6EB]">
              <Filter className="w-3 h-3" /> 筛选
            </Button>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {recentMessages.map((msg) => (
              <div
                key={msg.id}
                className="px-5 py-3 border-b border-[#F0F0F0] last:border-0 hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {msg.direction === "up" ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#2BA471]" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-[#0052D9]" />
                    )}
                    <span className="text-[12px] font-mono text-[#666] truncate max-w-[280px]">
                      {msg.topic}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#BBBFC4] flex-shrink-0">{msg.time.split(" ")[1]}</span>
                </div>
                <pre className="text-[12px] text-[#888] font-mono bg-[#F7F8FA] rounded p-2 mt-1.5 overflow-x-auto">
                  {msg.payload}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
