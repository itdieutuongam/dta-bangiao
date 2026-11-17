import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

const SUFFIX = 'Bàn giao nội bộ – Diệu Tướng Am';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;
  }, [title]);
}

const LEAVE_MESSAGE = 'Rời trang này? Nội dung đang nhập chưa được lưu sẽ bị mất.';

/**
 * Cảnh báo khi rời trang lúc form đang có dữ liệu chưa lưu: tải lại / đóng tab (beforeunload) và điều hướng trong ứng dụng
 * (nút Back của trình duyệt / Android, link menu…) — trước đây chỉ có beforeunload nên bấm Back là mất form không hỏi.
 * Chỉ đổi tham số trên URL (cùng trang) thì không hỏi.
 *
 * Trả về `allowLeave()`: gọi ngay trước một lần chuyển trang CÓ CHỦ ĐÍCH mang dữ liệu đang nhập sang trang khác (ví dụ các mặt hàng
 * đang chọn ở Xuất kho → form phiếu bàn giao) — lần đó không hỏi “chưa được lưu sẽ bị mất” (vì không mất gì).
 */
export function useUnsavedChangesWarning(active: boolean): () => void {
  const bypass = useRef(false);
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && !bypass.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(LEAVE_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  return useCallback(() => {
    bypass.current = true;
  }, []);
}
