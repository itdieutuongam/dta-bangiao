import type { Env } from '../types';
import { base64UrlEncode, hmacSha256, hmacSha256Hex, randomBytes, sha256Hex, type Bytes } from '../utils/crypto';
import { ApiError } from '../utils/http';

/**
 * Token trong link xác nhận.
 *
 *   nonce = 32 byte ngẫu nhiên (base64url)
 *   token = base64url(HMAC-SHA256(linkKey, "link:" + nonce))   — 43 ký tự, 256 bit
 *   hash  = SHA-256(token)                                     — lưu trong Sheet để tra cứu
 *
 * Sheet chỉ lưu hash + nonce. Không có linkKey (chỉ Worker biết, dẫn xuất từ SESSION_SECRET)
 * thì không thể dựng lại token từ dữ liệu Sheet; nhờ vậy admin vẫn "Sao chép link" được.
 */

async function linkKey(env: Env): Promise<Bytes> {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new ApiError(503, 'NOT_CONFIGURED', 'Hệ thống chưa cấu hình SESSION_SECRET.');
  }
  return hmacSha256(secret, 'dta-handover/link-token/v1');
}

export async function tokenFromNonce(env: Env, nonce: string): Promise<string> {
  return base64UrlEncode(await hmacSha256(await linkKey(env), `link:${nonce}`));
}

export async function issueLinkToken(env: Env): Promise<{ token: string; nonce: string; hash: string }> {
  const nonce = base64UrlEncode(randomBytes(32));
  const token = await tokenFromNonce(env, nonce);
  return { token, nonce, hash: await sha256Hex(token) };
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function appBaseUrl(env: Env, requestUrl: URL): string {
  const configured = env.APP_BASE_URL?.trim();
  return (configured || requestUrl.origin).replace(/\/+$/, '');
}

export function buildConfirmLink(env: Env, requestUrl: URL, token: string): string {
  return `${appBaseUrl(env, requestUrl)}/xac-nhan/${token}`;
}

/** Dựng lại link từ nonce; trả null nếu khóa đã đổi (hash không khớp). */
export async function recoverConfirmLink(
  env: Env,
  requestUrl: URL,
  nonce: string,
  expectedHash: string,
): Promise<string | null> {
  if (!nonce || !expectedHash || !env.SESSION_SECRET) return null;
  const token = await tokenFromNonce(env, nonce);
  if ((await sha256Hex(token)) !== expectedHash.toLowerCase()) return null;
  return buildConfirmLink(env, requestUrl, token);
}

/** Hash IP có khóa (không đảo ngược được bằng bảng tra) — chỉ dùng cho nhật ký & chống spam. */
export async function hashClientIp(env: Env, ip: string): Promise<string> {
  const key = env.SESSION_SECRET?.trim() || env.GAS_SHARED_SECRET?.trim() || 'dta-handover';
  return (await hmacSha256Hex(key, `ip:${ip}`)).slice(0, 32);
}
