import { use, useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ReloadEpochContext } from './reloadEpoch';

export type AsyncState<T> =
  | { status: 'loading'; data: T | undefined; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | undefined; error: unknown };

/**
 * Trạng thái loading / success / error cho một request, kèm reload() và setData().
 *   • loader nhận AbortSignal — request cũ bị hủy khi deps đổi / rời trang (không tốn thêm lượt Apps Script);
 *   • setData() (ví dụ sau khi hủy phiếu) vô hiệu hóa lần tải đang chạy: kết quả cũ về sau KHÔNG ghi đè dữ liệu mới;
 *   • tự tải lại khi khu quản trị tăng "kỷ nguyên" (đăng nhập lại / Làm mới dữ liệu — xem ReloadEpochContext).
 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: undefined, error: null });
  const [attempt, setAttempt] = useState(0);
  const epoch = use(ReloadEpochContext);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    const controller = new AbortController();
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));
    loader(controller.signal).then(
      (data) => {
        if (id === request.current) setState({ status: 'success', data, error: null });
      },
      (error: unknown) => {
        if (id !== request.current || controller.signal.aborted) return;
        setState((prev) => ({ status: 'error', data: prev.data, error }));
      },
    );
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, epoch]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((data: T) => {
    request.current++; // lần tải đang chạy (nếu có) không còn được áp dụng
    setState({ status: 'success', data, error: null });
  }, []);

  return { ...state, reload, setData };
}
