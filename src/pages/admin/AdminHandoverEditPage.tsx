import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isEditableStatus, STATUS_LABELS } from '../../../shared/constants';
import type { AdminHandoverDetail, Employee } from '../../../shared/types';
import { formItemFromItem, type HandoverFormValues } from '../../components/handover/formModel';
import { HandoverForm } from '../../components/handover/HandoverForm';
import { ButtonLink } from '../../components/ui/Button';
import { ErrorState, InlineAlert, LoadingCard } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/usePageMeta';
import { useAdmin } from '../../layouts/adminContext';
import { adminGetHandover, adminUpdateHandover } from '../../services/adminApi';
import { isApiError } from '../../services/api';
import { getEmployees } from '../../services/handoverApi';

function toFormValues(handover: AdminHandoverDetail, employees: Employee[]): HandoverFormValues {
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
  return {
    senderName: handover.sender.name,
    senderEmployee,
    receiver,
    note: handover.note,
    items: handover.items.map(formItemFromItem),
  };
}

export default function AdminHandoverEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { handleError } = useAdmin();
  const data = useAsync(async () => {
    const [detail, employees] = await Promise.all([adminGetHandover(id), getEmployees()]);
    return { ...detail, employees };
  }, [id]);

  useEffect(() => {
    if (data.status === 'error' && isApiError(data.error) && data.error.status === 401) handleError(data.error);
  }, [data.status, data.error, handleError]);

  const initialValues = useMemo(
    () => (data.data ? toFormValues(data.data.handover, data.data.employees) : undefined),
    [data.data],
  );

  useDocumentTitle(data.data ? `Sửa ${data.data.handover.code}` : 'Sửa biên bản');

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <Link
        to={`/admin/ban-giao/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Chi tiết biên bản
      </Link>

      {data.status === 'loading' && (
        <div className="space-y-4">
          <LoadingCard lines={3} />
          <LoadingCard lines={6} />
        </div>
      )}
      {data.status === 'error' && <ErrorState title="Không thể tải biên bản." error={data.error} onRetry={data.reload} />}

      {data.status === 'success' && initialValues && (
        <>
          <div>
            <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">
              Sửa biên bản <span className="font-mono">{data.data.handover.code}</span>
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Sau khi lưu, biên bản chuyển về “Chờ xác nhận”. Nếu đổi người nhận, hệ thống cấp link mới và link cũ hết hiệu lực.
            </p>
          </div>
          {!isEditableStatus(data.data.handover.status) ? (
            <div className="space-y-4">
              <InlineAlert tone="warning">
                Biên bản ở trạng thái “{STATUS_LABELS[data.data.handover.status]}” nên không thể sửa. Chỉ sửa được biên bản
                đang chờ xác nhận hoặc yêu cầu chỉnh sửa.
              </InlineAlert>
              <ButtonLink to={`/admin/ban-giao/${id}`}>Quay lại chi tiết</ButtonLink>
            </div>
          ) : (
            <>
              {data.data.handover.status === 'REVISION_REQUESTED' && data.data.handover.receiverComment && (
                <InlineAlert tone="warning">
                  <p className="font-semibold">Yêu cầu chỉnh sửa của người nhận:</p>
                  <p className="mt-1 break-words whitespace-pre-wrap">{data.data.handover.receiverComment}</p>
                </InlineAlert>
              )}
              <HandoverForm
                employees={data.data.employees}
                categories={data.data.categories}
                initialValues={initialValues}
                submitLabel="LƯU THAY ĐỔI"
                submitIcon={<Save className="size-5" aria-hidden="true" />}
                onCancel={() => navigate(`/admin/ban-giao/${id}`)}
                onSubmit={async (input) => {
                  try {
                    const result = await adminUpdateHandover(id, input);
                    toast.show(
                      result.linkRotated
                        ? 'Đã lưu. Đã cấp link mới cho người nhận mới — hãy gửi lại link.'
                        : 'Đã lưu. Người nhận mở lại link cũ để kiểm tra và ký xác nhận.',
                    );
                    navigate(`/admin/ban-giao/${id}`);
                  } catch (err) {
                    if (isApiError(err) && err.status === 401) handleError(err);
                    throw err;
                  }
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
