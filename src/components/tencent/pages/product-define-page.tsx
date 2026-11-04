"use client";

import { useState } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Mock property definitions
const mockProperties = [
  { id: "1", name: "temperature", identifier: "temp_val", type: "float", unit: "°C", accessMode: "rw", description: "当前温度值" },
  { id: "2", name: "humidity", identifier: "hum_val", type: "float", unit: "%", accessMode: "r", description: "当前湿度值" },
  { id: "3", name: "battery", identifier: "battery", type: "int", unit: "%", accessMode: "r", description: "电池电量" },
  { id: "4", name: "report_interval", identifier: "rpt_int", type: "int", unit: "s", accessMode: "rw", description: "上报间隔" },
  { id: "5", name: "status", identifier: "dev_status", type: "enum", unit: "—", accessMode: "r", description: "设备工作状态" },
];

const typeLabels: Record<string, string> = {
  int: "整数型",
  float: "浮点型",
  string: "字符串",
  bool: "布尔型",
  enum: "枚举型",
  date: "日期型",
};

const typeColors: Record<string, string> = {
  int: "bg-[#E6F0FF] text-[#0052D9]",
  float: "bg-[#E8F8F0] text-[#00A870]",
  string: "bg-[#FFF3E8] text-[#ED7B2F]",
  bool: "bg-[#F0EDFF] text-[#7B61FF]",
  enum: "bg-[#FDECEE] text-[#E34D59]",
  date: "bg-[#F3F4F6] text-[#666]",
};

export function ProductDefinePage() {
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", identifier: "", type: "float", unit: "", accessMode: "rw", description: "",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-medium text-[#333]">智能温湿度传感器 — TH-SENSOR-001</h3>
          <p className="text-[12px] text-[#888] mt-0.5">定义产品的属性、事件和服务</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新增属性
        </Button>
      </div>

      {/* Property Table */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3 border-b border-[#E5E6EB] flex items-center gap-4">
          <span className="text-[14px] font-medium text-[#333]">属性定义</span>
          <span className="text-[12px] text-[#888]">{mockProperties.length} 个属性</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th>属性名称</th>
                <th>标识符</th>
                <th>数据类型</th>
                <th>单位</th>
                <th>读写类型</th>
                <th>描述</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {mockProperties.map((prop) => (
                <tr key={prop.id}>
                  <td className="font-medium text-[#333]">{prop.name}</td>
                  <td><code className="text-[12px] text-[#666] bg-[#F7F8FA] px-1.5 py-0.5 rounded font-mono">{prop.identifier}</code></td>
                  <td><span className={cn("tc-badge", typeColors[prop.type])}>{typeLabels[prop.type]}</span></td>
                  <td><span className="text-[13px] text-[#666]">{prop.unit}</span></td>
                  <td><span className="text-[13px] text-[#666]">{prop.accessMode === "rw" ? "读写" : "只读"}</span></td>
                  <td><span className="text-[13px] text-[#888]">{prop.description}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Property Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">新增属性</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">属性名称 <span className="text-[#E34D59]">*</span></label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：temperature" className="h-8 text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">标识符 <span className="text-[#E34D59]">*</span></label>
                <Input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="如：temp_val" className="h-8 text-[13px]" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">数据类型</label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">单位</label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="如：°C" className="h-8 text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">读写类型</label>
                <Select value={form.accessMode} onValueChange={(v) => setForm({ ...form, accessMode: v })}>
                  <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rw">读写</SelectItem>
                    <SelectItem value="r">只读</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">描述</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="属性描述（可选）" className="h-8 text-[13px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="h-8 text-[13px]">取消</Button>
            <Button className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]">确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
