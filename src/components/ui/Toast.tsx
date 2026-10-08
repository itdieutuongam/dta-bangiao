import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { useTopModal } from './modalLayer';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  // Có hộp thoại modal đang mở (hộp thoại xác nhận, menu điện thoại, đăng nhập lại…): thông báo hiện BÊN TRONG hộp thoại trên
  // cùng — đặt ngoài thì nằm dưới lớp phủ, bị che và trình đọc màn hình không đọc (phần ngoài hộp thoại modal là "inert").
  const modal = useTopModal();

  const region = (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {toasts.map((toast) => {
        const Icon = toast.tone === 'success' ? CircleCheck : toast.tone === 'error' ? CircleAlert : Info;
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ring-1',
              // Trong hộp thoại: không chặn bấm nút của hộp thoại nằm dưới thông báo.
              modal ? 'pointer-events-none' : 'pointer-events-auto',
              toast.tone === 'success' && 'bg-emerald-800 text-white ring-emerald-900',
              toast.tone === 'error' && 'bg-red-700 text-white ring-red-800',
              toast.tone === 'info' && 'bg-stone-800 text-white ring-stone-900',
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <ToastContext value={value}>
      {children}
      {createPortal(region, modal ?? document.body)}
    </ToastContext>
  );
}

export function useToast(): ToastContextValue {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error('useToast phải dùng bên trong ToastProvider');
  return ctx;
}
