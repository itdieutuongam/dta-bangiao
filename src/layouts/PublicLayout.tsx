import { ShieldCheck } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { BrandMark } from '../components/Brand';

/** Năm hiện tại cho dòng bản quyền — tính một lần khi tải trang (không gọi hàm "không thuần" trong lúc render). */
const CURRENT_YEAR = new Date().getFullYear();

export function PublicLayout() {
  const location = useLocation();
  const isConfirmPage = location.pathname.startsWith('/xac-nhan/');

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Bỏ qua tới nội dung chính
      </a>
      <header className="bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          {isConfirmPage ? (
            <BrandMark compact />
          ) : (
            <Link to="/" className="min-w-0 rounded-lg" aria-label="Diệu Tướng Am – Trang chủ hệ thống bàn giao nội bộ">
              <BrandMark />
            </Link>
          )}
          {!isConfirmPage && (
            <Link
              to="/admin"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Quản trị</span>
              <span className="sr-only sm:hidden">Trang quản trị</span>
            </Link>
          )}
        </div>
        <div className="h-[3px] bg-gradient-to-r from-brand-700 via-gold-400 to-brand-700" aria-hidden="true" />
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="px-4 py-5 text-center text-xs text-stone-500">
        © {CURRENT_YEAR} Diệu Tướng Am · Hệ thống bàn giao nội bộ
      </footer>
    </div>
  );
}
