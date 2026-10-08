import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PASSWORD,
  BASE,
  drawWithMouse,
  drawWithTouch,
  EMULATOR_STATE_URL,
  enterOtp,
  horizontalOverflow,
  launchBrowser,
  screenshot,
  STAFF_CODE,
} from './browser';

/**
 * E2E trên runtime thật: Chrome ⇄ Worker production build (workerd) ⇄ Apps Script giả lập
 * (đã nạp định mức + tồn đầu kỳ văn phòng phẩm, bật mã truy cập nội bộ cho trang đề xuất).
 */

let browser: Browser;
/** Trình duyệt của quản trị viên (đăng nhập một lần, cookie dùng chung cho các test quản trị). */
let admin: BrowserContext;
const created: Array<{ code: string; link: string }> = [];
let supply: { code: string; link: string };
let proposalCode = '';
let adminStorage: Awaited<ReturnType<BrowserContext['storageState']>>;

const PEN = 'Bút bi Thiên Long 027, xanh';

beforeAll(async () => {
  browser = await launchBrowser();
  // Múi giờ máy khác Việt Nam: giao diện vẫn phải hiện giờ Việt Nam.
  admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'America/New_York' });
  await admin.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
});

afterAll(async () => {
  await browser?.close();
});

function mobileContext() {
  return browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'vi-VN',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
}

async function pickEmployee(page: Page, inputId: string, query: string, name: string) {
  const input = page.locator(`#${inputId}`);
  await input.fill(query);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
}

/** Tạo phiếu qua giao diện quản trị: chọn loại → người giao / nhận → nội dung → TẠO PHIẾU → lấy link. */
async function createHandoverViaUi(page: Page, opts: { type: 'OTHER' | 'ASSET'; receiverQuery: string; receiverName: string }) {
  await page.goto(`${BASE}/admin/ban-giao/tao-moi`);
  await page.getByRole('heading', { name: 'Tạo phiếu bàn giao' }).waitFor();
  await page.getByRole('button', { name: opts.type === 'OTHER' ? /^Khác/ : /^Thiết bị \/ tài sản/ }).click();
  await page.locator('#sender-name').waitFor();
  expect(page.url()).toContain(`loai=${opts.type}`);

  await pickEmployee(page, 'sender-name', 'nguyen van an', 'Nguyễn Văn An'); // tìm không dấu
  const receiver = page.locator('#receiver');
  await receiver.fill(opts.receiverQuery);
  await page.getByRole('option', { name: new RegExp(opts.receiverName) }).first().waitFor();
  await receiver.press('Enter');
  await page.getByText(opts.receiverName, { exact: true }).first().waitFor();

  const item1 = page.getByRole('region', { name: 'Nội dung số 1', exact: true });
  await item1.getByLabel('Tên thiết bị').fill('Laptop Dell Latitude 5440');
  await item1.getByLabel('Mã tài sản').fill('TS-0001');
  await item1.getByLabel('Serial').fill('5CG1234XYZ');
  await item1.getByLabel('Tình trạng').fill('Tốt');

  if (opts.type === 'OTHER') {
    // Phiếu "Khác": nhiều loại nội dung — thêm Thẻ rồi đưa lên đầu, thêm Công việc.
    await page.getByRole('button', { name: 'THÊM NỘI DUNG' }).click();
    const item2 = page.getByRole('region', { name: 'Nội dung số 2', exact: true });
    await item2.getByLabel('Loại bàn giao').selectOption({ label: 'Thẻ' });
    await item2.getByLabel('Loại thẻ').fill('Thẻ thang máy');
    await item2.getByLabel('Mã thẻ').fill('TM-09');
    await page.getByRole('button', { name: 'Di chuyển nội dung 2 lên trên' }).click();
    expect(await page.getByRole('region', { name: 'Nội dung số 1', exact: true }).getByLabel('Loại thẻ').inputValue()).toBe('Thẻ thang máy');

    await page.getByRole('button', { name: 'THÊM NỘI DUNG' }).click();
    const item3 = page.getByRole('region', { name: 'Nội dung số 3', exact: true });
    await item3.getByLabel('Loại bàn giao').selectOption({ label: 'Công việc' });
    await item3.getByLabel('Tên công việc').fill('Bảo trì website');
    await item3.getByLabel('Deadline').fill('2026-10-15');
    await item3.getByLabel('Link tài liệu').fill('https://example.com/tai-lieu');
  } else {
    // Phiếu tài sản chỉ cho chọn loại nội dung thuộc tài sản.
    const options = await page.getByRole('region', { name: 'Nội dung số 1', exact: true }).getByLabel('Loại bàn giao').locator('option').allTextContents();
    expect(options).toContain('Thẻ');
    expect(options).not.toContain('Công việc');
    expect(options).not.toContain('Văn phòng phẩm');
  }

  await page.locator('#handover-note').fill('Bàn giao khi chuyển công tác.');
  await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
  await page.getByRole('heading', { name: 'ĐÃ TẠO BIÊN BẢN' }).waitFor({ timeout: 30_000 });
  const link = await page.getByRole('textbox', { name: 'Link xác nhận' }).inputValue();
  const code = (await page.locator('dd.font-mono').first().textContent())!.trim();
  return { code, link };
}

/** Số tồn của một sản phẩm trên trang Tồn kho (bảng desktop). */
async function stockRow(page: Page, productName: string) {
  await page.goto(`${BASE}/admin/vpp/ton-kho`);
  await page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).fill(productName);
  const row = page.getByRole('row').filter({ hasText: productName }).first();
  await row.waitFor();
  const cells = await row.getByRole('cell').allTextContents();
  // [Sản phẩm, Tồn, Giữ chỗ, Khả dụng, Tối thiểu, Trạng thái, Đơn giá, Thao tác]
  return { row, onHand: cells[1]!.trim(), reserved: cells[2]!.trim(), available: cells[3]!.trim(), status: cells[5]!.trim() };
}

async function signOnDesktop(page: Page, link: string, code: string) {
  await page.goto(link);
  await page.getByRole('heading', { name: code }).waitFor();
  await page.getByLabel('Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.').check();
  await enterOtp(page, code); // người nhận có email → bắt buộc mã xác nhận
  const canvas = page.locator('canvas[aria-label^="Khung ký tên"]');
  await canvas.scrollIntoViewIfNeeded();
  await drawWithMouse(page, canvas);
  await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
  await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor({ timeout: 30_000 });
}

describe('Runtime Cloudflare (workerd) — static assets, deep link, API', () => {
  it('mọi route SPA refresh trực tiếp không 404, có security headers; /api/* trả JSON', async () => {
    const routes = [
      '/',
      '/admin',
      '/admin/ban-giao',
      '/admin/ban-giao/tao-moi',
      '/admin/ban-giao/khong-co',
      '/admin/vpp',
      '/admin/vpp/ton-kho',
      '/admin/vpp/dinh-muc',
      '/admin/vpp/de-xuat',
      '/admin/vpp/lich-su',
      '/admin/vpp/data-review',
      '/admin/nhan-vien',
      '/admin/cai-dat',
      '/de-xuat-vpp',
      '/xac-nhan/test',
      '/tao-ban-giao',
    ];
    for (const route of routes) {
      const res = await fetch(BASE + route);
      expect(res.status, route).toBe(200);
      expect(await res.text(), route).toContain('<div id="root"></div>');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
    const health = await fetch(`${BASE}/api/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).data).toMatchObject({ cloudflare: 'ok', appsScript: 'ok', database: 'ok', drive: 'ok' });
    const missing = await fetch(`${BASE}/api/khong-co`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });

  it('[QUYỀN] public không tạo phiếu / không xem kho / không chỉnh kho — kể cả gọi API trực tiếp', async () => {
    const headers = { 'Content-Type': 'application/json', Origin: BASE };
    const body = JSON.stringify({ handoverType: 'OTHER', receiverEmployeeId: 'DEMO-519', items: [] });
    expect((await fetch(`${BASE}/api/admin/handovers`, { method: 'POST', headers, body })).status).toBe(401);
    expect([404, 405]).toContain((await fetch(`${BASE}/api/handovers`, { method: 'POST', headers, body })).status);
    expect((await fetch(`${BASE}/api/admin/vpp/stock`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/admin/vpp/stock/adjust`, { method: 'POST', headers, body: '{}' })).status).toBe(401);
    expect((await fetch(`${BASE}/api/admin/vpp/proposals/00000000-0000-4000-8000-000000000000/approve`, { method: 'POST', headers, body: '{}' })).status).toBe(401);
    // Danh mục công khai cần mã truy cập nội bộ (STAFF_ACCESS_CODE)
    expect((await fetch(`${BASE}/api/public/vpp/catalog`)).status).toBe(401);
  });

  it('trang chủ không còn form tạo phiếu; link cũ /tao-ban-giao chuyển vào khu quản trị', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole('heading', { name: 'Hệ thống bàn giao nội bộ' }).waitFor();
    expect(await page.locator('#receiver').count()).toBe(0);
    await page.getByRole('link', { name: /Đề xuất văn phòng phẩm/ }).waitFor();
    await page.goto(`${BASE}/tao-ban-giao`);
    await page.waitForURL(/\/admin\/ban-giao\/tao-moi$/);
    await page.getByRole('heading', { name: 'Đăng nhập quản trị' }).waitFor();
    await page.close();
  });
});

describe('Quản trị — đăng nhập & tạo phiếu (desktop 1440px)', () => {
  it('đăng nhập sai / đúng → Tổng quan; cookie HttpOnly, không lưu localStorage', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByLabel('Mật khẩu').fill('mat-khau-sai');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.getByText('Mật khẩu không đúng.').waitFor();
    await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.getByRole('heading', { name: 'Tổng quan', level: 1 }).waitFor();
    await page.getByText('Cảnh báo văn phòng phẩm').waitFor();
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe('{}');
    // Sidebar đúng cấu trúc
    const nav = page.getByRole('navigation', { name: 'Quản trị' });
    for (const label of ['Danh sách', 'Tạo phiếu', 'Tồn kho', 'Định mức', 'Đề xuất mua', 'Lịch sử kho', 'Dữ liệu cần kiểm tra', 'Nhân viên', 'Cài đặt']) {
      await nav.getByRole('link', { name: label }).first().waitFor();
    }
    await screenshot(page, 'admin-overview-1440');
    adminStorage = await admin.storageState();
    await page.close();
  });

  it('báo lỗi khi form thiếu trường', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/ban-giao/tao-moi?loai=ASSET`);
    await page.locator('#receiver').waitFor();
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByText('Chọn người nhận từ danh sách nhân viên').first().waitFor();
    await page.getByText('Tên thiết bị là bắt buộc').waitFor();
    await page.getByText(/Vui lòng kiểm tra lại \d+ mục/).waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('sender-name');
    await page.close();
  });

  it('tạo phiếu "Khác" nhiều nội dung, sao chép link (toast), QR; tạo thêm 2 phiếu tài sản', async () => {
    const page = await admin.newPage();
    const first = await createHandoverViaUi(page, { type: 'OTHER', receiverQuery: 'Pham Danh Thai', receiverName: 'Phạm Danh Thái' });
    expect(first.code).toMatch(/^BG-\d{8}-\d{4}$/);
    expect(first.link).toMatch(new RegExp(`^${BASE}/xac-nhan/[A-Za-z0-9_-]{43}$`));
    await page.getByRole('img', { name: /Mã QR/ }).waitFor();
    await page.getByText(/phải nhập mã xác nhận gửi tới thai\.pham@example\.com/).waitFor(); // báo trước cho người lập phiếu
    await page.getByRole('button', { name: 'SAO CHÉP LINK' }).click();
    await page.getByText('Đã sao chép link xác nhận.').waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.link);
    await screenshot(page, 'create-success-1440');
    await page.getByRole('button', { name: 'TẠO PHIẾU MỚI' }).click();
    await page.getByRole('heading', { name: 'Bước 1 — Chọn loại phiếu bàn giao' }).waitFor();
    created.push(first);
    created.push(await createHandoverViaUi(page, { type: 'ASSET', receiverQuery: 'do thi huong', receiverName: 'Đỗ Thị Hương' }));
    created.push(await createHandoverViaUi(page, { type: 'ASSET', receiverQuery: 'DEMO-103', receiverName: 'Lê Hoàng Đức' }));
    await page.close();
  });
});

describe('Văn phòng phẩm — kho & phiếu bàn giao', () => {
  it('nhập kho thủ công qua giao diện; tìm "but bi" không dấu', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/vpp/ton-kho`);
    await page.getByRole('heading', { name: 'Tồn kho văn phòng phẩm' }).waitFor();
    await page.getByRole('searchbox', { name: 'Tìm sản phẩm' }).fill('but bi');
    const row = page.getByRole('row').filter({ hasText: PEN });
    await row.waitFor();
    await row.getByRole('button', { name: 'Nhập' }).click();
    const dialog = page.getByRole('dialog', { name: `Nhập kho: ${PEN}` });
    await dialog.locator('#stockin-qty').fill('10');
    await dialog.getByRole('button', { name: 'Nhập kho' }).click();
    await page.getByText(`Đã nhập kho ${PEN}. Tồn mới: 10.`).waitFor();
    const stock = await stockRow(page, PEN);
    expect(stock).toMatchObject({ onHand: '10', reserved: '0', available: '10' });
    await page.close();
  });

  it('tạo phiếu VPP: chọn người nhận → định mức phòng ban, chọn sản phẩm, giữ chỗ trong kho', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/ban-giao/tao-moi`);
    await page.getByRole('button', { name: /^Văn phòng phẩm/ }).click();
    await page.locator('#receiver').waitFor();
    await pickEmployee(page, 'sender-name', 'do thi huong', 'Đỗ Thị Hương');
    await pickEmployee(page, 'receiver', 'DEMO-103', 'Lê Hoàng Đức');
    await page.getByText(/Định mức áp dụng:/).waitFor();
    await page.getByRole('searchbox', { name: 'Tìm văn phòng phẩm' }).fill('but bi');
    const candidate = page.getByRole('listitem').filter({ hasText: PEN }).filter({ has: page.getByRole('button', { name: 'Thêm' }) });
    await candidate.getByText(/Khả dụng/).waitFor();
    await candidate.getByRole('button', { name: 'Thêm' }).click();
    await page.getByRole('button', { name: `Tăng số lượng ${PEN}` }).click(); // 1 → 2
    expect(await page.getByRole('spinbutton', { name: `số lượng ${PEN}` }).inputValue()).toBe('2');
    await page.getByText(/Định mức tháng:/).waitFor();
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByRole('heading', { name: 'ĐÃ TẠO BIÊN BẢN' }).waitFor({ timeout: 30_000 });
    supply = {
      link: await page.getByRole('textbox', { name: 'Link xác nhận' }).inputValue(),
      code: (await page.locator('dd.font-mono').first().textContent())!.trim(),
    };
    await page.getByText('Văn phòng phẩm', { exact: true }).first().waitFor();

    const stock = await stockRow(page, PEN);
    expect(stock).toMatchObject({ onHand: '10', reserved: '2', available: '8' });

    // Không đủ tồn: hiện Khả dụng / Yêu cầu / Thiếu + lối tắt tạo đề xuất mua
    await page.goto(`${BASE}/admin/ban-giao/tao-moi?loai=OFFICE_SUPPLY`);
    await pickEmployee(page, 'sender-name', 'do thi huong', 'Đỗ Thị Hương');
    await pickEmployee(page, 'receiver', 'DEMO-103', 'Lê Hoàng Đức');
    await page.getByRole('searchbox', { name: 'Tìm văn phòng phẩm' }).fill('but bi');
    await page.getByRole('listitem').filter({ hasText: PEN }).getByRole('button', { name: 'Thêm' }).click();
    await page.getByRole('spinbutton', { name: `số lượng ${PEN}` }).fill('9');
    await page.getByText('Không đủ tồn kho.').waitFor();
    await page.getByText('Khả dụng: 8 · Yêu cầu: 9 · Thiếu: 1').waitFor();
    expect(await page.getByRole('link', { name: 'TẠO ĐỀ XUẤT MUA', exact: true }).getAttribute('href')).toContain('/de-xuat-vpp?sp=');
    await screenshot(page, 'vpp-insufficient-1440');
    await page.close();
  });
});

describe('Người nhận xác nhận', () => {
  it('ký bằng cảm ứng trên điện thoại 375px — trang không cuộn khi ký; xác nhận lần 2 bị chặn; tải PDF', async () => {
    const mobile = await mobileContext();
    const page = await mobile.newPage();
    const { code, link } = created[0]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByText('Laptop Dell Latitude 5440').waitFor();
    await page.getByText('Thẻ thang máy').waitFor();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByText('Vui lòng tích ô xác nhận đã kiểm tra và nhận đủ các nội dung.').waitFor();
    await page.getByText('Bấm “Gửi mã xác nhận” rồi nhập mã nhận được qua email.').waitFor();
    await page.getByText('Vui lòng ký tên vào khung bên dưới.').waitFor();

    await page.getByLabel('Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.').check();
    await page.getByText(/mã 6 số tới email t\*\*\*@example\.com/).waitFor(); // email đã che, không lộ đầy đủ
    await enterOtp(page, code);
    await screenshot(page, 'confirm-otp-375');
    const canvas = page.locator('canvas[aria-label^="Khung ký tên"]');
    await canvas.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await drawWithTouch(page, canvas);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await screenshot(page, 'confirm-signed-375');

    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor({ timeout: 30_000 });
    await screenshot(page, 'confirm-done-375');

    await page.reload();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor();
    expect(await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).count()).toBe(0);

    // Gọi lại API xác nhận → bị chặn (409 đã xác nhận / 422 thiếu dữ liệu)
    const token = link.split('/xac-nhan/')[1]!;
    const again = await page.evaluate(async (t) => {
      const res = await fetch(`/api/handover/${t}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreed: true, signature: 'data:image/png;base64,iVBORw0KGgo=' }),
      });
      return res.status;
    }, token);
    expect([409, 422]).toContain(again);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Tải PDF/ }).click()]);
    expect(download.suggestedFilename()).toBe(`${code}.pdf`);
    await mobile.close();
  });

  it('ký bằng chuột trên desktop (xóa chữ ký, ký lại); nhập sai mã OTP → báo lỗi, nhập đúng → ký được', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const { code, link } = created[1]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByLabel('Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.').check();
    const otp = await enterOtp(page, code, (real) => (real === '000000' ? '111111' : '000000')); // cố tình nhập sai
    await page.getByRole('button', { name: /^Gửi lại mã sau \d+ giây$/ }).waitFor(); // chống bấm gửi liên tục
    const canvas = page.locator('canvas[aria-label^="Khung ký tên"]');
    await canvas.scrollIntoViewIfNeeded();
    await drawWithMouse(page, canvas);
    await page.getByRole('button', { name: 'XÓA CHỮ KÝ' }).click();
    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByText('Vui lòng ký tên vào khung bên dưới.').waitFor();
    await drawWithMouse(page, canvas);
    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByText('Mã không đúng — còn 4 lần thử').waitFor();
    await page.getByLabel('Mã xác nhận 6 số').fill(otp);
    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor({ timeout: 30_000 });
    await context.close();
  });

  it('yêu cầu chỉnh sửa bắt buộc nhập lý do; trang báo quản trị viên sẽ cập nhật', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const { code, link } = created[2]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByRole('button', { name: 'Yêu cầu chỉnh sửa', exact: true }).click();
    await page.getByRole('button', { name: 'YÊU CẦU CHỈNH SỬA', exact: true }).click();
    await page.getByText(/Vui lòng nhập lý do/).first().waitFor();
    await page.getByLabel('Lý do / nội dung cần sửa').fill('Laptop có vết xước ở góc trái màn hình.');
    await page.getByRole('button', { name: 'YÊU CẦU CHỈNH SỬA', exact: true }).click();
    await page.getByRole('heading', { name: 'ĐÃ GỬI YÊU CẦU CHỈNH SỬA' }).waitFor();
    await page.getByText(/Quản trị viên sẽ cập nhật biên bản/).waitFor();
    await context.close();
  });

  it('ký phiếu văn phòng phẩm → xuất kho (tồn giảm, hết giữ chỗ)', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(supply.link);
    await page.getByText(PEN).waitFor();
    await page.getByText('SL: 2 Cây').waitFor();
    await signOnDesktop(page, supply.link, supply.code);
    await context.close();

    const adminPage = await admin.newPage();
    const stock = await stockRow(adminPage, PEN);
    expect(stock).toMatchObject({ onHand: '8', reserved: '0', available: '8' });
    await adminPage.goto(`${BASE}/admin/vpp/lich-su`);
    await adminPage.getByRole('heading', { name: 'Lịch sử kho' }).waitFor();
    const outRow = adminPage.getByRole('row').filter({ hasText: 'Xuất kho' }).first();
    await outRow.waitFor();
    expect(await outRow.textContent()).toContain(supply.code);
    await adminPage.close();
  });
});

describe('Quản trị — danh sách, chi tiết, sửa', () => {
  it('thống kê, lọc trạng thái + loại phiếu, chi tiết (chữ ký thật, toàn vẹn), tải PDF, refresh giữ bộ lọc', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/ban-giao`);
    await page.getByRole('heading', { name: 'Biên bản bàn giao' }).waitFor();
    const total = page.getByRole('button', { name: /Tổng số biên bản/ });
    await page.waitForFunction(() => /\d/.test(document.querySelector('[aria-label="Thống kê"] button span:last-child')?.textContent ?? ''));
    expect(await total.textContent()).toContain('4');

    await page.getByLabel('Trạng thái').selectOption('CONFIRMED');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await page.waitForURL(/status=CONFIRMED/);
    await page.getByText('3 biên bản').waitFor();
    await page.getByLabel('Loại phiếu').selectOption('OFFICE_SUPPLY');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await page.waitForURL(/handoverType=OFFICE_SUPPLY/);
    await page.getByText('1 biên bản').waitFor();
    await screenshot(page, 'admin-list-1440');
    await page.reload();
    await page.getByText('1 biên bản').waitFor();

    await page.goto(`${BASE}/admin/ban-giao?status=CONFIRMED`);
    const firstCode = created[0]!.code;
    await page.getByRole('link', { name: firstCode }).click();
    await page.getByRole('heading', { name: firstCode }).waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('img[alt^="Chữ ký của"]');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });
    const inkPixels = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('img[alt^="Chữ ký của"]')!;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) dark++;
      return { dark, width: img.naturalWidth, height: img.naturalHeight };
    });
    expect(inkPixels.dark).toBeGreaterThan(200);
    expect(inkPixels.width).toBeLessThanOrEqual(600);
    expect(inkPixels.height).toBeLessThanOrEqual(300);
    // Toàn vẹn: nội dung + toàn biên bản (ý kiến, thời điểm, chữ ký) + niêm phong (RECORD_SEAL_SECRET của Worker) đều khớp.
    await page.getByText('Dữ liệu hiện tại khớp với bản người nhận đã ký.').waitFor();
    await page.getByText('Nội dung bàn giao: khớp.').waitFor();
    await page.getByText('Ý kiến người nhận, thời điểm lập / ký, chữ ký: khớp.').waitFor();
    await page.getByText('Niêm phong: khớp.').waitFor();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải PDF' }).click()]);
    expect(download.suggestedFilename()).toBe(`${firstCode}.pdf`);
    await page.getByText('Người nhận xác nhận').waitFor(); // lịch sử
    await page.getByText(/Tạo lúc .* bởi Quản trị viên/).waitFor(); // người lập phiếu
    await screenshot(page, 'admin-detail-1440');
    await page.reload();
    await page.getByRole('heading', { name: firstCode }).waitFor();
    await page.close();
  });

  it('sửa phiếu đang "Yêu cầu chỉnh sửa" → trở lại "Chờ xác nhận"; copy link cũ', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/ban-giao?status=REVISION_REQUESTED`);
    const code = created[2]!.code;
    await page.getByRole('link', { name: code }).click();
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByText('Laptop có vết xước ở góc trái màn hình.').first().waitFor();
    await page.getByRole('link', { name: 'Sửa biên bản' }).click();
    await page.getByRole('heading', { name: /Sửa biên bản/ }).waitFor();
    const item = page.getByRole('region', { name: /^Nội dung số \d+$/ }).filter({ has: page.getByLabel('Tên thiết bị') }).first();
    await item.getByLabel('Tình trạng').fill('Trầy xước góc trái màn hình');
    await page.getByRole('button', { name: 'LƯU THAY ĐỔI' }).click();
    await page.getByText(/Đã lưu\. Người nhận mở lại link cũ/).waitFor();
    await page.getByRole('heading', { name: code }).waitFor();
    await page.locator('span', { hasText: 'Chờ xác nhận' }).first().waitFor();
    await page.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(created[2]!.link);
    await page.close();
  });
});

describe('Đề xuất mua văn phòng phẩm', () => {
  it('nhân viên (điện thoại 375px): mã truy cập → mã NV → định mức phòng → vượt định mức + ngoài định mức → gửi', async () => {
    const mobile = await mobileContext();
    const page = await mobile.newPage();
    await page.goto(`${BASE}/de-xuat-vpp`);
    if (STAFF_CODE) {
      await page.getByLabel('Mã truy cập').fill(STAFF_CODE);
      await page.getByRole('button', { name: 'Tiếp tục' }).click();
    }
    await page.getByLabel('Mã nhân viên').fill('KHONG-CO');
    await page.getByRole('button', { name: 'TIẾP TỤC' }).click();
    await page.getByText(/Không tìm thấy nhân viên/).waitFor();
    await page.getByLabel('Mã nhân viên').fill('DEMO-103');
    await page.getByRole('button', { name: 'TIẾP TỤC' }).click();
    await page.getByText('Lê Hoàng Đức').waitFor();
    await page.getByRole('heading', { name: /Định mức — PHÒNG KINH DOANH/ }).waitFor();

    await page.getByRole('checkbox', { name: /Giấy A4 Excel 80 gsm/ }).check();
    await page.getByRole('button', { name: 'Tăng số lượng Giấy A4 Excel 80 gsm' }).click(); // vượt định mức 1
    await page.getByText(/VƯỢT ĐỊNH MỨC 1/).waitFor();
    await page.getByRole('button', { name: 'GỬI ĐỀ XUẤT' }).click();
    await page.getByText(/^Vượt định mức \(\d+ .*\/tháng\) — nhập lý do$/).waitFor(); // bắt buộc lý do
    await page.getByLabel('Lý do vượt định mức').fill('Tháng này in hợp đồng nhiều.');

    await page.getByRole('button', { name: /THÊM SẢN PHẨM NGOÀI ĐỊNH MỨC/ }).click();
    await page.getByLabel('Tên sản phẩm').fill('Bìa còng 7cm');
    await page.getByLabel('ĐVT', { exact: true }).fill('Cái');
    await page.getByRole('button', { name: 'Tăng số lượng sản phẩm ngoài định mức 1' }).click(); // 2
    await page.getByLabel('Lý do cần mua').fill('Lưu hồ sơ khách hàng.');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await screenshot(page, 'proposal-form-375');

    await page.getByRole('button', { name: 'GỬI ĐỀ XUẤT' }).click();
    await page.getByRole('heading', { name: 'ĐÃ GỬI ĐỀ XUẤT' }).waitFor({ timeout: 30_000 });
    proposalCode = (await page.locator('dd.font-mono').first().textContent())!.trim();
    expect(proposalCode).toMatch(/^DX-/);
    await screenshot(page, 'proposal-done-375');
    await mobile.close();
  });

  it('quản trị: thêm sản phẩm mới vào danh mục → duyệt → đã mua → nhận hàng (nhập kho)', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/vpp/de-xuat?status=SUBMITTED`);
    await page.getByRole('heading', { name: 'Đề xuất mua văn phòng phẩm' }).waitFor();
    await page.getByRole('link', { name: new RegExp(proposalCode) }).click();
    await page.getByRole('heading', { name: proposalCode }).waitFor();
    await page.getByText(/Vượt định mức 1/).first().waitFor();

    await page.getByRole('button', { name: 'Xử lý sản phẩm mới' }).click();
    const decision = page.getByRole('dialog', { name: /Sản phẩm mới: Bìa còng 7cm/ });
    expect(await decision.getByLabel('ĐVT').inputValue()).toBe('Cái');
    await decision.getByRole('button', { name: 'Lưu quyết định' }).click();
    await page.getByText('Đã lưu quyết định cho sản phẩm.').waitFor();
    await page.getByText('Đã thêm vào danh mục').waitFor();

    await page.getByRole('button', { name: 'DUYỆT ĐỀ XUẤT' }).click();
    await page.getByText(/Đã duyệt:/).waitFor();
    await page.getByRole('button', { name: 'Đánh dấu đã mua' }).click();
    await page.getByRole('dialog', { name: 'Đánh dấu đã mua hàng?' }).getByRole('button', { name: 'Đã mua' }).click();
    await page.getByText('Đã đánh dấu đã mua.').waitFor();

    await page.getByRole('button', { name: 'Nhận hàng & nhập kho' }).click();
    const receive = page.getByRole('dialog', { name: new RegExp(`Nhận hàng: ${proposalCode}`) });
    await receive.getByRole('button', { name: 'Nhập kho' }).click();
    await page.getByText('Đã nhận hàng và nhập kho.').waitFor();
    await page.getByText('Đã nhập kho', { exact: true }).first().waitFor();
    await screenshot(page, 'proposal-received-1440');

    const stock = await stockRow(page, 'Bìa còng 7cm');
    expect(stock.onHand).toBe('2');
    await page.close();
  });

  it('dữ liệu cần kiểm tra: giữ nguyên giá trị gốc ("hết năm"), có GHÉP / TẠO SẢN PHẨM MỚI / BỎ QUA', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin/vpp/data-review`);
    await page.getByRole('heading', { name: 'Dữ liệu cần kiểm tra' }).waitFor();
    await page.getByText(/“hết năm”/).first().waitFor();
    await page.getByRole('button', { name: 'GHÉP' }).first().waitFor();
    await page.getByRole('button', { name: 'TẠO SẢN PHẨM MỚI' }).first().waitFor();
    await page.getByRole('button', { name: 'BỎ QUA' }).first().waitFor();
    await screenshot(page, 'data-review-1440');
    await page.goto(`${BASE}/admin/vpp/dinh-muc`);
    await page.getByRole('tab', { name: 'PHÒNG KINH DOANH' }).waitFor();
    await page.getByRole('heading', { name: 'Phòng ban → phạm vi định mức' }).waitFor();
    await page.close();
  });
});

describe('Dữ liệu & đăng xuất', () => {
  it('dữ liệu thật đã ghi vào Sheet/Drive (giả lập)', async () => {
    if (!EMULATOR_STATE_URL) return;
    const state = await (await fetch(EMULATOR_STATE_URL)).json();
    expect(state.sheets.BAN_GIAO).toHaveLength(4);
    expect(state.sheets.VPP_DE_XUAT).toHaveLength(1);
    const sigs = state.files.filter((f: { path: string }) => f.path.startsWith('DTA_HANDOVER/signatures/'));
    expect(sigs).toHaveLength(3);
    expect(state.files.some((f: { path: string }) => /^DTA_HANDOVER\/pdf\/\d{4}\/\d{2}\/BG-.*\.pdf$/.test(f.path))).toBe(true);
    for (const row of state.sheets.BAN_GIAO) {
      expect(JSON.stringify(row)).not.toContain(created[0]!.link.split('/xac-nhan/')[1]);
    }
    const types = state.sheets.VPP_BIEN_DONG_KHO.map((m: { movement_type: string }) => m.movement_type);
    expect(types).toEqual(expect.arrayContaining(['INITIAL', 'IN', 'RESERVE', 'OUT']));
  });

  it('đăng xuất', async () => {
    const page = await admin.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByRole('heading', { name: 'Tổng quan', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
    await page.getByRole('heading', { name: 'Đăng nhập quản trị' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Đăng nhập quản trị' }).waitFor();
    await page.close();
  });
});

describe('Responsive — không tràn ngang', () => {
  const widths = [375, 390, 430, 768, 1024, 1440];
  it.each(widths)('%ipx: trang chủ, đề xuất VPP, ký xác nhận, quản trị', async (width) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: width < 768,
      hasTouch: width < 1024,
      deviceScaleFactor: 1,
      storageState: adminStorage,
    });
    const page = await context.newPage();
    const pending = created[2]!;
    const pages: Array<[string, string, string]> = [
      ['home', `${BASE}/`, 'text=Hệ thống bàn giao nội bộ'],
      ['proposal', `${BASE}/de-xuat-vpp`, 'form'],
      ['confirm', pending.link, 'canvas'],
      ['admin', `${BASE}/admin`, 'text=Cảnh báo văn phòng phẩm'],
      ['create', `${BASE}/admin/ban-giao/tao-moi`, 'text=Bước 1 — Chọn loại phiếu bàn giao'],
      ['stock', `${BASE}/admin/vpp/ton-kho`, 'text=Tồn kho văn phòng phẩm'],
      ['proposals', `${BASE}/admin/vpp/de-xuat`, 'text=Đề xuất mua văn phòng phẩm'],
    ];
    for (const [name, url, ready] of pages) {
      await page.goto(url);
      await page.locator(ready).first().waitFor();
      await page.waitForLoadState('networkidle');
      expect(await horizontalOverflow(page), `${name} @ ${width}px`).toBeLessThanOrEqual(0);
      await screenshot(page, `${name}-${width}`);
    }
    await context.close();
  });
});

describe('[RÀ SOÁT 3] Giao diện — số kiểu Việt Nam, hết phiên, mất phản hồi, rời trang', () => {
  /** Trình duyệt quản trị riêng (phiên đã lưu — cookie phiên không trạng thái nên vẫn dùng được sau test đăng xuất). */
  const adminPage = async () => (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', storageState: adminStorage })).newPage();

  async function fillOtherForm(page: Page, note: string) {
    await page.goto(`${BASE}/admin/ban-giao/tao-moi?loai=OTHER`);
    await page.locator('#sender-name').waitFor();
    await pickEmployee(page, 'sender-name', 'nguyen van an', 'Nguyễn Văn An');
    await pickEmployee(page, 'receiver', 'do thi huong', 'Đỗ Thị Hương');
    await page.getByRole('region', { name: 'Nội dung số 1', exact: true }).getByLabel('Tên thiết bị').fill('Màn hình Dell 24"');
    await page.locator('#handover-note').fill(note);
  }

  it('ô số gõ kiểu Việt Nam: nhập kho "1.000", đơn giá "15.000" → đúng 1000 / 15000 (trước đây thành 1 / 15)', async () => {
    const page = await adminPage();
    const before = Number((await stockRow(page, PEN)).onHand.replace(/\D/g, ''));
    const row = page.getByRole('row').filter({ hasText: PEN }).first();
    await row.getByRole('button', { name: 'Nhập', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Nhập kho: ${PEN}` });
    await dialog.locator('#stockin-qty').fill('1.000');
    await dialog.locator('#stockin-price').fill('15.000');
    const request = page.waitForRequest((r) => r.url().endsWith('/api/admin/vpp/stock/in'));
    await dialog.getByRole('button', { name: 'Nhập kho' }).click();
    expect(JSON.parse((await request).postData() ?? '{}')).toMatchObject({ quantity: 1000, unitPrice: 15000 });
    await page.getByText(`Đã nhập kho ${PEN}. Tồn mới:`).waitFor();
    expect(Number((await stockRow(page, PEN)).onHand.replace(/\D/g, ''))).toBe(before + 1000);
    await page.context().close();
  });

  it('nhập kho mất phản hồi (đã ghi): đóng hộp thoại → bảng tải lại; mở lại → nhắc, nhập lại đúng số → KHÔNG ghi 2 lần', async () => {
    const page = await adminPage();
    const before = Number((await stockRow(page, PEN)).onHand.replace(/\D/g, ''));
    let lost = true;
    await page.route('**/api/admin/vpp/stock/in', async (route) => {
      if (!lost) return route.continue();
      lost = false;
      await route.fetch(); // máy chủ ghi thật, trình duyệt không nhận được phản hồi
      return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'UPSTREAM_TIMEOUT', message: 'Máy chủ dữ liệu phản hồi quá lâu.' } }) });
    });
    const row = page.getByRole('row').filter({ hasText: PEN }).first();
    await row.getByRole('button', { name: 'Nhập', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: `Nhập kho: ${PEN}` });
    await dialog.locator('#stockin-qty').fill('7');
    await dialog.getByRole('button', { name: 'Nhập kho' }).click();
    await dialog.getByText('Máy chủ dữ liệu phản hồi quá lâu.').waitFor();
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect.poll(async () => Number((await row.getByRole('cell').nth(1).textContent())?.replace(/\D/g, ''))).toBe(before + 7);
    await row.getByRole('button', { name: 'Nhập', exact: true }).click();
    dialog = page.getByRole('dialog', { name: `Nhập kho: ${PEN}` });
    await dialog.getByText(/Lần nhập kho trước cho mục này bị lỗi kết nối/).waitFor();
    await dialog.locator('#stockin-qty').fill('7');
    await dialog.getByRole('button', { name: 'Nhập kho' }).click();
    await page.getByText(/ĐÃ được ghi ở lần gửi trước/).waitFor();
    expect(Number((await stockRow(page, PEN)).onHand.replace(/\D/g, ''))).toBe(before + 7);
    await page.context().close();
  });

  it('tạo phiếu mất phản hồi (đã lưu), sửa rồi gửi lại → báo phiếu đã tạo + link mở phiếu; chủ động tạo thêm → phiếu mới', async () => {
    const page = await adminPage();
    await fillOtherForm(page, 'Ghi chú lần 1');
    let savedCode = '';
    let lost = true;
    await page.route('**/api/admin/handovers', async (route) => {
      if (route.request().method() !== 'POST' || !lost) return route.continue();
      lost = false;
      savedCode = (await (await route.fetch()).json()).data.code;
      return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'UPSTREAM_TIMEOUT', message: 'Máy chủ dữ liệu phản hồi quá lâu.' } }) });
    });
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByText('Máy chủ dữ liệu phản hồi quá lâu.').waitFor();
    await page.locator('#handover-note').fill('Ghi chú đã sửa');
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByRole('link', { name: `Mở phiếu ${savedCode}` }).waitFor();
    await page.getByText(/Nội dung vừa sửa CHƯA được lưu/).waitFor();
    await page.getByRole('button', { name: 'Tạo thêm phiếu mới với nội dung đang nhập' }).click();
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByRole('heading', { name: 'ĐÃ TẠO BIÊN BẢN' }).waitFor({ timeout: 30_000 });
    const code = (await page.locator('dd.font-mono').first().textContent())!.trim();
    expect(code).toMatch(/^BG-\d{8}-\d{4}$/);
    expect(code).not.toBe(savedCode);
    await page.context().close();
  });

  it('phiên hết hạn lúc bấm TẠO PHIẾU → đăng nhập lại trong hộp thoại, nội dung còn nguyên, tạo được phiếu', async () => {
    const page = await adminPage();
    await fillOtherForm(page, 'Ghi chú dài gõ mất vài phút');
    await page.context().clearCookies(); // cookie phiên hết hạn
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    const reauth = page.getByRole('dialog', { name: 'Phiên đăng nhập đã hết hạn' });
    await reauth.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
    await reauth.getByRole('button', { name: 'Đăng nhập' }).click();
    await reauth.waitFor({ state: 'hidden' });
    expect(await page.locator('#handover-note').inputValue()).toBe('Ghi chú dài gõ mất vài phút');
    await page.getByRole('button', { name: 'TẠO PHIẾU', exact: true }).click();
    await page.getByRole('heading', { name: 'ĐÃ TẠO BIÊN BẢN' }).waitFor({ timeout: 30_000 });
    await page.context().close();
  });

  it('đang nhập form rồi bấm Back / link khác trong ứng dụng → hỏi xác nhận; Hủy → ở lại, nội dung còn', async () => {
    const page = await adminPage();
    const prompts: string[] = [];
    page.on('dialog', (d) => {
      prompts.push(d.message());
      void d.dismiss();
    });
    await page.goto(`${BASE}/admin`);
    await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Tạo phiếu' }).first().click();
    await page.getByRole('button', { name: /^Khác/ }).click();
    await page.locator('#handover-note').fill('Đang gõ dở');
    await page.goBack();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toContain('chưa được lưu');
    expect(page.url()).toContain('/admin/ban-giao/tao-moi');
    await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Tồn kho' }).first().click();
    await expect.poll(() => prompts.length).toBe(2);
    expect(await page.locator('#handover-note').inputValue()).toBe('Đang gõ dở');
    await page.context().close();
  });
});
