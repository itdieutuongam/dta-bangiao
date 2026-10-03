#!/usr/bin/env node
/**
 * Chạy test end-to-end trên runtime Cloudflare thật (workerd) — không cần tài khoản Google/Cloudflare:
 *   1. npm run build (bỏ qua bằng --skip-build)
 *   2. Khởi động Apps Script GIẢ LẬP (scripts/gas-emulator) với secret ngẫu nhiên
 *   3. `wrangler dev` chạy bản build production (dist/<tên worker>/wrangler.json) với biến môi trường test
 *   4. vitest --config vitest.e2e.config.ts (API + giao diện trên Chrome/Edge cài sẵn)
 *
 *   npm run test:e2e            (biến tùy chọn: E2E_PORT, E2E_BROWSER_PATH, E2E_HEADED=1)
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGasEmulator } from '../gas-emulator/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.E2E_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;
const node = process.execPath;
const bin = {
  wrangler: path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  vitest: path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
  npmCli: process.env.npm_execpath,
};

function log(message) {
  console.log(`\n[e2e] ${message}`);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      last = `${res.status} ${await res.text()}`;
      if (res.status === 200) return;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Worker không sẵn sàng sau ${timeoutMs / 1000}s: ${last}`);
}

/** Cấu hình Worker đã build — Vite plugin ghi đường dẫn vào .wrangler/deploy/config.json. */
function resolveBuiltConfig() {
  const redirect = path.join(ROOT, '.wrangler', 'deploy', 'config.json');
  if (!fs.existsSync(redirect)) return null;
  const { configPath } = JSON.parse(fs.readFileSync(redirect, 'utf8'));
  const resolved = path.resolve(path.dirname(redirect), configPath);
  return fs.existsSync(resolved) ? resolved : null;
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    log('Build production…');
    const build = bin.npmCli
      ? spawnSync(node, [bin.npmCli, 'run', 'build'], { cwd: ROOT, stdio: 'inherit' })
      : spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const builtConfig = resolveBuiltConfig();
  if (!builtConfig) throw new Error('Chưa có bản build Worker (dist/<tên worker>/wrangler.json) — hãy chạy npm run build.');

  // .dev.vars trong thư mục build (nếu có) được ưu tiên hơn --var → tạm đổi tên trong lúc test.
  const builtDevVars = path.join(path.dirname(builtConfig), '.dev.vars');
  const backup = `${builtDevVars}.e2e-backup`;
  if (fs.existsSync(builtDevVars)) fs.renameSync(builtDevVars, backup);

  const secret = crypto.randomBytes(32).toString('hex');
  const adminPassword = `E2E-${crypto.randomBytes(9).toString('base64url')}`;
  const emulator = await startGasEmulator({ port: 0, secret, quiet: true });
  log(`Apps Script giả lập: ${emulator.url}`);

  const vars = {
    GAS_WEB_APP_URL: emulator.url,
    GAS_SHARED_SECRET: secret,
    ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    APP_BASE_URL: BASE,
  };
  const args = [bin.wrangler, 'dev', '-c', builtConfig, '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'warn'];
  for (const [key, value] of Object.entries(vars)) args.push('--var', `${key}:${value}`);

  log(`wrangler dev (bản build production) tại ${BASE}…`);
  const worker = spawn(node, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  const workerLog = [];
  worker.stdout.on('data', (d) => workerLog.push(String(d)));
  worker.stderr.on('data', (d) => workerLog.push(String(d)));

  let exitCode = 1;
  try {
    await waitForHealth(120_000);
    log('Worker sẵn sàng. Chạy test e2e…');
    // Dùng spawn bất đồng bộ: Apps Script giả lập chạy trong chính process này,
    // spawnSync sẽ chặn event loop khiến giả lập không phản hồi được.
    const vitest = spawn(
      node,
      [bin.vitest, 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2).filter((a) => a !== '--skip-build')],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          E2E_BASE_URL: BASE,
          E2E_ADMIN_PASSWORD: adminPassword,
          E2E_EMULATOR_STATE_URL: emulator.url.replace(/\/macros\/.*/, '/__emulator/state'),
        },
      },
    );
    exitCode = await new Promise((resolve) => vitest.on('exit', (code) => resolve(code ?? 1)));
  } catch (err) {
    console.error(err);
    console.error(workerLog.join('').slice(-4000));
  } finally {
    killTree(worker);
    await emulator.close();
    if (fs.existsSync(backup)) fs.renameSync(backup, builtDevVars);
  }
  log(exitCode === 0 ? 'E2E PASS' : `E2E FAIL (exit ${exitCode})`);
  if (exitCode !== 0 && workerLog.length) {
    console.log('--- wrangler log (cuối) ---');
    console.log(workerLog.join('').slice(-3000));
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
