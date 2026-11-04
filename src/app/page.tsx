"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatsCards, ConnectionBadge } from "@/components/iot/stats-cards";
import { DeviceTable } from "@/components/iot/device-table";
import { DeviceDetail } from "@/components/iot/device-detail";
import { AlertList } from "@/components/iot/alert-list";
import { GroupPanel } from "@/components/iot/group-panel";
import { RealtimeFeed } from "@/components/iot/realtime-feed";
import { useMQTT } from "@/hooks/use-mqtt";
import { Bell, List, Radio, Cpu } from "lucide-react";

interface Device {
  id: string;
  name: string;
  type: string;
  status: string;
  protocol: string;
  location?: string;
  lastSeenAt?: string;
  group?: { name: string; color: string } | null;
}

export default function HomePage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const { connected } = useMQTT();

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetch("/api/dashboard").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const stats = dashboard?.summary || {
    totalDevices: 0,
    onlineDevices: 0,
    warningDevices: 0,
    offlineDevices: 0,
    totalGroups: 0,
    unacknowledgedAlerts: 0,
    recentTelemetryCount: 0,
  };

  const handleSelectDevice = (device: Device) => {
    setSelectedDeviceId(device.id);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200">
        <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ maxWidth: 1400 }}>
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight">IoT Explorer</h1>
                <p className="text-xs text-muted-foreground -mt-0.5">
                  物联网设备管理平台
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ConnectionBadge connected={connected} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto w-full px-4 sm:px-6 lg:px-8 py-6" style={{ maxWidth: 1400 }}>
        {selectedDeviceId ? (
          <DeviceDetail
            deviceId={selectedDeviceId}
            onBack={() => setSelectedDeviceId(null)}
          />
        ) : (
          <div className="space-y-6">
            <StatsCards stats={stats} />

            <Tabs defaultValue="devices" className="w-full">
              <TabsList>
                <TabsTrigger value="devices" className="gap-1.5">
                  <List className="h-3.5 w-3.5" />
                  设备管理
                </TabsTrigger>
                <TabsTrigger value="alerts" className="gap-1.5">
                  <Bell className="h-3.5 w-3.5" />
                  告警中心
                </TabsTrigger>
                <TabsTrigger value="realtime" className="gap-1.5">
                  <Radio className="h-3.5 w-3.5" />
                  实时监控
                </TabsTrigger>
              </TabsList>

              <TabsContent value="devices" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
                  <GroupPanel
                    activeGroupId={activeGroupId}
                    onSelectGroup={setActiveGroupId}
                  />
                  <DeviceTable onSelectDevice={handleSelectDevice} />
                </div>
              </TabsContent>

              <TabsContent value="alerts" className="mt-6">
                <AlertList />
              </TabsContent>

              <TabsContent value="realtime" className="mt-6">
                <RealtimeFeed />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="mx-auto px-4 sm:px-6 lg:px-8 py-4" style={{ maxWidth: 1400 }}>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>IoT Explorer v1.0 — 物联网设备管理平台</span>
            <span>Next.js 16 + Prisma + Socket.IO + Recharts</span>
          </div>
        </div>
      </footer>
    </div>
  );
}