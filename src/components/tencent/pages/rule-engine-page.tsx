"use client";

import { useState } from "react";
import { Plus, ToggleLeft, ToggleRight, Play, Pause, Edit2, Trash2 } from "lucide-react";
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

const mockRules = [
  { id: "r1", name: "温度告警规则", description: "温度超过40°C时触发告警", source: "$thing/up/TH-SENSOR-001/+/property/post", target: "告警中心", status: "enabled", triggerCount: 142, lastTriggered: "2分钟前" },
  { id: "r2", name: "数据转发至COS", description: "所有设备数据存储至对象存储", source: "$thing/up/+/+/property/post", target: "腾讯云COS", status: "enabled", triggerCount: 89234, lastTriggered: "5秒前" },
  { id: "r3", name: "离线设备检测", description: "设备离线超过10分钟时通知", source: "设备状态变更", target: "消息推送", status: "enabled", triggerCount: 23, lastTriggered: "1小时前" },
  { id: "r4", name: "门锁事件记录", description: "记录所有门锁操作事件到CKafka", source: "$thing/up/LOCK-001/+/event", target: "CKafka", status: "disabled", triggerCount: 567, lastTriggered: "3小时前" },
  { id: "r5", name: "烟雾告警联动", description: "烟雾报警时自动通知消防系统", source: "$thing/up/SMOKE-001/+/event", target: "SCF云函数", status: "enabled", triggerCount: 8, lastTriggered: "2天前" },
];

export function RuleEnginePage() {
  const [rules, setRules] = useState(mockRules);
  const [createOpen, setCreateOpen] = useState(false);

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: r.status === "enabled" ? "disabled" : "enabled" } : r
      )
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#888]">
          共 {rules.length} 条规则，{rules.filter((r) => r.status === "enabled").length} 条启用
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          创建规则
        </Button>
      </div>

      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              "bg-white rounded border p-5 transition-all",
              rule.status === "enabled" ? "border-[#E5E6EB]" : "border-[#E5E6EB] opacity-60"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 mr-4">
                <div className="flex items-center gap-3">
                  <h4 className="text-[14px] font-medium text-[#333]">{rule.name}</h4>
                  <span
                    className={cn(
                      "tc-badge",
                      rule.status === "enabled" ? "bg-[#E8F8F0] text-[#2BA471]" : "bg-[#F3F4F6] text-[#888]"
                    )}
                  >
                    {rule.status === "enabled" ? "已启用" : "已禁用"}
                  </span>
                </div>
                <p className="text-[12px] text-[#888] mt-1">{rule.description}</p>
                <div className="flex items-center gap-4 mt-3 text-[12px] text-[#888]">
                  <span>数据源：<span className="text-[#666] font-mono">{rule.source}</span></span>
                  <span>转发至：<span className="text-[#666]">{rule.target}</span></span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[12px] text-[#BBBFC4]">
                  <span>触发次数：{rule.triggerCount.toLocaleString()}</span>
                  <span>最近触发：{rule.lastTriggered}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded transition-colors",
                    rule.status === "enabled"
                      ? "text-[#2BA471] hover:bg-[#E8F8F0]"
                      : "text-[#BBBFC4] hover:bg-[#F3F4F6]"
                  )}
                >
                  {rule.status === "enabled" ? (
                    <ToggleRight className="w-5 h-5" />
                  ) : (
                    <ToggleLeft className="w-5 h-5" />
                  )}
                </button>
                <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Rule Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">创建规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">规则名称 <span className="text-[#E34D59]">*</span></label>
              <Input placeholder="请输入规则名称" className="h-8 text-[13px]" />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">规则描述</label>
              <Input placeholder="规则描述（可选）" className="h-8 text-[13px]" />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">数据源主题</label>
              <Input placeholder="$thing/up/+/+/property/post" className="h-8 text-[13px] font-mono" />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">转发目标</label>
              <Input placeholder="如：告警中心、COS、CKafka、SCF" className="h-8 text-[13px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="h-8 text-[13px]">取消</Button>
            <Button className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]">确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
