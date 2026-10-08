import { useId, useRef, type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Button, type ButtonVariant } from './Button';
import { useModalDialog } from './modalLayer';
import { InlineAlert } from './States';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  loading?: boolean;
  confirmDisabled?: boolean;
  /** Hộp thoại rộng hơn cho form nhiều trường. */
  wide?: boolean;
  /** Lỗi khi thực hiện — hiện ngay trong hộp thoại (role="alert"), cạnh ô / nút liên quan. */
  error?: ReactNode;
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
  confirmDisabled = false,
  wide = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useModalDialog(ref, open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (loading) event.preventDefault();
      }}
      className={cn(
        'm-auto max-h-[92dvh] rounded-xl bg-white p-0 text-stone-900 shadow-2xl',
        wide ? 'w-[min(94vw,44rem)]' : 'w-[min(92vw,30rem)]',
      )}
    >
      <div className="max-h-[calc(92dvh-4.5rem)] space-y-3 overflow-y-auto p-5">
        <h2 id={titleId} className="text-lg font-semibold text-brand-900">
          {title}
        </h2>
        {description && <div className="text-sm text-stone-600">{description}</div>}
        {children}
        {error && <InlineAlert>{error}</InlineAlert>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
