import type { AdminUser } from '../../shared/types';
import type { Env, RequestContext } from '../types';
import { base64UrlDecode, base64UrlEncode, hmacSha256, sha256Hex, timingSafeEqual, utf8, type Bytes } from '../utils/crypto';
import { ApiError } from '../utils/http';
import { isLocalHostname } from '../utils/request';
import { findAdminAccount, readAdminConfig } from './adminUsers';

/**
 * Phiên đăng nhập dạng cookie ký HMAC (stateless):
 *   value = base64url(JSON claims) + "." + base64url(HMAC-SHA256(key, base64url(JSON claims)))
 * Khóa ký dẫn xuất từ SESSION_SECRET + hash mật khẩu hiện tại của đúng tài khoản → đổi mật khẩu là mọi phiên cũ
 * của tài khoản đó hết hiệu lực. Cookie: HttpOnly; Secure; SameSite=Lax; Path=/ — không lưu token trong localStorage.
 */

export type SessionKind = 'admin' | 'staff';

export interface SessionClaims {
  k: SessionKind;
  iat: number;
  exp: number;
  /** Tên đăng nhập quản trị (ADMIN_USERS). Phiên mật khẩu chung (bản cũ) không có. */
  u?: string;
  /** Tên hiển thị quản trị viên. */
  n?: string;
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

function requireSessionSecret(env: Env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) throw new ApiError(503, 'NOT_CONFIGURED', 'Hệ thống chưa cấu hình SESSION_SECRET.');
  return secret;
}

/**
 * Khóa ký phiên. Admin dùng chung mật khẩu: giữ nguyên công thức v1 (phiên đang có không bị đăng xuất khi nâng cấp).
 * Admin theo tài khoản: gắn với username + hash mật khẩu của chính tài khoản đó. Trả null nếu tài khoản không còn.
 */
async function signingKey(env: Env, kind: SessionKind, username?: string): Promise<Bytes | null> {
  const secret = requireSessionSecret(env);
  if (kind === 'staff') {
    return hmacSha256(secret, `dta-handover/session/staff/v1/${await sha256Hex(env.STAFF_ACCESS_CODE ?? '')}`);
  }
  const config = readAdminConfig(env);
  if (config.error) return null;
  if (config.mode === 'shared') {
    return hmacSha256(secret, `dta-handover/session/admin/v1/${await sha256Hex(env.ADMIN_PASSWORD ?? '')}`);
  }
  const account = findAdminAccount(config, username);
  if (!account) return null;
  return hmacSha256(secret, `dta-handover/session/admin/v2/${account.username}/${await sha256Hex(account.password)}`);
}

export async function createSessionCookie(
  c: RequestContext,
  kind: SessionKind,
  user?: AdminUser,
): Promise<{ cookie: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { k: kind, iat: now, exp: now + TTL_SECONDS[kind] };
  if (kind === 'admin' && user && readAdminConfig(c.env).mode === 'users') {
    claims.u = user.username;
    claims.n = user.name;
  }
  const key = await signingKey(c.env, kind, claims.u);
  if (!key) throw new ApiError(503, 'NOT_CONFIGURED', 'Cấu hình tài khoản quản trị không hợp lệ.');
  const body = base64UrlEncode(utf8(JSON.stringify(claims)));
  const sig = base64UrlEncode(await hmacSha256(key, body));
  return {
    cookie: serializeCookie(cookieName(kind, c.url), `${body}.${sig}`, TTL_SECONDS[kind], isSecureContext(c.url)),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function clearSessionCookie(c: RequestContext, kind: SessionKind): string {
  return serializeCookie(cookieName(kind, c.url), '', 0, isSecureContext(c.url));
}

function decodeClaims(body: string): SessionClaims | null {
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionClaims;
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

export async function readSession(c: RequestContext, kind: SessionKind): Promise<SessionClaims | null> {
  if (!c.env.SESSION_SECRET?.trim()) return null;
  const raw = readCookie(c.request, cookieName(kind, c.url));
  if (!raw) return null;
  const [body, sig, extra] = raw.split('.');
  if (!body || !sig || extra !== undefined || body.length > 512) return null;
  // Đọc username (chưa tin) chỉ để chọn khóa; chữ ký phải khớp khóa của đúng tài khoản thì mới chấp nhận.
  const unverified = decodeClaims(body);
  if (!unverified) return null;
  const key = await signingKey(c.env, kind, typeof unverified.u === 'string' ? unverified.u : undefined);
  if (!key) return null;
  const expected = base64UrlEncode(await hmacSha256(key, body));
  if (!timingSafeEqual(expected, sig)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (unverified.k !== kind || typeof unverified.exp !== 'number' || unverified.exp <= now) return null;
  return unverified;
}

/** Người quản trị của phiên (tên hiển thị lấy theo cấu hình hiện tại). */
export function adminUserOf(env: Env, claims: SessionClaims): AdminUser {
  const config = readAdminConfig(env);
  if (config.mode === 'shared' || !claims.u) return { username: 'admin', name: 'Quản trị viên' };
  const account = findAdminAccount(config, claims.u);
  return { username: claims.u, name: account?.name ?? claims.n ?? claims.u };
}
