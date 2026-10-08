#!/usr/bin/env node
/**
 * CHẠY THỬ CỤC BỘ — không cần Cloudflare, workerd hay tài khoản Google:
 *   • Worker THẬT (dist/dta_bangiao/index.js — đúng bản build sẽ deploy) chạy trên Node;
 *   • Apps Script GIẢ LẬP (scripts/gas-emulator): Google Sheet / Drive / MailApp nằm trong bộ nhớ, mất khi tắt;
 *   • trang web (dist/client) + SPA fallback + header bảo mật như Cloudflare (public/_headers).
 * Không đọc / ghi Google Sheet thật, không gửi email thật — email (mã OTP, thông báo) xem ở /__local/mail.
 *
 *   npm run local                         → http://localhost:8787
 *   npm run local -- --lan                → mở từ điện thoại cùng Wi-Fi (thử ký xác nhận trên điện thoại)
 *   npm run local -- --lan --lan-ip 192.168.1.20   → tự chọn địa chỉ khi máy có nhiều card mạng (WSL, Hyper-V…)
 *   npm run local -- --no-build           → dùng bản build có sẵn trong dist/
 *   npm run local -- --port 8800 --otp REQUIRED --notify "a@example.com,b@example.com" --no-vpp --no-staff-code
 *
 * Mật khẩu quản trị sinh ngẫu nhiên mỗi lần chạy (in ra màn hình). Đặt biến môi trường LOCAL_ADMIN_PASSWORD (≥ 12 ký tự)
 * để dùng mật khẩu cố định cho cả 2 tài khoản.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startGasEmulator } from '../gas-emulator/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_DIR = path.join(ROOT, 'dist', 'client');
const WORKER_FILE = path.join(ROOT, 'dist', 'dta_bangiao', 'index.js');

// ---------------------------------------------------------------- Tham số

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}
const port = Number(option('--port', process.env.PORT ?? 8787));
const lan = flag('--lan');
const otpMode = String(option('--otp', 'EMAIL')).toUpperCase();
const notifyEmails = option('--notify', 'quan-tri@example.com');
if (!['EMAIL', 'REQUIRED', 'OFF'].includes(otpMode)) {
  console.error('--otp phải là EMAIL, REQUIRED hoặc OFF');
  process.exit(1);
}

/** Card mạng ảo (WSL, Hyper-V, Docker, VirtualBox, VMware…) — điện thoại không truy cập được địa chỉ của chúng. */
const VIRTUAL_NIC = /vethernet|wsl|hyper-v|default switch|docker|virtualbox|vmware|vbox|loopback|tailscale|zerotier/i;

/** Mọi địa chỉ IPv4 của máy (để chấp nhận Origin khi mở bằng địa chỉ IP thay cho localhost). */
function localIpv4s() {
  return Object.values(os.networkInterfaces()).flatMap((list) => (list ?? []).filter((n) => n.family === 'IPv4').map((n) => n.address));
}

/**
 * Địa chỉ LAN để điện thoại cùng Wi-Fi truy cập: ưu tiên dải mạng nội bộ (192.168.x, 10.x, 172.16–31.x) trên card mạng thật,
 * bỏ card ảo. --lan-ip <địa chỉ> để tự chọn khi máy có nhiều card mạng.
 */
function lanAddress() {
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family !== 'IPv4' || nic.internal) continue;
      const privateRange = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(nic.address);
      candidates.push({ address: nic.address, score: (VIRTUAL_NIC.test(name) ? 0 : 2) + (privateRange ? 1 : 0), name });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------- Build

if (!flag('--no-build')) {
  console.log('▶ Build ứng dụng (npm run build)…');
  const result = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error('✗ Build lỗi — xem thông báo phía trên.');
    process.exit(result.status ?? 1);
  }
}
if (!fs.existsSync(WORKER_FILE) || !fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  console.error(`✗ Chưa có bản build (${path.relative(ROOT, WORKER_FILE)}). Chạy lại không kèm --no-build.`);
  process.exit(1);
}

// ---------------------------------------------------------------- Cấu hình cục bộ (ngẫu nhiên mỗi lần chạy)

const chosenLan = lan ? (option('--lan-ip', '') ? { address: option('--lan-ip', ''), name: '--lan-ip' } : lanAddress()) : null;
const lanIp = chosenLan?.address ?? null;
if (lan && !lanIp) console.warn('⚠ Không tìm thấy địa chỉ mạng LAN — chỉ mở được trên máy này.');
const localBase = `http://localhost:${port}`;
const publicBase = lanIp ? `http://${lanIp}:${port}` : localBase;
// Các địa chỉ của CHÍNH máy chạy thử: trình duyệt mở bằng địa chỉ nào trong số này thì vẫn là cùng nguồn gốc (Origin) với
// localhost — Worker chỉ biết localhost / APP_BASE_URL nên Origin được đổi về localhost trước khi chuyển vào Worker.
const sameServerOrigins = new Set([
  localBase, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, publicBase,
  ...localIpv4s().map((ip) => `http://${ip}:${port}`),
]);
const fixedPassword = process.env.LOCAL_ADMIN_PASSWORD?.trim();
if (fixedPassword && fixedPassword.length < 12) {
  console.error('LOCAL_ADMIN_PASSWORD phải dài ít nhất 12 ký tự.');
  process.exit(1);
}
const randomPassword = () => `Dta-${crypto.randomBytes(9).toString('base64url')}`;
const accounts = [
  { username: 'admin', name: 'Quản trị viên (chạy thử)', password: fixedPassword || randomPassword() },
  { username: 'kho', name: 'Thủ kho (chạy thử)', password: fixedPassword || randomPassword() },
];
const staffCode = flag('--no-staff-code') ? '' : `DTA-${crypto.randomInt(1000, 9999)}`;
const gasSecret = crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------- Apps Script giả lập + hộp thư

const mailbox = [];
const emulator = await startGasEmulator({
  port: 0,
  secret: gasSecret,
  quiet: true,
  vpp: !flag('--no-vpp'),
  settings: { APP_URL: publicBase, CONFIRM_OTP: otpMode, NOTIFY_EMAILS: notifyEmails === 'none' ? '' : notifyEmails },
  onMail: (mail) => {
    mailbox.push(mail);
    console.log(`✉  Email giả lập → ${mail.to}: ${mail.subject}   (xem: ${publicBase}/__local/mail)`);
  },
});

// ---------------------------------------------------------------- Worker thật (bản build)

const worker = (await import(pathToFileURL(WORKER_FILE).href)).default;
const securityHeaders = readHeadersFile(path.join(CLIENT_DIR, '_headers'));

/**
 * Rate Limiting giống binding Cloudflare (đếm trong bộ nhớ, chu kỳ 60 giây) — giới hạn khớp "ratelimits" trong wrangler.jsonc,
 * để chạy thử hành xử như bản deploy (trang Cài đặt không báo thiếu binding).
 */
function memoryRateLimit(limit) {
  const buckets = new Map();
  return {
    async limit({ key }) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + 60_000 });
        return { success: true };
      }
      bucket.count += 1;
      return { success: bucket.count <= limit };
    },
  };
}

const env = {
  ASSETS: { fetch: (request) => serveAsset(new URL(request.url)) },
  RL_PUBLIC: memoryRateLimit(120),
  RL_WRITE: memoryRateLimit(20),
  RL_AUTH: memoryRateLimit(10),
  RL_AUTH_ACCOUNT: memoryRateLimit(30),
  GAS_WEB_APP_URL: emulator.url,
  GAS_SHARED_SECRET: gasSecret,
  SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  ADMIN_USERS: JSON.stringify(accounts),
  STAFF_ACCESS_CODE: staffCode,
  // Niêm phong biên bản đã ký (như production khi đã đặt secret) — dữ liệu giả lập mất khi tắt nên khóa ngẫu nhiên mỗi lần chạy.
  RECORD_SEAL_SECRET: crypto.randomBytes(32).toString('hex'),
  // Link xác nhận + kiểm tra Origin theo địa chỉ người dùng mở (LAN hoặc localhost).
  APP_BASE_URL: publicBase,
};

/** "/*" trong _headers → header bảo mật cho trang tĩnh (giống Cloudflare Static Assets). */
function readHeadersFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let active = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      active = line.trim() === '/*';
      continue;
    }
    const idx = line.indexOf(':');
    if (active && idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Trang tĩnh: file có sẵn → trả file; đường dẫn của SPA (không có đuôi file) → index.html; còn lại 404. */
function serveAsset(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  let file = path.normalize(path.join(CLIENT_DIR, pathname));
  // So với "thư mục + dấu phân cách": "dist/client-old/…" không được coi là nằm trong "dist/client".
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || path.basename(file).startsWith('_')) {
    if (path.extname(pathname)) return new Response('Not Found', { status: 404, headers: securityHeaders });
    file = path.join(CLIENT_DIR, 'index.html');
  }
  const headers = new Headers(securityHeaders);
  headers.set('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  headers.set('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  return new Response(fs.readFileSync(file), { status: 200, headers });
}

// ---------------------------------------------------------------- Nhật ký gọn (Worker ghi JSON mỗi request)

const rawLog = console.log.bind(console);
const rawWarn = console.warn.bind(console);
const rawError = console.error.bind(console);
function compact(write) {
  return (...items) => {
    if (typeof items[0] === 'string' && items[0].startsWith('{"level"')) {
      try {
        const e = JSON.parse(items[0]);
        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        if (e.event === 'api.request') {
          write(`${time}  ${String(e.method).padEnd(4)} ${e.path} → ${e.status} (${e.ms} ms)`);
          return;
        }
        const { level, event, requestId: _id, method: _m, path: _p, ...rest } = e;
        write(`${time}  [${level}] ${event} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`);
        return;
      } catch {
        // không phải JSON của Worker — in nguyên văn
      }
    }
    write(...items);
  };
}
console.log = compact(rawLog);
console.warn = compact(rawWarn);
console.error = compact(rawError);

// ---------------------------------------------------------------- Hộp thư giả lập

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function mailboxPage() {
  const items = [...mailbox].reverse();
  const rows = items.length
    ? items
        .map((m) => {
          const code = /: (\d{6})$/.exec(m.subject)?.[1];
          return `<article><header><time>${escapeHtml(new Date(m.at).toLocaleString('vi-VN'))}</time> · tới <b>${escapeHtml(m.to)}</b></header>
<h2>${escapeHtml(m.subject)}</h2>${code ? `<p class="otp">Mã xác nhận: <b>${code}</b></p>` : ''}<pre>${escapeHtml(m.body)}</pre></article>`;
        })
        .join('\n')
    : '<p class="empty">Chưa có email nào. Mã xác nhận khi ký và thông báo cho quản trị viên sẽ hiện ở đây.</p>';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Hộp thư giả lập</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f5f4;color:#1c1917}main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:20px;color:#5b3714}article{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:12px 16px;margin:12px 0}
header{font-size:13px;color:#78716c}h2{font-size:16px;margin:6px 0}pre{white-space:pre-wrap;font:inherit;margin:0;color:#44403c}
.otp{font-size:22px;margin:6px 0}.otp b{letter-spacing:.2em;color:#047857}.empty{color:#78716c}</style></head>
<body><main><h1>Hộp thư giả lập (chạy thử cục bộ)</h1><p>Không gửi email thật. Trang tự làm mới mỗi 5 giây. ${mailbox.length} email.</p>
${rows}</main></body></html>`;
}

// ---------------------------------------------------------------- HTTP server

function clientIp(req) {
  const ip = req.socket.remoteAddress ?? '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

async function handle(req, res) {
  // Chỉ nhận đích dạng đường dẫn "/…": dạng tuyệt đối ("http://evil/x") hay "//evil/x" sẽ khiến URL Worker nhận có tên máy
  // do người gửi chọn (vượt kiểm tra Origin). Tên máy của URL nội bộ luôn là localhost.
  const target = req.url ?? '/';
  if (!target.startsWith('/') || target.startsWith('//')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end('Bad Request');
    return;
  }
  const url = new URL(localBase + target);
  if (url.pathname === '/__local/mail') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(mailboxPage());
    return;
  }
  if (url.pathname === '/__local/mail.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(mailbox));
    return;
  }

  // URL nội bộ luôn là localhost: cookie phiên không bị gắn Secure (trình duyệt bỏ cookie Secure trên http://IP-LAN).
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'host' || key === 'connection') continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  headers.set('CF-Connecting-IP', clientIp(req));
  // Mở bằng 127.0.0.1 / địa chỉ IP của máy thay cho localhost → vẫn là cùng một máy chủ: đổi Origin về localhost.
  // Origin của trang khác giữ nguyên → Worker từ chối (403) như bản deploy.
  const origin = headers.get('origin');
  if (origin && sameServerOrigins.has(origin)) headers.set('origin', localBase);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
  const background = [];
  const response = await worker.fetch(request, env, {
    waitUntil: (promise) => background.push(promise),
    passThroughOnException: () => {},
  });

  const outHeaders = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') outHeaders[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outHeaders['set-cookie'] = cookies;
  // Worker trả lời mà không đọc hết body (401 / 403 / 413 / 429…): phần còn lại trên kết nối keep-alive sẽ làm hỏng
  // request kế tiếp → đóng kết nối sau phản hồi này.
  if (hasBody && !req.complete) outHeaders.connection = 'close';
  res.writeHead(response.status, outHeaders);
  if (response.body && req.method !== 'HEAD') {
    for await (const chunk of response.body) res.write(chunk);
  }
  res.end();
  for (const promise of background) {
    promise.catch((err) => rawError('Tác vụ nền lỗi:', err));
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    rawError('Lỗi máy chủ chạy thử:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Lỗi máy chủ chạy thử — xem cửa sổ dòng lệnh.');
  });
});
server.on('error', (err) => {
  rawError(err.code === 'EADDRINUSE' ? `✗ Cổng ${port} đang được dùng — chạy với --port <số khác>.` : err);
  process.exit(1);
});
await new Promise((resolve) => server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', resolve));

// ---------------------------------------------------------------- Hướng dẫn

const line = '─'.repeat(72);
rawLog(`
${line}
 DTA HANDOVER – CHẠY THỬ CỤC BỘ (dữ liệu giả lập trong bộ nhớ, mất khi tắt — Ctrl+C để dừng)
${line}
 Trang chủ           ${publicBase}/
 Quản trị            ${publicBase}/admin
 Đề xuất VPP         ${publicBase}/de-xuat-vpp${staffCode ? `   (mã truy cập nội bộ: ${staffCode})` : ''}
 Hộp thư giả lập     ${publicBase}/__local/mail   ← mã OTP khi ký + email thông báo

 Tài khoản quản trị:
   ${accounts.map((a) => `${a.username.padEnd(6)} / ${a.password}   (${a.name})`).join('\n   ')}

 Nhân viên mẫu (sheet NHAN_VIEN giả lập — đều có email @example.com):
   DEMO-519 Phạm Danh Thái (KHTH) · DEMO-101 Nguyễn Văn An (IT) · DEMO-102 Trần Thị Bích Ngọc (Kế toán)
   DEMO-103 Lê Hoàng Đức (Kinh doanh — có định mức VPP) · DEMO-104 Đỗ Thị Hương (Hành chính) · DEMO-105 Võ Minh Quân (IT)
   DEMO-106 Bùi Thanh Tâm (Marketing) · DEMO-107 Huỳnh Gia Bảo (đã nghỉ)

 Cấu hình: CONFIRM_OTP=${otpMode} · NOTIFY_EMAILS=${notifyEmails === 'none' ? '(trống)' : notifyEmails}${flag('--no-vpp') ? ' · không nạp dữ liệu VPP' : ' · đã nạp định mức + tồn đầu kỳ VPP'}
${lanIp ? ` Điện thoại cùng Wi-Fi mở: ${publicBase}  (card mạng: ${chosenLan.name}; sai card → chạy lại với --lan-ip <địa chỉ>;\n   không vào được → cho phép Node.js qua Windows Firewall)\n` : ''}${line}
`);

process.on('SIGINT', async () => {
  rawLog('\nĐang dừng…');
  server.close();
  await emulator.close();
  process.exit(0);
});
