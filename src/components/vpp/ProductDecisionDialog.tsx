import { useLayoutEffect, useMemo, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import { productDecisionSchema, toFieldErrors } from '../../../shared/schemas';
import { sameUnit } from '../../../shared/text';
import type { NormScope, ProposalDetail, ProposalItem, VppProduct } from '../../../shared/vpp';
import { useAsync } from '../../hooks/useAsync';
import { ApiClientError, errorMessage, isStaleStateError } from '../../services/api';
import { vppProductDecision, vppProducts, type ProductDecisionInput } from '../../services/vppApi';
import { cn } from '../../utils/cn';
import { numberToInput, parseViNumber, withNumberFormatErrors, type NumberKind } from '../../utils/number';
import { searchProducts } from '../../utils/productSearch';
import { ConfirmDialog } from '../ui/Dialog';
import { describedBy, Field } from '../ui/Field';
import { NumberInput } from '../ui/NumberInput';
import { InlineAlert } from '../ui/States';
import { ProductPicker } from './ProductPicker';

type Decision = ProductDecisionInput['decision'];

const DECISIONS: Array<{ value: Decision; label: string; hint: string }> = [
  { value: 'MASTER', label: 'THÊM VÀO DANH MỤC', hint: 'Thành sản phẩm chính thức: hiện trong danh mục công khai, có thể gắn định mức.' },
  { value: 'TEMP', label: 'GIỮ TẠM', hint: 'Dùng được cho nhập / xuất kho nhưng không hiện trong danh mục công khai.' },
  { value: 'MAP', label: 'GHÉP', hint: 'Là sản phẩm đã có trong kho (khác tên gọi) — ghép vào sản phẩm đó.' },
  { value: 'REJECT', label: 'TỪ CHỐI', hint: 'Không mua sản phẩm này; dòng đề xuất được duyệt số lượng 0.' },
];

const NEW_SCOPE = '__new__';

/** Quyết định với sản phẩm mới (ngoài danh mục) trong đề xuất: thêm vào danh mục / giữ tạm / ghép / từ chối. */
export function ProductDecisionDialog({
  open,
  proposalId,
  item,
  scopes,
  defaultScopeId,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  proposalId: string;
  item: ProposalItem | null;
  scopes: NormScope[];
  defaultScopeId: string;
  onClose: () => void;
  onDone: (detail: ProposalDetail) => void;
  /**
   * Máy chủ từ chối vì dữ liệu đã đổi (INVALID_STATE: dòng vừa được xử lý ở nơi khác, sản phẩm đích không dùng được…):
   * trang tải lại chi tiết đề xuất — dòng không còn chờ quyết định thì trang đóng hộp thoại.
   */
  onStale: () => void;
}) {
  const [decision, setDecision] = useState<Decision>('MASTER');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [minimum, setMinimum] = useState('0');
  const [note, setNote] = useState('');
  const [withNorm, setWithNorm] = useState(false);
  const [normScope, setNormScope] = useState('');
  const [normScopeName, setNormScopeName] = useState('');
  const [normQty, setNormQty] = useState('');
  const [targetId, setTargetId] = useState('');
  const [query, setQuery] = useState('');
  const [convertedQty, setConvertedQty] = useState('');
  const [unitConverted, setUnitConverted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const products = useAsync<VppProduct[]>(() => (open ? vppProducts({}) : Promise.resolve([])), [open]);
  // Chuỗi (không phải mảng scopes): trang tải lại chi tiết đề xuất (mảng mới) không làm form đang nhập bị đặt lại.
  const firstScopeId = scopes[0]?.scopeId ?? '';

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open || !item) return;
    setDecision('MASTER');
    setName(item.temporaryProductName || item.displayName);
    setCode('');
    setCategory(item.product?.category ?? '');
    setUnit(item.unit || item.product?.unit || '');
    setPrice(numberToInput(item.referencePrice));
    setMinimum('0');
    setNote('');
    setWithNorm(false);
    setNormScope(defaultScopeId || firstScopeId || NEW_SCOPE);
    setNormScopeName('');
    setNormQty('');
    setTargetId('');
    setQuery(item.temporaryProductName || item.displayName);
    setConvertedQty('');
    setUnitConverted(false);
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.proposalItemId, defaultScopeId, firstScopeId]);

  const targets = useMemo(
    () =>
      (products.data ?? []).filter(
        (p) => p.active && p.productId !== item?.productId && p.catalogStatus !== 'ARCHIVED' && p.catalogStatus !== 'PENDING_APPROVAL',
      ),
    [products.data, item],
  );
  const targetOptions = useMemo(() => {
    const found = searchProducts(targets, query, 50);
    // Không có kết quả theo tên gợi ý → hiện toàn bộ để chọn.
    return found.length ? found : targets;
  }, [targets, query]);
  const target = targets.find((p) => p.productId === targetId) ?? null;
  // ĐVT của dòng đề xuất sau quyết định: GHÉP → ĐVT sản phẩm đích; thêm vào danh mục / giữ tạm → ĐVT đang nhập (trống: giữ ĐVT của
  // dòng). Khác ĐVT của dòng (GIỮ DẤU: "Cuốn" ≠ "Cuộn"), hoặc dòng chưa có ĐVT → số lượng đề xuất phải quy đổi — "2 Hộp" không được
  // tự thành "2 Cây". Cùng quy tắc với máy chủ (unitNeedsConversion_ / sameUnit_).
  const newUnit =
    !item || decision === 'REJECT' ? null : decision === 'MAP' ? (target ? target.unit : null) : unit.trim() || item.unit;
  const needsConversion = Boolean(item && newUnit !== null && (item.unit || newUnit) && !sameUnit(item.unit, newUnit));
  const newUnitText = newUnit ? `“${newUnit}”` : decision === 'MAP' ? 'của sản phẩm đích' : 'mới';

  function chooseTarget(product: VppProduct) {
    setTargetId(product.productId);
    // Đổi sản phẩm đích → số đã quy đổi có thể theo ĐVT khác → nhập lại và xác nhận lại.
    setConvertedQty('');
    setUnitConverted(false);
    setErrors({});
  }

  function clearError(key: string) {
    setErrors((current) => {
      if (!(key in current)) return current;
      const copy = { ...current };
      delete copy[key];
      return copy;
    });
  }

  async function save() {
    if (!item || saving) return;
    const body: ProductDecisionInput = { decision };
    // Ô số đang hiện trong form (kiểm tra định dạng "1.000" / "1,5" — chỉ các ô người dùng thấy).
    const numberFields: Record<string, readonly [string, NumberKind]> = {};
    if (decision === 'MASTER' || decision === 'TEMP') {
      Object.assign(body, {
        productName: name,
        productCode: code,
        category,
        unit,
        referencePrice: parseViNumber(price, 'decimal'),
        minimumStock: parseViNumber(minimum) ?? 0,
        note,
      });
      numberFields.referencePrice = [price, 'decimal'];
      numberFields.minimumStock = [minimum, 'integer'];
      if (decision === 'MASTER' && withNorm) {
        body.norm = {
          scopeId: normScope === NEW_SCOPE ? '' : normScope,
          scopeName: normScope === NEW_SCOPE ? normScopeName.trim() : '',
          monthlyQuantity: parseViNumber(normQty) ?? NaN,
          note: '',
        };
        numberFields['norm.monthlyQuantity'] = [normQty, 'integer'];
      }
    }
    if (decision === 'MAP') body.targetProductId = target?.productId ?? '';
    body.convertedQuantity = needsConversion ? parseViNumber(convertedQty) : null;
    body.unitConverted = needsConversion && unitConverted;
    if (needsConversion) numberFields.convertedQuantity = [convertedQty, 'integer'];
    const parsed = productDecisionSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), numberFields);
    if (body.norm && !body.norm.scopeId && !body.norm.scopeName) fieldErrors['norm.scopeName'] ??= 'Nhập tên phạm vi mới';
    if (needsConversion) {
      if (body.convertedQuantity === null) fieldErrors.convertedQuantity ??= `Nhập số lượng đã quy đổi sang ĐVT ${newUnitText}.`;
      if (!unitConverted) fieldErrors.unitConverted ??= `Xác nhận số lượng đã quy đổi sang ĐVT ${newUnitText}.`;
    }
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      onDone(await vppProductDecision(proposalId, item.proposalItemId, body));
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không lưu được quyết định.'));
      if (isStaleStateError(err)) onStale();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      title={item ? `Sản phẩm mới: ${item.displayName}` : 'Sản phẩm mới'}
      description={item ? `Nhân viên đề xuất ${item.requestedQuantity} ${item.unit || ''}. Lý do: ${item.reason || '—'}` : undefined}
      confirmLabel="Lưu quyết định"
      cancelLabel="Hủy"
      tone={decision === 'REJECT' ? 'danger' : 'primary'}
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Cách xử lý">
        {DECISIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={decision === d.value}
            onClick={() => {
              setDecision(d.value);
              // ĐVT mới có thể khác (GHÉP: theo sản phẩm đích) → xác nhận quy đổi lại.
              setUnitConverted(false);
              setErrors({});
            }}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-bold tracking-wide',
              decision === d.value
                ? d.value === 'REJECT'
                  ? 'border-red-500 bg-red-50 text-red-800'
                  : 'border-brand-600 bg-brand-50 text-brand-800'
                : 'border-stone-300 text-stone-600 hover:bg-stone-50',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-600">{DECISIONS.find((d) => d.value === decision)?.hint}</p>

      {(decision === 'MASTER' || decision === 'TEMP') && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="decision-name" label="Tên sản phẩm" required error={errors.productName} className="sm:col-span-2">
            <input
              id="decision-name"
              className="field-input"
              maxLength={LIMITS.productName}
              value={name}
              aria-invalid={errors.productName ? true : undefined}
              aria-describedby={describedBy('decision-name', errors.productName)}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="decision-unit" label="ĐVT" required={decision === 'MASTER'} error={errors.unit}>
            <input
              id="decision-unit"
              className="field-input"
              maxLength={LIMITS.unit}
              value={unit}
              aria-invalid={errors.unit ? true : undefined}
              aria-describedby={describedBy('decision-unit', errors.unit)}
              onChange={(e) => {
                setUnit(e.target.value);
                // Đổi ĐVT → số đã quy đổi (nếu có) theo ĐVT cũ: xác nhận lại.
                setUnitConverted(false);
              }}
            />
          </Field>
          <Field id="decision-code" label="Mã sản phẩm" error={errors.productCode} hint="Để trống: tự cấp.">
            <input
              id="decision-code"
              className="field-input font-mono uppercase"
              maxLength={LIMITS.productCode}
              value={code}
              aria-invalid={errors.productCode ? true : undefined}
              aria-describedby={describedBy('decision-code', errors.productCode, 'hint')}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field id="decision-category" label="Nhóm" error={errors.category}>
            <input id="decision-category" className="field-input" maxLength={LIMITS.productCategory} value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field id="decision-price" label="Đơn giá tham khảo (₫)" error={errors.referencePrice}>
            <NumberInput
              id="decision-price"
              className="field-input"
              value={price}
              aria-invalid={errors.referencePrice ? true : undefined}
              aria-describedby={describedBy('decision-price', errors.referencePrice)}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field id="decision-min" label="Tồn tối thiểu" error={errors.minimumStock}>
            <NumberInput
              id="decision-min"
              className="field-input"
              value={minimum}
              aria-invalid={errors.minimumStock ? true : undefined}
              aria-describedby={describedBy('decision-min', errors.minimumStock)}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </Field>
          <Field id="decision-note" label="Ghi chú" error={errors.note}>
            <input id="decision-note" className="field-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {decision === 'MASTER' && (
            <div className="space-y-3 rounded-lg border border-stone-200 p-3 sm:col-span-2">
              <label className="flex items-center gap-2.5 text-sm font-medium text-stone-800">
                <input type="checkbox" className="size-5 accent-brand-700" checked={withNorm} onChange={(e) => setWithNorm(e.target.checked)} />
                Thêm định mức tháng cho sản phẩm này
              </label>
              {withNorm && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="decision-norm-scope" label="Phạm vi" error={errors['norm.scopeId']}>
                    <select id="decision-norm-scope" className="field-input" value={normScope} onChange={(e) => setNormScope(e.target.value)}>
                      {scopes.map((s) => (
                        <option key={s.scopeId} value={s.scopeId}>
                          {s.scopeName}
                        </option>
                      ))}
                      <option value={NEW_SCOPE}>+ Phạm vi mới…</option>
                    </select>
                  </Field>
                  {normScope === NEW_SCOPE && (
                    <Field id="decision-norm-scope-name" label="Tên phạm vi mới" required error={errors['norm.scopeName']}>
                      <input
                        id="decision-norm-scope-name"
                        className="field-input"
                        maxLength={120}
                        value={normScopeName}
                        aria-invalid={errors['norm.scopeName'] ? true : undefined}
                        aria-describedby={describedBy('decision-norm-scope-name', errors['norm.scopeName'])}
                        onChange={(e) => setNormScopeName(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field id="decision-norm-qty" label="SL / tháng" required error={errors['norm.monthlyQuantity']}>
                    <NumberInput
                      id="decision-norm-qty"
                      className="field-input"
                      value={normQty}
                      aria-invalid={errors['norm.monthlyQuantity'] ? true : undefined}
                      aria-describedby={describedBy('decision-norm-qty', errors['norm.monthlyQuantity'])}
                      onChange={(e) => setNormQty(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {decision === 'MAP' && (
        <Field id="decision-target" label="Ghép vào sản phẩm" required error={errors.targetProductId}>
          <ProductPicker
            id="decision-target"
            query={query}
            onQueryChange={setQuery}
            searchLabel="Tìm sản phẩm đích"
            options={targetOptions}
            selected={target}
            loading={products.status === 'loading'}
            loadError={products.status === 'error'}
            error={errors.targetProductId}
            onSelect={chooseTarget}
          />
        </Field>
      )}

      {item && needsConversion && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm text-amber-900">
            {item.unit
              ? `ĐVT khác nhau: dòng đề xuất tính theo “${item.unit}”, ${decision === 'MAP' ? 'sản phẩm đích' : 'sản phẩm'} tính theo ${newUnit ? `“${newUnit}”` : '(chưa có ĐVT)'}.`
              : 'Dòng đề xuất chưa có ĐVT.'}{' '}
            Quy đổi số lượng đề xuất sang ĐVT {decision === 'MAP' ? 'của sản phẩm đích' : 'mới'} — số này thay cho số lượng đề xuất của
            dòng.
          </p>
          <Field
            id="decision-converted-qty"
            label={`Số lượng đã quy đổi sang ${newUnit || (decision === 'MAP' ? 'ĐVT của sản phẩm đích' : 'ĐVT mới')}`}
            required
            error={errors.convertedQuantity}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <NumberInput
                id="decision-converted-qty"
                className="field-input w-32"
                value={convertedQty}
                aria-invalid={errors.convertedQuantity ? true : undefined}
                aria-describedby={[describedBy('decision-converted-qty', errors.convertedQuantity), 'decision-original-qty'].filter(Boolean).join(' ')}
                onChange={(e) => {
                  setConvertedQty(e.target.value);
                  clearError('convertedQuantity');
                }}
              />
              <span id="decision-original-qty" className="text-sm text-stone-600">
                Đề xuất gốc: <strong className="text-stone-900">{item.requestedQuantity} {item.unit || '(chưa có ĐVT)'}</strong>
              </span>
            </div>
          </Field>
          <div>
            <label className="flex items-start gap-2 text-sm text-stone-800">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={unitConverted}
                aria-invalid={errors.unitConverted ? true : undefined}
                aria-describedby={errors.unitConverted ? 'decision-unit-converted-error' : undefined}
                onChange={(e) => {
                  setUnitConverted(e.target.checked);
                  clearError('unitConverted');
                }}
              />
              <span>
                Tôi xác nhận số lượng trên đã quy đổi từ {item.unit ? <strong>“{item.unit}”</strong> : 'ĐVT của dòng đề xuất'} sang ĐVT{' '}
                <strong>{newUnitText}</strong>
                {decision === 'MAP' && newUnit ? ' của sản phẩm đích' : ''}.
              </span>
            </label>
            {errors.unitConverted && (
              <p id="decision-unit-converted-error" className="mt-1 text-xs font-medium text-red-700">
                {errors.unitConverted}
              </p>
            )}
          </div>
        </div>
      )}

      {decision === 'REJECT' && (
        <InlineAlert tone="warning">Sản phẩm sẽ được lưu trữ (không xóa) và dòng đề xuất này được duyệt số lượng 0.</InlineAlert>
      )}
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}
