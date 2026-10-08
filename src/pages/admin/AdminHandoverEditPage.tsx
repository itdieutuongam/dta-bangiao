import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { HANDOVER_TYPE_LABELS, isEditableStatus, STATUS_LABELS } from '../../../shared/constants';
import type { AdminHandoverDetail, AdminUpdateResponse, Employee, HandoverInput } from '../../../shared/types';
import { formItemFromItem, newUid, type HandoverFormValues } from '../../components/handover/formModel';
import { HandoverForm } from '../../components/handover/HandoverForm';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ErrorState, InlineAlert, LoadingCard } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { VppHandoverForm, type VppFormValues } from '../../components/vpp/VppHandoverForm';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminEmployees, adminGetHandover, adminUpdateHandover } from '../../services/adminApi';
import { errorMessage, isApiError, isStaleStateError } from '../../services/api';

function peopleOf(handover: AdminHandoverDetail, employees: Employee[]) {
  const find = (id: string) => employees.find((e) => e.employeeId === id) ?? null;
  const senderEmployee = handover.sender.employeeId
    ? (find(handover.sender.employeeId) ?? {
        employeeId: handover.sender.employeeId,
        fullName: handover.sender.name,
        department: '',
        position: '',
        email: '',
      })
    : null;
  const receiver = find(handover.receiver.employeeId) ?? {
    employeeId: handover.receiver.employeeId,
    fullName: handover.receiver.name,
    department: handover.receiver.department,
    position: handover.receiver.position,
    email: handover.receiver.email,
  };
  return { senderName: handover.sender.name, senderEmployee, receiver, note: handover.note };
}

function toFormValues(handover: AdminHandoverDetail, employees: Employee[]): HandoverFormValues {
  return { ...peopleOf(handover, employees), items: handover.items.map(formItemFromItem) };
}

function toVppValues(handover: AdminHandoverDetail, employees: Employee[]): VppFormValues {
  return {
    ...peopleOf(handover, employees),
    lines: handover.items
      .filter((item) => item.productId)
      .map((item) => ({
        uid: newUid(),
        productId: item.productId,
        quantity: item.quantity ?? 1,
        note: item.note,
        overNormReason: item.overNormReason ?? '',
      })),
  };
}

function savedMessage(result: AdminUpdateResponse): string {
  const base = result.linkRotated
    ? 'Đã lưu. Đã cấp link mới cho người nhận mới — hãy gửi lại link.'
    : 'Đã lưu. Người nhận mở lại link cũ để kiểm tra và ký xác nhận.';
  if (!result.warnings.length) return base;
  const names = result.warnings.map((w) => w.productName).join(', ');
  return `${base} Lưu ý tồn kho: ${names} sắp hết / đã hết khả dụng.`;
}

export default function AdminHandoverEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { handleError, refreshBadges } = useAdmin();
  const data = useAsync(async () => {
    const [detail, employees] = await Promise.all([adminGetHandover(id), adminEmployees()]);
    return { ...detail, employees };
  }, [id]);
  /** Phiếu đã bị thay đổi ở nơi khác trong lúc đang sửa (máy chủ từ chối lưu) — thông báo hiện ở đầu trang. */
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data.status === 'error' && isApiError(data.error) && data.error.status === 401) handleError(data.error);
  }, [data.status, data.error, handleError]);

  const handover = data.data?.handover;
  const isSupply = handover?.handoverType === 'OFFICE_SUPPLY';
  const initialValues = useMemo(
    () => (data.data && !isSupply ? toFormValues(data.data.handover, data.data.employees) : undefined),
    [data.data, isSupply],
  );
  const initialVppValues = useMemo(
    () => (data.data && isSupply ? toVppValues(data.data.handover, data.data.employees) : undefined),
    [data.data, isSupply],
  );

  useDocumentTitle(handover ? `Sửa ${handover.code}` : 'Sửa biên bản');

  /** expectedContentHash = mã nội dung của bản đang sửa: ai đó đã lưu bản khác trong lúc này → 409 CONFLICT, không ghi đè. */
  async function save(input: HandoverInput, expectedContentHash: string) {
    try {
      const result = await adminUpdateHandover(id, input, expectedContentHash);
      setStaleMessage(null);
      refreshBadges();
      toast.show(savedMessage(result), result.warnings.length ? 'info' : 'success');
      navigate(`/admin/ban-giao/${id}`);
    } catch (err) {
      if (isApiError(err) && err.status === 401) handleError(err);
      if (isStaleStateError(err)) {
        setStaleMessage(
          err.code === 'CONFLICT'
            ? 'Biên bản này vừa được người khác sửa và lưu trong lúc bạn đang chỉnh sửa. Thay đổi của bạn CHƯA được lưu.'
            : errorMessage(err, 'Biên bản vừa thay đổi trạng thái ở nơi khác. Thay đổi của bạn CHƯA được lưu.'),
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      // Ném lại để form giữ nguyên nội dung đang nhập và hiện lỗi cạnh nút lưu.
      throw err;
    }
  }

  function reloadLatest() {
    setStaleMessage(null);
    data.reload();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <Link
        to={`/admin/ban-giao/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Chi tiết biên bản
      </Link>

      {data.status === 'loading' && !data.data && (
        <div className="space-y-4">
          <LoadingCard lines={3} />
          <LoadingCard lines={6} />
        </div>
      )}
      {data.status === 'error' && !data.data && <ErrorState title="Không thể tải biên bản." error={data.error} onRetry={data.reload} />}

      {data.data && handover && (
        <>
          <div>
            <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">
              Sửa biên bản <span className="font-mono">{handover.code}</span>
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              {HANDOVER_TYPE_LABELS[handover.handoverType] ?? handover.handoverType} · Sau khi lưu, biên bản chuyển về “Chờ xác nhận”.
              Nếu đổi người nhận, hệ thống cấp link mới và link cũ hết hiệu lực.
              {isSupply ? ' Số lượng giữ chỗ trong kho được điều chỉnh theo phần chênh lệch.' : ''}
            </p>
          </div>
          {staleMessage && (
            <InlineAlert tone="warning">
              <p className="font-semibold">Biên bản đã thay đổi ở nơi khác</p>
              <p className="mt-1">{staleMessage}</p>
              <p className="mt-1">
                Bấm “Tải bản mới nhất” để xem nội dung hiện tại rồi sửa lại. Những gì bạn đang nhập trên trang này sẽ bị bỏ — hãy ghi
                lại trước nếu cần.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={reloadLatest} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Tải bản mới nhất
              </Button>
            </InlineAlert>
          )}
          {data.status === 'loading' && (
            <p className="text-sm text-stone-600" role="status">
              Đang tải bản mới nhất của biên bản…
            </p>
          )}
          {data.status === 'error' && (
            <InlineAlert>
              <p>Không tải được bản mới nhất của biên bản: {errorMessage(data.error)}</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={data.reload} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Thử lại
              </Button>
            </InlineAlert>
          )}
          {!isEditableStatus(handover.status) ? (
            <div className="space-y-4">
              <InlineAlert tone="warning">
                Biên bản ở trạng thái “{STATUS_LABELS[handover.status]}” nên không thể sửa. Chỉ sửa được biên bản đang chờ xác nhận
                hoặc yêu cầu chỉnh sửa.
              </InlineAlert>
              <ButtonLink to={`/admin/ban-giao/${id}`}>Quay lại chi tiết</ButtonLink>
            </div>
          ) : (
            <>
              {handover.status === 'REVISION_REQUESTED' && handover.receiverComment && (
                <InlineAlert tone="warning">
                  <p className="font-semibold">Yêu cầu chỉnh sửa của người nhận:</p>
                  <p className="mt-1 break-words whitespace-pre-wrap">{handover.receiverComment}</p>
                </InlineAlert>
              )}
              {/* key theo mã nội dung: tải được bản mới (người khác vừa sửa) → form điền lại theo bản đó. */}
              {isSupply && initialVppValues && (
                <VppHandoverForm
                  key={handover.contentHash}
                  employees={data.data.employees}
                  initialValues={initialVppValues}
                  handoverId={handover.id}
                  submitLabel="LƯU THAY ĐỔI"
                  submitIcon={<Save className="size-5" aria-hidden="true" />}
                  onCancel={() => navigate(`/admin/ban-giao/${id}`)}
                  onSubmit={(input) => save(input, handover.contentHash)}
                />
              )}
              {!isSupply && initialValues && handover.handoverType !== 'OFFICE_SUPPLY' && (
                <HandoverForm
                  key={handover.contentHash}
                  handoverType={handover.handoverType}
                  employees={data.data.employees}
                  categories={data.data.categories}
                  initialValues={initialValues}
                  submitLabel="LƯU THAY ĐỔI"
                  submitIcon={<Save className="size-5" aria-hidden="true" />}
                  onCancel={() => navigate(`/admin/ban-giao/${id}`)}
                  onSubmit={(input) => save(input, handover.contentHash)}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
