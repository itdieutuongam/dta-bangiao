import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { createGasRuntime, signGasRequest } from '../scripts/gas-emulator/runtime.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** PNG hợp lệ (grayscale 8-bit) có vẽ một đường chéo — dùng làm ảnh chữ ký trong test. */
export function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    const x = Math.floor((y / height) * width);
    raw[y * (width + 1) + 1 + x] = 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

export function todayKey(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}`;
}

export interface GasEnvelope {
  ok: boolean;
  data?: any;
  error?: { code: string; message: string; details?: any };
}

/** Runtime Apps Script giả lập đã setupDatabase() + nhân viên mẫu, kèm hàm gọi API có ký HMAC. */
export function setupGas(options: { seed?: boolean } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const rt = createGasRuntime({
    scriptDir: path.join(ROOT, 'apps-script'),
    properties: { BACKEND_SHARED_SECRET: secret },
    quiet: true,
  });
  rt.run('setupDatabase');
  if (options.seed !== false) rt.run('seedSampleEmployees');
  const call = (action: string, payload: unknown = {}, scope = 'public'): GasEnvelope =>
    JSON.parse(rt.doPost(signGasRequest(secret, action, payload, scope)));
  return { rt, secret, call };
}

export function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    category: 'THIET_BI_CNTT',
    itemName: 'Laptop Dell Latitude 5440',
    assetCode: 'TS-0001',
    serialNumber: 'SN123456',
    model: 'Latitude 5440',
    quantity: 1,
    condition: 'Tốt',
    description: 'Kèm sạc 65W',
    workStatus: '',
    deadline: '',
    documentUrl: '',
    note: '',
    ...overrides,
  };
}

export function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: sha256(token), nonce: crypto.randomBytes(32).toString('base64url') };
}

export function createPayload(overrides: Record<string, unknown> = {}) {
  const t = newToken();
  return {
    payload: {
      sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
      receiverEmployeeId: 'DEMO-519',
      note: 'Bàn giao thiết bị',
      items: [itemInput()],
      tokenHash: t.hash,
      tokenNonce: t.nonce,
      client: { ipHash: crypto.randomBytes(16).toString('hex'), userAgent: 'vitest' },
      ...overrides,
    },
    token: t,
  };
}
