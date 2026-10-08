import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { AdminEmployee } from '../../../shared/types';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminAllEmployees } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { buildEmployeeIndex, searchEmployees } from '../../utils/employeeSearch';
import { cn } from '../../utils/cn';

/** /admin/nhan-vien — danh bạ nhân viên (chỉ quản trị viên xem). Dữ liệu gốc nằm ở sheet NHAN_VIEN. */
export default function AdminEmployeesPage() {
  useDocumentTitle('Nhân viên');
  const { handleError } = useAdmin();
  const list = useAsync(() => adminAllEmployees(), []);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (list.status === 'error' && isApiError(list.error) && list.error.status === 401) handleError(list.error);
  }, [list.status, list.error, handleError]);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const departments = useMemo(() => [...new Set(all.map((e) => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [all]);
  const filtered = useMemo(() => {
    const scoped = all.filter((e) => (!department || e.department === department) && (!status || (e.status ?? 'ACTIVE') === status));
    if (!query.trim()) return scoped;
    const byId = new Map(scoped.map((e) => [e.employeeId, e]));
    // Tìm không dấu ("pham danh thai" = "Phạm Danh Thái").
    return searchEmployees(buildEmployeeIndex(scoped), query, scoped.length)
      .map((e) => byId.get(e.employeeId))
      .filter((e): e is AdminEmployee => e !== undefined);
  }, [all, department, status, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Nhân viên"
        description={
          <>
            Danh sách lấy từ sheet <strong>NHAN_VIEN</strong> trên Google Sheet — thêm / sửa / cho nghỉ việc ở đó, rồi bấm “Làm mới dữ liệu” ở thanh bên.
          </>
        }
      />

      <section className="card grid gap-3 p-4 sm:grid-cols-3" aria-label="Bộ lọc">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Tên, mã NV, email…"
            aria-label="Tìm nhân viên"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="field-input" aria-label="Phòng ban" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Mọi phòng ban</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className="field-input" aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ACTIVE">Đang làm việc</option>
          <option value="INACTIVE">Đã nghỉ</option>
          <option value="">Tất cả</option>
        </select>
      </section>

      <section className="card overflow-hidden" aria-busy={list.status === 'loading'} aria-label="Danh sách nhân viên">
        <div className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-800">
          {list.data ? `${filtered.length} / ${all.length} nhân viên` : 'Danh sách nhân viên'}
        </div>
        {list.status === 'loading' && !list.data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !list.data && (
          <ErrorState className="border-0 shadow-none" title="Không tải được danh sách nhân viên." error={list.error} onRetry={list.reload} />
        )}
        {list.data && filtered.length === 0 && <EmptyState title="Không có nhân viên phù hợp." />}
        {filtered.length > 0 && (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Mã NV</th>
                    <th scope="col" className="px-3 py-2.5">Họ tên</th>
                    <th scope="col" className="px-3 py-2.5">Phòng ban</th>
                    <th scope="col" className="px-3 py-2.5">Chức vụ</th>
                    <th scope="col" className="px-3 py-2.5">Email</th>
                    <th scope="col" className="px-3 py-2.5">Định mức VPP</th>
                    <th scope="col" className="px-4 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((e) => (
                    <tr key={e.employeeId} className={e.status === 'INACTIVE' ? 'opacity-60' : ''}>
                      <td className="px-4 py-2.5 font-mono text-xs">{e.employeeId}</td>
                      <td className="px-3 py-2.5 font-medium text-stone-900">{e.fullName}</td>
                      <td className="px-3 py-2.5">{e.department || '—'}</td>
                      <td className="px-3 py-2.5">{e.position || '—'}</td>
                      <td className="px-3 py-2.5 break-all">{e.email || '—'}</td>
                      <td className="px-3 py-2.5">
                        <ScopeCell employee={e} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-stone-100 md:hidden">
              {filtered.map((e) => (
                <li key={e.employeeId} className={cn('p-4', e.status === 'INACTIVE' && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-stone-900">{e.fullName}</p>
                      <p className="text-xs text-stone-500">
                        <span className="font-mono">{e.employeeId}</span>
                        {e.department ? ` · ${e.department}` : ''}
                        {e.position ? ` · ${e.position}` : ''}
                      </p>
                    </div>
                    <StatusPill status={e.status} />
                  </div>
                  {e.email && <p className="mt-0.5 text-xs break-all text-stone-600">{e.email}</p>}
                  <p className="mt-1 text-xs">
                    <ScopeCell employee={e} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: AdminEmployee['status'] }) {
  const active = (status ?? 'ACTIVE') === 'ACTIVE';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', active ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600')}>
      {active ? 'Đang làm việc' : 'Đã nghỉ'}
    </span>
  );
}

function ScopeCell({ employee }: { employee: AdminEmployee }) {
  if (!employee.vppScope) {
    return (
      <Link to="/admin/vpp/dinh-muc" className="text-amber-800 hover:underline">
        Chưa gắn
      </Link>
    );
  }
  return (
    <span className="text-stone-700">
      {employee.vppScope.scopeName}
      <span className="ml-1 text-stone-400">({employee.vppScope.source === 'MAPPING' ? 'gắn thủ công' : 'tự khớp'})</span>
    </span>
  );
}
