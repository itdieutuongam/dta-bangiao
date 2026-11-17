import { Plus, X } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import {
  toFieldErrors,
  uniformModelSaveSchema,
  uniformProfileSchema,
  uniformReturnSchema,
  uniformStockAdjustSchema,
  uniformStockDisposeSchema,
  uniformStockInSchema,
} from '../../../shared/schemas';
import {
  DEFAULT_UNIFORM_SIZES,
  EMPTY_UNIFORM_TOTALS,
  EMPLOYEE_GENDER_LABELS,
  EMPLOYEE_GENDERS,
  RETURN_REASON_LABELS,
  RETURN_REASONS,
  RETURN_RESULT_LABELS,
  RETURN_RESULTS,
  UNIFORM_CONDITION_LABELS,
  UNIFORM_CONDITIONS,
  UNIFORM_GENDER_LABELS,
  UNIFORM_GENDERS,
  UNIFORM_KIND_LABELS,
  UNIFORM_KINDS,
  UNIFORM_SIZE_PATTERN,
  UNIFORM_STOCK_IN_REASON_LABELS,
  UNIFORM_STOCK_IN_REASONS,
  uniformSkuLabel,
  type EmployeeGender,
  type ReturnReason,
  type ReturnResult,
  type UniformCondition,
  type UniformEmployeeRow,
  type UniformGender,
  type UniformHolding,
  type UniformKind,
  type UniformReturnResult,
  type UniformSku,
  type UniformStockInReason,
  type UniformStockModel,
} from '../../../shared/uniform';
import { uniformRecordReturn, uniformSaveModel, uniformSaveProfile, uniformStockAdjust, uniformStockDispose, uniformStockIn } from '../../services/uniformApi';
import { todayIsoDate } from '../../utils/format';
import { numberToInput, parseViNumber, withNumberFormatErrors } from '../../utils/number';
import { newRequestId } from '../../utils/requestId';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { describedBy, Field } from '../ui/Field';
import { NumberInput } from '../ui/NumberInput';
import { InlineAlert } from '../ui/States';
import { Qty } from '../vpp/Badges';
import { ResumedNotice, shouldReload, useDialogErrors, useOperationKey } from '../vpp/StockDialogs';

// ---------------------------------------------------------------- Mẫu đồng phục

/** Thêm / sửa mẫu: tên, mã, loại, giới tính, các size, ĐVT, đơn giá, tính tiêu chuẩn, tồn tối thiểu mỗi size. */
export function ModelDialog({
  open,
  model,
  onClose,
  onSaved,
  onStale,
}: {
  open: boolean;
  model: UniformStockModel | null;
  onClose: () => void;
  onSaved: (model: UniformStockModel, duplicate: boolean) => void;
  onStale?: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<UniformKind>('UNIFORM');
  const [gender, setGender] = useState<UniformGender>('UNISEX');
  const [sizes, setSizes] = useState<string[]>([...DEFAULT_UNIFORM_SIZES]);
  const [newSize, setNewSize] = useState('');
  const [unit, setUnit] = useState('Cái');
  const [price, setPrice] = useState('');
  const [countsTowardQuota, setCountsTowardQuota] = useState(true);
  const [minimum, setMinimum] = useState('0');
  const [appliesTo, setAppliesTo] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    setName(model?.modelName ?? '');
    setCode(model?.modelCode ?? '');
    setKind(model?.kind ?? 'UNIFORM');
    setGender(model?.gender ?? 'UNISEX');
    setSizes(model ? [...model.sizes] : [...DEFAULT_UNIFORM_SIZES]);
    setNewSize('');
    setUnit(model?.unit ?? 'Cái');
    setPrice(numberToInput(model?.referencePrice));
    setCountsTowardQuota(model?.countsTowardQuota ?? true);
    setMinimum(String(model?.minimumStock ?? 0));
    setAppliesTo(model?.appliesTo ?? '');
    setNote(model?.note ?? '');
    setActive(model?.active ?? true);
    setRequestId(newRequestId());
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model?.modelId]);

  function addSize() {
    const s = newSize.trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return;
    if (!UNIFORM_SIZE_PATTERN.test(s)) {
      setErrors({ ...errors, sizes: 'Size chỉ gồm chữ in hoa / số / dấu gạch, tối đa 10 ký tự (S, XL, 3XL, 38, FREE).' });
      return;
    }
    if (!sizes.includes(s)) setSizes([...sizes, s]);
    setNewSize('');
  }

  async function save() {
    if (saving) return;
    const body = {
      modelCode: code.trim(),
      modelName: name.trim(),
      kind,
      gender,
      sizes,
      unit: unit.trim(),
      referencePrice: parseViNumber(price, 'decimal'),
      countsTowardQuota,
      minimumStock: parseViNumber(minimum) ?? 0,
      appliesTo: appliesTo.trim(),
      note: note.trim(),
      active,
      ...(model ? {} : { clientRequestId: requestId }),
    };
    const parsed = uniformModelSaveSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), {
      referencePrice: [price, 'decimal'],
      minimumStock: [minimum, 'integer'],
    });
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const result = await uniformSaveModel(body, model?.modelId);
      onSaved(result.model, result.duplicate === true);
    } catch (err) {
      if (shouldReload(err)) onStale?.();
      fromError(err, 'Không lưu được mẫu đồng phục.');
    } finally {
      setSaving(false);
    }
  }

  const sizeError = errors.sizes ?? Object.entries(errors).find(([k]) => k.startsWith('sizes.'))?.[1];

  return (
    <ConfirmDialog
      open={open}
      wide
      title={model ? `Sửa mẫu: ${model.modelName}` : 'Thêm mẫu đồng phục'}
      confirmLabel={model ? 'Lưu mẫu' : 'Thêm mẫu'}
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dp-model-name" label="Tên mẫu" required error={errors.modelName} className="sm:col-span-2">
          <input
            id="dp-model-name"
            className="field-input"
            maxLength={LIMITS.uniformModelName}
            value={name}
            placeholder="Ví dụ: Áo sơmi đỏ"
            aria-invalid={errors.modelName ? true : undefined}
            aria-describedby={describedBy('dp-model-name', errors.modelName)}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field id="dp-model-code" label="Mã mẫu" error={errors.modelCode} hint={model ? undefined : 'Để trống: hệ thống tự đặt DP-00n.'}>
          <input
            id="dp-model-code"
            className="field-input font-mono uppercase"
            maxLength={40}
            value={code}
            aria-invalid={errors.modelCode ? true : undefined}
            aria-describedby={describedBy('dp-model-code', errors.modelCode, model ? undefined : 'x')}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field id="dp-model-kind" label="Loại" error={errors.kind}>
          <select
            id="dp-model-kind"
            className="field-input"
            value={kind}
            onChange={(e) => {
              const next = e.target.value as UniformKind;
              setKind(next);
              if (next === 'PPE') setCountsTowardQuota(false);
            }}
          >
            {UNIFORM_KINDS.map((k) => (
              <option key={k} value={k}>
                {UNIFORM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-model-gender" label="Giới tính áp dụng" error={errors.gender}>
          <select id="dp-model-gender" className="field-input" value={gender} onChange={(e) => setGender(e.target.value as UniformGender)}>
            {UNIFORM_GENDERS.map((g) => (
              <option key={g} value={g}>
                {UNIFORM_GENDER_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-model-unit" label="ĐVT" required error={errors.unit}>
          <input id="dp-model-unit" className="field-input" maxLength={LIMITS.unit} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium text-stone-800">
            Các size<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {sizes.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-sm font-semibold text-brand-900 ring-1 ring-brand-200">
                {s}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-brand-700 hover:bg-brand-100"
                  aria-label={`Bỏ size ${s}`}
                  onClick={() => setSizes(sizes.filter((x) => x !== s))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <input
                className="field-input w-24 py-1 uppercase"
                aria-label="Thêm size"
                placeholder="3XL"
                maxLength={10}
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSize();
                  }
                }}
              />
              <Button size="sm" variant="secondary" onClick={addSize} icon={<Plus className="size-4" aria-hidden="true" />}>
                Thêm size
              </Button>
            </span>
          </div>
          {sizeError ? (
            <p className="mt-1 text-xs font-medium text-red-700">{sizeError}</p>
          ) : (
            <p className="mt-1 text-xs text-stone-500">Bỏ một size chỉ được khi size đó hết tồn và không còn phiếu chờ ký.</p>
          )}
        </div>
        <Field id="dp-model-price" label="Đơn giá tham khảo (₫)" error={errors.referencePrice}>
          <NumberInput id="dp-model-price" className="field-input" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field id="dp-model-min" label="Tồn tối thiểu mỗi size (hàng mới)" error={errors.minimumStock}>
          <NumberInput id="dp-model-min" className="field-input" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
        </Field>
        <Field id="dp-model-applies" label="Đối tượng sử dụng" error={errors.appliesTo} className="sm:col-span-2">
          <input
            id="dp-model-applies"
            className="field-input"
            maxLength={LIMITS.uniformAppliesTo}
            placeholder="Ví dụ: Nhân viên kinh doanh / showroom (nam)"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value)}
          />
        </Field>
        <Field id="dp-model-note" label="Ghi chú" error={errors.note} className="sm:col-span-2">
          <textarea id="dp-model-note" className="field-input min-h-16" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-stone-700 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={countsTowardQuota} onChange={(e) => setCountsTowardQuota(e.target.checked)} />
          <span>
            Tính vào <strong>tiêu chuẩn cấp phát năm</strong> (bỏ chọn với áo bảo hộ, đồ dùng chung).
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Đang sử dụng (bỏ chọn = ngừng dùng; không còn hiện khi tạo phiếu)
        </label>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Nhập kho

export function UniformStockInDialog({
  open,
  model,
  initialSize,
  initialCondition,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  model: UniformStockModel | null;
  initialSize?: string;
  initialCondition?: UniformCondition;
  onClose: () => void;
  onDone: (sku: UniformSku, duplicate: boolean) => void;
  onStale?: () => void;
}) {
  const [size, setSize] = useState('');
  const [condition, setCondition] = useState<UniformCondition>('NEW');
  const [quantity, setQuantity] = useState('1');
  const [reasonType, setReasonType] = useState<UniformStockInReason>('MUA_MOI');
  const [unitPrice, setUnitPrice] = useState('');
  const [date, setDate] = useState(todayIsoDate());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  const operation = useOperationKey('dp-stock-in');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    const firstSize = initialSize && model?.sizes.includes(initialSize) ? initialSize : (model?.sizes[0] ?? '');
    const firstCondition = initialCondition ?? 'NEW';
    setSize(firstSize);
    setCondition(firstCondition);
    setQuantity('1');
    // Mặt hàng chưa từng nhập → "Tồn đầu kỳ"; đã có → "Nhập bổ sung" (cả hai đều cộng vào Tồn đầu kỳ và Khả dụng).
    const target = model?.skus.find((s) => s.size === firstSize && s.condition === firstCondition);
    const neverReceived = !target || ((target.totals?.received ?? 0) === 0 && !target.stock.onHand);
    setReasonType(neverReceived ? 'TON_DAU_KY' : 'MUA_MOI');
    setUnitPrice(numberToInput(model?.referencePrice));
    setDate(todayIsoDate());
    setNote('');
    setResumed(model ? operation.begin(model.modelId) : false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model?.modelId, initialSize, initialCondition]);

  async function save() {
    if (saving || !model) return;
    const body = {
      modelId: model.modelId,
      size,
      condition,
      quantity: parseViNumber(quantity) ?? NaN,
      reasonType,
      unitPrice: parseViNumber(unitPrice, 'decimal'),
      date,
      note: note.trim(),
      clientRequestId: operation.key.current,
    };
    const parsed = uniformStockInSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), {
      quantity: [quantity, 'integer'],
      unitPrice: [unitPrice, 'decimal'],
    });
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const result = await uniformStockIn(body);
      operation.succeeded(model.modelId);
      onDone(result.sku, result.duplicate);
    } catch (err) {
      operation.failed(model.modelId, err);
      if (shouldReload(err)) onStale?.();
      fromError(err, 'Không nhập kho được.');
    } finally {
      setSaving(false);
    }
  }

  const current = model?.skus.find((s) => s.size === size && s.condition === condition);
  const totals = current?.totals ?? EMPTY_UNIFORM_TOTALS;
  const adding = parseViNumber(quantity);
  const addValid = adding !== null && Number.isInteger(adding) && adding > 0;

  return (
    <ConfirmDialog
      open={open}
      title={model ? `Nhập kho: ${model.modelName}` : 'Nhập kho'}
      confirmLabel="Nhập kho"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what="nhập kho" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dp-in-size" label="Size" required error={errors.size}>
          <select id="dp-in-size" className="field-input" value={size} onChange={(e) => setSize(e.target.value)}>
            {model?.sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-in-condition" label="Tình trạng" error={errors.condition}>
          <select id="dp-in-condition" className="field-input" value={condition} onChange={(e) => setCondition(e.target.value as UniformCondition)}>
            {UNIFORM_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {UNIFORM_CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700 sm:col-span-2" aria-live="polite">
          <p>
            {size} · {UNIFORM_CONDITION_LABELS[condition]} — Tồn đầu kỳ: <strong className="tabular-nums">{totals.received}</strong> · Đã bàn giao:{' '}
            <strong className="tabular-nums">{totals.handedOver}</strong> · Khả dụng:{' '}
            <strong className="tabular-nums">
              <Qty value={current ? current.stock.available : 0} unit={model?.unit} />
            </strong>
            {current && current.stock.reserved > 0 ? ` · đang giữ chỗ ${current.stock.reserved}` : ''}
          </p>
          {addValid && (
            <p className="mt-1 text-xs text-emerald-800">
              Sau khi nhập {adding}: Tồn đầu kỳ <strong className="tabular-nums">{totals.received + adding}</strong> · Khả dụng{' '}
              <strong className="tabular-nums">{(current?.stock.available ?? 0) + adding}</strong>
            </p>
          )}
        </div>
        <Field id="dp-in-qty" label="Số lượng" required error={errors.quantity}>
          <NumberInput
            id="dp-in-qty"
            className="field-input"
            value={quantity}
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={describedBy('dp-in-qty', errors.quantity)}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field id="dp-in-reason" label="Lý do" required error={errors.reasonType}>
          <select id="dp-in-reason" className="field-input" value={reasonType} onChange={(e) => setReasonType(e.target.value as UniformStockInReason)}>
            {UNIFORM_STOCK_IN_REASONS.map((r) => (
              <option key={r} value={r}>
                {UNIFORM_STOCK_IN_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-in-price" label="Đơn giá (₫)" error={errors.unitPrice}>
          <NumberInput id="dp-in-price" className="field-input" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </Field>
        <Field id="dp-in-date" label="Ngày nhập" error={errors.date}>
          <input id="dp-in-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="dp-in-note" label="Ghi chú" required={reasonType === 'KHAC'} error={errors.note} className="sm:col-span-2">
          <textarea
            id="dp-in-note"
            className="field-input min-h-16"
            rows={2}
            maxLength={LIMITS.stockReason}
            placeholder="Ví dụ: nhà may, số hóa đơn"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Kiểm kê / thanh lý một mặt hàng

export function SkuStockDialog({
  open,
  mode,
  model,
  sku,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  mode: 'adjust' | 'dispose';
  model: UniformStockModel | null;
  sku: UniformSku | null;
  onClose: () => void;
  onDone: (sku: UniformSku, duplicate: boolean) => void;
  onStale?: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  const operation = useOperationKey(mode === 'adjust' ? 'dp-adjust' : 'dp-dispose');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    setQuantity(mode === 'adjust' ? numberToInput(sku?.stock.onHand ?? 0) : '1');
    setReason('');
    setResumed(sku ? operation.begin(sku.productId) : false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sku?.productId, mode]);

  async function save() {
    if (saving || !sku) return;
    const qty = parseViNumber(quantity) ?? NaN;
    const base = { productId: sku.productId, reason: reason.trim(), clientRequestId: operation.key.current };
    const parsed =
      mode === 'adjust'
        ? uniformStockAdjustSchema.safeParse({ ...base, countedQuantity: qty })
        : uniformStockDisposeSchema.safeParse({ ...base, quantity: qty });
    const field = mode === 'adjust' ? 'countedQuantity' : 'quantity';
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), { [field]: [quantity, 'integer'] as const });
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const result =
        mode === 'adjust' ? await uniformStockAdjust({ ...base, countedQuantity: qty }) : await uniformStockDispose({ ...base, quantity: qty });
      operation.succeeded(sku.productId);
      onDone(result.sku, result.duplicate);
    } catch (err) {
      operation.failed(sku.productId, err);
      if (shouldReload(err)) onStale?.();
      fromError(err, mode === 'adjust' ? 'Không kiểm kê được.' : 'Không thanh lý được.');
    } finally {
      setSaving(false);
    }
  }

  const label = sku && model ? uniformSkuLabel(model.modelName, sku.size, sku.condition) : '';
  const qtyError = mode === 'adjust' ? errors.countedQuantity : errors.quantity;
  return (
    <ConfirmDialog
      open={open}
      title={mode === 'adjust' ? `Kiểm kê: ${label}` : `Thanh lý / hủy: ${label}`}
      description={
        mode === 'adjust'
          ? 'Nhập số đếm thực tế. Hệ thống ghi phần chênh lệch vào sổ biến động (không thấp hơn số đang giữ chỗ cho phiếu chờ ký).'
          : 'Dùng khi áo hư hỏng, lỗi may, không còn dùng được. Không thấp hơn số đang giữ chỗ cho phiếu chờ ký.'
      }
      confirmLabel={mode === 'adjust' ? 'Lưu kiểm kê' : 'Thanh lý'}
      cancelLabel="Hủy"
      tone={mode === 'dispose' ? 'danger' : 'primary'}
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what={mode === 'adjust' ? 'kiểm kê' : 'thanh lý'} />}
      {sku && (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          Tồn theo sổ: <Qty value={sku.stock.onHand} unit={model?.unit} /> · Đang giữ chỗ: {sku.stock.reserved} · Khả dụng:{' '}
          <Qty value={sku.stock.available} />
        </p>
      )}
      <Field id="dp-sku-qty" label={mode === 'adjust' ? 'Tồn thực tế' : 'Số lượng thanh lý'} required error={qtyError}>
        <NumberInput id="dp-sku-qty" className="field-input" value={quantity} aria-invalid={qtyError ? true : undefined} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field id="dp-sku-reason" label="Lý do" required error={errors.reason}>
        <textarea id="dp-sku-reason" className="field-input min-h-16" rows={2} maxLength={LIMITS.stockReason} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Hồ sơ đồng phục của nhân viên

export function ProfileDialog({
  open,
  employee,
  onClose,
  onSaved,
}: {
  open: boolean;
  employee: Pick<UniformEmployeeRow, 'employeeId' | 'fullName' | 'gender' | 'uniformSize'> | null;
  onClose: () => void;
  onSaved: (row: UniformEmployeeRow | null) => void;
}) {
  const [gender, setGender] = useState<EmployeeGender | ''>('');
  const [size, setSize] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    setGender(employee?.gender ?? '');
    setSize(employee?.uniformSize ?? '');
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.employeeId]);

  async function save() {
    if (saving || !employee) return;
    const parsed = uniformProfileSchema.safeParse({ gender, uniformSize: size });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      onSaved(await uniformSaveProfile(employee.employeeId, parsed.data));
    } catch (err) {
      fromError(err, 'Không lưu được hồ sơ đồng phục.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={employee ? `Size & giới tính: ${employee.fullName}` : 'Hồ sơ đồng phục'}
      description="Lưu vào cột gender / uniform_size của sheet NHAN_VIEN — dùng để chọn sẵn mẫu, size khi cấp đồng phục và dự trù đặt may."
      confirmLabel="Lưu"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dp-profile-gender" label="Giới tính" error={errors.gender}>
          <select id="dp-profile-gender" className="field-input" value={gender} onChange={(e) => setGender(e.target.value as EmployeeGender | '')}>
            <option value="">Chưa rõ</option>
            {EMPLOYEE_GENDERS.map((g) => (
              <option key={g} value={g}>
                {EMPLOYEE_GENDER_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-profile-size" label="Size thường dùng" error={errors.uniformSize} hint="S, M, L, XL, XXL, 3XL…">
          <input
            id="dp-profile-size"
            className="field-input uppercase"
            list="dp-size-options"
            maxLength={10}
            value={size}
            aria-describedby={describedBy('dp-profile-size', errors.uniformSize, 'x')}
            onChange={(e) => setSize(e.target.value)}
          />
          <datalist id="dp-size-options">
            {[...DEFAULT_UNIFORM_SIZES, '3XL', 'FREE'].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Ghi nhận trả / thu hồi

export function ReturnDialog({
  open,
  holding,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  holding: UniformHolding | null;
  onClose: () => void;
  onDone: (result: UniformReturnResult) => void;
  onStale?: () => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState<ReturnResult>('RESTOCK');
  const [condition, setCondition] = useState<UniformCondition>('USED');
  const [reason, setReason] = useState<ReturnReason>('TRA_MUON');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  const operation = useOperationKey('dp-return');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    setQuantity(String(Math.max(1, holding?.outstanding ?? 1)));
    setResult('RESTOCK');
    setCondition('USED');
    setReason(holding?.issueKind === 'CHO_MUON' ? 'TRA_MUON' : 'NGHI_VIEC');
    setNote('');
    setResumed(holding ? operation.begin(holding.itemId) : false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, holding?.itemId]);

  async function save() {
    if (saving || !holding) return;
    const body = {
      handoverId: holding.handoverId,
      itemId: holding.itemId,
      quantity: parseViNumber(quantity) ?? NaN,
      result,
      restockCondition: result === 'RESTOCK' ? condition : ('' as const),
      reason,
      note: note.trim(),
      clientRequestId: operation.key.current,
    };
    const parsed = uniformReturnSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), { quantity: [quantity, 'integer'] });
    if (!fieldErrors.quantity && body.quantity > holding.outstanding) {
      fieldErrors.quantity = `Chỉ còn ${holding.outstanding} chưa trả.`;
    }
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const done = await uniformRecordReturn(body);
      operation.succeeded(holding.itemId);
      onDone(done);
    } catch (err) {
      operation.failed(holding.itemId, err);
      if (shouldReload(err)) onStale?.();
      fromError(err, 'Không ghi nhận được.');
    } finally {
      setSaving(false);
    }
  }

  const noteRequired = result !== 'RESTOCK' || reason === 'KHAC';
  return (
    <ConfirmDialog
      open={open}
      title="Ghi nhận trả / thu hồi đồng phục"
      confirmLabel="Ghi nhận"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what="ghi nhận trả" />}
      {holding && (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          <strong>{holding.employeeName}</strong> · {holding.modelName} · Size {holding.size || '—'} · phiếu {holding.handoverCode}
          <br />
          Đã nhận {holding.quantity} · đã trả {holding.returned} · <strong>còn giữ {holding.outstanding}</strong>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dp-ret-qty" label="Số lượng" required error={errors.quantity}>
          <NumberInput id="dp-ret-qty" className="field-input" value={quantity} aria-invalid={errors.quantity ? true : undefined} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field id="dp-ret-reason" label="Lý do" required error={errors.reason}>
          <select id="dp-ret-reason" className="field-input" value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            {RETURN_REASONS.map((r) => (
              <option key={r} value={r}>
                {RETURN_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-stone-800">Kết quả</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {RETURN_RESULTS.map((r) => (
              <label key={r} className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="dp-ret-result" className="accent-brand-700" checked={result === r} onChange={() => setResult(r)} />
                {RETURN_RESULT_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        {result === 'RESTOCK' && (
          <Field id="dp-ret-condition" label="Tình trạng khi nhập lại kho" required error={errors.restockCondition}>
            <select id="dp-ret-condition" className="field-input" value={condition} onChange={(e) => setCondition(e.target.value as UniformCondition)}>
              {UNIFORM_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {UNIFORM_CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="dp-ret-note" label="Ghi chú" required={noteRequired} error={errors.note} className="sm:col-span-2">
          <textarea
            id="dp-ret-note"
            className="field-input min-h-16"
            rows={2}
            maxLength={LIMITS.stockReason}
            placeholder={result === 'RESTOCK' ? 'Ví dụ: áo còn tốt, đã giặt' : 'Mô tả hư hỏng / hoàn cảnh mất, có bồi thường hay không'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}
