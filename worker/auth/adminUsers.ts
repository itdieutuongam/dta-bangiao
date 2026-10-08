import type { AdminLoginMode, AdminUser } from '../../shared/types';
import { RECORD_SEAL_SECRET_MIN_LENGTH } from '../services/seal';
import type { Env } from '../types';

/**
 * Tài khoản quản trị.
 *   • ADMIN_USERS (khuyến nghị): secret JSON — mỗi người một tài khoản, nhật ký ghi rõ ai thao tác:
 *       [{"username":"thai","name":"Phạm Danh Thái","password":"<≥ 12 ký tự>"}, …]
 *   • ADMIN_PASSWORD (tương thích bản cũ): một mật khẩu dùng chung, người thao tác ghi là "Quản trị viên".
 * Khi có ADMIN_USERS thì ADMIN_PASSWORD không còn dùng để đăng nhập.
 */

export interface AdminAccount extends AdminUser {
  password: string;
}

export interface AdminConfig {
  mode: AdminLoginMode;
  accounts: AdminAccount[];
  /** Lỗi cấu hình (không chứa giá trị secret) — có thì không cho đăng nhập. */
  error: string | null;
}

export const SHARED_ADMIN: AdminUser = { username: 'admin', name: 'Quản trị viên' };
const USERNAME_PATTERN = /^[a-z0-9._-]{2,40}$/;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
/** Độ dài khuyến nghị tối thiểu của STAFF_ACCESS_CODE (chỉ cảnh báo trên trang Cài đặt, không chặn). */
export const MIN_STAFF_CODE_LENGTH = 10;

export function readAdminConfig(env: Env): AdminConfig {
  const raw = env.ADMIN_USERS?.trim();
  if (!raw) {
    const shared = env.ADMIN_PASSWORD?.trim();
    return shared
      ? { mode: 'shared', accounts: [{ ...SHARED_ADMIN, password: shared }], error: null }
      : { mode: 'shared', accounts: [], error: 'Chưa cấu hình ADMIN_USERS hoặc ADMIN_PASSWORD.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mode: 'users', accounts: [], error: 'ADMIN_USERS không phải JSON hợp lệ.' };
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) {
    return { mode: 'users', accounts: [], error: 'ADMIN_USERS phải là mảng 1–50 tài khoản.' };
  }
  const accounts: AdminAccount[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const username = String(record.username ?? '').trim().toLowerCase();
    const name = String(record.name ?? '').trim();
    const password = String(record.password ?? '');
    if (!USERNAME_PATTERN.test(username)) {
      return { mode: 'users', accounts: [], error: `ADMIN_USERS[${index}]: username chỉ gồm a-z, 0-9, . _ - (2–40 ký tự).` };
    }
    if (seen.has(username)) return { mode: 'users', accounts: [], error: `ADMIN_USERS: username "${username}" bị trùng.` };
    if (!name || name.length > 80) return { mode: 'users', accounts: [], error: `ADMIN_USERS[${index}]: thiếu name (≤ 80 ký tự).` };
    if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
      return { mode: 'users', accounts: [], error: `ADMIN_USERS[${index}]: mật khẩu của "${username}" phải ≥ ${MIN_ADMIN_PASSWORD_LENGTH} ký tự.` };
    }
    seen.add(username);
    accounts.push({ username, name, password });
  }
  return { mode: 'users', accounts, error: null };
}

export function findAdminAccount(config: AdminConfig, username: string | undefined): AdminAccount | null {
  if (config.mode === 'shared') return config.accounts[0] ?? null;
  const key = (username ?? '').trim().toLowerCase();
  return config.accounts.find((a) => a.username === key) ?? null;
}

/** Cảnh báo cấu hình hiển thị trên trang quản trị (không lộ giá trị secret). */
export function adminConfigWarnings(env: Env, config: AdminConfig): string[] {
  const warnings: string[] = [];
  if (config.mode === 'shared') {
    warnings.push('Đang dùng mật khẩu quản trị dùng chung (ADMIN_PASSWORD) — nên cấu hình ADMIN_USERS để nhật ký ghi rõ ai thao tác.');
    if ((env.ADMIN_PASSWORD?.trim().length ?? 0) < MIN_ADMIN_PASSWORD_LENGTH) {
      warnings.push(`Mật khẩu quản trị ngắn hơn ${MIN_ADMIN_PASSWORD_LENGTH} ký tự — hãy đặt mật khẩu ngẫu nhiên dài hơn.`);
    }
  }
  const staffCode = env.STAFF_ACCESS_CODE?.trim() ?? '';
  if (!staffCode) {
    warnings.push('Trang đề xuất văn phòng phẩm (/de-xuat-vpp) đang mở công khai — nên đặt STAFF_ACCESS_CODE.');
  } else if (staffCode.length < MIN_STAFF_CODE_LENGTH) {
    // Mã chỉ bị giới hạn số lần thử theo IP (10 lần / phút) — mã ngắn dò được bằng nhiều IP.
    warnings.push(`Mã truy cập nội bộ (STAFF_ACCESS_CODE) ngắn hơn ${MIN_STAFF_CODE_LENGTH} ký tự — nên dùng mã dài hơn, có cả chữ và số.`);
  }
  if ((env.RECORD_SEAL_SECRET?.trim().length ?? 0) < RECORD_SEAL_SECRET_MIN_LENGTH) {
    warnings.push(
      `Chưa đặt RECORD_SEAL_SECRET (≥ ${RECORD_SEAL_SECRET_MIN_LENGTH} ký tự ngẫu nhiên) — biên bản đã ký chỉ được bảo vệ bằng mã băm thường: ` +
        'người sửa được Google Sheet có thể tự tính lại mã. Đặt secret này để niêm phong biên bản (lưu giữ cẩn thận, KHÔNG đổi sau khi đã dùng).',
    );
  }
  return warnings;
}
