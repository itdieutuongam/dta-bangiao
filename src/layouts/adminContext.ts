import { createContext, use } from 'react';

export interface AdminContextValue {
  /** Xử lý lỗi chung: 401 → về màn hình đăng nhập; lỗi khác → toast. */
  handleError: (error: unknown, fallback?: string) => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = use(AdminContext);
  if (!ctx) throw new Error('useAdmin phải dùng bên trong AdminLayout');
  return ctx;
}
