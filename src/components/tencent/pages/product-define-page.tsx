"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api, ApiError,
  type ThingModelSnapshot, type ThingModelProperty, type Product,
} from "@/lib/api/client";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Edit2, Trash2, ChevronLeft, RefreshCw, FileCode2, Zap, BellRing,
} from "lucide-react";

const typeLabels: Record<string, string> = {
  int: "整数型", long: "长整数型", float: "浮点型", double: "双精度浮点型",
  string: "字符串", bool: "布尔型", enum: "枚举型", timestamp: "时间型",
  date: "日期型", struct: "结构体", array: "数组",
};

const typeColors: Record<string, string> = {
  int: "bg-[#E6F0FF] text-[#0052D9]",
  long: "bg-[#E6F0FF] text-[#0052D9]",
  float: "bg-[#E8F8F0] text-[#00A870]",
  double: "bg-[#E8F8F0] text-[#00A870]",
  string: "bg-[#FFF3E8] text-[#ED7B2F]",
  bool: "bg-[#F0EDFF] text-[#7B61FF]",
  enum: "bg-[#FDECEE] text-[#E34D59]",
  timestamp: "bg-[#F3F4F6] text-[#666]",
  date: "bg-[#F3F4F6] text-[#666]",
  struct: "bg-[#FFF7E6] text-[#D48806]",
  array: "bg-[#FFF7E6] text-[#D48806]",
};

const eventColors: Record<string, string> = {
  info: "bg-[#E6F0FF] text-[#0052D9]",
  warn: "bg-[#FFF3E8] text-[#ED7B2F]",
  error: "bg-[#FDECEE] text-[#E34D59]",
};

const eventLabels: Record<string, string> = { info: "信息", warn: "告警", error: "故障" };

// 可编辑的数据类型(struct/array 高级类型仅展示)
const editableTypes = ["int", "long", "float", "double", "string", "bool", "enum", "timestamp"];

interface EnumItem { value: string; label: string }

interface PropForm {
  name: string;
  identifier: string;
  dataType: string;
  accessMode: string;
  description: string;
  min: string; max: string; step: string; unit: string;
  maxLength: string;
  boolOff: string; boolOn: string;
  enumItems: EnumItem[];
  tsUnit: string;
}

const emptyForm: PropForm = {
  name: "", identifier: "", dataType: "float", accessMode: "rw", description: "",
  min: "", max: "", step: "", unit: "",
  maxLength: "255", boolOff: "关", boolOn: "开",
  enumItems: [{ value: "", label: "" }],
  tsUnit: "s",
};

function formFromProp(p: ThingModelProperty): PropForm {
  const spec = p.spec || {};
  return {
    name: p.name,
    identifier: p.identifier,
    dataType: p.dataType,
    accessMode: p.accessMode,
    description: p.description || "",
    min: spec.min !== undefined ? String(spec.min) : "",
    max: spec.max !== undefined ? String(spec.max) : "",
    step: spec.step !== undefined ? String(spec.step) : "",
    unit: typeof spec.unit === "string" ? spec.unit : "",
    maxLength: spec.maxLength !== undefined ? String(spec.maxLength) : "255",
    boolOff: typeof spec["0"] === "string" ? spec["0"] : "关",
    boolOn: typeof spec["1"] === "string" ? spec["1"] : "开",
    enumItems: Array.isArray(spec.enumList)
      ? (spec.enumList as EnumItem[]).map((e) => ({ value: e.value, label: e.label }))
      : [{ value: "", label: "" }],
    tsUnit: spec.unit === "ms" ? "ms" : "s",
  };
}

function specFromForm(f: PropForm): Record<string, unknown> {
  switch (f.dataType) {
    case "int": case "long": case "float": case "double": {
      const spec: Record<string, unknown> = {};
      if (f.min !== "") spec.min = Number(f.min);
      if (f.max !== "") spec.max = Number(f.max);
      if (f.step !== "") spec.step = Number(f.step);
      if (f.unit) spec.unit = f.unit;
      return spec;
    }
    case "string":
      return f.maxLength !== "" ? { maxLength: Number(f.maxLength) } : {};
    case "bool":
      return { "0": f.boolOff || "关", "1": f.boolOn || "开" };
    case "enum":
      return {
        enumList: f.enumItems
          .filter((e) => e.value.trim() !== "")
          .map((e) => ({ value: e.value.trim(), label: e.label.trim() || e.value.trim() })),
      };
    case "timestamp":
      return { unit: f.tsUnit };
    default:
      return {};
  }
}

function renderSpec(dataType: string, spec: Record<string, unknown>): string {
  switch (dataType) {
    case "int": case "long": case "float": case "double": {
      const min = spec.min !== undefined ? spec.min : "-∞";
      const max = spec.max !== undefined ? spec.max : "+∞";
      const unit = spec.unit ? ` ${spec.unit}` : "";
      const step = spec.step !== undefined ? ` · 步长 ${spec.step}` : "";
      return `${min} ~ ${max}${unit}${step}`;
    }
    case "string":
      return spec.maxLength !== undefined ? `≤ ${spec.maxLength} 字符` : "不限长度";
    case "bool":
      return `${spec["0"] ?? "关"}(0) / ${spec["1"] ?? "开"}(1)`;
    case "enum": {
      const list = (spec.enumList as EnumItem[]) || [];
      if (list.length === 0) return "—";
      const head = list.slice(0, 2).map((e) => `${e.label}(${e.value})`).join(" / ");
      return list.length > 2 ? `${head} 等 ${list.length} 项` : head;
    }
    case "timestamp":
      return `时间戳(${spec.unit === "ms" ? "毫秒" : "秒"})`;
    default:
      return "结构化定义";
  }
}

function Skeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-[#E5E6EB]" />
            <div className="h-4 w-48 rounded bg-[#E5E6EB]" />
          </div>
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="h-8 rounded bg-[#F3F4F6]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductDefinePage() {
  const { selectedProductId, setSelectedProductId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: model, isLoading, isError, error, refetch } = useQuery<ThingModelSnapshot>({
    queryKey: ["thing-model", selectedProductId],
    queryFn: () => api.getThingModel(selectedProductId!),
    enabled: !!selectedProductId,
  });

  // 产品信息(名称)来自产品列表
  const { data: productsData } = useQuery({
    queryKey: ["products", 1, 100],
    queryFn: () => api.getProducts(1, 100),
    enabled: !!selectedProductId,
  });
  const product: Product | undefined = productsData?.items?.find(
    (p) => p.productId === selectedProductId,
  );

  // 对话框状态: editing=null 为新增, 否则为编辑目标
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ThingModelProperty | null>(null);
  const [form, setForm] = useState<PropForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ThingModelProperty | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (p: ThingModelProperty) => {
    setEditing(p);
    setForm(formFromProp(p));
    setFormError("");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!model) throw new Error("快照未加载");
      const spec = specFromForm(form);
      const prop: ThingModelProperty = {
        identifier: form.identifier.trim(),
        name: form.name.trim(),
        dataType: form.dataType,
        accessMode: form.accessMode,
        description: form.description.trim() || null,
        spec,
        required: editing?.required ?? false,
        sortOrder: editing?.sortOrder,
      };
      const properties = editing
        ? model.properties.map((p) => (p.identifier === editing.identifier ? { ...p, ...prop } : p))
        : [...model.properties, { ...prop, sortOrder: model.properties.length + 1 }];
      return api.updateThingModel(model.productId, {
        version: "1.0",
        properties,
        events: model.events,
        actions: model.actions,
      });
    },
    onSuccess: () => {
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["thing-model", selectedProductId] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details?.length) {
        setFormError(e.details.map((fe) => `${fe.field}: ${fe.message}`).join("; "));
      } else {
        setFormError(e instanceof Error ? e.message : "保存失败");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!model || !deleteTarget) throw new Error("快照未加载");
      return api.updateThingModel(model.productId, {
        version: "1.0",
        properties: model.properties.filter((p) => p.identifier !== deleteTarget.identifier),
        events: model.events,
        actions: model.actions,
      });
    },
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["thing-model", selectedProductId] });
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) { setFormError("请输入属性名称"); return; }
    const id = form.identifier.trim();
    if (!id) { setFormError("请输入标识符"); return; }
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(id)) {
      setFormError("标识符须以字母开头, 仅含字母/数字/下划线, 长度 2-64"); return;
    }
    if (model) {
      const dup = model.properties.some(
        (p) => p.identifier === id && p.identifier !== editing?.identifier,
      );
      if (dup) { setFormError(`标识符「${id}」已存在`); return; }
    }
    if (["int", "long", "float", "double"].includes(form.dataType)) {
      const min = form.min !== "" ? Number(form.min) : null;
      const max = form.max !== "" ? Number(form.max) : null;
      if (min !== null && max !== null && min > max) { setFormError("最小值不能大于最大值"); return; }
    }
    if (form.dataType === "enum" && !form.enumItems.some((e) => e.value.trim() !== "")) {
      setFormError("枚举型至少需要一个枚举项"); return;
    }
    setFormError("");
    saveMutation.mutate();
  };

  if (!selectedProductId) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-12 text-center">
        <FileCode2 className="w-10 h-10 text-[#C8C9CC] mx-auto mb-3" />
        <p className="text-[14px] text-[#666]">请从产品列表选择产品, 查看其物模型定义</p>
        <Button
          onClick={() => {
            const { setCurrentPage } = useAppStore.getState();
            setCurrentPage("product-list");
          }}
          className="mt-4 h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px]"
        >
          前往产品管理
        </Button>
      </div>
    );
  }

  if (isLoading) return <Skeleton />;

  if (isError) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-12 text-center">
        <p className="text-[14px] text-[#E34D59] mb-2">物模型加载失败</p>
        <p className="text-[12px] text-[#999] mb-4">{(error as Error)?.message}</p>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={() => refetch()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
          <Button onClick={() => setSelectedProductId(null)} variant="outline" className="h-8 text-[13px]">
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  const props = model?.properties ?? [];
  const events = model?.events ?? [];
  const actions = model?.actions ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => setSelectedProductId(null)}
            className="flex items-center gap-1 text-[12px] text-[#888] hover:text-[#0052D9] mb-1.5 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> 返回产品列表
          </button>
          <h3 className="text-[14px] font-medium text-[#333]">
            {product?.productName ?? "物模型定义"}
            <span className="ml-2 text-[12px] font-normal text-[#999] font-mono">{selectedProductId}</span>
          </h3>
          <p className="text-[12px] text-[#888] mt-0.5">
            定义产品的属性、事件和服务 · 快照版本 v{model?.version ?? "-"} · {props.length} 属性 / {events.length} 事件 / {actions.length} 服务
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新增属性
        </Button>
      </div>

      {/* Properties */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3 border-b border-[#E5E6EB] flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-[#0052D9]" />
          <span className="text-[14px] font-medium text-[#333]">属性定义</span>
          <span className="text-[12px] text-[#888]">{props.length} 个属性</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th>属性名称</th>
                <th>标识符</th>
                <th>数据类型</th>
                <th>取值范围</th>
                <th>读写类型</th>
                <th>描述</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-[13px] text-[#999]">
                    暂无属性定义, 点击右上角「新增属性」开始定义物模型
                  </td>
                </tr>
              ) : props.map((p) => (
                <tr key={p.identifier}>
                  <td className="font-medium text-[#333]">{p.name}</td>
                  <td><code className="text-[12px] text-[#666] bg-[#F7F8FA] px-1.5 py-0.5 rounded font-mono">{p.identifier}</code></td>
                  <td><span className={cn("tc-badge", typeColors[p.dataType] ?? "bg-[#F3F4F6] text-[#666]")}>{typeLabels[p.dataType] ?? p.dataType}</span></td>
                  <td className="text-[13px] text-[#666] max-w-[220px]">{renderSpec(p.dataType, p.spec || {})}</td>
                  <td><span className="text-[13px] text-[#666]">{p.accessMode === "rw" ? "读写" : p.accessMode === "w" ? "只写" : "只读"}</span></td>
                  <td className="text-[13px] text-[#888]">{p.description || "—"}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        title="编辑属性"
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        title="删除属性"
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors"
                      >
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

      {/* Events */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3 border-b border-[#E5E6EB] flex items-center gap-2">
          <BellRing className="w-4 h-4 text-[#ED7B2F]" />
          <span className="text-[14px] font-medium text-[#333]">事件定义</span>
          <span className="text-[12px] text-[#888]">{events.length} 个事件</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th>事件名称</th>
                <th>标识符</th>
                <th>事件类型</th>
                <th>输出参数</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-[13px] text-[#999]">暂无事件定义</td></tr>
              ) : events.map((e) => (
                <tr key={e.identifier}>
                  <td className="font-medium text-[#333]">{e.name}</td>
                  <td><code className="text-[12px] text-[#666] bg-[#F7F8FA] px-1.5 py-0.5 rounded font-mono">{e.identifier}</code></td>
                  <td><span className={cn("tc-badge", eventColors[e.eventType] ?? eventColors.info)}>{eventLabels[e.eventType] ?? e.eventType}</span></td>
                  <td className="text-[13px] text-[#666]">
                    {(e.outputParams || []).length === 0 ? "—" : e.outputParams.map((p) => p.name).join("、")}
                  </td>
                  <td className="text-[13px] text-[#888]">{e.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3 border-b border-[#E5E6EB] flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#7B61FF]" />
          <span className="text-[14px] font-medium text-[#333]">服务定义</span>
          <span className="text-[12px] text-[#888]">{actions.length} 个服务</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tc-table">
            <thead>
              <tr>
                <th>服务名称</th>
                <th>标识符</th>
                <th>调用方式</th>
                <th>输入参数</th>
                <th>输出参数</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[13px] text-[#999]">暂无服务定义</td></tr>
              ) : actions.map((a) => (
                <tr key={a.identifier}>
                  <td className="font-medium text-[#333]">{a.name}</td>
                  <td><code className="text-[12px] text-[#666] bg-[#F7F8FA] px-1.5 py-0.5 rounded font-mono">{a.identifier}</code></td>
                  <td><span className="text-[13px] text-[#666]">{a.asyncFlag ? "异步" : "同步"}</span></td>
                  <td className="text-[13px] text-[#666]">
                    {(a.inputParams || []).length === 0 ? "—" : a.inputParams.map((p) => p.name).join("、")}
                  </td>
                  <td className="text-[13px] text-[#666]">
                    {(a.outputParams || []).length === 0 ? "—" : a.outputParams.map((p) => p.name).join("、")}
                  </td>
                  <td className="text-[13px] text-[#888]">{a.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">{editing ? "编辑属性" : "新增属性"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">属性名称 <span className="text-[#E34D59]">*</span></label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：当前温度" className="h-8 text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">标识符 <span className="text-[#E34D59]">*</span></label>
                <Input
                  value={form.identifier}
                  onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  placeholder="如：temperature"
                  disabled={!!editing}
                  className="h-8 text-[13px] font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">数据类型</label>
                <Select value={form.dataType} onValueChange={(v) => setForm({ ...form, dataType: v })}>
                  <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {editableTypes.map((t) => (
                      <SelectItem key={t} value={t}>{typeLabels[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">读写类型</label>
                <Select value={form.accessMode} onValueChange={(v) => setForm({ ...form, accessMode: v })}>
                  <SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rw">读写</SelectItem>
                    <SelectItem value="r">只读</SelectItem>
                    <SelectItem value="w">只写</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 数值型: 范围/步长/单位 */}
            {["int", "long", "float", "double"].includes(form.dataType) && (
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">最小值</label>
                  <Input value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} placeholder="-40" className="h-8 text-[13px]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">最大值</label>
                  <Input value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} placeholder="85" className="h-8 text-[13px]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">步长</label>
                  <Input value={form.step} onChange={(e) => setForm({ ...form, step: e.target.value })} placeholder="0.1" className="h-8 text-[13px]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">单位</label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="°C" className="h-8 text-[13px]" />
                </div>
              </div>
            )}

            {/* 字符串: 最大长度 */}
            {form.dataType === "string" && (
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">最大长度(字符)</label>
                <Input value={form.maxLength} onChange={(e) => setForm({ ...form, maxLength: e.target.value })} className="h-8 text-[13px]" />
              </div>
            )}

            {/* 布尔: 0/1 文案 */}
            {form.dataType === "bool" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">false(0) 显示文本</label>
                  <Input value={form.boolOff} onChange={(e) => setForm({ ...form, boolOff: e.target.value })} className="h-8 text-[13px]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">true(1) 显示文本</label>
                  <Input value={form.boolOn} onChange={(e) => setForm({ ...form, boolOn: e.target.value })} className="h-8 text-[13px]" />
                </div>
              </div>
            )}

            {/* 时间型: 单位 */}
            {form.dataType === "timestamp" && (
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">时间戳单位</label>
                <Select value={form.tsUnit} onValueChange={(v) => setForm({ ...form, tsUnit: v })}>
                  <SelectTrigger className="h-8 text-[13px] w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="s">秒(s)</SelectItem>
                    <SelectItem value="ms">毫秒(ms)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 枚举: 枚举项编辑 */}
            {form.dataType === "enum" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[13px] text-[#666]">枚举项 <span className="text-[#E34D59]">*</span></label>
                  <button
                    onClick={() => setForm({ ...form, enumItems: [...form.enumItems, { value: "", label: "" }] })}
                    className="text-[12px] text-[#0052D9] hover:underline"
                  >
                    + 添加枚举项
                  </button>
                </div>
                <div className="space-y-2">
                  {form.enumItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={item.value}
                        onChange={(e) => {
                          const next = [...form.enumItems];
                          next[idx] = { ...next[idx], value: e.target.value };
                          setForm({ ...form, enumItems: next });
                        }}
                        placeholder="标识值 如 auto"
                        className="h-8 text-[13px] font-mono flex-1"
                      />
                      <Input
                        value={item.label}
                        onChange={(e) => {
                          const next = [...form.enumItems];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setForm({ ...form, enumItems: next });
                        }}
                        placeholder="显示名称 如 自动"
                        className="h-8 text-[13px] flex-1"
                      />
                      <button
                        onClick={() => setForm({ ...form, enumItems: form.enumItems.filter((_, i) => i !== idx) })}
                        disabled={form.enumItems.length <= 1}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#999] hover:text-[#E34D59] transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        title="移除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">描述</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="属性描述（可选）" className="h-8 text-[13px]" />
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

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">删除属性</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-[#666] py-3">
            将删除属性「{deleteTarget?.name}」({deleteTarget?.identifier}), 正在使用该属性的设备数据上报将失效, 此操作不可恢复。
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
    </div>
  );
}
