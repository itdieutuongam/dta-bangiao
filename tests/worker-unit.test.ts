import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_PATTERN } from '../shared/constants';
import { createSessionCookie, readSession } from '../worker/auth/session';
import { Router } from '../worker/router';
import { decodeSignatureDataUrl } from '../worker/services/signature';
import { buildConfirmLink, hashToken, issueLinkToken, recoverConfirmLink } from '../worker/services/token';
import type { Env, RequestContext } from '../worker/types';
import { asciiJson, base64UrlDecode, base64UrlEncode, secretEquals } from '../worker/utils/crypto';
import { ApiError } from '../worker/utils/http';
import { maskPath } from '../worker/utils/log';
import { makePng } from './helpers';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    SESSION_SECRET: 'session-secret-'.padEnd(48, 'x'),
    ADMIN_PASSWORD: 'Admin@12345',
    APP_BASE_URL: '',
    ...overrides,
  } as Env;
}

function ctx(url: string, e: Env, cookie?: string): RequestContext {
  const request = new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
  return {
    request,
    env: e,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
    url: new URL(url),
    params: {},
    clientIp: '1.2.3.4',
    requestId: 'test',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('crypto helpers', () => {
  it('base64url khứ hồi, JSON ASCII giữ nguyên nội dung tiếng Việt', () => {
    const bytes = crypto.randomBytes(48);
    expect(Buffer.from(base64UrlDecode(base64UrlEncode(bytes)))).toEqual(bytes);
    const text = asciiJson({ name: 'Phạm Danh Thái 😀' });
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
    expect(JSON.parse(text).name).toBe('Phạm Danh Thái 😀');
  });

  it('secretEquals đúng/sai', async () => {
    expect(await secretEquals('Admin@12345', 'Admin@12345')).toBe(true);
    expect(await secretEquals('admin@12345', 'Admin@12345')).toBe(false);
    expect(await secretEquals('', 'Admin@12345')).toBe(false);
  });
});

describe('link token', () => {
  it('token 43 ký tự ngẫu nhiên, chỉ lưu hash; khôi phục được link từ nonce', async () => {
    const e = env();
    const a = await issueLinkToken(e);
    const b = await issueLinkToken(e);
    expect(a.token).toMatch(TOKEN_PATTERN);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(crypto.createHash('sha256').update(a.token).digest('hex'));
    expect(await hashToken(a.token)).toBe(a.hash);
    const url = new URL('https://ban-giao.example.com/api/handover');
    expect(await recoverConfirmLink(e, url, a.nonce, a.hash)).toBe(`https://ban-giao.example.com/xac-nhan/${a.token}`);
    // Đổi SESSION_SECRET → không dựng lại được link (hash không khớp) nhưng không lỗi.
    expect(await recoverConfirmLink(env({ SESSION_SECRET: 'other-secret-'.padEnd(48, 'y') }), url, a.nonce, a.hash)).toBeNull();
  });

  it('APP_BASE_URL ghi đè domain của request', () => {
    const url = new URL('https://dta-handover.example.workers.dev/api/handover');
    expect(buildConfirmLink(env({ APP_BASE_URL: 'https://ban-giao.dieutuongam.com/' }), url, 'abc')).toBe(
      'https://ban-giao.dieutuongam.com/xac-nhan/abc',
    );
    expect(buildConfirmLink(env(), url, 'abc')).toBe('https://dta-handover.example.workers.dev/xac-nhan/abc');
  });

  it('thiếu SESSION_SECRET → 503 NOT_CONFIGURED', async () => {
    await expect(issueLinkToken(env({ SESSION_SECRET: '' }))).rejects.toMatchObject({ status: 503, code: 'NOT_CONFIGURED' });
  });
});

describe('session cookie', () => {
  it('HttpOnly; Secure; SameSite=Lax; Path=/ trên HTTPS và xác minh được', async () => {
    const e = env();
    const created = await createSessionCookie(ctx('https://ban-giao.example.com/api/admin/login', e), 'admin');
    expect(created.cookie).toMatch(/^__Host-dta_admin=/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(created.cookie).toContain(attr);
    const value = created.cookie.split(';')[0]!;
    expect(await readSession(ctx('https://ban-giao.example.com/api/admin/me', e, value), 'admin')).toMatchObject({ k: 'admin' });
    // Không dùng được cookie admin làm cookie staff và ngược lại
    expect(await readSession(ctx('https://ban-giao.example.com/', e, value.replace('dta_admin', 'dta_staff')), 'staff')).toBeNull();
  });

  it('cookie bị sửa, hết hạn, hoặc đã đổi mật khẩu → không hợp lệ', async () => {
    const e = env();
    const created = await createSessionCookie(ctx('https://x.example/api', e), 'admin');
    const value = created.cookie.split(';')[0]!;
    const [name, raw] = value.split('=') as [string, string];
    const [body, sig] = raw.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ k: 'admin', iat: 0, exp: 4102444800 })).toString('base64url');
    expect(await readSession(ctx('https://x.example/', e, `${name}=${forged}.${sig}`), 'admin')).toBeNull();
    expect(await readSession(ctx('https://x.example/', env({ ADMIN_PASSWORD: 'Mat-khau-moi-1' }), value), 'admin')).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect(await readSession(ctx('https://x.example/', e, `${name}=${body}.${sig}`), 'admin')).toBeNull();
  });

  it('http://localhost (dev) không gắn Secure / __Host-', async () => {
    const created = await createSessionCookie(ctx('http://localhost:5173/api/admin/login', env()), 'admin');
    expect(created.cookie).toMatch(/^dta_admin=/);
    expect(created.cookie).not.toContain('Secure');
  });
});

describe('ảnh chữ ký', () => {
  const dataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;
  it('chấp nhận PNG hợp lệ, từ chối file không phải PNG / kích thước bất thường', () => {
    expect(decodeSignatureDataUrl(dataUrl(makePng(600, 300)))).toMatchObject({ width: 600, height: 300 });
    expect(() => decodeSignatureDataUrl(dataUrl(Buffer.from('GIF89a-not-a-png-file-at-all-xxxxxxxxxxxxx')))).toThrow(ApiError);
    expect(() => decodeSignatureDataUrl(dataUrl(makePng(2000, 300)))).toThrow(/Kích thước/);
    expect(() => decodeSignatureDataUrl(dataUrl(makePng(5, 5)))).toThrow(/Kích thước/);
  });
});

describe('router', () => {
  it('khớp tham số, báo 405 / 404', () => {
    const noop = async () => new Response();
    const router = new Router().post('/api/handover/:token/confirm', noop).get('/api/handover/:token', noop);
    expect(router.match('POST', '/api/handover/abc/confirm')).toMatchObject({ kind: 'match', params: { token: 'abc' } });
    expect(router.match('HEAD', '/api/handover/abc')).toMatchObject({ kind: 'match' });
    expect(router.match('GET', '/api/handover/abc/confirm')).toMatchObject({ kind: 'method_not_allowed', allowed: ['POST'] });
    expect(router.match('GET', '/api/khong-co')).toEqual({ kind: 'not_found' });
  });
});

describe('log', () => {
  it('che token trong đường dẫn', () => {
    const token = 'A'.repeat(43);
    expect(maskPath(`/api/handover/${token}/confirm`)).toBe('/api/handover/AAAAAA…/confirm');
    expect(maskPath(`/xac-nhan/${token}`)).toBe('/xac-nhan/AAAAAA…');
  });
});
