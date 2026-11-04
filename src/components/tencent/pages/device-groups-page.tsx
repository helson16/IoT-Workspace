"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api, ApiError, type DeviceGroup, type GroupMemberDevice, type DeviceItem,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Edit2, Trash2, Cpu, RefreshCw, Users, Search, X,
} from "lucide-react";

const presetColors = [
  "#0052D9", "#2BA471", "#ED7B2F", "#E34D59",
  "#7B61FF", "#00A870", "#EC7259", "#3491FA",
];

const statusColors: Record<string, string> = {
  online: "bg-[#E8F8F0] text-[#00A870]",
  offline: "bg-[#F3F4F6] text-[#888]",
  "not-activated": "bg-[#FFF7E6] text-[#D48806]",
  disabled: "bg-[#FDECEE] text-[#E34D59]",
};

const statusLabels: Record<string, string> = {
  online: "在线", offline: "离线", "not-activated": "未激活", disabled: "已禁用",
};

export function DeviceGroupsPage() {
  const queryClient = useQueryClient();

  const { data: groups, isLoading, isError, error, refetch } = useQuery<DeviceGroup[]>({
    queryKey: ["device-groups"],
    queryFn: () => api.getDeviceGroups(),
  });

  // ---- 新建/编辑对话框 ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceGroup | null>(null);
  const [form, setForm] = useState({ name: "", description: "", color: "#0052D9" });
  const [formError, setFormError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", color: "#0052D9" });
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (g: DeviceGroup) => {
    setEditing(g);
    setForm({ name: g.name, description: g.description || "", color: g.color });
    setFormError("");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.updateDeviceGroup(editing.id, {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            color: form.color,
          })
        : api.createDeviceGroup({
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            color: form.color,
          }),
    onSuccess: () => {
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["device-groups"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 40903) {
        setFormError(`分组名称「${form.name.trim()}」已存在`);
      } else if (e instanceof ApiError && e.details?.length) {
        setFormError(e.details.map((d) => `${d.field}: ${d.message}`).join("; "));
      } else {
        setFormError(e instanceof Error ? e.message : "保存失败");
      }
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) { setFormError("请输入分组名称"); return; }
    if (form.name.trim().length > 64) { setFormError("分组名称最长 64 字符"); return; }
    setFormError("");
    saveMutation.mutate();
  };

  // ---- 删除 ----
  const [deleteTarget, setDeleteTarget] = useState<DeviceGroup | null>(null);
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteDeviceGroup(deleteTarget!.id),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["device-groups"] });
    },
  });

  // ---- 成员管理 ----
  const [manageTarget, setManageTarget] = useState<DeviceGroup | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [showAddList, setShowAddList] = useState(false);

  const { data: members } = useQuery<GroupMemberDevice[]>({
    queryKey: ["group-devices", manageTarget?.id],
    queryFn: () => api.getGroupDevices(manageTarget!.id),
    enabled: !!manageTarget,
  });

  // 全部设备(用于「添加设备」候选, 后端 page_size 上限 100)
  const { data: allDevicesData } = useQuery({
    queryKey: ["devices", 1, 100],
    queryFn: () => api.getDevices({ page: 1, page_size: 100 }),
    enabled: !!manageTarget,
  });

  const memberIds = new Set((members || []).map((m) => m.deviceId));
  const candidates: DeviceItem[] = (allDevicesData?.items || []).filter(
    (d) => !memberIds.has(d.deviceId),
  );
  const filteredMembers = (members || []).filter(
    (m) => !memberSearch || m.deviceName.includes(memberSearch) || m.productName.includes(memberSearch),
  );
  const filteredCandidates = candidates.filter(
    (d) => !memberSearch || d.deviceName.includes(memberSearch) || d.productName.includes(memberSearch),
  );

  const removeMutation = useMutation({
    mutationFn: (deviceId: string) =>
      api.setGroupDevices(
        manageTarget!.id,
        (members || []).map((m) => m.deviceId).filter((id) => id !== deviceId),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-devices", manageTarget?.id] });
      queryClient.invalidateQueries({ queryKey: ["device-groups"] });
    },
  });

  const addMutation = useMutation({
    mutationFn: (deviceId: string) =>
      api.setGroupDevices(manageTarget!.id, [
        ...(members || []).map((m) => m.deviceId),
        deviceId,
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-devices", manageTarget?.id] });
      queryClient.invalidateQueries({ queryKey: ["device-groups"] });
    },
  });

  const openManage = (g: DeviceGroup) => {
    setManageTarget(g);
    setMemberSearch("");
    setShowAddList(false);
  };

  const groupList = groups || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-medium text-[#333]">设备分组</h3>
          <p className="text-[12px] text-[#888] mt-0.5">
            通过分组批量管理设备, 一个设备仅可属于一个分组 · 共 {groupList.length} 个分组
          </p>
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[140px] animate-pulse">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#E5E6EB]" />
                <div className="h-4 w-24 rounded bg-[#E5E6EB]" />
              </div>
              <div className="mt-3 h-3 w-full rounded bg-[#F3F4F6]" />
              <div className="mt-2 h-3 w-2/3 rounded bg-[#F3F4F6]" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-12 text-center">
          <p className="text-[14px] text-[#E34D59] mb-2">分组加载失败</p>
          <p className="text-[12px] text-[#999] mb-4">{(error as Error)?.message}</p>
          <Button onClick={() => refetch()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : groupList.length === 0 ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-12 text-center">
          <Cpu className="w-10 h-10 text-[#C8C9CC] mx-auto mb-3" />
          <p className="text-[14px] text-[#666]">暂无分组</p>
          <p className="text-[12px] text-[#999] mt-1 mb-4">创建分组后可将设备批量纳入管理</p>
          <Button onClick={openCreate} className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5">
            <Plus className="w-3.5 h-3.5" /> 新建分组
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groupList.map((g) => (
            <div
              key={g.id}
              className="bg-white rounded border border-[#E5E6EB] p-5 hover:border-[#0052D9]/40 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="text-[14px] font-medium text-[#333] truncate">{g.name}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openManage(g)}
                    title="管理设备"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openEdit(g)}
                    title="编辑分组"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(g)}
                    title="删除分组"
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-[#888] mt-2 line-clamp-2 min-h-[32px]">
                {g.description || "暂无描述"}
              </p>
              <button
                onClick={() => openManage(g)}
                className="mt-3 flex items-center gap-1.5 text-[12px] text-[#0052D9] hover:underline"
              >
                <Cpu className="w-3.5 h-3.5" />
                {g.deviceCount} 台设备
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">{editing ? "编辑分组" : "新建分组"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">分组名称 <span className="text-[#E34D59]">*</span></label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：客厅设备"
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
              <label className="block text-[13px] text-[#666] mb-1.5">标签颜色</label>
              <div className="flex items-center gap-2 flex-wrap">
                {presetColors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      "w-7 h-7 rounded-full transition-transform",
                      form.color === c ? "ring-2 ring-offset-2 ring-[#333] scale-110" : "hover:scale-110",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {formError && (
              <p className="text-[12px] text-[#E34D59] bg-[#FDECEE] rounded px-3 py-2">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-8 text-[13px]">取消</Button>
            <Button
              onClick={handleSubmit}
              disabled={saveMutation.isPending}
              className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
            >
              {saveMutation.isPending ? "保存中..." : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">删除分组</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-[#666] py-3">
            将删除分组「{deleteTarget?.name}」, 组内 {deleteTarget?.deviceCount ?? 0} 台设备将自动解绑(设备本身不受影响), 此操作不可恢复。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="h-8 text-[13px]">取消</Button>
            <Button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="h-8 px-4 bg-[#E34D59] hover:bg-[#C9353F] text-white text-[13px]"
            >
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 成员管理对话框 */}
      <Dialog open={!!manageTarget} onOpenChange={(open) => !open && setManageTarget(null)}>
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333] flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: manageTarget?.color }} />
              {manageTarget?.name} · 设备管理
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 py-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#999] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="搜索设备名/产品"
                className="h-8 text-[13px] pl-8"
              />
            </div>
            <Button
              onClick={() => setShowAddList(!showAddList)}
              variant={showAddList ? "outline" : "default"}
              className={cn(
                "h-8 text-[12px] gap-1",
                !showAddList && "bg-[#0052D9] hover:bg-[#0042B0] text-white",
              )}
            >
              {showAddList ? <><X className="w-3.5 h-3.5" /> 收起</> : <><Plus className="w-3.5 h-3.5" /> 添加设备</>}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-[200px] border border-[#E5E6EB] rounded">
            {showAddList ? (
              <div>
                <div className="px-4 py-2 text-[12px] text-[#888] bg-[#F7F8FA] border-b border-[#E5E6EB]">
                  可添加设备({filteredCandidates.length} 台, 已排除组内设备与其他分组设备中已选)
                </div>
                {filteredCandidates.length === 0 ? (
                  <p className="text-center text-[13px] text-[#999] py-8">没有可添加的设备</p>
                ) : filteredCandidates.map((d) => (
                  <div key={d.deviceId} className="flex items-center justify-between px-4 py-2.5 border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFBFC]">
                    <div className="min-w-0">
                      <p className="text-[13px] text-[#333] truncate">{d.deviceName}</p>
                      <p className="text-[11px] text-[#999]">{d.productName}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("tc-badge", statusColors[d.status])}>{statusLabels[d.status]}</span>
                      <button
                        onClick={() => addMutation.mutate(d.deviceId)}
                        disabled={addMutation.isPending}
                        className="text-[12px] text-[#0052D9] hover:underline disabled:opacity-50"
                      >
                        添加
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <div className="px-4 py-2 text-[12px] text-[#888] bg-[#F7F8FA] border-b border-[#E5E6EB]">
                  组内设备({filteredMembers.length} 台)
                </div>
                {(members || []).length === 0 ? (
                  <p className="text-center text-[13px] text-[#999] py-8">
                    暂无设备, 点击右上角「添加设备」选择设备加入分组
                  </p>
                ) : filteredMembers.length === 0 ? (
                  <p className="text-center text-[13px] text-[#999] py-8">无匹配设备</p>
                ) : filteredMembers.map((m) => (
                  <div key={m.deviceId} className="flex items-center justify-between px-4 py-2.5 border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFBFC]">
                    <div className="min-w-0">
                      <p className="text-[13px] text-[#333] truncate">{m.deviceName}</p>
                      <p className="text-[11px] text-[#999]">{m.productName}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("tc-badge", statusColors[m.status])}>{statusLabels[m.status] ?? m.status}</span>
                      <button
                        onClick={() => removeMutation.mutate(m.deviceId)}
                        disabled={removeMutation.isPending}
                        className="text-[12px] text-[#E34D59] hover:underline disabled:opacity-50"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
