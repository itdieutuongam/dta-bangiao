import type { ApiErrorBody } from '../../shared/types';
import type { Bytes } from './crypto';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function withDefaults(headers?: HeadersInit): Headers {
  const h = new Headers(headers);
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!h.has(key)) h.set(key, value);
  }
  return h;
}

export function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const h = withDefaults(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function ok<T>(data: T, status = 200, headers?: HeadersInit): Response {
  return json({ success: true, data, error: null }, status, headers);
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: HeadersInit,
): Response {
  const error: ApiErrorBody = { code, message };
  if (details !== undefined) error.details = details;
  return json({ success: false, data: null, error }, status, headers);
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'file';
}

/**
 * Trả file (PNG chữ ký / PDF / CSV). CSP "sandbox" + nosniff: kể cả khi nội dung bị tráo, trình duyệt không chạy
 * script trên origin của ứng dụng. body: byte (có Content-Length) hoặc stream chuyển thẳng (xuất CSV lớn).
 */
export function fileResponse(
  body: Bytes | ReadableStream<Uint8Array>,
  contentType: string,
  fileName: string,
  disposition: 'inline' | 'attachment',
  extraHeaders: Record<string, string> = {},
): Response {
  const name = safeFileName(fileName);
  const h = withDefaults({
    ...extraHeaders,
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox",
  });
  if (body instanceof Uint8Array) h.set('Content-Length', String(body.byteLength));
  return new Response(body, { status: 200, headers: h });
}
