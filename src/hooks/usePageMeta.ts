import { useEffect } from 'react';

const SUFFIX = 'Bàn giao nội bộ – Diệu Tướng Am';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;
  }, [title]);
}

/** Cảnh báo khi rời trang lúc form đang có dữ liệu chưa lưu. */
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
}
