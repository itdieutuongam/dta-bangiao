import { Boxes, ChevronRight, Database, FilePlus2, PackageSearch, ShoppingCart } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatVnd, type StockAlertItem, type VppDashboard } from '../../../../shared/vpp';
import { ButtonLink } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, LoadingCard } from '../../../components/ui/States';
import { ProposalStatusBadge, Qty } from '../../../components/vpp/Badges';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { isApiError } from '../../../services/api';
import { vppDashboard } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { formatDateTime } from '../../../utils/format';

/** /admin/vpp — tổng quan kho văn phòng phẩm: số liệu, cảnh báo 🔴🟠🟡, đề xuất mới. */
export default function VppOverviewPage() {
  useDocumentTitle('Văn phòng phẩm');
  const { handleError } = useAdmin();
  const dashboard = useAsync(() => vppDashboard(), []);

  useEffect(() => {
    if (dashboard.status === 'error' && isApiError(dashboard.error) && dashboard.error.status === 401) handleError(dashboard.error);
  }, [dashboard.status, dashboard.error, handleError]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Văn phòng phẩm"
        description="Tổng quan kho, cảnh báo hết hàng / sắp hết và đề xuất mua."
        actions={
          <>
            <ButtonLink to="/admin/ban-giao/tao-moi?loai=OFFICE_SUPPLY" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />}>
              Tạo phiếu VPP
            </ButtonLink>
            <ButtonLink to="/admin/vpp/ton-kho" icon={<PackageSearch className="size-4" aria-hidden="true" />}>
              Tồn kho
            </ButtonLink>
          </>
        }
      />
      {dashboard.status === 'loading' && !dashboard.data && (
        <div className="space-y-4">
          <LoadingCard lines={2} />
          <LoadingCard lines={5} />
        </div>
      )}
      {dashboard.status === 'error' && !dashboard.data && (
        <ErrorState
          title={isApiError(dashboard.error, 'NOT_CONFIGURED') ? 'Module văn phòng phẩm chưa sẵn sàng.' : 'Không tải được tổng quan kho.'}
          error={dashboard.error}
          onRetry={dashboard.reload}
          action={
            isApiError(dashboard.error, 'NOT_CONFIGURED') ? (
              <ButtonLink to="/admin/cai-dat">Xem hướng dẫn nâng cấp</ButtonLink>
            ) : undefined
          }
        />
      )}
      {dashboard.data && <DashboardBody data={dashboard.data} />}
    </div>
  );
}

function Stat({ to, label, value, tone }: { to: string; label: string; value: number; tone: string }) {
  return (
    <Link to={to} className={cn('rounded-xl border bg-white p-4 shadow-xs transition-shadow hover:shadow-md', tone)}>
      <span className="block text-xs font-semibold tracking-wide uppercase opacity-80">{label}</span>
      <span className="mt-1 block text-2xl font-bold tabular-nums">{value}</span>
    </Link>
  );
}

function AlertSection({
  title,
  icon,
  items,
  total,
  detail,
  to,
  empty,
  tone,
}: {
  title: string;
  icon: string;
  items: StockAlertItem[];
  total: number;
  /** Dòng phụ dưới tiêu đề (ví dụ số vấn đề / ý nghĩa danh sách bên dưới). */
  detail?: string;
  to: string;
  empty: string;
  tone: string;
}) {
  return (
    <section className="card p-4 sm:p-5" aria-label={title}>
      <Link to={to} className={cn('flex items-center justify-between gap-2 font-bold hover:underline', tone)}>
        <span>
          <span aria-hidden="true">{icon} </span>
          {title}
        </span>
        <span className="tabular-nums">{total}</span>
      </Link>
      {detail && <p className="mt-0.5 text-xs text-stone-500">{detail}</p>}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {items.slice(0, 8).map((p) => (
            <li key={p.productId} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0 break-words text-stone-800">{p.productName}</span>
              <span className="shrink-0 text-right text-xs text-stone-600">
                {p.onHand === null ? (
                  <>Gốc: “{p.rawInitialValue || '—'}”</>
                ) : (
                  <>
                    Khả dụng <Qty value={p.available} unit={p.unit} />
                    {p.minimumStock > 0 ? ` / tối thiểu ${p.minimumStock}` : ''}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > 8 && (
        <Link to={to} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          Xem tất cả <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

function QuickLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
      <span className="flex items-center gap-2">
        {icon}
        {children}
      </span>
      <ChevronRight className="size-4 text-stone-400" aria-hidden="true" />
    </Link>
  );
}

function DashboardBody({ data }: { data: VppDashboard }) {
  const c = data.counts;
  return (
    <>
      <section aria-label="Số liệu kho" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat to="/admin/vpp/ton-kho?catalogStatus=MASTER" label="SP danh mục" value={c.products} tone="border-brand-200 text-brand-900" />
        <Stat to="/admin/vpp/ton-kho?catalogStatus=TEMP" label="SP tạm" value={c.tempProducts} tone="border-stone-300 text-stone-700" />
        <Stat to="/admin/vpp/ton-kho?stockStatus=OUT_OF_STOCK" label="Hết hàng" value={c.outOfStock} tone="border-red-200 text-red-800" />
        <Stat to="/admin/vpp/ton-kho?stockStatus=LOW_STOCK" label="Sắp hết" value={c.lowStock} tone="border-orange-200 text-orange-800" />
        <Stat to="/admin/vpp/data-review" label="SP cần kiểm tra" value={c.needsReviewProducts} tone="border-amber-200 text-amber-800" />
        <Stat to="/admin/vpp/de-xuat?status=SUBMITTED" label="Đề xuất chờ duyệt" value={c.submittedProposals} tone="border-sky-200 text-sky-800" />
      </section>

      <p className="text-sm text-stone-600">
        Đang giữ chỗ <strong className="text-stone-900">{c.reservedUnits}</strong> đơn vị cho{' '}
        <Link to="/admin/ban-giao?handoverType=OFFICE_SUPPLY&status=PENDING" className="font-semibold text-brand-700 hover:underline">
          {c.pendingHandovers} phiếu văn phòng phẩm chờ ký
        </Link>
        {c.revisionHandovers > 0 && (
          <>
            {' '}
            và{' '}
            <Link to="/admin/ban-giao?handoverType=OFFICE_SUPPLY&status=REVISION_REQUESTED" className="font-semibold text-brand-700 hover:underline">
              {c.revisionHandovers} phiếu người nhận yêu cầu sửa
            </Link>
          </>
        )}
        {c.approvedProposals > 0 && (
          <>
            {' '}
            · <strong className="text-stone-900">{c.approvedProposals}</strong> đề xuất đã duyệt chờ mua / nhập kho
          </>
        )}
        .
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <AlertSection
          title="HẾT HÀNG"
          icon="🔴"
          items={data.outOfStock}
          total={c.outOfStock}
          to="/admin/vpp/ton-kho?stockStatus=OUT_OF_STOCK"
          empty="Không có sản phẩm hết hàng."
          tone="text-red-800"
        />
        <AlertSection
          title="SẮP HẾT"
          icon="🟠"
          items={data.lowStock}
          total={c.lowStock}
          to="/admin/vpp/ton-kho?stockStatus=LOW_STOCK"
          empty="Không có sản phẩm dưới mức tối thiểu."
          tone="text-orange-800"
        />
        <AlertSection
          title="DỮ LIỆU CẦN KIỂM TRA"
          icon="🟡"
          items={data.unknown}
          total={c.needsReviewProducts}
          detail={`${c.needsReviewProducts} sản phẩm · ${c.needsReview} vấn đề. Danh sách dưới: tồn chưa rõ số lượng.`}
          to="/admin/vpp/data-review"
          empty="Không có tồn kho chưa rõ số lượng."
          tone="text-amber-800"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2" aria-labelledby="recent-proposals">
          <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
            <h2 id="recent-proposals" className="text-sm font-semibold text-stone-800">
              Đề xuất mua gần đây
            </h2>
            <Link to="/admin/vpp/de-xuat" className="text-sm font-medium text-brand-700 hover:underline">
              Xem tất cả
            </Link>
          </div>
          {data.recentProposals.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-500">Chưa có đề xuất nào.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {data.recentProposals.map((p) => (
                <li key={p.proposalId}>
                  <Link to={`/admin/vpp/de-xuat/${p.proposalId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-900">
                        <span className="font-mono">{p.proposalCode}</span> · {p.requesterName}
                      </span>
                      <span className="block text-xs text-stone-500">
                        {p.department || '—'} · {p.itemCount} sản phẩm · {formatVnd(p.estimatedTotal)} · {formatDateTime(p.createdAt)}
                      </span>
                    </span>
                    <ProposalStatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-2" aria-label="Lối tắt">
          <QuickLink to="/admin/vpp/ton-kho" icon={<Boxes className="size-4 text-brand-600" aria-hidden="true" />}>
            Nhập kho / kiểm kê
          </QuickLink>
          <QuickLink to="/admin/vpp/dinh-muc" icon={<PackageSearch className="size-4 text-brand-600" aria-hidden="true" />}>
            Định mức theo phòng ban
          </QuickLink>
          <QuickLink to="/admin/vpp/de-xuat" icon={<ShoppingCart className="size-4 text-brand-600" aria-hidden="true" />}>
            Đề xuất mua
          </QuickLink>
          <QuickLink to="/admin/vpp/data-review" icon={<Database className="size-4 text-brand-600" aria-hidden="true" />}>
            Dữ liệu cần kiểm tra
          </QuickLink>
        </section>
      </div>
    </>
  );
}
