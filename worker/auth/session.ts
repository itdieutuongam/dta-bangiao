import type { Env, RequestContext } from '../types';
import { base64UrlDecode, base64UrlEncode, hmacSha256, sha256Hex, timingSafeEqual, utf8, type Bytes } from '../utils/crypto';
import { ApiError } from '../utils/http';
import { isLocalHostname } from '../utils/request';

/**
 * Phiên đăng nhập dạng cookie ký HMAC (stateless):
 *   value = base64url(JSON claims) + "." + base64url(HMAC-SHA256(key, base64url(JSON claims)))
 * Khóa ký dẫn xuất từ SESSION_SECRET + hash mật khẩu hiện tại → đổi mật khẩu là mọi phiên cũ hết hiệu lực.
 * Cookie: HttpOnly; Secure; SameSite=Lax; Path=/ — không lưu token trong localStorage.
 */

export type SessionKind = 'admin' | 'staff';

export interface SessionClaims {
  k: SessionKind;
  iat: number;
  exp: number;
}

const TTL_SECONDS: Record<SessionKind, number> = {
  admin: 8 * 60 * 60,
  staff: 30 * 24 * 60 * 60,
};

const BASE_COOKIE_NAME: Record<SessionKind, string> = {
  admin: 'dta_admin',
  staff: 'dta_staff',
};

/** HTTPS (mọi domain thật) → Secure + tiền tố __Host-. Chỉ http://localhost khi dev mới bỏ Secure. */
function isSecureContext(url: URL): boolean {
  return url.protocol === 'https:' || !isLocalHostname(url.hostname);
}

function cookieName(kind: SessionKind, url: URL): string {
  return isSecureContext(url) ? `__Host-${BASE_COOKIE_NAME[kind]}` : BASE_COOKIE_NAME[kind];
}

function serializeCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

async function signingKey(env: Env, kind: SessionKind): Promise<Bytes> {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) throw new ApiError(503, 'NOT_CONFIGURED', 'Hệ thống chưa cấu hình SESSION_SECRET.');
  const credential = kind === 'admin' ? (env.ADMIN_PASSWORD ?? '') : (env.STAFF_ACCESS_CODE ?? '');
  return hmacSha256(secret, `dta-handover/session/${kind}/v1/${await sha256Hex(credential)}`);
}

export async function createSessionCookie(
  c: RequestContext,
  kind: SessionKind,
): Promise<{ cookie: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { k: kind, iat: now, exp: now + TTL_SECONDS[kind] };
  const body = base64UrlEncode(utf8(JSON.stringify(claims)));
  const sig = base64UrlEncode(await hmacSha256(await signingKey(c.env, kind), body));
  return {
    cookie: serializeCookie(cookieName(kind, c.url), `${body}.${sig}`, TTL_SECONDS[kind], isSecureContext(c.url)),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function clearSessionCookie(c: RequestContext, kind: SessionKind): string {
  return serializeCookie(cookieName(kind, c.url), '', 0, isSecureContext(c.url));
}

export async function readSession(c: RequestContext, kind: SessionKind): Promise<SessionClaims | null> {
  if (!c.env.SESSION_SECRET?.trim()) return null;
  const raw = readCookie(c.request, cookieName(kind, c.url));
  if (!raw) return null;
  const [body, sig, extra] = raw.split('.');
  if (!body || !sig || extra !== undefined || body.length > 512) return null;
  const expected = base64UrlEncode(await hmacSha256(await signingKey(c.env, kind), body));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.k !== kind || typeof claims.exp !== 'number' || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
