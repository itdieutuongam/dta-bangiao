import { CircleAlert, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../services/api';
import { cn } from '../../utils/cn';
import { Button } from './Button';

export function Spinner({ label = 'Đang tải…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-stone-500', className)}>
      <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Khung chờ. inline: dùng `span` (đặt được trong `span` / `button` — `div` ở đó là HTML sai cấu trúc). */
export function Skeleton({ className, inline = false }: { className?: string; inline?: boolean }) {
  if (inline) return <span className={cn('inline-block animate-pulse rounded-md bg-stone-200/70', className)} aria-hidden="true" />;
  return <div className={cn('animate-pulse rounded-md bg-stone-200/70', className)} aria-hidden="true" />;
}

export function LoadingCard({ lines = 4, label = 'Đang tải dữ liệu…' }: { lines?: number; label?: string }) {
  return (
    <div className="card space-y-3 p-5" role="status" aria-label={label}>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 2 ? 'w-2/3' : 'w-full')} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ title = 'Không thể tải dữ liệu', error, message, onRetry, action, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('card flex flex-col items-center gap-3 px-5 py-10 text-center', className)}>
      <CircleAlert className="size-10 text-red-600" aria-hidden="true" />
      <div>
        <p className="font-semibold text-stone-900">{title}</p>
        <p className="mt-1 text-sm text-stone-600">{message ?? errorMessage(error)}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
            Vui lòng thử lại
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      <Inbox className="size-10 text-stone-400" aria-hidden="true" />
      <p className="font-semibold text-stone-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-stone-500">{description}</p>}
      {action}
    </div>
  );
}

export function InlineAlert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'info' | 'warning' | 'success';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        className,
      )}
    >
      {children}
    </div>
  );
}
