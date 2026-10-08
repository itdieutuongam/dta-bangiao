import {
  ArrowLeft,
  Ban,
  CircleCheck,
  CircleMinus,
  CircleX,
  Copy,
  FileDown,
  FileText,
  History,
  ImageOff,
  Link2,
  Pencil,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { HANDOVER_TYPE_LABELS, isEditableStatus, LIMITS, STATUS_LABELS, type HandoverStatus } from '../../../shared/constants';
import type { AdminDetailResponse, AdminHandoverDetail, HistoryEntry, IntegrityInfo } from '../../../shared/types';
import { copyText } from '../../components/CopyField';
import { HandoverItemsView } from '../../components/handover/HandoverItemsView';
import { PartiesView } from '../../components/handover/PartiesView';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { describedBy, Field } from '../../components/ui/Field';
import { ErrorState, InlineAlert, LoadingCard } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import {
  adminCancelHandover,
  adminGetHandover,
  adminPdfUrl,
  adminReconcileStock,
  adminRegenerateLink,
  adminRegeneratePdf,
  adminSignatureUrl,
} from '../../services/adminApi';
import { downloadFile, errorMessage, isApiError, isStaleStateError } from '../../services/api';
import { formatDateTime } from '../../utils/format';

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Tạo biên bản',
  UPDATED: 'Cập nhật biên bản',
  CONFIRMED: 'Người nhận xác nhận',
  REVISION_REQUESTED: 'Yêu cầu chỉnh sửa',
  CANCELLED: 'Hủy biên bản',
  LINK_REGENERATED: 'Cấp link mới',
  PDF_GENERATED: 'Tạo PDF',
  STOCK_SYNC_FAILED: 'Chưa xuất kho được — cần đối soát',
};

/** Cách người nhận đã xác thực khi ký (BAN_GIAO.confirm_method). */
const CONFIRM_METHOD_TEXT: Record<string, { label: string; warn: boolean }> = {
  OTP_EMAIL: { label: 'Nhập đúng mã xác nhận gửi tới email của người nhận.', warn: false },
  NO_EMAIL: { label: 'Ký KHÔNG có mã xác nhận — người nhận chưa có email trong hệ thống.', warn: true },
  OTP_OFF: { label: 'Ký không cần mã xác nhận (đã tắt CONFIRM_OTP trong CAU_HINH).', warn: true },
};

export default function AdminHandoverDetailPage() {
  const { id = '' } = useParams();
  const { handleError } = useAdmin();
  const detail = useAsync(() => adminGetHandover(id), [id]);

  useEffect(() => {
    if (detail.status === 'error' && isApiError(detail.error) && detail.error.status === 401) handleError(detail.error);
  }, [detail.status, detail.error, handleError]);

  useDocumentTitle(detail.data ? `Biên bản ${detail.data.handover.code}` : 'Chi tiết biên bản');

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <Link to="/admin/ban-giao" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Danh sách phiếu bàn giao
      </Link>
      {detail.status === 'loading' && !detail.data && (
        <div className="space-y-4">
          <LoadingCard lines={2} />
          <LoadingCard lines={6} />
        </div>
      )}
      {detail.status === 'error' && !detail.data && (
        <ErrorState
          title={isApiError(detail.error) && detail.error.status === 404 ? 'Không tìm thấy biên bản.' : 'Không thể tải biên bản.'}
          error={detail.error}
          onRetry={detail.reload}
        />
      )}
      {detail.data && <DetailView data={detail.data} onUpdated={detail.setData} onReload={detail.reload} />}
    </div>
  );
}

function DetailView({
  data,
  onUpdated,
  onReload,
}: {
  data: AdminDetailResponse;
  onUpdated: (data: AdminDetailResponse) => void;
  onReload: () => void;
}) {
  const { handover, categories } = data;
  const toast = useToast();
  const { handleError, refreshBadges } = useAdmin();
  const [link, setLink] = useState<string | null>(handover.link);
  const [dialog, setDialog] = useState<'cancel' | 'regenerate' | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'regenerate' | 'pdf' | 'regenerate-pdf' | 'reconcile' | null>(null);
  const editable = isEditableStatus(handover.status);
  const isSupply = handover.handoverType === 'OFFICE_SUPPLY';

  async function handleReconcile() {
    setBusy('reconcile');
    try {
      const result = await adminReconcileStock(handover.id);
      const low = result.warnings.map((w) => w.productName).join(', ');
      toast.show(low ? `Đã đối soát kho. Lưu ý: ${low} sắp hết / đã hết khả dụng.` : 'Đã đối soát kho theo phiếu này.', low ? 'info' : 'success');
    } catch (err) {
      handleError(err, 'Không đối soát được kho.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => setLink(handover.link), [handover.link]);

  async function handleCopy() {
    if (!link) return;
    if (await copyText(link)) toast.show('Đã sao chép link xác nhận.');
    else toast.show('Không sao chép được — hãy chọn và sao chép thủ công.', 'info');
  }

  function openDialog(kind: 'cancel' | 'regenerate') {
    setDialogError(null);
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  /** Lỗi trong hộp thoại xác nhận: hiện ngay trong hộp thoại; phiếu vừa đổi ở nơi khác → tải lại để thấy trạng thái hiện tại. */
  function failInDialog(err: unknown, fallback: string) {
    if (isApiError(err) && err.status === 401) {
      handleError(err);
      return;
    }
    setDialogError(errorMessage(err, fallback));
    if (isStaleStateError(err)) onReload();
  }

  async function handleRegenerate() {
    setBusy('regenerate');
    setDialogError(null);
    try {
      const result = await adminRegenerateLink(handover.id);
      setLink(result.link);
      closeDialog();
      if (await copyText(result.link)) toast.show('Đã tạo link mới và sao chép. Link cũ không còn hiệu lực.');
      else toast.show('Đã tạo link mới. Link cũ không còn hiệu lực.');
      onReload();
    } catch (err) {
      failInDialog(err, 'Không tạo được link mới.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    setBusy('cancel');
    setDialogError(null);
    try {
      const result = await adminCancelHandover(handover.id, cancelReason.trim());
      onUpdated(result);
      closeDialog();
      setCancelReason('');
      refreshBadges();
      toast.show(`Đã hủy biên bản ${handover.code}.`);
    } catch (err) {
      failInDialog(err, 'Không hủy được biên bản.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    setBusy('pdf');
    try {
      await downloadFile(adminPdfUrl(handover.id), `${handover.code}.pdf`);
      if (!handover.pdfAvailable) onReload();
    } catch (err) {
      handleError(err, 'Không tải được PDF.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRegeneratePdf() {
    setBusy('regenerate-pdf');
    try {
      await adminRegeneratePdf(handover.id);
      toast.show('Đã tạo lại file PDF.');
      onReload();
    } catch (err) {
      handleError(err, 'Không tạo lại được PDF.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card p-4 sm:p-6" aria-labelledby="detail-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest text-brand-600 uppercase">Biên bản bàn giao</p>
            <h1 id="detail-title" className="font-mono text-2xl font-bold text-brand-900">
              {handover.code}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              {HANDOVER_TYPE_LABELS[handover.handoverType] ?? handover.handoverType} · Tạo lúc {formatDateTime(handover.createdAt)}
              {handover.createdBy ? ` bởi ${handover.createdBy}` : ''} · Cập nhật {formatDateTime(handover.updatedAt)}
            </p>
          </div>
          <StatusBadge status={handover.status} className="text-sm" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {handover.status !== 'CANCELLED' && (
            <>
              <Button variant="secondary" size="sm" onClick={handleCopy} disabled={!link} icon={<Copy className="size-4" aria-hidden="true" />}>
                Copy link
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openDialog('regenerate')}
                icon={<Link2 className="size-4" aria-hidden="true" />}
              >
                Tạo link mới
              </Button>
            </>
          )}
          {editable && (
            <ButtonLink to={`/admin/ban-giao/${handover.id}/sua`} size="sm" icon={<Pencil className="size-4" aria-hidden="true" />}>
              Sửa biên bản
            </ButtonLink>
          )}
          {handover.status === 'CONFIRMED' && (
            <>
              <Button
                size="sm"
                onClick={handleDownloadPdf}
                loading={busy === 'pdf'}
                icon={<FileDown className="size-4" aria-hidden="true" />}
              >
                {busy === 'pdf' ? 'Đang chuẩn bị PDF…' : 'Tải PDF'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegeneratePdf}
                loading={busy === 'regenerate-pdf'}
                icon={<RefreshCw className="size-4" aria-hidden="true" />}
              >
                Tạo lại PDF
              </Button>
            </>
          )}
          {isSupply && handover.status !== 'CANCELLED' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReconcile}
              loading={busy === 'reconcile'}
              icon={<Scale className="size-4" aria-hidden="true" />}
              title="Đồng bộ lại giữ chỗ / xuất kho theo trạng thái phiếu (an toàn khi bấm nhiều lần)"
            >
              Đối soát kho
            </Button>
          )}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-700 hover:bg-red-50"
              onClick={() => openDialog('cancel')}
              icon={<Ban className="size-4" aria-hidden="true" />}
            >
              Hủy biên bản
            </Button>
          )}
        </div>

        {handover.status !== 'CANCELLED' && (
          <div className="mt-4">
            {link ? (
              <p className="rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-700">{link}</p>
            ) : (
              <InlineAlert tone="warning">
                Không khôi phục được link hiện tại (khóa SESSION_SECRET đã thay đổi). Nhấn “Tạo link mới” để cấp link khác.
              </InlineAlert>
            )}
          </div>
        )}

        {handover.status === 'REVISION_REQUESTED' && (
          <InlineAlert tone="warning" className="mt-4">
            <p className="font-semibold">Người nhận yêu cầu chỉnh sửa lúc {formatDateTime(handover.revisionRequestedAt)}</p>
            <p className="mt-1 break-words whitespace-pre-wrap">{handover.receiverComment}</p>
            <p className="mt-2 text-xs">
              Sửa biên bản để chuyển lại trạng thái “Chờ xác nhận”; người nhận dùng lại link cũ để ký.
              {isSupply ? ' Số lượng văn phòng phẩm vẫn đang được giữ chỗ.' : ''}
            </p>
          </InlineAlert>
        )}
        {editable && handover.editPendingSince && (
          <InlineAlert tone="warning" className="mt-4">
            <p className="font-semibold">Lần lưu sửa biên bản lúc {formatDateTime(handover.editPendingSince)} chưa hoàn tất</p>
            <p className="mt-1 text-xs">
              Người nhận tạm thời chưa ký / yêu cầu sửa được (link vẫn hiện nội dung trước khi sửa). Bấm “Sửa biên bản”, kiểm tra nội
              dung rồi lưu lại để hoàn tất — hoặc hủy biên bản nếu không dùng nữa.
            </p>
          </InlineAlert>
        )}
        {handover.status === 'PENDING' && handover.otp?.blocked && (
          <InlineAlert tone="warning" className="mt-4">
            <p className="font-semibold">Người nhận chưa ký được: bắt buộc mã xác nhận qua email nhưng nhân viên chưa có email</p>
            <p className="mt-1 text-xs">Bổ sung email trong sheet NHAN_VIEN rồi bấm “Làm mới dữ liệu” ở cuối thanh menu.</p>
          </InlineAlert>
        )}
        {handover.status === 'PENDING' && handover.otp?.required && !handover.otp.blocked && (
          <p className="mt-4 flex items-center gap-2 text-xs text-stone-600">
            <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
            Khi ký, người nhận phải nhập mã xác nhận gửi tới {handover.otp.emailMasked}.
          </p>
        )}
        {handover.status === 'CONFIRMED' && CONFIRM_METHOD_TEXT[handover.confirmMethod]?.warn && (
          <InlineAlert tone="warning" className="mt-4">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="size-4" aria-hidden="true" />
              {CONFIRM_METHOD_TEXT[handover.confirmMethod]!.label}
            </p>
            <p className="mt-1 text-xs">Không có bằng chứng người ký là chủ email của người nhận — xác minh lại nếu cần.</p>
          </InlineAlert>
        )}
        {handover.confirmedFromCreatorDevice && (
          <InlineAlert tone="warning" className="mt-4">
            <p className="flex items-center gap-2 font-semibold">
              <Smartphone className="size-4" aria-hidden="true" />
              Người nhận ký trên cùng thiết bị và mạng với lúc tạo phiếu
            </p>
            <p className="mt-1 text-xs">
              Có thể là ký trực tiếp trên máy của người lập phiếu. Nếu không phải, hãy xác minh lại với người nhận.
            </p>
          </InlineAlert>
        )}
        {handover.status === 'CANCELLED' && (
          <InlineAlert tone="info" className="mt-4">
            Đã hủy lúc {formatDateTime(handover.cancelledAt)}
            {handover.cancelReason ? ` — Lý do: ${handover.cancelReason}` : ''}
          </InlineAlert>
        )}
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="parties-heading">
        <h2 id="parties-heading" className="section-title mb-3">
          Người giao & người nhận
        </h2>
        <PartiesView sender={handover.sender} receiver={handover.receiver} />
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="items-heading">
        <h2 id="items-heading" className="section-title mb-3">
          Nội dung bàn giao ({handover.items.length})
        </h2>
        <HandoverItemsView items={handover.items} categories={categories} showInternal />
        {handover.note && (
          <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Ghi chú</p>
            <p className="mt-1 text-sm break-words whitespace-pre-wrap text-stone-800">{handover.note}</p>
          </div>
        )}
      </section>

      {handover.status === 'CONFIRMED' && <ConfirmationSection handover={handover} />}
      {handover.status === 'CONFIRMED' && <IntegritySection handover={handover} />}

      <HistorySection history={handover.history} />

      <ConfirmDialog
        open={dialog === 'regenerate'}
        title="Tạo link xác nhận mới?"
        description="Link cũ sẽ không còn hiệu lực. Hãy gửi link mới cho người nhận."
        confirmLabel="Tạo link mới"
        loading={busy === 'regenerate'}
        error={dialog === 'regenerate' ? dialogError : null}
        onConfirm={handleRegenerate}
        onClose={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Hủy biên bản ${handover.code}?`}
        description="Biên bản bị hủy không thể xác nhận và không thể khôi phục."
        confirmLabel="Hủy biên bản"
        cancelLabel="Không hủy"
        tone="danger"
        loading={busy === 'cancel'}
        error={dialog === 'cancel' ? dialogError : null}
        onConfirm={handleCancel}
        onClose={closeDialog}
      >
        <Field id="cancel-reason" label="Lý do hủy (không bắt buộc)">
          <textarea
            id="cancel-reason"
            className="field-input min-h-20"
            rows={3}
            maxLength={LIMITS.cancelReason}
            value={cancelReason}
            aria-describedby={describedBy('cancel-reason')}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function ConfirmationSection({ handover }: { handover: AdminHandoverDetail }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>('loading');
  return (
    <section className="card p-4 sm:p-6" aria-labelledby="confirm-heading">
      <h2 id="confirm-heading" className="section-title mb-3">
        Xác nhận của người nhận
      </h2>
      <div className="grid gap-5 md:grid-cols-2">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-stone-500">Thời gian xác nhận</dt>
            <dd className="font-semibold text-stone-900">{formatDateTime(handover.confirmedAt)}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Người ký</dt>
            <dd className="font-semibold text-stone-900">{handover.receiver.name}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Xác thực khi ký</dt>
            <dd className="text-stone-800">
              {CONFIRM_METHOD_TEXT[handover.confirmMethod]?.label ?? 'Không ghi nhận (biên bản ký trước khi có mã xác nhận qua email).'}
            </dd>
          </div>
          {handover.receiverComment && (
            <div>
              <dt className="text-stone-500">Ghi chú người nhận</dt>
              <dd className="break-words whitespace-pre-wrap text-stone-800">{handover.receiverComment}</dd>
            </div>
          )}
          {handover.confirmedUserAgent && (
            <div>
              <dt className="text-stone-500">Thiết bị ký</dt>
              <dd className="text-xs break-words text-stone-600">{handover.confirmedUserAgent}</dd>
            </div>
          )}
          <div>
            <dt className="text-stone-500">File PDF</dt>
            <dd className="flex items-center gap-1.5 text-stone-800">
              <FileText className="size-4 text-stone-400" aria-hidden="true" />
              {handover.pdfAvailable ? 'Đã tạo trên Google Drive' : 'Chưa tạo — hệ thống sẽ tạo khi tải PDF'}
            </dd>
          </div>
        </dl>
        <div>
          <p className="mb-2 text-sm text-stone-500">Chữ ký</p>
          {handover.signatureAvailable ? (
            <div className="flex min-h-36 items-center justify-center rounded-lg border border-stone-200 bg-white p-3">
              {imageState === 'error' ? (
                <span className="flex items-center gap-2 text-sm text-stone-500">
                  <ImageOff className="size-5" aria-hidden="true" />
                  Không tải được ảnh chữ ký.
                </span>
              ) : (
                <img
                  src={adminSignatureUrl(handover.id)}
                  alt={`Chữ ký của ${handover.receiver.name}`}
                  className="max-h-40 w-auto max-w-full"
                  onLoad={() => setImageState('loaded')}
                  onError={() => setImageState('error')}
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">Không có chữ ký.</p>
          )}
        </div>
      </div>
    </section>
  );
}

type IntegrityChecks = NonNullable<IntegrityInfo['checks']>;

/** Kết quả niêm phong (HMAC bằng khóa RECORD_SEAL_SECRET của Cloudflare — người sửa được Sheet không tự tính lại được). */
const SEAL_TEXT: Record<IntegrityChecks['seal'], { text: string; state: 'ok' | 'bad' | 'none' }> = {
  OK: { text: 'Niêm phong: khớp.', state: 'ok' },
  MISMATCH: {
    text: 'Niêm phong: KHÔNG khớp — dữ liệu đã bị sửa rồi tính lại mã (hoặc khóa RECORD_SEAL_SECRET trên Cloudflare đã bị đổi).',
    state: 'bad',
  },
  UNVERIFIED: { text: 'Niêm phong: chưa kiểm tra được — Worker hiện không có khóa RECORD_SEAL_SECRET.', state: 'none' },
  NONE: { text: 'Niêm phong: không có — ký khi chưa cấu hình RECORD_SEAL_SECRET.', state: 'none' },
};

function CheckLine({ state, children }: { state: 'ok' | 'bad' | 'none'; children: string }) {
  const Icon = state === 'ok' ? CircleCheck : state === 'bad' ? CircleX : CircleMinus;
  return (
    <li className={`flex items-start gap-2 ${state === 'bad' ? 'font-semibold text-red-800' : state === 'ok' ? 'text-stone-700' : 'text-stone-500'}`}>
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${state === 'bad' ? 'text-red-600' : state === 'ok' ? 'text-emerald-600' : 'text-stone-400'}`}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * Toàn vẹn: dữ liệu hiện tại có khớp lúc người nhận ký không — nội dung, toàn biên bản (ý kiến, thời điểm, chữ ký) và niêm phong
 * (phát hiện dữ liệu bị sửa trực tiếp trên Sheet, kể cả khi người sửa tính lại mã băm).
 */
function IntegritySection({ handover }: { handover: AdminHandoverDetail }) {
  const { integrity } = handover;
  const checks = integrity.checks ?? null;
  const ok = integrity.status === 'OK';
  const mismatch = integrity.status === 'MISMATCH';
  return (
    <section
      className={`card p-4 sm:p-6 ${mismatch ? 'border-red-300 bg-red-50/40' : ''}`}
      aria-labelledby="integrity-heading"
    >
      <h2 id="integrity-heading" className="section-title mb-2 flex items-center gap-2">
        {mismatch ? <ShieldAlert className="size-5 text-red-600" aria-hidden="true" /> : <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />}
        Toàn vẹn biên bản
      </h2>
      {ok && <p className="text-sm text-emerald-800">Dữ liệu hiện tại khớp với bản người nhận đã ký.</p>}
      {mismatch && (
        <p className="text-sm font-semibold text-red-800" role="alert">
          Biên bản trên Google Sheet KHÔNG còn khớp với bản người nhận đã ký — dữ liệu đã bị sửa trực tiếp sau khi ký. Hệ thống không tạo PDF
          từ dữ liệu này; hãy kiểm tra lịch sử chỉnh sửa của Sheet.
        </p>
      )}
      {integrity.status === 'LEGACY' && (
        <p className="text-sm text-stone-600">Biên bản ký trước phiên bản 2.0 — chưa có mã toàn vẹn.</p>
      )}
      {checks && (
        <ul className="mt-3 space-y-1 text-sm">
          <CheckLine state={checks.content ? 'ok' : 'bad'}>
            {checks.content ? 'Nội dung bàn giao: khớp.' : 'Nội dung bàn giao: ĐÃ BỊ SỬA sau khi ký.'}
          </CheckLine>
          <CheckLine state={checks.record === null ? 'none' : checks.record ? 'ok' : 'bad'}>
            {checks.record === null
              ? 'Ý kiến người nhận, thời điểm lập / ký, chữ ký: ký trước khi có mã kiểm tra này.'
              : checks.record
                ? 'Ý kiến người nhận, thời điểm lập / ký, chữ ký: khớp.'
                : 'Ý kiến người nhận, thời điểm lập / ký hoặc chữ ký: ĐÃ BỊ SỬA sau khi ký.'}
          </CheckLine>
          <CheckLine state={SEAL_TEXT[checks.seal].state}>{SEAL_TEXT[checks.seal].text}</CheckLine>
        </ul>
      )}
      {integrity.contentHash && (
        <dl className="mt-3 space-y-1 text-xs text-stone-600">
          <div>
            <dt className="inline font-medium">Mã nội dung (SHA-256): </dt>
            <dd className="inline font-mono break-all">{integrity.contentHash}</dd>
          </div>
          {integrity.signatureSha256 && (
            <div>
              <dt className="inline font-medium">Mã chữ ký (SHA-256): </dt>
              <dd className="inline font-mono break-all">{integrity.signatureSha256}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function HistorySection({ history }: { history: HistoryEntry[] }) {
  return (
    <section className="card p-4 sm:p-6" aria-labelledby="history-heading">
      <h2 id="history-heading" className="section-title mb-3 flex items-center gap-2">
        <History className="size-4" aria-hidden="true" />
        Lịch sử
      </h2>
      {history.length === 0 ? (
        <p className="text-sm text-stone-500">Chưa có lịch sử.</p>
      ) : (
        <ol className="relative space-y-4 border-l-2 border-brand-100 pl-5">
          {history.map((entry) => (
            <li key={entry.logId} className="relative">
              <span className="absolute top-1.5 -left-[1.6rem] size-3 rounded-full border-2 border-white bg-gold-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-stone-900">
                {ACTION_LABELS[entry.action] ?? entry.action}
                {entry.newStatus && entry.oldStatus !== entry.newStatus && (
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {entry.oldStatus ? `${STATUS_LABELS[entry.oldStatus as HandoverStatus] ?? entry.oldStatus} → ` : ''}
                    {STATUS_LABELS[entry.newStatus as HandoverStatus] ?? entry.newStatus}
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
