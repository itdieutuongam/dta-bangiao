#!/usr/bin/env node
/**
 * HTTP server giả lập Web App Google Apps Script — CHỈ DÙNG CHO PHÁT TRIỂN / KIỂM THỬ CỤC BỘ.
 * Không thay thế Apps Script thật; dữ liệu nằm trong bộ nhớ và mất khi tắt.
 *
 *   npm run gas:emulator                      (cổng 8790, lấy GAS_SHARED_SECRET từ .dev.vars nếu có)
 *   node scripts/gas-emulator/server.mjs --port 8790 --secret <chuỗi> [--no-seed] [--vpp]
 *
 * Trong .dev.vars:
 *   GAS_WEB_APP_URL=http://127.0.0.1:8790/macros/s/emulator/exec
 *   GAS_SHARED_SECRET=<cùng giá trị --secret>
 *
 * Giống Web App thật: POST /exec trả 302 tới /macros/echo?user_content_key=... (Worker phải theo redirect).
 * Endpoint điều khiển cho test: POST /__emulator/fault {target:"sheets"|"drive"|"html"|"mail", count}
 *                                GET  /__emulator/state
 *                                GET  /__emulator/mail   (thư MailApp giả lập: mã OTP, thông báo — không gửi thật)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGasRuntime } from './runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * Khởi động server giả lập.
 * vpp: nạp định mức + tồn đầu kỳ văn phòng phẩm (seedOfficeSupplyNorms / seedInitialOfficeSupplyStock) như chủ Sheet chạy từ menu.
 * settings: ghi đè khóa CAU_HINH sau khi setupDatabase (ví dụ { APP_URL: 'http://127.0.0.1:8787', NOTIFY_EMAILS: '…' }).
 * onMail: gọi mỗi khi script "gửi" một email (thư nằm trong runtime.mail, không gửi thật).
 * @param {{ port?: number, host?: string, secret: string, seed?: boolean, vpp?: boolean, quiet?: boolean, redirect?: boolean,
 *           settings?: Record<string, string>, onMail?: (mail: object) => void }} options
 */
export async function startGasEmulator(options) {
  const runtime = createGasRuntime({
    scriptDir: path.join(ROOT, 'apps-script'),
    properties: { BACKEND_SHARED_SECRET: options.secret },
    quiet: options.quiet,
    onMail: options.onMail,
  });
  runtime.run('setupDatabase');
  if (options.seed !== false) runtime.run('seedSampleEmployees');
  if (options.vpp) {
    runtime.run('seedOfficeSupplyNorms');
    runtime.run('seedInitialOfficeSupplyStock');
  }
  for (const [key, value] of Object.entries(options.settings ?? {})) {
    runtime.run('upsertSetting_', key, value, 'Giá trị chạy thử cục bộ (emulator)');
  }

  const echoes = new Map();
  let htmlFaults = 0;
  let requestCount = 0;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'POST' && url.pathname.endsWith('/exec')) {
        requestCount += 1;
        const body = await readBody(req);
        if (htmlFaults > 0) {
          htmlFaults -= 1;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><body>Google Drive – Page not found (emulated)</body></html>');
          return;
        }
        const text = runtime.doPost(body);
        if (options.redirect === false) {
          sendJson(res, 200, text);
          return;
        }
        const key = crypto.randomBytes(16).toString('hex');
        echoes.set(key, text);
        res.writeHead(302, { Location: `http://${req.headers.host}/macros/echo?user_content_key=${key}` });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/macros/echo') {
        const key = url.searchParams.get('user_content_key') ?? '';
        const text = echoes.get(key);
        echoes.delete(key);
        if (!text) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<html><body>Not found</body></html>');
          return;
        }
        sendJson(res, 200, text);
        return;
      }
      if (req.method === 'GET' && url.pathname.endsWith('/exec')) {
        sendJson(res, 200, runtime.doGet());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/__emulator/fault') {
        const { target, count = 1 } = JSON.parse((await readBody(req)) || '{}');
        if (target === 'html') htmlFaults = Number(count);
        else runtime.faults.set(target, Number(count));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/__emulator/state') {
        const sheets = {};
        for (const sheet of runtime.spreadsheet.getSheets()) sheets[sheet.getName()] = sheet.toObjects();
        const files = [...runtime.drive.items.values()]
          .filter((item) => typeof item.getBlob === 'function' && item.parent)
          .map((file) => ({ id: file.id, path: runtime.drive.pathOf(file), mime: file.mime, size: file.bytes.length, trashed: file.trashed }));
        sendJson(res, 200, { sheets, files, requestCount, propertyKeys: Object.keys(runtime.properties).sort() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/__emulator/mail') {
        sendJson(res, 200, { mail: runtime.mail, quota: runtime.mailState.quota });
        return;
      }
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Emulator route not found' } });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body>Emulator error: ${String(err && err.message)}</body></html>`);
    }
  });

  await new Promise((resolve) => server.listen(options.port ?? 8790, options.host ?? '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    runtime,
    port,
    url: `http://127.0.0.1:${port}/macros/s/emulator/exec`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function readDevVarsSecret() {
  const file = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(file)) return '';
  const match = /^GAS_SHARED_SECRET=(.*)$/m.exec(fs.readFileSync(file, 'utf8'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const port = Number(arg('--port') ?? process.env.GAS_EMULATOR_PORT ?? 8790);
  let secret = arg('--secret') ?? process.env.GAS_SHARED_SECRET ?? readDevVarsSecret();
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.log('⚠  Chưa có GAS_SHARED_SECRET — dùng secret tạm cho phiên giả lập này:');
    console.log(`   GAS_SHARED_SECRET=${secret}`);
  }
  const vpp = args.includes('--vpp');
  const emulator = await startGasEmulator({
    port,
    secret,
    seed: !args.includes('--no-seed'),
    vpp,
    onMail: (mail) => console.log(`✉  [email giả lập] tới ${mail.to}: ${mail.subject}`),
  });
  console.log('DTA Handover – Apps Script EMULATOR (chỉ dùng kiểm thử, dữ liệu trong bộ nhớ)');
  console.log(`  GAS_WEB_APP_URL=${emulator.url}`);
  console.log(`  Đã chạy setupDatabase() + seedSampleEmployees()${vpp ? ' + định mức / tồn đầu kỳ VPP' : ''}. Ctrl+C để dừng.`);
  console.log(`  Email giả lập (mã OTP, thông báo): http://127.0.0.1:${emulator.port}/__emulator/mail`);
}
