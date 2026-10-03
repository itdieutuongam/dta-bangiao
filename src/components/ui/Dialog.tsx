import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Hộp thoại xác nhận dùng <dialog> gốc: focus trap + phím Esc + aria-modal sẵn có. */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Đóng',
  tone = 'primary',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (loading) event.preventDefault();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-xl bg-white p-0 text-stone-900 shadow-2xl"
    >
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-lg font-semibold text-brand-900">
          {title}
        </h2>
        {description && <div className="text-sm text-stone-600">{description}</div>}
        {children}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
