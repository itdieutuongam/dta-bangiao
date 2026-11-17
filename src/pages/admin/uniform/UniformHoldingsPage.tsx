import { Search, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { normalizeVietnamese } from '../../../../shared/text';
import type { UniformHolding } from '../../../../shared/uniform';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { ConditionBadge, IssueKindBadge } from '../../../components/uniform/UniformBadges';
import { ReturnDialog } from '../../../components/uniform/UniformDialogs';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { uniformHoldings, type HoldingStatusFilter } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { formatDate } from '../../../utils/format';

const FILTERS: Array<{ value: HoldingStatusFilter; label: string; hint: string }> = [
  { value: 'loans', label: 'Đang mượn', hint: 'Đồ cho mượn chưa trả hết' },
  { value: 'overdue', label: 'Quá hạn trả', hint: 'Đồ mượn đã quá hạn trả' },
  { value: 'outstanding', label: 'Còn giữ (mọi hình thức)', hint: 'Cấp phát + mượn chưa trả / thu hồi — dùng khi nhân viên nghỉ việc' },
  { value: 'all', label: 'Tất cả', hint: 'Mọi dòng đồng phục đã ký nhận' },
];

function isFilter(v: string | null): v is HoldingStatusFilter {
  return v === 'loans' || v === 'overdue' || v === 'outstanding' || v === 'all';
}

/** /admin/dong-phuc/muon-tra — đồ cho mượn (hạn trả, quá hạn) + ghi nhận trả / thu hồi. */
export default function UniformHoldingsPage() {
  useDocumentTitle('Đồng phục — mượn / trả');
  const toast = useToast();
  const { refreshBadges } = useAdmin();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status: HoldingStatusFilter = isFilter(raw) ? raw : 'loans';
  const [query, setQuery] = useState('');
  const [returning, setReturning] = useState<UniformHolding | null>(null);
  const list = useAsync((signal) => uniformHoldings({ status }, signal), [status]);

  const rows = useMemo(() => {
    const needle = normalizeVietnamese(query);
    const items = list.data?.items ?? [];
    if (!needle) return items;
    return items.filter((h) => normalizeVietnamese([h.employeeName, h.employeeId, h.department, h.modelName, h.size, h.handoverCode].join(' ')).includes(needle));
  }, [list.data, query]);
  const stats = list.data?.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Mượn / trả đồng phục"
        description="Đồ cho mượn có hạn trả; quá hạn hiện trên menu. Khi nhân viên trả, đổi size hoặc nghỉ việc: bấm “Ghi nhận trả” — hàng nhận lại có thể nhập lại kho (Đã qua sử dụng)."
        actions={<ExportCsvButton dataset="uniform-holdings" filters={{ status, q: query.trim() }} />}
      />

      {stats && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-stone-100 px-3 py-1">Đang mượn: {stats.loans}</span>
          <span className={cn('rounded-full px-3 py-1', stats.overdue ? 'bg-red-50 text-red-800' : 'bg-stone-100')}>Quá hạn: {stats.overdue}</span>
          <span className={cn('rounded-full px-3 py-1', stats.dueSoon ? 'bg-amber-50 text-amber-900' : 'bg-stone-100')}>Đến hạn trong 7 ngày: {stats.dueSoon}</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">Cấp phát còn giữ: {stats.issued}</span>
        </div>
      )}

      <section className="card space-y-3 p-4" aria-label="Bộ lọc">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Trạng thái">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              title={f.hint}
              aria-pressed={status === f.value}
              onClick={() => setParams(f.value === 'loans' ? {} : { status: f.value }, { replace: true })}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset',
                status === f.value ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" className="field-input pl-9" placeholder="Tìm nhân viên, mẫu, size, mã phiếu…" aria-label="Tìm" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </section>

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'}>
        {list.status === 'loading' && !list.data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !list.data && <ErrorState className="border-0 shadow-none" title="Không tải được danh sách." error={list.error} onRetry={list.reload} />}
        {list.data && rows.length === 0 && <EmptyState title={status === 'overdue' ? 'Không có đồ mượn quá hạn.' : 'Không có dòng phù hợp.'} />}
        {rows.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {rows.map((h) => (
              <li key={h.itemId} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm', h.overdue && 'bg-red-50/40')}>
                <div className="min-w-0">
                  <p>
                    <Link to={`/admin/dong-phuc/nhan-vien/${encodeURIComponent(h.employeeId)}`} className="font-semibold text-brand-800 hover:underline">
                      {h.employeeName}
                    </Link>
                    <span className="text-stone-500"> · {h.department || h.employeeId}</span>
                  </p>
                  <p className="mt-0.5 font-medium text-stone-900">
                    {h.modelName} · Size {h.size} — còn giữ <span className="tabular-nums">{h.outstanding}</span>/{h.quantity}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    <ConditionBadge condition={h.condition} />
                    <IssueKindBadge kind={h.issueKind} dueDate={h.dueDate} overdue={h.overdue} />
                    <Link to={`/admin/ban-giao/${h.handoverId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                      {h.handoverCode}
                    </Link>
                    · ký nhận {formatDate(h.confirmedAt)}
                  </p>
                </div>
                {h.outstanding > 0 && (
                  <Button size="sm" variant={h.overdue ? 'primary' : 'secondary'} onClick={() => setReturning(h)} icon={<Undo2 className="size-4" aria-hidden="true" />}>
                    Ghi nhận trả
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReturnDialog
        open={returning !== null}
        holding={returning}
        onClose={() => setReturning(null)}
        onDone={(result) => {
          setReturning(null);
          toast.show(result.duplicate ? 'Lần ghi nhận này ĐÃ được lưu ở lần gửi trước — không ghi thêm.' : 'Đã ghi nhận trả / thu hồi đồng phục.');
          refreshBadges();
          list.reload();
        }}
        onStale={list.reload}
      />
    </div>
  );
}
