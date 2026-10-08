import { KeyRound } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../services/api';
import { staffLogin } from '../services/handoverApi';
import { Button } from './ui/Button';
import { describedBy, Field } from './ui/Field';
import { useModalDialog } from './ui/modalLayer';

/** Màn hình nhập mã truy cập nội bộ (chỉ xuất hiện khi Worker cấu hình STAFF_ACCESS_CODE). */
export function StaffGate({
  onSuccess,
  titleId,
  description = 'Nhập mã do phòng Hành chính / IT cung cấp để gửi đề xuất văn phòng phẩm.',
}: {
  onSuccess: () => void;
  /** Có id → tiêu đề là h2 (trong hộp thoại, gắn aria-labelledby); không có → h1 của trang. */
  titleId?: string;
  description?: string;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const Heading = titleId ? 'h2' : 'h1';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    if (!code.trim()) {
      setError('Nhập mã truy cập nội bộ.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      await staffLogin(code.trim());
      setCode('');
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, 'Mã truy cập không đúng.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={handleSubmit} noValidate className="card space-y-5 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <Heading id={titleId} className="text-lg font-semibold text-brand-900">
              Mã truy cập nội bộ
            </Heading>
            <p className="text-sm text-stone-600">{description}</p>
          </div>
        </div>
        <Field id="staff-code" label="Mã truy cập" required error={error}>
          <input
            id="staff-code"
            type="password"
            autoComplete="current-password"
            className="field-input"
            value={code}
            maxLength={256}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy('staff-code', error)}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
          />
        </Field>
        <Button type="submit" size="lg" fullWidth loading={loading}>
          Tiếp tục
        </Button>
      </form>
    </div>
  );
}

/**
 * Phiên mã truy cập hết hạn GIỮA CHỪNG (hết hạn / mã vừa được đổi): nhập lại mã trong hộp thoại phía trên trang —
 * trang và nội dung đang nhập được giữ (trước đây cả form đề xuất bị xóa, phải nhập lại từ đầu).
 */
export function StaffGateDialog({ open, onSuccess }: { open: boolean; onSuccess: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, open);
  return (
    <dialog
      ref={ref}
      aria-labelledby="staff-gate-dialog-title"
      className="m-auto w-[min(94vw,28rem)] bg-transparent p-0"
      onCancel={(event) => event.preventDefault()}
    >
      {open && (
        <StaffGate
          titleId="staff-gate-dialog-title"
          description="Phiên truy cập đã hết hạn (hoặc mã truy cập vừa được đổi). Nhập lại mã để tiếp tục — nội dung đang nhập vẫn được giữ, sau đó bấm gửi lại."
          onSuccess={onSuccess}
        />
      )}
    </dialog>
  );
}
