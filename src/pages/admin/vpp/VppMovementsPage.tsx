import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES, type StockMovement } from '../../../../shared/vpp';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { MovementTypeBadge } from '../../../components/vpp/Badges';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { isApiError } from '../../../services/api';
import { vppMovements } from '../../../services/vppApi';
import { formatDateTime } from '../../../utils/format';

const PAGE_SIZE = 50;

function signed(m: StockMovement): string {
  // RESERVE / RELEASE không đổi tồn; số lượng hiển thị theo chiều tác động lên tồn / giữ chỗ.
  if (m.movementType === 'OUT') return `−${Math.abs(m.quantity)}`;
  if (m.movementType === 'ADJUSTMENT') return m.quantity > 0 ? `+${m.quantity}` : m.quantity < 0 ? `−${Math.abs(m.quantity)}` : '0';
  if (m.movementType === 'RELEASE') return `−${Math.abs(m.quantity)}`;
  return `+${Math.abs(m.quantity)}`;
}

function arrow(before: number | null, after: number | null): string {
  const f = (v: number | null) => (v === null ? '?' : String(v));
  return `${f(before)} → ${f(after)}`;
}

/** /admin/vpp/lich-su — mọi biến động kho (không bao giờ xóa): ai, khi nào, lý do, phiếu / đề xuất liên quan. */
export default function VppMovementsPage() {
  useDocumentTitle('Lịch sử kho');
  const { handleError } = useAdmin();
  const [params, setParams] = useSearchParams();
  const filters = {
    productId: params.get('productId') ?? '',
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    q: params.get('q') ?? '',
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const key = params.toString();
  const [draft, setDraft] = useState(filters);

  const list = useAsync(
    () => vppMovements({ ...filters, page, pageSize: PAGE_SIZE }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (list.status === 'error' && isApiError(list.error) && list.error.status === 401) handleError(list.error);
  }, [list.status, list.error, handleError]);

  // URL đổi (bấm tên sản phẩm, quay lại trang trước…) → ô lọc hiển thị đúng bộ lọc đang áp dụng.
  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function apply(next: typeof filters, nextPage = 1) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) query.set(k, v);
    if (nextPage > 1) query.set('page', String(nextPage));
    setParams(query);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply({ ...draft, q: draft.q.trim() });
  }

  const data = list.data;
  const productName = filters.productId ? data?.items[0]?.productName : undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Lịch sử kho"
        description="Nhật ký bất biến: tồn đầu kỳ, nhập, giữ chỗ, trả giữ chỗ, xuất, điều chỉnh. Không sửa / xóa dòng lịch sử."
        actions={<ExportCsvButton dataset="movements" filters={filters} />}
      />

      {filters.productId && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
          Đang xem một sản phẩm{productName ? `: ${productName}` : ''}.
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => apply({ ...filters, productId: '' })}>
            Xem tất cả sản phẩm
          </button>
        </p>
      )}

      <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Sản phẩm, lý do, người thực hiện…"
            aria-label="Tìm trong lịch sử kho"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </div>
        <select className="field-input" aria-label="Loại biến động" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
          <option value="">Mọi loại biến động</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="field-input"
          aria-label="Từ ngày"
          value={draft.from}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
        />
        <input type="date" className="field-input" aria-label="Đến ngày" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit" variant="primary" size="sm" icon={<Search className="size-4" aria-hidden="true" />}>
            Lọc
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="size-4" aria-hidden="true" />}
            onClick={() => {
              const empty = { productId: '', type: '', from: '', to: '', q: '' };
              setDraft(empty);
              apply(empty);
            }}
          >
            Xóa lọc
          </Button>
        </div>
      </form>

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'} aria-label="Lịch sử biến động kho">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{data ? `${data.total} biến động` : 'Biến động kho'}</h2>
          {list.status === 'loading' && data && <span className="text-xs text-stone-500">Đang cập nhật…</span>}
        </div>
        {list.status === 'loading' && !data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !data && (
          <ErrorState className="border-0 shadow-none" title="Không tải được lịch sử kho." error={list.error} onRetry={list.reload} />
        )}
        {data && data.items.length === 0 && <EmptyState title="Không có biến động phù hợp." />}
        {data && data.items.length > 0 && (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Thời gian</th>
                    <th scope="col" className="px-3 py-2.5">Sản phẩm</th>
                    <th scope="col" className="px-3 py-2.5">Loại</th>
                    <th scope="col" className="px-3 py-2.5 text-right">SL</th>
                    <th scope="col" className="px-3 py-2.5">Tồn</th>
                    <th scope="col" className="px-3 py-2.5">Giữ chỗ</th>
                    <th scope="col" className="px-3 py-2.5">Liên quan</th>
                    <th scope="col" className="px-4 py-2.5">Người thực hiện / lý do</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.items.map((m) => (
                    <tr key={m.movementId}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-stone-600">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/admin/vpp/lich-su?productId=${m.productId}`} className="font-medium text-stone-900 hover:underline">
                          {m.productName}
                        </Link>
                        <span className="block font-mono text-xs text-stone-500">{m.productCode}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <MovementTypeBadge type={m.movementType} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {signed(m)}
                        {m.unit ? <span className="ml-1 text-xs font-normal text-stone-500">{m.unit}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{arrow(m.onHandBefore, m.onHandAfter)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{arrow(m.reservedBefore, m.reservedAfter)}</td>
                      <td className="px-3 py-2.5">
                        <RelatedLinks movement={m} />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block text-stone-800">{m.actorName || '—'}</span>
                        <span className="block text-xs break-words text-stone-500">{m.reason}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-stone-100 lg:hidden">
              {data.items.map((m) => (
                <li key={m.movementId} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-stone-900">{m.productName}</p>
                      <p className="text-xs text-stone-500">{formatDateTime(m.createdAt)}</p>
                    </div>
                    <MovementTypeBadge type={m.movementType} />
                  </div>
                  <p className="mt-1 text-sm text-stone-700">
                    SL <strong className="tabular-nums">{signed(m)}</strong> {m.unit} · Tồn {arrow(m.onHandBefore, m.onHandAfter)} · Giữ{' '}
                    {arrow(m.reservedBefore, m.reservedAfter)}
                  </p>
                  <p className="mt-0.5 text-xs break-words text-stone-500">
                    {m.actorName || '—'} · {m.reason}
                  </p>
                  <RelatedLinks movement={m} />
                </li>
              ))}
            </ul>
          </>
        )}
        {data && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} busy={list.status === 'loading'} onPage={(p) => apply(filters, p)} />
        )}
      </section>
    </div>
  );
}

function RelatedLinks({ movement }: { movement: StockMovement }) {
  if (!movement.handoverId && !movement.proposalId) return null;
  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {movement.handoverId && (
        <Link to={`/admin/ban-giao/${movement.handoverId}`} className="font-mono font-semibold text-brand-700 hover:underline">
          {movement.handoverCode || 'Phiếu'}
        </Link>
      )}
      {movement.proposalId && (
        <Link to={`/admin/vpp/de-xuat/${movement.proposalId}`} className="font-mono font-semibold text-brand-700 hover:underline">
          {movement.proposalCode || 'Đề xuất'}
        </Link>
      )}
    </span>
  );
}
