"use client";

import { useCallback, useState } from "react";
import {
  LayoutDashboard, Cpu, Package, FileCode2,
  MessageSquare, Workflow, Cloud, BarChart3,
  ScrollText, Activity, Shield, Database,
  HardDrive, Video, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeft, Server,
} from "lucide-react";
import { useAppStore, type PageKey } from "@/stores/app-store";
import { cn } from "@/lib/utils";

interface MenuItem {
  key?: PageKey;
  label: string;
  icon: React.ReactNode;
  children?: { key: PageKey; label: string }[];
}

const menuItems: MenuItem[] = [
  { key: "overview", label: "概览", icon: <LayoutDashboard className="w-4 h-4" /> },
  {
    label: "设备接入",
    icon: <Cpu className="w-4 h-4" />,
    children: [
      { key: "product-list", label: "产品管理" },
      { key: "device-list", label: "设备管理" },
      { key: "device-groups", label: "设备分组" },
      { key: "device-detail", label: "固件升级" },
    ],
  },
  { key: "cloud-dev", label: "开发中心", icon: <FileCode2 className="w-4 h-4" /> },
  { key: "message-queue", label: "消息通信", icon: <MessageSquare className="w-4 h-4" /> },
  { key: "ops-monitor", label: "监控运维", icon: <Activity className="w-4 h-4" /> },
  { key: "data-analysis", label: "云存服务", icon: <Database className="w-4 h-4" /> },
  { key: "log-service", label: "音视频服务", icon: <Video className="w-4 h-4" /> },
  { key: "rule-engine", label: "安全", icon: <Shield className="w-4 h-4" /> },
];

export function Sidebar() {
  const { currentPage, setCurrentPage, sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["设备接入"])
  );

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleMenuClick = (item: MenuItem) => {
    if (item.key) {
      setCurrentPage(item.key);
    } else if (item.children) {
      toggleGroup(item.label);
    }
  };

  const handleChildClick = (key: PageKey) => {
    setCurrentPage(key);
  };

  if (sidebarCollapsed) {
    return (
      <aside className="w-[56px] bg-[#232936] flex flex-col items-center pt-0 flex-shrink-0 relative z-30">
        <div className="w-full h-[56px] flex items-center justify-center border-b border-[#2E3546]">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.06)] text-[#A6ADB4] hover:text-white transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 w-full py-2 flex flex-col items-center gap-1">
          {menuItems.map((item) => (
            <button
              key={item.key || item.label}
              onClick={() => handleMenuClick(item)}
              title={item.label}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded transition-colors",
                item.key === currentPage
                  ? "bg-[rgba(43,130,216,0.15)] text-white"
                  : "text-[#A6ADB4] hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
              )}
            >
              {item.icon}
            </button>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="w-[200px] bg-[#232936] flex flex-col flex-shrink-0 relative z-30">
      <div className="h-[56px] flex items-center justify-between px-4 border-b border-[#2E3546]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-[#0052D9] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[10px] font-bold leading-none">T</span>
          </div>
          <div className="min-w-0">
            <div className="text-white text-[13px] font-medium truncate leading-tight">腾讯云</div>
            <div className="text-[#A6ADB4] text-[10px] truncate">物联网开发平台</div>
          </div>
        </div>
        <button
          onClick={() => setSidebarCollapsed(true)}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.06)] text-[#A6ADB4] hover:text-white transition-colors flex-shrink-0"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {menuItems.map((item) => {
          const isExpanded = expandedGroups.has(item.label);
          const isActiveParent = !item.key && item.children?.some((c) => c.key === currentPage);
          return (
            <div key={item.key || item.label}>
              {item.children ? (
                <>
                  <button
                    onClick={() => handleMenuClick(item)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded text-[14px] transition-colors",
                      isActiveParent ? "text-white" : "text-[#A6ADB4] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
                    )}
                  >
                    <span className="flex-shrink-0">{item.icon}</span>
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {item.children.map((child) => (
                        <button
                          key={child.key}
                          onClick={() => handleChildClick(child.key)}
                          className={cn(
                            "w-full flex items-center px-3 py-[7px] rounded text-[13px] transition-all relative",
                            currentPage === child.key
                              ? "bg-[rgba(43,130,216,0.15)] text-white before:absolute before:left-0 before:top-[5px] before:bottom-[5px] before:w-[3px] before:rounded-r before:bg-[#2B82D8]"
                              : "text-[#A6ADB4] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
                          )}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => handleMenuClick(item)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded text-[14px] transition-all relative",
                    currentPage === item.key
                      ? "bg-[rgba(43,130,216,0.15)] text-white before:absolute before:left-0 before:top-[5px] before:bottom-[5px] before:w-[3px] before:rounded-r before:bg-[#2B82D8]"
                      : "text-[#A6ADB4] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
                  )}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className="flex-1 text-left truncate">{item.label}</span>
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
