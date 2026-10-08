import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

/** Phân trang đơn giản: Trước / Trang x / y / Sau. Ẩn khi chỉ có 1 trang. */
export function Pagination({
  page,
  pageSize,
  total,
  busy,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy?: boolean;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-2 border-t border-stone-200 px-4 py-3" aria-label="Phân trang">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1 || busy}
        onClick={() => onPage(page - 1)}
        icon={<ChevronLeft className="size-4" aria-hidden="true" />}
      >
        Trước
      </Button>
      <span className="text-sm text-stone-600">
        Trang {page} / {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages || busy} onClick={() => onPage(page + 1)}>
        Sau
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
