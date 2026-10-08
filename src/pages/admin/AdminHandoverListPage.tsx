import { ChevronLeft, ChevronRight, Filter, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { HANDOVER_STATUSES, HANDOVER_TYPE_LABELS, HANDOVER_TYPES, STATUS_LABELS, type HandoverStatus } from '../../../shared/constants';
import type { AdminListResponse, Category, HandoverStats } from '../../../shared/types';
import { ExportCsvButton } from '../../components/ExportCsvButton';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminCategories, adminListHandovers, type AdminFilters } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';

const FILTER_KEYS = [
  'code',
  'employeeName',
  'employeeId',
  'sender',
  'receiver',
  'department',
  'handoverType',
  'category',
  'status',
  'from',
  'to',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type FilterValues = Record<FilterKey, string>;

const PAGE_SIZE = 20;

function readFilters(params: URLSearchParams): FilterValues {
  const out = {} as FilterValues;
  for (const key of FILTER_KEYS) out[key] = params.get(key) ?? '';
  return out;
}

/** Bộ lọc + trang → tham số URL (trang 1 không ghi). */
function searchFor(filters: Partial<FilterValues>, page: number): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) search.set(key, filters[key]);
  if (page > 1) search.set('page', String(page));
  return search;
}

const STAT_CARDS: Array<{ key: keyof HandoverStats; label: string; status: HandoverStatus | ''; tone: string }> = [
  { key: 'total', label: 'Tổng số biên bản', status: '', tone: 'border-brand-200 text-brand-900' },
  { key: 'PENDING', label: STATUS_LABELS.PENDING, status: 'PENDING', tone: 'border-amber-200 text-amber-800' },
  { key: 'CONFIRMED', label: STATUS_LABELS.CONFIRMED, status: 'CONFIRMED', tone: 'border-emerald-200 text-emerald-800' },
  {
    key: 'REVISION_REQUESTED',
    label: STATUS_LABELS.REVISION_REQUESTED,
    status: 'REVISION_REQUESTED',
    tone: 'border-orange-200 text-orange-800',
  },
  { key: 'CANCELLED', label: STATUS_LABELS.CANCELLED, status: 'CANCELLED', tone: 'border-stone-300 text-stone-700' },
];

export default function AdminHandoverListPage() {
  useDocumentTitle('Phiếu bàn giao');
  const { handleError } = useAdmin();
  const [params, setParams] = useSearchParams();
  const applied = readFilters(params);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = params.toString();

  const list = useAsync(() => {
    const filters: AdminFilters = { ...applied, page, pageSize: PAGE_SIZE };
    return adminListHandovers(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const categories = useAsync(() => adminCategories(), []);

  useEffect(() => {
    if (list.status === 'error' && isApiError(list.error) && list.error.status === 401) handleError(list.error);
  }, [list.status, list.error, handleError]);

  function applyFilters(next: Partial<FilterValues>, nextPage = 1) {
    setParams(searchFor({ ...applied, ...next }, nextPage));
  }

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Trang vượt quá trang cuối (vừa hủy / lọc làm danh sách ngắn lại, bấm Back, link cũ ?page=…): về trang cuối thay vì
  // hiện "Không có biên bản phù hợp" trong khi tiêu đề ghi "N biên bản" và không còn nút chuyển trang.
  const lastPageSearch = data && data.items.length === 0 && data.total > 0 && page > totalPages ? searchFor(applied, totalPages).toString() : null;
  useEffect(() => {
    if (lastPageSearch !== null) setParams(new URLSearchParams(lastPageSearch), { replace: true });
  }, [lastPageSearch, setParams]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">Biên bản bàn giao</h1>
          <p className="text-sm text-stone-600">Theo dõi toàn bộ lịch sử bàn giao, lọc và xem chi tiết.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportCsvButton dataset="handovers" filters={{ ...applied }} />
          <ButtonLink to="/admin/ban-giao/tao-moi" variant="primary">
            + Tạo phiếu
          </ButtonLink>
        </div>
      </div>

      <section aria-label="Thống kê" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {STAT_CARDS.map((card) => {
          const active = applied.status === card.status && (card.status !== '' || !applied.status);
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => applyFilters({ status: card.status })}
              aria-pressed={active}
              className={cn(
                'rounded-xl border bg-white p-4 text-left shadow-xs transition-shadow hover:shadow-md',
                card.tone,
                active && 'ring-2 ring-gold-400',
                card.key === 'total' && 'col-span-2 md:col-span-1',
              )}
            >
              <span className="block text-xs font-semibold tracking-wide uppercase opacity-80">{card.label}</span>
              <span className="mt-1 block text-2xl font-bold tabular-nums">
                {data ? data.stats[card.key] : <Skeleton inline className="mt-1 h-7 w-12" />}
              </span>
            </button>
          );
        })}
      </section>

      <FilterPanel
        key={query}
        applied={applied}
        departments={data?.departments ?? []}
        categories={categories.data ?? []}
        onApply={(values) => applyFilters(values)}
        onReset={() => setParams(new URLSearchParams())}
      />

      <section className="card overflow-hidden" aria-labelledby="list-title" aria-busy={list.status === 'loading'}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 id="list-title" className="text-sm font-semibold text-stone-800">
            {data ? `${data.total} biên bản` : 'Danh sách biên bản'}
          </h2>
          {list.status === 'loading' && data && <span className="text-xs text-stone-500">Đang cập nhật…</span>}
        </div>
        <ListBody list={list} categories={categories.data ?? []} />
        {data && data.total > data.pageSize && (
          <nav className="flex items-center justify-between gap-2 border-t border-stone-200 px-4 py-3" aria-label="Phân trang">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || list.status === 'loading'}
              onClick={() => applyFilters({}, page - 1)}
              icon={<ChevronLeft className="size-4" aria-hidden="true" />}
            >
              Trước
            </Button>
            <span className="text-sm text-stone-600">
              Trang {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || list.status === 'loading'}
              onClick={() => applyFilters({}, page + 1)}
            >
              Sau
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}

function ListBody({
  list,
  categories,
}: {
  list: ReturnType<typeof useAsync<AdminListResponse>>;
  categories: Category[];
}) {
  if (list.status === 'loading' && !list.data) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Đang tải danh sách">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (list.status === 'error' && !list.data) {
    return <ErrorState className="border-0 shadow-none" title="Không thể tải danh sách biên bản." error={list.error} onRetry={list.reload} />;
  }
  const data = list.data;
  if (!data || data.items.length === 0) {
    return <EmptyState title="Không có biên bản phù hợp" description="Thử thay đổi hoặc xóa bộ lọc." />;
  }
  const categoryName = new Map(categories.map((c) => [c.code, c.name]));

  return (
    <>
      {/* Desktop: bảng */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs tracking-wide text-stone-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Mã BG</th>
              <th scope="col" className="px-4 py-3 font-semibold">Loại</th>
              <th scope="col" className="px-4 py-3 font-semibold">Người giao</th>
              <th scope="col" className="px-4 py-3 font-semibold">Người nhận</th>
              <th scope="col" className="px-4 py-3 font-semibold">Phòng ban</th>
              <th scope="col" className="px-4 py-3 font-semibold">Ngày tạo</th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">Số ND</th>
              <th scope="col" className="px-4 py-3 font-semibold">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.items.map((h) => (
              <tr key={h.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link to={`/admin/ban-giao/${h.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                    {h.code}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-stone-700">{HANDOVER_TYPE_LABELS[h.handoverType] ?? h.handoverType}</td>
                <td className="px-4 py-3">
                  <span className="block font-medium text-stone-900">{h.senderName}</span>
                  {h.senderEmployeeId && <span className="text-xs text-stone-500">{h.senderEmployeeId}</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="block font-medium text-stone-900">{h.receiverName}</span>
                  <span className="text-xs text-stone-500">{h.receiverEmployeeId}</span>
                </td>
                <td className="px-4 py-3 text-stone-700">{h.receiverDepartment}</td>
                <td className="px-4 py-3 whitespace-nowrap text-stone-700">{formatDateTime(h.createdAt)}</td>
                <td className="px-4 py-3 text-center tabular-nums" title={h.categories.map((c) => categoryName.get(c) ?? c).join(', ')}>
                  {h.itemCount}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={h.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: thẻ */}
      <ul className="divide-y divide-stone-100 md:hidden">
        {data.items.map((h) => (
          <li key={h.id}>
            <Link to={`/admin/ban-giao/${h.id}`} className="block px-4 py-3 hover:bg-brand-50/50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-brand-700">{h.code}</span>
                <StatusBadge status={h.status} />
              </div>
              <p className="mt-1 text-sm text-stone-900">
                <span className="text-stone-500">Giao:</span> {h.senderName} → <span className="text-stone-500">Nhận:</span>{' '}
                <span className="font-medium">{h.receiverName}</span>
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                {[HANDOVER_TYPE_LABELS[h.handoverType], h.receiverDepartment, formatDateTime(h.createdAt), `${h.itemCount} nội dung`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function FilterPanel({
  applied,
  departments,
  categories,
  onApply,
  onReset,
}: {
  applied: FilterValues;
  departments: string[];
  categories: Category[];
  onApply: (values: FilterValues) => void;
  onReset: () => void;
}) {
  const [values, setValues] = useState<FilterValues>(applied);
  const activeCount = FILTER_KEYS.filter((k) => applied[k]).length;
  const [open, setOpen] = useState(activeCount > 0);

  function set(key: FilterKey, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onApply(values);
  }

  const textField = (key: FilterKey, label: string, placeholder?: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`filter-${key}`} className="text-xs font-medium text-stone-600">
        {label}
      </label>
      <input
        id={`filter-${key}`}
        className="field-input py-1.5"
        value={values[key]}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
        maxLength={120}
      />
    </div>
  );

  return (
    <section className="card" aria-labelledby="filter-title">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left md:cursor-default"
        aria-expanded={open}
        aria-controls="filter-form"
        onClick={() => setOpen((o) => !o)}
      >
        <span id="filter-title" className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <Filter className="size-4" aria-hidden="true" />
          Bộ lọc
          {activeCount > 0 && (
            <span className="rounded-full bg-gold-200 px-2 py-0.5 text-xs font-bold text-brand-900">{activeCount}</span>
          )}
        </span>
        <span className="text-xs text-stone-500 md:hidden">{open ? 'Thu gọn' : 'Mở rộng'}</span>
      </button>
      <form
        id="filter-form"
        onSubmit={handleSubmit}
        className={cn('border-t border-stone-200 p-4', open ? 'block' : 'hidden md:block')}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {textField('code', 'Mã biên bản', 'BG-2026…')}
          {textField('employeeName', 'Tên nhân viên', 'Người giao hoặc nhận')}
          {textField('employeeId', 'Mã nhân viên')}
          {textField('sender', 'Người giao')}
          {textField('receiver', 'Người nhận')}
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-department" className="text-xs font-medium text-stone-600">
              Phòng ban
            </label>
            <select
              id="filter-department"
              className="field-input py-1.5"
              value={values.department}
              onChange={(e) => set('department', e.target.value)}
            >
              <option value="">Tất cả</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {values.department && !departments.includes(values.department) && (
                <option value={values.department}>{values.department}</option>
              )}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-handoverType" className="text-xs font-medium text-stone-600">
              Loại phiếu
            </label>
            <select
              id="filter-handoverType"
              className="field-input py-1.5"
              value={values.handoverType}
              onChange={(e) => set('handoverType', e.target.value)}
            >
              <option value="">Tất cả</option>
              {HANDOVER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {HANDOVER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-category" className="text-xs font-medium text-stone-600">
              Loại nội dung
            </label>
            <select
              id="filter-category"
              className="field-input py-1.5"
              value={values.category}
              onChange={(e) => set('category', e.target.value)}
            >
              <option value="">Tất cả</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-status" className="text-xs font-medium text-stone-600">
              Trạng thái
            </label>
            <select
              id="filter-status"
              className="field-input py-1.5"
              value={values.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="">Tất cả</option>
              {HANDOVER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-from" className="text-xs font-medium text-stone-600">
              Từ ngày
            </label>
            <input
              id="filter-from"
              type="date"
              className="field-input py-1.5"
              value={values.from}
              max={values.to || undefined}
              onChange={(e) => set('from', e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="filter-to" className="text-xs font-medium text-stone-600">
              Đến ngày
            </label>
            <input
              id="filter-to"
              type="date"
              className="field-input py-1.5"
              value={values.to}
              min={values.from || undefined}
              onChange={(e) => set('to', e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onReset} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
            Xóa lọc
          </Button>
          <Button type="submit" size="sm" icon={<Search className="size-4" aria-hidden="true" />}>
            Lọc
          </Button>
        </div>
      </form>
    </section>
  );
}
