"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, Bell, ChevronRight, User } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const pageLabels: Record<string, string> = {
  overview: "概览",
  "device-list": "设备列表",
  "device-groups": "设备分组",
  "product-list": "产品列表",
  "product-define": "产品定义",
  "message-queue": "消息队列",
  "rule-engine": "安全认证",
  "cloud-dev": "云端开发",
  "data-analysis": "数据分析",
  "log-service": "音视频服务",
  "ops-monitor": "运维监控",
  "device-detail": "设备详情",
};

export function TopNav() {
  const { currentPage, selectedDeviceId } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    },
    []
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const breadcrumbs: { label: string; key?: string }[] = [
    { label: "物联网开发平台" },
  ];

  if (currentPage === "device-detail") {
    breadcrumbs.push({ label: "设备管理" });
    breadcrumbs.push({ label: pageLabels["device-list"] });
    breadcrumbs.push({ label: selectedDeviceId || "设备详情" });
  } else {
    const label = pageLabels[currentPage];
    if (label) breadcrumbs.push({ label });
  }

  return (
    <header className="h-[56px] bg-white border-b border-[#E5E6EB] flex items-center justify-between px-4 lg:px-6 flex-shrink-0 z-20">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-[13px] min-w-0">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#BBBFC4] flex-shrink-0" />}
            <span
              className={cn(
                "truncate",
                i === breadcrumbs.length - 1
                  ? "text-[#333] font-medium"
                  : "text-[#888] hover:text-[#333] cursor-pointer transition-colors"
              )}
            >
              {crumb.label}
            </span>
          </span>
        ))}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Search */}
        <div className="relative">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex items-center gap-2 h-8 px-3 rounded border border-[#E5E6EB] bg-[#F7F8FA] hover:border-[#0052D9] transition-colors text-[13px] text-[#888] min-w-[200px]"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">搜索</span>
            <kbd className="hidden sm:inline-flex items-center h-4 px-1.5 rounded bg-white border border-[#E5E6EB] text-[10px] text-[#BBBFC4] font-mono">
              Ctrl+K
            </kbd>
          </button>
          {searchOpen && (
            <div className="absolute top-full left-0 mt-1 w-[400px] bg-white rounded border border-[#E5E6EB] shadow-lg p-3 z-50">
              <div className="flex items-center gap-2 border-b border-[#E5E6EB] pb-2">
                <Search className="w-4 h-4 text-[#BBBFC4]" />
                <input
                  autoFocus
                  placeholder="搜索设备、产品..."
                  className="flex-1 text-[13px] outline-none bg-transparent text-[#333] placeholder:text-[#BBBFC4]"
                  onBlur={() => setSearchOpen(false)}
                />
              </div>
              <div className="pt-3 pb-1 text-[12px] text-[#BBBFC4]">输入关键词搜索</div>
            </div>
          )}
        </div>

        {/* Notification */}
        <button className="relative w-8 h-8 flex items-center justify-center rounded hover:bg-[#F7F8FA] transition-colors text-[#666]">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E34D59]"></span>
        </button>

        {/* User avatar */}
        <button className="flex items-center gap-2 hover:bg-[#F7F8FA] rounded px-1.5 py-1 transition-colors">
          <div className="w-7 h-7 rounded-full bg-[#0052D9] flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] text-[#333] hidden sm:inline">用户名</span>
        </button>
      </div>
    </header>
  );
}
