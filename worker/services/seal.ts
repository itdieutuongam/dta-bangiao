import type { Env } from '../types';
import { hmacSha256Hex } from '../utils/crypto';

/** Độ dài tối thiểu của RECORD_SEAL_SECRET (ngẫu nhiên). Ngắn hơn → coi như chưa cấu hình. */
export const RECORD_SEAL_SECRET_MIN_LENGTH = 32;

/**
 * Khóa niêm phong biên bản đã ký — gửi KÈM request tới Apps Script, không bao giờ lưu ở Apps Script / Google Sheet. Apps Script
 * dùng để tính / kiểm tra record_seal = HMAC(mã băm toàn bộ biên bản lúc ký): người sửa được Google Sheet (kể cả xem được
 * Script Properties) không tự tính lại được niêm phong → sửa tay sau khi ký bị phát hiện, không tạo lại PDF từ dữ liệu đã sửa.
 * Chưa cấu hình RECORD_SEAL_SECRET → '' (chỉ còn mã băm thường). KHÔNG đổi secret sau khi đã dùng: niêm phong cũ sẽ báo sai.
 */
export async function recordSealKey(env: Env): Promise<string> {
  const secret = env.RECORD_SEAL_SECRET?.trim();
  if (!secret || secret.length < RECORD_SEAL_SECRET_MIN_LENGTH) return '';
  return hmacSha256Hex(secret, 'dta-record-seal-key-v1');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SEAL_LEGACY_IDS: mã (handover_id) các biên bản ký TRƯỚC khi cấu hình RECORD_SEAL_SECRET, cách nhau bởi dấu phẩy / khoảng trắng.
 * Khi đã có khóa, biên bản có mã nội dung mà ô niêm phong trống bị coi là ĐÃ BỊ SỬA (người sửa Sheet xóa niêm phong để "hợp thức
 * hóa" dữ liệu đã sửa) — trừ các biên bản liệt kê ở đây. Danh sách nằm ở Cloudflare, không nằm trên Sheet / Apps Script.
 */
export function sealLegacyIds(env: Env): string[] {
  return (env.SEAL_LEGACY_IDS ?? '')
    .split(/[\s,;]+/)
    .map((id) => id.trim().toLowerCase())
    .filter((id) => UUID.test(id))
    .slice(0, 500);
}

/** Payload gửi Apps Script + sealKey (khi đã cấu hình) + danh sách biên bản ký trước khi có khóa. */
export async function withSealKey<T extends object>(env: Env, payload: T): Promise<T & { sealKey?: string; sealLegacyIds?: string[] }> {
  const sealKey = await recordSealKey(env);
  if (!sealKey) return payload;
  const legacy = sealLegacyIds(env);
  return legacy.length ? { ...payload, sealKey, sealLegacyIds: legacy } : { ...payload, sealKey };
}
