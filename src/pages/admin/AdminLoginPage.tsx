import { Lock, LogIn } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AdminLoginMode, SessionInfo } from '../../../shared/types';
import { BrandMark } from '../../components/Brand';
import { Button } from '../../components/ui/Button';
import { describedBy, Field } from '../../components/ui/Field';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { adminLogin } from '../../services/adminApi';
import { ApiClientError, errorMessage } from '../../services/api';

/**
 * Form đăng nhập quản trị — dùng cho trang đăng nhập và hộp thoại "đăng nhập lại" khi phiên hết hạn giữa chừng.
 * mode "users": tài khoản riêng (ADMIN_USERS) → cần tên đăng nhập; "shared": mật khẩu chung (ADMIN_PASSWORD).
 */
export function AdminLoginForm({
  mode,
  onSuccess,
  title = 'Đăng nhập quản trị',
  titleId,
  intro,
}: {
  mode: AdminLoginMode;
  onSuccess: (session: SessionInfo) => void;
  title?: string;
  /** Có id → tiêu đề là h2 (trong hộp thoại, gắn aria-labelledby); không có → h1 của trang. */
  titleId?: string;
  intro?: ReactNode;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  // Máy chủ đòi tên đăng nhập dù trang chưa biết (phiên cũ hết hạn trước khi biết kiểu đăng nhập…) → hiện ô tên đăng nhập.
  const [usernameRequired, setUsernameRequired] = useState(false);
  const needsUsername = mode === 'users' || usernameRequired;
  const Heading = titleId ? 'h2' : 'h1';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const next: typeof errors = {};
    if (needsUsername && !username.trim()) next.username = 'Nhập tên đăng nhập.';
    if (!password) next.password = 'Nhập mật khẩu quản trị.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const session = await adminLogin(password, needsUsername ? username.trim() : '');
      setPassword('');
      onSuccess(session);
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.username) {
        setUsernameRequired(true);
        setErrors({ username: err.fieldErrors.username });
      } else {
        setErrors({ password: errorMessage(err, 'Đăng nhập thất bại. Vui lòng thử lại.') });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card space-y-5 p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <Heading id={titleId} className="text-lg font-semibold text-brand-900">
          {title}
        </Heading>
      </div>
      {intro}
      {needsUsername && (
        <Field id="admin-username" label="Tên đăng nhập" required error={errors.username}>
          <input
            id="admin-username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="field-input"
            value={username}
            maxLength={60}
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={describedBy('admin-username', errors.username)}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
          />
        </Field>
      )}
      <Field id="admin-password" label="Mật khẩu" required error={errors.password}>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          className="field-input"
          value={password}
          maxLength={256}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={describedBy('admin-password', errors.password)}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus={!needsUsername}
        />
      </Field>
      <Button type="submit" size="lg" fullWidth loading={loading} icon={<LogIn className="size-4" aria-hidden="true" />}>
        Đăng nhập
      </Button>
    </form>
  );
}

export default function AdminLoginPage({ mode, onSuccess }: { mode: AdminLoginMode; onSuccess: (session: SessionInfo) => void }) {
  useDocumentTitle('Đăng nhập quản trị');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandMark subtitle="Quản trị nội bộ" />
        </div>
        <AdminLoginForm mode={mode} onSuccess={onSuccess} />
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="font-medium text-brand-700 hover:underline">
            ← Về trang chủ
          </Link>
        </p>
      </div>
    </div>
  );
}
