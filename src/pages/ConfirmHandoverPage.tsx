import { Ban, CircleCheck, FileDown, Link2Off, MessageSquareWarning, PenLine, Send } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { LIMITS } from '../../shared/constants';
import type { PublicHandover, PublicHandoverResponse } from '../../shared/types';
import { HandoverItemsView } from '../components/handover/HandoverItemsView';
import { PartiesView } from '../components/handover/PartiesView';
import { MIN_INK_LENGTH, SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';
import { Button } from '../components/ui/Button';
import { describedBy, Field } from '../components/ui/Field';
import { ErrorState, InlineAlert, LoadingCard } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/usePageMeta';
import { ApiClientError, downloadFile, errorMessage, isApiError } from '../services/api';
import { confirmHandover, getPublicHandover, publicPdfUrl, requestRevision } from '../services/handoverApi';
import { cn } from '../utils/cn';
import { formatDateTime } from '../utils/format';

export default function ConfirmHandoverPage() {
  const { token = '' } = useParams();
  useDocumentTitle('Xác nhận bàn giao');
  const query = useAsync(() => getPublicHandover(token), [token]);

  return (
    <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-8">
      {query.status === 'loading' && !query.data && (
        <div className="space-y-4">
          <LoadingCard lines={2} label="Đang tải biên bản…" />
          <LoadingCard lines={6} />
        </div>
      )}
      {query.status === 'error' && !query.data && <LoadError error={query.error} onRetry={query.reload} />}
      {query.data && (
        <HandoverConfirmView
          token={token}
          data={query.data}
          onChanged={(handover) => query.setData({ ...query.data!, handover })}
          onReload={query.reload}
        />
      )}
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isApiError(error) && error.status === 404) {
    return (
      <div className="card flex flex-col items-center gap-3 px-5 py-12 text-center" role="alert">
        <Link2Off className="size-12 text-stone-400" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-stone-900">Link xác nhận không hợp lệ</h1>
        <p className="max-w-sm text-sm text-stone-600">
          Link có thể đã bị nhập sai hoặc đã được thay bằng link mới. Vui lòng liên hệ người bàn giao để nhận lại link.
        </p>
      </div>
    );
  }
  return <ErrorState title="Không thể tải biên bản." error={error} onRetry={onRetry} />;
}

function HandoverConfirmView({
  token,
  data,
  onChanged,
  onReload,
}: {
  token: string;
  data: PublicHandoverResponse;
  onChanged: (handover: PublicHandover) => void;
  onReload: () => void;
}) {
  const { handover, categories } = data;
  useDocumentTitle(`Biên bản ${handover.code}`);

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-6" aria-labelledby="handover-title">
        <p className="text-xs font-bold tracking-widest text-brand-600 uppercase">Biên bản bàn giao</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 id="handover-title" className="font-mono text-xl font-bold text-brand-900 sm:text-2xl">
            {handover.code}
          </h1>
          <StatusBadge status={handover.status} />
        </div>
        <p className="mt-1 text-sm text-stone-600">Ngày tạo: {formatDateTime(handover.createdAt)}</p>
      </section>

      <StatusBanner token={token} handover={handover} />

      <section className="card p-4 sm:p-6" aria-labelledby="parties-title">
        <h2 id="parties-title" className="section-title mb-3">
          Thông tin bàn giao
        </h2>
        <PartiesView sender={handover.sender} receiver={handover.receiver} />
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="items-title">
        <h2 id="items-title" className="section-title mb-3">
          Nội dung bàn giao ({handover.items.length})
        </h2>
        <HandoverItemsView items={handover.items} categories={categories} />
      </section>

      {handover.note && (
        <section className="card p-4 sm:p-6" aria-labelledby="note-title">
          <h2 id="note-title" className="section-title mb-2">
            Ghi chú
          </h2>
          <p className="text-sm break-words whitespace-pre-wrap text-stone-800">{handover.note}</p>
        </section>
      )}

      {handover.status === 'PENDING' && (
        <ActionPanel token={token} code={handover.code} onChanged={onChanged} onReload={onReload} />
      )}
    </div>
  );
}

function StatusBanner({ token, handover }: { token: string; handover: PublicHandover }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(publicPdfUrl(token), `${handover.code}.pdf`);
    } catch (err) {
      toast.show(errorMessage(err, 'Không tải được PDF. Vui lòng thử lại sau.'), 'error');
    } finally {
      setDownloading(false);
    }
  }

  if (handover.status === 'CONFIRMED') {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center" role="status">
        <CircleCheck className="mx-auto size-11 text-emerald-600" aria-hidden="true" />
        <h2 className="mt-2 text-lg font-bold tracking-wide text-emerald-900">BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN</h2>
        <dl className="mx-auto mt-3 grid max-w-sm gap-2 text-sm text-emerald-900">
          <div>
            <dt className="text-emerald-700">Thời gian</dt>
            <dd className="font-semibold">{formatDateTime(handover.confirmedAt)}</dd>
          </div>
          <div>
            <dt className="text-emerald-700">Người nhận</dt>
            <dd className="font-semibold">{handover.receiver.name}</dd>
          </div>
        </dl>
        {handover.receiverComment && (
          <p className="mx-auto mt-3 max-w-md text-sm break-words whitespace-pre-wrap text-emerald-900">
            Ghi chú: {handover.receiverComment}
          </p>
        )}
        <Button
          variant="secondary"
          className="mt-4"
          onClick={handleDownload}
          loading={downloading}
          icon={<FileDown className="size-4" aria-hidden="true" />}
        >
          {downloading ? 'Đang chuẩn bị PDF…' : 'Tải PDF biên bản'}
        </Button>
      </section>
    );
  }
  if (handover.status === 'REVISION_REQUESTED') {
    return (
      <section className="rounded-xl border border-orange-200 bg-orange-50 p-5" role="status">
        <div className="flex items-start gap-3">
          <MessageSquareWarning className="mt-0.5 size-6 shrink-0 text-orange-600" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-bold text-orange-900">ĐÃ GỬI YÊU CẦU CHỈNH SỬA</h2>
            <p className="mt-1 text-sm text-orange-900">Lúc {formatDateTime(handover.revisionRequestedAt)}</p>
            {handover.receiverComment && (
              <p className="mt-2 rounded-lg bg-white/70 p-3 text-sm break-words whitespace-pre-wrap text-stone-800">
                {handover.receiverComment}
              </p>
            )}
            <p className="mt-2 text-sm text-orange-900">
              Người bàn giao sẽ cập nhật biên bản. Khi được cập nhật, bạn mở lại link này để kiểm tra và ký xác nhận.
            </p>
          </div>
        </div>
      </section>
    );
  }
  if (handover.status === 'CANCELLED') {
    return (
      <section className="rounded-xl border border-stone-300 bg-stone-100 p-5" role="status">
        <div className="flex items-start gap-3">
          <Ban className="mt-0.5 size-6 shrink-0 text-stone-500" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-stone-800">BIÊN BẢN ĐÃ BỊ HỦY</h2>
            <p className="mt-1 text-sm text-stone-700">Lúc {formatDateTime(handover.cancelledAt)}</p>
            {handover.cancelReason && (
              <p className="mt-1 text-sm break-words whitespace-pre-wrap text-stone-700">Lý do: {handover.cancelReason}</p>
            )}
          </div>
        </div>
      </section>
    );
  }
  return null;
}

type Mode = 'confirm' | 'revision';

function ActionPanel({
  token,
  code,
  onChanged,
  onReload,
}: {
  token: string;
  code: string;
  onChanged: (handover: PublicHandover) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('confirm');
  const padRef = useRef<SignaturePadHandle>(null);
  const [agreed, setAgreed] = useState(false);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ agreed?: string; signature?: string; reason?: string; comment?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleStateConflict(err: unknown): boolean {
    if (isApiError(err) && (err.code === 'ALREADY_CONFIRMED' || err.code === 'INVALID_STATE')) {
      toast.show(err.message, 'info');
      onReload();
      return true;
    }
    return false;
  }

  async function submitConfirm(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const pad = padRef.current;
    const next: typeof errors = {};
    if (!agreed) next.agreed = 'Vui lòng tích ô xác nhận đã kiểm tra và nhận đủ các nội dung.';
    if (!pad || pad.isEmpty()) next.signature = 'Vui lòng ký tên vào khung bên dưới.';
    else if (pad.inkLength() < MIN_INK_LENGTH) next.signature = 'Chữ ký quá ngắn. Vui lòng xóa và ký lại rõ ràng hơn.';
    if (comment.length > LIMITS.receiverComment) next.comment = `Tối đa ${LIMITS.receiverComment} ký tự.`;
    setErrors(next);
    setSubmitError(null);
    if (Object.keys(next).length > 0) {
      document.getElementById(next.agreed ? 'confirm-agreed' : next.signature ? 'signature-section' : 'confirm-comment')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
      return;
    }
    const signature = pad!.toPngDataUrl();
    if (!signature) {
      setErrors({ signature: 'Không đọc được chữ ký. Vui lòng ký lại.' });
      return;
    }
    setSubmitting(true);
    try {
      const handover = await confirmHandover(token, { agreed: true, signature, comment: comment.trim() });
      toast.show('Đã xác nhận bàn giao thành công.');
      onChanged(handover);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (handleStateConflict(err)) return;
      if (err instanceof ApiClientError && err.fieldErrors.signature) setErrors({ signature: err.fieldErrors.signature });
      setSubmitError(errorMessage(err, 'Không thể xác nhận. Vui lòng thử lại.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRevision(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const text = reason.trim();
    if (text.length < LIMITS.revisionReasonMin) {
      setErrors({ reason: `Vui lòng nhập lý do / nội dung cần sửa (ít nhất ${LIMITS.revisionReasonMin} ký tự).` });
      document.getElementById('revision-reason')?.focus();
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const handover = await requestRevision(token, text);
      toast.show('Đã gửi yêu cầu chỉnh sửa tới người bàn giao.');
      onChanged(handover);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (handleStateConflict(err)) return;
      if (err instanceof ApiClientError && err.fieldErrors.reason) setErrors({ reason: err.fieldErrors.reason });
      setSubmitError(errorMessage(err, 'Không thể gửi yêu cầu. Vui lòng thử lại.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-4 sm:p-6" aria-labelledby="action-title">
      <h2 id="action-title" className="section-title">
        Xác nhận của người nhận
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Vui lòng kiểm tra kỹ các nội dung trên trước khi xác nhận biên bản <strong>{code}</strong>.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1" role="group" aria-label="Chọn thao tác">
        {(
          [
            { value: 'confirm', label: 'Xác nhận bàn giao', icon: PenLine },
            { value: 'revision', label: 'Yêu cầu chỉnh sửa', icon: MessageSquareWarning },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => {
              setMode(option.value);
              setSubmitError(null);
            }}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-sm',
              mode === option.value ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600 hover:text-stone-900',
            )}
          >
            <option.icon className="hidden size-4 shrink-0 min-[400px]:block" aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'confirm' ? (
        <form className="mt-5 space-y-5" onSubmit={submitConfirm} noValidate>
          <div>
            <label
              htmlFor="confirm-agreed"
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-sm',
                errors.agreed ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-stone-50',
              )}
            >
              <input
                id="confirm-agreed"
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-brand-700"
                checked={agreed}
                aria-invalid={errors.agreed ? true : undefined}
                aria-describedby={errors.agreed ? 'confirm-agreed-error' : undefined}
                onChange={(event) => {
                  setAgreed(event.target.checked);
                  setErrors((e) => ({ ...e, agreed: undefined }));
                }}
              />
              <span className="font-medium text-stone-900">Tôi đã kiểm tra và xác nhận đã nhận các nội dung trên.</span>
            </label>
            {errors.agreed && (
              <p id="confirm-agreed-error" className="mt-1.5 text-xs font-medium text-red-700">
                {errors.agreed}
              </p>
            )}
          </div>

          <div id="signature-section" className="space-y-2">
            <p className="text-sm font-medium text-stone-800">
              Chữ ký người nhận<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
            </p>
            <p id="signature-help" className="text-xs text-stone-500">
              Dùng ngón tay, bút cảm ứng hoặc chuột để ký trong khung. Trang sẽ không cuộn khi bạn đang ký.
            </p>
            <SignaturePad
              ref={padRef}
              invalid={Boolean(errors.signature)}
              describedBy={errors.signature ? 'signature-error' : 'signature-help'}
              disabled={submitting}
              onChange={() => setErrors((e) => ({ ...e, signature: undefined }))}
            />
            {errors.signature && (
              <p id="signature-error" className="text-xs font-medium text-red-700" role="alert">
                {errors.signature}
              </p>
            )}
          </div>

          <Field id="confirm-comment" label="Ghi chú của người nhận (không bắt buộc)" error={errors.comment}>
            <textarea
              id="confirm-comment"
              className="field-input min-h-20 resize-y"
              rows={2}
              maxLength={LIMITS.receiverComment}
              value={comment}
              aria-invalid={errors.comment ? true : undefined}
              aria-describedby={describedBy('confirm-comment', errors.comment)}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>

          {submitError && <InlineAlert>{submitError}</InlineAlert>}

          <Button
            type="submit"
            variant="success"
            size="lg"
            fullWidth
            loading={submitting}
            icon={<CircleCheck className="size-5" aria-hidden="true" />}
          >
            {submitting ? 'Đang xác nhận…' : 'XÁC NHẬN BÀN GIAO'}
          </Button>
        </form>
      ) : (
        <form className="mt-5 space-y-5" onSubmit={submitRevision} noValidate>
          <Field
            id="revision-reason"
            label="Lý do / nội dung cần sửa"
            required
            error={errors.reason}
            hint="Ví dụ: Laptop có vết xước ở góc trái màn hình; thiếu sạc…"
          >
            <textarea
              id="revision-reason"
              className="field-input min-h-28 resize-y"
              rows={4}
              maxLength={LIMITS.receiverComment}
              value={reason}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={describedBy('revision-reason', errors.reason, 'hint')}
              onChange={(event) => {
                setReason(event.target.value);
                setErrors((e) => ({ ...e, reason: undefined }));
              }}
            />
          </Field>
          {submitError && <InlineAlert>{submitError}</InlineAlert>}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            icon={<Send className="size-4" aria-hidden="true" />}
          >
            {submitting ? 'Đang gửi…' : 'YÊU CẦU CHỈNH SỬA'}
          </Button>
        </form>
      )}
    </section>
  );
}
