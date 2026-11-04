/**
 * 自然语言 → 设备影子指令解析 (方案 #1)
 *
 * 数据流: 文本 + 设备 → [候选集组装] → TypeSafe 第一问(intent + 属性)
 *        → 按 dataType 构造第二问(取值) → 确定性校验 → proposed
 *
 * 设计要点:
 * - 模型只负责"选", 对错由 code 用物模型 spec 判定 (validateValue)
 * - 本服务只产出 proposed, **绝不写影子**; 下发仍由 PUT /api/v1/shadows/:deviceId 完成
 * - 模型输出不产生面向用户的自由文本, explanation/hint 全部由模板拼装
 *
 * 参考: .ai-docs/designs/typesafe/01-nl-shadow-command-design.md
 */
import {
  TypeSafeClient,
  noul,
  choice,
  type JsonValue,
  type Question,
  type RequestOptions,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { DeviceNotFoundError, IotError, UpstreamServiceError } from '../shared/errors.js';
import { ProductService } from './product.service.js';
import type { ThingModelProperty } from '../types/index.js';

// ============================================================
// 阈值 (需在真实数据上标定, 见设计文档第 3 节)
// ============================================================

/** intent Noul 的判定阈值: > 该值才认为"这是下发指令" */
export const INTENT_THRESHOLD = 0.5;
/** Choice 的 confidence 低于该值时走澄清, 不猜 */
export const CONFIDENCE_THRESHOLD = 0.8;
/**
 * 定时/条件提及的阈值。
 *
 * 设计文档把 mentions_timing 列为「可选加分项」, 但实测表明它是**安全护栏**而非锦上添花:
 * 「如果温度超过30度就把电源关掉」在缺少该问时会被当成无条件指令, 立刻关电源。
 * 漏判的代价是"该延后却立即执行", 因此阈值取保守值: 宁可多澄清。
 */
export const TIMING_THRESHOLD = 0.5;
/**
 * 多属性提及的阈值。
 *
 * F1「打开电源并把温度调到25度」目前只是被 `target_property` 的 confidence (0.59)
 * **偶然**拦下的, 不是被规则拦下的 —— 阈值一降就会放行, 而且只写入两个属性中的一个,
 * 用户以为两个都设了。这里补一条结构性护栏, 与 mentions_timing 同样的手法:
 * 同批发出, 零额外延迟, 命中即澄清。
 */
export const MULTIPLE_THRESHOLD = 0.5;
/** step 对齐的相对容差 (浮点取模不可靠, 改用除法 + 容差) */
export const STEP_EPSILON = 1e-9;

/** 数值族 dataType — 取值域可确定性判定的类型 (string/timestamp 什么都收, 不参与可行性推断) */
const NUMERIC_TYPES = new Set(['int', 'long', 'float', 'double']);

/** 逃逸口: 模型选不出没给它的选项, 该选项是硬要求 */
export const NONE = '__none__';

// ============================================================
// 纯函数 1: 取值候选抽取
// ============================================================

export interface ValueSpan {
  /** 原文中的原始文本片段 (未归一化) */
  raw: string;
  start: number;
  end: number;
}

/**
 * 从前文抽取数值候选片段。
 *
 * 只抽阿拉伯数字。"二十度" 抽不到任何 span → 上层走澄清 (V1 不支持中文数字)。
 * 排除紧邻字母/下划线/连字符的数字, 避免把 device-001 里的 001 当成取值。
 */
export function extractValueSpans(text: string): ValueSpan[] {
  // 前后都不能是标识符字符: 排除 device-001 / temp_val_2 / 1abc 这类
  const re = /(?<![A-Za-z0-9_.-])-?\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;
  const spans: ValueSpan[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    spans.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

// ============================================================
// 纯函数 2: 物模型取值校验
// ============================================================

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

function specNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * step 对齐检查 — 用除法 + 相对容差, 不用 `%`。
 * 浮点取模在 22.5 % 0.5 这类场景下不可靠。
 */
export function isStepAligned(n: number, base: number, step: number): boolean {
  if (step <= 0) return true;
  const q = (n - base) / step;
  const nearest = Math.round(q);
  const tol = STEP_EPSILON * Math.max(1, Math.abs(q));
  return Math.abs(q - nearest) <= tol;
}

/**
 * 按物模型属性的 dataType + spec 校验模型/正则给出的原始取值。
 *
 * 这是**安全网**: 模型答错必须在这里被拦下。返回的 value 是归一化后的类型安全值。
 * string 类型在 V1 由上层直接澄清, 不会走到这里 (仍保留分支以防调用方绕过)。
 */
export function validateValue(
  prop: Pick<ThingModelProperty, 'identifier' | 'dataType' | 'spec'>,
  raw: string,
): ValidationResult {
  const spec = (prop.spec ?? {}) as Record<string, unknown>;
  const label = prop.identifier;

  switch (prop.dataType) {
    case 'int':
    case 'long': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) {
        return { ok: false, reason: `${label}: 「${raw}」不是合法数值` };
      }
      if (!Number.isInteger(n)) {
        return { ok: false, reason: `${label}: 「${raw}」必须是整数` };
      }
      const min = specNumber(spec['min']);
      const max = specNumber(spec['max']);
      const step = specNumber(spec['step']);
      if (min !== undefined && n < min) {
        return { ok: false, reason: `${label}: ${n} 低于下限 ${min}` };
      }
      if (max !== undefined && n > max) {
        return { ok: false, reason: `${label}: ${n} 超过上限 ${max}` };
      }
      if (step !== undefined && step > 0 && !isStepAligned(n, min ?? 0, step)) {
        return { ok: false, reason: `${label}: ${n} 不是步长 ${step} 的整数倍` };
      }
      return { ok: true, value: n };
    }

    case 'float':
    case 'double': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) {
        return { ok: false, reason: `${label}: 「${raw}」不是合法数值` };
      }
      const min = specNumber(spec['min']);
      const max = specNumber(spec['max']);
      const step = specNumber(spec['step']);
      if (min !== undefined && n < min) {
        return { ok: false, reason: `${label}: ${n} 低于下限 ${min}` };
      }
      if (max !== undefined && n > max) {
        return { ok: false, reason: `${label}: ${n} 超过上限 ${max}` };
      }
      if (step !== undefined && step > 0 && !isStepAligned(n, min ?? 0, step)) {
        return { ok: false, reason: `${label}: ${n} 不是步长 ${step} 的整数倍` };
      }
      return { ok: true, value: n };
    }

    case 'bool': {
      const onLabel = typeof spec['1'] === 'string' ? (spec['1'] as string) : '开';
      const offLabel = typeof spec['0'] === 'string' ? (spec['0'] as string) : '关';
      if (raw === '1' || raw === onLabel) return { ok: true, value: 1 };
      if (raw === '0' || raw === offLabel) return { ok: true, value: 0 };
      return { ok: false, reason: `${label}: 「${raw}」不是合法布尔取值 (0/1)` };
    }

    case 'enum': {
      const list = Array.isArray(spec['enumList'])
        ? (spec['enumList'] as Array<{ value?: unknown }>)
        : [];
      const match = list.find((e) => String(e?.value) === raw);
      if (!match) {
        return { ok: false, reason: `${label}: 「${raw}」不在枚举取值范围内` };
      }
      return { ok: true, value: raw };
    }

    case 'string': {
      const maxLength = specNumber(spec['maxLength']);
      if (maxLength !== undefined && raw.length > maxLength) {
        return { ok: false, reason: `${label}: 超过 ${maxLength} 字符` };
      }
      return { ok: true, value: raw };
    }

    case 'timestamp': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) {
        return { ok: false, reason: `${label}: 「${raw}」不是合法时间戳` };
      }
      return { ok: true, value: n };
    }

    default:
      return { ok: false, reason: `${label}: 不支持的 dataType「${prop.dataType}」` };
  }
}

/** 属性是否可写。accessMode 为 r 的属性绝不能进候选集。 */
export function isWritable(prop: Pick<ThingModelProperty, 'accessMode'>): boolean {
  return prop.accessMode === 'rw' || prop.accessMode === 'w';
}

/**
 * 文本里字面提到、却不在候选集里的属性名。
 *
 * 用于「你是不是想设置 XXX?」——只读属性(accessMode=r)被点名时,
 * 「这不是一条下发指令」是误导: 用户确实想下发, 只是那个属性不可写。
 * 纯字面匹配, 不调用模型。
 */
export function mentionedUnavailable(
  text: string,
  all: Array<Pick<ThingModelProperty, 'identifier' | 'name'>>,
  writable: Array<Pick<ThingModelProperty, 'identifier'>>,
): string[] {
  const writableIds = new Set(writable.map((p) => p.identifier));
  const hits: string[] = [];
  for (const p of all) {
    if (writableIds.has(p.identifier)) continue;
    // 标识符优先, 名字兜底 (中文描述更常出现在自然语言里)
    if (text.includes(p.identifier)) hits.push(p.identifier);
    else if (p.name && text.includes(p.name)) hits.push(p.name);
  }
  return hits;
}

/** 文本里是否字面提到了该属性 (identifier 或中文名)。与 `mentionedUnavailable` 同一套匹配规则。 */
export function mentionsProperty(
  text: string,
  prop: Pick<ThingModelProperty, 'identifier' | 'name'>,
): boolean {
  if (text.includes(prop.identifier)) return true;
  return Boolean(prop.name) && text.includes(prop.name);
}

// ============================================================
// 纯函数 3: 澄清文案的组装 (F-1 / F-6)
// ============================================================

/**
 * 把校验原因里的机读 identifier 换成给人看的中文名 (F-6)。
 *
 * `rejected[].reason` 保留 identifier (程序可读), 但直接端给用户的 hint 不该出现
 * `target_temperature` —— 用户从没说过这个词。只替换**第一处** (原因串以 `${label}: ` 开头),
 * 避免数值里恰好含同名字符串时被误换。
 */
export function displayReason(
  reason: string,
  prop: Pick<ThingModelProperty, 'identifier' | 'name'>,
): string {
  return prop.name ? reason.replace(prop.identifier, prop.name) : reason;
}

/**
 * 同一取值在**别的可写属性**上是否合法 (F-1)。
 *
 * 「温度设成22.5度」被 int 的「目标温度」拒绝, 但 22.5 对 float 的「当前温度」完全合法 ——
 * 用户说得没错, 只是没指明属性名。此时「必须是整数」是**误导**: 它暗示用户的值有问题,
 * 实际有问题的是一次属性归属。这里找出能接受该值的其它数值属性, 让 hint 给出可操作的下一步。
 *
 * 纯 code, 零 API 调用, 且**只改文案, 不改 proposed** —— 绝不让它变成"换个属性写进去"。
 * 这是启发式, 不是判定: 提示以疑问句给出 ("如果你指的是…"), 用户可无视。
 */
export function alternativeHolders(
  raw: string,
  writable: Array<Pick<ThingModelProperty, 'identifier' | 'name' | 'dataType' | 'spec'>>,
  excludeIdentifier: string,
): string[] {
  const names: string[] = [];
  for (const p of writable) {
    if (p.identifier === excludeIdentifier) continue;
    // 只考虑数值族。string / timestamp 是"什么都收"的兜底类型, 任何取值都能通过,
    // 会让提示退化成噪声; 且 V1 不支持 string 下发 (askValue 一律澄清), 指过去也是死路。
    if (!NUMERIC_TYPES.has(p.dataType)) continue;
    if (validateValue(p, raw).ok) names.push(p.name || p.identifier);
  }
  return names;
}

// ============================================================
// 类型
// ============================================================

/** 可注入的最小 client 面。真实 TypeSafeClient 结构化满足, 测试用 fake 替代。 */
export type ParseClient = Pick<TypeSafeClient, 'systemOne'>;

export interface ParseLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  /** 必填而非可选: 漏接线时应当在编译期报错, 而不是运行时静默丢掉日志 */
  error(obj: Record<string, unknown>, msg?: string): void;
}

const consoleLogger: ParseLogger = {
  info: (obj, msg) => console.log(`[command-parse] ${msg ?? ''}`, JSON.stringify(obj)),
  warn: (obj, msg) => console.warn(`[command-parse] ${msg ?? ''}`, JSON.stringify(obj)),
  error: (obj, msg) => console.error(`[command-parse] ${msg ?? ''}`, JSON.stringify(obj)),
};

export interface RejectedItem {
  identifier: string;
  reason: string;
}

/**
 * 第一问四个判断的原始置信度。
 *
 * 存在的理由: 顶层 `confidence` 是**重载**的 —— 护栏命中时它装的是"触发该护栏那个问题的
 * 置信度", 正常路径上装的是属性置信度。实测读表时这就是坑: 表格里一个数字,
 * 分不清是"模型不确定选哪个属性"还是"用户要求改两个属性"。
 * 这里把四个值原样摊开, 让"谁是谁"不再靠 hint 反推。
 */
export interface ParseJudgments {
  /** 是否是一条可执行的下发指令 */
  intent_actionable: number;
  /** 是否含定时/条件 */
  mentions_timing: number;
  /** 是否要求同时修改两个或以上属性 */
  mentions_multiple: number;
  /** 选中的属性置信度; 无答案时为 0 */
  target_property_confidence: number;
}

export interface ParseMeta {
  /** 每次请求返回的 model 字段 (实际版本号), 按调用顺序 */
  models: Array<string | null>;
  /** 每次请求的耗时 ms, 按调用顺序 */
  timings_ms: number[];
  /** 候选集大小 (可写属性数) */
  candidate_count: number;
  /** 抽取到的取值候选 */
  value_spans: string[];
  /** 第一问的四个原始判定值。未调用模型就短路时不存在 (如"无可写属性") */
  judgments?: ParseJudgments;
}

export interface ParseCommandResult {
  /** 校验通过、可预填进 desired 的键值对; 失败为 null */
  proposed: Record<string, unknown> | null;
  /** 由 code 模板拼装, 非模型生成 */
  explanation: string;
  target_property: string | null;
  confidence: number;
  rejected: RejectedItem[];
  /** 文本中提到但候选集里没有的属性名 */
  unknown: string[];
  needs_clarification: boolean;
  hint: string | null;
  meta: ParseMeta;
}

/** 候选集被截断时的标记, 用于强制澄清 */
export const MAX_CANDIDATES = 64;

// ============================================================
// 服务
// ============================================================

export class CommandParseService {
  private client: ParseClient | null = null;
  private readonly productService: ProductService;

  constructor(
    private readonly db: PrismaClient,
    private readonly logger: ParseLogger = consoleLogger,
    /** 可注入的 client; 不传则懒创建 (缺 API key 时抛错而不是启动即崩) */
    client?: ParseClient,
    private readonly modelOverride?: string,
  ) {
    this.productService = new ProductService(db);
    if (client) this.client = client;
  }

  /**
   * 懒创建 client。`new TypeSafeClient()` 在缺少 TYPESAFE_API_KEY 时会抛错,
   * 因此不能放在构造函数 —— 否则整个后端无法启动。
   *
   * 缺 key 归入"上游不可用"而不是 400: 这不是调用方的输入有问题, 是他的请求**当前无法被服务**。
   * 先记日志再抛 —— app.ts 的 IotError 分支不打日志, 不在这里写就没人知道是配置问题。
   */
  private getClient(): ParseClient {
    if (this.client) return this.client;
    const apiKey = process.env['TYPESAFE_API_KEY'];
    if (!apiKey || apiKey.trim() === '') {
      this.logger.error(
        { step: 'typesafe', missing: 'TYPESAFE_API_KEY' },
        '解析服务未配置',
      );
      throw new UpstreamServiceError('解析服务未配置, 请联系管理员');
    }
    const cfg: TypeSafeClientConfig = { apiKey };
    // 显式 model 覆盖: 用于固定到具体版本而非 jev-latest 别名
    if (this.modelOverride) cfg.defaultModel = this.modelOverride;
    this.client = new TypeSafeClient(cfg);
    return this.client;
  }

  /**
   * 所有对 TypeSafe 的调用都必须经这里 (F-10)。直接让 SDK 的错误抛出去有两个后果, 第 4 轮实跑都撞到了:
   *  ① 经 app.ts 的兜底分支变成一次对外 500 —— 前端分不清"上游挂了"和"用户输入有问题";
   *  ② SDK 错误的 message 里装着上游**响应体**(实测是 Cloudflare 拦截页, 含我们的出口 IP),
   *     而兜底分支会把 error.message 原样回显给调用方。
   * 所以: 原始错误只进服务端日志(app.ts 的 IotError 分支不打日志, 这里是唯一的落点),
   * 对外只给固定文案 + 稳定 code。
   *
   * 用 thunk 而非 (params, options) 形式: T 由调用点推断, 不必去抠 SDK systemOne 的泛型签名。
   */
  private async callUpstream<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      // 已是我们自己的受控错误(如上面"未配置"那条) —— 原样透出, 否则诊断信息被下面的兜底盖掉
      if (err instanceof IotError) throw err;
      this.logger.error(
        {
          step: 'typesafe',
          // Error 的属性不可枚举: JSON.stringify({ err }) 会打成 {} —— 显式展开
          errName: err instanceof Error ? err.name : typeof err,
          errMessage: err instanceof Error ? err.message : String(err),
          errStack: err instanceof Error ? err.stack : undefined,
        },
        'TypeSafe 调用失败, 已翻译为 502/50003',
      );
      throw new UpstreamServiceError('解析服务暂时不可用, 请稍后重试');
    }
  }

  async parse(deviceId: string, text: string): Promise<ParseCommandResult> {
    const started = Date.now();
    const meta: ParseMeta = {
      models: [],
      timings_ms: [],
      candidate_count: 0,
      value_spans: [],
    };

    // ---------- ① 候选集组装 ----------
    const device = await this.db.device.findUnique({
      where: { deviceId },
      select: { deviceId: true, deviceName: true, productId: true },
    });
    if (!device) {
      throw new DeviceNotFoundError(`设备不存在: ${deviceId}`);
    }

    const snapshot = await this.productService.getThingModelSnapshot(device.productId);
    const allProps = snapshot.properties as ThingModelProperty[];
    // accessMode 为 r 的属性不进候选 —— 模型选不出没给它的选项
    const writable = allProps.filter(isWritable);
    // 只读属性被点名时说清原因, 而不是笼统地"不是下发指令"
    const unavailable = mentionedUnavailable(text, allProps, writable);

    meta.candidate_count = writable.length;

    // H1: 无可写属性 → 调用模型前短路, 零成本
    if (writable.length === 0) {
      return this.clarify(
        '该产品没有可写属性, 无法下发指令',
        meta,
        Date.now() - started,
      );
    }

    if (writable.length > MAX_CANDIDATES) {
      return this.clarify(
        `该产品可写属性过多 (${writable.length} 个), 超出解析能力, 请手动填写 JSON`,
        meta,
        Date.now() - started,
      );
    }

    // ---------- ② 第一问: intent + 属性 ----------
    const propCriteria: Record<string, string | null> = {};
    for (const p of writable) {
      propCriteria[p.identifier] = describeProperty(p);
    }
    propCriteria[NONE] = '以上都不是, 或无法从文本确定';

    const t1 = Date.now();
    const first = await this.callUpstream(() => this.getClient().systemOne({
      state: {
        request: { text, device_name: device.deviceName },
        writable_properties: writable.map((p) => ({
          identifier: p.identifier,
          name: p.name,
          dataType: p.dataType,
          spec: asJson(p.spec ?? {}),
          description: p.description ?? null,
        })),
      },
      questions: {
        intent_actionable: noul(
          '`request.text` 是否在请求修改 `writable_properties` 中某个属性的期望状态?' +
            '而不是查询当前值、询问设备状态、闲聊, 或提到一个不在清单里的属性。',
          {
            true: '在请求下发/设置某个属性的值',
            false: '是查询、闲聊、涉及不可写属性, 或与属性下发无关',
          },
        ),
        target_property: choice(
          '`request.text` 想修改 `writable_properties` 里的哪个属性?',
          propCriteria,
        ),
        // speculative fan-out: 同批请求, 零额外延迟。命中即澄清, 绝不当成立即指令下发。
        mentions_timing: noul(
          '`request.text` 是否把**执行时机或触发条件**附加在这次下发上?' +
            '例如「5分钟后」「明天早上」「当温度超过30度时」「如果…就…」。' +
            '仅当这些限定语作用于本次下发时为 true; 单纯描述现状的时间词不算。',
          {
            true: '含定时或条件, 不能立即无条件执行',
            false: '是立即、无条件的下发',
          },
        ),
        // 同上手法。必须问"是否要求修改多个", 而不是"提到了几个属性名":
        // 「把20度调到30度」提到两个数值但只改一个属性, 后者会误判。
        mentions_multiple: noul(
          '`request.text` 是否要求**同时修改两个或以上**属性的期望状态?' +
            '注意: 只有当每个属性都被要求改成新值时才是 true;' +
            '只描述现状、只作对比、或同一属性被提到多次都不算。' +
            '例如「打开电源并把温度调到25度」为 true, 「把20度调到30度」为 false。',
          {
            true: '要求同时修改两个或以上属性',
            false: '只要求修改一个属性 (或没有要求修改)',
          },
        ),
      },
      ...(this.modelOverride ? { model: this.modelOverride } : {}),
    }, { timeout: REQUEST_TIMEOUT_MS }));
    const d1 = Date.now() - t1;

    // SDK 把 answers 声明成全量映射 `{[K in keyof Q]: ResultFor<Q[K]>}` —— 那是编译期的承诺,
    // 运行时少一个答案就会在这几行直接抛 TypeError 变成 500。四处读取一律兜底,
    // 且兜底方向统一为"多澄清": 缺失一律取 0, 落到下面的澄清分支而不放行。
    const targetAnswer = first.answers.target_property;
    const intent = first.answers.intent_actionable?.noul ?? 0;
    const timing = first.answers.mentions_timing?.noul ?? 0;
    const multiple = first.answers.mentions_multiple?.noul ?? 0;
    const targetProp = targetAnswer?.choice;
    const propConfidence = targetAnswer?.confidence ?? 0;

    meta.models.push(first.model ?? null);
    meta.timings_ms.push(d1);
    meta.judgments = {
      intent_actionable: intent,
      mentions_timing: timing,
      mentions_multiple: multiple,
      target_property_confidence: propConfidence,
    };
    this.logStep('request1', {
      model: first.model,
      elapsed_ms: d1,
      intent_actionable: intent,
      mentions_timing: timing,
      mentions_multiple: multiple,
      target_property: targetProp ?? null,
      target_property_confidence: propConfidence,
      probabilities: targetAnswer?.probabilities ?? null,
      usage: first.usage,
    });

    if (intent <= INTENT_THRESHOLD) {
      // 点名了只读属性时给准确原因: 用户想下发, 只是那个属性不可写
      const hint = unavailable.length
        ? `「${unavailable.join('、')}」不可写入 (只读属性), 无法下发。`
        : '这看起来不是一条属性下发指令';
      return this.clarify(hint, meta, Date.now() - started, {
        confidence: intent,
        unknown: unavailable,
      });
    }
    // 定时/条件必须先于取值解析拦下 —— 否则「如果…就关电源」会被立刻执行
    if (timing > TIMING_THRESHOLD) {
      return this.clarify(
        'V1 只支持立即、无条件的下发, 不支持定时或条件指令。请改为立即下发, 或手动配置转发规则。',
        meta,
        Date.now() - started,
        { target_property: targetProp || null, confidence: timing, unknown: unavailable },
      );
    }
    // 多属性同理必须拦在取值解析之前: 放行的话只会写入其中一个属性,
    // 而用户以为两个都设了 —— 静默的半执行比拒绝更糟。
    if (multiple > MULTIPLE_THRESHOLD) {
      return this.clarify(
        'V1 每次只能下发一个属性, 请分开逐条下发。',
        meta,
        Date.now() - started,
        {
          target_property: targetProp && targetProp !== NONE ? targetProp : null,
          confidence: multiple,
          unknown: unavailable,
        },
      );
    }
    if (targetProp === NONE) {
      return this.clarify('无法从文本确定要修改哪个属性, 请指明属性名', meta, Date.now() - started, {
        confidence: propConfidence,
        unknown: unavailable,
      });
    }
    if (propConfidence < CONFIDENCE_THRESHOLD) {
      return this.clarify(
        `对目标属性不确定 (confidence ${propConfidence.toFixed(2)}), 请明确指出属性名`,
        meta,
        Date.now() - started,
        { target_property: targetProp, confidence: propConfidence, unknown: unavailable },
      );
    }

    // 防御: 模型返回的 identifier 必须同时存在于候选集与该产品可写集合
    const chosen = writable.find((p) => p.identifier === targetProp);
    if (!chosen) {
      return this.clarify('解析出的属性不在可写范围内', meta, Date.now() - started, {
        target_property: targetProp,
        confidence: propConfidence,
        unknown: unavailable,
      });
    }

    const base = {
      target_property: chosen.identifier,
      confidence: propConfidence,
      unknown: unavailable,
    };

    // ---------- ③ 第二问: 取值 ----------
    const valueOutcome = await this.askValue(chosen, text, meta);

    if (valueOutcome.kind === 'clarify') {
      return this.clarify(valueOutcome.hint, meta, Date.now() - started, base);
    }

    // ---------- ④ 确定性校验 ----------
    const check = validateValue(chosen, valueOutcome.raw);
    if (!check.ok) {
      // 用户没点名属性时, 「必须是整数」这类提示会把"属性归属错了"说成"你的值错了"。
      // 找出还有哪个可写属性能接受这个值, 给出可操作的下一步。
      // 只改文案: proposed 仍为 null, 绝不自动改写到另一个属性 (那会绕开值域检查)。
      const others = mentionsProperty(text, chosen)
        ? []
        : alternativeHolders(valueOutcome.raw, writable, chosen.identifier);
      const hint =
        others.length > 0
          ? `${displayReason(check.reason, chosen)}。如果你指的是「${others.join('、')}」, 请指明属性名后重试。`
          : `${displayReason(check.reason, chosen)}。请修正后重试, 或手动填写 JSON。`;
      return {
        proposed: null,
        explanation: `解析出「${chosen.name}」= ${valueOutcome.raw}, 但未通过校验`,
        ...base,
        rejected: [{ identifier: chosen.identifier, reason: check.reason }],
        unknown: unavailable,
        needs_clarification: true,
        hint,
        meta,
      };
    }

    return {
      proposed: { [chosen.identifier]: check.value },
      explanation: `将「${chosen.name}」(${chosen.identifier}) 设为 ${formatValue(check.value)}${unitSuffix(chosen)}`,
      ...base,
      rejected: [],
      unknown: unavailable,
      needs_clarification: false,
      hint: null,
      meta,
    };
  }

  // ---------- 取值问题 (按 dataType 分支) ----------

  private async askValue(
    prop: ThingModelProperty,
    text: string,
    meta: ParseMeta,
  ): Promise<{ kind: 'value'; raw: string } | { kind: 'clarify'; hint: string }> {
    const spec = (prop.spec ?? {}) as Record<string, unknown>;
    let criteria: Record<string, string | null>;
    let instructions: string;

    if (prop.dataType === 'bool') {
      const onLabel = typeof spec['1'] === 'string' ? (spec['1'] as string) : '开';
      const offLabel = typeof spec['0'] === 'string' ? (spec['0'] as string) : '关';
      criteria = {
        '1': onLabel,
        '0': offLabel,
        [NONE]: '文本没有表达要开还是关',
      };
      instructions = `\`request.text\` 要把「${prop.name}」设成哪个状态?`;
    } else if (prop.dataType === 'enum') {
      const list = Array.isArray(spec['enumList'])
        ? (spec['enumList'] as Array<{ value?: unknown; label?: unknown }>)
        : [];
      criteria = {};
      for (const item of list) {
        const v = String(item?.value ?? '');
        if (!v) continue;
        criteria[v] = typeof item?.label === 'string' ? item.label : null;
      }
      criteria[NONE] = '文本表达了别的取值, 或无法确定';
      instructions = `\`request.text\` 要把「${prop.name}」设成哪个值?`;
    } else if (prop.dataType === 'string') {
      // V1: 不做自然语言字符串抽取 (见设计文档「已知缺口 ①」)
      return {
        kind: 'clarify',
        hint: `V1 不支持通过自然语言设置文本类型属性「${prop.name}」, 请手动填写 JSON。`,
      };
    } else {
      // int / long / float / double / timestamp: 先抽 span, 再让模型选
      const spans = extractValueSpans(text);
      const unique = [...new Set(spans.map((s) => s.raw))];
      meta.value_spans = unique;
      if (unique.length === 0) {
        return {
          kind: 'clarify',
          hint: `文本中没有找到「${prop.name}」的目标数值, 请明确给出数字 (V1 不支持中文数字)。`,
        };
      }
      criteria = {};
      for (const raw of unique) criteria[raw] = `文本中出现的数值 ${raw}`;
      criteria[NONE] = '文本没有给出明确的目标值, 或给出的不是这个属性的值';
      instructions = `\`request.text\` 要把「${prop.name}」设成哪个值?`;
    }

    const t2 = Date.now();
    const second = await this.callUpstream(() => this.getClient().systemOne({
      state: { request: { text }, target_property: { identifier: prop.identifier, name: prop.name } },
      questions: { target_value: choice(instructions, criteria) },
      ...(this.modelOverride ? { model: this.modelOverride } : {}),
    }, { timeout: REQUEST_TIMEOUT_MS }));
    const d2 = Date.now() - t2;

    const picked = second.answers.target_value.choice as string;
    const conf = second.answers.target_value.confidence;

    meta.models.push(second.model ?? null);
    meta.timings_ms.push(d2);
    this.logStep('request2', {
      model: second.model,
      elapsed_ms: d2,
      data_type: prop.dataType,
      target_value: picked,
      confidence: conf,
      probabilities: second.answers.target_value.probabilities,
      usage: second.usage,
    });

    if (picked === NONE) {
      return { kind: 'clarify', hint: `文本没有给出「${prop.name}」的明确目标值, 请指明。` };
    }
    if (conf < CONFIDENCE_THRESHOLD) {
      return {
        kind: 'clarify',
        hint: `对「${prop.name}」的目标取值不确定 (confidence ${conf.toFixed(2)}), 请明确给出数值。`,
      };
    }
    return { kind: 'value', raw: picked };
  }

  // ---------- 辅助 ----------

  private logStep(step: string, payload: Record<string, unknown>): void {
    this.logger.info(payload, `${step} 原始答案`);
  }

  private clarify(
    hint: string,
    meta: ParseMeta,
    _elapsed: number,
    extra: Partial<Pick<ParseCommandResult, 'confidence' | 'target_property' | 'unknown'>> = {},
  ): ParseCommandResult {
    return {
      proposed: null,
      explanation: '',
      target_property: extra.target_property ?? null,
      confidence: extra.confidence ?? 0,
      rejected: [],
      unknown: extra.unknown ?? [],
      needs_clarification: true,
      hint,
      meta,
    };
  }
}

// 单次请求超时。SDK 默认 10s 且有重试, 这里收紧以保住交互延迟预算。
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Prisma 的 Json 列在类型上是 `unknown`, 运行时保证是 JSON 值。
 * 仅用于把物模型 spec 送进 TypeSafe 的 state。
 */
function asJson(v: unknown): JsonValue {
  return v as JsonValue;
}

function describeProperty(p: ThingModelProperty): string {
  const spec = (p.spec ?? {}) as Record<string, unknown>;
  const parts: string[] = [`${p.name}, ${p.dataType}`];
  if (p.dataType === 'bool') {
    parts.push(`0=${spec['0'] ?? '关'} 1=${spec['1'] ?? '开'}`);
  } else if (p.dataType === 'enum' && Array.isArray(spec['enumList'])) {
    const list = spec['enumList'] as Array<{ value?: unknown; label?: unknown }>;
    parts.push(list.map((e) => `${e.value}=${e.label ?? e.value}`).join(' / '));
  } else {
    const min = spec['min'];
    const max = spec['max'];
    if (min !== undefined || max !== undefined) {
      parts.push(`范围 ${min ?? '-∞'}~${max ?? '+∞'}`);
    }
    if (typeof spec['unit'] === 'string') parts.push(`单位 ${spec['unit']}`);
  }
  return parts.join(', ');
}

function unitSuffix(p: ThingModelProperty): string {
  const unit = (p.spec as Record<string, unknown> | null)?.['unit'];
  return typeof unit === 'string' ? unit : '';
}

function formatValue(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

/** 供路由层复用: 构造带注入的实例 */
export function createCommandParseService(
  db: PrismaClient,
  logger: ParseLogger,
  client?: ParseClient,
): CommandParseService {
  return new CommandParseService(
    db,
    logger,
    client,
    process.env['TYPESAFE_MODEL'] || undefined,
  );
}

export type { Question, RequestOptions };
