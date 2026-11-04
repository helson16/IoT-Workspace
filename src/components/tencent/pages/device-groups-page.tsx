"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Cpu } from "lucide-react";
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

interface Group {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  _count: { devices: number };
}

const presetColors = [
  "#0052D9", "#2BA471", "#ED7B2F", "#E34D59",
  "#7B61FF", "#00A870", "#EC7259", "#3491FA",
];

export function DeviceGroupsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", color: "#0052D9" });

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: () => fetch("/api/groups").then((r) => r.json()),
  });

  const openCreate = () => {
    setEditId(null);
    setForm({ name: "", description: "", color: "#0052D9" });
    setDialogOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditId(g.id);
    setForm({ name: g.name, description: g.description || "", color: g.color });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const url = editId ? `/api/groups/${editId}` : "/api/groups";
      const method = editId ? "PUT" : "POST";
      return fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/groups/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const groupList: Group[] = groups || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#888]">
          共 {groupList.length} 个分组
        </div>
        <Button
          onClick={openCreate}
          className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新建分组
        </Button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded border border-[#E5E6EB] py-20 text-center text-[13px] text-[#BBBFC4] animate-pulse">
          加载中...
        </div>
      ) : groupList.length === 0 ? (
        <div className="bg-white rounded border border-[#E5E6EB] py-20 text-center text-[13px] text-[#BBBFC4]">
          暂无分组
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groupList.map((group: Group) => (
            <div
              key={group.id}
              className="bg-white rounded border border-[#E5E6EB] p-5 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: group.color + "18" }}
                  >
                    <Cpu className="w-4 h-4" style={{ color: group.color }} />
                  </div>
                  <div>
                    <div className="text-[14px] font-medium text-[#333]">
                      {group.name}
                    </div>
                    <div className="text-[12px] text-[#888] mt-0.5">
                      {group._count?.devices || 0} 个设备
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(group)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(group.id)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {group.description && (
                <p className="text-[12px] text-[#888] mt-3 line-clamp-2">
                  {group.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">
              {editId ? "编辑分组" : "新建分组"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">
                分组名称 <span className="text-[#E34D59]">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入分组名称"
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">描述</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="分组描述（可选）"
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">颜色</label>
              <div className="flex items-center gap-2">
                {presetColors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      "w-7 h-7 rounded-full transition-all",
                      form.color === c ? "ring-2 ring-offset-2 ring-[#0052D9]" : ""
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-8 text-[13px]">
              取消
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.name || saveMutation.isPending}
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
