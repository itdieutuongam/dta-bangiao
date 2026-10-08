import { TOKEN_PATTERN, UUID_PATTERN } from '../../shared/constants';
import { rateLimitIpKey } from '../services/rateLimit';
import { hashClientIp } from '../services/token';
import type { RequestContext } from '../types';
import { base64Decode, type Bytes } from '../utils/crypto';
import { ApiError, fileResponse } from '../utils/http';

export interface ClientInfo {
  ipHash: string;
  userAgent: string;
}

/**
 * Thông tin client gửi sang Apps Script để ghi nhật ký — IP đã hash, không lưu IP thô. Hash theo CÙNG khóa với giới hạn tần suất
 * của Worker (IPv6 gộp theo dải /64): Apps Script dùng ipHash cho giới hạn tra mã nhân viên / số lần mở link sai và cảnh báo
 * "ký trên cùng thiết bị" — đổi địa chỉ IPv6 trong cùng dải không còn né được giới hạn (trước đây 60 lần tra sai / 60 địa chỉ).
 */
export async function clientInfo(c: RequestContext): Promise<ClientInfo> {
  return {
    ipHash: await hashClientIp(c.env, rateLimitIpKey(c.clientIp)),
    userAgent: (c.request.headers.get('User-Agent') ?? '').slice(0, 300),
  };
}

export function requireToken(c: RequestContext): string {
  const token = c.params.token ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new ApiError(404, 'NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã hết hiệu lực.');
  }
  return token;
}

function requireUuidParam(c: RequestContext, name: string, message: string): string {
  const id = c.params[name] ?? '';
  if (!UUID_PATTERN.test(id)) throw new ApiError(404, 'NOT_FOUND', message);
  return id.toLowerCase();
}

export function requireHandoverId(c: RequestContext): string {
  return requireUuidParam(c, 'id', 'Không tìm thấy biên bản.');
}

export function requireParamId(c: RequestContext, name: string, message = 'Không tìm thấy dữ liệu.'): string {
  return requireUuidParam(c, name, message);
}

/** File (PDF / PNG) Apps Script trả về dạng base64. */
export interface GasFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

const FILE_KINDS = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
} as const;

/**
 * Chỉ trả đúng loại file mong đợi (MIME + chữ ký nhị phân) — không phản hồi HTML/JS dù ID file trên Sheet bị sửa
 * trỏ tới file khác.
 */
export function gasFileResponse(file: GasFile, disposition: 'inline' | 'attachment', kind: keyof typeof FILE_KINDS): Response {
  const spec = FILE_KINDS[kind];
  let bytes: Bytes;
  try {
    bytes = base64Decode(file.base64);
  } catch {
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Dữ liệu tệp từ máy chủ không hợp lệ.');
  }
  const magicOk = bytes.byteLength > spec.magic.length && spec.magic.every((b, i) => bytes[i] === b);
  if (String(file.mimeType).toLowerCase() !== spec.mime || !magicOk) {
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Tệp trên Google Drive không đúng định dạng.');
  }
  return fileResponse(bytes, spec.mime, file.fileName || `file.${kind}`, disposition);
}
