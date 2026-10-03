import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Spinner } from './components/ui/States';
import { ToastProvider } from './components/ui/Toast';
import { PublicLayout } from './layouts/PublicLayout';

const CreateHandoverPage = lazy(() => import('./pages/CreateHandoverPage'));
const ConfirmHandoverPage = lazy(() => import('./pages/ConfirmHandoverPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminHandoverDetailPage = lazy(() => import('./pages/admin/AdminHandoverDetailPage'));
const AdminHandoverEditPage = lazy(() => import('./pages/admin/AdminHandoverEditPage'));

function PageFallback() {
  return <Spinner label="Đang tải trang…" className="py-24" />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route index element={<CreateHandoverPage />} />
                <Route path="tao-ban-giao" element={<CreateHandoverPage />} />
                <Route path="xac-nhan/:token" element={<ConfirmHandoverPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="ban-giao/:id" element={<AdminHandoverDetailPage />} />
                <Route path="ban-giao/:id/sua" element={<AdminHandoverEditPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
