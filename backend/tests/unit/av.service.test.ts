import { describe, it, expect } from 'vitest';
import {
  AV_EVENT_TYPES,
  AV_STATUSES,
  AV_STREAM_PROTOCOLS,
  parseAvEvent,
  buildFileName,
  summarizeAvEvents,
} from '../../src/services/av.service.js';
import { ValidationError } from '../../src/shared/errors.js';

// ---------------- 常量 ----------------

describe('AV 常量', () => {
  it('事件类型/状态/协议枚举完整', () => {
    expect(AV_EVENT_TYPES).toEqual(['recording', 'snapshot', 'playback']);
    expect(AV_STATUSES).toEqual(['success', 'failed']);
    expect(AV_STREAM_PROTOCOLS).toEqual(['RTMP', 'HLS', 'WebRTC']);
  });
});

// ---------------- parseAvEvent ----------------

describe('parseAvEvent', () => {
  it('合法 recording 事件: 保留全部字段', () => {
    const r = parseAvEvent({
      event_type: 'recording',
      status: 'success',
      file_name: 'cam.mp4',
      file_size: 52428800,
      duration_sec: 60,
      stream_protocol: 'HLS',
      detail: { channel: 0 },
    });
    expect(r).toEqual({
      eventType: 'recording',
      status: 'success',
      fileName: 'cam.mp4',
      fileSize: 52428800,
      durationSec: 60,
      streamProtocol: 'HLS',
      detail: { channel: 0 },
    });
  });

  it('默认值: status=success, protocol=RTMP, 数值取整', () => {
    const r = parseAvEvent({
      event_type: 'recording',
      duration_sec: 60.6,
      file_size: 1024.4,
    });
    expect(r.status).toBe('success');
    expect(r.streamProtocol).toBe('RTMP');
    expect(r.durationSec).toBe(61);
    expect(r.fileSize).toBe(1024);
  });

  it('snapshot 事件: duration_sec 恒为 0(携带正值也被强制归零)', () => {
    const r = parseAvEvent({ event_type: 'snapshot', duration_sec: 99, file_size: 204800 });
    expect(r.durationSec).toBe(0);
  });

  it('file_name 空白/缺失 → null', () => {
    expect(parseAvEvent({ event_type: 'snapshot' }).fileName).toBeNull();
    expect(parseAvEvent({ event_type: 'snapshot', file_name: '   ' }).fileName).toBeNull();
  });

  it('file_name 超长截断至 255', () => {
    const r = parseAvEvent({ event_type: 'snapshot', file_name: 'x'.repeat(300) });
    expect(r.fileName!.length).toBe(255);
  });

  it('detail 非对象时归一为空对象', () => {
    const r = parseAvEvent({ event_type: 'playback', duration_sec: 10 } as any);
    expect(r.detail).toEqual({});
  });

  // ---------------- 非法输入 ----------------

  it('非法 event_type → ValidationError 含 field 明细', () => {
    try {
      parseAvEvent({ event_type: 'broadcast', duration_sec: 1 });
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const fields = (e as ValidationError).details.map((d) => d.field);
      expect(fields).toContain('event_type');
    }
  });

  it('非法 status / stream_protocol → ValidationError', () => {
    expect(() =>
      parseAvEvent({ event_type: 'snapshot', status: 'maybe' } as any),
    ).toThrowError(ValidationError);
    expect(() =>
      parseAvEvent({ event_type: 'snapshot', stream_protocol: 'SRT' } as any),
    ).toThrowError(ValidationError);
  });

  it('负数 file_size → ValidationError', () => {
    expect(() => parseAvEvent({ event_type: 'snapshot', file_size: -1 })).toThrowError(
      ValidationError,
    );
  });

  it('recording/playback 缺少 duration_sec → ValidationError', () => {
    expect(() => parseAvEvent({ event_type: 'recording' })).toThrowError(ValidationError);
    expect(() => parseAvEvent({ event_type: 'playback' })).toThrowError(ValidationError);
  });

  it('duration_sec 超过 86400 → ValidationError', () => {
    expect(() =>
      parseAvEvent({ event_type: 'recording', duration_sec: 90000 }),
    ).toThrowError(ValidationError);
  });
});

// ---------------- buildFileName ----------------

describe('buildFileName', () => {
  it('生成 设备名_时间戳.扩展 格式', () => {
    const ts = new Date(2026, 8, 26, 11, 9, 32); // 2026-09-26 11:09:32 本地时间
    expect(buildFileName('recording', 'front-door-cam-01', ts)).toBe(
      'front-door-cam-01_20260926110932.mp4',
    );
    expect(buildFileName('snapshot', 'cam-a', ts)).toBe('cam-a_20260926110932.jpg');
    expect(buildFileName('playback', 'cam-a', ts)).toBe('cam-a_20260926110932.mp4');
  });
});

// ---------------- summarizeAvEvents ----------------

describe('summarizeAvEvents', () => {
  const TODAY_START = new Date(2026, 8, 26); // 今日 00:00 本地
  const yesterday = (h: number) => new Date(2026, 8, 25, h);
  const today = (h: number) => new Date(2026, 8, 26, h);

  const row = (over: Partial<Parameters<typeof summarizeAvEvents>[0][number]>) => ({
    event_type: 'recording',
    status: 'success',
    file_size: 100,
    duration_sec: 60,
    device_id: 'dev-1',
    timestamp: today(10),
    ...over,
  });

  it('空集: 全零且 success_rate 为 null', () => {
    const s = summarizeAvEvents([], TODAY_START);
    expect(s.total_events).toBe(0);
    expect(s.today_events).toBe(0);
    expect(s.storage_bytes).toBe(0);
    expect(s.success_rate).toBeNull();
    expect(s.device_count).toBe(0);
  });

  it('按类型计数今日事件, 忽略昨日事件', () => {
    const s = summarizeAvEvents(
      [
        row({ event_type: 'recording' }),
        row({ event_type: 'snapshot', duration_sec: 0 }),
        row({ event_type: 'playback', file_size: 0 }),
        row({ event_type: 'recording', timestamp: yesterday(10) }),
      ],
      TODAY_START,
    );
    expect(s.today_recording).toBe(1);
    expect(s.today_snapshot).toBe(1);
    expect(s.today_playback).toBe(1);
    expect(s.today_events).toBe(3);
    expect(s.total_events).toBe(4);
  });

  it('storage_bytes 累加全部事件(不限今日)', () => {
    const s = summarizeAvEvents(
      [row({ file_size: 1000 }), row({ file_size: 2000 }), row({ file_size: 0, timestamp: yesterday(1) })],
      TODAY_START,
    );
    expect(s.storage_bytes).toBe(3000);
  });

  it('today_duration_sec 只累计今日事件时长', () => {
    const s = summarizeAvEvents(
      [
        row({ duration_sec: 100 }),
        row({ event_type: 'playback', duration_sec: 50, file_size: 0 }),
        row({ duration_sec: 999, timestamp: yesterday(2) }),
      ],
      TODAY_START,
    );
    expect(s.today_duration_sec).toBe(150);
  });

  it('success_rate = 成功数/总数(含历史事件)', () => {
    const s = summarizeAvEvents(
      [
        row({}),
        row({ status: 'failed' }),
        row({ status: 'failed', timestamp: yesterday(3) }),
      ],
      TODAY_START,
    );
    expect(s.success_rate).toBeCloseTo(1 / 3);
  });

  it('device_count 优先取今日活跃设备数, 无今日事件时回退全量', () => {
    const s1 = summarizeAvEvents(
      [
        row({ device_id: 'a' }),
        row({ device_id: 'b' }),
        row({ device_id: 'c', timestamp: yesterday(4) }),
      ],
      TODAY_START,
    );
    expect(s1.device_count).toBe(2);

    const s2 = summarizeAvEvents(
      [row({ device_id: 'a', timestamp: yesterday(4) }), row({ device_id: 'c', timestamp: yesterday(5) })],
      TODAY_START,
    );
    expect(s2.device_count).toBe(2);
  });

  it('todayStart 即事件时间本身(边界含)', () => {
    const s = summarizeAvEvents([row({ timestamp: TODAY_START })], TODAY_START);
    expect(s.today_events).toBe(1);
  });
});
