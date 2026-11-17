import { cn } from '../utils/cn';

/**
 * Logo chính thức Diệu Tướng Am (public/logo.svg — dựng từ logo vector trên dieutuongam.com: chữ thư pháp vàng ánh kim trên nền đỏ
 * đô, như icon chính thức của website) + tên hệ thống.
 */
export function BrandMark({ compact = false, subtitle }: { compact?: boolean; subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <img
        src="/logo.svg"
        alt=""
        width={44}
        height={44}
        className={cn('shrink-0 rounded-[10px] shadow-sm ring-1 ring-black/5', compact ? 'size-10' : 'size-11')}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[15px] font-bold tracking-wide text-brand-800 sm:text-base">DIỆU TƯỚNG AM</span>
        <span className="truncate text-xs font-medium text-stone-500 sm:text-[13px]">
          {subtitle ?? 'Hệ thống bàn giao nội bộ'}
        </span>
      </span>
    </span>
  );
}
