import { useEffect } from 'react';
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
 */
export function useUnsavedChangesWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(LEAVE_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
}
