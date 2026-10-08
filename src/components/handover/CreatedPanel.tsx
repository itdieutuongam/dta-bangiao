import { CircleCheck, Eye, FilePlus2, FileSearch, Mail, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { HANDOVER_TYPE_LABELS } from '../../../shared/constants';
import type { CreateHandoverResult } from '../../../shared/types';
import { CopyField } from '../CopyField';
import { QrCode } from '../QrCode';
import { Button, ButtonLink, buttonClasses } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

/** Người nhận có phải nhập mã OTP gửi qua email khi ký không (CAU_HINH.CONFIRM_OTP) — báo trước cho người lập phiếu. */
function OtpNotice({ otp }: { otp: CreateHandoverResult['confirmOtp'] | undefined }) {
  if (!otp) return null; // máy chủ dữ liệu bản cũ
  if (otp.blocked) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
        <p className="flex items-center gap-2 font-semibold">
          <TriangleAlert className="size-4" aria-hidden="true" />
          Người nhận chưa ký được
        </p>
        <p className="mt-1">
          Hệ thống bắt buộc mã xác nhận qua email (CONFIRM_OTP = REQUIRED) nhưng nhân viên này chưa có email trong sheet NHAN_VIEN. Bổ sung email
          rồi bấm “Làm mới dữ liệu” ở cuối thanh menu.
        </p>
      </div>
    );
  }
  if (otp.required) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Khi ký, người nhận phải nhập <strong>mã xác nhận gửi tới {otp.email}</strong> — người khác cầm link cũng không ký thay được.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Người nhận ký <strong>không cần mã xác nhận</strong> (chưa có email trong NHAN_VIEN hoặc đã tắt CONFIRM_OTP) — hãy chỉ gửi link cho đúng
        người nhận; phiếu ký không có mã sẽ được đánh dấu trong lịch sử.
      </span>
    </p>
  );
}

/** Kết quả sau khi admin tạo phiếu: link xác nhận (sao chép / QR / email) + cảnh báo tồn kho. */
export function CreatedPanel({ result, onCreateNew }: { result: CreateHandoverResult; onCreateNew: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const receiver = result.receiver;
  const mailto = receiver.email && result.link
    ? `mailto:${receiver.email}?subject=${encodeURIComponent(`Xác nhận biên bản bàn giao ${result.code}`)}&body=${encodeURIComponent(
        `Chào ${receiver.name},\n\nVui lòng mở link sau để kiểm tra nội dung và ký xác nhận biên bản bàn giao ${result.code}:\n${result.link}\n\nTrân trọng.`,
      )}`
    : null;

  return (
    <section className="card overflow-hidden" aria-labelledby="created-title">
      <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
        <CircleCheck className="mx-auto size-12 text-emerald-600" aria-hidden="true" />
        <h1
          id="created-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-xl font-bold tracking-wide text-emerald-900 focus:outline-none"
        >
          ĐÃ TẠO BIÊN BẢN
        </h1>
        <p className="mt-1 text-sm text-emerald-800">
          {result.duplicate
            ? 'Phiếu này đã được tạo trước đó (gửi trùng) — hệ thống không tạo phiếu thứ hai.'
            : 'Gửi link bên dưới cho người nhận để kiểm tra và ký xác nhận.'}
        </p>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Mã</dt>
            <dd className="mt-1 font-mono text-lg font-bold text-brand-900">{result.code}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Loại phiếu</dt>
            <dd className="mt-1 font-semibold text-stone-900">{HANDOVER_TYPE_LABELS[result.handoverType] ?? result.handoverType}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Người nhận</dt>
            <dd className="mt-1 font-semibold text-stone-900">{receiver.name}</dd>
            <dd className="text-sm text-stone-600">{[receiver.employeeId, receiver.department].filter(Boolean).join(' · ')}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Trạng thái</dt>
            <dd className="mt-1.5">
              <StatusBadge status={result.status} />
            </dd>
          </div>
        </dl>

        {result.warnings.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900" role="status">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4" aria-hidden="true" />
              Cảnh báo tồn kho
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-6">
              {result.warnings.map((w) => (
                <li key={w.productId}>
                  {w.type === 'LAST_ITEM'
                    ? `${w.productName}: đã hết hàng khả dụng sau phiếu này.`
                    : `${w.productName}: sắp hết (khả dụng ${w.available}, tối thiểu ${w.minimumStock ?? 0}).`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <OtpNotice otp={result.confirmOtp} />

        {result.link ? (
          <>
            <CopyField value={result.link} label="Link xác nhận" />
            <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:flex-row">
              <QrCode value={result.link} label={`Mã QR mở link xác nhận ${result.code}`} />
              <p className="text-sm text-stone-600">
                Bàn giao trực tiếp? Người nhận <strong>quét mã QR bằng điện thoại của chính mình</strong> để mở biên bản và ký xác nhận.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-stone-600">Mở chi tiết phiếu để sao chép hoặc tạo lại link xác nhận.</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <ButtonLink to={`/admin/ban-giao/${result.id}`} icon={<FileSearch className="size-4" aria-hidden="true" />}>
            Chi tiết phiếu
          </ButtonLink>
          {result.link && (
            <a href={result.link} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'md')}>
              <Eye className="size-4" aria-hidden="true" />
              XEM BIÊN BẢN
            </a>
          )}
          {mailto && (
            <a href={mailto} className={buttonClasses('secondary', 'md')}>
              <Mail className="size-4" aria-hidden="true" />
              GỬI QUA EMAIL
            </a>
          )}
          <Button onClick={onCreateNew} icon={<FilePlus2 className="size-4" aria-hidden="true" />} className="sm:ml-auto">
            TẠO PHIẾU MỚI
          </Button>
        </div>
      </div>
    </section>
  );
}
