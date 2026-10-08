import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import { productSaveSchema, stockAdjustSchema, stockInSchema, toFieldErrors } from '../../../shared/schemas';
import {
  CATALOG_STATUS_LABELS,
  STOCK_IN_REASON_LABELS,
  STOCK_IN_REASONS,
  type CatalogStatus,
  type StockInReason,
  type VppProduct,
} from '../../../shared/vpp';
import { ApiClientError, errorMessage, isApiError, isStaleStateError } from '../../services/api';
import { vppSaveProduct, vppStockAdjust, vppStockIn, type ProductFormInput } from '../../services/vppApi';
import { todayIsoDate } from '../../utils/format';
import { numberToInput, parseViNumber, withNumberFormatErrors } from '../../utils/number';
import { newRequestId } from '../../utils/requestId';
import { ConfirmDialog } from '../ui/Dialog';
import { describedBy, Field } from '../ui/Field';
import { NumberInput } from '../ui/NumberInput';
import { InlineAlert } from '../ui/States';
import { Qty } from './Badges';

function useDialogErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  function fromError(err: unknown, fallback: string) {
    if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
    setFormError(errorMessage(err, fallback));
  }
  function reset() {
    setErrors({});
    setFormError(null);
  }
  return { errors, setErrors, formError, setFormError, fromError, reset };
}

/** Nhắc khi mở lại hộp thoại sau một lần bấm lỗi chưa rõ kết quả (mã thao tác được dùng lại). */
function ResumedNotice({ what }: { what: string }) {
  return (
    <InlineAlert tone="warning">
      Lần {what} trước cho mục này bị lỗi kết nối — chưa rõ máy chủ đã ghi hay chưa. Cứ nhập lại như lần trước: nếu lần đó đã ghi, hệ
      thống báo “đã ghi” và KHÔNG ghi lần hai. Kiểm tra số liệu hiện tại trước khi lưu.
    </InlineAlert>
  );
}

/** Lỗi không cho biết thao tác đã được ghi hay chưa: mất mạng, hết thời gian chờ, máy chủ / Apps Script lỗi, phản hồi hỏng. */
function isAmbiguousFailure(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return true;
  return error.status === 0 || error.status >= 500 || error.code === 'BAD_RESPONSE';
}

/** Số liệu trên trang có thể đã khác máy chủ (lần ghi chưa rõ kết quả, đã ghi từ lần trước, người khác vừa thao tác) → nên tải lại. */
function shouldReload(error: unknown): boolean {
  return isAmbiguousFailure(error) || isApiError(error, 'REQUEST_REUSED') || isStaleStateError(error);
}

/**
 * Mã thao tác (clientRequestId) của những lần bấm lỗi mà CHƯA biết đã ghi hay chưa, theo loại thao tác + đối tượng. Mở lại hộp
 * thoại cho đúng đối tượng đó dùng LẠI mã → máy chủ nhận ra thao tác đã ghi (trả "đã ghi", hoặc REQUEST_REUSED khi số khác) thay vì
 * ghi lần hai. Sống theo phiên trang (qua các lần mở hộp thoại / chuyển trang trong ứng dụng); tải lại trang thì mất — khi đó trang
 * hiện số tồn mới nhất trước khi thao tác.
 */
const unresolvedOperations = new Map<string, string>();

function useOperationKey(kind: 'product-create' | 'stock-in' | 'adjust') {
  const key = useRef(newRequestId());
  /** Hộp thoại mở cho `target`: thao tác mới, hoặc tiếp tục mã của lần trước chưa rõ kết quả (trả true). */
  const begin = useCallback(
    (target: string) => {
      const unresolved = unresolvedOperations.get(`${kind}:${target}`);
      key.current = unresolved ?? newRequestId();
      return unresolved !== undefined;
    },
    [kind],
  );
  /** Đã ghi (lần này, hoặc lần trước — máy chủ báo duplicate): mã đã rõ kết quả. */
  const succeeded = useCallback((target: string) => unresolvedOperations.delete(`${kind}:${target}`), [kind]);
  /** REQUEST_REUSED → mã đã được dùng (rõ kết quả); lỗi chưa rõ → giữ mã cho lần mở lại; lỗi khác (dữ liệu sai…): giữ nguyên. */
  const failed = useCallback(
    (target: string, error: unknown) => {
      const id = `${kind}:${target}`;
      if (isApiError(error, 'REQUEST_REUSED')) unresolvedOperations.delete(id);
      else if (isAmbiguousFailure(error)) unresolvedOperations.set(id, key.current);
    },
    [kind],
  );
  return { key, begin, succeeded, failed };
}

// ---------------------------------------------------------------- Sản phẩm

interface ProductDraft {
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  referencePrice: string;
  minimumStock: string;
  note: string;
  catalogStatus: CatalogStatus;
  active: boolean;
}

function draftOf(product: VppProduct | null): ProductDraft {
  return {
    productCode: product?.productCode ?? '',
    productName: product?.productName ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? '',
    referencePrice: numberToInput(product?.referencePrice),
    minimumStock: product ? numberToInput(product.minimumStock ?? 0) : '0',
    note: product?.note ?? '',
    catalogStatus: product?.catalogStatus ?? 'MASTER',
    active: product?.active ?? true,
  };
}

/** Thêm / sửa sản phẩm văn phòng phẩm (danh mục). Tồn kho KHÔNG sửa ở đây — dùng Nhập kho / Kiểm kê. */
export function ProductDialog({
  open,
  product,
  onClose,
  onSaved,
  onStale,
}: {
  open: boolean;
  /** null = thêm mới. */
  product: VppProduct | null;
  onClose: () => void;
  /** duplicate: sản phẩm đã được tạo ở lần gửi trước (lần đó mất phản hồi) — không tạo thêm. */
  onSaved: (product: VppProduct, duplicate: boolean) => void;
  /** Số liệu trên trang có thể đã khác máy chủ (lỗi chưa rõ kết quả, REQUEST_REUSED…) → trang tải lại. */
  onStale?: () => void;
}) {
  const [draft, setDraft] = useState<ProductDraft>(() => draftOf(product));
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  // Thêm mới: mã chống tạo trùng; bấm lại / mở lại sau lỗi mạng dùng cùng mã → máy chủ trả sản phẩm đã tạo (useOperationKey).
  const operation = useOperationKey('product-create');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (open) {
      setDraft(draftOf(product));
      setResumed(product ? false : operation.begin('new'));
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.productId]);

  function set<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });
  }

  async function save() {
    if (saving) return;
    const input: ProductFormInput = {
      productCode: draft.productCode,
      productName: draft.productName,
      category: draft.category,
      unit: draft.unit,
      referencePrice: parseViNumber(draft.referencePrice, 'decimal'),
      minimumStock: parseViNumber(draft.minimumStock) ?? 0,
      note: draft.note,
      catalogStatus: draft.catalogStatus,
      active: draft.active,
      ...(product ? {} : { clientRequestId: operation.key.current }),
    };
    const parsed = productSaveSchema.safeParse(input);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), {
      referencePrice: [draft.referencePrice, 'decimal'],
      minimumStock: [draft.minimumStock, 'integer'],
    });
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const saved = await vppSaveProduct(input, product?.productId);
      if (!product) operation.succeeded('new');
      onSaved(saved.product, saved.duplicate);
    } catch (err) {
      if (!product) operation.failed('new', err);
      if (shouldReload(err)) onStale?.();
      fromError(err, 'Không lưu được sản phẩm.');
    } finally {
      setSaving(false);
    }
  }

  // Sản phẩm chờ duyệt (từ đề xuất mua) chỉ đổi trạng thái bằng quyết định trong đề xuất — máy chủ từ chối đổi ở đây.
  const pendingApproval = product?.catalogStatus === 'PENDING_APPROVAL';
  const statusOptions: CatalogStatus[] = pendingApproval ? ['PENDING_APPROVAL'] : ['MASTER', 'TEMP', 'ARCHIVED'];

  return (
    <ConfirmDialog
      open={open}
      wide
      title={product ? `Sửa sản phẩm ${product.productCode}` : 'Thêm sản phẩm văn phòng phẩm'}
      description={product ? undefined : 'Sản phẩm mới có tồn = 0. Dùng “Nhập kho” (lý do Tồn đầu kỳ / Mua…) để ghi số lượng.'}
      confirmLabel={product ? 'Lưu thay đổi' : 'Thêm sản phẩm'}
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what="thêm sản phẩm" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="product-name" label="Tên sản phẩm" required error={errors.productName} className="sm:col-span-2">
          <input
            id="product-name"
            className="field-input"
            maxLength={LIMITS.productName}
            value={draft.productName}
            aria-invalid={errors.productName ? true : undefined}
            aria-describedby={describedBy('product-name', errors.productName)}
            onChange={(e) => set('productName', e.target.value)}
          />
        </Field>
        <Field id="product-code" label="Mã sản phẩm" error={errors.productCode} hint={product ? undefined : 'Để trống: hệ thống tự cấp (VPP-0001…).'}>
          <input
            id="product-code"
            className="field-input font-mono uppercase"
            maxLength={LIMITS.productCode}
            value={draft.productCode}
            aria-invalid={errors.productCode ? true : undefined}
            aria-describedby={describedBy('product-code', errors.productCode, product ? undefined : 'hint')}
            onChange={(e) => set('productCode', e.target.value)}
          />
        </Field>
        <Field id="product-unit" label="ĐVT" error={errors.unit} hint="Ví dụ: Cây, Hộp, Ram, Cuộn…">
          <input
            id="product-unit"
            className="field-input"
            maxLength={LIMITS.unit}
            value={draft.unit}
            aria-invalid={errors.unit ? true : undefined}
            aria-describedby={describedBy('product-unit', errors.unit, 'hint')}
            onChange={(e) => set('unit', e.target.value)}
          />
        </Field>
        <Field id="product-category" label="Nhóm" error={errors.category}>
          <input
            id="product-category"
            className="field-input"
            maxLength={LIMITS.productCategory}
            value={draft.category}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describedBy('product-category', errors.category)}
            onChange={(e) => set('category', e.target.value)}
          />
        </Field>
        <Field id="product-price" label="Đơn giá tham khảo (₫)" error={errors.referencePrice}>
          <NumberInput
            id="product-price"
            className="field-input"
            value={draft.referencePrice}
            aria-invalid={errors.referencePrice ? true : undefined}
            aria-describedby={describedBy('product-price', errors.referencePrice)}
            onChange={(e) => set('referencePrice', e.target.value)}
          />
        </Field>
        <Field id="product-min" label="Tồn tối thiểu" error={errors.minimumStock} hint="Khả dụng ≤ mức này → cảnh báo SẮP HẾT.">
          <NumberInput
            id="product-min"
            className="field-input"
            value={draft.minimumStock}
            aria-invalid={errors.minimumStock ? true : undefined}
            aria-describedby={describedBy('product-min', errors.minimumStock, 'hint')}
            onChange={(e) => set('minimumStock', e.target.value)}
          />
        </Field>
        <Field
          id="product-status"
          label="Trạng thái danh mục"
          error={errors.catalogStatus}
          hint={pendingApproval ? 'Sản phẩm mới từ đề xuất mua — xử lý trong trang đề xuất (Thêm vào danh mục / Giữ tạm / Ghép / Từ chối).' : undefined}
        >
          <select
            id="product-status"
            className="field-input"
            value={draft.catalogStatus}
            disabled={pendingApproval}
            aria-describedby={describedBy('product-status', errors.catalogStatus, pendingApproval ? 'hint' : undefined)}
            onChange={(e) => set('catalogStatus', e.target.value as CatalogStatus)}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {CATALOG_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2.5 self-end pb-2 text-sm font-medium text-stone-800">
          <input type="checkbox" className="size-5 accent-brand-700" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
          Đang sử dụng
        </label>
        <Field id="product-note" label="Ghi chú" error={errors.note} className="sm:col-span-2">
          <textarea
            id="product-note"
            className="field-input min-h-16"
            rows={2}
            maxLength={1000}
            value={draft.note}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy('product-note', errors.note)}
            onChange={(e) => set('note', e.target.value)}
          />
        </Field>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Nhập kho

/** Nhập kho thủ công (IN) — lý do: Mua trực tiếp / Bổ sung / Chuyển kho / Tồn đầu kỳ (INITIAL) / Khác. */
export function StockInDialog({
  open,
  product,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  product: VppProduct | null;
  onClose: () => void;
  /** duplicate: thao tác đã được ghi ở lần gửi trước (lần đó mất phản hồi) — không ghi thêm. */
  onDone: (product: VppProduct, duplicate: boolean) => void;
  /** Số liệu trên trang có thể đã khác máy chủ (lỗi chưa rõ kết quả, REQUEST_REUSED…) → trang tải lại. */
  onStale?: () => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [reasonType, setReasonType] = useState<StockInReason>('MUA_TRUC_TIEP');
  const [unitPrice, setUnitPrice] = useState('');
  const [date, setDate] = useState(todayIsoDate());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  const operation = useOperationKey('stock-in');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open) return;
    setQuantity('1');
    setReasonType(product?.stock.onHand === null ? 'TON_DAU_KY' : 'MUA_TRUC_TIEP');
    setUnitPrice(numberToInput(product?.referencePrice));
    setDate(todayIsoDate());
    setNote('');
    // Mỗi lần mở hộp thoại = một thao tác mới; bấm "Nhập kho" lại (mạng chập chờn) dùng cùng mã → không ghi 2 lần. Lần bấm trước
    // cho sản phẩm này lỗi chưa rõ kết quả → mở lại vẫn dùng mã đó (useOperationKey).
    setResumed(product ? operation.begin(product.productId) : false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.productId]);

  async function save() {
    if (saving || !product) return;
    const body = {
      productId: product.productId,
      quantity: parseViNumber(quantity) ?? NaN,
      reasonType,
      unitPrice: parseViNumber(unitPrice, 'decimal'),
      date,
      note: note.trim(),
      clientRequestId: operation.key.current,
    };
    const parsed = stockInSchema.safeParse(body);
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
      const result = await vppStockIn(body);
      operation.succeeded(product.productId);
      onDone(result.product, result.duplicate);
    } catch (err) {
      operation.failed(product.productId, err);
      if (shouldReload(err)) onStale?.();
      fromError(err, 'Không nhập kho được.');
    } finally {
      setSaving(false);
    }
  }

  const unknown = product?.stock.onHand === null;

  return (
    <ConfirmDialog
      open={open}
      title={product ? `Nhập kho: ${product.productName}` : 'Nhập kho'}
      confirmLabel="Nhập kho"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what="nhập kho" />}
      {product && (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          Tồn hiện tại: <Qty value={product.stock.onHand} unit={product.unit} /> · Đang giữ chỗ: {product.stock.reserved}
        </p>
      )}
      {unknown && (
        <InlineAlert tone="warning">
          Tồn của sản phẩm này chưa rõ{product?.stock.rawInitialValue ? ` (dữ liệu gốc: “${product.stock.rawInitialValue}”)` : ''}. Chỉ nhập được với lý do
          “Tồn đầu kỳ”, hoặc dùng “Kiểm kê” để ghi số thực tế.
        </InlineAlert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="stockin-qty" label="Số lượng" required error={errors.quantity}>
          <NumberInput
            id="stockin-qty"
            className="field-input"
            value={quantity}
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={describedBy('stockin-qty', errors.quantity)}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field id="stockin-reason" label="Lý do" required error={errors.reasonType}>
          <select id="stockin-reason" className="field-input" value={reasonType} onChange={(e) => setReasonType(e.target.value as StockInReason)}>
            {STOCK_IN_REASONS.map((r) => (
              <option key={r} value={r}>
                {STOCK_IN_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="stockin-price" label="Đơn giá (₫)" error={errors.unitPrice}>
          <NumberInput
            id="stockin-price"
            className="field-input"
            value={unitPrice}
            aria-invalid={errors.unitPrice ? true : undefined}
            aria-describedby={describedBy('stockin-price', errors.unitPrice)}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </Field>
        <Field id="stockin-date" label="Ngày nhập" error={errors.date}>
          <input
            id="stockin-date"
            type="date"
            className="field-input"
            value={date}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={describedBy('stockin-date', errors.date)}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field id="stockin-note" label="Ghi chú" required={reasonType === 'KHAC'} error={errors.note} className="sm:col-span-2">
          <textarea
            id="stockin-note"
            className="field-input min-h-16"
            rows={2}
            maxLength={LIMITS.stockReason}
            value={note}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy('stockin-note', errors.note)}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- Kiểm kê

/** "Tồn hệ thống 10 → Tồn kiểm kê 8 → Chênh −2" — hiện ngay khi nhập số kiểm kê. */
function AdjustDifference({ systemQty, counted, unit }: { systemQty: number | null; counted: string; unit: string }) {
  const value = parseViNumber(counted);
  if (value === null || !Number.isInteger(value) || value < 0) return null;
  if (systemQty === null) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
        Tồn hệ thống chưa rõ → sau kiểm kê tồn là <strong>{value}</strong>
        {unit ? ` ${unit}` : ''}.
      </p>
    );
  }
  const diff = value - systemQty;
  const tone = diff === 0 ? 'bg-stone-50 text-stone-700' : diff > 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900';
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${tone}`} role="status">
      Chênh lệch:{' '}
      <strong className="tabular-nums">
        {diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : '0'}
        {unit ? ` ${unit}` : ''}
      </strong>{' '}
      <span className="text-xs opacity-80">
        (hệ thống {systemQty} → kiểm kê {value})
      </span>
    </p>
  );
}

/** Dữ liệu tối thiểu để kiểm kê (VppProduct hoặc dòng ở trang "Dữ liệu cần kiểm tra"). */
export interface AdjustTarget {
  productId: string;
  productName: string;
  unit: string;
  stock: { onHand: number | null; reserved: number; rawInitialValue: string };
}

/** Kiểm kê / điều chỉnh (ADJUSTMENT): ghi tồn thực tế, bắt buộc lý do. Không cho thấp hơn số đang giữ chỗ. */
export function AdjustDialog({
  open,
  product,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  product: AdjustTarget | null;
  onClose: () => void;
  /** duplicate: lần kiểm kê này đã được ghi ở lần gửi trước (lần đó mất phản hồi) — không ghi thêm. */
  onDone: (product: VppProduct, duplicate: boolean) => void;
  /** Số liệu trên trang có thể đã khác máy chủ (lỗi chưa rõ kết quả, REQUEST_REUSED…) → trang tải lại. */
  onStale?: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState(false);
  const operation = useOperationKey('adjust');
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open) return;
    setCounted(product?.stock.onHand === null || product?.stock.onHand === undefined ? '' : String(product.stock.onHand));
    setReason('');
    setResumed(product ? operation.begin(product.productId) : false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.productId]);

  async function save() {
    if (saving || !product) return;
    const body = { productId: product.productId, countedQuantity: parseViNumber(counted) ?? NaN, reason: reason.trim(), clientRequestId: operation.key.current };
    const parsed = stockAdjustSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), { countedQuantity: [counted, 'integer'] });
    if (parsed.success && body.countedQuantity < product.stock.reserved) {
      fieldErrors.countedQuantity = `Không được nhỏ hơn số đang giữ chỗ cho phiếu chờ ký (${product.stock.reserved}).`;
    }
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      const result = await vppStockAdjust(body);
      operation.succeeded(product.productId);
      onDone(result.product, result.duplicate);
    } catch (err) {
      operation.failed(product.productId, err);
      if (shouldReload(err)) onStale?.();
      if (isApiError(err, 'INSUFFICIENT_STOCK')) setErrors({ countedQuantity: err.message });
      fromError(err, 'Không lưu được kiểm kê.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={product ? `Kiểm kê: ${product.productName}` : 'Kiểm kê'}
      description="Ghi số lượng thực tế đếm được. Hệ thống ghi một dòng điều chỉnh (ADJUSTMENT) với chênh lệch — không xóa lịch sử."
      confirmLabel="Lưu kiểm kê"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {resumed && <ResumedNotice what="kiểm kê" />}
      {product && (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-stone-50 p-2 text-center text-xs">
          <div>
            <dt className="text-stone-500">Tồn hệ thống</dt>
            <dd className="font-semibold">
              <Qty value={product.stock.onHand} />
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Đang giữ chỗ</dt>
            <dd className="font-semibold">{product.stock.reserved}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Dữ liệu gốc</dt>
            <dd className="font-semibold break-words">{product.stock.rawInitialValue || '—'}</dd>
          </div>
        </dl>
      )}
      <Field id="adjust-counted" label={`Tồn thực tế${product?.unit ? ` (${product.unit})` : ''}`} required error={errors.countedQuantity}>
        <NumberInput
          id="adjust-counted"
          className="field-input"
          value={counted}
          aria-invalid={errors.countedQuantity ? true : undefined}
          aria-describedby={describedBy('adjust-counted', errors.countedQuantity)}
          onChange={(e) => setCounted(e.target.value)}
        />
      </Field>
      {product && <AdjustDifference systemQty={product.stock.onHand} counted={counted} unit={product.unit} />}
      <Field id="adjust-reason" label="Lý do điều chỉnh" required error={errors.reason}>
        <textarea
          id="adjust-reason"
          className="field-input min-h-16"
          rows={2}
          maxLength={LIMITS.stockReason}
          placeholder="Ví dụ: Kiểm kê cuối tháng 10/2026"
          value={reason}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={describedBy('adjust-reason', errors.reason)}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}
