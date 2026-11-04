import { Ajv, ErrorObject } from 'ajv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface ValidationFieldError {
  field: string;
  message: string;
  expected?: string;
  received?: unknown;
}

interface ValidationResult {
  valid: boolean;
  errors?: Array<ValidationFieldError>;
}

interface PropertyDefinition {
  identifier: string;
  dataType: string;
  spec: Record<string, unknown>;
  accessMode: string;
}

interface ActionParamDefinition {
  identifier: string;
  dataType: string;
  spec: Record<string, unknown>;
}

interface EnumItem {
  value: string;
  label: string;
}

function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (value < 0) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function validateValueByType(
  field: string,
  value: unknown,
  dataType: string,
  spec: Record<string, unknown>,
): ValidationFieldError | null {
  switch (dataType) {
    case 'int':
    case 'long': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return {
          field,
          message: `Expected integer, got ${typeof value}`,
          expected: 'integer',
          received: value,
        };
      }
      const numMin = spec['min'] as number | undefined;
      const numMax = spec['max'] as number | undefined;
      if (numMin !== undefined && value < numMin) {
        return {
          field,
          message: `Value ${value} is below minimum ${numMin}`,
          expected: `>= ${numMin}`,
          received: value,
        };
      }
      if (numMax !== undefined && value > numMax) {
        return {
          field,
          message: `Value ${value} exceeds maximum ${numMax}`,
          expected: `<= ${numMax}`,
          received: value,
        };
      }
      return null;
    }

    case 'float':
    case 'double': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          field,
          message: `Expected number, got ${typeof value}`,
          expected: 'number',
          received: value,
        };
      }
      const fMin = spec['min'] as number | undefined;
      const fMax = spec['max'] as number | undefined;
      if (fMin !== undefined && value < fMin) {
        return {
          field,
          message: `Value ${value} is below minimum ${fMin}`,
          expected: `>= ${fMin}`,
          received: value,
        };
      }
      if (fMax !== undefined && value > fMax) {
        return {
          field,
          message: `Value ${value} exceeds maximum ${fMax}`,
          expected: `<= ${fMax}`,
          received: value,
        };
      }
      return null;
    }

    case 'string': {
      if (typeof value !== 'string') {
        return {
          field,
          message: `Expected string, got ${typeof value}`,
          expected: 'string',
          received: value,
        };
      }
      const maxLen = spec['maxLength'] as number | undefined;
      if (maxLen !== undefined && value.length > maxLen) {
        return {
          field,
          message: `String length ${value.length} exceeds maximum ${maxLen}`,
          expected: `maxLength <= ${maxLen}`,
          received: value.length,
        };
      }
      const pattern = spec['pattern'] as string | undefined;
      if (pattern !== undefined) {
        const re = new RegExp(pattern);
        if (!re.test(value)) {
          return {
            field,
            message: `String does not match pattern ${pattern}`,
            expected: `pattern: ${pattern}`,
            received: value,
          };
        }
      }
      return null;
    }

    case 'bool': {
      if (value !== true && value !== false && value !== 0 && value !== 1) {
        return {
          field,
          message: `Expected boolean (true/false/0/1), got ${JSON.stringify(value)}`,
          expected: 'boolean',
          received: value,
        };
      }
      return null;
    }

    case 'enum': {
      const enumList = (spec['enumList'] as Array<EnumItem>) ?? [];
      const allowedValues = enumList.map((item) => item.value);
      if (!allowedValues.includes(String(value))) {
        return {
          field,
          message: `Value '${String(value)}' is not in allowed enum values`,
          expected: allowedValues.join(', '),
          received: value,
        };
      }
      return null;
    }

    case 'timestamp': {
      if (!isValidTimestamp(value)) {
        return {
          field,
          message: `Expected a valid timestamp number, got ${JSON.stringify(value)}`,
          expected: 'timestamp (number)',
          received: value,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

export class ThingModelValidator {
  private readonly definitionValidator: InstanceType<typeof Ajv>;
  private readonly runtimeValidator: InstanceType<typeof Ajv>;

  constructor() {
    this.definitionValidator = new Ajv({
      allErrors: true,
      strict: false,
    });
    this.runtimeValidator = new Ajv({
      allErrors: true,
      strict: false,
    });

    const schemaPath = fileURLToPath(
      new URL('../../../backend-design/thing-model-schema.json', import.meta.url),
    );
    const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    this.definitionValidator.addSchema(schemaJson);
  }

  validateDefinition(model: unknown): ValidationResult {
    const validate = this.definitionValidator.getSchema(
      'https://iot-platform.local/schemas/thing-model/v1',
    );
    if (!validate) {
      return {
        valid: false,
        errors: [
          {
            field: '',
            message: 'Thing model schema not loaded into AJV',
          },
        ],
      };
    }

    const valid = validate(model);
    if (valid) {
      return { valid: true };
    }

    const errors: Array<ValidationFieldError> = (validate.errors ?? []).map(
      (err: ErrorObject) => {
        const field = err.instancePath
          ? err.instancePath.replace(/^\//, '').replace(/\//g, '.')
          : (err.params?.missingProperty as string) ?? '';
        return {
          field,
          message: err.message ?? 'Invalid value',
        };
      },
    );

    return { valid: false, errors };
  }

  validatePropertyValues(
    properties: Array<PropertyDefinition>,
    params: Record<string, unknown>,
  ): ValidationResult {
    const errors: Array<ValidationFieldError> = [];
    const propertyMap = new Map<string, PropertyDefinition>();
    for (const prop of properties) {
      propertyMap.set(prop.identifier, prop);
    }

    for (const [key, value] of Object.entries(params)) {
      const propDef = propertyMap.get(key);
      if (!propDef) {
        continue;
      }

      const fieldError = validateValueByType(
        key,
        value,
        propDef.dataType,
        propDef.spec ?? {},
      );
      if (fieldError) {
        errors.push(fieldError);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true };
  }

  validateActionInput(
    inputParamsDef: Array<ActionParamDefinition>,
    inputParams: Record<string, unknown>,
  ): ValidationResult {
    const errors: Array<ValidationFieldError> = [];
    const paramDefMap = new Map<string, ActionParamDefinition>();
    for (const paramDef of inputParamsDef) {
      paramDefMap.set(paramDef.identifier, paramDef);
    }

    for (const [key, value] of Object.entries(inputParams)) {
      const paramDef = paramDefMap.get(key);
      if (!paramDef) {
        continue;
      }

      const fieldError = validateValueByType(
        key,
        value,
        paramDef.dataType,
        paramDef.spec ?? {},
      );
      if (fieldError) {
        errors.push(fieldError);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true };
  }
}

export const thingModelValidator = new ThingModelValidator();
