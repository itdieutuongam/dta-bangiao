import { AlertTriangle, FilePlus2, Repeat, Shirt, UserRound, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { HandoverStatus } from '../../../../shared/constants';
import { STOCK_STATUS_LABELS } from '../../../../shared/vpp';
import { ButtonLink } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingCard } from '../../../components/ui/States';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { uniformDashboard } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { formatDate, formatDateTime } from '../../../utils/format';

function Tile({ label, value, tone = 'neutral', to, hint }: { label: string; value: ReactNode; tone?: 'neutral' | 'warn' | 'bad' | 'good'; to?: string; hint?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'bad' && 'text-red-700',
          tone === 'warn' && 'text-orange-700',
          tone === 'good' && 'text-emerald-700',
          tone === 'neutral' && 'text-brand-900',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card block p-4 transition-shadow hover:shadow-md">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

/** /admin/dong-phuc — tổng quan đồng phục: tồn, cảnh báo size hết / sắp hết, đồ mượn quá hạn, cấp phát năm, hồ sơ size còn thiếu. */
export default function UniformOverviewPage() {
  useDocumentTitle('Đồng phục — tổng quan');
  const dashboard = useAsync((signal) => uniformDashboard(signal), []);
  const d = dashboard.data;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Đồng phục"
        description="Cấp phát theo tiêu chuẩn năm (mặc định 3 áo/người/năm — Chính sách người lao động 19/08/2025), cho mượn có hạn trả, tồn kho theo mẫu × size."
        actions={
          <ButtonLink to="/admin/ban-giao/tao-moi?loai=UNIFORM" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />}>
            Tạo phiếu đồng phục
          </ButtonLink>
        }
      />

      {dashboard.status === 'loading' && !d && <LoadingCard lines={6} />}
      {dashboard.status === 'error' && !d && <ErrorState title="Không tải được tổng quan đồng phục." error={dashboard.error} onRetry={dashboard.reload} />}

      {d && d.counts.models === 0 && (
        <div className="card">
          <EmptyState
            title="Chưa có mẫu đồng phục"
            description="Chủ Google Sheet chạy menu “DTA Handover → Khởi tạo danh mục đồng phục” (7 mẫu theo danh sách đồng phục của HCNS), rồi nhập tồn đầu kỳ ở trang Tồn kho & mẫu."
            action={
              <ButtonLink to="/admin/dong-phuc/ton-kho" icon={<Warehouse className="size-4" aria-hidden="true" />}>
                Tồn kho & mẫu
              </ButtonLink>
            }
          />
        </div>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Khả dụng trong kho" value={d.counts.available.toLocaleString('vi-VN')} hint={`Tồn ${d.counts.onHand} · đang giữ ${d.counts.reserved}`} to="/admin/dong-phuc/ton-kho" />
            <Tile label="Size hết hàng (hàng mới)" value={d.counts.outOfStockSkus} tone={d.counts.outOfStockSkus ? 'bad' : 'good'} hint={`Sắp hết: ${d.counts.lowStockSkus}`} to="/admin/dong-phuc/ton-kho" />
            <Tile label="Đang cho mượn" value={d.counts.loansOutstanding} tone={d.counts.loansOverdue ? 'warn' : 'neutral'} hint={`Quá hạn: ${d.counts.loansOverdue}`} to="/admin/dong-phuc/muon-tra" />
            <Tile label={`Đã cấp năm ${d.year}`} value={d.counts.issuedThisYear} hint={`Phiếu chờ ký: ${d.counts.pendingHandovers}`} to="/admin/dong-phuc/nhan-vien" />
          </div>

          {(d.counts.employeesMissingSize > 0 || d.counts.employeesMissingGender > 0 || d.counts.overQuotaEmployees > 0) && (
            <section className="card space-y-1 p-4 text-sm" aria-label="Cần xử lý">
              <p className="flex items-center gap-2 font-semibold text-amber-900">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Cần xử lý
              </p>
              <ul className="list-disc space-y-0.5 pl-6 text-stone-700">
                {d.counts.employeesMissingSize > 0 && (
                  <li>
                    <strong>{d.counts.employeesMissingSize}</strong> nhân viên chưa có size đồng phục —{' '}
                    <Link to="/admin/dong-phuc/nhan-vien" className="font-semibold text-brand-700 underline">
                      cập nhật
                    </Link>{' '}
                    (hoặc điền cột uniform_size trên sheet NHAN_VIEN).
                  </li>
                )}
                {d.counts.employeesMissingGender > 0 && <li><strong>{d.counts.employeesMissingGender}</strong> nhân viên chưa khai báo giới tính (cột gender).</li>}
                {d.counts.overQuotaEmployees > 0 && <li><strong>{d.counts.overQuotaEmployees}</strong> nhân viên đã vượt tiêu chuẩn năm {d.year}.</li>}
              </ul>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card p-4" aria-labelledby="dp-alerts">
              <h2 id="dp-alerts" className="section-title flex items-center gap-2">
                <Shirt className="size-4" aria-hidden="true" /> Size hết / sắp hết
              </h2>
              {d.alerts.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">Không có size nào hết hoặc dưới mức tối thiểu.</p>
              ) : (
                <ul className="mt-2 divide-y divide-stone-100 text-sm">
                  {d.alerts.map((a) => (
                    <li key={a.productId} className="flex items-center justify-between gap-2 py-1.5">
                      <span>
                        {a.modelName} · <strong>{a.size}</strong>
                      </span>
                      <span className={cn('text-xs font-semibold', a.status === 'OUT_OF_STOCK' ? 'text-red-700' : 'text-orange-700')}>
                        {STOCK_STATUS_LABELS[a.status]} · còn {a.available ?? '?'}
                        {a.minimumStock ? ` (tối thiểu ${a.minimumStock})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4" aria-labelledby="dp-overdue">
              <h2 id="dp-overdue" className="section-title flex items-center gap-2">
                <Repeat className="size-4" aria-hidden="true" /> Đồ mượn quá hạn trả
              </h2>
              {d.overdueLoans.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">Không có đồ mượn quá hạn.</p>
              ) : (
                <ul className="mt-2 divide-y divide-stone-100 text-sm">
                  {d.overdueLoans.map((h) => (
                    <li key={h.itemId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>
                        <Link to={`/admin/dong-phuc/nhan-vien/${encodeURIComponent(h.employeeId)}`} className="font-medium text-brand-800 hover:underline">
                          {h.employeeName}
                        </Link>{' '}
                        · {h.modelName} {h.size} × {h.outstanding}
                      </span>
                      <span className="text-xs font-semibold text-red-700">hạn {formatDate(h.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/admin/dong-phuc/muon-tra?status=overdue" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Xem trang Mượn / Trả →
              </Link>
            </section>
          </div>

          <section className="card p-4" aria-labelledby="dp-recent">
            <h2 id="dp-recent" className="section-title flex items-center gap-2">
              <UserRound className="size-4" aria-hidden="true" /> Phiếu đồng phục gần đây
            </h2>
            {d.recentIssues.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Chưa có phiếu đồng phục nào.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {d.recentIssues.map((r) => (
                  <li key={r.handoverId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <Link to={`/admin/ban-giao/${r.handoverId}`} className="font-mono font-semibold text-brand-800 hover:underline">
                        {r.handoverCode}
                      </Link>{' '}
                      · {r.receiverName} {r.department ? `(${r.department})` : ''} · {r.quantity} áo
                    </span>
                    <span className="flex items-center gap-2 text-xs text-stone-500">
                      {formatDateTime(r.createdAt)}
                      <StatusBadge status={r.status as HandoverStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
