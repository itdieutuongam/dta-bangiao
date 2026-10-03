import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGasEmulator } from '../scripts/gas-emulator/server.mjs';
import worker from '../worker/index';
import { invalidateCached } from '../worker/services/memoryCache';
import type { Env } from '../worker/types';
import { makePng } from './helpers';

/**
 * Chạy Worker thật (worker/index.ts) trên Node, nối tới Apps Script giả lập qua HTTP
 * (có redirect 302 giống Web App của Google). Kiểm tra toàn bộ API end-to-end.
 */

const BASE = 'https://ban-giao.test';
const ADMIN_PASSWORD = 'Admin@12345!';
let emulator: Awaited<ReturnType<typeof startGasEmulator>>;
let env: Env;
const background: Promise<unknown>[] = [];

interface CallOptions {
  body?: unknown;
  cookie?: string;
  ip?: string;
  origin?: string | null;
  headers?: Record<string, string>;
  rawBody?: string;
  envOverride?: Partial<Env>;
}

async function call(method: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': options.ip ?? '10.0.0.1', ...options.headers };
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['Content-Type'] ??= 'application/json';
    if (options.origin !== null) headers.Origin = options.origin ?? BASE;
  }
  if (options.cookie) headers.Cookie = options.cookie;
  const request = new Request(BASE + path, {
    method,
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const res = await worker.fetch!(request, { ...env, ...options.envOverride } as Env, {
    waitUntil: (p: Promise<unknown>) => background.push(p),
    passThroughOnException: () => {},
  });
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
    sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
    receiverEmployeeId: 'DEMO-519',
    note: 'Bàn giao khi chuyển công tác',
    items: [itemInput(), itemInput({ category: 'THE', itemName: 'Thẻ thang máy', assetCode: 'TM-01' })],
    ...overrides,
  };
}

const tokenOf = (link: string) => link.split('/xac-nhan/')[1]!;

async function adminCookie(ip = '10.9.9.9'): Promise<string> {
  const login = await call('POST', '/api/admin/login', { body: { password: ADMIN_PASSWORD }, ip });
  expect(login.status).toBe(200);
  return login.res.headers.get('Set-Cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  const secret = crypto.randomBytes(32).toString('hex');
  emulator = await startGasEmulator({ port: 0, secret, quiet: true });
  env = {
    ASSETS: { fetch: async () => new Response('<!doctype html><title>SPA</title>', { headers: { 'Content-Type': 'text/html' } }) },
    GAS_WEB_APP_URL: emulator.url,
    GAS_SHARED_SECRET: secret,
    ADMIN_PASSWORD,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    APP_BASE_URL: '',
  } as Env;
});

afterAll(async () => {
  await Promise.allSettled(background);
  await emulator?.close();
});

describe('Worker API end-to-end (Worker → Apps Script giả lập → Sheet/Drive)', () => {
  it('GET /api/health: đủ thành phần, không lộ secret', async () => {
    const { status, json, res } = await call('GET', '/api/health');
    expect(status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      error: null,
      data: { app: 'dta-handover', cloudflare: 'ok', appsScript: 'ok', database: 'ok', drive: 'ok' },
    });
    const text = JSON.stringify(json);
    expect(text).not.toContain(env.GAS_SHARED_SECRET!);
    expect(text).not.toContain(env.GAS_WEB_APP_URL!);
    expect(text).not.toContain(ADMIN_PASSWORD);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('danh mục nhân viên & loại bàn giao lấy từ Sheet (giữ nguyên tiếng Việt)', async () => {
    const employees = await call('GET', '/api/employees');
    expect(employees.status).toBe(200);
    expect(employees.json.data.employees.map((e: { fullName: string }) => e.fullName)).toContain('Phạm Danh Thái');
    const categories = await call('GET', '/api/categories');
    expect(categories.json.data.categories.map((c: { name: string }) => c.name)).toEqual([
      'Thiết bị CNTT',
      'Tài sản',
      'Thẻ',
      'Tài khoản',
      'Công việc',
      'Hồ sơ',
      'Khác',
    ]);
  });

  it('tạo → xem → ký xác nhận → chặn ký lần 2 → tải PDF', async () => {
    const invalid = await call('POST', '/api/handover', { body: handoverInput({ items: [] }) });
    expect(invalid.status).toBe(422);
    expect(invalid.json).toMatchObject({ success: false, data: null, error: { code: 'VALIDATION_ERROR' } });
    expect(invalid.json.error.details.fieldErrors).toHaveProperty('items');

    const missing = await call('POST', '/api/handover', { body: handoverInput({ receiverEmployeeId: 'KHONG-CO' }) });
    expect(missing.status).toBe(422);
    expect(missing.json.error.code).toBe('EMPLOYEE_NOT_FOUND');

    const created = await call('POST', '/api/handover', { body: handoverInput() });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ status: 'PENDING', receiver: { name: 'Phạm Danh Thái', employeeId: 'DEMO-519' } });
    expect(created.json.data.code).toMatch(/^BG-\d{8}-\d{4}$/);
    expect(created.json.data.link).toMatch(new RegExp(`^${BASE}/xac-nhan/[A-Za-z0-9_-]{43}$`));
    const token = tokenOf(created.json.data.link);

    // Sheet chỉ lưu hash của token
    const state = await (await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/state'))).json();
    expect(JSON.stringify(state.sheets)).not.toContain(token);
    expect(state.sheets.BAN_GIAO.at(-1).public_token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));

    const view = await call('GET', `/api/handover/${token}`);
    expect(view.status).toBe(200);
    expect(view.json.data.handover).toMatchObject({ code: created.json.data.code, status: 'PENDING' });
    expect(view.json.data.handover.items).toHaveLength(2);
    expect(JSON.stringify(view.json)).not.toMatch(/tokenHash|tokenNonce|ipHash/);

    expect((await call('GET', '/api/handover/abc')).status).toBe(404);
    expect((await call('GET', `/api/handover/${'x'.repeat(43)}`)).status).toBe(404);

    const noAgree = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: false, signature: signature() } });
    expect(noAgree.status).toBe(422);
    const jpeg = await call('POST', `/api/handover/${token}/confirm`, {
      body: { agreed: true, signature: `data:image/png;base64,${Buffer.from('JFIF-not-png-data-xxxxxxxxxxxxxxxxxxxx').toString('base64')}` },
    });
    expect(jpeg.status).toBe(422);

    const confirmed = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: true, signature: signature(), comment: 'Đủ' } });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.handover).toMatchObject({ status: 'CONFIRMED', receiverComment: 'Đủ' });
    expect(confirmed.json.data).not.toHaveProperty('id');

    const twice = await call('POST', `/api/handover/${token}/confirm`, { body: { agreed: true, signature: signature() } });
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe('ALREADY_CONFIRMED');

    await Promise.allSettled(background); // PDF sinh nền qua ctx.waitUntil
    const pdf = await call('GET', `/api/handover/${token}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('Content-Type')).toBe('application/pdf');
    expect(pdf.res.headers.get('Content-Disposition')).toContain(`${created.json.data.code}.pdf`);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const files = (await (await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/state'))).json()).files;
    expect(files.filter((f: { path: string }) => f.path.endsWith(`${created.json.data.code}.pdf`))).toHaveLength(1);
    expect(files.some((f: { path: string }) => f.path.endsWith(`${created.json.data.code}-signature.png`))).toBe(true);
  });

  it('yêu cầu chỉnh sửa bắt buộc lý do', async () => {
    const created = await call('POST', '/api/handover', { body: handoverInput(), ip: '10.0.0.2' });
    const token = tokenOf(created.json.data.link);
    expect((await call('POST', `/api/handover/${token}/request-revision`, { body: { reason: '' } })).status).toBe(422);
    const ok = await call('POST', `/api/handover/${token}/request-revision`, { body: { reason: 'Laptop có vết xước ở góc trái màn hình.' } });
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

    const login = await call('POST', '/api/admin/login', { body: { password: ADMIN_PASSWORD }, ip: '10.1.1.1' });
    const setCookie = login.res.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/^__Host-dta_admin=/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(setCookie).toContain(attr);
    const cookie = setCookie.split(';')[0]!;
    expect((await call('GET', '/api/admin/me', { cookie })).json.data.authenticated).toBe(true);

    const created = await call('POST', '/api/handover', { body: handoverInput({ receiverEmployeeId: 'DEMO-104' }), ip: '10.0.0.3' });
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
    expect((await call('GET', '/api/admin/handovers/not-a-uuid', { cookie })).status).toBe(404);

    const update = await call('PUT', `/api/admin/handovers/${id}`, {
      cookie,
      body: handoverInput({ receiverEmployeeId: 'DEMO-104', items: [itemInput({ condition: 'Trầy xước nhẹ' })] }),
    });
    expect(update.status).toBe(200);
    expect(update.json.data).toMatchObject({ linkRotated: false, handover: { status: 'PENDING', link: originalLink } });
    expect(update.json.data.handover.items).toHaveLength(1);

    const rotate = await call('PUT', `/api/admin/handovers/${id}`, { cookie, body: handoverInput({ receiverEmployeeId: 'DEMO-105' }) });
    expect(rotate.json.data.linkRotated).toBe(true);
    const rotatedLink = rotate.json.data.handover.link as string;
    expect(rotatedLink).not.toBe(originalLink);
    expect((await call('GET', `/api/handover/${tokenOf(originalLink)}`)).status).toBe(404);
    expect((await call('GET', `/api/handover/${tokenOf(rotatedLink)}`)).json.data.handover.receiver.name).toBe('Võ Minh Quân');

    const regen = await call('POST', `/api/admin/handovers/${id}/regenerate-link`, { cookie, body: {} });
    expect(regen.status).toBe(200);
    expect((await call('GET', `/api/handover/${tokenOf(rotatedLink)}`)).status).toBe(404);
    expect((await call('GET', `/api/handover/${tokenOf(regen.json.data.link)}`)).status).toBe(200);

    const cancel = await call('POST', `/api/admin/handovers/${id}/cancel`, { cookie, body: { reason: 'Tạo nhầm' } });
    expect(cancel.json.data.handover).toMatchObject({ status: 'CANCELLED', link: null });
    const confirmCancelled = await call('POST', `/api/handover/${tokenOf(regen.json.data.link)}/confirm`, {
      body: { agreed: true, signature: signature() },
      ip: '10.0.0.4',
    });
    expect(confirmCancelled.status).toBe(409);

    expect((await call('POST', '/api/admin/cache/refresh', { cookie, body: {} })).json.data.employees).toBeGreaterThan(0);

    const logout = await call('POST', '/api/admin/logout', { cookie, body: {} });
    expect(logout.res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('admin: xem chữ ký & tải PDF qua Worker (Drive private)', async () => {
    const cookie = await adminCookie();
    const list = await call('GET', '/api/admin/handovers?status=CONFIRMED', { cookie });
    const id = list.json.data.items[0].id;
    const sig = await call('GET', `/api/admin/handovers/${id}/signature`, { cookie });
    expect(sig.res.headers.get('Content-Type')).toBe('image/png');
    expect(sig.buffer.subarray(1, 4).toString()).toBe('PNG');
    const pdf = await call('GET', `/api/admin/handovers/${id}/pdf`, { cookie });
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call('POST', `/api/admin/handovers/${id}/pdf`, { cookie, body: {} })).json.data.pdfAvailable).toBe(true);
    expect((await call('GET', `/api/admin/handovers/${id}/signature`)).status).toBe(401);
  });

  it('HTTP status & bảo vệ: 400 / 403 / 404 / 405 / 429', async () => {
    const notJson = await call('POST', '/api/handover', { rawBody: 'a=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(notJson.status).toBe(400);
    const badJson = await call('POST', '/api/handover', { rawBody: '{oops' });
    expect(badJson.status).toBe(400);
    const csrf = await call('POST', '/api/handover', { body: handoverInput(), origin: 'https://evil.example' });
    expect(csrf.status).toBe(403);
    const unknown = await call('GET', '/api/khong-ton-tai');
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const wrongMethod = await call('DELETE', '/api/handover');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.res.headers.get('Allow')).toBe('POST');

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('POST', '/api/admin/login', { body: { password: 'x' }, ip: '10.66.66.66' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('lỗi Apps Script / Sheet / cấu hình → mã lỗi đúng, thông báo thân thiện', async () => {
    invalidateCached(); // health / danh mục được cache ngắn hạn trong isolate
    const wrongSecret = await call('GET', '/api/categories', { envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.1' });
    expect(wrongSecret.status).toBe(502);
    expect(wrongSecret.json.error.code).toBe('UPSTREAM_AUTH_FAILED');
    const healthWrong = await call('GET', '/api/health', { envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.2' });
    expect(healthWrong.status).toBe(503);
    expect(healthWrong.json.data.appsScript).toBe('error');

    const created = await call('POST', '/api/handover', { body: handoverInput(), envOverride: { GAS_SHARED_SECRET: 'sai' }, ip: '10.2.0.3' });
    expect(created.status).toBe(502);
    expect(created.json.error.code).toBe('UPSTREAM_AUTH_FAILED');

    await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/fault'), { method: 'POST', body: JSON.stringify({ target: 'html', count: 1 }) });
    const html = await call('POST', '/api/handover', { body: handoverInput(), ip: '10.2.0.4' });
    expect(html.status).toBe(502);
    expect(html.json.error.code).toBe('UPSTREAM_ERROR');

    await fetch(emulator.url.replace(/\/macros.*/, '/__emulator/fault'), { method: 'POST', body: JSON.stringify({ target: 'sheets', count: 1 }) });
    const sheetFail = await call('POST', '/api/handover', { body: handoverInput(), ip: '10.2.0.5' });
    expect(sheetFail.status).toBe(500);
    expect(sheetFail.json.error.message).not.toMatch(/Service Spreadsheets|stack/i);

    const notConfigured = await call('POST', '/api/handover', { body: handoverInput(), envOverride: { GAS_WEB_APP_URL: '' }, ip: '10.2.0.6' });
    expect(notConfigured.status).toBe(503);
    expect(notConfigured.json.error.code).toBe('NOT_CONFIGURED');

    const badHost = await call('POST', '/api/handover', { body: handoverInput(), envOverride: { GAS_WEB_APP_URL: 'https://evil.example/exec' }, ip: '10.2.0.7' });
    expect(badHost.status).toBe(503);
  });

  it('mã truy cập nội bộ (STAFF_ACCESS_CODE) khi được cấu hình', async () => {
    const envOverride = { STAFF_ACCESS_CODE: 'DTA-2026' };
    const blocked = await call('GET', '/api/employees', { envOverride, ip: '10.3.0.1' });
    expect(blocked.status).toBe(401);
    expect(blocked.json.error.code).toBe('STAFF_AUTH_REQUIRED');
    expect((await call('GET', '/api/staff/session', { envOverride })).json.data).toEqual({ required: true, authenticated: false });
    expect((await call('POST', '/api/staff/login', { body: { code: 'sai' }, envOverride, ip: '10.3.0.2' })).status).toBe(401);
    const login = await call('POST', '/api/staff/login', { body: { code: 'DTA-2026' }, envOverride, ip: '10.3.0.2' });
    const cookie = login.res.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await call('GET', '/api/employees', { envOverride, cookie, ip: '10.3.0.1' })).status).toBe(200);
    // Link xác nhận của người nhận không yêu cầu mã truy cập
    const created = await call('POST', '/api/handover', { body: handoverInput(), envOverride, cookie, ip: '10.3.0.3' });
    expect(created.status).toBe(201);
    expect((await call('GET', `/api/handover/${tokenOf(created.json.data.link)}`, { envOverride })).status).toBe(200);
  });

  it('đường dẫn không phải /api/* do static assets phục vụ', async () => {
    const page = await call('GET', '/xac-nhan/test');
    expect(page.status).toBe(200);
    expect(page.buffer.toString()).toContain('SPA');
  });
});
