import { ArrowLeft, Ban, CheckCheck, ExternalLink, History, PackageCheck, ShoppingBag, Archive } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LIMITS } from '../../../../shared/constants';
import {
  PRODUCT_APPROVAL_LABELS,
  PROPOSAL_STATUS_LABELS,
  formatVnd,
  type ProposalDetail,
  type ProposalItem,
  type ProposalStatus,
} from '../../../../shared/vpp';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { describedBy, Field } from '../../../components/ui/Field';
import { NumberInput } from '../../../components/ui/NumberInput';
import { ErrorState, InlineAlert, LoadingCard } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { ProposalStatusBadge, Qty } from '../../../components/vpp/Badges';
import { ProductDecisionDialog } from '../../../components/vpp/ProductDecisionDialog';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { ApiClientError, errorMessage, isApiError, isStaleStateError } from '../../../services/api';
import { vppApproveProposal, vppProposal, vppProposalStatus, vppReceiveProposal, vppRejectProposal } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { formatDateTime, todayIsoDate } from '../../../utils/format';
import { numberFormatError, numberToInput, parseViNumber } from '../../../utils/number';

const REVIEWABLE: ProposalStatus[] = ['SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED'];
const PURCHASABLE: ProposalStatus[] = ['APPROVED', 'PARTIALLY_APPROVED'];
const RECEIVABLE: ProposalStatus[] = ['APPROVED', 'PARTIALLY_APPROVED', 'PURCHASED'];
const CLOSABLE: ProposalStatus[] = ['APPROVED', 'PARTIALLY_APPROVED', 'PURCHASED', 'RECEIVED', 'REJECTED'];

const ACTION_LABELS: Record<string, string> = {
  VPP_PROPOSAL_SUBMITTED: 'Gửi đề xuất',
  VPP_PROPOSAL_REVIEWED: 'Duyệt đề xuất',
  VPP_PROPOSAL_REJECTED: 'Từ chối đề xuất',
  VPP_PROPOSAL_PURCHASED: 'Đã mua hàng',
  VPP_PROPOSAL_RECEIVED: 'Nhận hàng & nhập kho',
  VPP_PROPOSAL_CLOSED: 'Đóng đề xuất',
  VPP_PROPOSAL_PRODUCT_DECISION: 'Quyết định sản phẩm mới',
};

/** /admin/vpp/de-xuat/:id — xử lý một đề xuất mua. */
export default function VppProposalDetailPage() {
  const { id = '' } = useParams();
  const { handleError } = useAdmin();
  const detail = useAsync(() => vppProposal(id), [id]);

  useEffect(() => {
    if (detail.status === 'error' && isApiError(detail.error) && detail.error.status === 401) handleError(detail.error);
  }, [detail.status, detail.error, handleError]);

  useDocumentTitle(detail.data ? `Đề xuất ${detail.data.proposal.proposalCode}` : 'Đề xuất mua');

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <Link to="/admin/vpp/de-xuat" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Danh sách đề xuất
      </Link>
      {detail.status === 'loading' && !detail.data && (
        <div className="space-y-4">
          <LoadingCard lines={3} />
          <LoadingCard lines={6} />
        </div>
      )}
      {detail.status === 'error' && !detail.data && (
        <ErrorState
          title={isApiError(detail.error) && detail.error.status === 404 ? 'Không tìm thấy đề xuất.' : 'Không tải được đề xuất.'}
          error={detail.error}
          onRetry={detail.reload}
        />
      )}
      {detail.data && <DetailView data={detail.data} onChange={detail.setData} onReload={detail.reload} />}
    </div>
  );
}

interface ReviewLine {
  approvedQuantity: string;
  approvedPrice: string;
}

/** Giá trị máy chủ của ô duyệt một dòng: sản phẩm bị từ chối → 0; chưa duyệt → số đề xuất / đơn giá tham khảo. */
function serverLine(item: ProposalItem): ReviewLine {
  const rejected = item.productApprovalStatus === 'REJECTED';
  const qty = rejected ? 0 : (item.approvedQuantity ?? item.requestedQuantity);
  const price = item.approvedPrice ?? item.referencePrice;
  return { approvedQuantity: numberToInput(qty), approvedPrice: numberToInput(price) };
}

/** Dấu vết phía máy chủ của một dòng — đổi (từ chối, ghép sang sản phẩm / ĐVT khác, đã duyệt…) thì làm mới ô duyệt dòng đó. */
function lineSignature(item: ProposalItem): string {
  const line = serverLine(item);
  return [item.productId, item.unit, item.productApprovalStatus, line.approvedQuantity, line.approvedPrice].join('|');
}

function initialReview(items: ProposalItem[]): Record<string, ReviewLine> {
  const out: Record<string, ReviewLine> = {};
  for (const item of items) out[item.proposalItemId] = serverLine(item);
  return out;
}

function DetailView({ data, onChange, onReload }: { data: ProposalDetail; onChange: (data: ProposalDetail) => void; onReload: () => void }) {
  const toast = useToast();
  const { handleError, refreshBadges } = useAdmin();
  const { proposal, items } = data;
  const [review, setReview] = useState<Record<string, ReviewLine>>(() => initialReview(items));
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [adminNote, setAdminNote] = useState(proposal.adminNote);
  const [busy, setBusy] = useState<'approve' | 'reject' | 'purchased' | 'close' | null>(null);
  const [dialog, setDialog] = useState<'reject' | 'receive' | 'close' | 'purchased' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | undefined>();
  const [decisionItem, setDecisionItem] = useState<ProposalItem | null>(null);
  const syncedItems = useRef(items);
  const syncedNote = useRef(proposal.adminNote);

  // Dữ liệu mới từ máy chủ (sau mỗi thao tác / tải lại) → CHỈ làm mới ô duyệt của dòng có giá trị phía máy chủ thay đổi
  // (ví dụ dòng vừa bị từ chối → SL duyệt 0). Số lượng / đơn giá / ghi chú duyệt đang nhập ở các dòng khác được giữ nguyên.
  useEffect(() => {
    const before = new Map(syncedItems.current.map((i) => [i.proposalItemId, lineSignature(i)]));
    syncedItems.current = items;
    setReview((current) => {
      const next: Record<string, ReviewLine> = {};
      for (const item of items) {
        const typed = current[item.proposalItemId];
        next[item.proposalItemId] = typed && before.get(item.proposalItemId) === lineSignature(item) ? typed : serverLine(item);
      }
      return next;
    });
    if (syncedNote.current !== proposal.adminNote) {
      syncedNote.current = proposal.adminNote;
      setAdminNote(proposal.adminNote);
    }
    setReviewErrors({});
  }, [items, proposal.adminNote]);

  // Dòng đang mở "Xử lý sản phẩm mới" không còn chờ quyết định (vừa được xử lý ở nơi khác) → đóng hộp thoại.
  useEffect(() => {
    if (!decisionItem) return;
    const current = items.find((i) => i.proposalItemId === decisionItem.proposalItemId);
    if (current?.productApprovalStatus === 'PENDING') return;
    setDecisionItem(null);
    toast.show(`Sản phẩm “${decisionItem.displayName}” đã được xử lý trước đó — trang đã cập nhật kết quả mới nhất.`, 'info');
  }, [items, decisionItem, toast]);

  const canReview = REVIEWABLE.includes(proposal.status);
  const pendingProducts = items.filter((i) => i.productApprovalStatus === 'PENDING');
  const estimate = useMemo(() => {
    let total = 0;
    let missing = 0;
    for (const item of items) {
      const line = review[item.proposalItemId];
      const qty = parseViNumber(line?.approvedQuantity ?? '') ?? 0;
      const price = parseViNumber(line?.approvedPrice ?? '', 'decimal');
      if (qty > 0 && (price === null || Number.isNaN(price))) missing += 1;
      else if (qty > 0 && price !== null) total += qty * price;
    }
    return { total, missing };
  }, [items, review]);

  function apply(next: ProposalDetail, message: string) {
    onChange(next);
    closeDialog();
    refreshBadges();
    toast.show(message);
  }

  function openDialog(kind: 'reject' | 'receive' | 'close' | 'purchased') {
    setDialogError(null);
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  /** Đề xuất vừa đổi trạng thái ở nơi khác → tải lại để thấy trạng thái hiện tại (cập nhật cả huy hiệu menu). */
  function reloadIfStale(err: unknown) {
    if (!isStaleStateError(err)) return;
    onReload();
    refreshBadges();
  }

  /** Lỗi trong hộp thoại xác nhận: hiện ngay trong hộp thoại (toast bị lớp phủ che). */
  function failInDialog(err: unknown, fallback: string) {
    if (isApiError(err) && err.status === 401) {
      handleError(err);
      return;
    }
    setDialogError(errorMessage(err, fallback));
    reloadIfStale(err);
  }

  async function approve() {
    if (busy) return;
    const errors: Record<string, string> = {};
    const decisions = items.map((item, i) => {
      const line = review[item.proposalItemId]!;
      const qty = parseViNumber(line.approvedQuantity) ?? NaN;
      const price = parseViNumber(line.approvedPrice, 'decimal');
      if (!Number.isInteger(qty) || qty < 0 || qty > LIMITS.maxQuantity) {
        errors[`decisions.${i}.approvedQuantity`] = numberFormatError(line.approvedQuantity) ?? 'Số lượng duyệt phải là số nguyên ≥ 0';
      }
      if (item.productApprovalStatus === 'REJECTED' && qty > 0) errors[`decisions.${i}.approvedQuantity`] = 'Sản phẩm đã bị từ chối — số lượng phải là 0';
      if (price !== null && (Number.isNaN(price) || price < 0 || price > LIMITS.maxPrice)) {
        errors[`decisions.${i}.approvedPrice`] = numberFormatError(line.approvedPrice, 'decimal') ?? 'Đơn giá không hợp lệ';
      }
      return { proposalItemId: item.proposalItemId, approvedQuantity: qty, approvedPrice: price };
    });
    setReviewErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy('approve');
    try {
      const next = await vppApproveProposal(proposal.proposalId, { decisions, adminNote: adminNote.trim() });
      apply(next, `Đã duyệt: ${PROPOSAL_STATUS_LABELS[next.proposal.status]}.`);
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setReviewErrors(err.fieldErrors);
      handleError(err, 'Không duyệt được đề xuất.');
      reloadIfStale(err);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (busy) return;
    if (rejectReason.trim().length < 3) {
      setRejectError('Nhập lý do từ chối (ít nhất 3 ký tự).');
      return;
    }
    setBusy('reject');
    setDialogError(null);
    try {
      apply(await vppRejectProposal(proposal.proposalId, rejectReason.trim()), 'Đã từ chối đề xuất.');
      setRejectReason('');
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.reason) setRejectError(err.fieldErrors.reason);
      failInDialog(err, 'Không từ chối được đề xuất.');
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(action: 'purchased' | 'close') {
    if (busy) return;
    setBusy(action);
    setDialogError(null);
    try {
      apply(await vppProposalStatus(proposal.proposalId, action), action === 'purchased' ? 'Đã đánh dấu đã mua.' : 'Đã đóng đề xuất.');
    } catch (err) {
      failInDialog(err, 'Không cập nhật được trạng thái.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card p-4 sm:p-6" aria-labelledby="proposal-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest text-brand-600 uppercase">Đề xuất mua văn phòng phẩm</p>
            <h1 id="proposal-title" className="font-mono text-2xl font-bold text-brand-900">
              {proposal.proposalCode}
            </h1>
            <p className="mt-1 text-sm text-stone-600">Gửi lúc {formatDateTime(proposal.createdAt)}</p>
          </div>
          <ProposalStatusBadge status={proposal.status} className="text-sm" />
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-stone-500">Người đề xuất</dt>
            <dd className="font-semibold text-stone-900">
              {proposal.requesterName} <span className="font-normal text-stone-500">({proposal.requesterEmployeeId})</span>
            </dd>
            {proposal.requesterPosition && <dd className="text-stone-600">{proposal.requesterPosition}</dd>}
          </div>
          <div>
            <dt className="text-stone-500">Phòng ban / định mức</dt>
            <dd className="text-stone-900">{proposal.department || '—'}</dd>
            <dd className="text-stone-600">
              {data.scopes.find((s) => s.scopeId === proposal.scopeId)?.scopeName ?? (proposal.scopeId || 'Không có định mức')}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Giá dự kiến</dt>
            <dd className="font-semibold text-stone-900">{formatVnd(proposal.estimatedTotal)}</dd>
          </div>
          {proposal.reason && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-stone-500">Ghi chú của người đề xuất</dt>
              <dd className="break-words whitespace-pre-wrap text-stone-800">{proposal.reason}</dd>
            </div>
          )}
          {proposal.reviewedAt && (
            <div>
              <dt className="text-stone-500">Duyệt bởi</dt>
              <dd className="text-stone-900">
                {proposal.reviewedBy} · {formatDateTime(proposal.reviewedAt)}
              </dd>
            </div>
          )}
          {proposal.adminNote && !canReview && (
            <div className="sm:col-span-2">
              <dt className="text-stone-500">Ghi chú quản trị</dt>
              <dd className="break-words whitespace-pre-wrap text-stone-800">{proposal.adminNote}</dd>
            </div>
          )}
          {proposal.receivedAt && (
            <div>
              <dt className="text-stone-500">Nhập kho lúc</dt>
              <dd className="text-stone-900">{formatDateTime(proposal.receivedAt)}</dd>
            </div>
          )}
          {proposal.closedAt && (
            <div>
              <dt className="text-stone-500">Đóng lúc</dt>
              <dd className="text-stone-900">{formatDateTime(proposal.closedAt)}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {PURCHASABLE.includes(proposal.status) && (
            <Button size="sm" variant="secondary" onClick={() => openDialog('purchased')} icon={<ShoppingBag className="size-4" aria-hidden="true" />}>
              Đánh dấu đã mua
            </Button>
          )}
          {RECEIVABLE.includes(proposal.status) && (
            <Button size="sm" onClick={() => openDialog('receive')} icon={<PackageCheck className="size-4" aria-hidden="true" />}>
              Nhận hàng & nhập kho
            </Button>
          )}
          {canReview && (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-700 hover:bg-red-50"
              onClick={() => openDialog('reject')}
              icon={<Ban className="size-4" aria-hidden="true" />}
            >
              Từ chối đề xuất
            </Button>
          )}
          {CLOSABLE.includes(proposal.status) && (
            <Button size="sm" variant="ghost" onClick={() => openDialog('close')} icon={<Archive className="size-4" aria-hidden="true" />}>
              Đóng đề xuất
            </Button>
          )}
        </div>
        {pendingProducts.length > 0 && (
          <InlineAlert tone="warning" className="mt-4">
            Có {pendingProducts.length} sản phẩm mới chưa có trong danh mục. Hãy chọn THÊM VÀO DANH MỤC / GIỮ TẠM / GHÉP / TỪ CHỐI cho từng sản phẩm
            trước khi nhận hàng.
          </InlineAlert>
        )}
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="items-title">
        <h2 id="items-title" className="section-title mb-3">
          Sản phẩm đề xuất ({items.length})
        </h2>
        <ol className="space-y-3">
          {items.map((item, index) => (
            <ItemCard
              key={item.proposalItemId}
              index={index}
              item={item}
              canReview={canReview}
              line={review[item.proposalItemId] ?? { approvedQuantity: '', approvedPrice: '' }}
              errors={{
                approvedQuantity: reviewErrors[`decisions.${index}.approvedQuantity`],
                approvedPrice: reviewErrors[`decisions.${index}.approvedPrice`],
              }}
              onLine={(next) => setReview((r) => ({ ...r, [item.proposalItemId]: { ...r[item.proposalItemId]!, ...next } }))}
              onDecide={() => setDecisionItem(item)}
            />
          ))}
        </ol>

        {canReview && (
          <div className="mt-5 space-y-3 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
            <p className="text-sm text-stone-700">
              Giá dự kiến theo số lượng duyệt: <strong className="text-stone-900">{formatVnd(estimate.total)}</strong>
              {estimate.missing > 0 ? ` (${estimate.missing} dòng chưa có đơn giá)` : ''}. Số lượng duyệt = 0 nghĩa là không duyệt dòng đó.
            </p>
            {reviewErrors.decisions && <InlineAlert>{reviewErrors.decisions}</InlineAlert>}
            <Field id="admin-note" label="Ghi chú duyệt (không bắt buộc)" error={reviewErrors.adminNote}>
              <textarea
                id="admin-note"
                className="field-input min-h-16"
                rows={2}
                maxLength={LIMITS.proposalReason}
                value={adminNote}
                aria-describedby={describedBy('admin-note', reviewErrors.adminNote)}
                onChange={(e) => setAdminNote(e.target.value)}
              />
            </Field>
            <Button onClick={approve} loading={busy === 'approve'} icon={<CheckCheck className="size-4" aria-hidden="true" />}>
              {proposal.status === 'SUBMITTED' ? 'DUYỆT ĐỀ XUẤT' : 'CẬP NHẬT DUYỆT'}
            </Button>
          </div>
        )}
      </section>

      <HistorySection data={data} />

      <ConfirmDialog
        open={dialog === 'reject'}
        title={`Từ chối đề xuất ${proposal.proposalCode}?`}
        description="Mọi dòng được duyệt số lượng 0. Người đề xuất cần gửi đề xuất mới nếu vẫn cần."
        confirmLabel="Từ chối đề xuất"
        cancelLabel="Không"
        tone="danger"
        loading={busy === 'reject'}
        error={dialog === 'reject' ? dialogError : null}
        onConfirm={reject}
        onClose={closeDialog}
      >
        <Field id="reject-reason" label="Lý do từ chối" required error={rejectError}>
          <textarea
            id="reject-reason"
            className="field-input min-h-20"
            rows={3}
            maxLength={LIMITS.proposalReason}
            value={rejectReason}
            aria-invalid={rejectError ? true : undefined}
            aria-describedby={describedBy('reject-reason', rejectError)}
            onChange={(e) => {
              setRejectReason(e.target.value);
              setRejectError(undefined);
            }}
          />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'purchased'}
        title="Đánh dấu đã mua hàng?"
        description="Chuyển đề xuất sang “Đã mua”. Tồn kho chỉ tăng khi bấm “Nhận hàng & nhập kho”."
        confirmLabel="Đã mua"
        loading={busy === 'purchased'}
        error={dialog === 'purchased' ? dialogError : null}
        onConfirm={() => void setStatus('purchased')}
        onClose={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'close'}
        title={`Đóng đề xuất ${proposal.proposalCode}?`}
        description={
          proposal.status === 'RECEIVED' || proposal.status === 'REJECTED'
            ? 'Đề xuất sẽ được lưu trữ ở trạng thái “Đã đóng”.'
            : 'Đề xuất chưa nhận hàng. Đóng nghĩa là không mua / không nhập kho theo đề xuất này nữa.'
        }
        confirmLabel="Đóng đề xuất"
        loading={busy === 'close'}
        error={dialog === 'close' ? dialogError : null}
        onConfirm={() => void setStatus('close')}
        onClose={closeDialog}
      />
      <ReceiveDialog
        open={dialog === 'receive'}
        data={data}
        onClose={closeDialog}
        onDone={(next) => apply(next, 'Đã nhận hàng và nhập kho.')}
        onStale={reloadIfStale}
      />
      <ProductDecisionDialog
        open={decisionItem !== null}
        proposalId={proposal.proposalId}
        item={decisionItem}
        scopes={data.scopes}
        defaultScopeId={proposal.scopeId}
        onClose={() => setDecisionItem(null)}
        onDone={(next) => {
          setDecisionItem(null);
          onChange(next);
          refreshBadges();
          toast.show('Đã lưu quyết định cho sản phẩm.');
        }}
        // Lỗi hiện trong hộp thoại; tải lại chi tiết — dòng đã được xử lý ở nơi khác thì effect phía trên đóng hộp thoại.
        onStale={() => {
          onReload();
          refreshBadges();
        }}
      />
    </>
  );
}

function ItemCard({
  index,
  item,
  canReview,
  line,
  errors,
  onLine,
  onDecide,
}: {
  index: number;
  item: ProposalItem;
  canReview: boolean;
  line: ReviewLine;
  errors: { approvedQuantity?: string; approvedPrice?: string };
  onLine: (next: Partial<ReviewLine>) => void;
  onDecide: () => void;
}) {
  const over = item.normQuantity !== null && item.requestedQuantity > item.normQuantity ? item.requestedQuantity - item.normQuantity : 0;
  const unit = item.unit || item.product?.unit || '';
  const pending = item.productApprovalStatus === 'PENDING';
  const base = `item-${item.proposalItemId}`;
  return (
    <li className={cn('rounded-xl border bg-white p-4', pending ? 'border-amber-300' : 'border-stone-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-brand-700">#{index + 1}</p>
          <p className="font-semibold break-words text-stone-900">{item.displayName}</p>
          <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
            <span className={cn('rounded-full px-2 py-0.5 font-semibold', item.isOutsideNorm ? 'bg-violet-50 text-violet-800' : 'bg-emerald-50 text-emerald-800')}>
              {item.isOutsideNorm ? 'Ngoài định mức' : `Định mức ${item.normQuantity ?? 0}${unit ? ` ${unit}` : ''}/tháng`}
            </span>
            {over > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">Vượt định mức {over}</span>}
            {item.productApprovalStatus !== 'NOT_REQUIRED' && (
              <span className={cn('rounded-full px-2 py-0.5 font-semibold', pending ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700')}>
                {PRODUCT_APPROVAL_LABELS[item.productApprovalStatus]}
              </span>
            )}
          </p>
        </div>
        {pending && (
          <Button size="sm" onClick={onDecide}>
            Xử lý sản phẩm mới
          </Button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-xs text-stone-500">Đề xuất</dt>
          <dd className="font-semibold">
            {item.requestedQuantity} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Tồn kho</dt>
          <dd className="font-semibold">{item.stock ? <Qty value={item.stock.onHand} /> : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Khả dụng</dt>
          <dd className="font-semibold">{item.stock ? <Qty value={item.stock.available} /> : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Đơn giá tham khảo</dt>
          <dd>{formatVnd(item.referencePrice)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Thực nhận</dt>
          <dd>{item.receivedQuantity === null ? '—' : `${item.receivedQuantity} ${unit}`}</dd>
        </div>
      </dl>
      {(item.reason || item.note || item.referenceUrl) && (
        <div className="mt-2 space-y-1 text-sm text-stone-700">
          {item.reason && (
            <p className="break-words">
              <span className="text-stone-500">Lý do:</span> {item.reason}
            </p>
          )}
          {item.note && (
            <p className="break-words">
              <span className="text-stone-500">Ghi chú:</span> {item.note}
            </p>
          )}
          {item.referenceUrl && (
            <a
              href={item.referenceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 break-all text-brand-700 underline underline-offset-2"
            >
              {item.referenceUrl}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      {canReview ? (
        <div className="mt-3 grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-3">
          <Field id={`${base}-qty`} label="SL duyệt" error={errors.approvedQuantity}>
            <NumberInput
              id={`${base}-qty`}
              className="field-input"
              value={line.approvedQuantity}
              disabled={item.productApprovalStatus === 'REJECTED'}
              aria-invalid={errors.approvedQuantity ? true : undefined}
              aria-describedby={describedBy(`${base}-qty`, errors.approvedQuantity)}
              onChange={(e) => onLine({ approvedQuantity: e.target.value })}
            />
          </Field>
          <Field id={`${base}-price`} label="Đơn giá duyệt (₫)" error={errors.approvedPrice}>
            <NumberInput
              id={`${base}-price`}
              className="field-input"
              value={line.approvedPrice}
              aria-invalid={errors.approvedPrice ? true : undefined}
              aria-describedby={describedBy(`${base}-price`, errors.approvedPrice)}
              onChange={(e) => onLine({ approvedPrice: e.target.value })}
            />
          </Field>
          <div className="flex flex-col justify-end text-sm">
            <span className="text-xs text-stone-500">Thành tiền</span>
            <span className="font-semibold">
              {(() => {
                const qty = parseViNumber(line.approvedQuantity) ?? 0;
                const price = parseViNumber(line.approvedPrice, 'decimal');
                return price === null || Number.isNaN(price) || Number.isNaN(qty) ? '—' : formatVnd(qty * price);
              })()}
            </span>
          </div>
        </div>
      ) : (
        item.approvedQuantity !== null && (
          <p className="mt-2 text-sm text-stone-700">
            Duyệt: <strong>{item.approvedQuantity}</strong> {unit} × {formatVnd(item.approvedPrice ?? item.referencePrice)}
          </p>
        )
      )}
    </li>
  );
}

function ReceiveDialog({
  open,
  data,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  data: ProposalDetail;
  onClose: () => void;
  onDone: (next: ProposalDetail) => void;
  /** Lỗi do trạng thái đã đổi ở nơi khác (đề xuất vừa được đóng / nhận hàng…) → trang tải lại; số đang nhập được giữ. */
  onStale: (err: unknown) => void;
}) {
  const { handleError } = useAdmin();
  const lines = data.items.filter((i) => (i.approvedQuantity ?? 0) > 0);
  const [values, setValues] = useState<Record<string, { qty: string; price: string }>>({});
  const [date, setDate] = useState(todayIsoDate());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open) return;
    const next: Record<string, { qty: string; price: string }> = {};
    for (const item of data.items) {
      next[item.proposalItemId] = { qty: numberToInput(item.approvedQuantity ?? 0), price: numberToInput(item.approvedPrice ?? item.referencePrice) };
    }
    setValues(next);
    setDate(todayIsoDate());
    setNote('');
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    const payload = lines.map((item) => {
      const v = values[item.proposalItemId] ?? { qty: '0', price: '' };
      const qty = parseViNumber(v.qty) ?? NaN;
      const price = parseViNumber(v.price, 'decimal');
      const index = data.items.indexOf(item);
      if (!Number.isInteger(qty) || qty < 0 || qty > LIMITS.maxQuantity) {
        nextErrors[`lines.${index}.receivedQuantity`] = numberFormatError(v.qty) ?? 'Số lượng thực nhận phải là số nguyên ≥ 0';
      }
      if (price !== null && (Number.isNaN(price) || price < 0 || price > LIMITS.maxPrice)) {
        nextErrors[`lines.${index}.unitPrice`] = numberFormatError(v.price, 'decimal') ?? 'Đơn giá không hợp lệ';
      }
      return { proposalItemId: item.proposalItemId, receivedQuantity: qty, unitPrice: price };
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setFormError(null);
    try {
      onDone(await vppReceiveProposal(data.proposal.proposalId, { lines: payload, receivedDate: date, note: note.trim() }));
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      if (isApiError(err) && err.status === 401) handleError(err);
      setFormError(errorMessage(err, 'Không nhập kho được.'));
      onStale(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      title={`Nhận hàng: ${data.proposal.proposalCode}`}
      description="Nhập số lượng thực nhận cho từng dòng. Hệ thống ghi phiếu nhập kho (IN) và tăng tồn — không nhập trùng nếu bấm lại."
      confirmLabel="Nhập kho"
      cancelLabel="Hủy"
      loading={saving}
      confirmDisabled={lines.length === 0}
      onConfirm={save}
      onClose={onClose}
    >
      {lines.length === 0 ? (
        <InlineAlert tone="warning">Không có dòng nào được duyệt số lượng &gt; 0.</InlineAlert>
      ) : (
        <ul className="space-y-3">
          {lines.map((item) => {
            const index = data.items.indexOf(item);
            const v = values[item.proposalItemId] ?? { qty: '', price: '' };
            const qtyError = errors[`lines.${index}.receivedQuantity`];
            const priceError = errors[`lines.${index}.unitPrice`];
            return (
              <li key={item.proposalItemId} className="rounded-lg border border-stone-200 p-3">
                <p className="font-medium text-stone-900">{item.displayName}</p>
                <p className="text-xs text-stone-500">
                  Duyệt {item.approvedQuantity} {item.unit}
                  {item.productApprovalStatus === 'PENDING' ? ' · ⚠ sản phẩm mới chưa được quyết định' : ''}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field id={`receive-${item.proposalItemId}-qty`} label="SL thực nhận" error={qtyError}>
                    <NumberInput
                      id={`receive-${item.proposalItemId}-qty`}
                      className="field-input"
                      value={v.qty}
                      aria-invalid={qtyError ? true : undefined}
                      aria-describedby={describedBy(`receive-${item.proposalItemId}-qty`, qtyError)}
                      onChange={(e) => setValues((cur) => ({ ...cur, [item.proposalItemId]: { ...v, qty: e.target.value } }))}
                    />
                  </Field>
                  <Field id={`receive-${item.proposalItemId}-price`} label="Đơn giá thực tế (₫)" error={priceError}>
                    <NumberInput
                      id={`receive-${item.proposalItemId}-price`}
                      className="field-input"
                      value={v.price}
                      aria-invalid={priceError ? true : undefined}
                      aria-describedby={describedBy(`receive-${item.proposalItemId}-price`, priceError)}
                      onChange={(e) => setValues((cur) => ({ ...cur, [item.proposalItemId]: { ...v, price: e.target.value } }))}
                    />
                  </Field>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="receive-date" label="Ngày nhận" error={errors.receivedDate}>
          <input id="receive-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="receive-note" label="Ghi chú" error={errors.note}>
          <input id="receive-note" className="field-input" maxLength={LIMITS.stockReason} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {errors.lines && <InlineAlert>{errors.lines}</InlineAlert>}
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

function HistorySection({ data }: { data: ProposalDetail }) {
  return (
    <section className="card p-4 sm:p-6" aria-labelledby="proposal-history">
      <h2 id="proposal-history" className="section-title mb-3 flex items-center gap-2">
        <History className="size-4" aria-hidden="true" />
        Lịch sử
      </h2>
      {data.history.length === 0 ? (
        <p className="text-sm text-stone-500">Chưa có lịch sử.</p>
      ) : (
        <ol className="relative space-y-4 border-l-2 border-brand-100 pl-5">
          {data.history.map((entry) => (
            <li key={entry.logId} className="relative">
              <span className="absolute top-1.5 -left-[1.6rem] size-3 rounded-full border-2 border-white bg-gold-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-stone-900">
                {ACTION_LABELS[entry.action] ?? entry.action}
                {entry.newStatus && entry.oldStatus !== entry.newStatus && (
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {entry.oldStatus ? `${PROPOSAL_STATUS_LABELS[entry.oldStatus as ProposalStatus] ?? entry.oldStatus} → ` : ''}
                    {PROPOSAL_STATUS_LABELS[entry.newStatus as ProposalStatus] ?? entry.newStatus}
                  </span>
                )}
              </p>
              <p className="text-xs text-stone-500">
                {formatDateTime(entry.createdAt)}
                {entry.actor ? ` · ${entry.actor}` : ''}
              </p>
              {entry.message && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-stone-700">{entry.message}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
