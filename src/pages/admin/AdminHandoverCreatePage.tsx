import { ArrowLeft, ExternalLink, FilePlus2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { HANDOVER_TYPE_LABELS, HANDOVER_TYPES, type HandoverType } from '../../../shared/constants';
import type { CreateHandoverResult, HandoverInput } from '../../../shared/types';
import { CreatedPanel } from '../../components/handover/CreatedPanel';
import { HandoverForm } from '../../components/handover/HandoverForm';
import { HandoverTypePicker } from '../../components/handover/HandoverTypePicker';
import { Button, ButtonLink } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingCard } from '../../components/ui/States';
import { VppHandoverForm } from '../../components/vpp/VppHandoverForm';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminCategories, adminCreateHandover, adminEmployees } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { newRequestId } from '../../utils/requestId';

function isHandoverType(value: string | null): value is HandoverType {
  return value !== null && (HANDOVER_TYPES as readonly string[]).includes(value);
}

/** REQUEST_REUSED (Handovers.gs): lần gửi trước mất phản hồi nhưng ĐÃ tạo phiếu với nội dung cũ — details.existing. */
function reusedHandover(error: unknown): { id: string; code: string } | null {
  if (!isApiError(error, 'REQUEST_REUSED')) return null;
  const existing = (error.details as { existing?: { id?: unknown; code?: unknown } } | undefined)?.existing;
  return typeof existing?.id === 'string' && typeof existing.code === 'string' ? { id: existing.id, code: existing.code } : null;
}

/** Tạo phiếu bàn giao — CHỈ quản trị viên. Chọn loại → form riêng của loại → link xác nhận gửi người nhận. */
export default function AdminHandoverCreatePage() {
  const { handleError, refreshBadges } = useAdmin();
  const [params, setParams] = useSearchParams();
  const preset = params.get('loai');
  const [type, setType] = useState<HandoverType | null>(isHandoverType(preset) ? preset : null);
  const [created, setCreated] = useState<CreateHandoverResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  // Một mã chống gửi trùng cho mỗi lần điền form: gửi lại (mạng chập chờn) không tạo phiếu thứ hai.
  const requestId = useRef(newRequestId());
  const catalog = useAsync(async () => {
    const [employees, categories] = await Promise.all([adminEmployees(), adminCategories()]);
    return { employees, categories };
  }, []);

  useEffect(() => {
    if (catalog.status === 'error' && isApiError(catalog.error) && catalog.error.status === 401) handleError(catalog.error);
  }, [catalog.status, catalog.error, handleError]);

  useDocumentTitle(created ? `Đã tạo ${created.code}` : type ? `Tạo phiếu ${HANDOVER_TYPE_LABELS[type]}` : 'Tạo phiếu bàn giao');

  function chooseType(next: HandoverType | null) {
    setType(next);
    setFormKey((k) => k + 1);
    requestId.current = newRequestId();
    setParams(next ? { loai: next } : {}, { replace: true });
    window.scrollTo({ top: 0 });
  }

  async function submit(input: HandoverInput) {
    try {
      const result = await adminCreateHandover({ ...input, clientRequestId: requestId.current });
      requestId.current = newRequestId();
      setCreated(result);
      refreshBadges();
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (isApiError(err) && err.status === 401) handleError(err);
      throw err;
    }
  }

  // Nội dung vừa sửa CHƯA được lưu: mở phiếu đã tạo để sửa / hủy (tab mới — giữ nguyên form đang nhập), hoặc chủ động tạo phiếu
  // mới (mã thao tác mới; phiếu cũ vẫn còn, cần hủy riêng).
  function reusedActions(error: unknown, clear: () => void) {
    const existing = reusedHandover(error);
    if (!existing) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <ButtonLink
          to={`/admin/ban-giao/${encodeURIComponent(existing.id)}`}
          target="_blank"
          rel="noopener"
          size="sm"
          icon={<ExternalLink className="size-4" aria-hidden="true" />}
        >
          Mở phiếu {existing.code}
        </ButtonLink>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            requestId.current = newRequestId();
            clear();
          }}
        >
          Tạo thêm phiếu mới với nội dung đang nhập
        </Button>
      </div>
    );
  }

  if (created) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <CreatedPanel
          result={created}
          onCreateNew={() => {
            setCreated(null);
            chooseType(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <PageHeader
        title={type ? `Tạo phiếu: ${HANDOVER_TYPE_LABELS[type]}` : 'Tạo phiếu bàn giao'}
        description={
          type
            ? 'Bước 2 — Chọn người nhận, nhập nội dung, kiểm tra rồi bấm TẠO PHIẾU để lấy link xác nhận gửi người nhận.'
            : 'Chọn loại phiếu, chọn người nhận, nhập nội dung, kiểm tra rồi tạo phiếu để lấy link xác nhận.'
        }
        actions={
          type ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="size-4" aria-hidden="true" />}
              onClick={() => {
                if (window.confirm('Đổi loại phiếu? Nội dung đang nhập sẽ bị bỏ.')) chooseType(null);
              }}
            >
              Đổi loại phiếu
            </Button>
          ) : undefined
        }
      />

      {!type && <HandoverTypePicker onSelect={chooseType} />}

      {type && catalog.status === 'loading' && !catalog.data && (
        <div className="space-y-4">
          <LoadingCard lines={3} label="Đang tải danh sách nhân viên…" />
          <LoadingCard lines={5} />
        </div>
      )}
      {type && catalog.status === 'error' && !catalog.data && (
        <ErrorState title="Không thể tải danh sách nhân viên." error={catalog.error} onRetry={catalog.reload} />
      )}

      {type && catalog.data && type === 'OFFICE_SUPPLY' && (
        <VppHandoverForm
          key={formKey}
          employees={catalog.data.employees}
          submitLabel="TẠO PHIẾU"
          submitIcon={<FilePlus2 className="size-5" aria-hidden="true" />}
          onSubmit={submit}
          submitErrorActions={reusedActions}
        />
      )}
      {type && catalog.data && type !== 'OFFICE_SUPPLY' && (
        <HandoverForm
          key={formKey}
          handoverType={type}
          employees={catalog.data.employees}
          categories={catalog.data.categories}
          submitLabel="TẠO PHIẾU"
          submitIcon={<FilePlus2 className="size-5" aria-hidden="true" />}
          onSubmit={submit}
          submitErrorActions={reusedActions}
        />
      )}
    </div>
  );
}
