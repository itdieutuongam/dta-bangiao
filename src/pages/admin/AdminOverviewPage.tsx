import { Boxes, ChevronRight, FilePlus2, MailWarning as MailWarningIcon, MessageSquareText, MessageSquareWarning, Shirt, ShoppingCart } from 'lucide-react';
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
            <ButtonLink to="/admin/ban-giao/tao-moi?loai=UNIFORM" icon={<Shirt className="size-4" aria-hidden="true" />}>
              Phiếu đồng phục
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

/** Mã xác nhận khi ký chỉ bảo vệ người có email: còn nhân viên chưa có email → ký không cần mã (người cầm link ký thay được). */
function OtpCoverageWarning({ notify }: { notify: AdminOverview['notify'] | undefined }) {
  const coverage = notify?.emailCoverage;
  if (!notify || !coverage || !coverage.active) return null;
  const missing = coverage.active - coverage.withEmail;
  if (notify.otpMode !== 'OFF' && missing <= 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <MailWarningIcon className="size-4 shrink-0" aria-hidden="true" />
        {notify.otpMode === 'OFF'
          ? 'Đang TẮT mã xác nhận khi ký (CONFIRM_OTP = OFF)'
          : `${missing}/${coverage.active} nhân viên đang làm chưa có email — ${notify.otpMode === 'REQUIRED' ? 'chưa ký được biên bản' : 'ký không cần mã xác nhận'}`}
      </p>
      <p className="mt-1 text-xs">
        {notify.otpMode === 'REQUIRED'
          ? 'Bổ sung email công ty trong sheet NHAN_VIEN rồi bấm “Làm mới dữ liệu”.'
          : 'Người nhận không có email ký chỉ bằng link — ai cầm link (kể cả người lập phiếu) cũng ký thay được. Bổ sung email công ty cho mọi nhân viên trong sheet NHAN_VIEN, sau đó đặt CAU_HINH.CONFIRM_OTP = REQUIRED.'}
      </p>
    </div>
  );
}

/** Lỗi gửi email — hai loại tách riêng: gửi được mã OTP không che mất lỗi email thông báo và ngược lại. */
function MailWarnings({ notify }: { notify: AdminOverview['notify'] | undefined }) {
  // Máy chủ Apps Script bản cũ chưa tách hai loại → không có otp / notify.
  const otpError = notify?.otp?.lastError ?? null;
  const notifyError = notify?.notify?.lastError ?? null;
  if (!otpError && !notifyError) return <OtpCoverageWarning notify={notify} />;
  return (
    <div className="space-y-3">
      <OtpCoverageWarning notify={notify} />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <SignedWithCommentCard items={data.signedWithComment ?? []} />
        <UniformAlertsCard data={data} />
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

/** Biên bản đã ký nhưng người nhận ghi chú kèm (30 ngày) — ghi chú có thể trái với nội dung đã ký, nên đọc lại. */
function SignedWithCommentCard({ items }: { items: AdminOverview['signedWithComment'] }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="signed-comment-title">
      <h2 id="signed-comment-title" className="section-title flex items-center gap-2">
        <MessageSquareText className="size-5 text-sky-600" aria-hidden="true" />
        Đã ký kèm ghi chú (30 ngày)
        {items.length > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">Không có biên bản nào được ký kèm ghi chú.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={`/admin/ban-giao/${r.id}`} className="flex items-start justify-between gap-3 py-2.5 hover:bg-stone-50">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-stone-900">
                    <span className="font-mono">{r.code}</span> · {r.receiverName}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm break-words text-stone-600">“{r.receiverComment}”</span>
                  <span className="block text-xs text-stone-500">Ký {formatDateTime(r.confirmedAt)}</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-stone-400" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UniformAlertsCard({ data }: { data: AdminOverview }) {
  const u = data.uniform;
  const rows: Array<{ label: string; value: number; to: string; tone: string }> = u
    ? [
        { label: 'Size hết hàng (hàng mới)', value: u.outOfStockSkus, to: '/admin/dong-phuc/ton-kho', tone: 'text-red-800' },
        { label: 'Size sắp hết', value: u.lowStockSkus, to: '/admin/dong-phuc/ton-kho', tone: 'text-orange-800' },
        { label: 'Đồ mượn quá hạn trả', value: u.loansOverdue, to: '/admin/dong-phuc/muon-tra?status=overdue', tone: 'text-red-800' },
        { label: 'Phiếu đồng phục chờ ký', value: u.pendingHandovers, to: '/admin/ban-giao?handoverType=UNIFORM&status=PENDING', tone: 'text-amber-800' },
        { label: 'Nhân viên chưa có size', value: u.employeesMissingSize, to: '/admin/dong-phuc/nhan-vien', tone: 'text-amber-800' },
      ]
    : [];
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="uniform-alert-title">
      <h2 id="uniform-alert-title" className="section-title flex items-center gap-2">
        <Shirt className="size-5 text-brand-600" aria-hidden="true" />
        Đồng phục
      </h2>
      {!u ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Module đồng phục chưa sẵn sàng — chủ Google Sheet chạy menu “DTA Handover → Nâng cấp module Đồng phục (v3)” rồi “Khởi tạo danh mục đồng phục”.{' '}
          <Link to="/admin/cai-dat" className="font-semibold underline">
            Xem trạng thái hệ thống
          </Link>
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.label}>
              <Link to={r.to} className={cn('flex items-center justify-between gap-2 font-semibold hover:underline', r.value ? r.tone : 'text-stone-500')}>
                <span>{r.label}</span>
                <span className="tabular-nums">{r.value}</span>
              </Link>
            </li>
          ))}
          <li className="border-t border-stone-100 pt-2">
            <Link to="/admin/dong-phuc" className="font-semibold text-brand-700 hover:underline">
              Mở trang Đồng phục →
            </Link>
          </li>
        </ul>
      )}
    </section>
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
