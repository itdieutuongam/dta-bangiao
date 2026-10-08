import { Boxes, ChevronRight, FilePlus2, MailWarning as MailWarningIcon, MessageSquareWarning, ShoppingCart } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { HANDOVER_TYPE_LABELS, NOTIFY_EVENT_LABELS, STATUS_LABELS, type HandoverStatus } from '../../../shared/constants';
import type { AdminOverview, HandoverStats, NotifyChannelStatus } from '../../../shared/types';
import type { StockAlertItem } from '../../../shared/vpp';
import { ButtonLink } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingCard } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Qty } from '../../components/vpp/Badges';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminOverview } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';

const STAT_CARDS: Array<{ key: keyof HandoverStats; label: string; status: HandoverStatus | ''; tone: string }> = [
  { key: 'total', label: 'Tổng số phiếu', status: '', tone: 'border-brand-200 text-brand-900' },
  { key: 'PENDING', label: STATUS_LABELS.PENDING, status: 'PENDING', tone: 'border-amber-200 text-amber-800' },
  { key: 'REVISION_REQUESTED', label: STATUS_LABELS.REVISION_REQUESTED, status: 'REVISION_REQUESTED', tone: 'border-orange-200 text-orange-800' },
  { key: 'CONFIRMED', label: STATUS_LABELS.CONFIRMED, status: 'CONFIRMED', tone: 'border-emerald-200 text-emerald-800' },
  { key: 'CANCELLED', label: STATUS_LABELS.CANCELLED, status: 'CANCELLED', tone: 'border-stone-300 text-stone-700' },
];

/** /admin — tổng quan: số phiếu theo trạng thái, yêu cầu chỉnh sửa cần xử lý, cảnh báo kho VPP, phiếu mới nhất. */
export default function AdminOverviewPage() {
  useDocumentTitle('Tổng quan');
  const { handleError, user } = useAdmin();
  const overview = useAsync(() => adminOverview(), []);

  useEffect(() => {
    if (overview.status === 'error' && isApiError(overview.error) && overview.error.status === 401) handleError(overview.error);
  }, [overview.status, overview.error, handleError]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Tổng quan"
        description={user ? `Xin chào ${user.name}.` : 'Tình hình phiếu bàn giao và kho văn phòng phẩm.'}
        actions={
          <>
            <ButtonLink to="/admin/ban-giao/tao-moi" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden="true" />}>
              Tạo phiếu
            </ButtonLink>
            <ButtonLink to="/admin/ban-giao/tao-moi?loai=OFFICE_SUPPLY" icon={<Boxes className="size-4" aria-hidden="true" />}>
              Phiếu văn phòng phẩm
            </ButtonLink>
          </>
        }
      />

      {overview.status === 'loading' && !overview.data && (
        <div className="space-y-4">
          <LoadingCard lines={2} />
          <div className="grid gap-4 lg:grid-cols-2">
            <LoadingCard lines={4} />
            <LoadingCard lines={4} />
          </div>
        </div>
      )}
      {overview.status === 'error' && !overview.data && (
        <ErrorState title="Không tải được tổng quan." error={overview.error} onRetry={overview.reload} />
      )}
      {overview.data && <OverviewBody data={overview.data} />}
    </div>
  );
}

type MailError = NonNullable<NotifyChannelStatus['lastError']>;

function MailWarning({ title, error, impact, critical }: { title: string; error: MailError; impact: string; critical: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        critical ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
      role={critical ? 'alert' : 'status'}
    >
      <p className="flex items-center gap-2 font-semibold">
        <MailWarningIcon className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 break-words">{error.message}</p>
      <p className="mt-1 text-xs">
        {impact} Xem hướng dẫn ở{' '}
        <Link to="/admin/cai-dat" className="font-semibold underline">
          Cài đặt → Email
        </Link>
        . Cảnh báo tự hết khi email cùng loại gửi thành công.
      </p>
    </div>
  );
}

/** Lỗi gửi email — hai loại tách riêng: gửi được mã OTP không che mất lỗi email thông báo và ngược lại. */
function MailWarnings({ notify }: { notify: AdminOverview['notify'] | undefined }) {
  // Máy chủ Apps Script bản cũ chưa tách hai loại → không có otp / notify.
  const otpError = notify?.otp?.lastError ?? null;
  const notifyError = notify?.notify?.lastError ?? null;
  if (!otpError && !notifyError) return null;
  return (
    <div className="space-y-3">
      {otpError && (
        <MailWarning
          critical
          title={`Gửi email mã xác nhận khi ký bị lỗi lúc ${formatDateTime(otpError.at)}`}
          error={otpError}
          impact="Người nhận có thể không nhận được mã xác nhận để ký biên bản."
        />
      )}
      {notifyError && (
        <MailWarning
          critical={false}
          title={`Gửi email thông báo cho quản trị viên bị lỗi lúc ${formatDateTime(notifyError.at)} (${NOTIFY_EVENT_LABELS[notifyError.event] ?? notifyError.event})`}
          error={notifyError}
          impact="Thông báo cho quản trị viên chưa gửi được (dữ liệu vẫn đã lưu)."
        />
      )}
    </div>
  );
}

function OverviewBody({ data }: { data: AdminOverview }) {
  return (
    <>
      <MailWarnings notify={data.notify} />

      <section aria-label="Thống kê phiếu bàn giao" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {STAT_CARDS.map((card) => (
          <Link
            key={card.key}
            to={card.status ? `/admin/ban-giao?status=${card.status}` : '/admin/ban-giao'}
            className={cn(
              'rounded-xl border bg-white p-4 shadow-xs transition-shadow hover:shadow-md',
              card.tone,
              card.key === 'total' && 'col-span-2 md:col-span-1',
            )}
          >
            <span className="block text-xs font-semibold tracking-wide uppercase opacity-80">{card.label}</span>
            <span className="mt-1 block text-2xl font-bold tabular-nums">{data.stats[card.key]}</span>
          </Link>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 sm:p-5" aria-labelledby="revision-title">
          <h2 id="revision-title" className="section-title flex items-center gap-2">
            <MessageSquareWarning className="size-5 text-orange-600" aria-hidden="true" />
            Yêu cầu chỉnh sửa cần xử lý
            {data.stats.REVISION_REQUESTED > 0 && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{data.stats.REVISION_REQUESTED}</span>
            )}
          </h2>
          {data.revisionRequested.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">Không có yêu cầu chỉnh sửa nào.</p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {data.revisionRequested.map((r) => (
                <li key={r.id}>
                  <Link to={`/admin/ban-giao/${r.id}`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-900">
                        <span className="font-mono">{r.code}</span> · {r.receiverName}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm break-words text-stone-600">{r.receiverComment}</span>
                      <span className="block text-xs text-stone-500">{formatDateTime(r.revisionRequestedAt)}</span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-stone-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <VppAlertsCard data={data} />
      </div>

      <section className="card overflow-hidden" aria-labelledby="recent-title">
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 id="recent-title" className="text-sm font-semibold text-stone-800">
            Phiếu mới nhất
          </h2>
          <Link to="/admin/ban-giao" className="text-sm font-medium text-brand-700 hover:underline">
            Xem tất cả
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <EmptyState
            title="Chưa có phiếu bàn giao nào."
            action={
              <ButtonLink to="/admin/ban-giao/tao-moi" variant="primary" size="sm">
                Tạo phiếu đầu tiên
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.recent.map((h) => (
              <li key={h.id}>
                <Link to={`/admin/ban-giao/${h.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stone-900">
                      <span className="font-mono">{h.code}</span> · {h.receiverName}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {HANDOVER_TYPE_LABELS[h.handoverType] ?? h.handoverType} · {h.receiverDepartment || '—'} · {formatDateTime(h.createdAt)}
                    </span>
                  </span>
                  <StatusBadge status={h.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AlertList({ items }: { items: StockAlertItem[] }) {
  return (
    <ul className="mt-1.5 space-y-1 pl-7 text-sm">
      {items.map((p) => (
        <li key={p.productId} className="flex justify-between gap-3">
          <span className="min-w-0 break-words text-stone-800">{p.productName}</span>
          <span className="shrink-0 text-stone-600">
            Khả dụng: <Qty value={p.available} unit={p.unit} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function VppAlertsCard({ data }: { data: AdminOverview }) {
  const vpp = data.vpp;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="vpp-alert-title">
      <h2 id="vpp-alert-title" className="section-title flex items-center gap-2">
        <Boxes className="size-5 text-brand-600" aria-hidden="true" />
        Cảnh báo văn phòng phẩm
      </h2>
      {!vpp.ready ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Module văn phòng phẩm chưa sẵn sàng — cần chạy nâng cấp dữ liệu trên Google Sheet.{' '}
          <Link to="/admin/cai-dat" className="font-semibold underline">
            Xem hướng dẫn
          </Link>
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <Link to="/admin/vpp/ton-kho?stockStatus=OUT_OF_STOCK" className="flex items-center justify-between gap-2 font-semibold text-red-800 hover:underline">
              <span>
                <span aria-hidden="true">🔴 </span>HẾT HÀNG
              </span>
              <span className="tabular-nums">{vpp.outOfStockCount}</span>
            </Link>
            {vpp.outOfStock.length > 0 && <AlertList items={vpp.outOfStock.slice(0, 5)} />}
          </div>
          <div>
            <Link to="/admin/vpp/ton-kho?stockStatus=LOW_STOCK" className="flex items-center justify-between gap-2 font-semibold text-orange-800 hover:underline">
              <span>
                <span aria-hidden="true">🟠 </span>SẮP HẾT
              </span>
              <span className="tabular-nums">{vpp.lowStockCount}</span>
            </Link>
            {vpp.lowStock.length > 0 && <AlertList items={vpp.lowStock.slice(0, 5)} />}
          </div>
          <Link to="/admin/vpp/data-review" className="flex items-center justify-between gap-2 font-semibold text-amber-800 hover:underline">
            <span>
              <span aria-hidden="true">🟡 </span>DỮ LIỆU CẦN KIỂM TRA
            </span>
            <span className="text-right tabular-nums">
              {vpp.needsReviewProducts} sản phẩm
              <span className="block text-xs font-normal opacity-80">{vpp.needsReviewCount} vấn đề</span>
            </span>
          </Link>
          <Link
            to="/admin/vpp/de-xuat?status=SUBMITTED"
            className="flex items-center justify-between gap-2 border-t border-stone-100 pt-3 font-semibold text-brand-800 hover:underline"
          >
            <span className="flex items-center gap-1.5">
              <ShoppingCart className="size-4" aria-hidden="true" />
              Đề xuất mua chờ duyệt
            </span>
            <span className="tabular-nums">{vpp.submittedProposals}</span>
          </Link>
        </div>
      )}
    </section>
  );
}
