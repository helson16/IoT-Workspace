export interface ErrorDetail {
  field: string;
  message: string;
}

export class IotError extends Error {
  public readonly code: number;
  public readonly statusCode: number;
  public readonly details: ErrorDetail[];

  constructor(
    message: string,
    code: number,
    statusCode: number,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details ?? [];
  }

  public toResponse(): { code: number; message: string; details: ErrorDetail[] } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ValidationError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40001, 400, details);
  }
}

export class UnauthorizedError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40101, 401, details);
  }
}

export class TokenExpiredError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40102, 401, details);
  }
}

export class DeviceAuthError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40103, 401, details);
  }
}

export class ForbiddenError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40301, 403, details);
  }
}

export class ProductNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40401, 404, details);
  }
}

export class DeviceNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40402, 404, details);
  }
}

export class DeviceNameConflictError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40901, 409, details);
  }
}

export class GroupNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40403, 404, details);
  }
}

export class GroupNameConflictError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40903, 409, details);
  }
}

export class RuleNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40404, 404, details);
  }
}

export class RuleNameConflictError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40904, 409, details);
  }
}

export class ChartNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40404, 404, details);
  }
}

export class ApiNotFoundError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40405, 404, details);
  }
}

export class ThingModelInvalidError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 42201, 422, details);
  }
}

export class PropertyValueInvalidError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 42202, 422, details);
  }
}

export class ShadowVersionConflictError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 40902, 409, details);
  }
}

export class InternalError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 50001, 500, details);
  }
}

export class MqttBrokerError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 50002, 500, details);
  }
}

/**
 * 上游语义服务 (TypeSafe) 不可用 —— 网络失败、超时、429/5xx, 以及"在边缘就被拒"。
 * 单列一类的原因: 它**不是**用户输入有问题, 前端不能按"指令非法"提示。
 * 更要紧的是 SDK 错误的 message 里装着上游**响应体**(实测含我们的出口 IP),
 * 而 app.ts 的兜底处理会把 error.message 原样回显 —— 所以对外只给固定文案。
 */
export class UpstreamServiceError extends IotError {
  constructor(message: string, details?: ErrorDetail[]) {
    super(message, 50003, 502, details);
  }
}
