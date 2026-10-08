/**
 * Tên file CSV xuất từ trang quản trị. Nội dung CSV (chống formula injection, ngày giờ Việt Nam, CRLF) do Apps Script dựng
 * (apps-script/Export.gs) — Worker chỉ chuyển nguyên văn, không lặp từng dòng (giới hạn CPU của Workers Free).
 */

/** Giờ Việt Nam (Asia/Ho_Chi_Minh) cố định UTC+7, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Hậu tố tên file theo giờ Việt Nam: YYYYMMDD-HHmm. */
export function vnFileStamp(date = new Date()): string {
  const s = new Date(date.getTime() + VN_OFFSET_MS).toISOString();
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}-${s.slice(11, 13)}${s.slice(14, 16)}`;
}
