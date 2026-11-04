/**
 * 音视频服务域: 摄像头设备 AV 事件(录制/截图/回放)元数据链路
 *
 * - 纯函数: parseAvEvent / buildFileName / summarizeAvEvents
 * - AvService: 事件写入(internal 回调) / 统计 / 分页列表
 *
 * 边界: 仅元数据(文件名/大小/时长/协议/状态), 无真实视频流。
 */

import type { PrismaClient } from '@prisma/client';
import { ValidationError } from '../shared/errors.js';

// ---------------- 类型与常量 ----------------

export const AV_EVENT_TYPES = ['recording', 'snapshot', 'playback'] as const;
export const AV_STATUSES = ['success', 'failed'] as const;
export const AV_STREAM_PROTOCOLS = ['RTMP', 'HLS', 'WebRTC'] as const;

export type AvEventType = (typeof AV_EVENT_TYPES)[number];
export type AvStatus = (typeof AV_STATUSES)[number];
export type AvStreamProtocol = (typeof AV_STREAM_PROTOCOLS)[number];

export interface AvEventInput {
  event_type: string;
  status?: string;
  file_name?: string;
  file_size?: number;
  duration_sec?: number;
  stream_protocol?: string;
  detail?: Record<string, unknown>;
}

export interface NormalizedAvEvent {
  eventType: AvEventType;
  status: AvStatus;
  fileName: string | null;
  fileSize: number;
  durationSec: number;
  streamProtocol: AvStreamProtocol;
  detail: Record<string, unknown>;
}

export interface AvEventRow {
  id: string;
  device_id: string;
  device_name: string;
  product_name: string;
  event_type: string;
  status: string;
  file_name: string | null;
  file_size: number;
  duration_sec: number;
  stream_protocol: string;
  timestamp: Date;
}

export interface AvStats {
  total_events: number;
  today_recording: number;
  today_snapshot: number;
  today_playback: number;
  today_events: number;
  storage_bytes: number;
  today_duration_sec: number;
  success_rate: number | null; // 0-1, null = 无事件
  device_count: number;
}

export interface AvTrendBucket {
  hour: string; // 'HH:00'(UTC, 与 timestamp 列语义一致)
  recording: number;
  snapshot: number;
  playback: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const MAX_DURATION_SEC = 24 * 3600;

// ---------------- 纯函数 ----------------

/**
 * 校验并规范化单条 AV 事件。
 * - recording/playback: duration_sec 必须为正
 * - snapshot: duration_sec 恒为 0(携带则忽略)
 * - 数值边界: file_size/duration_sec 非负且不超过上限
 */
export function parseAvEvent(raw: AvEventInput): NormalizedAvEvent {
  const errors: Array<{ field: string; message: string }> = [];

  const eventType = AV_EVENT_TYPES.find((t) => t === raw.event_type);
  if (!eventType) {
    errors.push({
      field: 'event_type',
      message: `event_type 必须为 ${AV_EVENT_TYPES.join('/')}`,
    });
  }

  const status = (raw.status ?? 'success') as AvStatus;
  if (!AV_STATUSES.includes(status)) {
    errors.push({ field: 'status', message: `status 必须为 ${AV_STATUSES.join('/')}` });
  }

  const streamProtocol = (raw.stream_protocol ?? 'RTMP') as AvStreamProtocol;
  if (!AV_STREAM_PROTOCOLS.includes(streamProtocol)) {
    errors.push({
      field: 'stream_protocol',
      message: `stream_protocol 必须为 ${AV_STREAM_PROTOCOLS.join('/')}`,
    });
  }

  const fileSize = raw.file_size ?? 0;
  if (!Number.isFinite(fileSize) || fileSize < 0 || fileSize > MAX_FILE_SIZE) {
    errors.push({ field: 'file_size', message: 'file_size 必须为 0 ~ 10GB 之间的数值' });
  }

  let durationSec = raw.duration_sec ?? 0;
  if (!Number.isFinite(durationSec) || durationSec < 0 || durationSec > MAX_DURATION_SEC) {
    errors.push({ field: 'duration_sec', message: 'duration_sec 必须为 0 ~ 86400 之间的数值' });
    durationSec = 0;
  }

  if (eventType && eventType !== 'snapshot' && durationSec <= 0) {
    errors.push({ field: 'duration_sec', message: `${eventType} 事件 duration_sec 必须大于 0` });
  }

  if (errors.length > 0) {
    throw new ValidationError('AV 事件校验失败', errors);
  }

  const fileName =
    typeof raw.file_name === 'string' && raw.file_name.trim().length > 0
      ? raw.file_name.trim().slice(0, 255)
      : null;

  return {
    eventType: eventType!,
    status,
    fileName,
    fileSize: Math.round(fileSize),
    durationSec: eventType === 'snapshot' ? 0 : Math.round(durationSec),
    streamProtocol,
    detail: raw.detail && typeof raw.detail === 'object' ? raw.detail : {},
  };
}

const FILE_EXTENSIONS: Record<AvEventType, string> = {
  recording: 'mp4',
  snapshot: 'jpg',
  playback: 'mp4',
};

/**
 * 按小时聚合 AV 事件为定长趋势桶(纯函数)。
 * - 桶区间: [now - hours 小时, now](边界含), 共 hours+1 个桶, 无数据小时补零
 * - hour 标签取桶起始小时的 'HH:00'(UTC, 与 timestamp 列语义一致)
 */
export function buildHourlyTrend(
  rows: Array<{ event_type: string; timestamp: Date }>,
  hours: number,
  now: Date = new Date(),
): AvTrendBucket[] {
  const bucketMs = 3600 * 1000;
  // 以整小时对齐: 最新桶 = now 所在小时, 最早桶 = now - hours 小时所在小时
  const latest = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const earliest = latest - hours * bucketMs;

  const buckets: AvTrendBucket[] = [];
  const index = new Map<number, AvTrendBucket>();
  for (let t = earliest; t <= latest; t += bucketMs) {
    const b: AvTrendBucket = { hour: 'HH:00', recording: 0, snapshot: 0, playback: 0 };
    const d = new Date(t);
    b.hour = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    buckets.push(b);
    index.set(t, b);
  }

  for (const row of rows) {
    const t = Math.floor(row.timestamp.getTime() / bucketMs) * bucketMs;
    const b = index.get(t);
    if (!b) continue; // 窗口外(理论不出现, 防御)
    if (row.event_type === 'recording') b.recording += 1;
    else if (row.event_type === 'snapshot') b.snapshot += 1;
    else if (row.event_type === 'playback') b.playback += 1;
  }
  return buckets;
}

/**
 * 设备未携带 file_name 时的确定性兜底文件名。
 * 例: front-door-cam-01_20260926110932.mp4
 */
export function buildFileName(
  eventType: AvEventType,
  deviceName: string,
  ts: Date = new Date(),
): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}` +
    `${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  return `${deviceName}_${stamp}.${FILE_EXTENSIONS[eventType]}`;
}

/**
 * 统计聚合(纯函数, 今日窗口由调用方 Node 侧计算后传入 —— 避开 PG session 时区偏移)。
 */
export function summarizeAvEvents(
  rows: Array<{ event_type: string; status: string; file_size: number; duration_sec: number; device_id: string; timestamp: Date }>,
  todayStart: Date,
): AvStats {
  const isToday = (t: Date) => t.getTime() >= todayStart.getTime();

  let totalEvents = 0;
  let todayRecording = 0;
  let todaySnapshot = 0;
  let todayPlayback = 0;
  let todayEvents = 0;
  let storageBytes = 0;
  let todayDurationSec = 0;
  let successCount = 0;
  const devices = new Set<string>();
  const todayDevices = new Set<string>();

  for (const row of rows) {
    totalEvents += 1;
    storageBytes += row.file_size;
    devices.add(row.device_id);
    if (row.status === 'success') successCount += 1;

    if (isToday(row.timestamp)) {
      todayEvents += 1;
      todayDurationSec += row.duration_sec;
      todayDevices.add(row.device_id);
      if (row.event_type === 'recording') todayRecording += 1;
      else if (row.event_type === 'snapshot') todaySnapshot += 1;
      else if (row.event_type === 'playback') todayPlayback += 1;
    }
  }

  return {
    total_events: totalEvents,
    today_recording: todayRecording,
    today_snapshot: todaySnapshot,
    today_playback: todayPlayback,
    today_events: todayEvents,
    storage_bytes: storageBytes,
    today_duration_sec: todayDurationSec,
    success_rate: totalEvents > 0 ? successCount / totalEvents : null,
    device_count: todayDevices.size > 0 ? todayDevices.size : devices.size,
  };
}

// ---------------- 域服务 ----------------

export class AvService {
  constructor(private readonly db: PrismaClient) {}

  /** internal 回调写入: 设备名兜底文件名 + 逐条落库 */
  async recordEvents(
    deviceId: string,
    deviceName: string,
    events: AvEventInput[],
  ): Promise<{ received: number }> {
    const normalized = events.map((e) => parseAvEvent(e));
    const ts = new Date();

    await this.db.avEventLog.createMany({
      data: normalized.map((e) => ({
        deviceId,
        eventType: e.eventType,
        status: e.status,
        fileName: e.fileName ?? buildFileName(e.eventType, deviceName, ts),
        fileSize: e.fileSize,
        durationSec: e.durationSec,
        streamProtocol: e.streamProtocol,
        detail: e.detail as object,
        timestamp: ts,
      })),
    });

    return { received: normalized.length };
  }

  /** 小时趋势: SQL 窗口过滤(UTC now, 避 8h 偏移) + 纯函数补零分桶 */
  async getTrend(hours: number): Promise<{ hours: number; buckets: AvTrendBucket[] }> {
    const rows = await this.db.avEventLog.findMany({
      where: {
        timestamp: {
          gte: new Date(Date.now() - hours * 3600 * 1000),
        },
      },
      select: { eventType: true, timestamp: true },
    });
    return {
      hours,
      buckets: buildHourlyTrend(
        rows.map((r) => ({ event_type: r.eventType, timestamp: r.timestamp })),
        hours,
      ),
    };
  }

  /** 统计卡: 拉全量行后在 Node 侧聚合(数据量为事件流水级别, 规模可控) */
  async getStats(): Promise<AvStats> {
    const rows = await this.db.avEventLog.findMany({
      select: {
        eventType: true,
        status: true,
        fileSize: true,
        durationSec: true,
        deviceId: true,
        timestamp: true,
      },
    });
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return summarizeAvEvents(
      rows.map((r) => ({
        event_type: r.eventType,
        status: r.status,
        file_size: r.fileSize,
        duration_sec: r.durationSec,
        device_id: r.deviceId,
        timestamp: r.timestamp,
      })),
      todayStart,
    );
  }

  /** 分页事件列表(join 设备/产品名) */
  async listEvents(query: {
    event_type?: string;
    status?: string;
    device_id?: string;
    keyword?: string;
    page: number;
    page_size: number;
  }): Promise<{ total: number; page: number; page_size: number; items: AvEventRow[] }> {
    const where: Record<string, unknown> = {};
    if (query.event_type && query.event_type !== 'all') where.eventType = query.event_type;
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.device_id) where.deviceId = query.device_id;
    if (query.keyword) {
      where.OR = [
        { fileName: { contains: query.keyword, mode: 'insensitive' } },
        {
          device: {
            deviceName: { contains: query.keyword, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, rows] = await Promise.all([
      this.db.avEventLog.count({ where }),
      this.db.avEventLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
        include: {
          device: { select: { deviceName: true, product: { select: { productName: true } } } },
        },
      }),
    ]);

    return {
      total,
      page: query.page,
      page_size: query.page_size,
      items: rows.map((r) => ({
        id: r.id.toString(),
        device_id: r.deviceId,
        device_name: r.device.deviceName,
        product_name: r.device.product.productName,
        event_type: r.eventType,
        status: r.status,
        file_name: r.fileName,
        file_size: r.fileSize,
        duration_sec: r.durationSec,
        stream_protocol: r.streamProtocol,
        timestamp: r.timestamp,
      })),
    };
  }
}
