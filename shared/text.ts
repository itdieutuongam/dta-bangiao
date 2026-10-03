/**
 * Chuẩn hóa chuỗi tiếng Việt để tìm kiếm không phân biệt dấu / hoa thường.
 * "Phạm Danh Thái" → "pham danh thai"; "Đỗ" → "do".
 */
export function normalizeVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

/** Loại bỏ ký tự điều khiển (giữ xuống dòng / tab). */
export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
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

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
