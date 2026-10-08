import { Ban, CircleCheck, FileDown, Link2Off, Mail, MailCheck, MessageSquareWarning, PenLine, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { HANDOVER_TYPE_LABELS, LIMITS, OTP_LENGTH } from '../../shared/constants';
import type { ConfirmOtpInfo, PublicHandover, PublicHandoverResponse } from '../../shared/types';
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
import { confirmHandover, getPublicHandover, publicPdfUrl, requestConfirmOtp, requestRevision } from '../services/handoverApi';
import { cn } from '../utils/cn';
import { formatDateTime } from '../utils/format';

const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);

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
          key={token}
          token={token}
          data={query.data}
          reloadStatus={query.status}
          reloadError={query.error}
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
          Link có thể đã bị nhập sai hoặc đã được thay bằng link mới. Vui lòng liên hệ quản trị viên (người lập phiếu) để nhận lại link.
        </p>
      </div>
    );
  }
  return <ErrorState title="Không thể tải biên bản." error={error} onRetry={onRetry} />;
}

type Mode = 'confirm' | 'revision';

/**
 * Phần người nhận đang nhập / đang chờ — giữ ở HandoverConfirmView: biên bản đổi nội dung thì khung ký làm lại từ đầu
 * (ActionPanel dựng lại theo contentHash) nhưng KHÔNG mất tab đang chọn, ghi chú, lý do sửa, mã đã nhập và thời gian chờ gửi lại mã.
 * Chỉ chữ ký và ô "đã kiểm tra" phải làm lại.
 */
interface ConfirmDraft {
  mode: Mode;
  comment: string;
  reason: string;
  otpCode: string;
  /** Email (đã che) vừa nhận mã — rỗng: chưa gửi mã lần nào trên trang này. */
  otpSentTo: string;
  otpNotice: string | null;
  /** Mốc (ms) được gửi lại mã — máy chủ chặn gửi lại trước mốc này. */
  resendAt: number;
}

const EMPTY_DRAFT: ConfirmDraft = { mode: 'confirm', comment: '', reason: '', otpCode: '', otpSentTo: '', otpNotice: null, resendAt: 0 };

function HandoverConfirmView({
  token,
  data,
  reloadStatus,
  reloadError,
  onChanged,
  onReload,
}: {
  token: string;
  data: PublicHandoverResponse;
  /** Trạng thái lần tải lại gần nhất (dữ liệu đang hiển thị vẫn giữ trong lúc tải lại / khi tải lại lỗi). */
  reloadStatus: 'loading' | 'success' | 'error';
  reloadError: unknown;
  onChanged: (handover: PublicHandover) => void;
  onReload: () => void;
}) {
  const { handover, categories } = data;
  // Biên bản vừa được quản trị viên sửa trong lúc người nhận đang xem (máy chủ báo CONFLICT) → buộc xem lại trước khi ký.
  // Lưu mã nội dung CŨ: chỉ báo "đây là bản mới nhất" khi đã tải lại thành công và nội dung thật sự khác bản cũ.
  const [staleHash, setStaleHash] = useState<string | null>(null);
  const showingStale = staleHash !== null && handover.contentHash === staleHash;
  const [draft, setDraft] = useState<ConfirmDraft>(EMPTY_DRAFT);
  const updateDraft = useCallback((patch: Partial<ConfirmDraft>) => setDraft((current) => ({ ...current, ...patch })), []);
  useDocumentTitle(`Biên bản ${handover.code}`);

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-6" aria-labelledby="handover-title">
        <p className="text-xs font-bold tracking-widest text-brand-600 uppercase">
          Biên bản bàn giao · {HANDOVER_TYPE_LABELS[handover.handoverType] ?? handover.handoverType}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 id="handover-title" className="font-mono text-xl font-bold text-brand-900 sm:text-2xl">
            {handover.code}
          </h1>
          <StatusBadge status={handover.status} />
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Ngày tạo: {formatDateTime(handover.createdAt)}
          {handover.updatedAt && handover.updatedAt !== handover.createdAt ? ` · Cập nhật: ${formatDateTime(handover.updatedAt)}` : ''}
        </p>
      </section>

      {reloadStatus === 'error' && (
        <InlineAlert>
          <p className="font-semibold">Không tải được bản mới nhất của biên bản</p>
          <p className="mt-1">
            {errorMessage(reloadError, 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.')}
            {showingStale ? ' Nội dung đang hiển thị bên dưới là bản CŨ, đã được quản trị viên sửa — hãy tải lại trước khi ký.' : ''}
          </p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={onReload} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
            Thử lại
          </Button>
        </InlineAlert>
      )}
      {showingStale && reloadStatus === 'loading' && (
        <InlineAlert tone="info">
          <p className="flex items-center gap-2 font-semibold">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            Biên bản vừa được cập nhật — đang tải bản mới nhất…
          </p>
        </InlineAlert>
      )}
      {/* Chỉ báo "bản mới nhất" khi đã tải được nội dung mới (tải lại lỗi → bên dưới vẫn là bản cũ, showingStale). */}
      {staleHash !== null && !showingStale && handover.status === 'PENDING' && (
        <InlineAlert tone="warning">
          <p className="flex items-center gap-2 font-semibold">
            <RefreshCw className="size-4" aria-hidden="true" />
            Biên bản vừa được cập nhật
          </p>
          <p className="mt-1">Nội dung bên dưới là bản mới nhất. Vui lòng kiểm tra lại toàn bộ trước khi ký xác nhận.</p>
          {handover.otp?.required && draft.otpSentTo && (
            <p className="mt-1">Mã xác nhận đã gửi trước đó có thể không còn hiệu lực — nếu báo lỗi mã, hãy bấm “Gửi lại mã” để nhận mã mới.</p>
          )}
        </InlineAlert>
      )}

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

      {handover.status === 'PENDING' && handover.updating && (
        // Lần lưu sửa phiếu của quản trị viên chưa hoàn tất (máy chủ chặn ký / yêu cầu sửa / gửi mã cho tới khi lưu xong): báo rõ thay
        // vì để người nhận ký rồi nhận lỗi. Ghi chú, mã đã nhập… vẫn giữ (draft ở đây); nội dung có thể đổi nên phải ký lại.
        <InlineAlert tone="warning">
          <p className="flex items-center gap-2 font-semibold">
            <RefreshCw className="size-4" aria-hidden="true" />
            Biên bản đang được quản trị viên cập nhật
          </p>
          <p className="mt-1">
            Lần lưu chỉnh sửa trước của quản trị viên chưa hoàn tất nên tạm thời chưa thể ký xác nhận hoặc yêu cầu sửa. Vui lòng tải lại
            sau ít phút — nếu vẫn thấy thông báo này, hãy liên hệ quản trị viên.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={onReload}
            loading={reloadStatus === 'loading'}
            icon={<RefreshCw className="size-4" aria-hidden="true" />}
          >
            Tải lại
          </Button>
        </InlineAlert>
      )}
      {handover.status === 'PENDING' && !handover.updating && (
        // key theo mã nội dung: nội dung đổi → form ký làm lại từ đầu (xóa chữ ký, bỏ tích xác nhận).
        <ActionPanel
          key={handover.contentHash}
          token={token}
          code={handover.code}
          receiverName={handover.receiver.name}
          contentHash={handover.contentHash}
          otp={handover.otp ?? NO_OTP}
          draft={draft}
          onDraft={updateDraft}
          onChanged={onChanged}
          onReload={onReload}
          onContentChanged={() => {
            setStaleHash(handover.contentHash);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
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
              Quản trị viên sẽ cập nhật biên bản. Khi được cập nhật, bạn mở lại link này để kiểm tra và ký xác nhận.
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

/** Máy chủ dữ liệu bản cũ (chưa có mã OTP) → không yêu cầu mã. */
const NO_OTP: ConfirmOtpInfo = { required: false, blocked: false, emailMasked: '' };

/** Đếm ngược tới mốc thời gian (ms) — dùng cho "gửi lại mã sau N giây". */
function useSecondsUntil(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Mốc mới → lấy lại "bây giờ" ngay (nếu không, lần vẽ đầu tính từ lúc trang mở → hiện 62 thay vì 60 giây).
    setNow(Date.now());
    if (deadline <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      // Hết thời gian chờ → dừng đếm, không chạy mãi mỗi giây.
      if (current >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Thời gian máy chủ yêu cầu chờ trước khi gửi lại mã (details.retryAfterSeconds) — null nếu không yêu cầu. */
function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error)) return null;
  const seconds = Number((error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** "45 giây" / "13 phút" — chờ lâu (giới hạn số lần gửi trong 15 phút) hiển thị theo phút cho dễ đọc. */
function waitText(seconds: number): string {
  return seconds > 90 ? `${Math.ceil(seconds / 60)} phút` : `${seconds} giây`;
}

function ActionPanel({
  token,
  code,
  receiverName,
  contentHash,
  otp,
  draft,
  onDraft,
  onChanged,
  onReload,
  onContentChanged,
}: {
  token: string;
  code: string;
  receiverName: string;
  contentHash: string;
  otp: ConfirmOtpInfo;
  draft: ConfirmDraft;
  onDraft: (patch: Partial<ConfirmDraft>) => void;
  onChanged: (handover: PublicHandover) => void;
  onReload: () => void;
  onContentChanged: () => void;
}) {
  const toast = useToast();
  const { mode, comment, reason, otpCode, otpSentTo, otpNotice, resendAt } = draft;
  const padRef = useRef<SignaturePadHandle>(null);
  const [agreed, setAgreed] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const resendIn = useSecondsUntil(resendAt);
  const [errors, setErrors] = useState<{ agreed?: string; signature?: string; reason?: string; comment?: string; otp?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Biên bản vừa chuyển sang cần mã (tải lại sau lỗi OTP_*) → đưa phần mã xác nhận vừa hiện vào tầm nhìn.
  const otpWasRequired = useRef(otp.required);
  useEffect(() => {
    if (otp.required && !otpWasRequired.current) {
      document.getElementById('otp-section')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    otpWasRequired.current = otp.required;
  }, [otp.required]);

  async function sendOtp() {
    if (otpSending || resendIn > 0) return;
    setOtpSending(true);
    onDraft({ otpNotice: null });
    setErrors((e) => ({ ...e, otp: undefined }));
    try {
      const result = await requestConfirmOtp(token);
      onDraft({ otpSentTo: result.emailMasked, resendAt: Date.now() + result.resendAfterSeconds * 1000, otpCode: '' });
      toast.show(`Đã gửi mã xác nhận tới ${result.emailMasked}.`);
      document.getElementById('confirm-otp')?.focus();
    } catch (err) {
      if (handleStateConflict(err)) return;
      const message = errorMessage(err, 'Không gửi được mã xác nhận. Vui lòng thử lại.');
      // Gửi lỗi (MAIL_ERROR): máy chủ vẫn giữ mã đã gửi thành công trước đó.
      const patch: Partial<ConfirmDraft> = {
        otpNotice: isApiError(err, 'MAIL_ERROR')
          ? `${message} Nếu trước đó bạn đã nhận được email mã xác nhận, mã trong email đó vẫn dùng được.`
          : message,
      };
      // Máy chủ yêu cầu chờ (gửi lại quá sớm / quá nhiều lần, hoặc vừa gửi lỗi) → đếm ngược đúng thời gian đó.
      const wait = retryAfterSeconds(err);
      if (wait !== null) patch.resendAt = Date.now() + wait * 1000;
      onDraft(patch);
    } finally {
      setOtpSending(false);
    }
  }

  function handleStateConflict(err: unknown): boolean {
    if (isApiError(err) && (err.code === 'ALREADY_CONFIRMED' || err.code === 'INVALID_STATE')) {
      toast.show(err.message, 'info');
      onReload();
      return true;
    }
    // Nội dung đã đổi so với bản đang xem: KHÔNG ký bản cũ — tải bản mới, buộc kiểm tra lại.
    if (isApiError(err) && err.code === 'CONFLICT') {
      toast.show(err.message, 'info');
      onContentChanged();
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
    if (otp.required && !OTP_PATTERN.test(otpCode)) {
      next.otp = otpSentTo ? `Nhập mã ${OTP_LENGTH} chữ số đã gửi tới ${otpSentTo}.` : 'Bấm “Gửi mã xác nhận” rồi nhập mã nhận được qua email.';
    }
    if (!pad || pad.isEmpty()) next.signature = 'Vui lòng ký tên vào khung bên dưới.';
    else if (pad.inkLength() < MIN_INK_LENGTH) next.signature = 'Chữ ký quá ngắn. Vui lòng xóa và ký lại rõ ràng hơn.';
    if (comment.length > LIMITS.receiverComment) next.comment = `Tối đa ${LIMITS.receiverComment} ký tự.`;
    setErrors(next);
    setSubmitError(null);
    if (Object.keys(next).length > 0) {
      const firstInvalid = next.agreed ? 'confirm-agreed' : next.otp ? 'otp-section' : next.signature ? 'signature-section' : 'confirm-comment';
      document.getElementById(firstInvalid)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const signature = pad!.toPngDataUrl();
    if (!signature) {
      setErrors({ signature: 'Không đọc được chữ ký. Vui lòng ký lại.' });
      return;
    }
    setSubmitting(true);
    try {
      const handover = await confirmHandover(token, {
        agreed: true,
        signature,
        comment: comment.trim(),
        contentHash,
        otp: otp.required ? otpCode : '',
      });
      toast.show('Đã xác nhận bàn giao thành công.');
      onChanged(handover);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (handleStateConflict(err)) return;
      // Trang mở lúc chưa cần mã nhưng nay máy chủ đòi mã (quản trị viên vừa bổ sung email người nhận / bật CONFIRM_OTP):
      // tải lại để hiện phần mã xác nhận. Nội dung không đổi → khung ký không dựng lại, chữ ký vẫn còn.
      if (!otp.required && isApiError(err) && err.code.startsWith('OTP_')) {
        setSubmitError(
          err.fieldErrors.otp
            ? 'Biên bản này nay cần mã xác nhận gửi qua email. Bấm “Gửi mã xác nhận” ở phần mã xác nhận phía trên, nhập mã nhận được rồi bấm XÁC NHẬN BÀN GIAO lại — chữ ký của bạn vẫn được giữ.'
            : errorMessage(err, 'Biên bản này nay cần mã xác nhận gửi qua email.'),
        );
        onReload();
        return;
      }
      if (err instanceof ApiClientError && (err.fieldErrors.signature || err.fieldErrors.otp)) {
        setErrors({ signature: err.fieldErrors.signature, otp: err.fieldErrors.otp });
        if (err.fieldErrors.otp) {
          // Mã hết hạn / bị hủy do nhập sai nhiều lần → xóa ô mã để nhập mã mới. Chữ ký vẫn giữ nguyên.
          if (isApiError(err, 'OTP_EXPIRED') || isApiError(err, 'OTP_LOCKED')) onDraft({ otpCode: '' });
          document.getElementById('otp-section')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
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
      const handover = await requestRevision(token, text, contentHash);
      toast.show('Đã gửi yêu cầu chỉnh sửa tới quản trị viên.');
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
      <p className="mt-1 text-xs text-stone-500">
        Chỉ <strong className="text-stone-700">{receiverName}</strong> được ký biên bản này — hãy ký trên điện thoại của chính bạn, không ký
        hộ người khác.
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
              onDraft({ mode: option.value });
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

      {/* Hai form luôn được giữ (form không dùng thì ẩn): đổi tab qua lại không mất chữ ký, ô đã tích, lý do đang nhập. */}
      <form className="mt-5 space-y-5" onSubmit={submitConfirm} noValidate hidden={mode !== 'confirm'}>
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

        {otp.required && !otp.blocked && (
          <div id="otp-section" className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/60 p-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
              <MailCheck className="size-4" aria-hidden="true" />
              Mã xác nhận qua email<span className="text-red-600" aria-hidden="true">*</span>
            </p>
            <p className="text-xs text-stone-700">
              Để chắc chắn đúng người nhận ký, hệ thống gửi mã {OTP_LENGTH} số tới email <strong>{otp.emailMasked}</strong>. Mã có hiệu lực 10
              phút — kiểm tra cả thư mục Spam / Quảng cáo.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void sendOtp()}
                loading={otpSending}
                disabled={resendIn > 0}
                icon={<Mail className="size-4" aria-hidden="true" />}
              >
                {resendIn > 0 ? `Gửi lại mã sau ${waitText(resendIn)}` : otpSentTo ? 'Gửi lại mã' : 'Gửi mã xác nhận'}
              </Button>
              <div className="min-w-0 flex-1 basis-40">
                <label htmlFor="confirm-otp" className="sr-only">
                  Mã xác nhận {OTP_LENGTH} số
                </label>
                <input
                  id="confirm-otp"
                  className="field-input text-center font-mono text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={OTP_LENGTH}
                  placeholder="••••••"
                  value={otpCode}
                  aria-invalid={errors.otp ? true : undefined}
                  aria-describedby={errors.otp ? 'confirm-otp-error' : otpSentTo ? 'confirm-otp-sent' : undefined}
                  onChange={(event) => {
                    onDraft({ otpCode: event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH) });
                    setErrors((e) => ({ ...e, otp: undefined }));
                  }}
                />
              </div>
            </div>
            {otpSentTo && !errors.otp && (
              <p id="confirm-otp-sent" className="text-xs text-emerald-800" role="status">
                Đã gửi mã tới {otpSentTo}. Dùng mã trong email MỚI NHẤT.
              </p>
            )}
            {otpNotice && <InlineAlert>{otpNotice}</InlineAlert>}
            {errors.otp && (
              <p id="confirm-otp-error" className="text-xs font-medium text-red-700" role="alert">
                {errors.otp}
              </p>
            )}
          </div>
        )}

        {otp.blocked && (
          <InlineAlert tone="warning">
            <p className="font-semibold">Chưa thể ký xác nhận</p>
            <p className="mt-1">
              Biên bản này bắt buộc nhập mã xác nhận gửi qua email, nhưng hệ thống chưa có email của bạn. Vui lòng liên hệ quản trị viên để
              bổ sung email, sau đó mở lại link này. Nếu nội dung chưa đúng, bạn vẫn có thể chọn “Yêu cầu chỉnh sửa”.
            </p>
          </InlineAlert>
        )}

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
            onChange={(event) => onDraft({ comment: event.target.value })}
          />
        </Field>

        {submitError && <InlineAlert>{submitError}</InlineAlert>}

        <Button
          type="submit"
          variant="success"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={otp.blocked}
          icon={<CircleCheck className="size-5" aria-hidden="true" />}
        >
          {submitting ? 'Đang xác nhận…' : 'XÁC NHẬN BÀN GIAO'}
        </Button>
      </form>

      <form className="mt-5 space-y-5" onSubmit={submitRevision} noValidate hidden={mode !== 'revision'}>
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
              onDraft({ reason: event.target.value });
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
    </section>
  );
}
