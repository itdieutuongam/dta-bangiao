import { Lock, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../../components/Brand';
import { Button } from '../../components/ui/Button';
import { describedBy, Field } from '../../components/ui/Field';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { adminLogin } from '../../services/adminApi';
import { errorMessage } from '../../services/api';

export default function AdminLoginPage({ onSuccess }: { onSuccess: () => void }) {
  useDocumentTitle('Đăng nhập quản trị');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError('Nhập mật khẩu quản trị.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      await adminLogin(password);
      setPassword('');
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, 'Đăng nhập thất bại. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandMark subtitle="Quản trị bàn giao" />
        </div>
        <form onSubmit={handleSubmit} noValidate className="card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <Lock className="size-5" aria-hidden="true" />
            </span>
            <h1 className="text-lg font-semibold text-brand-900">Đăng nhập quản trị</h1>
          </div>
          <Field id="admin-password" label="Mật khẩu" required error={error}>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              className="field-input"
              value={password}
              maxLength={256}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy('admin-password', error)}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            icon={<LogIn className="size-4" aria-hidden="true" />}
          >
            Đăng nhập
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="font-medium text-brand-700 hover:underline">
            ← Về trang tạo bàn giao
          </Link>
        </p>
      </div>
    </div>
  );
}
