import { createContext, use } from 'react';
import type { AdminUser } from '../../shared/types';

export interface AdminContextValue {
  /** Xử lý lỗi chung: 401 → về màn hình đăng nhập; lỗi khác → toast. */
  handleError: (error: unknown, fallback?: string) => void;
  /** Quản trị viên đang đăng nhập. */
  user: AdminUser | null;
  /** Cảnh báo cấu hình (mật khẩu chung, chưa đặt mã truy cập…). */
  warnings: string[];
  /** Tải lại ngay số việc cần xử lý trên menu — gọi sau thao tác làm đổi số đó (sửa / hủy phiếu, duyệt đề xuất…). */
  refreshBadges: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = use(AdminContext);
  if (!ctx) throw new Error('useAdmin phải dùng bên trong AdminLayout');
  return ctx;
}
