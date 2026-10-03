import {
  ArrowLeft,
  Ban,
  Copy,
  FileDown,
  FileText,
  History,
  ImageOff,
  Link2,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { isEditableStatus, LIMITS, STATUS_LABELS, type HandoverStatus } from '../../../shared/constants';
import type { AdminDetailResponse, AdminHandoverDetail, HistoryEntry } from '../../../shared/types';
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
  adminRegenerateLink,
  adminRegeneratePdf,
  adminSignatureUrl,
} from '../../services/adminApi';
import { downloadFile, isApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Tạo biên bản',
  UPDATED: 'Cập nhật biên bản',
  CONFIRMED: 'Người nhận xác nhận',
  REVISION_REQUESTED: 'Yêu cầu chỉnh sửa',
  CANCELLED: 'Hủy biên bản',
  LINK_REGENERATED: 'Cấp link mới',
  PDF_GENERATED: 'Tạo PDF',
  VIEWED: 'Người nhận xem',
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
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Danh sách biên bản
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
  const { handleError } = useAdmin();
  const [link, setLink] = useState<string | null>(handover.link);
  const [dialog, setDialog] = useState<'cancel' | 'regenerate' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'regenerate' | 'pdf' | 'regenerate-pdf' | null>(null);
  const editable = isEditableStatus(handover.status);

  useEffect(() => setLink(handover.link), [handover.link]);

  async function handleCopy() {
    if (!link) return;
    if (await copyText(link)) toast.show('Đã sao chép link xác nhận.');
    else toast.show('Không sao chép được — hãy chọn và sao chép thủ công.', 'info');
  }

  async function handleRegenerate() {
    setBusy('regenerate');
    try {
      const result = await adminRegenerateLink(handover.id);
      setLink(result.link);
      setDialog(null);
      if (await copyText(result.link)) toast.show('Đã tạo link mới và sao chép. Link cũ không còn hiệu lực.');
      else toast.show('Đã tạo link mới. Link cũ không còn hiệu lực.');
      onReload();
    } catch (err) {
      handleError(err, 'Không tạo được link mới.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    setBusy('cancel');
    try {
      const result = await adminCancelHandover(handover.id, cancelReason.trim());
      onUpdated(result);
      setDialog(null);
      setCancelReason('');
      toast.show(`Đã hủy biên bản ${handover.code}.`);
    } catch (err) {
      handleError(err, 'Không hủy được biên bản.');
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
              Tạo lúc {formatDateTime(handover.createdAt)} · Cập nhật {formatDateTime(handover.updatedAt)}
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
                onClick={() => setDialog('regenerate')}
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
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-700 hover:bg-red-50"
              onClick={() => setDialog('cancel')}
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
            <p className="mt-2 text-xs">Sửa biên bản để chuyển lại trạng thái “Chờ xác nhận”; người nhận dùng lại link cũ để ký.</p>
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
        <HandoverItemsView items={handover.items} categories={categories} />
        {handover.note && (
          <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3.5">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Ghi chú</p>
            <p className="mt-1 text-sm break-words whitespace-pre-wrap text-stone-800">{handover.note}</p>
          </div>
        )}
      </section>

      {handover.status === 'CONFIRMED' && <ConfirmationSection handover={handover} />}

      <HistorySection history={handover.history} />

      <ConfirmDialog
        open={dialog === 'regenerate'}
        title="Tạo link xác nhận mới?"
        description="Link cũ sẽ không còn hiệu lực. Hãy gửi link mới cho người nhận."
        confirmLabel="Tạo link mới"
        loading={busy === 'regenerate'}
        onConfirm={handleRegenerate}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Hủy biên bản ${handover.code}?`}
        description="Biên bản bị hủy không thể xác nhận và không thể khôi phục."
        confirmLabel="Hủy biên bản"
        cancelLabel="Không hủy"
        tone="danger"
        loading={busy === 'cancel'}
        onConfirm={handleCancel}
        onClose={() => setDialog(null)}
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
