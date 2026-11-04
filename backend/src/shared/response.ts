import type { IotError, ErrorDetail } from './errors.js';

export interface ApiSuccessResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface ApiPaginatedData<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface ApiPaginatedResponse<T> {
  code: number;
  message: string;
  data: ApiPaginatedData<T>;
}

export interface ApiErrorResponse {
  code: number;
  message: string;
  details: ErrorDetail[];
}

export function success<T>(
  data: T,
  statusCode: number = 200,
): { statusCode: number; body: ApiSuccessResponse<T> } {
  return {
    statusCode,
    body: {
      code: 0,
      message: 'success',
      data,
    },
  };
}

export function successCreated<T>(
  data: T,
): { statusCode: number; body: ApiSuccessResponse<T> } {
  return {
    statusCode: 201,
    body: {
      code: 0,
      message: 'success',
      data,
    },
  };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): { statusCode: number; body: ApiPaginatedResponse<T> } {
  return {
    statusCode: 200,
    body: {
      code: 0,
      message: 'success',
      data: {
        total,
        page,
        page_size: pageSize,
        items,
      },
    },
  };
}

export function error(
  err: IotError,
): { statusCode: number; body: ApiErrorResponse } {
  return {
    statusCode: err.statusCode,
    body: err.toResponse(),
  };
}
