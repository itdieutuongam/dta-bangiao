import type { RequestContext } from '../types';
import { ApiError } from '../utils/http';
import { readSession, type SessionClaims } from './session';

export async function requireAdmin(c: RequestContext): Promise<SessionClaims> {
  const session = await readSession(c, 'admin');
  if (!session) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập quản trị đã hết hạn. Vui lòng đăng nhập lại.');
  }
  return session;
}

/** Nếu cấu hình STAFF_ACCESS_CODE: yêu cầu phiên nhân viên (hoặc phiên admin). */
export async function requireStaff(c: RequestContext): Promise<void> {
  if (!c.env.STAFF_ACCESS_CODE?.trim()) return;
  if (await readSession(c, 'staff')) return;
  if (await readSession(c, 'admin')) return;
  throw new ApiError(401, 'STAFF_AUTH_REQUIRED', 'Vui lòng nhập mã truy cập nội bộ để tiếp tục.');
}
