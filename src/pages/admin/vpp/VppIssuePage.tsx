import { CheckSquare, FileOutput, FileSignature, PackageMinus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { stockIssueSchema, toFieldErrors } from '../../../../shared/schemas';
import type { Employee } from '../../../../shared/types';
import type { StockVoucher, StockWarning, VppProduct } from '../../../../shared/vpp';
import { EmployeeCombobox } from '../../../components/EmployeeCombobox';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { describedBy, Field } from '../../../components/ui/Field';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { Qty } from '../../../components/vpp/Badges';
import { saveVppPrefill } from '../../../components/vpp/prefill';
import { QuantityStepper } from '../../../components/vpp/QuantityStepper';
import { isAmbiguousFailure } from '../../../components/vpp/StockDialogs';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle, useUnsavedChangesWarning } from '../../../hooks/usePageMeta';
import { adminEmployees } from '../../../services/adminApi';
import { ApiClientError, errorMessage, isApiError } from '../../../services/api';
import { vppProducts, vppStockIssue, vppVouchers } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { todayIsoDate } from '../../../utils/format';
import { searchProducts } from '../../../utils/productSearch';
import { newRequestId } from '../../../utils/requestId';

interface Line {
  productId: string;
  quantity: number;
  note: string;
}

function usable(p: VppProduct): boolean {
  return p.active && p.catalogStatus !== 'ARCHIVED' && p.catalogStatus !== 'PENDING_APPROVAL';
}

/** Còn hàng lên đầu (khả dụng nhiều → ít), rồi hết hàng, cuối cùng chưa rõ tồn; cùng nhóm theo tên. */
function byAvailability(a: VppProduct, b: VppProduct): number {
  const rank = (p: VppProduct) => (p.stock.available === null ? 2 : p.stock.available > 0 ? 0 : 1);
  return rank(a) - rank(b) || (b.stock.available ?? 0) - (a.stock.available ?? 0) || a.productName.localeCompare(b.productName, 'vi');
}

/** /admin/vpp/xuat-kho — xuất kho trực tiếp cho phòng ban / người nhận: tích chọn nhiều mặt hàng (còn hàng hiện trước). */
export default function VppIssuePage() {
  useDocumentTitle('Xuất kho văn phòng phẩm');
  const toast = useToast();
  const navigate = useNavigate();
  const data = useAsync(async (signal) => {
    const [products, employees, vouchers] = await Promise.all([
      vppProducts({}),
      adminEmployees(),
      vppVouchers({ type: 'OUT', pageSize: 10 }, signal).catch(() => null),
    ]);
    return { products, employees, departments: vouchers?.departments ?? [] };
  }, []);
  const [query, setQuery] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [department, setDepartment] = useState('');
  const [receiver, setReceiver] = useState<Employee | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [date, setDate] = useState(todayIsoDate);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ voucher: StockVoucher; warnings: StockWarning[]; duplicate: boolean } | null>(null);
  // Lần gửi lỗi chưa rõ kết quả (mất mạng…) → gửi lại CÙNG mã thao tác nếu nội dung không đổi (máy chủ không xuất 2 lần).
  const pending = useRef<{ id: string; key: string } | null>(null);
  const allowLeave = useUnsavedChangesWarning(lines.length > 0 && !done && !submitting);

  const products = useMemo(() => (data.data?.products ?? []).filter(usable), [data.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products]);
  const selected = useMemo(() => new Set(lines.map((l) => l.productId)), [lines]);
  const visible = useMemo(() => {
    const list = searchProducts(products, query, 2000).filter((p) => !onlyInStock || (p.stock.available ?? 0) > 0 || selected.has(p.productId));
    return query.trim() ? list : [...list].sort(byAvailability);
  }, [products, query, onlyInStock, selected]);
  const inStockCount = products.filter((p) => (p.stock.available ?? 0) > 0).length;
  const departments = useMemo(() => {
    const set = new Set<string>(data.data?.departments ?? []);
    for (const e of data.data?.employees ?? []) if (e.department) set.add(e.department);
    return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [data.data]);

  function toggle(p: VppProduct) {
    setDone(null);
    setFormError(null);
    setLines((prev) =>
      prev.some((l) => l.productId === p.productId) ? prev.filter((l) => l.productId !== p.productId) : [...prev, { productId: p.productId, quantity: 1, note: '' }],
    );
  }

  function update(productId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function reset() {
    setLines([]);
    setNote('');
    setErrors({});
    setFormError(null);
    pending.current = null;
  }

  async function submit() {
    if (submitting) return;
    const body = {
      date,
      department: department.trim(),
      receiverEmployeeId: receiver?.employeeId ?? '',
      receiverName: receiver ? receiver.fullName : receiverName.trim(),
      note: note.trim(),
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, note: l.note.trim() })),
    };
    const key = JSON.stringify(body);
    const clientRequestId = pending.current?.key === key ? pending.current.id : newRequestId();
    const parsed = stockIssueSchema.safeParse({ ...body, clientRequestId });
    // Kiểm tra trước trên trình duyệt: không vượt khả dụng đang hiện.
    const local: Record<string, string> = parsed.success ? {} : toFieldErrors(parsed.error);
    lines.forEach((l, i) => {
      const p = byId.get(l.productId);
      const available = p?.stock.available ?? 0;
      if (p && l.quantity > available) local[`lines.${i}.quantity`] = `Chỉ còn ${Math.max(0, available)}${p.unit ? ` ${p.unit}` : ''} khả dụng`;
    });
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length || !parsed.success) {
      setFormError('Kiểm tra lại các ô được đánh dấu.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await vppStockIssue(parsed.data);
      pending.current = null;
      setDone({ voucher: result.voucher, warnings: result.warnings ?? [], duplicate: result.duplicate });
      toast.show(result.duplicate ? `Phiếu ${result.voucher.voucherCode} ĐÃ được ghi ở lần gửi trước — không xuất thêm.` : `Đã xuất kho — phiếu ${result.voucher.voucherCode}.`);
      reset();
      data.reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (isAmbiguousFailure(err)) pending.current = { id: clientRequestId, key };
      else pending.current = null;
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không xuất được kho.'));
      if (isApiError(err, 'INSUFFICIENT_STOCK') || isApiError(err, 'REQUEST_REUSED') || isAmbiguousFailure(err)) data.reload();
    } finally {
      setSubmitting(false);
    }
  }

  function toHandover() {
    saveVppPrefill({ lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), receiverEmployeeId: receiver?.employeeId ?? '' });
    allowLeave(); // các mặt hàng được mang sang form phiếu bàn giao — không hỏi "chưa được lưu sẽ bị mất"
    navigate('/admin/ban-giao/tao-moi?loai=OFFICE_SUPPLY&prefill=1');
  }

  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Xuất kho văn phòng phẩm"
        description="Tích chọn mặt hàng (còn hàng hiện trước, nhiều → ít), nhập số lượng rồi XUẤT KHO cho phòng ban / người nhận. Chỉ xuất được phần khả dụng — phần đang giữ cho phiếu bàn giao chờ ký không bị đụng tới."
        actions={
          <>
            <ButtonLink to="/admin/vpp/phieu-kho?type=OUT" icon={<FileOutput className="size-4" aria-hidden="true" />}>
              Phiếu đã xuất
            </ButtonLink>
            <ButtonLink to="/admin/vpp/nhap-kho">Nhập kho</ButtonLink>
          </>
        }
      />

      {done && (
        <InlineAlert tone="success">
          <p className="font-semibold">
            {done.duplicate ? 'Phiếu này đã được ghi trước đó' : 'Đã xuất kho'} — phiếu{' '}
            <Link to={`/admin/vpp/phieu-kho?id=${done.voucher.voucherId}`} className="font-mono underline">
              {done.voucher.voucherCode}
            </Link>
            : {done.voucher.lineCount} mặt hàng, {done.voucher.totalQuantity} đơn vị
            {done.voucher.department ? ` → ${done.voucher.department}` : ''}
            {done.voucher.receiverName ? ` · ${done.voucher.receiverName}` : ''}.
          </p>
          {done.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {done.warnings.map((w) => (
                <li key={w.productId}>
                  {w.productName}: {w.type === 'LAST_ITEM' ? 'đã hết hàng khả dụng' : `sắp hết (còn ${w.available}, tối thiểu ${w.minimumStock ?? 0})`}
                </li>
              ))}
            </ul>
          )}
        </InlineAlert>
      )}

      {data.status === 'loading' && !data.data && (
        <div className="card space-y-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {data.status === 'error' && !data.data && <ErrorState title="Không tải được danh mục." error={data.error} onRetry={data.reload} />}

      {data.data && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <section className="card overflow-hidden" aria-labelledby="issue-products">
            <div className="space-y-3 border-b border-stone-200 p-4">
              <h2 id="issue-products" className="section-title">
                Chọn mặt hàng <span className="text-sm font-normal text-stone-500">({inStockCount} mặt hàng còn hàng)</span>
              </h2>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                <input type="search" className="field-input pl-9" placeholder="Tìm tên, mã, ĐVT…" aria-label="Tìm mặt hàng" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" className="size-4 accent-brand-700" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
                Chỉ hiện mặt hàng còn hàng
              </label>
            </div>
            {visible.length === 0 ? (
              <EmptyState title={onlyInStock ? 'Không có mặt hàng còn hàng phù hợp.' : 'Không có mặt hàng phù hợp.'} description="Nhập kho trước hoặc bỏ tích “Chỉ hiện mặt hàng còn hàng”." />
            ) : (
              <ul className="max-h-[70vh] divide-y divide-stone-100 overflow-y-auto" aria-label="Danh sách mặt hàng">
                {visible.map((p) => {
                  const available = p.stock.available;
                  const can = available !== null && available > 0;
                  const isSelected = selected.has(p.productId);
                  return (
                    <li key={p.productId}>
                      <label
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5',
                          can || isSelected ? 'cursor-pointer hover:bg-stone-50' : 'cursor-not-allowed opacity-60',
                          isSelected && 'bg-brand-50/60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-5 shrink-0 accent-brand-700"
                          checked={isSelected}
                          disabled={!can && !isSelected}
                          onChange={() => toggle(p)}
                          aria-label={`Chọn ${p.productName}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-words text-stone-900">{p.productName}</span>
                          <span className="block text-xs text-stone-500">
                            <span className="font-mono">{p.productCode}</span>
                            {p.unit ? ` · ${p.unit}` : ''}
                            {p.stock.reserved > 0 ? ` · đang giữ chỗ ${p.stock.reserved}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn('block text-lg font-bold tabular-nums', can ? 'text-emerald-700' : 'text-stone-400')}>
                            <Qty value={available} />
                          </span>
                          <span className="block text-[11px] text-stone-500">{available === null ? 'chưa rõ — kiểm kê' : 'khả dụng'}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card space-y-4 p-4 lg:sticky lg:top-4" aria-labelledby="issue-form">
            <div className="flex items-center justify-between gap-2">
              <h2 id="issue-form" className="section-title">
                Phiếu xuất <span className="text-sm font-normal text-stone-500">({lines.length} mặt hàng · {totalQty} đơn vị)</span>
              </h2>
              {lines.length > 0 && (
                <Button size="sm" variant="ghost" onClick={reset} icon={<X className="size-4" aria-hidden="true" />}>
                  Bỏ chọn
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field id="issue-department" label="Phòng ban nhận" error={errors.department} hint="Chọn trong danh sách hoặc gõ tên">
                <input
                  id="issue-department"
                  className="field-input"
                  list="issue-departments"
                  maxLength={120}
                  value={department}
                  aria-describedby={describedBy('issue-department', errors.department, 'x')}
                  onChange={(e) => setDepartment(e.target.value)}
                />
                <datalist id="issue-departments">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              <Field id="issue-date" label="Ngày xuất" error={errors.date}>
                <input id="issue-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <EmployeeCombobox
              id="issue-receiver"
              label="Người nhận (không bắt buộc)"
              employees={data.data.employees}
              selected={receiver}
              onSelect={(e) => {
                setReceiver(e);
                if (e?.department && !department) setDepartment(e.department);
              }}
              freeText={{ value: receiverName, onChange: setReceiverName }}
              error={errors.receiverEmployeeId}
              hint="Chọn nhân viên (tự điền phòng ban) hoặc gõ tên người nhận."
            />

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
                <CheckSquare className="mx-auto mb-1 size-5 text-stone-400" aria-hidden="true" />
                Tích chọn mặt hàng trong danh sách “Chọn mặt hàng”.
              </p>
            ) : (
              <ol className="space-y-2">
                {lines.map((l, i) => {
                  const p = byId.get(l.productId);
                  const max = Math.max(1, p?.stock.available ?? 1);
                  return (
                    <li key={l.productId} className={cn('rounded-lg border p-3', errors[`lines.${i}.quantity`] ? 'border-red-300 bg-red-50/40' : 'border-stone-200')}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-medium break-words text-stone-900">
                          {p?.productName ?? 'Mặt hàng'}
                          <span className="block text-xs font-normal text-stone-500">
                            Khả dụng: <Qty value={p?.stock.available} unit={p?.unit} />
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <QuantityStepper
                          id={`issue-qty-${i}`}
                          label={`Số lượng xuất ${p?.productName ?? ''}`}
                          value={l.quantity}
                          max={max}
                          invalid={Boolean(errors[`lines.${i}.quantity`])}
                          onChange={(v) => update(l.productId, { quantity: v })}
                        />
                        <input
                          className="field-input min-w-0 flex-1 py-1.5 text-sm"
                          placeholder="Ghi chú (tùy chọn)"
                          aria-label={`Ghi chú ${p?.productName ?? ''}`}
                          maxLength={500}
                          value={l.note}
                          onChange={(e) => update(l.productId, { note: e.target.value })}
                        />
                      </div>
                      {errors[`lines.${i}.quantity`] && <p className="mt-1 text-xs font-medium text-red-700">{errors[`lines.${i}.quantity`]}</p>}
                      {errors[`lines.${i}.note`] && <p className="mt-1 text-xs font-medium text-red-700">{errors[`lines.${i}.note`]}</p>}
                    </li>
                  );
                })}
              </ol>
            )}

            <Field id="issue-note" label="Ghi chú phiếu" error={errors.note}>
              <textarea id="issue-note" className="field-input min-h-16" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            {formError && <InlineAlert>{formError}</InlineAlert>}

            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
                disabled={lines.length === 0}
                onClick={submit}
                icon={<PackageMinus className="size-5" aria-hidden="true" />}
              >
                XUẤT KHO
              </Button>
              <Button variant="secondary" fullWidth disabled={lines.length === 0 || submitting} onClick={toHandover} icon={<FileSignature className="size-4" aria-hidden="true" />}>
                Tạo phiếu bàn giao (người nhận ký) với các mặt hàng này
              </Button>
              <p className="text-xs text-stone-500">
                <strong>Xuất kho</strong>: trừ tồn ngay, ghi phiếu XK (không cần chữ ký). <strong>Phiếu bàn giao</strong>: giữ chỗ, trừ tồn khi người
                nhận ký trên điện thoại.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
