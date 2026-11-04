"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  api,
  ApiError,
  type ForwardRuleItem,
  type ForwardStats,
  type MessageTopicItem,
  type Product,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import {
  Inbox,
  Zap,
  CheckCircle2,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Webhook,
  Radio,
  Route,
} from "lucide-react";

type PageTab = "rules" | "logs" | "topics";
type ResultFilter = "all" | "success" | "failed";

const tabs: { key: PageTab; label: string }[] = [
  { key: "rules", label: "转发规则" },
  { key: "logs", label: "转发日志" },
  { key: "topics", label: "消息主题" },
];

const msgTypeLabels: Record<string, string> = {
  property: "属性上报",
  event: "事件上报",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 10_000) return "刚刚";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

// ---------------- 规则表单 ----------------

interface RuleForm {
  name: string;
  description: string;
  productId: string;
  messageType: string;
  identifiers: string; // 逗号分隔
  eventTypes: string; // 逗号分隔
  targetType: string;
  url: string;
  topic: string;
}

const emptyForm: RuleForm = {
  name: "",
  description: "",
  productId: "",
  messageType: "property",
  identifiers: "",
  eventTypes: "",
  targetType: "http",
  url: "",
  topic: "",
};

function splitList(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MessageQueuePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PageTab>("rules");

  // ---------------- 指标 ----------------
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery<ForwardStats>({
    queryKey: ["forward-stats"],
    queryFn: () => api.getForwardStats(),
    refetchInterval: 10_000,
  });

  // ---------------- 规则列表 ----------------
  const {
    data: rules,
    isLoading: rulesLoading,
    isError: rulesError,
    refetch: refetchRules,
  } = useQuery<ForwardRuleItem[]>({
    queryKey: ["forward-rules"],
    queryFn: () => api.getForwardRules(),
    refetchInterval: 10_000,
  });

  const { data: productsData } = useQuery<{ items: Product[] }>({
    queryKey: ["products", 1, 100],
    queryFn: () => api.getProducts(1, 100),
  });
  const products = productsData?.items ?? [];

  // ---------------- 新建/编辑对话框 ----------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ForwardRuleItem | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [formError, setFormError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, productId: products[0]?.productId ?? "" });
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (rule: ForwardRuleItem) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      description: rule.description || "",
      productId: rule.productId,
      messageType: rule.messageType,
      identifiers: (rule.filter.identifiers ?? []).join(", "),
      eventTypes: (rule.filter.eventTypes ?? []).join(", "),
      targetType: rule.targetType,
      url: rule.targetConfig.url || "",
      topic: rule.targetConfig.topic || "",
    });
    setFormError("");
    setDialogOpen(true);
  };

  const buildInput = () => ({
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    product_id: form.productId,
    message_type: form.messageType,
    filter:
      form.messageType === "property"
        ? form.identifiers.trim()
          ? { identifiers: splitList(form.identifiers) }
          : {}
        : form.eventTypes.trim()
          ? { eventTypes: splitList(form.eventTypes) }
          : {},
    target_type: form.targetType,
    target_config:
      form.targetType === "http" ? { url: form.url.trim() } : { topic: form.topic.trim() },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.updateForwardRule(editing.id, buildInput())
        : api.createForwardRule(buildInput()),
    onSuccess: () => {
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["forward-rules"] });
      queryClient.invalidateQueries({ queryKey: ["forward-stats"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 40904) {
        setFormError(`规则名称「${form.name.trim()}」已存在`);
      } else if (e instanceof ApiError && e.details?.length) {
        setFormError(e.details.map((d) => `${d.field}: ${d.message}`).join("; "));
      } else {
        setFormError(e instanceof Error ? e.message : "保存失败");
      }
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return setFormError("请输入规则名称");
    if (form.name.trim().length > 64) return setFormError("规则名称最长 64 字符");
    if (!form.productId) return setFormError("请选择产品");
    if (form.targetType === "http" && !/^https?:\/\//.test(form.url.trim())) {
      return setFormError("HTTP 转发目标必须是以 http:// 或 https:// 开头的 URL");
    }
    if (form.targetType === "republish" && !form.topic.trim()) {
      return setFormError("请填写重新发布的 Topic");
    }
    if (form.targetType === "republish" && /[+#]/.test(form.topic.trim())) {
      return setFormError("目标 Topic 不能包含 MQTT 通配符 + 或 #");
    }
    setFormError("");
    saveMutation.mutate();
  };

  // ---------------- 启停 / 删除 ----------------
  const toggleMutation = useMutation({
    mutationFn: (rule: ForwardRuleItem) =>
      api.toggleForwardRule(rule.id, rule.status === "enabled" ? "disabled" : "enabled"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forward-rules"] });
      queryClient.invalidateQueries({ queryKey: ["forward-stats"] });
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<ForwardRuleItem | null>(null);
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteForwardRule(deleteTarget!.id),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["forward-rules"] });
      queryClient.invalidateQueries({ queryKey: ["forward-stats"] });
    },
  });

  // ---------------- 转发日志 ----------------
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [logPage, setLogPage] = useState(1);

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ["forward-logs", resultFilter, logPage],
    queryFn: () =>
      api.getForwardLogs({
        result: resultFilter === "all" ? undefined : resultFilter,
        page: logPage,
        page_size: 20,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
  });

  const logTotalPages = logs ? Math.max(1, Math.ceil(logs.total / logs.page_size)) : 1;

  // ---------------- 消息主题 ----------------
  const {
    data: topics,
    isLoading: topicsLoading,
    isError: topicsError,
    refetch: refetchTopics,
  } = useQuery<MessageTopicItem[]>({
    queryKey: ["message-topics"],
    queryFn: () => api.getMessageTopics(),
    refetchInterval: 30_000,
  });

  // ================= 渲染 =================

  const statCards = stats
    ? [
        { label: "转发规则", value: String(stats.rule_count), icon: Route, tip: `${stats.enabled_count} 条启用中` },
        { label: "启用中", value: String(stats.enabled_count), icon: Zap, tip: "实时匹配设备上行消息" },
        { label: "今日转发", value: stats.today_forward_count.toLocaleString(), icon: Webhook, tip: "规则引擎今日累计转发" },
        {
          label: "今日成功率",
          value: stats.today_success_rate === null ? "--" : `${stats.today_success_rate}%`,
          icon: CheckCircle2,
          tip: stats.today_success_rate === null ? "暂无转发记录" : "成功转发 / 总转发",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* 指标卡 */}
      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded border border-[#E5E6EB] p-5 h-[112px] animate-pulse">
              <div className="h-3 w-20 rounded bg-[#F3F4F6] mb-4" />
              <div className="h-7 w-28 rounded bg-[#E5E6EB]" />
            </div>
          ))}
        </div>
      ) : statsError ? (
        <div className="bg-white rounded border border-[#E5E6EB] p-8 text-center">
          <p className="text-[14px] text-[#E34D59] mb-3">转发指标加载失败</p>
          <Button onClick={() => refetchStats()} variant="outline" className="h-8 text-[13px] gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 重新加载
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((c) => (
            <div key={c.label} className="bg-white rounded border border-[#E5E6EB] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-[#888]">{c.label}</span>
                <c.icon className="w-4 h-4 text-[#BBBFC4]" />
              </div>
              <div className="text-[24px] font-semibold text-[#333] leading-none mb-3">{c.value}</div>
              <div className="text-[12px] text-[#888]">{c.tip}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 栏 */}
      <div className="bg-white rounded border border-[#E5E6EB] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-3 h-7 rounded text-[13px] transition-colors",
                tab === t.key ? "bg-[#0052D9] text-white" : "text-[#666] hover:bg-[#F3F4F6]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "rules" && (
          <Button
            onClick={openCreate}
            className="h-8 px-3 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 新建规则
          </Button>
        )}
      </div>

      {/* 转发规则 */}
      {tab === "rules" && (
        <div className="bg-white rounded border border-[#E5E6EB] overflow-hidden">
          {rulesLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded bg-[#F3F4F6] animate-pulse" />
              ))}
            </div>
          ) : rulesError ? (
            <div className="p-8 text-center">
              <p className="text-[14px] text-[#E34D59] mb-3">转发规则加载失败</p>
              <Button onClick={() => refetchRules()} variant="outline" className="h-8 text-[13px] gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> 重新加载
              </Button>
            </div>
          ) : !rules || rules.length === 0 ? (
            <div className="p-12 text-center">
              <Route className="w-10 h-10 text-[#D5D9E0] mx-auto mb-3" />
              <p className="text-[14px] text-[#666] mb-1">暂无转发规则</p>
              <p className="text-[12px] text-[#999] mb-4">
                创建规则后, 设备上行消息将按规则自动转发到 HTTP 回调或指定 Topic
              </p>
              <Button
                onClick={openCreate}
                className="h-8 px-3 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> 新建规则
              </Button>
            </div>
          ) : (
            <table className="tc-table w-full">
              <thead>
                <tr className="bg-[#F7F8FA] text-[12px] text-[#888]">
                  <th className="text-left font-normal px-5 py-2.5">规则名称</th>
                  <th className="text-left font-normal px-3 py-2.5">产品</th>
                  <th className="text-left font-normal px-3 py-2.5">消息类型</th>
                  <th className="text-left font-normal px-3 py-2.5">筛选条件</th>
                  <th className="text-left font-normal px-3 py-2.5">转发目标</th>
                  <th className="text-left font-normal px-3 py-2.5">今日转发</th>
                  <th className="text-left font-normal px-3 py-2.5">状态</th>
                  <th className="text-right font-normal px-5 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const filterList =
                    rule.messageType === "property"
                      ? (rule.filter.identifiers ?? [])
                      : (rule.filter.eventTypes ?? []);
                  return (
                    <tr key={rule.id} className="border-t border-[#F0F0F0] hover:bg-[#F9FAFB]">
                      <td className="px-5 py-3">
                        <div className="text-[13px] text-[#333] font-medium">{rule.name}</div>
                        {rule.description && (
                          <div className="text-[12px] text-[#999] mt-0.5 line-clamp-1 max-w-[200px]">
                            {rule.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#333]">{rule.productName}</td>
                      <td className="px-3 py-3">
                        <span className="tc-badge bg-[#E6F0FF] text-[#0052D9]">
                          {msgTypeLabels[rule.messageType] ?? rule.messageType}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-[#666]">
                        {filterList.length === 0 ? (
                          <span className="text-[#999]">全部消息</span>
                        ) : (
                          <span className="font-mono">{filterList.join(", ")}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {rule.targetType === "http" ? (
                          <div className="flex items-center gap-1.5">
                            <Webhook className="w-3.5 h-3.5 text-[#0052D9] flex-shrink-0" />
                            <span className="text-[12px] text-[#666] font-mono truncate max-w-[220px]" title={rule.targetConfig.url}>
                              {rule.targetConfig.url}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Radio className="w-3.5 h-3.5 text-[#ED7B2F] flex-shrink-0" />
                            <span className="text-[12px] text-[#666] font-mono truncate max-w-[220px]" title={rule.targetConfig.topic}>
                              {rule.targetConfig.topic}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[13px] text-[#333]">{rule.todayCount}</span>
                        {rule.todaySuccessRate !== null && (
                          <span
                            className={cn(
                              "text-[12px] ml-1.5",
                              rule.todaySuccessRate >= 90 ? "text-[#00A870]" : "text-[#ED7B2F]",
                            )}
                          >
                            {rule.todaySuccessRate}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={rule.status === "enabled"}
                          onCheckedChange={() => toggleMutation.mutate(rule)}
                          disabled={toggleMutation.isPending}
                        />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(rule)}
                            title="编辑规则"
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#E6F0FF] text-[#888] hover:text-[#0052D9] transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(rule)}
                            title="删除规则"
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#FDECEE] text-[#888] hover:text-[#E34D59] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 转发日志 */}
      {tab === "logs" && (
        <div className="bg-white rounded border border-[#E5E6EB] overflow-hidden">
          <div className="flex items-center gap-1 px-5 py-3 border-b border-[#E5E6EB]">
            {(
              [
                { key: "all", label: "全部" },
                { key: "success", label: "成功" },
                { key: "failed", label: "失败" },
              ] as { key: ResultFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setResultFilter(f.key);
                  setLogPage(1);
                }}
                className={cn(
                  "px-3 h-7 rounded text-[13px] transition-colors",
                  resultFilter === f.key
                    ? "bg-[#0052D9] text-white"
                    : "text-[#666] hover:bg-[#F3F4F6]",
                )}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-[12px] text-[#888]">
              {logs ? `共 ${logs.total} 条` : ""} · 每 5 秒自动刷新
            </span>
          </div>
          {logsLoading && !logs ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded bg-[#F3F4F6] animate-pulse" />
              ))}
            </div>
          ) : !logs || logs.items.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="w-10 h-10 text-[#D5D9E0] mx-auto mb-3" />
              <p className="text-[14px] text-[#666]">
                {resultFilter === "all" ? "暂无转发日志" : `暂无${resultFilter === "success" ? "成功" : "失败"}记录`}
              </p>
              <p className="text-[12px] text-[#999] mt-1">启用规则后, 设备上行消息的转发记录将实时出现在这里</p>
            </div>
          ) : (
            <>
              <table className="tc-table w-full">
                <thead>
                  <tr className="bg-[#F7F8FA] text-[12px] text-[#888]">
                    <th className="text-left font-normal px-5 py-2.5">时间</th>
                    <th className="text-left font-normal px-3 py-2.5">规则</th>
                    <th className="text-left font-normal px-3 py-2.5">设备</th>
                    <th className="text-left font-normal px-3 py-2.5">类型</th>
                    <th className="text-left font-normal px-3 py-2.5">结果</th>
                    <th className="text-left font-normal px-3 py-2.5">耗时</th>
                    <th className="text-left font-normal px-5 py-2.5">消息载荷</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.items.map((log) => (
                    <tr key={log.id} className="border-t border-[#F0F0F0] hover:bg-[#F9FAFB] align-top">
                      <td className="px-5 py-3 text-[12px] text-[#888] whitespace-nowrap">{fmtTime(log.time)}</td>
                      <td className="px-3 py-3 text-[13px] text-[#333] whitespace-nowrap">{log.rule_name}</td>
                      <td className="px-3 py-3 text-[12px] text-[#666] whitespace-nowrap">{log.device_name}</td>
                      <td className="px-3 py-3">
                        <span className="tc-badge bg-[#F3F4F6] text-[#666]">
                          {msgTypeLabels[log.message_type] ?? log.message_type}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {log.result === "success" ? (
                          <span className="tc-badge bg-[#E8F8F0] text-[#00A870]">成功</span>
                        ) : (
                          <span className="tc-badge bg-[#FDECEE] text-[#E34D59]" title={log.error_msg ?? undefined}>
                            失败
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] text-[#888] whitespace-nowrap">{log.latency_ms}ms</td>
                      <td className="px-5 py-3">
                        <pre
                          className="text-[11px] text-[#888] font-mono bg-[#F7F8FA] rounded p-1.5 max-w-[360px] max-h-[72px] overflow-auto whitespace-pre-wrap break-all"
                          title={log.topic}
                        >
                          {JSON.stringify(log.payload)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#F0F0F0]">
                <span className="text-[12px] text-[#888]">
                  第 {logs.page} / {logTotalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] gap-1 border-[#E5E6EB]"
                    disabled={logPage <= 1}
                    onClick={() => setLogPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px] gap-1 border-[#E5E6EB]"
                    disabled={logPage >= logTotalPages}
                    onClick={() => setLogPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 消息主题 */}
      {tab === "topics" && (
        <div className="bg-white rounded border border-[#E5E6EB] overflow-hidden">
          {topicsLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded bg-[#F3F4F6] animate-pulse" />
              ))}
            </div>
          ) : topicsError ? (
            <div className="p-8 text-center">
              <p className="text-[14px] text-[#E34D59] mb-3">消息主题加载失败</p>
              <Button onClick={() => refetchTopics()} variant="outline" className="h-8 text-[13px] gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> 重新加载
              </Button>
            </div>
          ) : !topics || topics.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="w-10 h-10 text-[#D5D9E0] mx-auto mb-3" />
              <p className="text-[14px] text-[#666]">暂无消息数据</p>
            </div>
          ) : (
            <table className="tc-table w-full">
              <thead>
                <tr className="bg-[#F7F8FA] text-[12px] text-[#888]">
                  <th className="text-left font-normal px-5 py-2.5">Topic</th>
                  <th className="text-left font-normal px-3 py-2.5">类型</th>
                  <th className="text-left font-normal px-3 py-2.5">所属产品</th>
                  <th className="text-right font-normal px-3 py-2.5">消息数</th>
                  <th className="text-right font-normal px-5 py-2.5">最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.topic} className="border-t border-[#F0F0F0] hover:bg-[#F9FAFB]">
                    <td className="px-5 py-3">
                      <span className="text-[12px] text-[#333] font-mono">{t.topic}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "tc-badge",
                          t.type === "设备上报" ? "bg-[#E8F8F0] text-[#00A870]" : "bg-[#FFF3E8] text-[#ED7B2F]",
                        )}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-[#333]">{t.product_name}</td>
                    <td className="px-3 py-3 text-right text-[13px] text-[#333] font-medium">
                      {t.messages.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-[12px] text-[#888]">{fmtRelative(t.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 新建/编辑规则对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-[#333]">
              {editing ? "编辑转发规则" : "新建转发规则"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">
                规则名称 <span className="text-[#E34D59]">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：高温告警转发"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">
                  产品 <span className="text-[#E34D59]">*</span>
                </label>
                <Select
                  value={form.productId}
                  onValueChange={(v) => setForm({ ...form, productId: v })}
                >
                  <SelectTrigger className="h-8 text-[13px] w-full">
                    <SelectValue placeholder="选择产品" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.productId} value={p.productId} className="text-[13px]">
                        {p.productName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">消息类型</label>
                <Select
                  value={form.messageType}
                  onValueChange={(v) => setForm({ ...form, messageType: v })}
                >
                  <SelectTrigger className="h-8 text-[13px] w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="property" className="text-[13px]">属性上报</SelectItem>
                    <SelectItem value="event" className="text-[13px]">事件上报</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">
                筛选条件 <span className="text-[12px] text-[#999]">（逗号分隔, 留空转发全部）</span>
              </label>
              <Input
                value={form.messageType === "property" ? form.identifiers : form.eventTypes}
                onChange={(e) =>
                  form.messageType === "property"
                    ? setForm({ ...form, identifiers: e.target.value })
                    : setForm({ ...form, eventTypes: e.target.value })
                }
                placeholder={
                  form.messageType === "property"
                    ? "如：temperature, humidity"
                    : "如：warn, alert"
                }
                className="h-8 text-[13px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">转发方式</label>
              <Select
                value={form.targetType}
                onValueChange={(v) => setForm({ ...form, targetType: v })}
              >
                <SelectTrigger className="h-8 text-[13px] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http" className="text-[13px]">HTTP 转发 (Webhook)</SelectItem>
                  <SelectItem value="republish" className="text-[13px]">重新发布 (Topic)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.targetType === "http" ? (
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">
                  转发 URL <span className="text-[#E34D59]">*</span>
                </label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://your-service.example.com/webhook"
                  className="h-8 text-[13px] font-mono"
                />
                <p className="text-[12px] text-[#999] mt-1.5">
                  演示环境可填 http://localhost:3200/api/internal/echo 查看转发效果
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-[13px] text-[#666] mb-1.5">
                  目标 Topic <span className="text-[#E34D59]">*</span>
                </label>
                <Input
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  placeholder="$thing/down/{productId}/{deviceName}/republish"
                  className="h-8 text-[13px] font-mono"
                />
              </div>
            )}
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">描述</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="规则描述（可选）"
                className="h-8 text-[13px]"
              />
            </div>
            {formError && (
              <p className="text-[12px] text-[#E34D59] bg-[#FDECEE] rounded px-3 py-2">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-8 text-[13px]">
              取消
            </Button>
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
            <DialogTitle className="text-[16px] text-[#333]">删除转发规则</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-[#666] py-3">
            将删除转发规则「{deleteTarget?.name}」, 删除后该规则立即停止转发, 历史转发日志保留, 此操作不可恢复。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="h-8 text-[13px]">
              取消
            </Button>
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
