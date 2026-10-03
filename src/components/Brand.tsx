import { cn } from '../utils/cn';

/** Logo (thay file public/logo.svg bằng logo chính thức nếu có) + tên hệ thống. */
export function BrandMark({ compact = false, subtitle }: { compact?: boolean; subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <img src="/logo.svg" alt="" width={40} height={40} className={cn('shrink-0', compact ? 'size-9' : 'size-10')} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[15px] font-bold tracking-wide text-brand-800 sm:text-base">DIỆU TƯỚNG AM</span>
        <span className="truncate text-xs font-medium text-stone-500 sm:text-[13px]">
          {subtitle ?? 'Hệ thống bàn giao nội bộ'}
        </span>
      </span>
    </span>
  );
}
