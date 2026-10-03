import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../services/api';
import { staffLogin } from '../services/handoverApi';
import { Button } from './ui/Button';
import { describedBy, Field } from './ui/Field';

/** Màn hình nhập mã truy cập nội bộ (chỉ xuất hiện khi Worker cấu hình STAFF_ACCESS_CODE). */
export function StaffGate({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError('Nhập mã truy cập nội bộ.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      await staffLogin(code.trim());
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
          <span className="flex size-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-brand-900">Mã truy cập nội bộ</h1>
            <p className="text-sm text-stone-600">Nhập mã do phòng Hành chính / IT cung cấp để tạo biên bản.</p>
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
