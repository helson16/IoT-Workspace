"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";

interface Group {
  id: string;
  name: string;
  description?: string;
  color: string;
  _count: { devices: number };
}

interface GroupPanelProps {
  activeGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
}

export function GroupPanel({ activeGroupId, onSelectGroup }: GroupPanelProps) {
  const { data: groups } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: () => fetch("/api/groups").then((r) => r.json()),
  });

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4" />
          设备分组
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-1.5">
          <button
            onClick={() => onSelectGroup(null)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
              activeGroupId === null
                ? "bg-primary text-primary-foreground"
                : "hover:bg-slate-100"
            }`}
          >
            <span>全部设备</span>
            <span className={`text-xs ${activeGroupId === null ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
              {groups?.reduce((sum, g) => sum + g._count.devices, 0) || 0}
            </span>
          </button>
          {groups?.map((group) => (
            <button
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                activeGroupId === group.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <span className="truncate">{group.name}</span>
              </div>
              <span className={`text-xs ${activeGroupId === group.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {group._count.devices}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}