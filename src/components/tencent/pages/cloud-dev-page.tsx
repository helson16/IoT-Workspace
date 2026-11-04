"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Send,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  BookOpen,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  api,
  ApiCatalogEntry,
  ApiError,
  InvokeResult,
} from "@/lib/api/client";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-[#E8F8F0] text-[#2BA471]",
  POST: "bg-[#E3F0FF] text-[#0052D9]",
  PUT: "bg-[#FFF3E0] text-[#ED7B2F]",
  PATCH: "bg-[#F0EDFF] text-[#7B61FF]",
  DELETE: "bg-[#FFECE8] text-[#D54941]",
};

function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold font-mono w-14 shrink-0",
        METHOD_STYLES[method] ?? "bg-[#F3F4F6] text-[#666]",
        className,
      )}
    >
      {method}
    </span>
  );
}

function statusCodeStyle(code: number): string {
  if (code >= 500) return "bg-[#FFECE8] text-[#D54941]";
  if (code >= 400) return "bg-[#FFF3E0] text-[#ED7B2F]";
  if (code >= 300) return "bg-[#E3F0FF] text-[#0052D9]";
  return "bg-[#E8F8F0] text-[#2BA471]";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------- 参数调试表单 ----------------

function ParamInputs({
  title,
  params,
  values,
  onChange,
}: {
  title: string;
  params: NonNullable<ApiCatalogEntry["pathParams"]>;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (params.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-[#333]">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {params.map((p) => (
          <div key={p.name} className="space-y-1">
            <label className="text-[11px] text-[#888] font-mono">
              {p.name}
              <span className="text-[#D54941]">*</span>
              <span className="ml-1 font-sans text-[#AAA]">{p.description}</span>
            </label>
            <input
              className="w-full h-8 px-2 rounded border border-[#DCDEE0] text-[13px] font-mono focus:outline-none focus:border-[#0052D9]"
              value={values[p.name] ?? ""}
              placeholder={p.example || `请输入 ${p.name}`}
              onChange={(e) => onChange(p.name, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 历史表 ----------------

function HistoryTable({
  items,
  onJump,
}: {
  items: Array<{
    id: number;
    api_id: string;
    method: string;
    path: string;
    status_code: number;
    duration_ms: number;
    time: string;
  }>;
  onJump: (apiId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-10 text-center text-[13px] text-[#999]">
        暂无调用记录, 选择 API 发送请求后将在此展示
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="tc-table">
        <thead>
          <tr>
            <th>方法</th>
            <th>API</th>
            <th>请求路径</th>
            <th>状态码</th>
            <th>耗时</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr
              key={l.id}
              className="cursor-pointer"
              onClick={() => onJump(l.api_id)}
            >
              <td><MethodBadge method={l.method} /></td>
              <td>
                <span className="text-[13px] text-[#0052D9] font-mono">{l.api_id}</span>
              </td>
              <td>
                <span className="text-[12px] text-[#666] font-mono max-w-[280px] truncate inline-block align-middle">
                  {l.path}
                </span>
              </td>
              <td>
                <span className={cn("tc-badge font-mono", statusCodeStyle(l.status_code))}>
                  {l.status_code}
                </span>
              </td>
              <td>
                <span className="text-[12px] text-[#666] font-mono">{l.duration_ms}ms</span>
              </td>
              <td>
                <span className="text-[12px] text-[#888] font-mono">{fmtTime(l.time)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- 主页面 ----------------

export function CloudDevPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [bodyError, setBodyError] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["api-catalog"],
    queryFn: api.getApiCatalog,
  });

  const historyQuery = useQuery({
    queryKey: ["api-history"],
    queryFn: () => api.getApiHistory(20),
  });

  const apis = catalogQuery.data?.apis ?? [];
  const groups = catalogQuery.data?.groups ?? [];
  const stats = historyQuery.data?.stats;

  // 搜索过滤: 匹配 name / path / id
  const filteredByGroup = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const map = new Map<string, ApiCatalogEntry[]>();
    for (const entry of apis) {
      if (
        kw &&
        !entry.name.toLowerCase().includes(kw) &&
        !entry.path.toLowerCase().includes(kw) &&
        !entry.id.toLowerCase().includes(kw)
      ) {
        continue;
      }
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return map;
  }, [apis, keyword]);

  const selected = useMemo(
    () => apis.find((e) => e.id === selectedId) ?? null,
    [apis, selectedId],
  );

  const selectApi = (entry: ApiCatalogEntry) => {
    setSelectedId(entry.id);
    setPathValues({});
    setQueryValues({});
    setBodyText(
      entry.bodyExample ? JSON.stringify(entry.bodyExample, null, 2) : "",
    );
    setBodyError(null);
  };

  const invokeMutation = useMutation({
    mutationFn: () => {
      let body: Record<string, unknown> | null = null;
      if (["POST", "PUT", "PATCH"].includes(selected?.method ?? "") && bodyText.trim()) {
        try {
          body = JSON.parse(bodyText) as Record<string, unknown>;
          setBodyError(null);
        } catch {
          setBodyError("请求体 JSON 格式无效, 请检查后重试");
          throw new Error("invalid json");
        }
      }
      return api.invokeApi({
        api_id: selected!.id,
        path_params: pathValues,
        query_params: queryValues,
        body,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-history"] });
    },
  });

  const result: InvokeResult | null = invokeMutation.data ?? null;
  const invokeError =
    invokeMutation.error instanceof ApiError ? invokeMutation.error : null;

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 animate-pulse rounded bg-[#F3F4F6]" />
        <div className="h-[420px] animate-pulse rounded border border-[#E5E6EB] bg-[#FAFBFC]" />
      </div>
    );
  }

  if (catalogQuery.isError || !catalogQuery.data) {
    return (
      <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-[#D54941] mx-auto" />
        <div className="text-[13px] text-[#666]">API 目录加载失败</div>
        <Button
          variant="outline"
          className="h-8 text-[13px]"
          onClick={() => void catalogQuery.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* 头部: 说明 + 统计徽章 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-[#888]">
          平台 API Explorer — 枚举全部 OpenAPI 接口, 支持在线调试与调用历史
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="tc-badge bg-[#F3F4F6] text-[#666]">API {catalogQuery.data.total}</span>
          <span className="tc-badge bg-[#E3F0FF] text-[#0052D9]">可调试 {catalogQuery.data.invocable_count}</span>
          <span className="tc-badge bg-[#F0EDFF] text-[#7B61FF]">累计调用 {stats?.total_invokes ?? "-"}</span>
          <span className="tc-badge bg-[#E8F8F0] text-[#2BA471]">
            成功率 {stats?.success_rate != null ? `${stats.success_rate}%` : "-"}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* 左栏: API 分类树 */}
        <div className="w-full lg:w-64 shrink-0 bg-white rounded border border-[#E5E6EB]">
          <div className="p-2.5 border-b border-[#E5E6EB]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#999] absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                className="w-full h-8 pl-7 pr-2 rounded bg-[#F3F4F6] text-[13px] focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#0052D9]"
                placeholder="搜索 API 名称 / 路径"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-1.5">
            {groups
              .filter((g) => filteredByGroup.get(g.key)?.length)
              .map((g) => {
                const entries = filteredByGroup.get(g.key) ?? [];
                const isCollapsed = collapsed.has(g.key);
                return (
                  <div key={g.key} className="mb-0.5">
                    <button
                      className="w-full flex items-center gap-1 px-2 py-1.5 text-left rounded hover:bg-[#F7F8FA]"
                      onClick={() => toggleGroup(g.key)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-[#999] shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#999] shrink-0" />
                      )}
                      <span className="text-[12px] font-medium text-[#333] flex-1">{g.name}</span>
                      <span className="text-[11px] text-[#999] font-mono">{entries.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="ml-2 border-l border-[#E5E6EB]">
                        {entries.map((entry) => (
                          <button
                            key={entry.id}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                              entry.id === selectedId
                                ? "bg-[#E3F0FF]"
                                : "hover:bg-[#F7F8FA]",
                            )}
                            onClick={() => selectApi(entry)}
                          >
                            <MethodBadge method={entry.method} />
                            <span
                              className={cn(
                                "text-[12px] truncate flex-1",
                                entry.invocable ? "text-[#333]" : "text-[#999]",
                              )}
                              title={`${entry.name} ${entry.path}`}
                            >
                              {entry.name}
                            </span>
                            {!entry.invocable && (
                              <Lock className="w-3 h-3 text-[#BBB] shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* 右栏: 文档 + 调试 + 响应 + 历史 */}
        <div className="flex-1 min-w-0 space-y-4 w-full">
          {selected ? (
            <>
              {/* API 文档卡 */}
              <div className="bg-white rounded border border-[#E5E6EB] p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <MethodBadge method={selected.method} />
                  <span className="text-[14px] font-medium text-[#333]">{selected.name}</span>
                  <span className="text-[11px] text-[#AAA] font-mono">{selected.id}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-[13px] text-[#0052D9] bg-[#F7F8FA] rounded px-2 py-1 font-mono break-all">
                    {selected.method} {selected.path}
                  </code>
                </div>
                <div className="text-[12px] text-[#888] flex items-start gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#999]" />
                  <span>{selected.description}</span>
                </div>
                {selected.pathParams && selected.pathParams.length > 0 && (
                  <div className="text-[12px] text-[#666]">
                    <span className="text-[#333] font-medium">路径参数: </span>
                    {selected.pathParams.map((p) => (
                      <code key={p.name} className="font-mono text-[#ED7B2F] mx-0.5">
                        {p.name}
                      </code>
                    ))}
                  </div>
                )}
                {selected.queryParams && selected.queryParams.length > 0 && (
                  <div className="text-[12px] text-[#666]">
                    <span className="text-[#333] font-medium">查询参数: </span>
                    {selected.queryParams.map((p) => (
                      <code key={p.name} className="font-mono text-[#2BA471] mx-0.5">
                        {p.name}
                      </code>
                    ))}
                  </div>
                )}
              </div>

              {/* 调试面板 */}
              {selected.invocable ? (
                <div className="bg-white rounded border border-[#E5E6EB] p-4 space-y-3">
                  <div className="text-[13px] font-medium text-[#333]">在线调试</div>
                  <ParamInputs
                    title="路径参数"
                    params={selected.pathParams ?? []}
                    values={pathValues}
                    onChange={(n, v) => setPathValues((prev) => ({ ...prev, [n]: v }))}
                  />
                  <ParamInputs
                    title="查询参数"
                    params={selected.queryParams ?? []}
                    values={queryValues}
                    onChange={(n, v) => setQueryValues((prev) => ({ ...prev, [n]: v }))}
                  />
                  {["POST", "PUT", "PATCH"].includes(selected.method) && (
                    <div className="space-y-1">
                      <div className="text-[12px] font-medium text-[#333]">
                        请求体 (JSON, 已预填示例, 可编辑)
                      </div>
                      <textarea
                        className={cn(
                          "w-full h-40 p-2.5 rounded border font-mono text-[12px] focus:outline-none focus:border-[#0052D9]",
                          bodyError
                            ? "border-[#D54941] bg-[#FFF9F8]"
                            : "border-[#DCDEE0] bg-[#FAFBFC]",
                        )}
                        value={bodyText}
                        spellCheck={false}
                        onChange={(e) => {
                          setBodyText(e.target.value);
                          if (bodyError) setBodyError(null);
                        }}
                      />
                      {bodyError && (
                        <div className="text-[12px] text-[#D54941]">{bodyError}</div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      className="h-8 px-4 bg-[#0052D9] hover:bg-[#0042B0] text-white text-[13px] gap-1.5"
                      disabled={invokeMutation.isPending}
                      onClick={() => invokeMutation.mutate()}
                    >
                      <Send className="w-3.5 h-3.5" />
                      {invokeMutation.isPending ? "请求中…" : "发送请求"}
                    </Button>
                    <span className="text-[11px] text-[#AAA]">
                      请求经平台代理真实执行, 目标接口按自身权限与参数校验运行
                    </span>
                  </div>

                  {/* invoke 端点自身的错误(缺参数/api 不存在) */}
                  {invokeError && (
                    <div className="rounded border border-[#FFD8D3] bg-[#FFF9F8] p-3 space-y-1">
                      <div className="text-[12px] text-[#D54941] font-medium">
                        调试请求被拒绝 (code {invokeError.code}): {invokeError.message}
                      </div>
                      {invokeError.details && invokeError.details.length > 0 && (
                        <div className="text-[11px] text-[#D54941] font-mono">
                          {invokeError.details.map((d) => `${d.field}: ${d.message}`).join(" | ")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 响应 */}
                  {result && (
                    <div className="rounded border border-[#E5E6EB] overflow-hidden">
                      <div className="flex items-center gap-3 px-3 py-2 bg-[#F7F8FA] border-b border-[#E5E6EB] flex-wrap">
                        <span className="text-[12px] font-medium text-[#333]">响应</span>
                        <span
                          className={cn(
                            "tc-badge font-mono",
                            statusCodeStyle(result.status_code),
                          )}
                        >
                          {result.status_code}
                        </span>
                        <span className="text-[11px] text-[#888] font-mono">{result.duration_ms}ms</span>
                        <code className="text-[11px] text-[#888] font-mono truncate flex-1 min-w-[120px] text-right">
                          {result.request_url}
                        </code>
                      </div>
                      <pre className="p-3 text-[12px] font-mono text-[#333] overflow-x-auto max-h-80 overflow-y-auto bg-[#FAFBFC]">
                        {typeof result.response_body === "string"
                          ? result.response_body
                          : JSON.stringify(result.response_body, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded border border-[#E5E6EB] p-6 flex items-start gap-3">
                  <Lock className="w-5 h-5 text-[#ED7B2F] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="text-[13px] font-medium text-[#333]">
                      内部接口, 不开放在线调试
                    </div>
                    <div className="text-[12px] text-[#888] leading-relaxed">
                      该端点由 EMQX / 设备链路以 X-Internal-Secret 鉴权调用,
                      仅供文档参考。可调试接口请选择左侧其他分组(带锁图标除外)。
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded border border-[#E5E6EB] p-10 text-center text-[13px] text-[#999]">
              从左侧选择一个 API 查看文档并在线调试
            </div>
          )}

          {/* 调用历史 */}
          <div className="bg-white rounded border border-[#E5E6EB]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E5E6EB]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#333]">最近调用</span>
                {stats && stats.avg_duration_ms != null && (
                  <span className="text-[11px] text-[#999]">
                    平均耗时 {stats.avg_duration_ms}ms
                  </span>
                )}
              </div>
              <button
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F7F8FA] text-[#888] hover:text-[#0052D9] transition-colors"
                title="刷新历史"
                onClick={() => void historyQuery.refetch()}
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", historyQuery.isFetching && "animate-spin")}
                />
              </button>
            </div>
            {historyQuery.isLoading ? (
              <div className="py-10 text-center text-[13px] text-[#999]">加载中…</div>
            ) : historyQuery.isError ? (
              <div className="py-10 text-center text-[13px] text-[#D54941]">
                历史加载失败, 点击右上角刷新重试
              </div>
            ) : (
              <HistoryTable
                items={historyQuery.data?.items ?? []}
                onJump={(apiId) => {
                  const entry = apis.find((e) => e.id === apiId);
                  if (entry) selectApi(entry);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
