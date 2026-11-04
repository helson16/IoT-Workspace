import { describe, it, expect } from 'vitest';
import {
  fillTimeBuckets,
  summarizeChart,
  buildInsights,
  type InsightInput,
} from '../../src/services/analytics.service.js';

const NOW = new Date('2026-09-19T08:30:00.000Z');

// ---------------- fillTimeBuckets ----------------

describe('fillTimeBuckets', () => {
  it('稀疏行补全为连续小时桶, 空档置 0', () => {
    const rows = [
      { bucket: new Date('2026-09-19T08:00:00.000Z'), value: 25.5 },
      { bucket: new Date('2026-09-19T05:00:00.000Z'), value: 24.1 },
    ];
    const points = fillTimeBuckets(rows, NOW, 'hour', 4);
    expect(points).toHaveLength(4);
    // 05/06/07/08 四个桶
    expect(points[0]).toEqual({ label: '2026-09-19T05:00:00.000Z', value: 24.1 });
    expect(points[1].value).toBe(0);
    expect(points[3]).toEqual({ label: '2026-09-19T08:00:00.000Z', value: 25.5 });
  });

  it('非整点行向下取整到所在桶', () => {
    const rows = [{ bucket: new Date('2026-09-19T08:17:42.000Z'), value: 3 }];
    const points = fillTimeBuckets(rows, NOW, 'hour', 2);
    expect(points[1]).toEqual({ label: '2026-09-19T08:00:00.000Z', value: 3 });
  });

  it('minute 桶按分钟对齐', () => {
    const rows = [{ bucket: new Date('2026-09-19T08:29:00.000Z'), value: 12 }];
    const points = fillTimeBuckets(rows, NOW, 'minute', 3);
    expect(points).toHaveLength(3);
    expect(points[1]).toEqual({ label: '2026-09-19T08:29:00.000Z', value: 12 });
    expect(points[0].label).toBe('2026-09-19T08:28:00.000Z');
    expect(points[2].label).toBe('2026-09-19T08:30:00.000Z');
  });

  it('day 桶取 UTC 日零点', () => {
    const rows = [{ bucket: new Date('2026-09-18T00:00:00.000Z'), value: 6 }];
    const points = fillTimeBuckets(rows, NOW, 'day', 3);
    expect(points[0]).toEqual({ label: '2026-09-17T00:00:00.000Z', value: 0 });
    expect(points[1]).toEqual({ label: '2026-09-18T00:00:00.000Z', value: 6 });
    expect(points[2]).toEqual({ label: '2026-09-19T00:00:00.000Z', value: 0 });
  });

  it('空输入返回全零连续桶', () => {
    const points = fillTimeBuckets([], NOW, 'hour', 24);
    expect(points).toHaveLength(24);
    expect(points.every((p) => p.value === 0)).toBe(true);
    expect(points[23].label).toBe('2026-09-19T08:00:00.000Z');
  });

  it('接受字符串形式的 bucket(Prisma 反序列化兼容)', () => {
    const rows = [{ bucket: '2026-09-19T08:00:00.000Z', value: 1 }];
    const points = fillTimeBuckets(rows, NOW, 'hour', 1);
    expect(points[0].value).toBe(1);
  });
});

// ---------------- summarizeChart ----------------

describe('summarizeChart', () => {
  it('温度趋势摘要含均值与最新值', () => {
    const s = summarizeChart('temp-trend', [
      { label: 'a', value: 20 },
      { label: 'b', value: 30 },
    ]);
    expect(s).toBe('近24小时平均温度 25.0°C，最新一小时均值 30.0°C');
  });

  it('活跃设备摘要含日均与今日', () => {
    const s = summarizeChart('daily-active', [
      { label: 'a', value: 6 },
      { label: 'b', value: 7 },
      { label: 'c', value: 1 },
    ]);
    expect(s).toBe('近7天日均活跃设备 5 台，今日 1 台');
  });

  it('告警分布摘要取占比最高的级别', () => {
    const s = summarizeChart('alarm-dist', [
      { label: '警告', value: 300 },
      { label: '严重告警', value: 900 },
    ]);
    expect(s).toBe('近30天累计事件 1,200 条，以「严重告警」为主');
  });

  it('告警分布无数据时提示无事件', () => {
    expect(summarizeChart('alarm-dist', [])).toBe('近30天无事件记录');
  });

  it('吞吐量摘要含累计与每分钟均值', () => {
    const s = summarizeChart('throughput', [
      { label: 'a', value: 3 },
      { label: 'b', value: 4 },
      { label: 'c', value: 6 },
    ]);
    expect(s).toBe('近1小时累计消息 13 条，平均每分钟 4.3 条');
  });
});

// ---------------- buildInsights ----------------

function makeInput(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    today_messages: 1000,
    yesterday_messages: 1000,
    overlimit: { count: 0, device_names: [], latest_value: null, max_limit: 85 },
    online: { total: 12, online: 12, offline_names: [] },
    alarm_recent7: 100,
    alarm_prev7: 100,
    generated_at: NOW,
    ...overrides,
  };
}

describe('buildInsights', () => {
  it('消息量增幅超阈值报激增', () => {
    const [first] = buildInsights(makeInput({ today_messages: 1500, yesterday_messages: 1000 }));
    expect(first.title).toBe('消息量激增');
    expect(first.severity).toBe('info');
    expect(first.description).toContain('50.0%');
  });

  it('消息量降幅超阈值报回落并升级 warning', () => {
    const [first] = buildInsights(makeInput({ today_messages: 500, yesterday_messages: 1000 }));
    expect(first.title).toBe('消息量回落');
    expect(first.severity).toBe('warning');
  });

  it('消息量波动在阈值内报平稳', () => {
    const [first] = buildInsights(makeInput({ today_messages: 1100, yesterday_messages: 1000 }));
    expect(first.title).toBe('消息量平稳');
  });

  it('昨日无上报而今日有数据时报启动上报', () => {
    const [first] = buildInsights(makeInput({ today_messages: 300, yesterday_messages: 0 }));
    expect(first.title).toBe('消息量启动上报');
  });

  it('昨日与今日均无数据时不产生消息量洞察', () => {
    const insights = buildInsights(makeInput({ today_messages: 0, yesterday_messages: 0 }));
    expect(insights.some((i) => i.title.includes('消息量'))).toBe(false);
  });

  it('存在温度超限读数时报 critical 并点名设备', () => {
    const insights = buildInsights(
      makeInput({
        overlimit: { count: 5, device_names: ['thermo-01', 'thermo-02'], latest_value: 91.2, max_limit: 85 },
      }),
    );
    const hit = insights.find((i) => i.title === '温度异常检测');
    expect(hit?.severity).toBe('critical');
    expect(hit?.description).toContain('thermo-01、thermo-02');
    expect(hit?.description).toContain('91.2°C');
  });

  it('无温度超限时不产生温度洞察', () => {
    const insights = buildInsights(makeInput());
    expect(insights.some((i) => i.title === '温度异常检测')).toBe(false);
  });

  it('存在离线设备时报 warning 并点名(超过5个截断)', () => {
    const insights = buildInsights(
      makeInput({
        online: {
          total: 12,
          online: 6,
          offline_names: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
        },
      }),
    );
    const hit = insights.find((i) => i.title === '设备离线提醒');
    expect(hit?.severity).toBe('warning');
    expect(hit?.description).toContain('d1、d2、d3、d4、d5 等');
  });

  it('全部在线时报正反馈洞察', () => {
    const insights = buildInsights(makeInput());
    const hit = insights.find((i) => i.title === '设备全部在线');
    expect(hit?.severity).toBe('info');
    expect(hit?.description).toContain('100%');
  });

  it('告警环比上升报 warning', () => {
    const insights = buildInsights(makeInput({ alarm_recent7: 150, alarm_prev7: 100 }));
    const hit = insights.find((i) => i.title === '告警趋势上升');
    expect(hit?.severity).toBe('warning');
  });

  it('告警环比回落报 info', () => {
    const insights = buildInsights(makeInput({ alarm_recent7: 80, alarm_prev7: 100 }));
    const hit = insights.find((i) => i.title === '告警趋势回落');
    expect(hit?.severity).toBe('info');
  });

  it('两窗口均无告警报清零', () => {
    const insights = buildInsights(makeInput({ alarm_recent7: 0, alarm_prev7: 0 }));
    expect(insights.find((i) => i.title === '告警清零')).toBeDefined();
  });

  it('全部洞察携带生成时间', () => {
    const insights = buildInsights(makeInput());
    for (const i of insights) {
      expect(i.time).toBe('2026-09-19T08:30:00.000Z');
    }
  });
});
