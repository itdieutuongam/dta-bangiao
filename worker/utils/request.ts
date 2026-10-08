import type { z } from 'zod';
import { toFieldErrors } from '../../shared/schemas';
import type { RequestContext } from '../types';
import { ApiError } from './http';

function tooLarge(): ApiError {
  return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
}

/**
 * Đọc body JSON với giới hạn dung lượng; chỉ chấp nhận Content-Type application/json.
 * Đọc theo luồng và dừng ngay khi vượt giới hạn (kể cả khi client không gửi Content-Length).
 */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Content-Type phải là application/json.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Dữ liệu JSON không hợp lệ.');
  }
}

/** Validate bằng Zod; lỗi → 422 kèm fieldErrors để frontend hiển thị đúng ô nhập. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors = toFieldErrors(result.error);
    const first = Object.values(fieldErrors)[0] ?? 'Dữ liệu không hợp lệ.';
    throw new ApiError(422, 'VALIDATION_ERROR', first, { details: { fieldErrors } });
  }
  return result.data;
}

export function getClientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return '0.0.0.0';
}

/**
 * Chống CSRF (bổ sung cho cookie SameSite=Lax): request thay đổi dữ liệu phải
 * đến từ cùng origin. Trình duyệt luôn gửi Origin cho POST/PUT cross-site.
 */
export function assertSameOrigin(c: RequestContext): void {
  const origin = c.request.headers.get('Origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = '';
    }
    const allowed = new Set([c.url.host]);
    const base = c.env.APP_BASE_URL?.trim();
    if (base) {
      try {
        allowed.add(new URL(base).host);
      } catch {
        // APP_BASE_URL sai định dạng — bỏ qua
      }
    }
    if (!allowed.has(originHost)) {
      throw new ApiError(403, 'FORBIDDEN', 'Yêu cầu không hợp lệ (khác nguồn gốc).');
    }
    return;
  }
  if (c.request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', 'Yêu cầu không hợp lệ (khác nguồn gốc).');
  }
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}
