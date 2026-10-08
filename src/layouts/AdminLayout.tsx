import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Database,
  FilePlus2,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  PackageSearch,
  RefreshCw,
  Ruler,
  Settings,
  ShoppingCart,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { AdminBadges, AdminLoginMode, AdminUser } from '../../shared/types';
import { BrandMark } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { useModalDialog } from '../components/ui/modalLayer';
import { ErrorState, Spinner } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import AdminLoginPage, { AdminLoginForm } from '../pages/admin/AdminLoginPage';
import { adminBadges, adminLogout, adminMe, adminRefreshCache } from '../services/adminApi';
import { errorMessage, isApiError } from '../services/api';
import { cn } from '../utils/cn';
import { AdminContext, type AdminContextValue } from './adminContext';

type SessionState = 'checking' | 'anonymous' | 'authenticated' | 'error';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Huy hiệu số việc cần xử lý (lấy từ /api/admin/badges). */
  badge?: keyof AdminBadges;
  badgeLabel?: string;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

const NAV: Array<NavItem | NavGroup> = [
  { to: '/admin', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  {
    label: 'Phiếu bàn giao',
    icon: ClipboardCheck,
    items: [
      { to: '/admin/ban-giao', label: 'Danh sách', icon: ListChecks, end: true, badge: 'revisionRequested', badgeLabel: 'yêu cầu chỉnh sửa' },
      { to: '/admin/ban-giao/tao-moi', label: 'Tạo phiếu', icon: FilePlus2 },
    ],
  },
  {
    label: 'Văn phòng phẩm',
    icon: Boxes,
    items: [
      { to: '/admin/vpp', label: 'Tổng quan', icon: LayoutDashboard, end: true },
      { to: '/admin/vpp/ton-kho', label: 'Tồn kho', icon: PackageSearch },
      { to: '/admin/vpp/dinh-muc', label: 'Định mức', icon: Ruler },
      { to: '/admin/vpp/de-xuat', label: 'Đề xuất mua', icon: ShoppingCart, badge: 'submittedProposals', badgeLabel: 'đề xuất chờ duyệt' },
      { to: '/admin/vpp/lich-su', label: 'Lịch sử kho', icon: History },
      { to: '/admin/vpp/data-review', label: 'Dữ liệu cần kiểm tra', icon: Database },
    ],
  },
  { to: '/admin/nhan-vien', label: 'Nhân viên', icon: Users },
  { to: '/admin/cai-dat', label: 'Cài đặt', icon: Settings },
];

function NavEntry({ item, badges, onNavigate }: { item: NavItem; badges: AdminBadges | null; onNavigate: () => void }) {
  const count = item.badge && badges ? badges[item.badge] : 0;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-100 text-brand-900' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
        )
      }
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {count > 0 && (
        <span className="ml-auto rounded-full bg-orange-600 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white tabular-nums">
          {count > 99 ? '99+' : count}
          <span className="sr-only"> {item.badgeLabel}</span>
        </span>
      )}
    </NavLink>
  );
}

function SidebarNav({ badges, onNavigate }: { badges: AdminBadges | null; onNavigate: () => void }) {
  return (
    <nav aria-label="Quản trị" className="space-y-1">
      {NAV.map((entry) =>
        'items' in entry ? (
          <div key={entry.label} className="pt-3">
            <p className="flex items-center gap-2 px-3 pb-1 text-[11px] font-bold tracking-wider text-stone-500 uppercase">
              <entry.icon className="size-3.5" aria-hidden="true" />
              {entry.label}
            </p>
            <div className="space-y-0.5 border-l border-stone-200 pl-2 ml-4">
              {entry.items.map((item) => (
                <NavEntry key={item.to} item={item} badges={badges} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ) : (
          <NavEntry key={entry.to} item={entry} badges={badges} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

/** Huy hiệu được làm mới khi đổi trang (tối đa 1 lần / 60 giây) và ngay sau thao tác làm đổi số — lỗi tải không chặn trang. */
const BADGE_REFRESH_MS = 60_000;

/** 401 của /api/admin/me và các API quản trị kèm details.loginMode — cho biết form đăng nhập có cần ô "Tên đăng nhập". */
function loginModeOf(error: unknown): AdminLoginMode | null {
  if (!isApiError(error)) return null;
  const mode = (error.details as { loginMode?: unknown } | undefined)?.loginMode;
  return mode === 'users' || mode === 'shared' ? mode : null;
}

export default function AdminLayout() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<SessionState>('checking');
  const [loginMode, setLoginMode] = useState<AdminLoginMode>('shared');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checkError, setCheckError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Phiên hết hạn khi đang làm việc: hiện hộp thoại đăng nhập lại PHÍA TRÊN trang — trang (và dữ liệu đang nhập) được giữ.
  const [reauth, setReauth] = useState(false);
  const [badges, setBadges] = useState<AdminBadges | null>(null);
  const badgesFetchedAt = useRef(0);
  const badgeRequest = useRef(0);
  const menuRef = useRef<HTMLDialogElement>(null);
  const reauthRef = useRef<HTMLDialogElement>(null);
  const stateRef = useRef<SessionState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Chưa đăng nhập / phiên hết hạn (401), với đúng kiểu đăng nhập máy chủ báo trong lỗi. Đang ở trang quản trị → hộp thoại
   * đăng nhập lại, KHÔNG thay cả trang bằng trang đăng nhập (trước đây form đang nhập dở — phiếu, đề xuất… — bị xóa sạch).
   */
  const showLogin = useCallback((error?: unknown) => {
    const mode = loginModeOf(error);
    if (mode) setLoginMode(mode);
    setMenuOpen(false);
    if (stateRef.current === 'authenticated') setReauth(true);
    else setState('anonymous');
  }, []);

  const checkSession = useCallback(async () => {
    setState('checking');
    try {
      const session = await adminMe();
      setUser(session.user ?? null);
      setWarnings(session.warnings ?? []);
      // Ghi nhớ kiểu đăng nhập: đăng xuất / hết phiên sau đó vẫn hiện đúng form (ADMIN_USERS → có ô "Tên đăng nhập").
      if (session.mode) setLoginMode(session.mode);
      setState('authenticated');
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        showLogin(err);
      } else {
        setCheckError(err);
        setState('error');
      }
    }
  }, [showLogin]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // Đóng menu mobile khi đổi trang.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Menu mobile là <dialog> gốc mở bằng showModal(): focus vào trong menu, Esc để đóng, Tab không ra ngoài lớp phủ.
  useModalDialog(menuRef, menuOpen);
  useModalDialog(reauthRef, reauth);

  /** Tải số việc cần xử lý trên menu — chỉ áp dụng kết quả của lần tải mới nhất. */
  const refreshBadges = useCallback(() => {
    const request = ++badgeRequest.current;
    badgesFetchedAt.current = Date.now();
    adminBadges().then(
      (data) => {
        if (request === badgeRequest.current) setBadges(data);
      },
      (err: unknown) => {
        if (request !== badgeRequest.current) return;
        if (isApiError(err) && err.status === 401) showLogin(err);
        // Lỗi khác: giữ số cũ; trang đang mở tự báo lỗi kết nối nếu có. Ghi lại để chẩn đoán.
        else console.warn('Không tải được số việc cần xử lý trên menu:', err);
      },
    );
  }, [showLogin]);

  // Huy hiệu "việc cần xử lý" trên menu: tải khi vào trang quản trị và khi đổi trang (cách nhau tối thiểu 60 giây).
  useEffect(() => {
    if (state !== 'authenticated' || Date.now() - badgesFetchedAt.current < BADGE_REFRESH_MS) return;
    refreshBadges();
  }, [state, location.pathname, refreshBadges]);

  const contextValue = useMemo<AdminContextValue>(
    () => ({
      user,
      warnings,
      refreshBadges,
      handleError: (error, fallback) => {
        if (isApiError(error) && error.status === 401) {
          // Hộp thoại đăng nhập lại tự giải thích "phiên đã hết hạn" — không cần thêm thông báo.
          showLogin(error);
          return;
        }
        toast.show(errorMessage(error, fallback), 'error');
      },
    }),
    [toast, user, warnings, refreshBadges, showLogin],
  );

  async function handleLogout() {
    try {
      await adminLogout();
    } catch (err) {
      // Cookie phiên chỉ bị xóa khi máy chủ trả lời — lỗi mạng mà báo "đã đăng xuất" thì người sau (máy dùng chung) mở lại
      // trang vẫn vào được quản trị. Nói rõ phiên VẪN còn (lỗi mạng chung chung không cho biết điều đó).
      toast.show(`Chưa đăng xuất được — phiên đăng nhập vẫn còn hiệu lực. ${errorMessage(err, 'Vui lòng thử lại.')}`, 'error');
      return;
    }
    setMenuOpen(false);
    setReauth(false);
    setState('anonymous');
    setUser(null);
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
    return (
      <AdminLoginPage
        mode={loginMode}
        onSuccess={(session) => {
          setUser(session.user ?? null);
          setWarnings(session.warnings ?? []);
          if (session.mode) setLoginMode(session.mode);
          setState('authenticated');
        }}
      />
    );
  }
  if (state === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorState title="Không kết nối được máy chủ." error={checkError} onRetry={() => void checkSession()} />
      </div>
    );
  }

  const sidebarFooter = (
    <div className="space-y-2 border-t border-stone-200 pt-3">
      {user && (
        <p className="truncate px-3 text-xs text-stone-500" title={user.name}>
          Đăng nhập: <span className="font-semibold text-stone-800">{user.name}</span>
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        className="justify-start"
        onClick={handleRefresh}
        loading={refreshing}
        icon={<RefreshCw className="size-4" aria-hidden="true" />}
        title="Làm mới cache nhân viên / loại bàn giao / danh mục VPP sau khi sửa Google Sheet"
      >
        Làm mới dữ liệu
      </Button>
      <Button variant="ghost" size="sm" fullWidth className="justify-start" onClick={handleLogout} icon={<LogOut className="size-4" aria-hidden="true" />}>
        Đăng xuất
      </Button>
    </div>
  );

  return (
    <AdminContext value={contextValue}>
      <div className="flex min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Bỏ qua tới nội dung chính
        </a>

        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-stone-200 bg-white px-3 py-4 lg:flex">
          <Link to="/admin" className="rounded-lg px-1" aria-label="Trang quản trị – tổng quan">
            <BrandMark compact subtitle="Quản trị nội bộ" />
          </Link>
          <div className="flex-1">
            <SidebarNav badges={badges} onNavigate={() => {}} />
          </div>
          {sidebarFooter}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Thanh trên mobile / tablet */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
            <Link to="/admin" className="min-w-0 rounded-lg" aria-label="Trang quản trị – tổng quan">
              <BrandMark compact subtitle="Quản trị nội bộ" />
            </Link>
            <Button
              id="admin-menu-button"
              variant="secondary"
              size="sm"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="admin-mobile-menu"
              icon={<Menu className="size-4" aria-hidden="true" />}
            >
              Menu
            </Button>
          </header>

          {/* Menu mobile: <dialog> modal (xem effect theo menuOpen). Bấm nền mờ → sự kiện rơi vào chính <dialog> → đóng. */}
          <dialog
            ref={menuRef}
            id="admin-mobile-menu"
            aria-label="Menu quản trị"
            className="m-0 h-dvh max-h-none w-[min(85vw,18rem)] max-w-none bg-white p-0 shadow-2xl"
            onClose={() => {
              setMenuOpen(false);
              // Trả focus về nút "Menu" (trình duyệt cũ không tự trả khi đóng <dialog>).
              document.getElementById('admin-menu-button')?.focus();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setMenuOpen(false);
            }}
          >
            <div className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
              <div className="flex items-center justify-between gap-2 px-1">
                <BrandMark compact subtitle="Quản trị nội bộ" />
                <Button variant="ghost" size="sm" onClick={() => setMenuOpen(false)} aria-label="Đóng menu" icon={<X className="size-4" aria-hidden="true" />} />
              </div>
              <div className="flex-1">
                <SidebarNav badges={badges} onNavigate={() => setMenuOpen(false)} />
              </div>
              {sidebarFooter}
            </div>
          </dialog>

          {/* Đăng nhập lại khi phiên hết hạn: không đóng bằng Esc / nền mờ — trang phía sau vẫn giữ nguyên dữ liệu đang nhập. */}
          <dialog
            ref={reauthRef}
            aria-labelledby="reauth-title"
            className="m-auto w-[min(92vw,24rem)] bg-transparent p-0"
            onCancel={(event) => event.preventDefault()}
          >
            {reauth && (
              <AdminLoginForm
                mode={loginMode}
                titleId="reauth-title"
                title="Phiên đăng nhập đã hết hạn"
                intro={
                  <p className="text-sm text-stone-600">
                    Đăng nhập lại để tiếp tục. Dữ liệu đang nhập trên trang <strong>vẫn được giữ</strong> — sau khi đăng nhập, bấm lại nút
                    lưu / gửi vừa bấm.
                  </p>
                }
                onSuccess={(session) => {
                  setUser(session.user ?? null);
                  setWarnings(session.warnings ?? []);
                  if (session.mode) setLoginMode(session.mode);
                  setReauth(false);
                  refreshBadges();
                  toast.show('Đã đăng nhập lại. Bấm lại nút lưu / gửi nếu thao tác vừa rồi chưa thực hiện được.', 'info');
                }}
              />
            )}
          </dialog>

          <main id="main" className="min-w-0 flex-1">
            {warnings.length > 0 && location.pathname === '/admin' && (
              <div className="mx-auto max-w-7xl px-4 pt-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                  <p className="flex items-center gap-2 font-semibold">
                    <ClipboardList className="size-4" aria-hidden="true" />
                    Khuyến nghị cấu hình
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-6">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <Outlet />
          </main>
        </div>
      </div>
    </AdminContext>
  );
}
