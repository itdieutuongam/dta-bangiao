import { createContext } from 'react';

/**
 * "Kỷ nguyên tải lại" của khu quản trị: AdminLayout tăng số này sau khi ĐĂNG NHẬP LẠI (phiên hết hạn) và sau "Làm mới dữ liệu".
 * useAsync đưa số này vào deps → mọi trang đang mở tự tải lại dữ liệu (trang từng lỗi 401 hiện lại nội dung; danh sách nhân viên /
 * loại bàn giao trong form cập nhật mà dữ liệu đang nhập vẫn giữ). Ngoài khu quản trị luôn là 0.
 */
export const ReloadEpochContext = createContext(0);

/** Sự kiện window khi API quản trị trả 401 (phiên hết hạn) — AdminLayout mở hộp thoại đăng nhập lại, kể cả khi lỗi xảy ra trong hộp thoại. */
export const ADMIN_UNAUTHORIZED_EVENT = 'dta:admin-unauthorized';
