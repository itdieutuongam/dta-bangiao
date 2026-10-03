import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8788';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
export const EMULATOR_STATE_URL = process.env.E2E_EMULATOR_STATE_URL ?? '';
export const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '..', '..', '.e2e', 'screenshots');

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
