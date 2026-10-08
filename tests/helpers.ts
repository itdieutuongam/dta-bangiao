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

export const ADMIN_ACTOR = { id: 'thai', name: 'Phạm Danh Thái' };

/** Runtime Apps Script giả lập đã setupDatabase() + nhân viên mẫu, kèm hàm gọi API có ký HMAC. */
export function setupGas(options: { seed?: boolean; vpp?: boolean } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const rt = createGasRuntime({
    scriptDir: path.join(ROOT, 'apps-script'),
    properties: { BACKEND_SHARED_SECRET: secret },
    quiet: true,
  });
  rt.run('setupDatabase');
  if (options.seed !== false) rt.run('seedSampleEmployees');
  if (options.vpp) rt.run('seedOfficeSupplyNorms');
  const call = (action: string, payload: unknown = {}, scope = 'public'): GasEnvelope =>
    JSON.parse(rt.doPost(signGasRequest(secret, action, payload, scope)));
  /** Gọi thao tác quản trị (scope admin, kèm người thực hiện). */
  const admin = (action: string, payload: Record<string, unknown> = {}): GasEnvelope =>
    call(action, { actor: ADMIN_ACTOR, ...payload }, 'admin');
  return { rt, secret, call, admin };
}

export function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    category: 'THIET_BI_CNTT',
    itemName: 'Laptop Dell Latitude 5440',
    assetCode: 'TS-0001',
    serialNumber: 'SN123456',
    model: 'Latitude 5440',
    quantity: 1,
    unit: '',
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

/** Payload tạo phiếu (action adminCreateHandover). Mặc định loại OTHER = cho phép nhiều loại nội dung. */
export function createPayload(overrides: Record<string, unknown> = {}) {
  const t = newToken();
  return {
    payload: {
      handoverType: 'OTHER',
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

type Env = ReturnType<typeof setupGas>;

/** Sửa một ô trên Sheet giả lập theo khóa (như người dùng sửa tay), ví dụ đổi email nhân viên. */
export function setCell(env: Env, sheetName: string, idColumn: string, id: string, column: string, value: unknown) {
  const sheet = env.rt.sheet(sheetName);
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0] as string[];
  const r = values.findIndex((row: unknown[], i: number) => i > 0 && row[headers.indexOf(idColumn)] === id);
  if (r < 1 || headers.indexOf(column) < 0) throw new Error(`Không thấy ${sheetName}.${column} cho ${id}`);
  sheet.getRange(r + 1, headers.indexOf(column) + 1).setValue(value);
}

/** Lần ghi THÊM dòng kế tiếp vào sheet bị lỗi (như "Service Spreadsheets failed" giữa chừng). */
export function failNextAppend(env: Env, sheetName: string) {
  const sheet = env.rt.sheet(sheetName);
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args: number[]) => {
    const range = original(...args);
    if (armed && args.length >= 3 && args[0]! > sheet.getLastRow()) {
      range.setValues = () => {
        armed = false;
        throw new Error('Service Spreadsheets failed while accessing document (giả lập)');
      };
    }
    return range;
  };
}

/** Lần CẬP NHẬT dòng có sẵn kế tiếp trên sheet bị lỗi. */
export function failNextUpdate(env: Env, sheetName: string) {
  const sheet = env.rt.sheet(sheetName);
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args: number[]) => {
    const range = original(...args);
    if (armed && args.length >= 3 && args[0]! >= 2 && args[0]! <= sheet.getLastRow()) {
      range.setValues = () => {
        armed = false;
        throw new Error('Service Spreadsheets failed while accessing document (giả lập)');
      };
    }
    return range;
  };
}

/** Lần cập nhật dòng có sẵn bắt đầu tại cột `column` (theo tiêu đề) bị lỗi — mô phỏng lỗi giữa các lần ghi của một dòng. */
export function failNextUpdateAtColumn(env: Env, sheetName: string, column: string) {
  const sheet = env.rt.sheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];
  const col = headers.indexOf(column) + 1;
  if (col < 1) throw new Error(`Không thấy cột ${sheetName}.${column}`);
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args: number[]) => {
    const range = original(...args);
    if (armed && args.length >= 3 && args[0]! >= 2 && args[1] === col) {
      range.setValues = () => {
        armed = false;
        throw new Error('Service Spreadsheets failed while accessing document (giả lập)');
      };
    }
    return range;
  };
}

/** Đổi một khóa CAU_HINH (như chủ Sheet sửa) — cache cấu hình được xóa ngay. */
export function setSetting(env: Env, key: string, value: string) {
  env.rt.run('upsertSetting_', key, value, 'test');
}

/** Tạo phiếu bằng quyền admin; trả về id, code, token. */
export function createHandover(env: Env, overrides: Record<string, unknown> = {}) {
  const { payload, token } = createPayload(overrides);
  const res = env.admin('adminCreateHandover', payload);
  return { res, token, payload, id: res.data?.id as string, code: res.data?.code as string };
}

/** contentHash của nội dung hiện tại — người nhận nhận được khi mở link (bắt buộc gửi lại khi ký). */
export function contentHashOf(env: Env, tokenHash: string): string {
  const view = env.call('getHandoverByToken', { tokenHash });
  if (!view.ok) throw new Error(`getHandoverByToken failed: ${JSON.stringify(view.error)}`);
  return view.data.handover.contentHash as string;
}

export const signatureBase64 = () => makePng(400, 160).toString('base64');

export const RECEIVER_CLIENT = { ipHash: 'b'.repeat(32), userAgent: 'Mozilla/5.0 (iPhone)' };

/** Mã OTP mới nhất trong hộp thư giả lập gửi cho phiếu `handoverCode` (tiêu đề "Mã xác nhận biên bản <mã>: NNNNNN"). */
export function otpFromMail(mail: ReadonlyArray<{ subject: string }>, handoverCode: string): string | null {
  for (let i = mail.length - 1; i >= 0; i--) {
    const m = /^Mã xác nhận biên bản (\S+): (\d{6})$/.exec(mail[i]!.subject);
    if (m && m[1] === handoverCode) return m[2]!;
  }
  return null;
}

/**
 * Người nhận xin mã OTP (như bấm "Gửi mã") rồi đọc mã trong hộp thư giả lập.
 * Vừa gửi trong 60 giây (RATE_LIMITED) → dùng lại mã đã gửi trước đó, giống người dùng mở lại email.
 */
export function requestOtp(env: Env, tokenHash: string, handoverCode: string): string {
  const sent = env.call('requestConfirmOtp', { tokenHash, client: RECEIVER_CLIENT });
  if (!sent.ok && sent.error?.code !== 'RATE_LIMITED') throw new Error(`requestConfirmOtp failed: ${JSON.stringify(sent.error)}`);
  const otp = otpFromMail(env.rt.mail, handoverCode);
  if (!otp) throw new Error(`Không thấy email mã OTP cho ${handoverCode}`);
  return otp;
}

/**
 * Người nhận ký xác nhận như trình duyệt: đọc contentHash rồi gửi lại; phiếu yêu cầu mã OTP (người nhận có email)
 * → tự xin mã và đọc từ hộp thư giả lập. Truyền extra.otp để tự chỉ định mã (test OTP sai / thiếu).
 */
export function confirmAs(env: Env, tokenHash: string, extra: Record<string, unknown> = {}) {
  const view = env.call('getHandoverByToken', { tokenHash });
  if (!view.ok) throw new Error(`getHandoverByToken failed: ${JSON.stringify(view.error)}`);
  const handover = view.data.handover;
  const otp = handover.otp?.required && !('otp' in extra) ? requestOtp(env, tokenHash, handover.code) : '';
  return env.call('confirmHandover', {
    tokenHash,
    agreed: true,
    contentHash: handover.contentHash,
    signatureBase64: signatureBase64(),
    comment: '',
    otp,
    client: RECEIVER_CLIENT,
    ...extra,
  });
}
