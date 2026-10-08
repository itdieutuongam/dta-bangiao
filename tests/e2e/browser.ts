import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

/** Biến E2E_* — từ môi trường (npm run test:e2e) hoặc tệp do `run-e2e.mjs --serve` ghi ra (E2E_ENV_FILE). */
function readEnv(): Record<string, string> {
  const file = process.env.E2E_ENV_FILE;
  const fromFile = file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>) : {};
  return { ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('E2E_') && v !== undefined)) } as Record<
    string,
    string
  >;
}
const env = readEnv();

export const BASE = env.E2E_BASE_URL ?? 'http://127.0.0.1:8788';
export const ADMIN_PASSWORD = env.E2E_ADMIN_PASSWORD ?? '';
export const STAFF_CODE = env.E2E_STAFF_CODE ?? '';
export const EMULATOR_STATE_URL = env.E2E_EMULATOR_STATE_URL ?? '';
/** Hộp thư MailApp giả lập (mã OTP khi ký, email thông báo) — cùng máy chủ với /__emulator/state. */
export const EMULATOR_MAIL_URL = EMULATOR_STATE_URL.replace(/\/__emulator\/state$/, '/__emulator/mail');
export const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '..', '..', '.e2e', 'screenshots');

/** Mã OTP mới nhất gửi cho biên bản `handoverCode` (tiêu đề "Mã xác nhận biên bản <mã>: NNNNNN"). */
export async function latestOtp(handoverCode: string): Promise<string> {
  if (!EMULATOR_STATE_URL) throw new Error('E2E cần Apps Script giả lập (E2E_EMULATOR_STATE_URL) để đọc mã OTP.');
  for (let attempt = 0; attempt < 20; attempt++) {
    const { mail } = (await (await fetch(EMULATOR_MAIL_URL)).json()) as { mail: Array<{ subject: string }> };
    for (let i = mail.length - 1; i >= 0; i--) {
      const m = /^Mã xác nhận biên bản (\S+): (\d{6})$/.exec(mail[i]!.subject);
      if (m && m[1] === handoverCode) return m[2]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Không thấy email mã OTP cho ${handoverCode}`);
}

/** Người nhận bấm "Gửi mã xác nhận", mở email (hộp thư giả lập) rồi nhập mã. Trả về mã đã nhập. */
export async function enterOtp(page: Page, handoverCode: string, override?: (code: string) => string): Promise<string> {
  await page.getByRole('button', { name: 'Gửi mã xác nhận', exact: true }).click();
  await page.getByText(/^Đã gửi mã tới /).waitFor();
  const code = await latestOtp(handoverCode);
  await page.getByLabel('Mã xác nhận 6 số').fill(override ? override(code) : code);
  return code;
}

/** Dùng Chrome / Edge đã cài trên máy (không tải trình duyệt riêng). */
export async function launchBrowser(): Promise<Browser> {
  const candidates = [
    process.env.E2E_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((p): p is string => Boolean(p));
  const headless = process.env.E2E_HEADED !== '1';
  for (const executablePath of candidates) {
    if (fs.existsSync(executablePath)) return chromium.launch({ executablePath, headless });
  }
  return chromium.launch({ channel: 'chrome', headless });
}

/** Chuỗi điểm giống chữ ký viết tay trong khung (tọa độ trang). */
export function signaturePath(box: { x: number; y: number; width: number; height: number }) {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    points.push({
      x: box.x + box.width * (0.12 + 0.76 * t),
      y: box.y + box.height * (0.55 + 0.22 * Math.sin(t * Math.PI * 3)),
    });
  }
  return points;
}

export async function drawWithMouse(page: Page, canvas: Locator) {
  const box = (await canvas.boundingBox())!;
  const points = signaturePath(box);
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

/** Vẽ bằng cảm ứng thật (CDP Input.dispatchTouchEvent → pointerType "touch"). */
export async function drawWithTouch(page: Page, canvas: Locator) {
  const box = (await canvas.boundingBox())!;
  const points = signaturePath(box);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0]!.x, y: points[0]!.y }] });
  for (const p of points.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function screenshot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
