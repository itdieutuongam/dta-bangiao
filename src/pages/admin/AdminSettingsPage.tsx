import { CircleCheck, CircleX, ExternalLink, Mail, TriangleAlert } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { MAIL_RESERVE_FOR_OTP, NOTIFY_EVENT_LABELS } from '../../../shared/constants';
import type { NotifyChannelStatus, NotifyStatus, SystemInfo } from '../../../shared/types';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, InlineAlert, LoadingCard } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminSystem } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';

/** /admin/cai-dat — trạng thái cấu hình (không hiển thị secret) + hướng dẫn nâng cấp dữ liệu an toàn. */
export default function AdminSettingsPage() {
  useDocumentTitle('Cài đặt');
  const { handleError, user } = useAdmin();
  const system = useAsync(() => adminSystem(), []);

  useEffect(() => {
    if (system.status === 'error' && isApiError(system.error) && system.error.status === 401) handleError(system.error);
  }, [system.status, system.error, handleError]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <PageHeader title="Cài đặt" description={user ? `Đăng nhập: ${user.name} (${user.username})` : 'Cấu hình hệ thống'} />
      {system.status === 'loading' && !system.data && <LoadingCard lines={8} />}
      {system.status === 'error' && !system.data && <ErrorState title="Không tải được cấu hình." error={system.error} onRetry={system.reload} />}
      {system.data && <SettingsBody info={system.data} />}
      <UpgradeGuide />
    </div>
  );
}

/** warn: hoạt động nhưng cần lưu ý (ưu tiên hơn ok). */
function Check({ ok, warn = false, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {warn ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Cần lưu ý" />
      ) : ok ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Đạt" />
      ) : (
        <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="Chưa đạt" />
      )}
      <span className="text-stone-800">{children}</span>
    </li>
  );
}

function SettingsBody({ info }: { info: SystemInfo }) {
  const gas = info.appsScript;
  return (
    <>
      {info.warnings.length > 0 && (
        <InlineAlert tone="warning">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4" aria-hidden="true" />
            Cần xử lý
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {info.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 sm:p-5" aria-labelledby="worker-title">
          <h2 id="worker-title" className="section-title mb-3">
            Cloudflare Worker
          </h2>
          <dl className="mb-3 space-y-1 text-sm">
            <div>
              <dt className="inline text-stone-500">Phiên bản: </dt>
              <dd className="inline font-mono">{info.worker.version}</dd>
            </div>
            <div>
              <dt className="inline text-stone-500">Địa chỉ link xác nhận: </dt>
              <dd className="inline font-mono break-all">{info.worker.appBaseUrl}</dd>
            </div>
          </dl>
          <ul className="space-y-1.5">
            <Check ok={info.worker.loginMode === 'users'}>
              {info.worker.loginMode === 'users'
                ? `Tài khoản quản trị riêng từng người (${info.worker.adminUsers} tài khoản) — nhật ký ghi đúng người thao tác.`
                : 'Đang dùng MỘT mật khẩu quản trị chung — nên cấu hình secret ADMIN_USERS để mỗi người có tài khoản riêng.'}
            </Check>
            <Check ok={info.worker.staffAccessCode}>
              {info.worker.staffAccessCode
                ? 'Trang đề xuất VPP yêu cầu mã truy cập nội bộ (STAFF_ACCESS_CODE).'
                : 'Chưa đặt STAFF_ACCESS_CODE — trang đề xuất VPP mở cho bất kỳ ai biết địa chỉ (vẫn phải nhập đúng mã nhân viên).'}
            </Check>
            <Check ok={info.worker.rateLimitBindings}>
              {info.worker.rateLimitBindings ? 'Giới hạn tần suất (Rate Limiting) đã bật.' : 'Thiếu binding Rate Limiting (RL_PUBLIC / RL_WRITE / RL_AUTH).'}
            </Check>
            <Check ok={info.worker.recordSeal}>
              {info.worker.recordSeal
                ? 'Biên bản ký được niêm phong (RECORD_SEAL_SECRET) — sửa dữ liệu trên Sheet rồi tính lại mã vẫn bị phát hiện. Không đổi khóa này sau khi đã dùng.'
                : 'Chưa đặt RECORD_SEAL_SECRET (≥ 32 ký tự) — biên bản ký không được niêm phong; người sửa được Sheet có thể sửa dữ liệu rồi tính lại mã toàn vẹn.'}
            </Check>
          </ul>
        </section>

        <section className="card p-4 sm:p-5" aria-labelledby="gas-title">
          <h2 id="gas-title" className="section-title mb-3">
            Google Apps Script & Google Sheet
          </h2>
          {!gas ? (
            <InlineAlert>{info.appsScriptError ?? 'Không kết nối được Apps Script.'}</InlineAlert>
          ) : (
            <>
              <dl className="mb-3 space-y-1 text-sm">
                <div>
                  <dt className="inline text-stone-500">Phiên bản code: </dt>
                  <dd className="inline font-mono">{gas.version}</dd>
                </div>
                <div>
                  <dt className="inline text-stone-500">Cấu trúc dữ liệu: </dt>
                  <dd className="inline font-mono">
                    v{gas.schemaVersion} / yêu cầu v{gas.requiredSchemaVersion}
                  </dd>
                </div>
                {gas.spreadsheetName && (
                  <div>
                    <dt className="inline text-stone-500">Google Sheet: </dt>
                    <dd className="inline">{gas.spreadsheetName}</dd>
                  </div>
                )}
              </dl>
              <ul className="space-y-1.5">
                <Check ok={gas.schemaReady}>
                  {gas.schemaReady ? 'Cơ sở dữ liệu đã nâng cấp (module Văn phòng phẩm sẵn sàng).' : 'Chưa nâng cấp cơ sở dữ liệu — làm theo hướng dẫn bên dưới.'}
                </Check>
                <Check ok={gas.version === info.worker.version}>
                  {gas.version === info.worker.version ? 'Phiên bản Apps Script khớp Worker.' : 'Phiên bản Apps Script khác Worker — cập nhật code Apps Script.'}
                </Check>
              </ul>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {gas.spreadsheetUrl && (
                  <a href={gas.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                    Mở Google Sheet <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
                {gas.driveFolderUrl && (
                  <a href={gas.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                    Thư mục Drive <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
              {gas.pendingChanges.length > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Thay đổi cấu trúc chờ áp dụng ({gas.pendingChanges.length}):</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {gas.pendingChanges.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {gas?.notify && <EmailSection notify={gas.notify} />}

      {gas && gas.sheets.length > 0 && (
        <section className="card overflow-hidden" aria-labelledby="sheets-title">
          <h2 id="sheets-title" className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-800">
            Các sheet dữ liệu
          </h2>
          <ul className="grid divide-y divide-stone-100 sm:grid-cols-2 sm:divide-y-0">
            {gas.sheets.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-mono text-xs">{s.name}</span>
                <span className={s.exists ? 'text-stone-600' : 'font-semibold text-red-700'}>{s.exists ? `${s.rows} dòng` : 'chưa có'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const OTP_MODE_TEXT: Record<NotifyStatus['otpMode'], string> = {
  EMAIL: 'EMAIL — người nhận có email phải nhập mã gửi tới email khi ký; chưa có email vẫn ký được nhưng phiếu bị đánh dấu “ký không có mã”.',
  REQUIRED: 'REQUIRED — luôn bắt buộc mã; người nhận chưa có email thì không ký được cho tới khi bổ sung email.',
  OFF: 'OFF — không dùng mã xác nhận (chỉ dựa vào link bí mật). Không khuyến nghị.',
};

/** Hạn mức MailApp hôm nay: hết → không gửi được mã xác nhận; dưới mức để dành → email thông báo tạm dừng. */
function MailQuotaCheck({ quota, mailError }: { quota: number | null; mailError: string }) {
  if (quota === null) return <Check ok={false}>{mailError || 'Chưa dùng được MailApp.'}</Check>;
  if (quota <= 0) {
    return (
      <Check ok={false}>
        Đã hết hạn mức gửi email hôm nay (MailApp còn 0 lượt) — hệ thống KHÔNG gửi được mã xác nhận khi ký: người nhận của biên bản cần mã
        sẽ chưa ký được cho tới khi Google cấp lại hạn mức (sau khoảng 24 giờ).
      </Check>
    );
  }
  if (quota < MAIL_RESERVE_FOR_OTP) {
    return (
      <Check ok warn>
        Gửi email (MailApp) hoạt động nhưng chỉ còn {quota} lượt hôm nay (dưới {MAIL_RESERVE_FOR_OTP}) — email thông báo cho quản trị viên đang
        tạm dừng để dành hạn mức cho mã xác nhận khi ký.
      </Check>
    );
  }
  return <Check ok>Gửi email (MailApp) hoạt động — còn {quota} lượt hôm nay.</Check>;
}

/** Kết quả gửi gần nhất của một loại email (mã xác nhận / thông báo) — hai loại tách riêng. */
function MailChannelCheck({
  label,
  channel,
  showEvent,
  never,
}: {
  label: string;
  channel: NotifyChannelStatus | undefined;
  showEvent: boolean;
  never: string;
}) {
  const error = channel?.lastError ?? null;
  return (
    <Check ok={!error}>
      {label}:{' '}
      {error
        ? `gửi lỗi lần gần nhất lúc ${formatDateTime(error.at)}${showEvent ? ` (${NOTIFY_EVENT_LABELS[error.event] ?? error.event})` : ''} — ${error.message}`
        : channel?.lastOkAt
          ? `gửi thành công gần nhất lúc ${formatDateTime(channel.lastOkAt)}.`
          : never}
    </Check>
  );
}

function EmailSection({ notify }: { notify: NonNullable<SystemInfo['appsScript']>['notify'] }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="email-title">
      <h2 id="email-title" className="section-title mb-3 flex items-center gap-2">
        <Mail className="size-5 text-brand-700" aria-hidden="true" />
        Email: mã xác nhận khi ký & thông báo
      </h2>
      <ul className="space-y-1.5">
        <MailQuotaCheck quota={notify.mailQuotaRemaining} mailError={notify.mailError} />
        <Check ok={notify.otpMode !== 'OFF'}>Mã xác nhận khi ký (CONFIRM_OTP): {OTP_MODE_TEXT[notify.otpMode]}</Check>
        <Check ok={notify.recipients > 0}>
          {notify.recipients > 0
            ? `Thông báo cho quản trị viên: ${notify.recipients} địa chỉ (NOTIFY_EMAILS).`
            : 'Chưa có email nhận thông báo (NOTIFY_EMAILS trống) — yêu cầu chỉnh sửa / đề xuất mới / cần đối soát kho chỉ hiện trên trang quản trị.'}
        </Check>
        {/* Máy chủ Apps Script bản cũ chưa tách hai loại → không có otp / notify. */}
        <MailChannelCheck label="Email mã xác nhận khi ký" channel={notify.otp} showEvent={false} never="chưa gửi mã nào." />
        <MailChannelCheck label="Email thông báo cho quản trị viên" channel={notify.notify} showEvent never="chưa gửi email nào." />
      </ul>
      <details className="mt-3 text-sm text-stone-700">
        <summary className="cursor-pointer font-medium text-brand-700">Cách cấu hình (chủ sở hữu Google Sheet)</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Sheet <strong>CAU_HINH</strong>: <code>CONFIRM_OTP</code> = EMAIL / REQUIRED / OFF; <code>NOTIFY_EMAILS</code> = các email nhận thông báo, cách
            nhau bởi dấu phẩy; <code>APP_URL</code> = địa chỉ trang (link trong email). Sửa xong bấm “Làm mới dữ liệu” ở cuối thanh menu.
          </li>
          <li>
            Menu <strong>DTA Handover → Gửi thử email thông báo</strong>: lần đầu Google sẽ hỏi quyền “Gửi email thay bạn” — bấm Cho phép. Thiếu quyền này
            thì người nhận KHÔNG nhận được mã để ký.
          </li>
          <li>
            Menu <strong>DTA Handover → Bật email tổng hợp hằng ngày</strong> (khoảng 8h sáng: yêu cầu chỉnh sửa, đề xuất chờ duyệt, hàng hết / sắp hết).
          </li>
          <li>
            Hạn mức gửi: ~100 người nhận / ngày (Gmail thường), ~1.500 (Google Workspace). Khi còn dưới {MAIL_RESERVE_FOR_OTP}, hệ thống tạm dừng email
            thông báo để dành cho mã xác nhận.
          </li>
        </ol>
      </details>
    </section>
  );
}

function UpgradeGuide() {
  return (
    <section className="card p-4 sm:p-6" aria-labelledby="upgrade-title">
      <h2 id="upgrade-title" className="section-title mb-2">
        Nâng cấp lên v2 (module Văn phòng phẩm) — làm theo thứ tự
      </h2>
      <p className="mb-3 text-sm text-stone-600">
        Chủ sở hữu Google Sheet thực hiện. Các bước đều an toàn khi chạy lại; hệ thống tự sao lưu toàn bộ Google Sheet trước khi đổi cấu trúc, không xóa
        dữ liệu cũ.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-800">
        <li>
          Mở Google Sheet → <strong>Tiện ích mở rộng → Apps Script</strong>, thay toàn bộ code bằng file <code>dist/apps-script/DTA_Handover.gs</code> mới
          (tạo bằng lệnh <code>npm run gas:bundle</code>), bấm Lưu.
        </li>
        <li>
          <strong>Triển khai → Quản lý triển khai → Chỉnh sửa → Phiên bản: Phiên bản mới → Triển khai</strong> (giữ nguyên URL Web App). Nếu Google hỏi
          quyền (có thêm quyền gửi email cho mã xác nhận khi ký) — bấm Cho phép.
        </li>
        <li>
          Trên Google Sheet, menu <strong>DTA Handover → Nâng cấp module Văn phòng phẩm (v2)</strong>. Hệ thống sao lưu, thêm cột / sheet mới và đánh dấu
          cấu trúc v2.
        </li>
        <li>
          Menu <strong>DTA Handover → Khởi tạo định mức VPP</strong>, sau đó <strong>Nhập tồn đầu kỳ VPP (chạy 1 lần)</strong>. Chạy lại không tạo trùng,
          không ghi đè dữ liệu đã sửa.
        </li>
        <li>
          Menu <strong>DTA Handover → Khóa sheet hệ thống</strong> để chỉ hệ thống được ghi vào các sheet dữ liệu.
        </li>
        <li>
          Menu <strong>DTA Handover → Kiểm tra cấu hình</strong>: mọi dòng phải là ✓ — đặc biệt dòng “Gửi email (MailApp)”. Đặt <code>NOTIFY_EMAILS</code> trong
          CAU_HINH nếu muốn nhận email thông báo.
        </li>
        <li>Deploy Worker (Cloudflare) phiên bản mới, rồi mở lại trang này để kiểm tra tất cả mục đều đạt.</li>
        <li>
          Vào <strong>Văn phòng phẩm → Dữ liệu cần kiểm tra</strong>: ghép / tạo mới / bỏ qua sản phẩm tồn đầu kỳ, kiểm kê các số lượng chưa rõ, gắn phòng ban
          với định mức.
        </li>
      </ol>
    </section>
  );
}
