/**
 * 数据分析(云存服务)纯函数: 时间桶补全 / 图表摘要 / 洞察派生
 *
 * 时区约定: device_property_history.timestamp 等列存 UTC wall time,
 * 聚合桶用 UTC 对齐(date_trunc 直接截断), label 输出 ISO(UTC) 字符串,
 * 前端用 toLocaleString("zh-CN") 显示本地时间。
 */

export type BucketUnit = 'minute' | 'hour' | 'day';

export interface BucketRow {
  bucket: Date | string;
  value: number;
}

export interface BucketPoint {
  /** 桶起始时间的 ISO(UTC) 字符串 */
  label: string;
  value: number;
}

const UNIT_MS: Record<BucketUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** 桶起始对齐(UTC): minute/hour 按毫秒 floor, day 取 UTC 日零点 */
function floorBucket(ts: number, unit: BucketUnit): Date {
  if (unit === 'day') {
    const d = new Date(ts);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }
  const ms = UNIT_MS[unit];
  return new Date(Math.floor(ts / ms) * ms);
}

/**
 * 把稀疏的聚合行补全成连续时间桶(含空档置 0), 从 now 所在桶往回共 count 个。
 * 输入要求每桶至多一行(SQL GROUP BY 保证); 同桶多行时后行覆盖前行。
 */
export function fillTimeBuckets(
  rows: BucketRow[],
  now: Date,
  unit: BucketUnit,
  count: number,
): BucketPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = floorBucket(new Date(row.bucket).getTime(), unit).toISOString();
    map.set(key, Number(row.value));
  }

  const points: BucketPoint[] = [];
  const current = floorBucket(now.getTime(), unit).getTime();
  for (let i = count - 1; i >= 0; i--) {
    const key = new Date(current - i * UNIT_MS[unit]).toISOString();
    points.push({ label: key, value: map.get(key) ?? 0 });
  }
  return points;
}

// ---------------- 图表摘要 ----------------

export type ChartId = 'temp-trend' | 'daily-active' | 'alarm-dist' | 'throughput';

/** 由聚合点集生成一句话摘要(卡片副标题) */
export function summarizeChart(chartId: ChartId, points: BucketPoint[]): string {
  const values = points.map((p) => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = values.length > 0 ? sum / values.length : 0;
  const latest = values.length > 0 ? values[values.length - 1] : 0;

  switch (chartId) {
    case 'temp-trend':
      return `近24小时平均温度 ${avg.toFixed(1)}°C，最新一小时均值 ${latest.toFixed(1)}°C`;
    case 'daily-active':
      return `近7天日均活跃设备 ${Math.round(avg)} 台，今日 ${latest} 台`;
    case 'alarm-dist': {
      const total = sum;
      const top = points.reduce((a, b) => (b.value > a.value ? b : a), {
        label: '',
        value: 0,
      });
      return total === 0
        ? '近30天无事件记录'
        : `近30天累计事件 ${total.toLocaleString()} 条，以「${top.label}」为主`;
    }
    case 'throughput':
      return `近1小时累计消息 ${sum.toLocaleString()} 条，平均每分钟 ${avg.toFixed(1)} 条`;
  }
}

// ---------------- 洞察派生 ----------------

export interface OverlimitInput {
  /** 近24h 超出物模型上限的读数条数 */
  count: number;
  /** 涉及设备名(≤3 个) */
  device_names: string[];
  /** 超限读数中的最大值 */
  latest_value: number | null;
  /** 物模型上限 */
  max_limit: number | null;
}

export interface InsightInput {
  today_messages: number;
  yesterday_messages: number;
  overlimit: OverlimitInput;
  online: {
    total: number;
    online: number;
    offline_names: string[];
  };
  alarm_recent7: number;
  alarm_prev7: number;
  generated_at: Date;
}

export interface Insight {
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  /** ISO 时间 */
  time: string;
}

const MSG_RATE_THRESHOLD = 0.2;

/** 由聚合事实派生结构化洞察(顺序即展示顺序) */
export function buildInsights(input: InsightInput): Insight[] {
  const time = input.generated_at.toISOString();
  const insights: Insight[] = [];

  // 1. 消息量对比(今日 vs 昨日)
  const today = input.today_messages;
  const yesterday = input.yesterday_messages;
  if (yesterday === 0) {
    if (today > 0) {
      insights.push({
        title: '消息量启动上报',
        description: `今日已累计上报 ${today.toLocaleString()} 条属性消息，昨日无上报记录`,
        severity: 'info',
        time,
      });
    }
  } else {
    const rate = (today - yesterday) / yesterday;
    if (rate > MSG_RATE_THRESHOLD) {
      insights.push({
        title: '消息量激增',
        description: `今日消息量较昨日增长 ${(rate * 100).toFixed(1)}%（${yesterday.toLocaleString()} → ${today.toLocaleString()} 条），请关注设备上报频率变化`,
        severity: 'info',
        time,
      });
    } else if (rate < -MSG_RATE_THRESHOLD) {
      insights.push({
        title: '消息量回落',
        description: `今日消息量较昨日下降 ${(-rate * 100).toFixed(1)}%（${yesterday.toLocaleString()} → ${today.toLocaleString()} 条），部分设备可能停止上报`,
        severity: 'warning',
        time,
      });
    } else {
      insights.push({
        title: '消息量平稳',
        description: `今日消息量 ${today.toLocaleString()} 条，较昨日（${yesterday.toLocaleString()} 条）波动 ${Math.abs(rate * 100).toFixed(1)}%，运行平稳`,
        severity: 'info',
        time,
      });
    }
  }

  // 2. 温度超限检测(近24h 超物模型上限)
  if (input.overlimit.count > 0 && input.overlimit.max_limit !== null) {
    const names = input.overlimit.device_names.join('、');
    insights.push({
      title: '温度异常检测',
      description: `近24小时检测到 ${input.overlimit.count} 条温度读数超出物模型上限（${input.overlimit.max_limit}°C），涉及设备：${names}，最大读数 ${input.overlimit.latest_value?.toFixed(1) ?? '-'}°C，建议检查设备状态`,
      severity: 'critical',
      time,
    });
  }

  // 3. 设备在线状态
  const { total, online, offline_names } = input.online;
  if (total > 0 && offline_names.length > 0) {
    insights.push({
      title: '设备离线提醒',
      description: `当前 ${total} 台设备中 ${online} 台在线，${offline_names.length} 台离线：${offline_names.slice(0, 5).join('、')}${offline_names.length > 5 ? ' 等' : ''}`,
      severity: 'warning',
      time,
    });
  } else if (total > 0) {
    insights.push({
      title: '设备全部在线',
      description: `当前 ${total} 台设备全部在线，在线率 100%`,
      severity: 'info',
      time,
    });
  }

  // 4. 告警趋势(近7天 vs 前7天)
  const recent = input.alarm_recent7;
  const prev = input.alarm_prev7;
  if (recent === 0 && prev === 0) {
    insights.push({
      title: '告警清零',
      description: '近7天无告警事件，设备运行稳定',
      severity: 'info',
      time,
    });
  } else if (recent > prev) {
    insights.push({
      title: '告警趋势上升',
      description: `近7天告警 ${recent.toLocaleString()} 条，较前7天（${prev.toLocaleString()} 条）增加，建议排查告警来源设备`,
      severity: 'warning',
      time,
    });
  } else {
    insights.push({
      title: '告警趋势回落',
      description: `近7天告警 ${recent.toLocaleString()} 条，较前7天（${prev.toLocaleString()} 条）减少`,
      severity: 'info',
      time,
    });
  }

  return insights;
}
