import { describe, it, expect } from 'vitest';
import {
  sampleSeries,
  buildTelemetryTrend,
  type TelemetryRow,
  type ThingModelPropertyBrief,
} from '../../src/services/device-detail.service.js';

// ---------------- sampleSeries ----------------

describe('sampleSeries', () => {
  it('空序列返回空数组', () => {
    expect(sampleSeries([], 10)).toEqual([]);
  });

  it('点数不足 maxPoints 时原样返回(浅拷贝)', () => {
    const points = [1, 2, 3];
    const result = sampleSeries(points, 10);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(points);
  });

  it('超长序列均匀抽稀至 maxPoints 且保首尾', () => {
    const points = Array.from({ length: 100 }, (_, i) => i);
    // step = 99/4 = 24.75, round(3*24.75) = 74
    const result = sampleSeries(points, 5);
    expect(result).toEqual([0, 25, 50, 74, 99]);
  });

  it('maxPoints=1 仅保留首点; maxPoints<1 返回空', () => {
    const points = [1, 2, 3, 4];
    expect(sampleSeries(points, 1)).toEqual([1]);
    expect(sampleSeries(points, 0)).toEqual([]);
  });
});

// ---------------- buildTelemetryTrend ----------------

const META: ThingModelPropertyBrief[] = [
  { identifier: 'temperature', name: '当前温度', unit: '°C' },
  { identifier: 'humidity', name: '当前湿度', unit: '%' },
  { identifier: 'power_switch', name: '电源开关', unit: null },
];

function ts(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 1, 0, minute));
}

describe('buildTelemetryTrend', () => {
  it('按 identifier 分组并映射物模型 name/unit', () => {
    const rows: TelemetryRow[] = [
      { identifier: 'temperature', value: 22.5, timestamp: ts(0) },
      { identifier: 'humidity', value: 60, timestamp: ts(0) },
      { identifier: 'temperature', value: 23.1, timestamp: ts(1) },
    ];
    const series = buildTelemetryTrend(rows, META);
    expect(series).toHaveLength(2);
    const temp = series.find((s) => s.identifier === 'temperature')!;
    expect(temp.name).toBe('当前温度');
    expect(temp.unit).toBe('°C');
    expect(temp.points).toHaveLength(2);
    const hum = series.find((s) => s.identifier === 'humidity')!;
    expect(hum.unit).toBe('%');
  });

  it('过滤非数值型值(bool/string/enum), 不产生序列', () => {
    const rows: TelemetryRow[] = [
      { identifier: 'power_switch', value: 1, timestamp: ts(0) },
      { identifier: 'working_mode', value: 'auto', timestamp: ts(0) },
      { identifier: 'power_switch', value: true, timestamp: ts(1) },
    ];
    const series = buildTelemetryTrend(rows, META);
    // value=1 是 number 会保留, true/string 被过滤
    const sw = series.find((s) => s.identifier === 'power_switch')!;
    expect(sw.points).toHaveLength(1);
    expect(sw.points[0].value).toBe(1);
    expect(series.find((s) => s.identifier === 'working_mode')).toBeUndefined();
  });

  it('组内按时间升序排列(输入乱序)', () => {
    const rows: TelemetryRow[] = [
      { identifier: 'temperature', value: 25, timestamp: ts(5) },
      { identifier: 'temperature', value: 21, timestamp: ts(1) },
      { identifier: 'temperature', value: 23, timestamp: ts(3) },
    ];
    const [series] = buildTelemetryTrend(rows, META);
    expect(series.points.map((p) => p.value)).toEqual([21, 23, 25]);
  });

  it('超过 maxPoints 时每序列抽稀至 maxPoints', () => {
    const rows: TelemetryRow[] = Array.from({ length: 500 }, (_, i) => ({
      identifier: 'temperature',
      value: i,
      timestamp: ts(i),
    }));
    const [series] = buildTelemetryTrend(rows, META, 100);
    expect(series.points).toHaveLength(100);
    expect(series.points[0].value).toBe(0);
    expect(series.points[99].value).toBe(499);
  });

  it('序列顺序跟随物模型定义顺序, 未定义 identifier 排最后', () => {
    const rows: TelemetryRow[] = [
      { identifier: 'zzz_extra', value: 1, timestamp: ts(0) },
      { identifier: 'humidity', value: 50, timestamp: ts(0) },
      { identifier: 'temperature', value: 20, timestamp: ts(0) },
    ];
    const series = buildTelemetryTrend(rows, META);
    expect(series.map((s) => s.identifier)).toEqual([
      'temperature',
      'humidity',
      'zzz_extra',
    ]);
    // 未定义的 identifier 降级为 identifier 本身, 无单位
    const extra = series.find((s) => s.identifier === 'zzz_extra')!;
    expect(extra.name).toBe('zzz_extra');
    expect(extra.unit).toBe('');
  });
});
