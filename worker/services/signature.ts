import { LIMITS } from '../../shared/constants';
import { base64Decode } from '../utils/crypto';
import { ApiError } from '../utils/http';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL_PREFIX = 'data:image/png;base64,';

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

export interface DecodedSignature {
  base64: string;
  byteLength: number;
  width: number;
  height: number;
}

/** Kiểm tra ảnh chữ ký: đúng PNG, kích thước & dung lượng hợp lý. Không tin dữ liệu từ trình duyệt. */
export function decodeSignatureDataUrl(dataUrl: string): DecodedSignature {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Dữ liệu chữ ký không hợp lệ.', {
      details: { fieldErrors: { signature: 'Dữ liệu chữ ký không hợp lệ.' } },
    });
  }
  const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(base64);
  } catch {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Dữ liệu chữ ký không hợp lệ.');
  }
  if (bytes.byteLength > LIMITS.signatureMaxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Ảnh chữ ký quá lớn.');
  }
  const isPng = bytes.byteLength > 33 && PNG_MAGIC.every((b, i) => bytes[i] === b);
  const hasIhdr = isPng && String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) === 'IHDR';
  if (!hasIhdr) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Chữ ký phải là ảnh PNG hợp lệ.');
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width < 20 || height < 10 || width > LIMITS.signatureMaxWidth || height > LIMITS.signatureMaxHeight) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Kích thước ảnh chữ ký không hợp lệ.');
  }
  return { base64, byteLength: bytes.byteLength, width, height };
}
