import { TOKEN_PATTERN, UUID_PATTERN } from '../../shared/constants';
import { hashClientIp } from '../services/token';
import type { RequestContext } from '../types';
import { base64Decode, type Bytes } from '../utils/crypto';
import { ApiError, fileResponse } from '../utils/http';

export interface ClientInfo {
  ipHash: string;
  userAgent: string;
}

/** Thông tin client gửi sang Apps Script để ghi nhật ký — IP đã hash, không lưu IP thô. */
export async function clientInfo(c: RequestContext): Promise<ClientInfo> {
  return {
    ipHash: await hashClientIp(c.env, c.clientIp),
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

export function requireHandoverId(c: RequestContext): string {
  const id = c.params.id ?? '';
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy biên bản.');
  }
  return id.toLowerCase();
}

/** File (PDF / PNG) Apps Script trả về dạng base64. */
export interface GasFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

export function gasFileResponse(file: GasFile, disposition: 'inline' | 'attachment'): Response {
  let bytes: Bytes;
  try {
    bytes = base64Decode(file.base64);
  } catch {
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Dữ liệu tệp từ máy chủ không hợp lệ.');
  }
  return fileResponse(bytes, file.mimeType || 'application/octet-stream', file.fileName || 'file', disposition);
}
