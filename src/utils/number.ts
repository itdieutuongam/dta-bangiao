/** Ô số nguyên (số lượng, định mức, tồn) hoặc ô tiền (cho phép phần lẻ sau dấu phẩy). */
export type NumberKind = 'integer' | 'decimal';

/**
 * Đọc số người dùng gõ theo cách viết Việt Nam — đúng như trang hiển thị ("31.000 ₫"):
 *   "1000", "1.000", "1 000" → 1000 · "1.500.000" → 1500000 · ô tiền: "12,5" → 12.5, "1.000,5" → 1000.5.
 * Cách viết hiểu được hai nghĩa thì KHÔNG đoán: "1.5", "1,500", "15,000", "1,5" ở ô số nguyên… → NaN (ô báo lỗi thay
 * vì âm thầm lưu số sai — trước đây "15.000" bị đọc thành 15). Để trống → null.
 */
export function parseViNumber(text: string, kind: NumberKind = 'integer'): number | null {
  const t = text.replace(/\s/g, '');
  if (t === '') return null;
  const m = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(t);
  if (!m) return NaN;
  const [, sign = '', whole = '', fraction] = m;
  // "15,000" / "1,500": hàng nghìn kiểu tiếng Anh hay phần lẻ kiểu Việt? Không đoán.
  if (fraction !== undefined && (kind === 'integer' || (fraction.length === 3 && !whole.includes('.')))) return NaN;
  const n = Number(`${sign}${whole.replace(/\./g, '')}${fraction === undefined ? '' : `.${fraction}`}`);
  return Number.isFinite(n) ? n : NaN;
}

/** Thông báo cho ô có chữ không đọc được thành số; null = hợp lệ (hoặc để trống — ô bắt buộc tự kiểm tra). */
export function numberFormatError(text: string, kind: NumberKind = 'integer'): string | null {
  if (!Number.isNaN(parseViNumber(text, kind))) return null;
  return kind === 'integer'
    ? 'Nhập số nguyên, ví dụ 25 hoặc 1.000 (dấu chấm phân cách hàng nghìn).'
    : 'Nhập số tiền, ví dụ 15000 hoặc 15.000 (dấu chấm phân cách hàng nghìn, dấu phẩy trước phần lẻ).';
}

/** Số → chữ điền sẵn vào ô nhập: không dấu phân cách, phần lẻ sau dấu phẩy — parseViNumber đọc lại ra đúng số. */
export function numberToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

/**
 * Lỗi định dạng của các ô số → ghép vào lỗi kiểm tra (thông báo định dạng cụ thể hơn "phải là số" của schema nên ưu tiên).
 * fields: { tên trường: [chữ trong ô, loại ô] }.
 */
export function withNumberFormatErrors(
  errors: Record<string, string>,
  fields: Record<string, readonly [text: string, kind: NumberKind]>,
): Record<string, string> {
  const result = { ...errors };
  for (const [key, [text, kind]] of Object.entries(fields)) {
    const message = numberFormatError(text, kind);
    if (message) result[key] = message;
  }
  return result;
}
