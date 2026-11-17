/**
 * Chuyển danh sách mặt hàng đã chọn ở trang Xuất kho sang form "Phiếu văn phòng phẩm" (người nhận ký nhận) — qua sessionStorage
 * của chính tab (không lưu lâu dài, không gửi đi đâu). Trang tạo phiếu đọc một lần rồi xóa.
 */
export const VPP_PREFILL_KEY = 'dta:vpp-prefill';

export interface VppPrefill {
  lines: Array<{ productId: string; quantity: number }>;
  receiverEmployeeId?: string;
}

export function saveVppPrefill(prefill: VppPrefill): void {
  try {
    sessionStorage.setItem(VPP_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // Trình duyệt chặn sessionStorage → form trống, người dùng chọn lại.
  }
}

export function takeVppPrefill(): VppPrefill | null {
  try {
    const raw = sessionStorage.getItem(VPP_PREFILL_KEY);
    sessionStorage.removeItem(VPP_PREFILL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<VppPrefill>;
    if (!Array.isArray(data.lines)) return null;
    const lines = data.lines
      .filter((l) => l && typeof l.productId === 'string' && Number.isInteger(l.quantity) && l.quantity > 0)
      .slice(0, 50)
      .map((l) => ({ productId: l.productId, quantity: l.quantity }));
    return lines.length ? { lines, receiverEmployeeId: typeof data.receiverEmployeeId === 'string' ? data.receiverEmployeeId : '' } : null;
  } catch {
    return null;
  }
}
