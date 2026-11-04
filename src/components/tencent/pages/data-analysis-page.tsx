"use client";

import { BarChart3, TrendingUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const mockCharts = [
  { id: "c1", name: "设备温度趋势", type: "折线图", dataSource: "温湿度传感器", timeRange: "最近24小时", refreshInterval: "5分钟" },
  { id: "c2", name: "设备在线率统计", type: "柱状图", dataSource: "全部设备", timeRange: "最近7天", refreshInterval: "1小时" },
  { id: "c3", name: "告警分布分析", type: "饼图", dataSource: "告警中心", timeRange: "最近30天", refreshInterval: "1天" },
  { id: "c4", name: "消息吞吐量", type: "面积图", dataSource: "消息队列", timeRange: "最近1小时", refreshInterval: "1分钟" },
];

const mockInsights = [
  { title: "设备在线率下降", description: "近7天设备平均在线率从 98.2% 下降至 94.5%，主要受烟雾报警器离线影响", severity: "warning", time: "2小时前" },
  { title: "消息量激增", description: "今日消息量较昨日增长 35%，主要由网关设备数据上报增加导致", severity: "info", time: "5小时前" },
  { title: "温度异常检测", description: "检测到3个传感器温度读数超出正常范围，建议检查设备状态", severity: "critical", time: "1天前" },
];

const severityStyle: Record<string, string> = {
  info: "bg-[#E6F0FF] text-[#0052D9]",
  warning: "bg-[#FFF3E8] text-[#ED7B2F]",
  critical: "bg-[#FDECEE] text-[#E34D59]",
};

export function DataAnalysisPage() {
  return (
    <div className="space-y-5">
      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {mockCharts.map((chart) => (
          <div key={chart.id} className="bg-white rounded border border-[#E5E6EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#0052D9]" />
                <h4 className="text-[14px] font-medium text-[#333]">{chart.name}</h4>
              </div>
              <span className="tc-badge bg-[#F3F4F6] text-[#666]">{chart.type}</span>
            </div>
            <div className="flex items-center gap-4 mb-4 text-[12px] text-[#888]">
              <span>数据源：{chart.dataSource}</span>
              <span>时间范围：{chart.timeRange}</span>
            </div>
            {/* Chart placeholder */}
            <div className="h-[180px] bg-[#F9FAFB] rounded border border-dashed border-[#E5E6EB] flex items-center justify-center">
              <div className="text-center">
                <TrendingUp className="w-8 h-8 text-[#E5E6EB] mx-auto mb-2" />
                <span className="text-[12px] text-[#BBBFC4]">图表预览区域</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-[#BBBFC4] flex items-center gap-1">
                <Clock className="w-3 h-3" /> 每{chart.refreshInterval}刷新
              </span>
              <button className="text-[12px] text-[#0052D9] hover:underline">查看详情</button>
            </div>
          </div>
        ))}
      </div>

      {/* AI Insights */}
      <div className="bg-white rounded border border-[#E5E6EB]">
        <div className="px-5 py-3.5 border-b border-[#E5E6EB]">
          <h3 className="text-[14px] font-medium text-[#333]">智能分析</h3>
        </div>
        <div className="divide-y divide-[#F0F0F0]">
          {mockInsights.map((insight, i) => (
            <div key={i} className="px-5 py-4 hover:bg-[#F9FAFB] transition-colors">
              <div className="flex items-start gap-3">
                <span className={cn("tc-badge mt-0.5", severityStyle[insight.severity])}>
                  {insight.severity === "critical" ? "严重" : insight.severity === "warning" ? "警告" : "信息"}
                </span>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-[#333]">{insight.title}</div>
                  <p className="text-[12px] text-[#888] mt-1 leading-relaxed">{insight.description}</p>
                </div>
                <span className="text-[11px] text-[#BBBFC4] flex-shrink-0">{insight.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}