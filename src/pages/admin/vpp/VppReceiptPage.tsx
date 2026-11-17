import { CheckSquare, FileInput, PackagePlus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { stockReceiptSchema, toFieldErrors } from '../../../../shared/schemas';
import { formatVnd, STOCK_IN_REASON_LABELS, STOCK_IN_REASONS, type StockInReason, type StockVoucher, type VppProduct } from '../../../../shared/vpp';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { NumberInput } from '../../../components/ui/NumberInput';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { Qty } from '../../../components/vpp/Badges';
import { QuantityStepper } from '../../../components/vpp/QuantityStepper';
import { isAmbiguousFailure } from '../../../components/vpp/StockDialogs';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle, useUnsavedChangesWarning } from '../../../hooks/usePageMeta';
import { ApiClientError, errorMessage, isApiError } from '../../../services/api';
import { vppProducts, vppStockReceipt } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { todayIsoDate } from '../../../utils/format';
import { numberToInput, parseViNumber } from '../../../utils/number';
import { searchProducts } from '../../../utils/productSearch';
import { newRequestId } from '../../../utils/requestId';

interface Line {
  productId: string;
  quantity: number;
  price: string;
  note: string;
}

function usable(p: VppProduct): boolean {
  return p.active && p.catalogStatus !== 'ARCHIVED' && p.catalogStatus !== 'PENDING_APPROVAL';
}

/** /admin/vpp/nhap-kho — phiếu nhập kho nhiều mặt hàng: số lượng, đơn giá, nhà cung cấp, số hóa đơn. */
export default function VppReceiptPage() {
  useDocumentTitle('Nhập kho văn phòng phẩm');
  const toast = useToast();
  const list = useAsync(() => vppProducts({}), []);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [reasonType, setReasonType] = useState<StockInReason>('MUA_TRUC_TIEP');
  const [date, setDate] = useState(todayIsoDate);
  const [supplier, setSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [updatePrice, setUpdatePrice] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ voucher: StockVoucher; duplicate: boolean } | null>(null);
  const pending = useRef<{ id: string; key: string } | null>(null);
  useUnsavedChangesWarning(lines.length > 0 && !submitting);

  const products = useMemo(() => (list.data ?? []).filter(usable), [list.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products]);
  const selected = useMemo(() => new Set(lines.map((l) => l.productId)), [lines]);
  const visible = useMemo(() => searchProducts(products, query, 2000), [products, query]);

  function toggle(p: VppProduct) {
    setDone(null);
    setFormError(null);
    setLines((prev) =>
      prev.some((l) => l.productId === p.productId)
        ? prev.filter((l) => l.productId !== p.productId)
        : [...prev, { productId: p.productId, quantity: 1, price: numberToInput(p.referencePrice), note: '' }],
    );
  }

  function update(productId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function reset() {
    setLines([]);
    setNote('');
    setInvoiceNo('');
    setErrors({});
    setFormError(null);
    pending.current = null;
  }

  const total = lines.reduce((s, l) => {
    const price = parseViNumber(l.price, 'decimal');
    return price === null || Number.isNaN(price) ? s : s + price * l.quantity;
  }, 0);

  async function submit() {
    if (submitting) return;
    const local: Record<string, string> = {};
    const body = {
      reasonType,
      date,
      supplier: supplier.trim(),
      invoiceNo: invoiceNo.trim(),
      note: note.trim(),
      updatePrice,
      lines: lines.map((l, i) => {
        const price = l.price.trim() ? parseViNumber(l.price, 'decimal') : null;
        if (price !== null && Number.isNaN(price)) local[`lines.${i}.unitPrice`] = 'Đơn giá không hợp lệ (vd: 55.600)';
        return { productId: l.productId, quantity: l.quantity, unitPrice: price !== null && Number.isNaN(price) ? null : price, note: l.note.trim() };
      }),
    };
    const key = JSON.stringify(body);
    const clientRequestId = pending.current?.key === key ? pending.current.id : newRequestId();
    const parsed = stockReceiptSchema.safeParse({ ...body, clientRequestId });
    const fieldErrors = { ...(parsed.success ? {} : toFieldErrors(parsed.error)), ...local };
    setErrors(fieldErrors);
    setFormError(null);
    if (!parsed.success || Object.keys(fieldErrors).length) {
      setFormError('Kiểm tra lại các ô được đánh dấu.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await vppStockReceipt(parsed.data);
      pending.current = null;
      setDone({ voucher: result.voucher, duplicate: result.duplicate });
      toast.show(result.duplicate ? `Phiếu ${result.voucher.voucherCode} ĐÃ được ghi ở lần gửi trước — không nhập thêm.` : `Đã nhập kho — phiếu ${result.voucher.voucherCode}.`);
      reset();
      list.reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      pending.current = isAmbiguousFailure(err) ? { id: clientRequestId, key } : null;
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không nhập được kho.'));
      if (isApiError(err, 'REQUEST_REUSED') || isAmbiguousFailure(err)) list.reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Nhập kho văn phòng phẩm"
        description="Tích chọn các mặt hàng mua về, nhập số lượng + đơn giá, rồi NHẬP KHO — hệ thống ghi một phiếu nhập (NK) và cộng tồn từng mặt hàng (có lịch sử)."
        actions={
          <>
            <ButtonLink to="/admin/vpp/phieu-kho?type=IN" icon={<FileInput className="size-4" aria-hidden="true" />}>
              Phiếu đã nhập
            </ButtonLink>
            <ButtonLink to="/admin/vpp/xuat-kho">Xuất kho</ButtonLink>
          </>
        }
      />

      {done && (
        <InlineAlert tone="success">
          {done.duplicate ? 'Phiếu này đã được ghi trước đó' : 'Đã nhập kho'} — phiếu{' '}
          <Link to={`/admin/vpp/phieu-kho?id=${done.voucher.voucherId}`} className="font-mono font-semibold underline">
            {done.voucher.voucherCode}
          </Link>
          : {done.voucher.lineCount} mặt hàng, {done.voucher.totalQuantity} đơn vị
          {done.voucher.totalAmount !== null ? `, ${formatVnd(done.voucher.totalAmount)}` : ''}.
        </InlineAlert>
      )}

      {list.status === 'loading' && !list.data && (
        <div className="card space-y-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {list.status === 'error' && !list.data && <ErrorState title="Không tải được danh mục." error={list.error} onRetry={list.reload} />}

      {list.data && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <section className="card overflow-hidden" aria-labelledby="receipt-products">
            <div className="space-y-3 border-b border-stone-200 p-4">
              <h2 id="receipt-products" className="section-title">
                Chọn mặt hàng <span className="text-sm font-normal text-stone-500">({products.length} trong danh mục)</span>
              </h2>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                <input type="search" className="field-input pl-9" placeholder="Tìm tên, mã, ĐVT…" aria-label="Tìm mặt hàng" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <p className="text-xs text-stone-500">
                Mặt hàng chưa có trong danh mục: thêm ở{' '}
                <Link to="/admin/vpp/ton-kho" className="font-semibold text-brand-700 underline">
                  Tồn kho → Thêm sản phẩm
                </Link>{' '}
                hoặc cập nhật cả danh mục từ{' '}
                <Link to="/admin/vpp/nhap-excel" className="font-semibold text-brand-700 underline">
                  file Excel
                </Link>
                .
              </p>
            </div>
            {visible.length === 0 ? (
              <EmptyState title="Không có mặt hàng phù hợp." />
            ) : (
              <ul className="max-h-[70vh] divide-y divide-stone-100 overflow-y-auto" aria-label="Danh sách mặt hàng">
                {visible.map((p) => {
                  const isSelected = selected.has(p.productId);
                  return (
                    <li key={p.productId}>
                      <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-stone-50', isSelected && 'bg-brand-50/60')}>
                        <input
                          type="checkbox"
                          className="size-5 shrink-0 accent-brand-700"
                          checked={isSelected}
                          onChange={() => toggle(p)}
                          aria-label={`Chọn ${p.productName}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-words text-stone-900">{p.productName}</span>
                          <span className="block text-xs text-stone-500">
                            <span className="font-mono">{p.productCode}</span>
                            {p.unit ? ` · ${p.unit}` : ' · thiếu ĐVT'}
                            {p.referencePrice !== null ? ` · ${formatVnd(p.referencePrice)}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm">
                          <span className="block font-semibold tabular-nums">
                            <Qty value={p.stock.onHand} />
                          </span>
                          <span className="block text-[11px] text-stone-500">{p.stock.onHand === null ? 'chưa rõ tồn' : 'đang tồn'}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card space-y-4 p-4 lg:sticky lg:top-4" aria-labelledby="receipt-form">
            <div className="flex items-center justify-between gap-2">
              <h2 id="receipt-form" className="section-title">
                Phiếu nhập <span className="text-sm font-normal text-stone-500">({lines.length} mặt hàng)</span>
              </h2>
              {lines.length > 0 && (
                <Button size="sm" variant="ghost" onClick={reset} icon={<X className="size-4" aria-hidden="true" />}>
                  Bỏ chọn
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="receipt-reason" label="Lý do nhập" required error={errors.reasonType}>
                <select id="receipt-reason" className="field-input" value={reasonType} onChange={(e) => setReasonType(e.target.value as StockInReason)}>
                  {STOCK_IN_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {STOCK_IN_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="receipt-date" label="Ngày nhập" error={errors.date}>
                <input id="receipt-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="receipt-supplier" label="Nhà cung cấp" error={errors.supplier}>
                <input id="receipt-supplier" className="field-input" maxLength={120} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </Field>
              <Field id="receipt-invoice" label="Số hóa đơn / chứng từ" error={errors.invoiceNo}>
                <input id="receipt-invoice" className="field-input" maxLength={60} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
              </Field>
            </div>
            {reasonType === 'TON_DAU_KY' && (
              <p className="text-xs text-stone-600">“Tồn đầu kỳ” dùng được cả cho mặt hàng đang “chưa rõ tồn”: số nhập trở thành tồn ban đầu.</p>
            )}

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
                <CheckSquare className="mx-auto mb-1 size-5 text-stone-400" aria-hidden="true" />
                Tích chọn mặt hàng trong danh sách “Chọn mặt hàng”.
              </p>
            ) : (
              <ol className="space-y-2">
                {lines.map((l, i) => {
                  const p = byId.get(l.productId);
                  const price = parseViNumber(l.price, 'decimal');
                  const unknown = p?.stock.onHand === null;
                  return (
                    <li key={l.productId} className={cn('rounded-lg border p-3', errors[`lines.${i}.productId`] ? 'border-red-300 bg-red-50/40' : 'border-stone-200')}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-medium break-words text-stone-900">
                          {p?.productName ?? 'Mặt hàng'}
                          <span className={cn('block text-xs font-normal', unknown ? 'text-amber-800' : 'text-stone-500')}>
                            {unknown ? 'Tồn chưa rõ — chọn lý do “Tồn đầu kỳ” hoặc kiểm kê trước' : <>Đang tồn: <Qty value={p?.stock.onHand} unit={p?.unit} /></>}
                          </span>
                        </p>
                        <button
                          type="button"
                          className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-700"
                          aria-label={`Bỏ ${p?.productName ?? 'mặt hàng'}`}
                          onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                        <QuantityStepper id={`receipt-qty-${i}`} label={`Số lượng nhập ${p?.productName ?? ''}`} value={l.quantity} onChange={(v) => update(l.productId, { quantity: v })} />
                        <NumberInput
                          className="field-input py-1.5 text-right"
                          placeholder="Đơn giá"
                          aria-label={`Đơn giá ${p?.productName ?? ''}`}
                          aria-invalid={errors[`lines.${i}.unitPrice`] ? true : undefined}
                          value={l.price}
                          onChange={(e) => update(l.productId, { price: e.target.value })}
                        />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          className="field-input min-w-0 flex-1 py-1.5 text-sm"
                          placeholder="Ghi chú (tùy chọn)"
                          aria-label={`Ghi chú ${p?.productName ?? ''}`}
                          maxLength={500}
                          value={l.note}
                          onChange={(e) => update(l.productId, { note: e.target.value })}
                        />
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{price !== null && !Number.isNaN(price) ? formatVnd(price * l.quantity) : '—'}</span>
                      </div>
                      {(errors[`lines.${i}.productId`] || errors[`lines.${i}.unitPrice`] || errors[`lines.${i}.quantity`] || errors[`lines.${i}.note`]) && (
                        <p className="mt-1 text-xs font-medium text-red-700">
                          {errors[`lines.${i}.productId`] || errors[`lines.${i}.unitPrice`] || errors[`lines.${i}.quantity`] || errors[`lines.${i}.note`]}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {lines.length > 0 && (
              <p className="flex justify-between border-t border-stone-200 pt-2 text-sm">
                <span>Tổng tiền (theo đơn giá đã nhập)</span>
                <strong className="tabular-nums">{formatVnd(total)}</strong>
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" className="size-4 accent-brand-700" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} />
              Cập nhật đơn giá tham khảo theo giá nhập
            </label>
            <Field id="receipt-note" label="Ghi chú phiếu" error={errors.note} required={reasonType === 'KHAC'}>
              <textarea id="receipt-note" className="field-input min-h-16" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={lines.length === 0} onClick={submit} icon={<PackagePlus className="size-5" aria-hidden="true" />}>
              NHẬP KHO
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
