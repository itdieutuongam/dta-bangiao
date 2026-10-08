import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_PATTERN } from '../shared/constants';
import { exactNameKey, isHttpUrl } from '../shared/text';
import { signedMovementQuantity, stockStatusOf } from '../shared/vpp';
import { gasFileResponse } from '../worker/api/common';
import { BACKGROUND_PDF_TIMEOUT_MS } from '../worker/api/handover';
import { readAdminConfig } from '../worker/auth/adminUsers';
import { createSessionCookie, readSession } from '../worker/auth/session';
import { Router } from '../worker/router';
import { callGasStream, retryAfterSeconds } from '../worker/services/gas';
import { rateLimitIpKey } from '../worker/services/rateLimit';
import { decodeSignatureDataUrl } from '../worker/services/signature';
import { buildConfirmLink, hashToken, issueLinkToken, recoverConfirmLink } from '../worker/services/token';
import type { Env, RequestContext } from '../worker/types';
import { asciiJson, base64UrlDecode, base64UrlEncode, hmacSha256, secretEquals, sha256Hex } from '../worker/utils/crypto';
import { vnFileStamp } from '../worker/utils/csv';
import { ApiError } from '../worker/utils/http';
import { maskPath } from '../worker/utils/log';
import { readJson } from '../worker/utils/request';
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
    expect(Buffer.byteLength(text, 'utf8')).toBe(text.length); // chỉ ký tự ASCII (1 byte / ký tự)
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

  it('phiên mật khẩu chung tạo bởi bản 1.0 (không có username) vẫn hợp lệ sau khi nâng cấp', async () => {
    const e = env();
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ k: 'admin', iat: now, exp: now + 3600 })).toString('base64url');
    const key = await hmacSha256(e.SESSION_SECRET!, `dta-handover/session/admin/v1/${await sha256Hex(e.ADMIN_PASSWORD!)}`);
    const cookie = `__Host-dta_admin=${body}.${base64UrlEncode(await hmacSha256(key, body))}`;
    expect(await readSession(ctx('https://x.example/', e, cookie), 'admin')).toMatchObject({ k: 'admin' });
  });

  it('ADMIN_USERS: phiên gắn với tài khoản; đổi mật khẩu một người không ảnh hưởng người khác; username giả không qua được', async () => {
    const users = [
      { username: 'thai', name: 'Phạm Danh Thái', password: 'Thai-Pass-2026!' },
      { username: 'admin', name: 'Trưởng phòng HC', password: 'Admin-Pass-2026!' },
    ];
    const e = env({ ADMIN_USERS: JSON.stringify(users) });
    const thai = (await createSessionCookie(ctx('https://x.example/', e), 'admin', users[0])).cookie.split(';')[0]!;
    const admin = (await createSessionCookie(ctx('https://x.example/', e), 'admin', users[1])).cookie.split(';')[0]!;
    expect(await readSession(ctx('https://x.example/', e, thai), 'admin')).toMatchObject({ u: 'thai', n: 'Phạm Danh Thái' });
    expect(await readSession(ctx('https://x.example/', e, admin), 'admin')).toMatchObject({ u: 'admin' });
    // Đổi username trong claims (không có chữ ký đúng) → từ chối
    const [name, raw] = thai.split('=') as [string, string];
    const [, sig] = raw.split('.') as [string, string];
    const now = Math.floor(Date.now() / 1000);
    const forged = Buffer.from(JSON.stringify({ k: 'admin', u: 'admin', iat: now, exp: now + 3600 })).toString('base64url');
    expect(await readSession(ctx('https://x.example/', e, `${name}=${forged}.${sig}`), 'admin')).toBeNull();
    const changed = env({ ADMIN_USERS: JSON.stringify([{ ...users[0], password: 'Thai-New-2026!!' }, users[1]]) });
    expect(await readSession(ctx('https://x.example/', changed, thai), 'admin')).toBeNull();
    expect(await readSession(ctx('https://x.example/', changed, admin), 'admin')).not.toBeNull();
  });

  it('cấu hình ADMIN_USERS sai → báo lỗi rõ, không cho đăng nhập', () => {
    expect(readAdminConfig(env({ ADMIN_USERS: 'not json' })).error).toMatch(/JSON/);
    expect(readAdminConfig(env({ ADMIN_USERS: '[]' })).error).toMatch(/1–50/);
    expect(readAdminConfig(env({ ADMIN_USERS: '[{"username":"A B","name":"x","password":"123456789012"}]' })).error).toMatch(/username/);
    expect(readAdminConfig(env({ ADMIN_USERS: '[{"username":"ab","name":"x","password":"short"}]' })).error).toMatch(/≥ 12/);
    expect(readAdminConfig(env({ ADMIN_USERS: '[{"username":"ab","name":"x","password":"123456789012"},{"username":"ab","name":"y","password":"123456789012"}]' })).error).toMatch(/trùng/);
    expect(readAdminConfig(env({ ADMIN_PASSWORD: '' })).error).toMatch(/Chưa cấu hình/);
    expect(readAdminConfig(env()).mode).toBe('shared');
  });
});

describe('phản hồi file & đọc body', () => {
  it('chỉ trả đúng PNG / PDF (MIME + chữ ký nhị phân), có CSP sandbox', () => {
    const png = makePng(60, 30).toString('base64');
    const ok = gasFileResponse({ fileName: 'a.png', mimeType: 'image/png', base64: png }, 'inline', 'png');
    expect(ok.headers.get('Content-Type')).toBe('image/png');
    expect(ok.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const html = Buffer.from('<script>alert(1)</script>').toString('base64');
    expect(() => gasFileResponse({ fileName: 'x.png', mimeType: 'text/html', base64: html }, 'inline', 'png')).toThrow(ApiError);
    expect(() => gasFileResponse({ fileName: 'x.png', mimeType: 'image/png', base64: html }, 'inline', 'png')).toThrow(/định dạng/);
    expect(() => gasFileResponse({ fileName: 'x.pdf', mimeType: 'application/pdf', base64: png }, 'attachment', 'pdf')).toThrow(/định dạng/);
  });

  it('readJson dừng đọc khi vượt giới hạn, kể cả không có Content-Length', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
        if (pulled > 100) controller.close();
      },
    });
    const request = new Request('https://x.example/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    await expect(readJson(request, 4 * 1024)).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBeLessThan(10);
    const small = new Request('https://x.example/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(await readJson(small, 1024)).toEqual({ a: 1 });
  });

  it('[BUG-17] tác vụ nền sinh PDF (waitUntil) kết thúc trước giới hạn ~30 giây của Cloudflare', () => {
    expect(BACKGROUND_PDF_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BACKGROUND_PDF_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('trạng thái tồn kho', () => {
  it('hết hàng / sắp hết / còn hàng / chưa rõ', () => {
    expect(stockStatusOf(0, 3)).toBe('OUT_OF_STOCK');
    expect(stockStatusOf(-1, 0)).toBe('OUT_OF_STOCK');
    expect(stockStatusOf(2, 3)).toBe('LOW_STOCK');
    expect(stockStatusOf(3, 3)).toBe('LOW_STOCK');
    expect(stockStatusOf(4, 3)).toBe('IN_STOCK');
    expect(stockStatusOf(1, 0)).toBe('IN_STOCK');
    expect(stockStatusOf(null, 3)).toBe('UNKNOWN');
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
    expect(maskPath(`/api/handover/${token}/otp`)).toBe('/api/handover/AAAAAA…/otp');
    expect(maskPath(`/xac-nhan/${token}`)).toBe('/xac-nhan/AAAAAA…');
  });
});

describe('CSV xuất dữ liệu', () => {
  // Nội dung CSV (chống formula injection, ngày giờ, CRLF) do Apps Script dựng — kiểm thử ở tests/gas-review3.test.ts.
  it('tên file theo giờ Việt Nam', () => {
    expect(vnFileStamp(new Date('2026-10-06T17:05:00Z'))).toBe('20261007-0005');
  });

  it('số lượng biến động kho theo chiều tác động (khớp trang Lịch sử kho)', () => {
    expect(signedMovementQuantity('OUT', 3)).toBe(-3);
    expect(signedMovementQuantity('RELEASE', 2)).toBe(-2);
    expect(signedMovementQuantity('ADJUSTMENT', -4)).toBe(-4);
    expect(signedMovementQuantity('ADJUSTMENT', 5)).toBe(5);
    expect(signedMovementQuantity('IN', 7)).toBe(7);
    expect(signedMovementQuantity('RESERVE', 1)).toBe(1);
  });
});

describe('giới hạn tần suất & lỗi từ Apps Script', () => {
  it('khóa IP: IPv6 gộp theo dải /64, IPv4-mapped về IPv4', () => {
    expect(rateLimitIpKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpKey('2001:db8:12:34::1')).toBe('2001:db8:12:34::/64');
    expect(rateLimitIpKey('2001:DB8:12:34:ffff:1:2:3')).toBe('2001:db8:12:34::/64');
    expect(rateLimitIpKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitIpKey('::ffff:198.51.100.9')).toBe('198.51.100.9');
    expect(rateLimitIpKey('64:ff9b::198.51.100.9')).toBe('64:ff9b:0:0::/64');
  });

  it('Retry-After từ details.retryAfterSeconds của Apps Script (mặc định 60)', () => {
    expect(retryAfterSeconds({ retryAfterSeconds: 42 })).toBe(42);
    expect(retryAfterSeconds({ retryAfterSeconds: 779.2 })).toBe(780);
    expect(retryAfterSeconds({ retryAfterSeconds: 0 })).toBe(60);
    expect(retryAfterSeconds({ retryAfterSeconds: '5' })).toBe(60);
    expect(retryAfterSeconds(undefined)).toBe(60);
    expect(retryAfterSeconds({ retryAfterSeconds: 10 ** 9 })).toBe(86_400);
  });
});

describe('quy tắc dùng chung frontend / Worker / Apps Script', () => {
  it('link http(s): cùng quy tắc với Apps Script (không khoảng trắng, dấu nháy, < >; phải có //)', () => {
    for (const ok of ['https://example.com/a', 'http://docs.example.org/x?y=1#z', 'https://drive.google.com/file/d/abc/view']) {
      expect(isHttpUrl(ok), ok).toBe(true);
    }
    for (const bad of ['https://example.com/a b', "https://example.com/it's", 'https:example.com', 'http:/example.com/x', 'ftp://x.y', 'https://', 'https://exa"mple.com']) {
      expect(isHttpUrl(bad), bad).toBe(false);
    }
  });

  it('khóa tên giữ dấu: "Kéo" ≠ "Kẹo" ≠ "Keo"; bỏ khác biệt hoa / thường, khoảng trắng, dạng Unicode', () => {
    expect(exactNameKey('Kéo')).not.toBe(exactNameKey('Kẹo'));
    expect(exactNameKey('Kéo')).not.toBe(exactNameKey('Keo'));
    expect(exactNameKey('  Bút   BI xanh ')).toBe('bút bi xanh');
    expect(exactNameKey('Bút'.normalize('NFD'))).toBe(exactNameKey('Bút'.normalize('NFC')));
  });
});

describe('[RÀ SOÁT 3] callGasStream — xuất CSV: chỉ đọc dòng phong bì, chuyển thẳng phần nội dung', () => {
  const gasEnv = () => env({ GAS_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec', GAS_SHARED_SECRET: 's'.repeat(64) });
  const encoder = new TextEncoder();
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Apps Script giả: trả thân phản hồi theo từng đoạn (như mạng thật). */
  function upstream(chunks: Array<string | Uint8Array>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
                controller.close();
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
          ),
      ),
    );
  }

  const stream = () => callGasStream<{ fileBase: string; rows: number; total: number }>(gasEnv(), 'adminExportCsv', {}, { scope: 'admin' });

  it('phong bì bị cắt qua nhiều đoạn, ký tự UTF-8 bị cắt giữa đoạn → dữ liệu đúng, nội dung chuyển nguyên từng byte', async () => {
    const csv = '"Mã biên bản","Người nhận"\r\n"BG-1","Bùi Thanh Tâm"\r\n';
    const bytes = encoder.encode(`${JSON.stringify({ ok: true, data: { fileBase: 'bien-ban', rows: 1, total: 1 } })}\n${csv}`);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
    upstream(chunks);
    const { data, body } = await stream();
    expect(data).toEqual({ fileBase: 'bien-ban', rows: 1, total: 1 });
    expect(new TextDecoder().decode(await new Response(body).arrayBuffer())).toBe(csv);
  });

  it('Apps Script báo lỗi (một dòng JSON, không có nội dung) → đúng mã lỗi / HTTP status', async () => {
    upstream([JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Không có dữ liệu xuất này.' } })]);
    await expect(stream()).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('trang HTML (Web App sai quyền), phong bì "ok" mà thiếu nội dung, dòng đầu quá dài → 502, không trả tệp rỗng', async () => {
    upstream(['<!doctype html>\n<html><body>Đăng nhập Google</body></html>']);
    await expect(stream()).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
    upstream([JSON.stringify({ ok: true, data: { fileBase: 'bien-ban', rows: 0, total: 0 } })]);
    await expect(stream()).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
    upstream([`{"ok":true,"data":"${'a'.repeat(70 * 1024)}`]);
    await expect(stream()).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
  });
});
