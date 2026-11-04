import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ThingModelValidator, toSchemaThingModel } from '../../src/shared/validator.js';

const validator = new ThingModelValidator();

// 与 internal.routes.ts 运行时传入的属性定义格式一致
function prop(identifier: string, dataType: string, spec: Record<string, unknown> = {}) {
  return { identifier, dataType, spec, accessMode: 'rw' };
}

describe('ThingModelValidator.validatePropertyValues', () => {
  describe('int 类型', () => {
    const props = [prop('target_temperature', 'int', { min: 16, max: 30 })];

    it('范围内合法', () => {
      expect(validator.validatePropertyValues(props, { target_temperature: 26 })).toEqual({
        valid: true,
      });
    });

    it('低于 min 报错', () => {
      const r = validator.validatePropertyValues(props, { target_temperature: 10 });
      expect(r.valid).toBe(false);
      expect(r.errors?.[0].field).toBe('target_temperature');
    });

    it('高于 max 报错', () => {
      const r = validator.validatePropertyValues(props, { target_temperature: 35 });
      expect(r.valid).toBe(false);
    });

    it('非整数报错', () => {
      const r = validator.validatePropertyValues(props, { target_temperature: 26.5 });
      expect(r.valid).toBe(false);
      expect(r.errors?.[0].message).toContain('integer');
    });

    it('字符串报错', () => {
      expect(validator.validatePropertyValues(props, { target_temperature: '26' }).valid).toBe(
        false,
      );
    });
  });

  describe('float 类型', () => {
    const props = [prop('temperature', 'float', { min: -40, max: 85 })];

    it('范围内小数合法', () => {
      expect(validator.validatePropertyValues(props, { temperature: 25.7 }).valid).toBe(true);
    });

    it('NaN 非法', () => {
      expect(validator.validatePropertyValues(props, { temperature: NaN }).valid).toBe(false);
    });

    it('超出范围非法', () => {
      expect(validator.validatePropertyValues(props, { temperature: 90 }).valid).toBe(false);
    });
  });

  describe('string 类型', () => {
    it('maxLength 校验', () => {
      const props = [prop('firmware_version', 'string', { maxLength: 8 })];
      expect(validator.validatePropertyValues(props, { firmware_version: 'v1.0.0' }).valid).toBe(
        true,
      );
      const r = validator.validatePropertyValues(props, { firmware_version: 'v1.0.0-beta-1' });
      expect(r.valid).toBe(false);
      expect(r.errors?.[0].message).toContain('exceeds maximum');
    });

    it('pattern 校验', () => {
      const props = [prop('room', 'string', { pattern: '^[a-z0-9-]+$' })];
      expect(validator.validatePropertyValues(props, { room: 'living-room' }).valid).toBe(true);
      expect(validator.validatePropertyValues(props, { room: 'Living Room' }).valid).toBe(false);
    });
  });

  describe('bool 类型', () => {
    const props = [prop('power_switch', 'bool')];

    it('true / false / 0 / 1 均合法', () => {
      expect(validator.validatePropertyValues(props, { power_switch: true }).valid).toBe(true);
      expect(validator.validatePropertyValues(props, { power_switch: false }).valid).toBe(true);
      expect(validator.validatePropertyValues(props, { power_switch: 0 }).valid).toBe(true);
      expect(validator.validatePropertyValues(props, { power_switch: 1 }).valid).toBe(true);
    });

    it('其他值非法', () => {
      expect(validator.validatePropertyValues(props, { power_switch: 'yes' }).valid).toBe(false);
      expect(validator.validatePropertyValues(props, { power_switch: 2 }).valid).toBe(false);
    });
  });

  describe('enum 类型', () => {
    const props = [
      prop(
        'mode',
        'enum',
        {
          enumList: [
            { value: 'auto', label: '自动' },
            { value: 'manual', label: '手动' },
          ],
        },
      ),
    ];

    it('枚举值内合法', () => {
      expect(validator.validatePropertyValues(props, { mode: 'auto' }).valid).toBe(true);
    });

    it('枚举值外非法且提示可选值', () => {
      const r = validator.validatePropertyValues(props, { mode: 'eco' });
      expect(r.valid).toBe(false);
      expect(r.errors?.[0].expected).toBe('auto, manual');
    });
  });

  describe('timestamp 类型', () => {
    const props = [prop('event_time', 'timestamp')];

    it('合法时间戳', () => {
      expect(validator.validatePropertyValues(props, { event_time: Date.now() }).valid).toBe(true);
    });

    it('负数与字符串非法', () => {
      expect(validator.validatePropertyValues(props, { event_time: -1 }).valid).toBe(false);
      expect(validator.validatePropertyValues(props, { event_time: '2026-09-10' }).valid).toBe(
        false,
      );
    });
  });

  it('未知 identifier 的参数被忽略(不报错)', () => {
    const props = [prop('temperature', 'float', { min: 0, max: 100 })];
    const r = validator.validatePropertyValues(props, {
      temperature: 25,
      unknown_field: 'whatever',
    });
    expect(r.valid).toBe(true);
  });

  it('多个非法值一次性返回全部错误', () => {
    const props = [
      prop('temperature', 'float', { min: 0, max: 100 }),
      prop('power_switch', 'bool'),
    ];
    const r = validator.validatePropertyValues(props, { temperature: 200, power_switch: 'x' });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
});

describe('ThingModelValidator.validateDefinition', () => {
  const validModel = {
    version: '1.0',
    properties: [
      {
        id: 'temperature',
        name: '当前温度',
        type: 'float',
        mode: 'rw',
        required: true,
        spec: { min: -40, max: 85, step: 0.1, unit: '°C' },
      },
    ],
  };

  it('合法物模型通过', () => {
    expect(validator.validateDefinition(validModel)).toEqual({ valid: true });
  });

  it('官方示例模型(01-thing-model-definition.json)完整通过', () => {
    // 回归: 修复前所有 spec 均因 oneOf 分支重叠而失败
    const example: Record<string, unknown> = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../../backend-design/json-payload-examples/01-thing-model-definition.json', import.meta.url),
        ),
        'utf-8',
      ),
    );
    delete example._comment;
    expect(validator.validateDefinition(example)).toEqual({ valid: true });
  });

  it('混杂不同类型 spec 字段被拒绝(additionalProperties 隔离)', () => {
    // 修复前此类 spec 会同时匹配多个 oneOf 分支
    const r = validator.validateDefinition({
      version: '1.0',
      properties: [
        { id: 'temperature', name: '温度', type: 'float', mode: 'rw', spec: { min: 0, maxLength: 10 } },
      ],
    });
    expect(r.valid).toBe(false);
  });

  it('缺少 version 报错', () => {
    const r = validator.validateDefinition({ properties: validModel.properties });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => e.message.includes('version'))).toBe(true);
  });

  it('属性缺少必填字段 name 报错', () => {
    const r = validator.validateDefinition({
      version: '1.0',
      properties: [{ id: 'temperature', type: 'float', mode: 'rw' }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => e.message.includes('name'))).toBe(true);
  });
});

describe('toSchemaThingModel API风格适配', () => {
  it('API 风格(identifier/dataType/accessMode)转换后校验通过', () => {
    const apiModel = {
      version: '1.0',
      properties: [
        { identifier: 'temperature', name: '当前温度', dataType: 'float', accessMode: 'rw', description: '温度读数', spec: { min: -40, max: 85, step: 0.1, unit: '°C' }, required: true },
        { identifier: 'power_switch', name: '电源开关', dataType: 'bool', accessMode: 'rw', spec: { '0': '关', '1': '开' } },
        { identifier: 'working_mode', name: '工作模式', dataType: 'enum', accessMode: 'rw', spec: { enumList: [{ value: 'auto', label: '自动' }] } },
      ],
      events: [
        { identifier: 'high_temp', name: '高温告警', eventType: 'warn', description: '温度过高', outputParams: [{ identifier: 'temp', name: '温度', dataType: 'float' }] },
      ],
      actions: [
        { identifier: 'reboot', name: '重启', description: '远程重启', inputParams: [], outputParams: [] },
      ],
    };
    const r = validator.validateDefinition(toSchemaThingModel(apiModel));
    expect(r.valid).toBe(true);
  });

  it('转换保留 profile 并透传 spec 原文', () => {
    const out = toSchemaThingModel({
      version: '1.0',
      profile: { productKey: 'pk1' },
      properties: [{ identifier: 'v', name: '电压', dataType: 'int', accessMode: 'r', spec: { min: 0, max: 220 } }],
    }) as any;
    expect(out.profile).toEqual({ productKey: 'pk1' });
    expect(out.properties[0]).toMatchObject({ id: 'v', type: 'int', mode: 'r' });
    expect(out.properties[0].spec).toEqual({ min: 0, max: 220 });
    expect(out.properties[0].desc).toBeUndefined();
  });

  it('非法值(min>max)在转换后仍被 schema 拦截? — schema 只校验结构不校验数值关系,语义校验由上层负责', () => {
    // 文档化行为: schema 校验结构(标识符 pattern 等), min>max 的语义校验在前端完成
    const out = toSchemaThingModel({
      version: '1.0',
      properties: [{ identifier: 'vv', name: 'V', dataType: 'int', accessMode: 'r', spec: { min: 100, max: 1 } }],
    }) as any;
    const r = validator.validateDefinition(out);
    expect(r.valid).toBe(true);
  });

  it('标识符仅 1 个字符被 schema 拒绝(pattern 要求首字母+至少1个字符)', () => {
    const out = toSchemaThingModel({
      version: '1.0',
      properties: [{ identifier: 'v', name: 'V', dataType: 'int', accessMode: 'r', spec: { min: 0, max: 10 } }],
    }) as any;
    const r = validator.validateDefinition(out);
    expect(r.valid).toBe(false);
    expect(r.errors?.some((e) => e.field.includes('properties.0.id'))).toBe(true);
  });
});
