import type { Env } from '../types';
import { asciiJson, hmacSha256Hex, sleep } from '../utils/crypto';
import { ApiError } from '../utils/http';
import { logEvent } from '../utils/log';
import { isLocalHostname } from '../utils/request';

/**
 * Client gọi Google Apps Script Web App (server-to-server).
 *
 * Mỗi request được ký HMAC-SHA256 bằng GAS_SHARED_SECRET:
 *   base = "v1\n" + action + "\n" + scope + "\n" + ts + "\n" + requestId + "\n" + payload
 * Apps Script không đọc được HTTP header nên chữ ký nằm trong body.
 * Apps Script từ chối request sai chữ ký, lệch thời gian > 5 phút hoặc lặp requestId.
 */

export type GasScope = 'public' | 'admin' | 'system';

interface CallOptions {
  scope: GasScope;
  timeoutMs?: number;
  /** Số lần thử lại khi lỗi mạng / upstream (chỉ dùng cho thao tác đọc). */
  retries?: number;
}

interface GasEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 422,
  EMPLOYEE_NOT_FOUND: 422,
  CATEGORY_NOT_FOUND: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_CONFIRMED: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  LOCK_TIMEOUT: 503,
  NOT_CONFIGURED: 503,
  DRIVE_ERROR: 502,
  SHEET_ERROR: 502,
  PDF_ERROR: 502,
  INTERNAL: 500,
};

/** Lỗi giao thức (sai chữ ký, sai phiên bản…) — là lỗi cấu hình máy chủ, không phải lỗi người dùng. */
const PROTOCOL_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST']);
const RETRYABLE_CODES = new Set(['UPSTREAM_ERROR', 'UPSTREAM_TIMEOUT', 'LOCK_TIMEOUT']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isAllowedHost(url: URL, allowGoogleUserContent: boolean): boolean {
  if (isLocalHostname(url.hostname)) return url.protocol === 'http:' || url.protocol === 'https:';
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'script.google.com') return true;
  return allowGoogleUserContent && (url.hostname.endsWith('.googleusercontent.com') || url.hostname.endsWith('.google.com'));
}

function resolveGasConfig(env: Env): { url: URL; secret: string } {
  const rawUrl = env.GAS_WEB_APP_URL?.trim();
  const secret = env.GAS_SHARED_SECRET?.trim();
  if (!rawUrl || !secret) {
    throw new ApiError(503, 'NOT_CONFIGURED', 'Hệ thống chưa được cấu hình kết nối Google Apps Script.');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError(503, 'NOT_CONFIGURED', 'GAS_WEB_APP_URL không hợp lệ.');
  }
  if (!isAllowedHost(url, false)) {
    throw new ApiError(503, 'NOT_CONFIGURED', 'GAS_WEB_APP_URL phải là URL https://script.google.com/macros/s/.../exec');
  }
  return { url, secret };
}

export async function callGas<T>(env: Env, action: string, payload: unknown, options: CallOptions): Promise<T> {
  const config = resolveGasConfig(env);
  const attempts = 1 + Math.max(0, options.retries ?? 0);
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce<T>(config.url, config.secret, action, payload, options);
    } catch (err) {
      const retryable = err instanceof ApiError && RETRYABLE_CODES.has(err.code);
      if (!retryable || attempt >= attempts) throw err;
      await sleep(400 * attempt);
    }
  }
}

async function fetchFollowingRedirects(url: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let current = url;
  let response = await fetch(current.toString(), { ...init, redirect: 'manual', signal });
  for (let hop = 0; hop < 4 && REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get('Location');
    if (!location) break;
    const next = new URL(location, current);
    if (!isAllowedHost(next, true)) {
      throw new ApiError(502, 'UPSTREAM_ERROR', 'Apps Script chuyển hướng tới địa chỉ không hợp lệ.');
    }
    // Apps Script trả 302 → GET script.googleusercontent.com chứa kết quả (chuẩn Fetch: POST→GET).
    const keepMethod = response.status === 307 || response.status === 308;
    current = next;
    response = await fetch(current.toString(), {
      method: keepMethod ? init.method : 'GET',
      headers: keepMethod ? init.headers : undefined,
      body: keepMethod ? init.body : undefined,
      redirect: 'manual',
      signal,
    });
  }
  return response;
}

async function callOnce<T>(url: URL, secret: string, action: string, payload: unknown, options: CallOptions): Promise<T> {
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const payloadText = asciiJson(payload ?? {});
  const sig = await hmacSha256Hex(secret, ['v1', action, options.scope, ts, requestId, payloadText].join('\n'));
  const body = JSON.stringify({ v: 1, action, scope: options.scope, ts, requestId, payload: payloadText, sig });
  const timeoutMs = options.timeoutMs ?? 30_000;
  const started = Date.now();

  let response: Response;
  try {
    response = await fetchFollowingRedirects(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      AbortSignal.timeout(timeoutMs),
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logEvent('error', null, 'gas.fetch_failed', {
      action,
      timedOut,
      elapsedMs: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    });
    throw timedOut
      ? new ApiError(504, 'UPSTREAM_TIMEOUT', 'Máy chủ dữ liệu phản hồi quá lâu. Vui lòng thử lại.')
      : new ApiError(502, 'UPSTREAM_ERROR', 'Không kết nối được máy chủ dữ liệu. Vui lòng thử lại sau.');
  }

  const text = await response.text();
  if (!response.ok) {
    logEvent('error', null, 'gas.http_error', { action, status: response.status, snippet: text.slice(0, 200) });
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Máy chủ dữ liệu trả về lỗi. Vui lòng thử lại sau.');
  }

  let envelope: GasEnvelope<T>;
  try {
    envelope = JSON.parse(text) as GasEnvelope<T>;
  } catch {
    // Thường gặp khi Web App chưa deploy đúng quyền (trả về trang HTML đăng nhập Google).
    logEvent('error', null, 'gas.invalid_response', {
      action,
      contentType: response.headers.get('Content-Type'),
      snippet: text.replace(/\s+/g, ' ').slice(0, 200),
    });
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Máy chủ dữ liệu phản hồi không hợp lệ. Vui lòng báo quản trị viên.');
  }

  if (envelope && envelope.ok === true) {
    return envelope.data as T;
  }

  const code = envelope?.error?.code ?? 'UPSTREAM_ERROR';
  const message = envelope?.error?.message ?? 'Máy chủ dữ liệu báo lỗi.';
  if (PROTOCOL_CODES.has(code)) {
    logEvent('error', null, 'gas.protocol_error', { action, code, message });
    throw new ApiError(502, 'UPSTREAM_AUTH_FAILED', 'Cấu hình kết nối máy chủ dữ liệu không hợp lệ. Vui lòng báo quản trị viên.');
  }
  const status = STATUS_BY_CODE[code] ?? 500;
  if (status >= 500) {
    logEvent('error', null, 'gas.app_error', { action, code, message, elapsedMs: Date.now() - started });
  }
  throw new ApiError(status, code, message, { details: envelope?.error?.details });
}
