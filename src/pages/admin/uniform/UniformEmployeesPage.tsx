import { FilePlus2, Search, UserRoundPen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { normalizeVietnamese } from '../../../../shared/text';
import type { UniformEmployeeRow } from '../../../../shared/uniform';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { genderLabel } from '../../../components/uniform/UniformBadges';
import { ProfileDialog } from '../../../components/uniform/UniformDialogs';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { uniformEmployees, uniformStock } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { formatDate } from '../../../utils/format';

function currentYear(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }));
}

function RemainingCell({ row }: { row: UniformEmployeeRow }) {
  if (row.usage.yearlyQuota === null) return <span className="text-stone-400">—</span>;
  const r = row.usage.remaining ?? 0;
  return <span className={cn('font-bold tabular-nums', r < 0 ? 'text-red-700' : r === 0 ? 'text-orange-700' : 'text-emerald-700')}>{r}</span>;
}

/** /admin/dong-phuc/nhan-vien — sổ cấp phát đồng phục theo nhân viên (tiêu chuẩn năm, đã cấp, còn lại, đang mượn) + dự trù đặt may. */
export default function UniformEmployeesPage() {
  useDocumentTitle('Cấp phát đồng phục theo nhân viên');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || currentYear();
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<UniformEmployeeRow | null>(null);
  const list = useAsync((signal) => uniformEmployees({ year }, signal), [year]);
  const catalog = useAsync((signal) => uniformStock({}, signal), []);
  const modelName = useMemo(() => new Map((catalog.data?.models ?? []).map((m) => [m.modelId, m.modelName])), [catalog.data]);

  const departments = useMemo(() => [...new Set((list.data?.employees ?? []).map((e) => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [list.data]);
  const rows = useMemo(() => {
    const needle = normalizeVietnamese(query);
    return (list.data?.employees ?? []).filter((e) => {
      if (department && e.department !== department) return false;
      if (onlyIssues && e.uniformSize && e.gender && !(e.usage.remaining !== null && e.usage.remaining < 0) && !e.holdings.overdue) return false;
      return !needle || normalizeVietnamese([e.fullName, e.employeeId, e.department, e.position].join(' ')).includes(needle);
    });
  }, [list.data, query, department, onlyIssues]);

  // Dự trù đặt may: phần tiêu chuẩn còn lại của nhân viên đang làm, theo mẫu gợi ý × size.
  const forecast = useMemo(() => {
    const map = new Map<string, { model: string; sizes: Map<string, number>; total: number }>();
    for (const e of list.data?.employees ?? []) {
      if (e.status !== 'ACTIVE' || e.usage.remaining === null || e.usage.remaining <= 0) continue;
      const model = e.suggestedModelIds.length ? e.suggestedModelIds.map((id) => modelName.get(id) ?? 'Mẫu?').join(' / ') : 'Chưa chọn mẫu (nhóm chưa có tiêu chuẩn theo mẫu)';
      const entry = map.get(model) ?? { model, sizes: new Map(), total: 0 };
      const size = e.uniformSize || 'Chưa có size';
      entry.sizes.set(size, (entry.sizes.get(size) ?? 0) + e.usage.remaining);
      entry.total += e.usage.remaining;
      map.set(model, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [list.data, modelName]);

  const stats = list.data?.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Cấp phát đồng phục theo nhân viên"
        description="Tiêu chuẩn năm theo nhóm (mặc định 3 áo/người/năm). Đã cấp = phiếu đồng phục đã ký trong năm + đồng phục ghi tay ở phiếu cũ; chờ ký = phiếu đang chờ. Cho mượn không tính tiêu chuẩn."
        actions={
          <>
            <select
              className="field-input w-auto"
              aria-label="Năm"
              value={year}
              onChange={(e) => setParams({ year: e.target.value }, { replace: true })}
            >
              {[currentYear() + 1, currentYear(), currentYear() - 1, currentYear() - 2].map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </select>
            <ExportCsvButton dataset="uniform-employees" filters={{ year, department, q: query.trim() }} />
          </>
        }
      />

      {stats && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-stone-100 px-3 py-1">{stats.total} nhân viên</span>
          <span className={cn('rounded-full px-3 py-1', stats.missingSize ? 'bg-amber-50 text-amber-900' : 'bg-stone-100')}>Thiếu size: {stats.missingSize}</span>
          <span className={cn('rounded-full px-3 py-1', stats.missingGender ? 'bg-amber-50 text-amber-900' : 'bg-stone-100')}>Thiếu giới tính: {stats.missingGender}</span>
          <span className={cn('rounded-full px-3 py-1', stats.overQuota ? 'bg-red-50 text-red-800' : 'bg-stone-100')}>Vượt tiêu chuẩn: {stats.overQuota}</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">Đang mượn: {stats.withLoans}</span>
          <span className={cn('rounded-full px-3 py-1', stats.overdueLoans ? 'bg-red-50 text-red-800' : 'bg-stone-100')}>Quá hạn trả: {stats.overdueLoans}</span>
        </div>
      )}

      <section className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]" aria-label="Bộ lọc">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" className="field-input pl-9" placeholder="Tìm tên, mã NV, phòng ban…" aria-label="Tìm nhân viên" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="field-input" aria-label="Phòng ban" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Mọi phòng ban</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" className="size-4 accent-brand-700" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Chỉ người cần xử lý
        </label>
      </section>

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'}>
        {list.status === 'loading' && !list.data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !list.data && <ErrorState className="border-0 shadow-none" title="Không tải được danh sách." error={list.error} onRetry={list.reload} />}
        {list.data && rows.length === 0 && <EmptyState title="Không có nhân viên phù hợp." />}
        {rows.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Nhân viên</th>
                  <th scope="col" className="px-3 py-2.5">Giới tính · size</th>
                  <th scope="col" className="px-3 py-2.5">Nhóm</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Tiêu chuẩn</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Đã cấp</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Chờ ký</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Còn lại</th>
                  <th scope="col" className="px-3 py-2.5">Đang mượn</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((e) => (
                  <tr key={e.employeeId} className={e.status === 'ACTIVE' ? '' : 'opacity-60'}>
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/dong-phuc/nhan-vien/${encodeURIComponent(e.employeeId)}?year=${year}`} className="font-medium text-brand-800 hover:underline">
                        {e.fullName}
                      </Link>
                      <p className="text-xs text-stone-500">
                        {e.employeeId} · {e.department || '—'}
                        {e.position ? ` · ${e.position}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={e.gender ? '' : 'text-amber-700'}>{genderLabel(e.gender)}</span> ·{' '}
                      <strong className={e.uniformSize ? '' : 'font-normal text-amber-700'}>{e.uniformSize || 'chưa có size'}</strong>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{e.scope?.scopeName ?? (e.usage.source === 'NONE' ? 'Không áp dụng' : 'Mặc định')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.usage.yearlyQuota ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {e.usage.issued + e.usage.legacy}
                      {e.usage.legacy > 0 && <span className="block text-[11px] text-stone-500">gồm {e.usage.legacy} phiếu cũ</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.usage.pending || ''}</td>
                    <td className="px-3 py-2.5 text-right">
                      <RemainingCell row={e} />
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {e.holdings.loaned > 0 ? (
                        <span className={e.holdings.overdue ? 'font-semibold text-red-700' : ''}>
                          {e.holdings.loaned}
                          {e.holdings.overdue ? ` (quá hạn ${e.holdings.overdue})` : ''}
                        </span>
                      ) : (
                        ''
                      )}
                      {e.lastIssuedAt && <span className="block text-stone-500">Lần cấp gần nhất: {formatDate(e.lastIssuedAt)}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)} icon={<UserRoundPen className="size-4" aria-hidden="true" />}>
                          Size
                        </Button>
                        {e.status === 'ACTIVE' && (
                          <ButtonLink
                            size="sm"
                            to={`/admin/ban-giao/tao-moi?loai=UNIFORM&nhan=${encodeURIComponent(e.employeeId)}`}
                            icon={<FilePlus2 className="size-4" aria-hidden="true" />}
                          >
                            Cấp
                          </ButtonLink>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {forecast.length > 0 && (
        <section className="card p-4" aria-labelledby="dp-forecast">
          <h2 id="dp-forecast" className="section-title">
            Dự trù đặt may — phần tiêu chuẩn còn lại năm {year}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Cộng phần “còn lại” của nhân viên đang làm theo mẫu gợi ý của nhóm × size — dùng để lập “Danh sách mua đồng phục”. Mẫu gợi ý lấy từ trang
            Tiêu chuẩn năm (tiêu chuẩn theo mẫu của từng nhóm).
          </p>
          <div className="mt-3 space-y-2">
            {forecast.map((f) => (
              <div key={f.model} className="rounded-lg border border-stone-200 p-3 text-sm">
                <p className="font-semibold text-stone-900">
                  {f.model} — <span className="tabular-nums">{f.total}</span> áo
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {[...f.sizes.entries()].sort().map(([size, qty]) => (
                    <span key={size} className={cn('rounded-md px-2 py-0.5 tabular-nums', size === 'Chưa có size' ? 'bg-amber-50 text-amber-900' : 'bg-stone-100')}>
                      {size}: <strong>{qty}</strong>
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ProfileDialog
        open={editing !== null}
        employee={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          toast.show(`Đã lưu size / giới tính của ${editing?.fullName ?? 'nhân viên'}.`);
          setEditing(null);
          list.reload();
        }}
      />
    </div>
  );
}
