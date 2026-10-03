import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data: T | undefined; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | undefined; error: unknown };

/** Trạng thái loading / success / error cho một request, kèm reload() và setData(). */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: undefined, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));
    loader().then(
      (data) => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setState((prev) => ({ status: 'error', data: prev.data, error }));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ status: 'success', data, error: null }), []);

  return { ...state, reload, setData };
}
