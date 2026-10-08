import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router';

interface State {
  hasError: boolean;
}

/** Màn hình lỗi hiển thị (dùng chung cho ErrorBoundary và lỗi trong route của router). */
function ErrorView() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
      <TriangleAlert className="size-12 text-amber-500" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-stone-900">Đã có lỗi khi hiển thị trang</h1>
      <p className="text-sm text-stone-600">Vui lòng tải lại trang. Nếu lỗi vẫn tiếp diễn, hãy báo quản trị viên.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Tải lại trang
      </button>
    </div>
  );
}

/** errorElement của router: lỗi trong route (ví dụ tải chunk JS cũ sau khi deploy bản mới) — ghi log như ErrorBoundary. */
export function ErrorScreen() {
  const error = useRouteError();
  useEffect(() => {
    console.error('UI error', error instanceof Error ? error.message : error);
  }, [error]);
  return <ErrorView />;
}

/** Không để màn hình trắng khi có lỗi hiển thị (ví dụ: tải chunk JS cũ sau khi deploy bản mới). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error.message, info.componentStack?.split('\n').slice(0, 4).join('\n'));
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorView />;
  }
}
