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

/** Chuẩn hóa để dò mật khẩu: NFKC (dấu "：" "＝" full-width → ":" "="), bỏ dấu tiếng Việt, chữ thường. */
function passwordScanText(input: string): string {
  return normalizeVietnamese(input.normalize('NFKC'));
}

/** Mọi từ khóa — kể cả "pass", "pw" (cũng có nghĩa "chuyển giao"): chỉ tính khi NGAY SAU là ":" / "=". */
const PASSWORD_KEY_ANY = /(?:^|[^a-z0-9])(?:password|passwd|passcode|pass|pwd|pw|mat khau|matkhau|mk)\s*[:=]\s*\S/;
/** Từ khóa chắc chắn là mật khẩu — cho phép tối đa 2 từ chen giữa ("mật khẩu wifi: …", "mật khẩu mới = …") hoặc "là" / "is". */
const PASSWORD_KEY_STRONG = /(?:^|[^a-z0-9])(?:password|passwd|passcode|pwd|mat khau|matkhau|mk)(?:\s+[a-z0-9]+){0,2}\s*(?:[:=]|\bla\b|\bis\b)\s*\S/;
/** "MK 123456", "mật khẩu Abc@1234": từ khóa chắc chắn + một chuỗi ≥ 6 ký tự có chữ số (không phải ngày). */
const PASSWORD_KEY_VALUE = /(?:^|[^a-z0-9])(?:password|passwd|pwd|mat khau|matkhau|mk)\s+(\S{6,})/g;
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?$/;
/** Link chứa tài khoản: https://user:matkhau@host. */
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/;

/**
 * Phát hiện chuỗi có dạng khai báo mật khẩu: "password: abc", "mật khẩu = 123", "MK: x", "mật khẩu là 123", "mật khẩu wifi：abc",
 * "MK 123456", link "https://user:pw@host". Hệ thống tuyệt đối không lưu mật khẩu của tài khoản được bàn giao (biên bản đã ký
 * không sửa / xóa được, link xác nhận không hết hạn). Khớp containsPasswordLike_ (Utils.gs).
 */
export function containsPasswordLike(input: string): boolean {
  if (!input) return false;
  const text = passwordScanText(input);
  if (PASSWORD_KEY_ANY.test(text) || PASSWORD_KEY_STRONG.test(text) || URL_CREDENTIALS.test(text)) return true;
  for (const m of text.matchAll(PASSWORD_KEY_VALUE)) {
    const value = m[1]!.replace(/[.,;)]+$/, '');
    if (/\d/.test(value) && !DATE_LIKE.test(value)) return true;
  }
  return false;
}

const EMAIL_THEN_VALUE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\s*(?:[/|;,]|\s-\s)\s*(\S{4,})/g;
const EMAIL_LIKE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const PHONE_LIKE = /^(?:\+?84|0)\d{8,10}$/;

/**
 * Mục TÀI KHOẢN: cặp "email / mật khẩu" ("abc@dta.vn / Abc@123", "abc@dta.vn | 12345678") — dạng đã làm lộ mật khẩu ở dữ liệu thật.
 * Bỏ qua khi phía sau là email khác hoặc số điện thoại. Khớp containsCredentialPair_ (Utils.gs).
 */
export function containsCredentialPair(input: string): boolean {
  if (!input) return false;
  for (const m of passwordScanText(input).matchAll(EMAIL_THEN_VALUE)) {
    const value = m[1]!.replace(/[.,;)]+$/, '');
    if (value.length >= 4 && !EMAIL_LIKE.test(value) && !PHONE_LIKE.test(value.replace(/[\s.-]/g, ''))) return true;
  }
  return false;
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
