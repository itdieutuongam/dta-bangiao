import { CalendarDays, PackagePlus, Shirt, Trash2, TriangleAlert, UserRoundPen } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import { handoverInputSchema, toFieldErrors } from '../../../shared/schemas';
import type { Employee, HandoverInput } from '../../../shared/types';
import {
  ISSUE_KIND_LABELS,
  ISSUE_KINDS,
  UNIFORM_CONDITION_LABELS,
  uniformSkuLabel,
  type IssueKind,
  type UniformCondition,
  type UniformHandoverContext,
  type UniformHandoverContextModel,
  type UniformHandoverContextSku,
} from '../../../shared/uniform';
import { useAsync } from '../../hooks/useAsync';
import { useUnsavedChangesWarning } from '../../hooks/usePageMeta';
import { ApiClientError, errorMessage, isApiError } from '../../services/api';
import { uniformHandoverContext } from '../../services/uniformApi';
import { cn } from '../../utils/cn';
import { formatDate, todayIsoDate } from '../../utils/format';
import { EmployeeCombobox } from '../EmployeeCombobox';
import { newUid } from '../handover/formModel';
import { Button } from '../ui/Button';
import { describedBy, Field } from '../ui/Field';
import { ErrorState, InlineAlert, Skeleton } from '../ui/States';
import { Qty } from '../vpp/Badges';
import { QuantityStepper } from '../vpp/QuantityStepper';
import { genderLabel, KindBadge, QuotaSummary } from './UniformBadges';
import { ProfileDialog } from './UniformDialogs';

export interface UniformFormLine {
  uid: string;
  /** Mặt hàng (mẫu × size × tình trạng) — khóa của dòng. */
  productId: string;
  quantity: number;
  issueKind: IssueKind;
  dueDate: string;
  note: string;
  overQuotaReason: string;
}

export interface UniformFormValues {
  senderName: string;
  senderEmployee: Employee | null;
  receiver: Employee | null;
  note: string;
  lines: UniformFormLine[];
}

type LineErrors = Partial<Record<'productId' | 'quantity' | 'overQuotaReason' | 'note' | 'dueDate' | 'issueKind', string>>;

interface Props {
  employees: Employee[];
  initialValues?: UniformFormValues;
  /** Khi sửa phiếu: số đang giữ chỗ cho chính phiếu này được tính vào khả dụng; tiêu chuẩn năm không tính chính phiếu này. */
  handoverId?: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  onSubmit: (input: HandoverInput) => Promise<void>;
  onCancel?: () => void;
  submitErrorActions?: (error: unknown, clear: () => void) => ReactNode;
}

function plusDays(days: number): string {
  const [y, m, d] = todayIsoDate().split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

export function newUniformLine(productId: string, quantity = 1): UniformFormLine {
  return { uid: newUid(), productId, quantity, issueKind: 'CAP_PHAT', dueDate: '', note: '', overQuotaReason: '' };
}

interface SkuRef {
  model: UniformHandoverContextModel;
  sku: UniformHandoverContextSku;
}

/** Dự báo vượt tiêu chuẩn năm (tổng + theo mẫu) của các dòng Cấp phát — máy chủ kiểm tra lại khi lưu. */
function quotaForecast(context: UniformHandoverContext | undefined, lines: UniformFormLine[], index: Map<string, SkuRef>) {
  const overByUid = new Map<string, string>();
  if (!context?.usage) return overByUid;
  const quotaLines = lines.filter((l) => {
    const ref = index.get(l.productId);
    return l.issueKind === 'CAP_PHAT' && ref?.model.countsTowardQuota && Number.isFinite(l.quantity);
  });
  const usage = context.usage;
  if (usage.yearlyQuota !== null) {
    const total = quotaLines.reduce((s, l) => s + l.quantity, 0);
    const over = usage.issued + usage.pending + usage.legacy + total - usage.yearlyQuota;
    if (over > 0) {
      for (const l of quotaLines) {
        overByUid.set(l.uid, `Vượt tiêu chuẩn năm ${over} (tiêu chuẩn ${usage.yearlyQuota}/năm, đã cấp ${usage.issued + usage.legacy}${usage.pending ? `, chờ ký ${usage.pending}` : ''}).`);
      }
    }
  }
  for (const mq of context.modelQuotas) {
    const mine = quotaLines.filter((l) => index.get(l.productId)?.model.modelId === mq.modelId);
    const add = mine.reduce((s, l) => s + l.quantity, 0);
    const over = mq.issued + mq.pending + add - mq.yearlyQuota;
    if (over > 0) {
      for (const l of mine) if (!overByUid.has(l.uid)) overByUid.set(l.uid, `Vượt tiêu chuẩn mẫu “${mq.modelName}” ${over} (tiêu chuẩn ${mq.yearlyQuota}/năm).`);
    }
  }
  return overByUid;
}

export function UniformHandoverForm({ employees, initialValues, handoverId, submitLabel, submitIcon, onSubmit, onCancel, submitErrorActions }: Props) {
  const [values, setValues] = useState<UniformFormValues>(
    () => initialValues ?? { senderName: '', senderEmployee: null, receiver: null, note: '', lines: [] },
  );
  const [general, setGeneral] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAllGenders, setShowAllGenders] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  useUnsavedChangesWarning(dirty && !submitting);

  const receiverId = values.receiver?.employeeId ?? '';
  const context = useAsync((signal) => uniformHandoverContext(receiverId, handoverId ?? '', signal), [receiverId, handoverId]);
  const models = useMemo(() => context.data?.models ?? [], [context.data]);
  const index = useMemo(() => {
    const map = new Map<string, SkuRef>();
    for (const model of models) for (const sku of model.skus) map.set(sku.productId, { model, sku });
    return map;
  }, [models]);
  const receiverInfo = context.data?.receiver ?? null;
  const gender = receiverInfo?.gender ?? '';
  // Thứ tự: mẫu gợi ý theo tiêu chuẩn của nhóm → đồng phục (tính tiêu chuẩn) → bảo hộ lao động / khác; cùng nhóm giữ thứ tự tên.
  const rank = (m: (typeof models)[number]) => (m.suggested ? 0 : m.countsTowardQuota ? 1 : 2);
  const visibleModels = models
    .filter((m) => showAllGenders || !gender || m.gender === 'UNISEX' || m.gender === gender || m.suggested)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);
  const hiddenCount = models.length - visibleModels.length;
  const forecast = quotaForecast(context.data, values.lines, index);

  // Tổng yêu cầu theo mặt hàng (cấp phát + cho mượn cùng size dùng chung tồn).
  const requestedBySku = new Map<string, number>();
  for (const l of values.lines) if (Number.isFinite(l.quantity)) requestedBySku.set(l.productId, (requestedBySku.get(l.productId) ?? 0) + l.quantity);

  function patch(next: Partial<UniformFormValues>) {
    setValues((v) => ({ ...v, ...next }));
    setDirty(true);
  }

  function updateLine(uid: string, next: Partial<UniformFormLine>) {
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.uid === uid ? { ...l, ...next } : l)) }));
    setLineErrors((e) => {
      if (!e[uid]) return e;
      const copy = { ...e };
      delete copy[uid];
      return copy;
    });
    setDirty(true);
  }

  function addModel(model: UniformHandoverContextModel, size?: string) {
    const preferred = size ?? (receiverInfo?.uniformSize && model.sizes.includes(receiverInfo.uniformSize) ? receiverInfo.uniformSize : model.sizes[0]);
    const sku =
      model.skus.find((s) => s.size === preferred && s.condition === 'NEW') ??
      model.skus.find((s) => s.size === preferred) ??
      model.skus.find((s) => s.condition === 'NEW') ??
      model.skus[0];
    if (!sku) return;
    patch({ lines: [...values.lines, newUniformLine(sku.productId, 1)] });
    setGeneral((g) => {
      const copy = { ...g };
      delete copy.uniforms;
      return copy;
    });
  }

  /** Đổi size / tình trạng của dòng → mặt hàng tương ứng của cùng mẫu. */
  function changeSku(line: UniformFormLine, size: string, condition: UniformCondition) {
    const ref = index.get(line.productId);
    if (!ref) return;
    const next = ref.model.skus.find((s) => s.size === size && s.condition === condition) ?? ref.model.skus.find((s) => s.size === size);
    if (next) updateLine(line.uid, { productId: next.productId });
  }

  function buildInput(): HandoverInput {
    return {
      handoverType: 'UNIFORM',
      sender: values.senderEmployee
        ? { name: values.senderEmployee.fullName, employeeId: values.senderEmployee.employeeId }
        : { name: values.senderName, employeeId: '' },
      receiverEmployeeId: values.receiver?.employeeId ?? '',
      note: values.note,
      items: [],
      supplies: [],
      uniforms: values.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        issueKind: l.issueKind,
        dueDate: l.issueKind === 'CHO_MUON' ? l.dueDate : '',
        note: l.note,
        overQuotaReason: l.overQuotaReason,
      })),
    };
  }

  function applyErrors(fieldErrors: Record<string, string>) {
    const nextGeneral: Record<string, string> = {};
    const nextLines: Record<string, LineErrors> = {};
    for (const [path, message] of Object.entries(fieldErrors)) {
      const m = /^uniforms\.(\d+)\.(\w+)$/.exec(path);
      const line = m ? values.lines[Number(m[1])] : undefined;
      if (m && line) (nextLines[line.uid] ??= {})[m[2] as keyof LineErrors] = message;
      else nextGeneral[path] = message;
    }
    setGeneral(nextGeneral);
    setLineErrors(nextLines);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    const input = buildInput();
    const parsed = handoverInputSchema.safeParse(input);
    const fieldErrors: Record<string, string> = parsed.success ? {} : toFieldErrors(parsed.error);
    if (!values.receiver) fieldErrors.receiverEmployeeId ??= 'Chọn người nhận từ danh sách nhân viên';
    values.lines.forEach((line, i) => {
      const ref = index.get(line.productId);
      if (context.data && !ref) {
        fieldErrors[`uniforms.${i}.productId`] ??= 'Mẫu / size không còn dùng được — xóa dòng này và chọn lại.';
        return;
      }
      if (ref) {
        const available = ref.sku.stock.available;
        const requested = requestedBySku.get(line.productId) ?? 0;
        if (available === null) fieldErrors[`uniforms.${i}.quantity`] ??= 'Tồn kho chưa xác định — cần kiểm kê trước khi bàn giao.';
        else if (requested > available) {
          fieldErrors[`uniforms.${i}.quantity`] ??= `Không đủ tồn kho. Khả dụng: ${available}, yêu cầu: ${requested}, thiếu: ${requested - available}.`;
        }
      }
      if (forecast.has(line.uid) && !line.overQuotaReason.trim()) {
        fieldErrors[`uniforms.${i}.overQuotaReason`] ??= `${forecast.get(line.uid)} Nhập lý do vượt tiêu chuẩn.`;
      }
    });
    if (Object.keys(fieldErrors).length) {
      applyErrors(fieldErrors);
      document.getElementById(fieldErrors.receiverEmployeeId ? 'receiver' : fieldErrors['sender.name'] ? 'sender-name' : 'dp-lines')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.success ? parsed.data : input);
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) applyErrors(err.fieldErrors);
      if (isApiError(err, 'INSUFFICIENT_STOCK') || isApiError(err, 'NORM_EXCEEDED')) context.reload();
      setSubmitError(errorMessage(err, 'Không thể lưu phiếu. Vui lòng thử lại.'));
      setSubmitFailure(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <section className="card p-4 sm:p-6" aria-labelledby="dp-people">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dp-people" className="section-title">
            Thông tin bàn giao
          </h2>
          <span className="inline-flex items-center gap-1.5 text-sm text-stone-600">
            <CalendarDays className="size-4" aria-hidden="true" />
            Ngày lập phiếu: <strong>{formatDate(todayIsoDate())}</strong>
          </span>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <EmployeeCombobox
            id="sender-name"
            label="Người bàn giao"
            employees={employees}
            selected={values.senderEmployee}
            onSelect={(employee) => {
              patch({ senderEmployee: employee });
              setGeneral((g) => ({ ...g, 'sender.name': '', receiverEmployeeId: '' }));
            }}
            freeText={{ value: values.senderName, onChange: (value) => patch({ senderName: value }) }}
            excludeEmployeeId={values.receiver?.employeeId}
            required
            error={general['sender.name'] || general['sender.employeeId'] || undefined}
            hint="Chọn từ danh sách hoặc nhập họ tên người bàn giao (thường là P.HCNS)."
            placeholder="Nhập tên hoặc tìm nhân viên…"
          />
          <div className="space-y-2">
            <EmployeeCombobox
              id="receiver"
              label="Người nhận"
              employees={employees}
              selected={values.receiver}
              onSelect={(employee) => {
                patch({ receiver: employee });
                setGeneral((g) => ({ ...g, receiverEmployeeId: '' }));
              }}
              excludeEmployeeId={values.senderEmployee?.employeeId}
              required
              error={general.receiverEmployeeId || undefined}
              hint="Bắt buộc chọn từ danh sách nhân viên."
            />
            {values.receiver && context.status === 'loading' && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600" role="status">
                Đang tải tiêu chuẩn và tồn kho cho người nhận này…
              </p>
            )}
            {context.status === 'error' && context.data && (
              <InlineAlert>
                <p>Không tải được số liệu mới nhất — máy chủ vẫn kiểm tra lại khi lưu. {errorMessage(context.error)}</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={context.reload}>
                  Thử lại
                </Button>
              </InlineAlert>
            )}
            {values.receiver && context.status === 'success' && receiverInfo && (
              <div className="space-y-1 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    Giới tính: <strong>{genderLabel(receiverInfo.gender)}</strong> · Size: <strong>{receiverInfo.uniformSize || 'chưa có'}</strong>
                  </span>
                  <button type="button" className="inline-flex items-center gap-1 font-semibold underline" onClick={() => setProfileOpen(true)}>
                    <UserRoundPen className="size-3.5" aria-hidden="true" />
                    {receiverInfo.uniformSize && receiverInfo.gender ? 'Sửa' : 'Cập nhật'}
                  </button>
                </p>
                <p>
                  Nhóm tiêu chuẩn: <strong>{context.data.scope?.scopeName ?? 'mặc định công ty'}</strong> · năm {context.data.year}
                </p>
                <QuotaSummary usage={context.data.usage} />
                {context.data.modelQuotas.map((mq) => (
                  <p key={mq.modelId}>
                    · {mq.modelName}: {mq.issued}/{mq.yearlyQuota}
                    {mq.pending ? ` (chờ ký ${mq.pending})` : ''} — còn {mq.remaining}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="dp-picker">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dp-picker" className="section-title">
            Chọn mẫu & size
          </h2>
          {gender && (hiddenCount > 0 || showAllGenders) && (
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" className="size-4 accent-brand-700" checked={showAllGenders} onChange={(e) => setShowAllGenders(e.target.checked)} />
              Hiện cả mẫu dành cho {gender === 'NAM' ? 'nữ' : 'nam'} ({hiddenCount})
            </label>
          )}
        </div>
        <p className="mt-1 text-sm text-stone-500">
          Bấm vào size để thêm vào phiếu. Số trên mỗi size là <strong>khả dụng (hàng mới)</strong>. Khi tạo phiếu, số lượng được giữ chỗ; trừ tồn khi người
          nhận ký.
        </p>
        <div className="mt-3 space-y-2" aria-busy={context.status === 'loading'}>
          {context.status === 'loading' && !context.data && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          {context.status === 'error' && !context.data && (
            <ErrorState className="border-0 shadow-none" title="Không tải được danh mục đồng phục." error={context.error} onRetry={context.reload} />
          )}
          {context.data && models.length === 0 && (
            <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
              Chưa có mẫu đồng phục nào.{' '}
              <Link to="/admin/dong-phuc/ton-kho" className="font-semibold text-brand-700 underline">
                Thêm mẫu / nhập kho
              </Link>
            </p>
          )}
          {visibleModels.map((model) => (
            <div key={model.modelId} className={cn('rounded-lg border p-3', model.suggested ? 'border-brand-300 bg-brand-50/40' : 'border-stone-200')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
                  <Shirt className="size-4 text-brand-700" aria-hidden="true" />
                  {model.modelName}
                  <span className="text-xs font-normal text-stone-500">
                    {genderLabel(model.gender)}
                    {model.countsTowardQuota ? '' : ' · không tính tiêu chuẩn'}
                  </span>
                  <KindBadge kind={model.kind} />
                  {model.suggested && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">Gợi ý cho nhóm</span>}
                </p>
                <span className="text-xs text-stone-500">{model.appliesTo}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {model.sizes.map((size) => {
                  const sku = model.skus.find((s) => s.size === size && s.condition === 'NEW');
                  const used = model.skus.find((s) => s.size === size && s.condition === 'USED');
                  const avail = sku?.stock.available ?? 0;
                  const usedAvail = used?.stock.available ?? 0;
                  const empty = avail <= 0 && usedAvail <= 0;
                  const isReceiverSize = receiverInfo?.uniformSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={empty}
                      onClick={() => addModel(model, size)}
                      className={cn(
                        'min-w-14 rounded-lg border px-2.5 py-1 text-center text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                        isReceiverSize ? 'border-brand-500 ring-1 ring-brand-300' : 'border-stone-300',
                        empty ? 'bg-stone-50' : 'bg-white hover:bg-brand-50',
                      )}
                      aria-label={`Thêm ${model.modelName} size ${size}: khả dụng ${avail}${usedAvail ? `, đã qua sử dụng ${usedAvail}` : ''}`}
                    >
                      <span className="block font-bold">{size}</span>
                      <span className={cn('block text-[11px] tabular-nums', avail <= 0 ? 'text-red-700' : 'text-stone-600')}>
                        {avail}
                        {usedAvail ? ` +${usedAvail} cũ` : ''}
                      </span>
                    </button>
                  );
                })}
                <Button size="sm" variant="ghost" onClick={() => addModel(model)} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
                  Thêm
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="dp-lines" className="card p-4 sm:p-6" aria-labelledby="dp-lines-title">
        <h2 id="dp-lines-title" className="section-title flex items-center gap-2">
          Đồng phục bàn giao
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-800">{values.lines.length}</span>
        </h2>
        {general.uniforms && <InlineAlert className="mt-3">{general.uniforms}</InlineAlert>}
        {values.lines.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
            Chưa chọn đồng phục nào — bấm vào size ở trên.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {values.lines.map((line, i) => {
              const ref = index.get(line.productId);
              const errs = lineErrors[line.uid] ?? {};
              const qtyId = `dp-${line.uid}-qty`;
              const available = ref?.sku.stock.available ?? null;
              const requested = requestedBySku.get(line.productId) ?? 0;
              const insufficient = ref ? available === null || requested > available : false;
              const overText = forecast.get(line.uid);
              const conditions = ref ? (['NEW', 'USED'] as const).filter((c) => ref.model.skus.some((s) => s.size === ref.sku.size && s.condition === c)) : [];
              return (
                <li key={line.uid} className={cn('rounded-xl border bg-white p-4', Object.keys(errs).length ? 'border-red-300' : 'border-stone-200')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-brand-700">#{i + 1}</p>
                      <p className="font-semibold break-words text-stone-900">
                        {ref ? uniformSkuLabel(ref.model.modelName, ref.sku.size, ref.sku.condition) : context.data ? 'Mẫu / size không còn dùng được' : 'Đang tải…'}
                      </p>
                      {ref && <p className="font-mono text-xs text-stone-500">{ref.sku.skuCode}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-700"
                      onClick={() => patch({ lines: values.lines.filter((l) => l.uid !== line.uid) })}
                      aria-label={`Xóa dòng ${i + 1}`}
                      icon={<Trash2 className="size-4" aria-hidden="true" />}
                    />
                  </div>
                  {ref && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field id={`dp-${line.uid}-size`} label="Size">
                        <select
                          id={`dp-${line.uid}-size`}
                          className="field-input"
                          value={ref.sku.size}
                          onChange={(e) => changeSku(line, e.target.value, ref.sku.condition)}
                        >
                          {ref.model.sizes.map((s) => {
                            const option = ref.model.skus.find((x) => x.size === s && x.condition === ref.sku.condition);
                            return (
                              <option key={s} value={s}>
                                {s} (khả dụng {option?.stock.available ?? 0})
                              </option>
                            );
                          })}
                        </select>
                      </Field>
                      <Field id={`dp-${line.uid}-cond`} label="Tình trạng">
                        <select
                          id={`dp-${line.uid}-cond`}
                          className="field-input"
                          value={ref.sku.condition}
                          disabled={conditions.length < 2}
                          onChange={(e) => changeSku(line, ref.sku.size, e.target.value as UniformCondition)}
                        >
                          {conditions.map((c) => (
                            <option key={c} value={c}>
                              {UNIFORM_CONDITION_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={qtyId} className="text-sm font-medium text-stone-800">
                          Số lượng
                        </label>
                        <div className="flex items-center gap-2">
                          <QuantityStepper
                            id={qtyId}
                            label={`số lượng ${ref.model.modelName}`}
                            value={line.quantity}
                            min={1}
                            max={LIMITS.maxQuantity}
                            invalid={Boolean(errs.quantity) || insufficient}
                            describedBy={errs.quantity || insufficient ? `${qtyId}-error` : undefined}
                            onChange={(quantity) => updateLine(line.uid, { quantity })}
                          />
                          <span className="text-sm text-stone-500">{ref.model.unit}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {ref && (
                    <p className="mt-2 text-xs text-stone-600">
                      Tồn: <Qty value={ref.sku.stock.onHand} /> · Đang giữ (phiếu khác): {Math.max(0, ref.sku.stock.reserved - ref.sku.reservedByThisHandover)} ·
                      Khả dụng: <strong><Qty value={available} /></strong>
                    </p>
                  )}
                  {(insufficient || errs.quantity) && (
                    <p id={`${qtyId}-error`} className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">
                      {errs.quantity ?? `Không đủ tồn kho. Khả dụng: ${available ?? 'chưa rõ'}, yêu cầu: ${requested}.`}{' '}
                      <Link to="/admin/dong-phuc/ton-kho" className="underline">
                        Nhập kho
                      </Link>
                    </p>
                  )}
                  {errs.productId && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">
                      {errs.productId}
                    </p>
                  )}
                  <fieldset className="mt-3">
                    <legend className="text-sm font-medium text-stone-800">Hình thức</legend>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {ISSUE_KINDS.map((kind) => (
                        <label
                          key={kind}
                          className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                        >
                          <input
                            type="radio"
                            name={`dp-${line.uid}-kind`}
                            className="accent-brand-700"
                            checked={line.issueKind === kind}
                            onChange={() => updateLine(line.uid, { issueKind: kind, dueDate: kind === 'CHO_MUON' ? line.dueDate || plusDays(7) : '' })}
                          />
                          {ISSUE_KIND_LABELS[kind]}
                        </label>
                      ))}
                      {line.issueKind === 'CHO_MUON' && (
                        <span className="flex items-center gap-2">
                          <label htmlFor={`dp-${line.uid}-due`} className="text-sm text-stone-700">
                            Hạn trả
                          </label>
                          <input
                            id={`dp-${line.uid}-due`}
                            type="date"
                            className="field-input w-auto py-1"
                            value={line.dueDate}
                            min={todayIsoDate()}
                            aria-invalid={errs.dueDate ? true : undefined}
                            onChange={(e) => updateLine(line.uid, { dueDate: e.target.value })}
                          />
                        </span>
                      )}
                    </div>
                    {errs.dueDate && <p className="mt-1 text-xs font-medium text-red-700">{errs.dueDate}</p>}
                    <p className="mt-1 text-xs text-stone-500">
                      {line.issueKind === 'CAP_PHAT'
                        ? ref?.model.countsTowardQuota
                          ? 'Cấp phát: tính vào tiêu chuẩn năm của người nhận.'
                          : 'Cấp phát: mẫu này không tính tiêu chuẩn năm.'
                        : 'Cho mượn: không tính tiêu chuẩn; phải trả trước hạn (theo dõi ở trang Mượn / Trả).'}
                    </p>
                  </fieldset>
                  {(overText || errs.overQuotaReason || line.overQuotaReason.trim() !== '') && (
                    <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                        <TriangleAlert className="size-4" aria-hidden="true" />
                        {overText ?? 'VƯỢT TIÊU CHUẨN NĂM'}
                      </p>
                      <Field id={`dp-${line.uid}-reason`} label="Lý do vượt tiêu chuẩn" required error={errs.overQuotaReason}>
                        <textarea
                          id={`dp-${line.uid}-reason`}
                          className="field-input min-h-16"
                          rows={2}
                          maxLength={LIMITS.overNormReason}
                          placeholder="Ví dụ: đổi size, áo hư do công việc, nhân viên mới chuyển bộ phận"
                          value={line.overQuotaReason}
                          aria-invalid={errs.overQuotaReason ? true : undefined}
                          aria-describedby={describedBy(`dp-${line.uid}-reason`, errs.overQuotaReason)}
                          onChange={(e) => updateLine(line.uid, { overQuotaReason: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                  <Field id={`dp-${line.uid}-note`} label="Ghi chú" error={errs.note} className="mt-3">
                    <input
                      id={`dp-${line.uid}-note`}
                      className="field-input"
                      maxLength={1000}
                      value={line.note}
                      onChange={(e) => updateLine(line.uid, { note: e.target.value })}
                    />
                  </Field>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="dp-note-title">
        <h2 id="dp-note-title" className="section-title">
          Ghi chú
        </h2>
        <Field id="handover-note" label={<span className="sr-only">Ghi chú cho phiếu</span>} error={general.note} className="mt-2">
          <textarea
            id="handover-note"
            className="field-input min-h-20 resize-y"
            rows={3}
            maxLength={LIMITS.handoverNote}
            value={values.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </Field>
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 space-y-3 border-t border-stone-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:p-4 sm:shadow-sm">
        {submitError && (
          <InlineAlert>
            {submitError}
            {submitErrorActions?.(submitFailure, () => setSubmitError(null))}
          </InlineAlert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {onCancel && (
            <Button variant="secondary" size="lg" onClick={onCancel} disabled={submitting}>
              Hủy
            </Button>
          )}
          <Button type="submit" size="lg" loading={submitting} icon={submitIcon} className="sm:min-w-56">
            {submitting ? 'Đang lưu…' : submitLabel}
          </Button>
        </div>
      </div>

      <ProfileDialog
        open={profileOpen}
        employee={
          receiverInfo
            ? { employeeId: receiverInfo.employeeId, fullName: receiverInfo.fullName, gender: receiverInfo.gender, uniformSize: receiverInfo.uniformSize }
            : null
        }
        onClose={() => setProfileOpen(false)}
        onSaved={() => {
          setProfileOpen(false);
          context.reload();
        }}
      />
    </form>
  );
}
