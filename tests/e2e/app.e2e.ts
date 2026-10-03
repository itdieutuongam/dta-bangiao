import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PASSWORD,
  BASE,
  drawWithMouse,
  drawWithTouch,
  EMULATOR_STATE_URL,
  horizontalOverflow,
  launchBrowser,
  screenshot,
} from './browser';

/**
 * E2E trên runtime thật: Chrome ⇄ Worker production build (workerd) ⇄ Apps Script giả lập.
 */

let browser: Browser;
let desktop: BrowserContext;
const created: Array<{ code: string; link: string }> = [];
let adminStorage: Awaited<ReturnType<BrowserContext['storageState']>>;

beforeAll(async () => {
  browser = await launchBrowser();
  desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'America/New_York' });
  await desktop.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
});

afterAll(async () => {
  await browser?.close();
});

async function createHandoverViaUi(page: Page, receiverQuery: string, receiverName: string) {
  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { name: 'Tạo biên bản bàn giao' }).waitFor();
  await page.locator('#sender-name').waitFor();

  // Người bàn giao: gõ không dấu → chọn từ danh sách
  await page.locator('#sender-name').fill('nguyen van an');
  await page.getByRole('option', { name: /Nguyễn Văn An/ }).click();

  // Người nhận: tìm không dấu, chọn bằng bàn phím
  const receiver = page.locator('#receiver');
  await receiver.fill(receiverQuery);
  await page.getByRole('option', { name: new RegExp(receiverName) }).first().waitFor();
  await receiver.press('Enter');
  await page.getByText(receiverName, { exact: true }).first().waitFor();

  // Nội dung 1: Thiết bị CNTT
  const item1 = page.getByRole('region', { name: 'Nội dung số 1', exact: true });
  await item1.getByLabel('Tên thiết bị').fill('Laptop Dell Latitude 5440');
  await item1.getByLabel('Mã tài sản').fill('TS-0001');
  await item1.getByLabel('Serial').fill('5CG1234XYZ');
  await item1.getByLabel('Tình trạng').fill('Tốt');

  // Thêm nội dung 2: Thẻ, rồi đưa lên đầu
  await page.getByRole('button', { name: 'THÊM NỘI DUNG' }).click();
  const item2 = page.getByRole('region', { name: 'Nội dung số 2', exact: true });
  await item2.getByLabel('Loại bàn giao').selectOption({ label: 'Thẻ' });
  await item2.getByLabel('Loại thẻ').fill('Thẻ thang máy');
  await item2.getByLabel('Mã thẻ').fill('TM-09');
  await page.getByRole('button', { name: 'Di chuyển nội dung 2 lên trên' }).click();
  expect(await page.getByRole('region', { name: 'Nội dung số 1', exact: true }).getByLabel('Loại thẻ').inputValue()).toBe('Thẻ thang máy');

  // Nội dung 3: Công việc
  await page.getByRole('button', { name: 'THÊM NỘI DUNG' }).click();
  const item3 = page.getByRole('region', { name: 'Nội dung số 3', exact: true });
  await item3.getByLabel('Loại bàn giao').selectOption({ label: 'Công việc' });
  await item3.getByLabel('Tên công việc').fill('Bảo trì website');
  await item3.getByLabel('Deadline').fill('2026-10-15');
  await item3.getByLabel('Link tài liệu').fill('https://example.com/tai-lieu');

  await page.locator('#handover-note').fill('Bàn giao khi chuyển công tác.');
  await page.getByRole('button', { name: 'TẠO BÀN GIAO', exact: true }).click();
  await page.getByRole('heading', { name: 'ĐÃ TẠO BIÊN BẢN' }).waitFor({ timeout: 30_000 });
  const link = await page.getByRole('textbox', { name: 'Link xác nhận' }).inputValue();
  const code = (await page.locator('dd.font-mono').first().textContent())!.trim();
  created.push({ code, link });
  return { code, link };
}

describe('Runtime Cloudflare (workerd) — static assets & API', () => {
  it('SPA deep route, security headers, API JSON, rate-limit binding', async () => {
    for (const route of ['/', '/xac-nhan/test', '/admin', '/admin/ban-giao/khong-co']) {
      const res = await fetch(BASE + route);
      expect(res.status, route).toBe(200);
      expect(await res.text()).toContain('<div id="root"></div>');
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
});

describe('Tạo biên bản (desktop 1440px)', () => {
  it('báo lỗi khi form thiếu trường', async () => {
    const page = await desktop.newPage();
    await page.goto(`${BASE}/`);
    await page.locator('#receiver').waitFor();
    await page.getByRole('button', { name: 'TẠO BÀN GIAO', exact: true }).click();
    await page.getByText('Chọn người nhận từ danh sách nhân viên').first().waitFor();
    await page.getByText('Tên thiết bị là bắt buộc').waitFor();
    await page.getByText(/Vui lòng kiểm tra lại \d+ mục/).waitFor();
    // focus nhảy tới lỗi đầu tiên
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('sender-name');
    await page.close();
  });

  it('tạo biên bản nhiều nội dung, sao chép link (toast), xem QR', async () => {
    const page = await desktop.newPage();
    const { code, link } = await createHandoverViaUi(page, 'Pham Danh Thai', 'Phạm Danh Thái');
    expect(code).toMatch(/^BG-\d{8}-\d{4}$/);
    expect(link).toMatch(new RegExp(`^${BASE}/xac-nhan/[A-Za-z0-9_-]{43}$`));
    await page.getByRole('img', { name: /Mã QR/ }).waitFor();
    await page.getByRole('button', { name: 'SAO CHÉP LINK' }).click();
    await page.getByText('Đã sao chép link xác nhận.').waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await screenshot(page, 'create-success-1440');
    await page.getByRole('button', { name: 'TẠO BÀN GIAO MỚI' }).click();
    await page.getByRole('heading', { name: 'Tạo biên bản bàn giao' }).waitFor();
    await page.close();

    // Tạo thêm 2 biên bản cho các kịch bản tiếp theo
    const p2 = await desktop.newPage();
    await createHandoverViaUi(p2, 'do thi huong', 'Đỗ Thị Hương');
    await p2.close();
    const p3 = await desktop.newPage();
    await createHandoverViaUi(p3, 'DEMO-103', 'Lê Hoàng Đức');
    await p3.close();
  });
});

describe('Người nhận xác nhận', () => {
  it('ký bằng cảm ứng trên điện thoại 375px — trang không cuộn khi ký; xác nhận lần 2 bị chặn', async () => {
    const mobile = await browser.newContext({
      viewport: { width: 375, height: 667 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'vi-VN',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const page = await mobile.newPage();
    const { code, link } = created[0]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByText('Laptop Dell Latitude 5440').waitFor();
    await page.getByText('Thẻ thang máy').waitFor();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByText('Vui lòng tích ô xác nhận đã kiểm tra và nhận đủ các nội dung.').waitFor();
    await page.getByText('Vui lòng ký tên vào khung bên dưới.').waitFor();

    await page.getByLabel('Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.').check();
    const canvas = page.locator('canvas[aria-label^="Khung ký tên"]');
    await canvas.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await drawWithTouch(page, canvas);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await screenshot(page, 'confirm-signed-375');

    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor({ timeout: 30_000 });
    await screenshot(page, 'confirm-done-375');

    // Refresh trực tiếp /xac-nhan/:token vẫn hoạt động và giữ trạng thái đã xác nhận
    await page.reload();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor();
    expect(await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).count()).toBe(0);

    // Gọi lại API xác nhận → 409
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

    // Người nhận tải PDF
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Tải PDF/ }).click()]);
    expect(download.suggestedFilename()).toBe(`${code}.pdf`);
    await mobile.close();
  });

  it('ký bằng chuột trên desktop', async () => {
    const page = await desktop.newPage();
    const { code, link } = created[1]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByLabel('Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.').check();
    const canvas = page.locator('canvas[aria-label^="Khung ký tên"]');
    await canvas.scrollIntoViewIfNeeded();
    await drawWithMouse(page, canvas);
    await page.getByRole('button', { name: 'XÓA CHỮ KÝ' }).click();
    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByText('Vui lòng ký tên vào khung bên dưới.').waitFor();
    await drawWithMouse(page, canvas);
    await page.getByRole('button', { name: 'XÁC NHẬN BÀN GIAO', exact: true }).click();
    await page.getByRole('heading', { name: 'BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN' }).waitFor({ timeout: 30_000 });
    await page.close();
  });

  it('yêu cầu chỉnh sửa bắt buộc nhập lý do', async () => {
    const page = await desktop.newPage();
    const { code, link } = created[2]!;
    await page.goto(link);
    await page.getByRole('heading', { name: code }).waitFor();
    await page.getByRole('button', { name: 'Yêu cầu chỉnh sửa', exact: true }).click();
    await page.getByRole('button', { name: 'YÊU CẦU CHỈNH SỬA', exact: true }).click();
    await page.getByText(/Vui lòng nhập lý do/).first().waitFor();
    await page.getByLabel('Lý do / nội dung cần sửa').fill('Laptop có vết xước ở góc trái màn hình.');
    await page.getByRole('button', { name: 'YÊU CẦU CHỈNH SỬA', exact: true }).click();
    await page.getByRole('heading', { name: 'ĐÃ GỬI YÊU CẦU CHỈNH SỬA' }).waitFor();
    await page.close();
  });
});

describe('Quản trị', () => {
  it('đăng nhập sai / đúng, thống kê, lọc, chi tiết (chữ ký thật trong ảnh), tải PDF, refresh /admin', async () => {
    const page = await desktop.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByLabel('Mật khẩu').fill('mat-khau-sai');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.getByText('Mật khẩu không đúng.').waitFor();
    await page.getByLabel('Mật khẩu').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.getByRole('heading', { name: 'Biên bản bàn giao' }).waitFor();
    expect(await page.evaluate(() => document.cookie)).toBe(''); // cookie phiên HttpOnly — JS không đọc được
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe('{}');

    const total = page.getByRole('button', { name: /Tổng số biên bản/ });
    await page.waitForFunction(() => /\d/.test(document.querySelector('[aria-label="Thống kê"] button span:last-child')?.textContent ?? ''));
    expect(await total.textContent()).toContain('3');

    await page.getByLabel('Trạng thái').selectOption('CONFIRMED');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await page.waitForURL(/status=CONFIRMED/);
    await page.getByText('2 biên bản').waitFor();
    await screenshot(page, 'admin-dashboard-1440');

    // Refresh trực tiếp /admin?status=… vẫn đăng nhập & giữ bộ lọc
    await page.reload();
    await page.getByText('2 biên bản').waitFor();

    const firstCode = created[0]!.code;
    await page.getByRole('link', { name: firstCode }).click();
    await page.getByRole('heading', { name: firstCode }).waitFor();
    const signature = page.getByRole('img', { name: /Chữ ký của/ });
    await signature.waitFor();
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

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải PDF' }).click()]);
    expect(download.suggestedFilename()).toBe(`${firstCode}.pdf`);
    await page.getByText('Người nhận xác nhận').waitFor(); // lịch sử
    await screenshot(page, 'admin-detail-1440');

    await page.reload();
    await page.getByRole('heading', { name: firstCode }).waitFor();
    adminStorage = await desktop.storageState();
    await page.close();
  });

  it('sửa biên bản đang "Yêu cầu chỉnh sửa" → trở lại "Chờ xác nhận"; copy link', async () => {
    const page = await desktop.newPage();
    await page.goto(`${BASE}/admin?status=REVISION_REQUESTED`);
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

  it('dữ liệu thật đã ghi vào Sheet/Drive (giả lập)', async () => {
    if (!EMULATOR_STATE_URL) return;
    const state = await (await fetch(EMULATOR_STATE_URL)).json();
    expect(state.sheets.BAN_GIAO).toHaveLength(3);
    expect(state.sheets.CHI_TIET_BAN_GIAO.length).toBeGreaterThanOrEqual(9);
    const sigs = state.files.filter((f: { path: string }) => f.path.startsWith('DTA_HANDOVER/signatures/'));
    expect(sigs).toHaveLength(2);
    expect(state.files.some((f: { path: string }) => /^DTA_HANDOVER\/pdf\/\d{4}\/\d{2}\/BG-.*\.pdf$/.test(f.path))).toBe(true);
    for (const row of state.sheets.BAN_GIAO) {
      expect(JSON.stringify(row)).not.toContain(created[0]!.link.split('/xac-nhan/')[1]);
    }
  });

  it('đăng xuất', async () => {
    const page = await desktop.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByRole('heading', { name: 'Biên bản bàn giao' }).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await page.getByRole('heading', { name: 'Đăng nhập quản trị' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Đăng nhập quản trị' }).waitFor();
    await page.close();
  });
});

describe('Responsive — không tràn ngang', () => {
  const widths = [375, 390, 430, 768, 1024, 1440];
  it.each(widths)('%ipx: trang tạo, xác nhận, admin', async (width) => {
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
      ['create', `${BASE}/`, '#receiver'],
      ['confirm', pending.link, 'canvas'],
      ['admin', `${BASE}/admin`, 'text=Biên bản bàn giao'],
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
