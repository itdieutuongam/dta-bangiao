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

/** Payload gửi Apps Script + sealKey (khi đã cấu hình). */
export async function withSealKey<T extends object>(env: Env, payload: T): Promise<T & { sealKey?: string }> {
  const sealKey = await recordSealKey(env);
  return sealKey ? { ...payload, sealKey } : payload;
}
