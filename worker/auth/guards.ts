import type { AdminUser } from '../../shared/types';
import type { RequestContext } from '../types';
import { ApiError } from '../utils/http';
import { readAdminConfig } from './adminUsers';
import { adminUserOf, readSession, type SessionClaims } from './session';

export interface AdminSession {
  claims: SessionClaims;
  user: AdminUser;
  /** Gửi sang Apps Script để ghi nhật ký "ai đã làm". */
  actor: { id: string; name: string };
}

export async function requireAdmin(c: RequestContext): Promise<AdminSession> {
  const claims = await readSession(c, 'admin');
  if (!claims) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập quản trị đã hết hạn. Vui lòng đăng nhập lại.', {
      details: { loginMode: readAdminConfig(c.env).mode },
    });
  }
  const user = adminUserOf(c.env, claims);
  return { claims, user, actor: { id: user.username, name: user.name } };
}

/** Nếu cấu hình STAFF_ACCESS_CODE: yêu cầu phiên nhân viên (hoặc phiên admin). Dùng cho trang đề xuất VPP. */
export async function requireStaff(c: RequestContext): Promise<void> {
  if (!c.env.STAFF_ACCESS_CODE?.trim()) return;
  if (await readSession(c, 'staff')) return;
  if (await readSession(c, 'admin')) return;
  throw new ApiError(401, 'STAFF_AUTH_REQUIRED', 'Vui lòng nhập mã truy cập nội bộ để tiếp tục.');
}
