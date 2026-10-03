import { CircleCheck, Eye, FilePlus2, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CreateHandoverResult } from '../../shared/types';
import { CopyField } from '../components/CopyField';
import { HandoverForm } from '../components/handover/HandoverForm';
import { QrCode } from '../components/QrCode';
import { StaffGate } from '../components/StaffGate';
import { Button, buttonClasses } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/States';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/usePageMeta';
import { isApiError } from '../services/api';
import { createHandover, getCategories, getEmployees } from '../services/handoverApi';

export default function CreateHandoverPage() {
  const catalog = useAsync(async () => {
    const [employees, categories] = await Promise.all([getEmployees(), getCategories()]);
    return { employees, categories };
  }, []);
  const [created, setCreated] = useState<CreateHandoverResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  useDocumentTitle(created ? `Đã tạo ${created.code}` : 'Tạo biên bản bàn giao');

  if (created) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <CreatedPanel
          result={created}
          onCreateNew={() => {
            setCreated(null);
            setFormKey((k) => k + 1);
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );
  }

  const staffRequired = catalog.status === 'error' && isApiError(catalog.error, 'STAFF_AUTH_REQUIRED');

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      {!staffRequired && (
        <div className="mb-5">
          <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">Tạo biên bản bàn giao</h1>
          <p className="mt-1 text-sm text-stone-600">
            Chọn người nhận, thêm các nội dung bàn giao rồi nhấn <strong>TẠO BÀN GIAO</strong> để lấy link gửi người nhận
            ký xác nhận.
          </p>
        </div>
      )}

      {catalog.status === 'loading' && (
        <div className="space-y-4">
          <LoadingCard lines={3} label="Đang tải danh sách nhân viên…" />
          <LoadingCard lines={5} />
        </div>
      )}

      {catalog.status === 'error' &&
        (staffRequired ? (
          <StaffGate onSuccess={catalog.reload} />
        ) : (
          <ErrorState title="Không thể tải danh sách nhân viên." error={catalog.error} onRetry={catalog.reload} />
        ))}

      {catalog.status === 'success' &&
        (catalog.data.employees.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Chưa có nhân viên nào trong hệ thống"
              description="Quản trị viên cần nhập danh sách nhân viên vào sheet NHAN_VIEN (trạng thái ACTIVE) rồi tải lại trang."
              action={
                <Button variant="secondary" onClick={catalog.reload}>
                  Tải lại
                </Button>
              }
            />
          </div>
        ) : (
          <HandoverForm
            key={formKey}
            employees={catalog.data.employees}
            categories={catalog.data.categories}
            submitLabel="TẠO BÀN GIAO"
            submitIcon={<FilePlus2 className="size-5" aria-hidden="true" />}
            onSubmit={async (input) => {
              const result = await createHandover(input);
              setCreated(result);
              window.scrollTo({ top: 0 });
            }}
          />
        ))}
    </div>
  );
}

function CreatedPanel({ result, onCreateNew }: { result: CreateHandoverResult; onCreateNew: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const receiver = result.receiver;
  const mailto = receiver.email
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
        <p className="mt-1 text-sm text-emerald-800">Gửi link bên dưới cho người nhận để kiểm tra và ký xác nhận.</p>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Mã</dt>
            <dd className="mt-1 font-mono text-lg font-bold text-brand-900">{result.code}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Người nhận</dt>
            <dd className="mt-1 font-semibold text-stone-900">{receiver.name}</dd>
            <dd className="text-sm text-stone-600">
              {[receiver.employeeId, receiver.department].filter(Boolean).join(' · ')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Trạng thái</dt>
            <dd className="mt-1.5">
              <StatusBadge status={result.status} />
            </dd>
          </div>
        </dl>

        <CopyField value={result.link} label="Link xác nhận" />

        <div className="flex flex-col items-center gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:flex-row">
          <QrCode value={result.link} label={`Mã QR mở link xác nhận ${result.code}`} />
          <p className="text-sm text-stone-600">
            Bàn giao trực tiếp? Người nhận có thể <strong>quét mã QR</strong> bằng camera điện thoại để mở biên bản và ký xác
            nhận ngay.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={result.link} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'md')}>
            <Eye className="size-4" aria-hidden="true" />
            XEM BIÊN BẢN
          </a>
          {mailto && (
            <a href={mailto} className={buttonClasses('secondary', 'md')}>
              <Mail className="size-4" aria-hidden="true" />
              GỬI QUA EMAIL
            </a>
          )}
          <Button onClick={onCreateNew} icon={<FilePlus2 className="size-4" aria-hidden="true" />} className="sm:ml-auto">
            TẠO BÀN GIAO MỚI
          </Button>
        </div>
      </div>
    </section>
  );
}
