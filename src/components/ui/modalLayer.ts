import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * Các <dialog> modal đang mở, theo thứ tự mở. Khi có hộp thoại modal, mọi thứ NGOÀI hộp thoại trên cùng bị trình duyệt coi là
 * "inert": nằm dưới lớp phủ, không bấm được, trình đọc màn hình không đọc — thông báo (toast) phải hiện BÊN TRONG hộp thoại đó.
 */
const stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function topModal(): HTMLDialogElement | null {
  // Bỏ qua hộp thoại đã rời khỏi trang (thành phần cha bị gỡ trong lúc hộp thoại còn mở).
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.isConnected) return stack[i]!;
  return null;
}

/** Hộp thoại modal trên cùng đang mở (null: không có). */
export function useTopModal(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribe, topModal, () => null);
}

/** Mở / đóng <dialog> bằng showModal() theo `open` (focus trap + Esc + aria-modal sẵn có) và ghi nhận hộp thoại đang mở. */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    stack.push(dialog);
    emit();
    return () => {
      const index = stack.lastIndexOf(dialog);
      if (index >= 0) stack.splice(index, 1);
      emit();
    };
  }, [ref, open]);
}
