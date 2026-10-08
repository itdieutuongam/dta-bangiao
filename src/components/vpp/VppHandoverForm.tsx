import { CalendarDays, PackagePlus, Search, ShoppingCart, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import { handoverInputSchema, toFieldErrors } from '../../../shared/schemas';
import type { Employee, HandoverInput } from '../../../shared/types';
import type { HandoverContextProduct } from '../../../shared/vpp';
import { useAsync } from '../../hooks/useAsync';
import { useUnsavedChangesWarning } from '../../hooks/usePageMeta';
import { ApiClientError, errorMessage, isApiError } from '../../services/api';
import { vppHandoverContext } from '../../services/vppApi';
import { cn } from '../../utils/cn';
import { formatDate, todayIsoDate } from '../../utils/format';
import { searchProducts } from '../../utils/productSearch';
import { EmployeeCombobox } from '../EmployeeCombobox';
import { newUid } from '../handover/formModel';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { describedBy, Field } from '../ui/Field';
import { ErrorState, InlineAlert, Skeleton } from '../ui/States';
import { Qty, StockStatusBadge } from './Badges';
import { QuantityStepper } from './QuantityStepper';

export interface VppLine {
  uid: string;
  productId: string;
  quantity: number;
  note: string;
  overNormReason: string;
}

export interface VppFormValues {
  senderName: string;
  senderEmployee: Employee | null;
  receiver: Employee | null;
  note: string;
  lines: VppLine[];
}

type LineErrors = Partial<Record<'productId' | 'quantity' | 'overNormReason' | 'note', string>>;

interface Props {
  employees: Employee[];
  initialValues?: VppFormValues;
  /** Khi sửa phiếu: số đang giữ chỗ cho chính phiếu này được tính vào khả dụng. */
  handoverId?: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  onSubmit: (input: HandoverInput) => Promise<void>;
  onCancel?: () => void;
  /** Thao tác đi kèm thông báo lỗi khi lưu (vd. link mở phiếu đã tạo khi REQUEST_REUSED); clear: ẩn thông báo. */
  submitErrorActions?: (error: unknown, clear: () => void) => ReactNode;
}

export function newVppLine(productId: string, quantity = 1): VppLine {
  return { uid: newUid(), productId, quantity, note: '', overNormReason: '' };
}

/** Link tới trang đề xuất mua, điền sẵn sản phẩm + số lượng (kèm tên / ĐVT cho sản phẩm chưa vào danh mục công khai). */
function proposalLink(product: { productId: string; productName: string; unit: string } | undefined, productId: string, quantity: number): string {
  const params = new URLSearchParams({ sp: productId, sl: String(Math.max(1, quantity)) });
  if (product) {
    params.set('ten', product.productName);
    if (product.unit) params.set('dvt', product.unit);
  }
  return `/de-xuat-vpp?${params.toString()}`;
}

/** Thông tin tính toán của một dòng: khả dụng, còn lại sau phiếu, vượt định mức. */
function lineInfo(line: VppLine, product: HandoverContextProduct | undefined) {
  const available = product?.stock.available ?? null;
  const remaining = available === null ? null : available - line.quantity;
  const normRemaining = product?.norm ? product.norm.remaining : null;
  const overNorm = normRemaining === null ? 0 : Math.max(0, line.quantity - normRemaining);
  return { available, remaining, overNorm, insufficient: available === null || line.quantity > available };
}

export function VppHandoverForm({ employees, initialValues, handoverId, submitLabel, submitIcon, onSubmit, onCancel, submitErrorActions }: Props) {
  const [values, setValues] = useState<VppFormValues>(
    () => initialValues ?? { senderName: '', senderEmployee: null, receiver: null, note: '', lines: [] },
  );
  const [general, setGeneral] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [lastItemCheck, setLastItemCheck] = useState<{ input: HandoverInput; items: Array<{ name: string; available: number; quantity: number }> } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useUnsavedChangesWarning(dirty && !submitting);

  const receiverId = values.receiver?.employeeId ?? '';
  const context = useAsync(() => vppHandoverContext(receiverId, handoverId ?? ''), [receiverId, handoverId]);
  const products = useMemo(() => context.data?.products ?? [], [context.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products]);
  const chosen = new Set(values.lines.map((l) => l.productId));
  const candidates = searchProducts(products.filter((p) => !chosen.has(p.productId)), query, 60);

  function patch(next: Partial<VppFormValues>) {
    setValues((v) => ({ ...v, ...next }));
    setDirty(true);
  }

  function updateLine(uid: string, next: Partial<VppLine>) {
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.uid === uid ? { ...l, ...next } : l)) }));
    setLineErrors((e) => {
      if (!e[uid]) return e;
      const copy = { ...e };
      delete copy[uid];
      return copy;
    });
    setDirty(true);
  }

  function addProduct(product: HandoverContextProduct) {
    patch({ lines: [...values.lines, newVppLine(product.productId, 1)] });
    setGeneral((g) => {
      const copy = { ...g };
      delete copy.supplies;
      return copy;
    });
    setQuery('');
    searchRef.current?.focus();
  }

  function removeLine(uid: string) {
    patch({ lines: values.lines.filter((l) => l.uid !== uid) });
  }

  function buildInput(): HandoverInput {
    return {
      handoverType: 'OFFICE_SUPPLY',
      sender: values.senderEmployee
        ? { name: values.senderEmployee.fullName, employeeId: values.senderEmployee.employeeId }
        : { name: values.senderName, employeeId: '' },
      receiverEmployeeId: values.receiver?.employeeId ?? '',
      note: values.note,
      items: [],
      supplies: values.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, note: l.note, overNormReason: l.overNormReason })),
    };
  }

  function applyServerErrors(fieldErrors: Record<string, string>) {
    const nextGeneral: Record<string, string> = {};
    const nextLines: Record<string, LineErrors> = {};
    for (const [path, message] of Object.entries(fieldErrors)) {
      const m = /^supplies\.(\d+)\.(\w+)$/.exec(path);
      const line = m ? values.lines[Number(m[1])] : undefined;
      if (m && line) (nextLines[line.uid] ??= {})[m[2] as keyof LineErrors] = message;
      else nextGeneral[path] = message;
    }
    setGeneral(nextGeneral);
    setLineErrors(nextLines);
  }

  async function send(input: HandoverInput) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) applyServerErrors(err.fieldErrors);
      // Tồn / định mức vừa thay đổi (admin khác, tab khác vừa tạo phiếu) → tải lại số liệu để form hiện đúng.
      if (isApiError(err, 'INSUFFICIENT_STOCK') || isApiError(err, 'NORM_EXCEEDED')) context.reload();
      setSubmitError(errorMessage(err, 'Không thể lưu phiếu. Vui lòng thử lại.'));
      setSubmitFailure(err);
    } finally {
      setSubmitting(false);
    }
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
      if (context.data && !byId.has(line.productId)) {
        fieldErrors[`supplies.${i}.productId`] ??= 'Sản phẩm đã ngừng dùng hoặc đã được gộp — xóa dòng này và chọn sản phẩm khác.';
        return;
      }
      const info = lineInfo(line, byId.get(line.productId));
      if (info.available === null) fieldErrors[`supplies.${i}.quantity`] ??= 'Tồn kho chưa xác định — cần kiểm kê trước khi bàn giao.';
      else if (info.insufficient) {
        fieldErrors[`supplies.${i}.quantity`] ??= `Không đủ tồn kho. Khả dụng: ${info.available}, yêu cầu: ${line.quantity}, thiếu: ${line.quantity - info.available}.`;
      }
      if (info.overNorm > 0 && !line.overNormReason.trim()) {
        fieldErrors[`supplies.${i}.overNormReason`] ??= `Vượt định mức ${info.overNorm} — bắt buộc nhập lý do vượt định mức.`;
      }
    });
    if (Object.keys(fieldErrors).length) {
      applyServerErrors(fieldErrors);
      document.getElementById(fieldErrors.receiverEmployeeId ? 'receiver' : fieldErrors['sender.name'] ? 'sender-name' : 'vpp-lines')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Sản phẩm sẽ hết sau phiếu này → xác nhận trước (không chặn).
    const lastItems = values.lines
      .map((line) => ({ line, product: byId.get(line.productId), info: lineInfo(line, byId.get(line.productId)) }))
      .filter((x) => x.info.remaining === 0)
      .map((x) => ({ name: x.product?.productName ?? '', available: x.info.available ?? 0, quantity: x.line.quantity }));
    if (lastItems.length) {
      setLastItemCheck({ input: parsed.success ? parsed.data : input, items: lastItems });
      return;
    }
    await send(parsed.success ? parsed.data : input);
  }

  const scope = context.data?.scope ?? null;

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <section className="card p-4 sm:p-6" aria-labelledby="vpp-people">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="vpp-people" className="section-title">
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
            hint="Chọn từ danh sách hoặc nhập họ tên người bàn giao."
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
              hint="Bắt buộc chọn từ danh sách nhân viên (mã NV, phòng ban tự điền)."
            />
            {/* Số liệu (định mức, tồn) theo người nhận: đang tải / tải lỗi sau khi đổi người nhận thì số đang hiện là của lần
                tải trước (có thể của người nhận khác) — báo rõ, không hiện như số của người nhận đang chọn. */}
            {values.receiver && context.status === 'loading' && context.data && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600" role="status">
                Đang tải định mức và tồn kho cho người nhận này…
              </p>
            )}
            {context.status === 'error' && context.data && (
              <InlineAlert>
                <p>
                  Không tải được định mức và tồn kho mới nhất{values.receiver ? ' cho người nhận này' : ''} — số liệu bên dưới có thể chưa đúng
                  (máy chủ vẫn kiểm tra lại khi lưu). {errorMessage(context.error)}
                </p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={context.reload}>
                  Thử lại
                </Button>
              </InlineAlert>
            )}
            {values.receiver && context.status === 'success' && (
              <p className={cn('rounded-lg px-3 py-2 text-xs', scope ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900')}>
                {scope ? (
                  <>
                    Định mức áp dụng: <strong>{scope.scopeName}</strong> (tháng {context.data.month.split('-').reverse().join('/')})
                  </>
                ) : (
                  <>
                    Phòng ban <strong>{values.receiver.department || '(trống)'}</strong> chưa gắn định mức — không kiểm tra định mức.{' '}
                    <Link to="/admin/vpp/dinh-muc" className="font-semibold underline">
                      Gắn phòng ban
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="vpp-picker">
        <h2 id="vpp-picker" className="section-title">
          Chọn văn phòng phẩm
        </h2>
        <p className="mt-1 text-sm text-stone-500">Chọn sản phẩm từ kho. Khi tạo phiếu, số lượng được giữ chỗ; trừ tồn khi người nhận ký xác nhận.</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            className="field-input pl-9"
            placeholder="Tìm theo tên, mã, ĐVT, nhóm — có dấu hoặc không (vd: but bi)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Tìm văn phòng phẩm"
          />
        </div>
        <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-stone-200" aria-busy={context.status === 'loading'}>
          {context.status === 'loading' && !context.data && (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {context.status === 'error' && !context.data && (
            <ErrorState className="border-0 shadow-none" title="Không tải được danh mục văn phòng phẩm." error={context.error} onRetry={context.reload} />
          )}
          {context.data && candidates.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-stone-500">
              {products.length === 0 ? 'Chưa có sản phẩm nào trong kho.' : 'Không tìm thấy sản phẩm phù hợp.'}
            </p>
          )}
          <ul className="divide-y divide-stone-100">
            {candidates.map((p) => {
              const available = p.stock.available;
              const out = available === null || available <= 0;
              return (
                <li key={p.productId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium break-words text-stone-900">{p.productName}</p>
                    <p className="text-xs text-stone-500">
                      {[p.productCode, p.unit, p.category].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-600">
                      Tồn: <Qty value={p.stock.onHand} /> · Đang giữ: <Qty value={p.stock.reserved - p.reservedByThisHandover} /> · Khả dụng:{' '}
                      <strong>
                        <Qty value={available} />
                      </strong>
                      {p.norm && (
                        <>
                          {' '}
                          · Định mức: {p.norm.monthlyQuantity}/tháng (còn {Math.max(0, p.norm.remaining)})
                        </>
                      )}
                    </p>
                  </div>
                  {out ? (
                    <span className="flex items-center gap-2">
                      <StockStatusBadge status={p.stock.status} />
                      <Link
                        to={proposalLink(p, p.productId, 1)}
                        className="text-xs font-semibold text-brand-700 underline"
                        target="_blank"
                        rel="noopener"
                      >
                        Tạo đề xuất mua
                      </Link>
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => addProduct(p)} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
                      Thêm
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="vpp-lines" className="card p-4 sm:p-6" aria-labelledby="vpp-lines-title">
        <h2 id="vpp-lines-title" className="section-title flex items-center gap-2">
          Danh sách văn phòng phẩm
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-800">{values.lines.length}</span>
        </h2>
        {general.supplies && <InlineAlert className="mt-3">{general.supplies}</InlineAlert>}
        {values.lines.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
            Chưa chọn sản phẩm nào — tìm và bấm “Thêm” ở trên.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {values.lines.map((line, index) => {
              const product = byId.get(line.productId);
              const info = lineInfo(line, product);
              const errs = lineErrors[line.uid] ?? {};
              const qtyId = `vpp-${line.uid}-qty`;
              const shortage = info.available === null ? line.quantity : line.quantity - info.available;
              return (
                <li key={line.uid} className={cn('rounded-xl border bg-white p-4', Object.keys(errs).length ? 'border-red-300' : 'border-stone-200')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-brand-700">#{index + 1}</p>
                      <p className="font-semibold break-words text-stone-900">{product?.productName ?? 'Sản phẩm không còn trong kho'}</p>
                      <p className="text-xs text-stone-500">{[product?.productCode, product?.unit].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-700" onClick={() => removeLine(line.uid)} aria-label={`Xóa dòng ${index + 1}`} icon={<Trash2 className="size-4" aria-hidden="true" />} />
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-stone-50 p-2 text-center text-xs">
                    <div>
                      <dt className="text-stone-500">Tồn</dt>
                      <dd className="font-semibold">
                        <Qty value={product?.stock.onHand} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">Đang giữ</dt>
                      <dd className="font-semibold">
                        <Qty value={product ? product.stock.reserved - product.reservedByThisHandover : null} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">Khả dụng</dt>
                      <dd className="font-semibold text-brand-800">
                        <Qty value={info.available} />
                      </dd>
                    </div>
                  </dl>
                  {product?.norm && (
                    <p className="mt-2 text-xs text-stone-600">
                      Định mức tháng: <strong>{product.norm.monthlyQuantity}</strong> · Đã cấp: {product.norm.issued}
                      {product.norm.pending ? ` (đang chờ ký ${product.norm.pending})` : ''} · Còn: <strong>{Math.max(0, product.norm.remaining)}</strong>
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label htmlFor={qtyId} className="text-sm font-medium text-stone-700">
                      Số lượng
                    </label>
                    <QuantityStepper
                      id={qtyId}
                      label={`số lượng ${product?.productName ?? ''}`}
                      value={line.quantity}
                      min={1}
                      max={LIMITS.maxQuantity}
                      invalid={Boolean(errs.quantity)}
                      describedBy={errs.quantity ? `${qtyId}-error` : undefined}
                      onChange={(quantity) => updateLine(line.uid, { quantity })}
                    />
                    {product?.unit && <span className="text-sm text-stone-500">{product.unit}</span>}
                  </div>
                  {errs.productId && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">
                      {errs.productId}
                    </p>
                  )}
                  {product && info.insufficient && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" id={`${qtyId}-error`}>
                      <p className="font-semibold">Không đủ tồn kho.</p>
                      <p>
                        Khả dụng: {info.available ?? 'chưa rõ'} · Yêu cầu: {line.quantity} · Thiếu: {Math.max(0, shortage)}
                      </p>
                      <Link
                        to={proposalLink(product, line.productId, shortage)}
                        target="_blank"
                        rel="noopener"
                        className="mt-1 inline-flex items-center gap-1 font-semibold underline"
                      >
                        <ShoppingCart className="size-4" aria-hidden="true" />
                        TẠO ĐỀ XUẤT MUA
                      </Link>
                    </div>
                  )}
                  {(!product || !info.insufficient) && errs.quantity && (
                    <p id={`${qtyId}-error`} className="mt-1 text-xs font-medium text-red-700">
                      {errs.quantity}
                    </p>
                  )}
                  {!info.insufficient && info.remaining === 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-orange-800">
                      <TriangleAlert className="size-4" aria-hidden="true" />
                      Sản phẩm sẽ hết sau phiếu này (còn lại 0).
                    </p>
                  )}
                  {/* Hiện cả khi máy chủ báo vượt định mức mà số liệu trên trang chưa kịp cập nhật — không để form "kẹt". */}
                  {(info.overNorm > 0 || Boolean(errs.overNormReason) || line.overNormReason.trim() !== '') && (
                    <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                        <TriangleAlert className="size-4" aria-hidden="true" />
                        {info.overNorm > 0 ? `VƯỢT ĐỊNH MỨC ${info.overNorm}` : 'VƯỢT ĐỊNH MỨC'}
                      </p>
                      <Field id={`vpp-${line.uid}-reason`} label="Lý do vượt định mức" required error={errs.overNormReason}>
                        <textarea
                          id={`vpp-${line.uid}-reason`}
                          className="field-input min-h-16"
                          rows={2}
                          maxLength={LIMITS.overNormReason}
                          value={line.overNormReason}
                          aria-invalid={errs.overNormReason ? true : undefined}
                          aria-describedby={describedBy(`vpp-${line.uid}-reason`, errs.overNormReason)}
                          onChange={(e) => updateLine(line.uid, { overNormReason: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                  <Field id={`vpp-${line.uid}-note`} label="Ghi chú" error={errs.note} className="mt-3">
                    <input
                      id={`vpp-${line.uid}-note`}
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

      <section className="card p-4 sm:p-6" aria-labelledby="vpp-note-title">
        <h2 id="vpp-note-title" className="section-title">
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

      <ConfirmDialog
        open={lastItemCheck !== null}
        title="⚠ SẢN PHẨM SẼ HẾT SAU PHIẾU NÀY"
        description="Sau khi lưu phiếu, các sản phẩm dưới đây không còn hàng khả dụng. Bạn vẫn có thể tiếp tục."
        confirmLabel="Vẫn tiếp tục"
        cancelLabel="Xem lại"
        tone="primary"
        loading={submitting}
        onConfirm={() => {
          const pending = lastItemCheck;
          setLastItemCheck(null);
          if (pending) void send(pending.input);
        }}
        onClose={() => setLastItemCheck(null)}
      >
        <ul className="space-y-2 text-sm">
          {lastItemCheck?.items.map((x) => (
            <li key={x.name} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
              <p className="font-semibold text-stone-900">{x.name}</p>
              <p className="text-stone-700">
                Khả dụng: {x.available} · Bàn giao: {x.quantity} · Còn lại: <strong>0</strong>
              </p>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </form>
  );
}
