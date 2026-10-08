import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGasEmulator } from '../scripts/gas-emulator/server.mjs';
import worker from '../worker/index';
import { invalidateCached } from '../worker/services/memoryCache';
import { recordSealKey } from '../worker/services/seal';
import type { Env } from '../worker/types';
import { makePng, otpFromMail } from './helpers';

/**
 * Chạy Worker thật (worker/index.ts) trên Node, nối tới Apps Script giả lập qua HTTP
 * (có redirect 302 giống Web App của Google). Kiểm tra toàn bộ API end-to-end.
 */

const BASE = 'https://ban-giao.test';
const ADMIN_PASSWORD = 'Admin@12345!';
let emulator: Awaited<ReturnType<typeof startGasEmulator>>;
let env: Env;
const background: Promise<unknown>[] = [];
let adminSession = '';

interface CallOptions {
  body?: unknown;
  cookie?: string;
  ip?: string;
  origin?: string | null;
  headers?: Record<string, string>;
  rawBody?: string | ReadableStream<Uint8Array>;
  envOverride?: Partial<Env>;
}

async function call(method: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': options.ip ?? '10.0.0.1', ...options.headers };
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['Content-Type'] ??= 'application/json';
    if (options.origin !== null) headers.Origin = options.origin ?? BASE;
  }
  if (options.cookie) headers.Cookie = options.cookie;
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  };
  if (options.rawBody instanceof ReadableStream) init.duplex = 'half';
  const request = new Request(BASE + path, init);
  const res = await worker.fetch!(request, { ...env, ...options.envOverride } as Env, {
    waitUntil: (p: Promise<unknown>) => background.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext);
  const buffer = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { res, status: res.status, json, buffer };
}

const signature = () => `data:image/png;base64,${makePng(480, 200).toString('base64')}`;

function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    category: 'THIET_BI_CNTT',
    itemName: 'Laptop Dell Latitude 5440',
    assetCode: 'TS-0001',
    serialNumber: 'SN-01',
    model: '5440',
    quantity: 1,
    unit: '',
    condition: 'Tốt',
    description: '',
    workStatus: '',
    deadline: '',
    documentUrl: '',
    note: '',
    ...overrides,
  };
}

function handoverInput(overrides: Record<string, unknown> = {}) {
  return {
    handoverType: 'OTHER',
    sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
    receiverEmployeeId: 'DEMO-519',
    note: 'Bàn giao khi chuyển công tác',
    items: [itemInput(), itemInput({ category: 'THE', itemName: 'Thẻ thang máy', assetCode: 'TM-01' })],
    supplies: [],
    ...overrides,
  };
}

const tokenOf = (link: string) => link.split('/xac-nhan/')[1]!;

async function login(ip = '10.9.9.9', envOverride?: Partial<Env>, body: Record<string, unknown> = { password: ADMIN_PASSWORD }) {
  const res = await call('POST', '/api/admin/login', { body, ip, envOverride });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.res.headers.get('Set-Cookie')!.split(';')[0]!;
}

async function createViaAdmin(overrides: Record<string, unknown> = {}, ip = '10.0.0.9') {
  const created = await call('POST', '/api/admin/handovers', { body: handoverInput(overrides), cookie: adminSession, ip });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  return created.json.data as { id: string; code: string; link: string; warnings: unknown[] };
}

async function view(token: string, ip?: string) {
  return call('GET', `/api/handover/${token}`, { ip });
}

/** Bấm "Gửi mã" rồi đọc mã trong hộp thư giả lập (vừa gửi < 60 giây → dùng lại mã trước đó). */
async function requestOtp(token: string, handoverCode: string, ip = '10.0.0.4') {
  const sent = await call('POST', `/api/handover/${token}/otp`, { body: {}, ip });
  if (sent.status !== 200 && sent.json?.error?.code !== 'RATE_LIMITED') throw new Error(`OTP: ${JSON.stringify(sent.json)}`);
  const otp = otpFromMail(emulator.runtime.mail, handoverCode);
  if (!otp) throw new Error(`Không thấy email mã OTP cho ${handoverCode}`);
  return otp;
}

/** Người nhận ký như trình duyệt: lấy contentHash; phiếu yêu cầu OTP → xin mã + đọc email giả lập (extra.otp để tự chỉ định). */
async function confirm(token: string, extra: Record<string, unknown> = {}, ip = '10.0.0.4', envOverride?: Partial<Env>) {
  const handover = (await view(token, ip)).json?.data?.handover;
  const body: Record<string, unknown> = { agreed: true, contentHash: handover?.contentHash, signature: signature(), ...extra };
  if (handover?.otp?.required && !('otp' in extra)) body.otp = await requestOtp(token, handover.code, ip);
  return call('POST', `/api/handover/${token}/confirm`, { body, ip, envOverride });
}

beforeAll(async () => {
  const secret = crypto.randomBytes(32).toString('hex');
  emulator = await startGasEmulator({ port: 0, secret, quiet: true });
  emulator.runtime.run('seedOfficeSupplyNorms');
  env = {
    ASSETS: { fetch: async () => new Response('<!doctype html><title>SPA</title>', { headers: { 'Content-Type': 'text/html' } }) },
    GAS_WEB_APP_URL: emulator.url,
    GAS_SHARED_SECRET: secret,
    ADMIN_PASSWORD,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    APP_BASE_URL: '',
  } as Env;
  adminSession = await login('10.9.9.1');
});

afterAll(async () => {
  await Promise.allSettled(background);
  await emulator?.close();
});

describe('Worker API end-to-end (Worker → Apps Script giả lập → Sheet/Drive)', () => {
  it('GET /api/health: đủ thành phần, không lộ secret / cấu hình chi tiết', async () => {
    const { status, json, res } = await call('GET', '/api/health');
    expect(status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      error: null,
      data: { app: 'dta-handover', version: '2.0.0', cloudflare: 'ok', appsScript: 'ok', database: 'ok', drive: 'ok' },
    });
    expect(Object.keys(json.data.configured).sort()).toEqual(['admin', 'appsScript', 'session']);
    const text = JSON.stringify(json);
    expect(text).not.toContain(env.GAS_SHARED_SECRET!);
    expect(text).not.toContain(env.GAS_WEB_APP_URL!);
    expect(text).not.toContain(ADMIN_PASSWORD);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('[QUYỀN] public KHÔNG tạo được phiếu, không xem danh bạ — kể cả gọi API trực tiếp', async () => {
    const legacy = await call('POST', '/api/handover', { body: handoverInput() });
    expect(legacy.status).toBe(404);
    expect((await call('GET', '/api/employees')).status).toBe(404);
    expect((await call('GET', '/api/categories')).status).toBe(404);
    const noSession = await call('POST', '/api/admin/handovers', { body: handoverInput() });
    expect(noSession.status).toBe(401);
    expect(noSession.json.error).toMatchObject({ code: 'UNAUTHORIZED', details: { loginMode: 'shared' } });
    const forged = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: '__Host-dta_admin=eyJrIjoiYWRtaW4ifQ.forged' });
    expect(forged.status).toBe(401);
    expect((await call('GET', '/api/admin/employees')).status).toBe(401);
    // Phiên nhân viên (mã truy cập) không phải phiên admin
    const envOverride = { STAFF_ACCESS_CODE: 'DTA-2026' };
    const staff = await call('POST', '/api/staff/login', { body: { code: 'DTA-2026' }, envOverride, ip: '10.4.0.1' });
    const staffCookie = staff.res.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: staffCookie, envOverride })).status).toBe(401);
  });

  it('admin tạo → người nhận xem (contentHash) → ký → chặn ký lần 2 → tải PDF đúng định dạng', async () => {
    const invalid = await call('POST', '/api/admin/handovers', { body: handoverInput({ items: [] }), cookie: adminSession });
    expect(invalid.status).toBe(422);
    expect(invalid.json).toMatchObject({ success: false, data: null, error: { code: 'VALIDATION_ERROR' } });
    expect(invalid.json.error.details.fieldErrors).toHaveProperty('items');

    const missing = await call('POST', '/api/admin/handovers', { body: handoverInput({ receiverEmployeeId: 'KHONG-CO' }), cookie: adminSession });
    expect(missing.status).toBe(422);
    expect(missing.json.error.code).toBe('EMPLOYEE_NOT_FOUND');

    const created = await createViaAdmin();
    expect(created).toMatchObject({ handoverType: 'OTHER', status: 'PENDING', receiver: { name: 'Phạm Danh Thái', employeeId: 'DEMO-519' } });
    expect(created.code).toMatch(/^BG-\d{8}-\d{4}$/);
    expect(created.link).toMatch(new RegExp(`^${BASE}/xac-nhan/[A-Za-z0-9_-]{43}$`));
    const token = tokenOf(created.link);

    // Sheet chỉ lưu hash của token
    const state = await (await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/state'))).json();
    expect(JSON.stringify(state.sheets)).not.toContain(token);
    expect(state.sheets.BAN_GIAO.at(-1).public_token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(state.sheets.BAN_GIAO.at(-1).created_by).toBe('Quản trị viên');

    const shown = await view(token);
    expect(shown.status).toBe(200);
    expect(shown.json.data.handover).toMatchObject({ code: created.code, status: 'PENDING', handoverType: 'OTHER' });
    expect(shown.json.data.handover.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(shown.json.data.handover.items).toHaveLength(2);
    expect(JSON.stringify(shown.json)).not.toMatch(/tokenHash|tokenNonce|ipHash/);

    expect((await view('abc')).status).toBe(404);
    expect((await view('x'.repeat(43))).status).toBe(404);

    const hash = shown.json.data.handover.contentHash;
    const noAgree = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: false, contentHash: hash, signature: signature() } });
    expect(noAgree.status).toBe(422);
    const noHash = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: true, signature: signature() } });
    expect(noHash.status).toBe(422);
    expect(noHash.json.error.details.fieldErrors).toHaveProperty('contentHash');
    const jpeg = await call('POST', `/api/handover/${token}/confirm`, {
      body: { agreed: true, contentHash: hash, signature: `data:image/png;base64,${Buffer.from('JFIF-not-png-data-xxxxxxxxxxxxxxxxxxxx').toString('base64')}` },
    });
    expect(jpeg.status).toBe(422);

    const confirmed = await confirm(token, { comment: 'Đủ' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.handover).toMatchObject({ status: 'CONFIRMED', receiverComment: 'Đủ' });
    expect(confirmed.json.data).not.toHaveProperty('id');

    const twice = await confirm(token);
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe('ALREADY_CONFIRMED');

    await Promise.allSettled(background); // PDF sinh nền qua ctx.waitUntil
    const pdf = await call('GET', `/api/handover/${token}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('Content-Type')).toBe('application/pdf');
    expect(pdf.res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(pdf.res.headers.get('Content-Disposition')).toContain(`${created.code}.pdf`);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const files = (await (await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/state'))).json()).files;
    expect(files.filter((f: { path: string }) => f.path.endsWith(`${created.code}.pdf`))).toHaveLength(1);
    expect(files.some((f: { path: string }) => f.path.endsWith(`${created.code}-signature.png`))).toBe(true);
  });

  it('[BUG-01] admin sửa phiếu khi người nhận đang mở trang → ký bằng nội dung cũ trả 409 CONFLICT', async () => {
    const created = await createViaAdmin({}, '10.0.0.21');
    const token = tokenOf(created.link);
    const seenHash = (await view(token)).json.data.handover.contentHash;
    const update = await call('PUT', `/api/admin/handovers/${created.id}`, {
      cookie: adminSession,
      body: handoverInput({ items: [itemInput({ condition: 'Hư hỏng nặng' })] }),
    });
    expect(update.status).toBe(200);
    expect(update.json.data.linkRotated).toBe(false);
    const stale = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: true, contentHash: seenHash, signature: signature() } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('CONFLICT');
    expect((await confirm(token)).status).toBe(200); // tải lại → ký bản mới
  });

  it('yêu cầu chỉnh sửa bắt buộc lý do', async () => {
    const created = await createViaAdmin({}, '10.0.0.2');
    const token = tokenOf(created.link);
    const hash = (await view(token)).json.data.handover.contentHash;
    expect((await call('POST', `/api/handover/${token}/request-revision`, { body: { reason: '', contentHash: hash } })).status).toBe(422);
    const ok = await call('POST', `/api/handover/${token}/request-revision`, { body: { reason: 'Laptop có vết xước ở góc trái màn hình.', contentHash: hash } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.handover.status).toBe('REVISION_REQUESTED');
    expect((await call('GET', `/api/handover/${token}/pdf`)).status).toBe(409);
  });

  it('admin: đăng nhập sai/đúng, danh sách + lọc, chi tiết + link, sửa, đổi người nhận, link mới, hủy, đăng xuất', async () => {
    expect((await call('GET', '/api/admin/handovers')).status).toBe(401);
    const wrong = await call('POST', '/api/admin/login', { body: { password: 'sai-mat-khau' }, ip: '10.1.1.1' });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.res.headers.get('Set-Cookie')).toBeNull();

    const loginRes = await call('POST', '/api/admin/login', { body: { password: ADMIN_PASSWORD }, ip: '10.1.1.1' });
    const setCookie = loginRes.res.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/^__Host-dta_admin=/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(setCookie).toContain(attr);
    const cookie = setCookie.split(';')[0]!;
    const me = (await call('GET', '/api/admin/me', { cookie })).json.data;
    expect(me).toMatchObject({ authenticated: true, mode: 'shared', user: { username: 'admin', name: 'Quản trị viên' } });
    expect(me.warnings.join(' ')).toMatch(/ADMIN_USERS/);

    const created = await call('POST', '/api/admin/handovers', { body: handoverInput({ receiverEmployeeId: 'DEMO-104' }), cookie, ip: '10.0.0.3' });
    const originalLink = created.json.data.link as string;

    const list = await call('GET', '/api/admin/handovers?status=PENDING&receiver=do%20thi%20huong', { cookie });
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((i: { code: string }) => i.code)).toContain(created.json.data.code);
    expect(list.json.data.stats.total).toBeGreaterThanOrEqual(3);
    const id = list.json.data.items.find((i: { code: string }) => i.code === created.json.data.code).id;

    const detail = await call('GET', `/api/admin/handovers/${id}`, { cookie });
    expect(detail.status).toBe(200);
    expect(detail.json.data.handover.link).toBe(originalLink);
    expect(detail.json.data.handover).not.toHaveProperty('tokenHash');
    expect(detail.json.data.handover).not.toHaveProperty('tokenNonce');
    expect(detail.json.data.handover.integrity.status).toBe('NOT_SIGNED');
    expect((await call('GET', '/api/admin/handovers/not-a-uuid', { cookie })).status).toBe(404);

    const opened = detail.json.data.handover.contentHash as string;
    const update = await call('PUT', `/api/admin/handovers/${id}`, {
      cookie,
      body: { ...handoverInput({ receiverEmployeeId: 'DEMO-104', items: [itemInput({ condition: 'Trầy xước nhẹ' })] }), expectedContentHash: opened },
    });
    expect(update.status).toBe(200);
    expect(update.json.data).toMatchObject({ linkRotated: false, handover: { status: 'PENDING', link: originalLink } });
    expect(update.json.data.handover.items).toHaveLength(1);
    // Quản trị viên khác lưu bản mở từ TRƯỚC lần sửa trên → 409, không ghi đè
    const stale = await call('PUT', `/api/admin/handovers/${id}`, { cookie, body: { ...handoverInput({ note: 'Bản cũ' }), expectedContentHash: opened } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('CONFLICT');
    const badHash = await call('PUT', `/api/admin/handovers/${id}`, { cookie, body: { ...handoverInput(), expectedContentHash: 'abc' } });
    expect(badHash.status).toBe(422);

    const rotate = await call('PUT', `/api/admin/handovers/${id}`, { cookie, body: handoverInput({ receiverEmployeeId: 'DEMO-105' }) });
    expect(rotate.json.data.linkRotated).toBe(true);
    const rotatedLink = rotate.json.data.handover.link as string;
    expect(rotatedLink).not.toBe(originalLink);
    expect((await view(tokenOf(originalLink))).status).toBe(404);
    expect((await view(tokenOf(rotatedLink))).json.data.handover.receiver.name).toBe('Võ Minh Quân');

    const regen = await call('POST', `/api/admin/handovers/${id}/regenerate-link`, { cookie, body: {} });
    expect(regen.status).toBe(200);
    expect((await view(tokenOf(rotatedLink))).status).toBe(404);
    expect((await view(tokenOf(regen.json.data.link))).status).toBe(200);

    const cancel = await call('POST', `/api/admin/handovers/${id}/cancel`, { cookie, body: { reason: 'Tạo nhầm' } });
    expect(cancel.json.data.handover).toMatchObject({ status: 'CANCELLED', link: null });
    const confirmCancelled = await confirm(tokenOf(regen.json.data.link), {}, '10.0.0.40');
    expect(confirmCancelled.status).toBe(409);

    expect((await call('POST', '/api/admin/cache/refresh', { cookie, body: {} })).json.data.employees).toBeGreaterThan(0);
    const employees = await call('GET', '/api/admin/employees?all=1', { cookie });
    expect(employees.json.data.employees.find((e: { employeeId: string }) => e.employeeId === 'DEMO-107')).toMatchObject({ status: 'INACTIVE' });
    expect((await call('GET', '/api/admin/categories', { cookie })).json.data.categories.map((c: { code: string }) => c.code)).toContain('VAN_PHONG_PHAM');

    const logout = await call('POST', '/api/admin/logout', { cookie, body: {} });
    expect(logout.res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('admin: xem chữ ký & tải PDF qua Worker (Drive private, CSP sandbox), tạo lại PDF', async () => {
    const list = await call('GET', '/api/admin/handovers?status=CONFIRMED', { cookie: adminSession });
    const id = list.json.data.items[0].id;
    const sig = await call('GET', `/api/admin/handovers/${id}/signature`, { cookie: adminSession });
    expect(sig.res.headers.get('Content-Type')).toBe('image/png');
    expect(sig.res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(sig.buffer.subarray(1, 4).toString()).toBe('PNG');
    const pdf = await call('GET', `/api/admin/handovers/${id}/pdf`, { cookie: adminSession });
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call('POST', `/api/admin/handovers/${id}/pdf`, { cookie: adminSession, body: {} })).json.data.pdfAvailable).toBe(true);
    expect((await call('GET', `/api/admin/handovers/${id}/signature`)).status).toBe(401);
    const detail = (await call('GET', `/api/admin/handovers/${id}`, { cookie: adminSession })).json.data.handover;
    expect(detail.integrity.status).toBe('OK');
  });

  it('HTTP status & bảo vệ: 400 / 403 / 404 / 405 / 413 / 429', async () => {
    const notJson = await call('POST', '/api/admin/handovers', { rawBody: 'a=b', cookie: adminSession, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(notJson.status).toBe(400);
    const badJson = await call('POST', '/api/admin/handovers', { rawBody: '{oops', cookie: adminSession });
    expect(badJson.status).toBe(400);
    const csrf = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, origin: 'https://evil.example' });
    expect(csrf.status).toBe(403);
    // Body quá lớn gửi dạng luồng (không có Content-Length) → 413, không đọc hết vào bộ nhớ
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 400 * 1024) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const huge = await call('POST', '/api/admin/handovers', { rawBody: stream, cookie: adminSession });
    expect(huge.status).toBe(413);
    expect(sent).toBeLessThan(400 * 1024);
    const unknown = await call('GET', '/api/khong-ton-tai');
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const wrongMethod = await call('DELETE', '/api/admin/handovers');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.res.headers.get('Allow')).toBe('GET, POST');

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('POST', '/api/admin/login', { body: { password: 'x' }, ip: '10.66.66.66' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('lỗi Apps Script / Sheet / cấu hình → mã lỗi đúng, thông báo thân thiện', async () => {
    invalidateCached(); // health được cache ngắn hạn trong isolate
    const wrongSecret = await call('GET', '/api/admin/categories', { cookie: adminSession, envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.1' });
    expect(wrongSecret.status).toBe(502);
    expect(wrongSecret.json.error.code).toBe('UPSTREAM_AUTH_FAILED');
    const healthWrong = await call('GET', '/api/health', { envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.2' });
    expect(healthWrong.status).toBe(503);
    expect(healthWrong.json.data.appsScript).toBe('error');

    const created = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.3' });
    expect(created.status).toBe(502);
    expect(created.json.error.code).toBe('UPSTREAM_AUTH_FAILED');

    await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/fault'), { method: 'POST', body: JSON.stringify({ target: 'html', count: 1 }) });
    const html = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, ip: '10.2.0.4' });
    expect(html.status).toBe(502);
    expect(html.json.error.code).toBe('UPSTREAM_ERROR');

    await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/fault'), { method: 'POST', body: JSON.stringify({ target: 'sheets', count: 1 }) });
    const sheetFail = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, ip: '10.2.0.5' });
    expect(sheetFail.status).toBe(500);
    expect(sheetFail.json.error.message).not.toMatch(/Service Spreadsheets|stack/i);

    const notConfigured = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, envOverride: { GAS_WEB_APP_URL: '' }, ip: '10.2.0.6' });
    expect(notConfigured.status).toBe(503);
    expect(notConfigured.json.error.code).toBe('NOT_CONFIGURED');

    const badHost = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, envOverride: { GAS_WEB_APP_URL: 'https://evil.example/exec' }, ip: '10.2.0.7' });
    expect(badHost.status).toBe(503);
  });

  it('tài khoản quản trị riêng (ADMIN_USERS): bắt buộc username, nhật ký ghi đúng người, đổi mật khẩu → phiên cũ hết hiệu lực', async () => {
    const users = [
      { username: 'thai', name: 'Phạm Danh Thái', password: 'Thai-Pass-2026!' },
      { username: 'ngoc', name: 'Trần Thị Bích Ngọc', password: 'Ngoc-Pass-2026!' },
    ];
    const envOverride = { ADMIN_USERS: JSON.stringify(users) };
    const noUser = await call('POST', '/api/admin/login', { body: { password: users[0]!.password }, envOverride, ip: '10.7.0.1' });
    expect(noUser.status).toBe(422);
    expect(noUser.json.error.details.fieldErrors).toHaveProperty('username');
    expect((await call('POST', '/api/admin/login', { body: { username: 'thai', password: users[1]!.password }, envOverride, ip: '10.7.0.1' })).status).toBe(401);
    expect((await call('POST', '/api/admin/login', { body: { password: ADMIN_PASSWORD }, envOverride, ip: '10.7.0.1' })).status).toBe(422); // mật khẩu chung bị tắt
    const meAnon = await call('GET', '/api/admin/me', { envOverride });
    expect(meAnon.json.error.details).toEqual({ loginMode: 'users' });

    const thai = await login('10.7.0.2', envOverride, { username: 'THAI', password: users[0]!.password });
    const ngoc = await login('10.7.0.3', envOverride, { username: 'ngoc', password: users[1]!.password });
    expect((await call('GET', '/api/admin/me', { cookie: thai, envOverride })).json.data.user).toEqual({ username: 'thai', name: 'Phạm Danh Thái' });
    // Phiên mật khẩu chung cũ không dùng được khi đã chuyển sang ADMIN_USERS
    expect((await call('GET', '/api/admin/me', { cookie: adminSession, envOverride })).status).toBe(401);

    const created = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: thai, envOverride, ip: '10.7.0.2' });
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    await call('POST', `/api/admin/handovers/${id}/cancel`, { body: { reason: 'Thử nhật ký' }, cookie: ngoc, envOverride });
    const history = (await call('GET', `/api/admin/handovers/${id}`, { cookie: thai, envOverride })).json.data.handover.history;
    expect(history.map((h: { actor: string }) => h.actor)).toEqual(['Phạm Danh Thái (thai)', 'Trần Thị Bích Ngọc (ngoc)']);

    const changed = { ADMIN_USERS: JSON.stringify([{ ...users[0]!, password: 'Thai-New-Pass-2026!' }, users[1]]) };
    expect((await call('GET', '/api/admin/me', { cookie: thai, envOverride: changed })).status).toBe(401);
    expect((await call('GET', '/api/admin/me', { cookie: ngoc, envOverride: changed })).status).toBe(200);
    const broken = await call('POST', '/api/admin/login', { body: { username: 'x', password: 'y' }, envOverride: { ADMIN_USERS: '[{"username":"a","password":"short"}]' }, ip: '10.7.0.9' });
    expect(broken.status).toBe(503);
  });

  it('[REVIEW-5] dò mật khẩu MỘT tài khoản từ nhiều IP vẫn bị chặn (giới hạn theo tên đăng nhập, không theo IP)', async () => {
    const envOverride = { ADMIN_USERS: JSON.stringify([{ username: 'kho', name: 'Thủ kho', password: 'Kho-Pass-2026!' }]) };
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      statuses.push((await call('POST', '/api/admin/login', { body: { username: 'kho', password: `sai-${i}` }, envOverride, ip: `10.77.${i}.1` })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]); // IP mới nhưng cùng tài khoản → bị chặn (30 lần / phút / tài khoản)
    // Tài khoản khác từ IP khác không bị ảnh hưởng
    const other = await call('POST', '/api/admin/login', { body: { username: 'khac', password: 'x' }, envOverride, ip: '10.77.99.1' });
    expect(other.status).toBe(401);
  });

  it('MỘT IP dò mật khẩu không khóa được tài khoản quản trị: bị chặn theo IP trước, quản trị viên thật vẫn đăng nhập được', async () => {
    const envOverride = { ADMIN_USERS: JSON.stringify([{ username: 'ketoan', name: 'Kế toán', password: 'Ke-Toan-Pass-2026!' }]) };
    const attacker: number[] = [];
    for (let i = 0; i < 15; i++) {
      attacker.push((await call('POST', '/api/admin/login', { body: { username: 'ketoan', password: `sai-${i}` }, envOverride, ip: '10.78.0.66' })).status);
    }
    expect(attacker.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(attacker.slice(10).every((s) => s === 429)).toBe(true);
    const real = await call('POST', '/api/admin/login', { body: { username: 'ketoan', password: 'Ke-Toan-Pass-2026!' }, envOverride, ip: '10.78.0.7' });
    expect(real.status, JSON.stringify(real.json)).toBe(200);
  });

  it('IPv6: đổi địa chỉ trong cùng dải /64 không vượt được giới hạn đăng nhập mã truy cập nội bộ', async () => {
    const envOverride = { STAFF_ACCESS_CODE: 'Ma-Noi-Bo-2026' };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('POST', '/api/staff/login', { body: { code: `sai-${i}` }, envOverride, ip: `2001:db8:12:34::${(i + 1).toString(16)}` })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const otherNet = await call('POST', '/api/staff/login', { body: { code: 'Ma-Noi-Bo-2026' }, envOverride, ip: '2001:db8:12:35::1' });
    expect(otherNet.status).toBe(200);
  });

  it('đường dẫn không phải /api/* do static assets phục vụ', async () => {
    const page = await call('GET', '/xac-nhan/test');
    expect(page.status).toBe(200);
    expect(page.buffer.toString()).toContain('SPA');
  });
});

describe('Worker API — mã OTP khi ký, huy hiệu menu, xuất CSV', () => {
  it('OTP: phải có mã khi người nhận có email; gửi mã có giới hạn; mã sai / thiếu → 422 kèm lỗi ô nhập', async () => {
    const created = await call('POST', '/api/admin/handovers', { body: handoverInput(), cookie: adminSession, ip: '10.8.0.1' });
    expect(created.status).toBe(201);
    expect(created.json.data.confirmOtp).toEqual({ required: true, blocked: false, email: 'thai.pham@example.com' });
    const { code } = created.json.data;
    const token = tokenOf(created.json.data.link);
    const ip = '10.8.0.2';
    const shown = (await view(token, ip)).json.data.handover;
    expect(shown.otp).toEqual({ required: true, blocked: false, emailMasked: 't***@example.com' });
    expect(JSON.stringify(shown.otp)).not.toContain('thai.pham');

    const missing = await confirm(token, { otp: '' }, ip);
    expect(missing.status).toBe(422);
    expect(missing.json.error).toMatchObject({ code: 'OTP_REQUIRED', details: { fieldErrors: { otp: expect.any(String) } } });
    const malformed = await confirm(token, { otp: '12ab56' }, ip);
    expect(malformed.status).toBe(422);
    expect(malformed.json.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fieldErrors: { otp: 'Mã xác nhận gồm 6 chữ số' } } });

    expect((await call('POST', `/api/handover/${token}/otp`, { body: {}, ip, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', `/api/handover/${'x'.repeat(43)}/otp`, { body: {}, ip })).status).toBe(404);
    const sent = await call('POST', `/api/handover/${token}/otp`, { body: {}, ip });
    expect(sent.status).toBe(200);
    expect(sent.json.data).toEqual({ sent: true, emailMasked: 't***@example.com', expiresInSeconds: 600, resendAfterSeconds: 60 });
    const tooSoon = await call('POST', `/api/handover/${token}/otp`, { body: {}, ip });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.json.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
    // 429 do Apps Script trả về cũng có header Retry-After (khớp thời gian chờ thật)
    expect(Number(tooSoon.res.headers.get('Retry-After'))).toBe(tooSoon.json.error.details.retryAfterSeconds);
    expect(shown.receiver.email).toBe('t***@example.com');

    const otp = otpFromMail(emulator.runtime.mail, code)!;
    const wrong = await confirm(token, { otp: otp === '000000' ? '111111' : '000000' }, ip);
    expect(wrong.status).toBe(422);
    expect(wrong.json.error).toMatchObject({ code: 'OTP_INVALID', details: { fieldErrors: { otp: expect.stringContaining('còn 4 lần') } } });
    const ok = await confirm(token, { otp }, ip);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.data.handover).toMatchObject({ status: 'CONFIRMED', otp: { required: false } });
    const detail = (await call('GET', `/api/admin/handovers/${created.json.data.id}`, { cookie: adminSession })).json.data.handover;
    expect(detail.confirmMethod).toBe('OTP_EMAIL');
  });

  it('huy hiệu menu: chỉ admin; đếm yêu cầu chỉnh sửa + đề xuất chờ duyệt', async () => {
    expect((await call('GET', '/api/admin/badges')).status).toBe(401);
    const badges = await call('GET', '/api/admin/badges', { cookie: adminSession });
    expect(badges.status).toBe(200);
    expect(badges.json.data).toEqual({ revisionRequested: expect.any(Number), submittedProposals: expect.any(Number) });
    expect(badges.json.data.revisionRequested).toBeGreaterThanOrEqual(1); // từ test "yêu cầu chỉnh sửa bắt buộc lý do"
  });

  it('xuất CSV: chỉ admin, UTF-8 BOM + CRLF, chống chèn công thức, theo bộ lọc, báo bị cắt bớt', async () => {
    expect((await call('GET', '/api/admin/export/handovers.csv')).status).toBe(401);
    expect((await call('GET', '/api/admin/export/khac.csv', { cookie: adminSession })).status).toBe(404);
    expect((await call('GET', '/api/admin/export/__proto__', { cookie: adminSession })).status).toBe(404);

    const evil = await call('POST', '/api/admin/handovers', {
      cookie: adminSession,
      ip: '10.8.0.5',
      // Người giao không có mã NV → tên tự nhập được giữ nguyên (đối tác bên ngoài)
      body: handoverInput({ sender: { name: '=HYPERLINK("http://evil.example","Bấm")', employeeId: '' }, receiverEmployeeId: 'DEMO-106' }),
    });
    expect(evil.status, JSON.stringify(evil.json)).toBe(201);

    const res = await call('GET', '/api/admin/export/handovers.csv?receiver=bui%20thanh%20tam', { cookie: adminSession });
    expect(res.status).toBe(200);
    expect(res.res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="bien-ban-ban-giao-\d{8}-\d{4}\.csv"/);
    expect(res.res.headers.get('X-Export-Truncated')).toBe('0');
    expect(res.res.headers.get('X-Export-Rows')).toBe('1');
    expect(res.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.buffer.subarray(0, 3).toString('hex')).toBe('efbbbf');
    const lines = res.buffer.toString('utf8').slice(1).split('\r\n');
    expect(lines[0]).toMatch(/^"Mã biên bản","Loại phiếu","Trạng thái",/);
    expect(lines).toHaveLength(3); // tiêu đề + 1 dòng + dòng trống cuối
    expect(lines[1]).toContain(`"${evil.json.data.code}"`);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"",""Bấm"")"`);
    expect(lines[1]).toContain('"Bùi Thanh Tâm","DEMO-106","Marketing","2","Thiết bị CNTT, Thẻ"');

    for (const dataset of ['stock.csv', 'movements.csv?type=IN', 'proposals.csv?status=SUBMITTED']) {
      const out = await call('GET', `/api/admin/export/${dataset}`, { cookie: adminSession });
      expect(out.status, dataset).toBe(200);
      expect(out.buffer.subarray(0, 3).toString('hex'), dataset).toBe('efbbbf');
      expect(Number(out.res.headers.get('X-Export-Total')), dataset).toBeGreaterThanOrEqual(0);
    }
    const stock = (await call('GET', '/api/admin/export/stock.csv?q=but%20bi', { cookie: adminSession })).buffer.toString('utf8');
    expect(stock).toContain('"Tồn thực tế","Đang giữ chỗ","Khả dụng"');
    expect(stock).toContain('"Bút bi Thiên Long 027, xanh"');
  });
});

describe('[RÀ SOÁT 3] Worker API — niêm phong biên bản, gửi lại cùng mã thao tác, IPv6', () => {
  const SEAL_SECRET = crypto.randomBytes(24).toString('hex'); // 48 ký tự (≥ 32)
  const sealed: Partial<Env> = { RECORD_SEAL_SECRET: SEAL_SECRET };

  async function detail(id: string, envOverride?: Partial<Env>) {
    const res = await call('GET', `/api/admin/handovers/${id}`, { cookie: adminSession, envOverride });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res;
  }

  it('niêm phong: Worker gửi khóa (từ RECORD_SEAL_SECRET) khi ký & khi xem; khóa không lưu ở Google, không lộ trong phản hồi', async () => {
    const created = await createViaAdmin({}, '10.7.0.1');
    const signed = await confirm(tokenOf(created.link), {}, '10.7.0.2', sealed);
    expect(signed.status, JSON.stringify(signed.json)).toBe(200);

    const verified = await detail(created.id, sealed);
    expect(verified.json.data.handover.integrity).toMatchObject({ status: 'OK', checks: { content: true, record: true, seal: 'OK' } });
    // Worker không có khóa → chưa kiểm được niêm phong (không báo sai); khóa khác (secret bị đổi / giả mạo) → KHÔNG khớp.
    expect((await detail(created.id)).json.data.handover.integrity).toMatchObject({ status: 'OK', checks: { seal: 'UNVERIFIED' } });
    expect((await detail(created.id, { RECORD_SEAL_SECRET: 'x'.repeat(40) })).json.data.handover.integrity).toMatchObject({
      status: 'MISMATCH',
      checks: { content: true, record: true, seal: 'MISMATCH' },
    });

    const sealKey = await recordSealKey({ ...env, ...sealed } as Env);
    expect(sealKey).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.buffer.toString('utf8')).not.toContain(sealKey);
    const google =
      JSON.stringify(emulator.runtime.spreadsheet.getSheets().map((s: any) => s.getDataRange().getValues())) +
      JSON.stringify(emulator.runtime.properties) +
      JSON.stringify(emulator.runtime.logs);
    expect(google).not.toContain(sealKey);
    expect(google).not.toContain(SEAL_SECRET);

    expect((await call('GET', '/api/admin/system', { cookie: adminSession, envOverride: sealed })).json.data.worker.recordSeal).toBe(true);
    expect((await call('GET', '/api/admin/system', { cookie: adminSession })).json.data.worker.recordSeal).toBe(false);
    // Secret quá ngắn = chưa cấu hình (không tạo niêm phong yếu).
    expect((await call('GET', '/api/admin/system', { cookie: adminSession, envOverride: { RECORD_SEAL_SECRET: 'ngan' } })).json.data.worker.recordSeal).toBe(false);
  });

  it('tạo phiếu: gửi lại CÙNG mã thao tác với nội dung đã sửa → 409 REQUEST_REUSED kèm phiếu đã tạo; đúng nội dung → 200 phiếu cũ', async () => {
    const clientRequestId = crypto.randomUUID();
    const first = await call('POST', '/api/admin/handovers', { cookie: adminSession, ip: '10.7.1.1', body: handoverInput({ clientRequestId }) });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const changed = await call('POST', '/api/admin/handovers', {
      cookie: adminSession,
      ip: '10.7.1.1',
      body: handoverInput({ clientRequestId, note: 'Ghi chú đã sửa sau khi mất kết nối' }),
    });
    expect(changed.status).toBe(409);
    expect(changed.json.error).toMatchObject({
      code: 'REQUEST_REUSED',
      details: { existing: { id: first.json.data.id, code: first.json.data.code } },
    });
    const same = await call('POST', '/api/admin/handovers', { cookie: adminSession, ip: '10.7.1.1', body: handoverInput({ clientRequestId }) });
    expect(same.status).toBe(200);
    expect(same.json.data).toMatchObject({ id: first.json.data.id, code: first.json.data.code, duplicate: true });
  });

  it('IPv6: tạo & ký từ hai địa chỉ cùng dải /64 (cùng trình duyệt) → cảnh báo "ký trên cùng thiết bị"; khác dải → không', async () => {
    const ua = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) vitest-ipv6' };
    async function createAndSign(createIp: string, signIp: string) {
      const created = await call('POST', '/api/admin/handovers', { cookie: adminSession, ip: createIp, headers: ua, body: handoverInput() });
      expect(created.status, JSON.stringify(created.json)).toBe(201);
      const token = tokenOf(created.json.data.link);
      const handover = (await view(token, signIp)).json.data.handover;
      const body: Record<string, unknown> = { agreed: true, contentHash: handover.contentHash, signature: signature() };
      if (handover.otp?.required) body.otp = await requestOtp(token, handover.code, signIp);
      const signed = await call('POST', `/api/handover/${token}/confirm`, { body, ip: signIp, headers: ua });
      expect(signed.status, JSON.stringify(signed.json)).toBe(200);
      return (await detail(created.json.data.id)).json.data.handover.confirmedFromCreatorDevice as boolean;
    }
    expect(await createAndSign('2001:db8:77:1::1', '2001:db8:77:1:abcd::9')).toBe(true);
    expect(await createAndSign('2001:db8:77:1::1', '2001:db8:77:2::1')).toBe(false);
  });
});

describe('Worker API — văn phòng phẩm', () => {
  async function products(q = '') {
    const res = await call('GET', `/api/admin/vpp/products?q=${encodeURIComponent(q)}`, { cookie: adminSession });
    expect(res.status).toBe(200);
    return res.json.data.products as any[];
  }

  async function stockIn(productId: string, quantity: number) {
    const res = await call('POST', '/api/admin/vpp/stock/in', {
      cookie: adminSession,
      body: { productId, quantity, reasonType: 'BO_SUNG', clientRequestId: crypto.randomUUID() },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
  }

  it('[QUYỀN] public không chỉnh kho, không duyệt đề xuất, không xem kho admin', async () => {
    const pen = (await products('but bi'))[0];
    const attempts: Array<[string, string, unknown]> = [
      ['POST', '/api/admin/vpp/stock/in', { productId: pen.productId, quantity: 100, reasonType: 'BO_SUNG', clientRequestId: crypto.randomUUID() }],
      ['POST', '/api/admin/vpp/stock/adjust', { productId: pen.productId, countedQuantity: 100, reason: 'hack', clientRequestId: crypto.randomUUID() }],
      ['POST', `/api/admin/vpp/proposals/${crypto.randomUUID()}/approve`, { decisions: [] }],
      ['POST', `/api/admin/vpp/proposals/${crypto.randomUUID()}/receive`, { lines: [] }],
      ['POST', '/api/admin/vpp/products', { productName: 'Hack' }],
      ['PUT', `/api/admin/vpp/norms/${crypto.randomUUID()}`, { productId: pen.productId, scopeId: 'KINH_DOANH', monthlyQuantity: 999 }],
    ];
    for (const [method, path, body] of attempts) {
      expect((await call(method, path, { body })).status, path).toBe(401);
    }
    for (const path of ['/api/admin/vpp/stock', '/api/admin/vpp/products', '/api/admin/vpp/dashboard', '/api/admin/vpp/movements', '/api/admin/vpp/proposals', '/api/admin/vpp/data-review']) {
      expect((await call('GET', path)).status, path).toBe(401);
    }
    expect(pen.stock.onHand).toBe(0);
  });

  it('[QUYỀN] admin làm được: tìm "but bi" không dấu, nhập kho, phiếu VPP giữ chỗ / cảnh báo sản phẩm cuối / không bán vượt tồn / vượt định mức', async () => {
    const found = await products('but bi');
    expect(found.map((p) => p.productName)).toEqual(['Bút bi Thiên Long 027, xanh']);
    const pen = found[0];
    await stockIn(pen.productId, 3);
    const supplies = (quantity: number, overNormReason = '') => [{ productId: pen.productId, quantity, note: '', overNormReason }];
    const ctx = await call('GET', '/api/admin/vpp/handover-context?receiverEmployeeId=DEMO-103', { cookie: adminSession });
    expect(ctx.json.data.scope).toMatchObject({ scopeId: 'KINH_DOANH' });

    const created = await call('POST', '/api/admin/handovers', {
      cookie: adminSession,
      body: { handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '', items: [], supplies: supplies(3), clientRequestId: crypto.randomUUID() },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.data.warnings).toEqual([expect.objectContaining({ type: 'LAST_ITEM', available: 0 })]);
    expect((await products('but bi'))[0].stock).toMatchObject({ onHand: 3, reserved: 3, available: 0, status: 'OUT_OF_STOCK' });

    const oversell = await call('POST', '/api/admin/handovers', {
      cookie: adminSession,
      body: { handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '', items: [], supplies: supplies(1) },
    });
    expect(oversell.status).toBe(409);
    expect(oversell.json.error.code).toBe('INSUFFICIENT_STOCK');
    expect(oversell.json.error.details.shortages[0]).toMatchObject({ available: 0, requested: 1, shortage: 1 });

    await stockIn(pen.productId, 20);
    const overNorm = await call('POST', '/api/admin/handovers', {
      cookie: adminSession,
      body: { handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '', items: [], supplies: supplies(9) },
    });
    expect(overNorm.status).toBe(422); // 3 đang chờ + 9 > 10/tháng
    expect(overNorm.json.error.code).toBe('NORM_EXCEEDED');

    // Người nhận ký phiếu đầu → xuất kho
    const token = tokenOf(created.json.data.link);
    const shown = await view(token, '10.5.0.1');
    expect(shown.json.data.handover.handoverType).toBe('OFFICE_SUPPLY');
    expect(shown.json.data.handover.items[0]).toMatchObject({ itemName: 'Bút bi Thiên Long 027, xanh', unit: 'Cây', quantity: 3 });
    expect((await confirm(token, {}, '10.5.0.1')).status).toBe(200);
    expect((await products('but bi'))[0].stock).toMatchObject({ onHand: 20, reserved: 0, available: 20 });
    const movements = await call('GET', '/api/admin/vpp/movements?type=OUT', { cookie: adminSession });
    expect(movements.json.data.items[0]).toMatchObject({ movementType: 'OUT', quantity: 3, handoverCode: created.json.data.code });
  });

  it('đề xuất mua công khai (có mã truy cập nội bộ) → admin duyệt → nhập kho', async () => {
    const envOverride = { STAFF_ACCESS_CODE: 'DTA-2026' };
    const blocked = await call('POST', '/api/public/vpp/employee-lookup', { body: { employeeId: 'DEMO-103' }, envOverride, ip: '10.6.0.1' });
    expect(blocked.status).toBe(401);
    expect(blocked.json.error.code).toBe('STAFF_AUTH_REQUIRED');
    const staff = await call('POST', '/api/staff/login', { body: { code: 'DTA-2026' }, envOverride, ip: '10.6.0.1' });
    const cookie = staff.res.headers.get('Set-Cookie')!.split(';')[0]!;

    const lookup = await call('POST', '/api/public/vpp/employee-lookup', { body: { employeeId: 'DEMO-103' }, envOverride, cookie, ip: '10.6.0.1' });
    expect(lookup.status).toBe(200);
    expect(lookup.json.data.employee).toEqual({ employeeId: 'DEMO-103', fullName: 'Lê Hoàng Đức', department: 'Kinh doanh', position: 'Nhân viên kinh doanh' });
    expect(lookup.json.data.norms.length).toBe(13);
    const notFound = await call('POST', '/api/public/vpp/employee-lookup', { body: { employeeId: 'KHONG-CO' }, envOverride, cookie, ip: '10.6.0.1' });
    expect(notFound.status).toBe(422);
    const catalog = await call('GET', '/api/public/vpp/catalog', { envOverride, cookie });
    expect(Object.keys(catalog.json.data.products[0]).sort()).toEqual(['category', 'productId', 'productName', 'unit']);

    const a4 = lookup.json.data.norms.find((n: { productName: string }) => n.productName === 'Giấy A4 Excel 80 gsm');
    const clientRequestId = crypto.randomUUID();
    const body = {
      employeeId: 'DEMO-103', clientRequestId, reason: '',
      items: [{ productId: a4.productId, quantity: 2 }, { productName: 'Bút dạ quang vàng', unit: 'Cây', quantity: 3, reason: 'Đánh dấu hợp đồng' }],
    };
    const submitted = await call('POST', '/api/public/vpp/proposals', { body, envOverride, cookie, ip: '10.6.0.1' });
    expect(submitted.status, JSON.stringify(submitted.json)).toBe(201);
    expect(submitted.json.data.proposalCode).toMatch(/^DX-\d{8}-\d{4}$/);
    const again = await call('POST', '/api/public/vpp/proposals', { body, envOverride, cookie, ip: '10.6.0.1' });
    expect(again.status).toBe(200);
    expect(again.json.data.duplicate).toBe(true);

    const list = await call('GET', '/api/admin/vpp/proposals?status=SUBMITTED', { cookie: adminSession });
    const proposal = list.json.data.items.find((p: { proposalCode: string }) => p.proposalCode === submitted.json.data.proposalCode);
    const detail = (await call('GET', `/api/admin/vpp/proposals/${proposal.proposalId}`, { cookie: adminSession })).json.data;
    const [a4Item, tempItem] = detail.items;
    const approve = await call('POST', `/api/admin/vpp/proposals/${proposal.proposalId}/approve`, {
      cookie: adminSession,
      body: { decisions: [{ proposalItemId: a4Item.proposalItemId, approvedQuantity: 2 }, { proposalItemId: tempItem.proposalItemId, approvedQuantity: 0 }] },
    });
    expect(approve.json.data.proposal.status).toBe('PARTIALLY_APPROVED');
    const receive = await call('POST', `/api/admin/vpp/proposals/${proposal.proposalId}/receive`, {
      cookie: adminSession,
      body: { lines: [{ proposalItemId: a4Item.proposalItemId, receivedQuantity: 2, unitPrice: 55600 }], receivedDate: '2026-10-07' },
    });
    expect(receive.status, JSON.stringify(receive.json)).toBe(200);
    expect(receive.json.data.proposal.status).toBe('RECEIVED');
    expect((await products('giay a4'))[0].stock.onHand).toBe(2);
  });
});
