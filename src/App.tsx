import { lazy, Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary';
import { Spinner } from './components/ui/States';
import { ToastProvider } from './components/ui/Toast';
import { PublicLayout } from './layouts/PublicLayout';

// Công khai: trang chủ, ký xác nhận qua link, đề xuất văn phòng phẩm.
const HomePage = lazy(() => import('./pages/HomePage'));
const ConfirmHandoverPage = lazy(() => import('./pages/ConfirmHandoverPage'));
const ProposalPage = lazy(() => import('./pages/ProposalPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// Quản trị (đăng nhập bắt buộc — AdminLayout kiểm tra phiên).
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage'));
const AdminHandoverListPage = lazy(() => import('./pages/admin/AdminHandoverListPage'));
const AdminHandoverCreatePage = lazy(() => import('./pages/admin/AdminHandoverCreatePage'));
const AdminHandoverDetailPage = lazy(() => import('./pages/admin/AdminHandoverDetailPage'));
const AdminHandoverEditPage = lazy(() => import('./pages/admin/AdminHandoverEditPage'));
const VppOverviewPage = lazy(() => import('./pages/admin/vpp/VppOverviewPage'));
const VppStockPage = lazy(() => import('./pages/admin/vpp/VppStockPage'));
const VppNormsPage = lazy(() => import('./pages/admin/vpp/VppNormsPage'));
const VppProposalsPage = lazy(() => import('./pages/admin/vpp/VppProposalsPage'));
const VppProposalDetailPage = lazy(() => import('./pages/admin/vpp/VppProposalDetailPage'));
const VppMovementsPage = lazy(() => import('./pages/admin/vpp/VppMovementsPage'));
const VppDataReviewPage = lazy(() => import('./pages/admin/vpp/VppDataReviewPage'));
const AdminEmployeesPage = lazy(() => import('./pages/admin/AdminEmployeesPage'));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'));

function PageFallback() {
  return <Spinner label="Đang tải trang…" className="py-24" />;
}

function RootLayout() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Outlet />
    </Suspense>
  );
}

// Data router (thay cho <BrowserRouter>): cần cho useBlocker — hỏi lại khi rời trang (nút Back, link menu…) lúc form chưa lưu.
const router = createBrowserRouter(
  createRoutesFromElements(
    // Lỗi hiển thị trong route được router bắt — hiện cùng màn hình lỗi như ErrorBoundary.
    <Route element={<RootLayout />} errorElement={<ErrorScreen />}>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        {/* Link cũ: tạo phiếu nay chỉ dành cho quản trị viên. */}
        <Route path="tao-ban-giao" element={<Navigate to="/admin/ban-giao/tao-moi" replace />} />
        <Route path="xac-nhan/:token" element={<ConfirmHandoverPage />} />
        <Route path="de-xuat-vpp" element={<ProposalPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="ban-giao" element={<AdminHandoverListPage />} />
        <Route path="ban-giao/tao-moi" element={<AdminHandoverCreatePage />} />
        <Route path="ban-giao/:id" element={<AdminHandoverDetailPage />} />
        <Route path="ban-giao/:id/sua" element={<AdminHandoverEditPage />} />
        <Route path="vpp" element={<VppOverviewPage />} />
        <Route path="vpp/ton-kho" element={<VppStockPage />} />
        <Route path="vpp/dinh-muc" element={<VppNormsPage />} />
        <Route path="vpp/de-xuat" element={<VppProposalsPage />} />
        <Route path="vpp/de-xuat/:id" element={<VppProposalDetailPage />} />
        <Route path="vpp/lich-su" element={<VppMovementsPage />} />
        <Route path="vpp/data-review" element={<VppDataReviewPage />} />
        <Route path="nhan-vien" element={<AdminEmployeesPage />} />
        <Route path="cai-dat" element={<AdminSettingsPage />} />
        <Route path="*" element={<NotFoundPage home="/admin" />} />
      </Route>
    </Route>,
  ),
);

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  );
}
