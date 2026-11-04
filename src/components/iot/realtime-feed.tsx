"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Zap } from "lucide-react";
import { useMQTT } from "@/hooks/use-mqtt";

interface FeedItem {
  device: string;
  key: string;
  value: number;
  unit: string;
  timestamp: string;
}

export function RealtimeFeed() {
  const { connected, latestTelemetry } = useMQTT();
  const feedRef = useRef<HTMLDivElement>(null);

  const displayItems = latestTelemetry
    .slice(-20)
    .reverse() as FeedItem[];

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [latestTelemetry.length]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            实时数据流
          </span>
          <Badge variant={connected ? "default" : "destructive"} className="text-xs gap-1">
            <Zap className="h-3 w-3" />
            {connected ? "已连接" : "未连接"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div ref={feedRef} className="space-y-1.5 max-h-80 overflow-y-auto">
          {displayItems.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              {connected ? "等待数据..." : "未连接到 MQTT 服务"}
            </div>
          ) : (
            displayItems.map((item, i) => (
              <div
                key={`${item.device}-${item.key}-${item.timestamp}-${i}`}
                className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded text-xs"
              >
                <span className="text-muted-foreground w-16 truncate" title={item.device}>
                  {item.device}
                </span>
                <span className="font-mono text-cyan-700 font-medium">
                  {item.key}
                </span>
                <span className="font-mono font-bold">
                  {item.value.toFixed(2)}
                </span>
                <span className="text-muted-foreground">{item.unit}</span>
                <span className="text-muted-foreground ml-auto shrink-0">
                  {new Date(item.timestamp).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
