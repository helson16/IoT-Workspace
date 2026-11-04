"use client";

import { useState } from "react";
import { Sidebar } from "@/components/tencent/sidebar";
import { TopNav } from "@/components/tencent/top-nav";
import { useAppStore, type PageKey } from "@/stores/app-store";
import { OverviewPage } from "@/components/tencent/pages/overview-page";
import { DeviceListPage } from "@/components/tencent/pages/device-list-page";
import { DeviceGroupsPage } from "@/components/tencent/pages/device-groups-page";
import { ProductListPage } from "@/components/tencent/pages/product-list-page";
import { ProductDefinePage } from "@/components/tencent/pages/product-define-page";
import { MessageQueuePage } from "@/components/tencent/pages/message-queue-page";
import { RuleEnginePage } from "@/components/tencent/pages/rule-engine-page";
import { CloudDevPage } from "@/components/tencent/pages/cloud-dev-page";
import { DataAnalysisPage } from "@/components/tencent/pages/data-analysis-page";
import { LogServicePage } from "@/components/tencent/pages/log-service-page";
import { OpsMonitorPage } from "@/components/tencent/pages/ops-monitor-page";
import { DeviceDetailPage } from "@/components/tencent/pages/device-detail-page";
import { Menu } from "lucide-react";

const pageMap: Record<PageKey, React.ComponentType> = {
  overview: OverviewPage,
  "device-list": DeviceListPage,
  "device-groups": DeviceGroupsPage,
  "product-list": ProductListPage,
  "product-define": ProductDefinePage,
  "message-queue": MessageQueuePage,
  "rule-engine": RuleEnginePage,
  "cloud-dev": CloudDevPage,
  "data-analysis": DataAnalysisPage,
  "log-service": LogServicePage,
  "ops-monitor": OpsMonitorPage,
  "device-detail": DeviceDetailPage,
};

export default function HomePage() {
  const { currentPage } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const PageComponent = pageMap[currentPage] || OverviewPage;

  // 页面切换时关闭移动端菜单(render 期间调整 state, 避免 effect 级联渲染)
  const [prevPage, setPrevPage] = useState(currentPage);
  if (prevPage !== currentPage) {
    setPrevPage(currentPage);
    setMobileMenuOpen(false);
  }

  const overlayClass = mobileMenuOpen ? "block" : "hidden";
  const sidebarClass = "fixed lg:static inset-y-0 left-0 z-20 transform transition-transform duration-200 " + (mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0");

  return (
    <div className="h-screen flex overflow-hidden bg-[#F3F4F6]">
      {/* Mobile overlay */}
      <div
        className={"fixed inset-0 bg-black/40 z-20 lg:hidden " + overlayClass}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Sidebar */}
      <div className={sidebarClass}>
        <Sidebar />
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav />
        <div className="lg:hidden px-4 py-2 flex items-center gap-2">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded hover:bg-[#F3F4F6] transition-colors text-[#666]"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-[14px] font-medium text-[#333]">
            {currentPage === "overview" ? "概览" : currentPage === "product-list" ? "产品管理" : currentPage === "device-list" ? "设备管理" : ""}
          </span>
        </div>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <PageComponent />
        </main>
      </div>
    </div>
  );
}
