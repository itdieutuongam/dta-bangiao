import { ChevronDown, ChevronRight, PackageMinus, PackagePlus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { formatVnd, STOCK_IN_REASON_LABELS, VOUCHER_TYPE_LABELS, type StockInReason, type StockVoucher, type VoucherListResponse } from '../../../../shared/vpp';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { Qty } from '../../../components/vpp/Badges';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { vppVoucher, vppVouchers } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { formatDate, formatDateTime } from '../../../utils/format';

const PAGE_SIZE = 30;
const EMPTY = { type: '', from: '', to: '', department: '', q: '' };

function VoucherLines({ voucherId }: { voucherId: string }) {
  const detail = useAsync((signal) => vppVoucher(voucherId, signal), [voucherId]);
  if (detail.status === 'loading' && !detail.data) return <Skeleton className="m-3 h-16" />;
  if (detail.status === 'error' && !detail.data) return <ErrorState className="m-3" title="Không tải được dòng hàng." error={detail.error} onRetry={detail.reload} />;
  const lines = detail.data?.lines ?? [];
  return (
    <div className="overflow-x-auto px-4 pb-3">
      <table className="w-full min-w-[32rem] text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th scope="col" className="py-1.5 pr-2">Mặt hàng</th>
            <th scope="col" className="py-1.5 pr-2 text-right">SL</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Đơn giá</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Thành tiền</th>
            <th scope="col" className="py-1.5 text-right">Tồn sau</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {lines.map((l) => (
            <tr key={l.productId}>
              <td className="py-1.5 pr-2">
                {l.productName}
                <span className="block font-mono text-xs text-stone-500">{l.productCode}</span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {l.quantity} <span className="text-xs text-stone-500">{l.unit}</span>
              </td>
              <td className="py-1.5 pr-2 text-right">{formatVnd(l.unitPrice)}</td>
              <td className="py-1.5 pr-2 text-right">{formatVnd(l.amount)}</td>
              <td className="py-1.5 text-right tabular-nums">
                <Qty value={l.onHandAfter} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VoucherRow({ v, open, onToggle }: { v: StockVoucher; open: boolean; onToggle: () => void }) {
  const isOut = v.voucherType === 'OUT';
  return (
    <li id={`voucher-${v.voucherId}`} className={cn(open && 'bg-stone-50/60')}>
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown className="mt-1 size-4 shrink-0 text-stone-400" aria-hidden="true" /> : <ChevronRight className="mt-1 size-4 shrink-0 text-stone-400" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-brand-800">{v.voucherCode}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', isOut ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
              {VOUCHER_TYPE_LABELS[v.voucherType]}
            </span>
            <span className="text-sm text-stone-700">{formatDate(v.voucherDate)}</span>
          </span>
          <span className="mt-0.5 block text-sm text-stone-700">
            {isOut
              ? [v.department, v.receiverName].filter(Boolean).join(' · ') || '—'
              : [STOCK_IN_REASON_LABELS[v.reasonType as StockInReason] ?? v.reasonType, v.supplier, v.invoiceNo ? `HĐ ${v.invoiceNo}` : ''].filter(Boolean).join(' · ')}
          </span>
          <span className="block text-xs text-stone-500">
            {v.lineCount} mặt hàng · {v.totalQuantity} đơn vị{v.totalAmount !== null ? ` · ${formatVnd(v.totalAmount)}` : ''} · {v.actorName} · {formatDateTime(v.createdAt)}
            {v.note ? ` · ${v.note}` : ''}
          </span>
        </span>
      </button>
      {open && <VoucherLines voucherId={v.voucherId} />}
    </li>
  );
}

function IssueSummaryTable({ data }: { data: VoucherListResponse }) {
  const s = data.issueSummary;
  if (!s.rows.length) return null;
  return (
    <section className="card overflow-hidden" aria-labelledby="issue-summary">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 id="issue-summary" className="section-title">
          Tổng xuất theo phòng ban
        </h2>
        <p className="text-xs text-stone-500">Theo bộ lọc đang chọn (mọi trang) — như sheet “Xuat VPP” của file Excel theo dõi.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold text-stone-500">
            <tr>
              <th scope="col" className="sticky left-0 bg-stone-50 px-4 py-2">Mặt hàng</th>
              {s.departments.map((d) => (
                <th key={d} scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                  {d}
                </th>
              ))}
              <th scope="col" className="px-4 py-2 text-right">Tổng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {s.rows.map((r) => (
              <tr key={r.productId}>
                <td className="sticky left-0 bg-white px-4 py-1.5">
                  {r.productName}
                  <span className="ml-1 text-xs text-stone-500">{r.unit}</span>
                </td>
                {s.departments.map((d) => (
                  <td key={d} className="px-3 py-1.5 text-right tabular-nums">
                    {r.byDepartment[d] || ''}
                  </td>
                ))}
                <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{r.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-stone-50 font-semibold">
            <tr>
              <td className="sticky left-0 bg-stone-50 px-4 py-2">Tổng</td>
              {s.departments.map((d) => (
                <td key={d} className="px-3 py-2 text-right tabular-nums">
                  {s.totals[d]}
                </td>
              ))}
              <td className="px-4 py-2 text-right tabular-nums">{s.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** /admin/vpp/phieu-kho — phiếu nhập / xuất kho: lọc theo loại, ngày, phòng ban; tổng xuất theo phòng ban; xuất CSV. */
export default function VppVouchersPage() {
  useDocumentTitle('Phiếu nhập / xuất kho');
  const [params, setParams] = useSearchParams();
  const filters = {
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    department: params.get('department') ?? '',
    q: params.get('q') ?? '',
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const focusId = params.get('id') ?? '';
  const key = [filters.type, filters.from, filters.to, filters.department, filters.q, page].join('|');
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []));
  const list = useAsync(
    (signal) => vppVouchers({ ...filters, page, pageSize: PAGE_SIZE }, signal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (focusId && list.data) document.getElementById(`voucher-${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, list.data]);

  function apply(next: typeof filters, nextPage = 1) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) query.set(k, v);
    if (nextPage > 1) query.set('page', String(nextPage));
    setParams(query);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply({ ...draft, q: draft.q.trim(), department: draft.department.trim() });
  }

  const data = list.data;
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Phiếu nhập / xuất kho"
        description="Mỗi lần nhập kho nhiều mặt hàng (NK) hoặc xuất kho cho phòng ban (XK) là một phiếu; dòng hàng nằm trong lịch sử kho. Không sửa / xóa phiếu — sai thì lập phiếu bù hoặc kiểm kê."
        actions={
          <>
            <ExportCsvButton dataset="vpp-vouchers" filters={filters} />
            <ButtonLink to="/admin/vpp/nhap-kho" icon={<PackagePlus className="size-4" aria-hidden="true" />}>
              Nhập kho
            </ButtonLink>
            <ButtonLink to="/admin/vpp/xuat-kho" variant="primary" icon={<PackageMinus className="size-4" aria-hidden="true" />}>
              Xuất kho
            </ButtonLink>
          </>
        }
      />

      <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1 sm:col-span-2" role="group" aria-label="Loại phiếu">
          {[
            ['', 'Tất cả'],
            ['IN', 'Phiếu nhập'],
            ['OUT', 'Phiếu xuất'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.type === value}
              onClick={() => apply({ ...filters, type: value! })}
              className={cn('flex-1 rounded-md px-2 py-1.5 text-sm font-medium', filters.type === value ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600')}
            >
              {label}
            </button>
          ))}
        </div>
        <input type="date" className="field-input" aria-label="Từ ngày" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        <input type="date" className="field-input" aria-label="Đến ngày" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        <input
          className="field-input"
          list="voucher-departments"
          placeholder="Phòng ban"
          aria-label="Phòng ban"
          value={draft.department}
          onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
        />
        <datalist id="voucher-departments">
          {(data?.departments ?? []).map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Số phiếu, NCC, người nhận…"
            aria-label="Tìm phiếu"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" variant="primary" size="sm" icon={<Search className="size-4" aria-hidden="true" />}>
            Lọc
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="size-4" aria-hidden="true" />}
            onClick={() => {
              setDraft(EMPTY);
              apply(EMPTY);
            }}
          >
            Xóa lọc
          </Button>
        </div>
      </form>

      {data && <IssueSummaryTable data={data} />}

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'} aria-label="Danh sách phiếu">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{data ? `${data.total} phiếu` : 'Phiếu'}</h2>
          {list.status === 'loading' && data && <span className="text-xs text-stone-500">Đang cập nhật…</span>}
        </div>
        {list.status === 'loading' && !data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !data && <ErrorState className="border-0 shadow-none" title="Không tải được phiếu." error={list.error} onRetry={list.reload} />}
        {data && data.items.length === 0 && <EmptyState title="Chưa có phiếu phù hợp." description="Nhập kho / xuất kho nhiều mặt hàng sẽ tạo phiếu ở đây." />}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {data.items.map((v) => (
              <VoucherRow
                key={v.voucherId}
                v={v}
                open={open.has(v.voucherId)}
                onToggle={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(v.voucherId)) next.delete(v.voucherId);
                    else next.add(v.voucherId);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} busy={list.status === 'loading'} onPage={(p) => apply(filters, p)} />}
      </section>
    </div>
  );
}
