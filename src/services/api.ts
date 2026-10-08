import type { ApiEnvelope } from '../../shared/types';

/** Lỗi API đã chuẩn hóa để hiển thị thân thiện (không lộ stack trace). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** fieldErrors do Worker / Apps Script trả về khi validate thất bại. */
  get fieldErrors(): Record<string, string> {
    const details = this.details as { fieldErrors?: Record<string, string> } | undefined;
    return details?.fieldErrors ?? {};
  }
}

export function isApiError(error: unknown, code?: string): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}

export function errorMessage(error: unknown, fallback = 'Đã có lỗi xảy ra. Vui lòng thử lại.'): string {
  if (error instanceof ApiClientError) return error.message || fallback;
  return fallback;
}

const STALE_STATE_CODES = new Set(['INVALID_STATE', 'INVALID_STATUS_TRANSITION', 'CONFLICT', 'ALREADY_CONFIRMED']);

/** Dữ liệu vừa bị thay đổi ở nơi khác (người khác vừa thao tác) → nên tải lại để thấy trạng thái hiện tại. */
export function isStaleStateError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && STALE_STATE_CODES.has(error.code);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.');
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!envelope || typeof envelope !== 'object') {
    throw new ApiClientError(response.status, 'BAD_RESPONSE', 'Máy chủ phản hồi không hợp lệ. Vui lòng thử lại sau.');
  }
  if (!response.ok || !envelope.success) {
    const error = envelope.success ? null : envelope.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      error?.details,
    );
  }
  return envelope.data;
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // bỏ qua, dùng filename thường
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

/**
 * Tải file (PDF / CSV) qua API có kiểm tra quyền; báo lỗi thân thiện nếu thất bại.
 * Trả về header của phản hồi (ví dụ X-Export-Truncated khi xuất CSV bị cắt bớt).
 */
export async function downloadFile(path: string, fallbackName: string): Promise<Headers> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ. Vui lòng thử lại.');
  }
  if (!response.ok) {
    let message = 'Không tải được tệp. Vui lòng thử lại.';
    let code = 'DOWNLOAD_FAILED';
    try {
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!body.success) {
        message = body.error.message || message;
        code = body.error.code || code;
      }
    } catch {
      // body không phải JSON
    }
    throw new ApiClientError(response.status, code, message);
  }
  const blob = await response.blob();
  const name = fileNameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  return response.headers;
}
