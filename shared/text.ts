/**
 * Chuẩn hóa chuỗi tiếng Việt để tìm kiếm không phân biệt dấu / hoa thường.
 * "Phạm Danh Thái" → "pham danh thai"; "Đỗ" → "do".
 */
export function normalizeVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phát hiện chuỗi có dạng khai báo mật khẩu ("password: abc", "mật khẩu = 123", "MK: x").
 * Hệ thống tuyệt đối không lưu mật khẩu của tài khoản được bàn giao.
 */
export function containsPasswordLike(input: string): boolean {
  if (!input) return false;
  const text = normalizeVietnamese(input);
  return /(?:^|[^a-z0-9])(?:password|passwd|passcode|pass|pwd|pw|mat khau|matkhau|mk)\s*[:=]\s*\S/.test(text);
}

/**
 * Loại bỏ ký tự điều khiển (giữ xuống dòng / tab), ký tự điều khiển C1, ký tự định hướng chữ (bidi: override / isolate / mark,
 * kể cả Arabic Letter Mark U+061C) và ký tự vô hình (zero-width, soft hyphen, combining grapheme joiner, ký tự đệm Hangul, ký tự
 * "tag" U+E0000–E007F) — có thể dùng để giả mạo cách hiển thị tên / nội dung ("SN 12-34" hiện thành "34-12").
 * Khớp stripControl_ (Utils.gs).
 */
export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g, '')
    // Dấu kết hợp vô hình (combining grapheme joiner U+034F, nguyên âm ẩn Khmer U+17B4 / U+17B5) để riêng: trong [...] chúng
    // dính vào ký tự đứng trước (no-misleading-character-class).
    .replace(/\u034F|\u17B4|\u17B5/g, '')
    .replace(/\uDB40[\uDC00-\uDC7F]/g, '');
}

export function isValidDateOnly(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Link http(s) hợp lệ — cùng quy tắc với isHttpUrl_ (Utils.gs): bắt đầu đúng "http://" / "https://", không có khoảng trắng,
 * dấu nháy, < >. Thêm kiểm tra bằng URL parser để loại link sai cấu trúc. Hai bên khác quy tắc thì Worker cho qua
 * nhưng Apps Script từ chối với thông báo khó hiểu.
 */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s<>"']+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Khóa so khớp tên GIỮ DẤU tiếng Việt — chỉ bỏ khác biệt hoa / thường, khoảng trắng và dạng Unicode (NFC / NFD):
 * "Kéo" ≠ "Kẹo" ≠ "Keo". Khớp exactNameKey_ (Utils.gs) — dùng khi kiểm tra tên trùng giống máy chủ.
 */
export function exactNameKey(input: string): string {
  return input.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Hai ĐVT có chắc chắn là một không — GIỮ DẤU ("Cuốn" ≠ "Cuộn", "Bó" ≠ "Bộ"), chỉ bỏ khác biệt hoa / thường, khoảng trắng, dấu
 * câu. Một bên trống = chưa rõ → khác (phải quy đổi thủ công). Khớp sameUnit_ (Vpp.gs). Trước đây so bỏ dấu: GHÉP "5 Cuốn" vào
 * sản phẩm tính theo "Cuộn" không bị hỏi quy đổi.
 */
export function sameUnit(a: string, b: string): boolean {
  const key = (unit: string) => exactNameKey(unit).replace(/[\s.,;:/\\()[\]{}"'`+*&|_-]+/g, ' ').trim();
  return Boolean(a && b && key(a) === key(b));
}
