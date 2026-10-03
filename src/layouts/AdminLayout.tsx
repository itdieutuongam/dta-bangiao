import { FilePlus2, ListChecks, LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { BrandMark } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { ErrorState, Spinner } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import AdminLoginPage from '../pages/admin/AdminLoginPage';
import { adminLogout, adminMe, adminRefreshCache } from '../services/adminApi';
import { errorMessage, isApiError } from '../services/api';
import { cn } from '../utils/cn';
import { AdminContext, type AdminContextValue } from './adminContext';

type SessionState = 'checking' | 'anonymous' | 'authenticated' | 'error';

export default function AdminLayout() {
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState<SessionState>('checking');
  const [checkError, setCheckError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkSession = useCallback(async () => {
    setState('checking');
    try {
      await adminMe();
      setState('authenticated');
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setState('anonymous');
      } else {
        setCheckError(err);
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const contextValue = useMemo<AdminContextValue>(
    () => ({
      handleError: (error, fallback) => {
        if (isApiError(error) && error.status === 401) {
          setState('anonymous');
          toast.show('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'info');
          return;
        }
        toast.show(errorMessage(error, fallback), 'error');
      },
    }),
    [toast],
  );

  async function handleLogout() {
    try {
      await adminLogout();
    } catch {
      // cookie vẫn hết hạn phía trình duyệt khi đóng phiên
    }
    setState('anonymous');
    toast.show('Đã đăng xuất.', 'info');
    navigate('/admin');
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await adminRefreshCache();
      toast.show(`Đã làm mới dữ liệu: ${result.employees} nhân viên, ${result.categories} loại bàn giao.`);
    } catch (err) {
      contextValue.handleError(err, 'Không làm mới được dữ liệu.');
    } finally {
      setRefreshing(false);
    }
  }

  if (state === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Đang kiểm tra phiên đăng nhập…" />
      </div>
    );
  }
  if (state === 'anonymous') {
    return <AdminLoginPage onSuccess={() => setState('authenticated')} />;
  }
  if (state === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorState title="Không kết nối được máy chủ." error={checkError} onRetry={() => void checkSession()} />
      </div>
    );
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-brand-100 text-brand-900' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
    );

  return (
    <AdminContext value={contextValue}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Bỏ qua tới nội dung chính
        </a>
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
            <Link to="/admin" className="min-w-0 rounded-lg" aria-label="Trang quản trị – danh sách biên bản">
              <BrandMark compact subtitle="Quản trị bàn giao" />
            </Link>
            <nav aria-label="Quản trị" className="flex flex-wrap items-center gap-1">
              <NavLink to="/admin" end className={navClass}>
                <ListChecks className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Biên bản</span>
                <span className="sr-only sm:hidden">Danh sách biên bản</span>
              </NavLink>
              <NavLink to="/" className={navClass}>
                <FilePlus2 className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Tạo bàn giao</span>
                <span className="sr-only sm:hidden">Tạo bàn giao</span>
              </NavLink>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                loading={refreshing}
                icon={<RefreshCw className="size-4" aria-hidden="true" />}
                title="Làm mới cache danh sách nhân viên / loại bàn giao sau khi sửa Google Sheet"
              >
                <span className="hidden lg:inline">Làm mới dữ liệu NV</span>
                <span className="sr-only lg:hidden">Làm mới dữ liệu nhân viên</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                icon={<LogOut className="size-4" aria-hidden="true" />}
              >
                <span className="hidden sm:inline">Đăng xuất</span>
                <span className="sr-only sm:hidden">Đăng xuất</span>
              </Button>
            </nav>
          </div>
          <div className="h-[3px] bg-gradient-to-r from-brand-700 via-gold-400 to-brand-700" aria-hidden="true" />
        </header>
        <main id="main" className="flex-1">
          <Outlet />
        </main>
      </div>
    </AdminContext>
  );
}
