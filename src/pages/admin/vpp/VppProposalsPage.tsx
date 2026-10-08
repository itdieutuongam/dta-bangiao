import { ChevronRight, ExternalLink, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUSES, formatVnd, type ProposalStatus } from '../../../../shared/vpp';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { ProposalStatusBadge } from '../../../components/vpp/Badges';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { isApiError } from '../../../services/api';
import { vppProposals } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { formatDateTime } from '../../../utils/format';

const PAGE_SIZE = 20;

/** Bộ lọc + trang → tham số URL (trang 1 không ghi). */
function searchFor({ status, q, page }: { status: string; q: string; page: number }): URLSearchParams {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (q) query.set('q', q);
  if (page > 1) query.set('page', String(page));
  return query;
}

/** /admin/vpp/de-xuat — đề xuất mua văn phòng phẩm do nhân viên gửi từ trang /de-xuat-vpp. */
export default function VppProposalsPage() {
  useDocumentTitle('Đề xuất mua văn phòng phẩm');
  const { handleError } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as ProposalStatus | '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(q);

  const list = useAsync(() => vppProposals({ status, q, page, pageSize: PAGE_SIZE }), [status, q, page]);

  useEffect(() => {
    if (list.status === 'error' && isApiError(list.error) && list.error.status === 401) handleError(list.error);
  }, [list.status, list.error, handleError]);

  function update(next: { status?: string; q?: string; page?: number }) {
    setParams(searchFor({ status, q, page: 1, ...next }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: search.trim() });
  }

  const data = list.data;
  // Trang vượt quá trang cuối (danh sách vừa ngắn lại, link cũ ?page=…) → về trang cuối, không hiện "không có đề xuất".
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const lastPageSearch = data && data.items.length === 0 && data.total > 0 && page > lastPage ? searchFor({ status, q, page: lastPage }).toString() : null;
  useEffect(() => {
    if (lastPageSearch !== null) setParams(new URLSearchParams(lastPageSearch), { replace: true });
  }, [lastPageSearch, setParams]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Đề xuất mua văn phòng phẩm"
        description="Duyệt từng dòng, đánh dấu đã mua, nhận hàng (tự nhập kho) và đóng đề xuất."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportCsvButton dataset="proposals" filters={{ status, q }} />
            <a
              href="/de-xuat-vpp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              Trang đề xuất cho nhân viên
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        }
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Lọc theo trạng thái">
        {(['', ...PROPOSAL_STATUSES] as Array<ProposalStatus | ''>).map((s) => {
          const count = data ? (s ? data.stats[s] : Object.values(data.stats).reduce((a, b) => a + b, 0)) : null;
          return (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => update({ status: s })}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap',
                status === s ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              )}
            >
              {s ? PROPOSAL_STATUS_LABELS[s] : 'Tất cả'}
              {count !== null && <span className="ml-1.5 tabular-nums opacity-80">{count}</span>}
            </button>
          );
        })}
      </div>

      <form onSubmit={submitSearch} className="flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Mã đề xuất, tên / mã nhân viên, phòng ban…"
            aria-label="Tìm đề xuất"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </form>

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'} aria-label="Danh sách đề xuất">
        {list.status === 'loading' && !data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !data && (
          <ErrorState className="border-0 shadow-none" title="Không tải được đề xuất." error={list.error} onRetry={list.reload} />
        )}
        {data && data.items.length === 0 && (
          <EmptyState
            title={status || q ? 'Không có đề xuất phù hợp.' : 'Chưa có đề xuất nào.'}
            description={status || q ? 'Thử chọn trạng thái khác hoặc bỏ từ khóa.' : 'Nhân viên gửi đề xuất tại trang /de-xuat-vpp.'}
          />
        )}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {data.items.map((p) => (
              <li key={p.proposalId}>
                <Link
                  to={`/admin/vpp/de-xuat/${p.proposalId}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-stone-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stone-900">
                      <span className="font-mono">{p.proposalCode}</span> · {p.requesterName}{' '}
                      <span className="font-normal text-stone-500">({p.requesterEmployeeId})</span>
                    </span>
                    <span className="block text-xs text-stone-500">
                      {p.department || '—'} · {formatDateTime(p.createdAt)} · {p.itemCount} sản phẩm
                      {p.outsideNormCount > 0 ? ` (${p.outsideNormCount} ngoài định mức)` : ''} · {formatVnd(p.estimatedTotal)}
                    </span>
                    {p.pendingProductCount > 0 && (
                      <span className="mt-0.5 block text-xs font-medium text-amber-800">
                        {p.pendingProductCount} sản phẩm mới chờ quyết định (thêm vào danh mục / giữ tạm / từ chối)
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <ProposalStatusBadge status={p.status} />
                    <ChevronRight className="size-4 text-stone-400" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} busy={list.status === 'loading'} onPage={(p) => update({ page: p })} />
        )}
      </section>
    </div>
  );
}
