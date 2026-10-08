import { Pencil, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { LIMITS } from '../../../../shared/constants';
import { normSaveSchema, toFieldErrors } from '../../../../shared/schemas';
import { formatVnd, type DepartmentScope, type VppNorm, type VppNormsResponse, type VppProduct } from '../../../../shared/vpp';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { describedBy, Field } from '../../../components/ui/Field';
import { NumberInput } from '../../../components/ui/NumberInput';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, InlineAlert, LoadingCard } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { ProductPicker } from '../../../components/vpp/ProductPicker';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { ApiClientError, errorMessage, isApiError } from '../../../services/api';
import { vppNorms, vppProducts, vppSaveNorm, vppSetScopeMapping, type NormFormInput } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { formatDate } from '../../../utils/format';
import { numberToInput, parseViNumber, withNumberFormatErrors } from '../../../utils/number';
import { searchProducts } from '../../../utils/productSearch';

const NEW_SCOPE = '__new__';

/** /admin/vpp/dinh-muc — định mức tháng theo phạm vi (PHÒNG KINH DOANH / VĂN PHÒNG…) + gắn phòng ban → phạm vi. */
export default function VppNormsPage() {
  useDocumentTitle('Định mức văn phòng phẩm');
  const { handleError } = useAdmin();
  const data = useAsync(() => vppNorms(), []);
  const [scopeId, setScopeId] = useState('');
  const [dialog, setDialog] = useState<{ norm: VppNorm | null } | null>(null);

  useEffect(() => {
    if (data.status === 'error' && isApiError(data.error) && data.error.status === 401) handleError(data.error);
  }, [data.status, data.error, handleError]);

  const scopes = data.data?.scopes ?? [];
  const activeScope = scopeId || scopes[0]?.scopeId || '';

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Định mức văn phòng phẩm"
        description="Số lượng mỗi phòng ban được cấp mỗi tháng. Vượt định mức vẫn cấp được nhưng bắt buộc ghi lý do."
        actions={
          <Button variant="primary" onClick={() => setDialog({ norm: null })} icon={<Plus className="size-4" aria-hidden="true" />} disabled={!data.data}>
            Thêm định mức
          </Button>
        }
      />

      {data.status === 'loading' && !data.data && <LoadingCard lines={6} />}
      {data.status === 'error' && !data.data && <ErrorState title="Không tải được định mức." error={data.error} onRetry={data.reload} />}

      {data.data && (
        <>
          {scopes.length === 0 ? (
            <section className="card">
              <EmptyState
                title="Chưa có định mức nào."
                description="Chạy “Nạp định mức (VPP)” trong menu DTA Handover trên Google Sheet để nạp định mức từ file gốc, hoặc thêm định mức mới."
              />
            </section>
          ) : (
            <NormTable data={data.data} scopeId={activeScope} onScope={setScopeId} onEdit={(norm) => setDialog({ norm })} />
          )}
          <DepartmentMapping data={data.data} onChanged={data.reload} />
          <NormDialog
            open={dialog !== null}
            norm={dialog?.norm ?? null}
            data={data.data}
            defaultScopeId={activeScope}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              data.reload();
            }}
          />
        </>
      )}
    </div>
  );
}

function effectiveLabel(n: VppNorm): { text: string; tone: string } {
  if (!n.active) return { text: 'Đã tắt', tone: 'bg-stone-100 text-stone-600' };
  if (n.productInactive) return { text: 'Sản phẩm ngừng dùng', tone: 'bg-stone-100 text-stone-600' };
  if (!n.effective) return { text: 'Ngoài thời hạn', tone: 'bg-amber-50 text-amber-800' };
  return { text: 'Đang áp dụng', tone: 'bg-emerald-50 text-emerald-800' };
}

function NormTable({
  data,
  scopeId,
  onScope,
  onEdit,
}: {
  data: VppNormsResponse;
  scopeId: string;
  onScope: (id: string) => void;
  onEdit: (norm: VppNorm) => void;
}) {
  const norms = data.norms.filter((n) => n.scopeId === scopeId);
  const live = norms.filter((n) => n.active && n.effective);
  const totalQty = live.reduce((s, n) => s + n.monthlyQuantity, 0);
  const priced = live.filter((n) => n.referencePrice !== null);
  const totalAmount = priced.reduce((s, n) => s + n.monthlyQuantity * (n.referencePrice ?? 0), 0);
  const scope = data.scopes.find((s) => s.scopeId === scopeId);

  return (
    <section className="card overflow-hidden" aria-label="Định mức theo phạm vi">
      <div className="flex gap-1 overflow-x-auto border-b border-stone-200 px-2 pt-2" role="tablist" aria-label="Phạm vi định mức">
        {data.scopes.map((s) => (
          <button
            key={s.scopeId}
            type="button"
            role="tab"
            aria-selected={s.scopeId === scopeId}
            onClick={() => onScope(s.scopeId)}
            className={cn(
              'shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap',
              s.scopeId === scopeId ? 'border-brand-600 text-brand-800' : 'border-transparent text-stone-500 hover:text-stone-800',
            )}
          >
            {s.scopeName}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
        <p className="text-stone-700">
          <strong>{scope?.scopeName}</strong> · {live.length} sản phẩm đang áp dụng · Tổng SL {totalQty} · Tổng tiền dự kiến{' '}
          <strong>{formatVnd(totalAmount)}</strong>/tháng
          {priced.length < live.length ? ` (${live.length - priced.length} dòng chưa có đơn giá)` : ''}
        </p>
      </div>
      {norms.length === 0 ? (
        <p className="px-4 pb-6 text-sm text-stone-500">Phạm vi này chưa có định mức.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Sản phẩm</th>
                  <th scope="col" className="px-3 py-2.5">ĐVT</th>
                  <th scope="col" className="px-3 py-2.5 text-right">SL/tháng</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Đơn giá</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Thành tiền</th>
                  <th scope="col" className="px-3 py-2.5">Ghi chú</th>
                  <th scope="col" className="px-3 py-2.5">Hiệu lực</th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {norms.map((n) => {
                  const label = effectiveLabel(n);
                  return (
                    <tr key={n.normId} className={n.active && n.effective ? '' : 'opacity-60'}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-stone-900">{n.productName}</p>
                        <p className="text-xs text-stone-500">
                          <span className="font-mono">{n.productCode}</span>
                          {n.sourceRef ? ` · ${n.sourceRef}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">{n.unit || n.productUnit}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{n.monthlyQuantity}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatVnd(n.referencePrice)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {n.referencePrice === null ? '—' : formatVnd(n.referencePrice * n.monthlyQuantity)}
                      </td>
                      <td className="max-w-64 px-3 py-2.5 text-xs whitespace-pre-line text-stone-600">{n.note}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', label.tone)}>{label.text}</span>
                        {(n.effectiveFrom || n.effectiveTo) && (
                          <span className="mt-0.5 block text-xs text-stone-500">
                            {formatDate(n.effectiveFrom) || '…'} → {formatDate(n.effectiveTo) || '…'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => onEdit(n)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                          Sửa
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-stone-100 md:hidden">
            {norms.map((n) => {
              const label = effectiveLabel(n);
              return (
                <li key={n.normId} className={cn('p-4', n.active && n.effective ? '' : 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-stone-900">{n.productName}</p>
                      <p className="text-xs text-stone-500">
                        {n.monthlyQuantity} {n.unit || n.productUnit}/tháng · {formatVnd(n.referencePrice)}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(n)} aria-label={`Sửa định mức ${n.productName}`} icon={<Pencil className="size-4" aria-hidden="true" />} />
                  </div>
                  {n.note && <p className="mt-1 text-xs whitespace-pre-line text-stone-600">{n.note}</p>}
                  <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold', label.tone)}>{label.text}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function mappingSource(d: DepartmentScope): string {
  if (d.mapping === 'NONE') return 'Không áp dụng (gắn thủ công)';
  if (d.scope?.source === 'MAPPING') return 'Gắn thủ công';
  if (d.scope?.source === 'AUTO') return 'Tự khớp theo tên';
  return 'Chưa gắn';
}

function DepartmentMapping({ data, onChanged }: { data: VppNormsResponse; onChanged: () => void }) {
  const toast = useToast();
  const { handleError } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);

  async function change(department: string, scopeId: string) {
    setBusy(department);
    try {
      await vppSetScopeMapping(department, scopeId);
      toast.show(`Đã cập nhật định mức cho phòng ban “${department}”.`);
      onChanged();
    } catch (err) {
      handleError(err, 'Không cập nhật được phòng ban.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="dept-title">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 id="dept-title" className="text-sm font-semibold text-stone-800">
          Phòng ban → phạm vi định mức
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Phòng ban của người nhận quyết định định mức áp dụng. “Tự khớp theo tên” chỉ khớp khi tên phòng ban trùng tên phạm vi (bỏ chữ “phòng”).
          Phiếu đã tạo giữ nguyên phạm vi lúc tạo.
        </p>
      </div>
      {data.departments.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-stone-500">Chưa có nhân viên đang làm việc nào có phòng ban.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {data.departments.map((d) => {
            const value = d.mapping === 'NONE' ? 'NONE' : d.scope?.source === 'MAPPING' ? d.scope.scopeId : '';
            return (
              <li key={d.department} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">{d.department}</p>
                  <p className="text-xs text-stone-500">
                    {d.employeeCount} nhân viên · {d.scope ? <strong className="text-stone-700">{d.scope.scopeName}</strong> : 'Không có định mức'} ·{' '}
                    {mappingSource(d)}
                  </p>
                </div>
                <select
                  className="field-input w-full sm:w-64"
                  aria-label={`Phạm vi định mức của phòng ban ${d.department}`}
                  value={value}
                  disabled={busy === d.department}
                  onChange={(e) => void change(d.department, e.target.value)}
                >
                  <option value="">Tự khớp theo tên</option>
                  <option value="NONE">Không áp dụng định mức</option>
                  {data.scopes.map((s) => (
                    <option key={s.scopeId} value={s.scopeId}>
                      {s.scopeName}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface NormDraft {
  productId: string;
  scopeChoice: string;
  scopeName: string;
  monthlyQuantity: string;
  unit: string;
  referencePrice: string;
  note: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
}

function NormDialog({
  open,
  norm,
  data,
  defaultScopeId,
  onClose,
  onSaved,
}: {
  open: boolean;
  norm: VppNorm | null;
  data: VppNormsResponse;
  defaultScopeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const products = useAsync<VppProduct[]>(() => (open ? vppProducts({}) : Promise.resolve([])), [open]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<NormDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open) return;
    setQuery('');
    setErrors({});
    setFormError(null);
    setDraft({
      productId: norm?.productId ?? '',
      scopeChoice: norm?.scopeId ?? (defaultScopeId || NEW_SCOPE),
      scopeName: '',
      monthlyQuantity: norm ? numberToInput(norm.monthlyQuantity) : '',
      unit: norm?.unit ?? '',
      referencePrice: numberToInput(norm?.referencePrice),
      note: norm?.note ?? '',
      effectiveFrom: norm?.effectiveFrom ?? '',
      effectiveTo: norm?.effectiveTo ?? '',
      active: norm?.active ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, norm?.normId, defaultScopeId]);

  const usable = useMemo(
    () => (products.data ?? []).filter((p) => p.active && p.catalogStatus !== 'ARCHIVED' && p.catalogStatus !== 'PENDING_APPROVAL'),
    [products.data],
  );
  const options = useMemo(() => searchProducts(usable, query, 200), [usable, query]);
  const selected = usable.find((p) => p.productId === draft?.productId) ?? null;

  function set<K extends keyof NormDraft>(key: K, value: NormDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors((e) => {
      const copy = { ...e };
      delete copy[key === 'scopeChoice' ? 'scopeId' : key];
      return copy;
    });
  }

  function pickProduct(productId: string) {
    const p = usable.find((x) => x.productId === productId);
    setDraft((d) =>
      d
        ? {
            ...d,
            productId,
            unit: d.unit || p?.unit || '',
            referencePrice: d.referencePrice || numberToInput(p?.referencePrice),
          }
        : d,
    );
    setErrors((e) => {
      const copy = { ...e };
      delete copy.productId;
      return copy;
    });
  }

  async function save() {
    if (!draft || saving) return;
    const isNew = draft.scopeChoice === NEW_SCOPE;
    const input: NormFormInput = {
      // Thêm mới: gửi đúng sản phẩm đang hiện ở dòng "Đã chọn"; sửa: giữ sản phẩm của định mức.
      productId: norm ? draft.productId : (selected?.productId ?? ''),
      scopeId: isNew ? '' : draft.scopeChoice,
      scopeName: isNew ? draft.scopeName.trim() : '',
      monthlyQuantity: parseViNumber(draft.monthlyQuantity) ?? NaN,
      unit: draft.unit,
      referencePrice: parseViNumber(draft.referencePrice, 'decimal'),
      note: draft.note,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
      active: draft.active,
    };
    const parsed = normSaveSchema.safeParse(input);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), {
      monthlyQuantity: [draft.monthlyQuantity, 'integer'],
      referencePrice: [draft.referencePrice, 'decimal'],
    });
    if (isNew && !input.scopeName) fieldErrors.scopeName ??= 'Nhập tên phạm vi mới (ví dụ: PHÒNG KẾ TOÁN)';
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await vppSaveNorm(input, norm?.normId);
      toast.show(norm ? 'Đã lưu định mức.' : 'Đã thêm định mức.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không lưu được định mức.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      title={norm ? `Sửa định mức: ${norm.productName}` : 'Thêm định mức'}
      description={norm ? 'Sửa định mức không ảnh hưởng phiếu đã ký; áp dụng cho các phiếu / đề xuất từ nay.' : undefined}
      confirmLabel={norm ? 'Lưu định mức' : 'Thêm định mức'}
      cancelLabel="Hủy"
      loading={saving}
      confirmDisabled={!draft}
      onConfirm={save}
      onClose={onClose}
    >
      {draft && (
        <div className="grid gap-4 sm:grid-cols-2">
          {norm ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm sm:col-span-2">
              Sản phẩm: <strong>{norm.productName}</strong> <span className="font-mono text-xs text-stone-500">{norm.productCode}</span>
            </p>
          ) : (
            <Field id="norm-product" label="Sản phẩm" required error={errors.productId} className="sm:col-span-2">
              <ProductPicker
                id="norm-product"
                query={query}
                onQueryChange={setQuery}
                options={options}
                selected={selected}
                loading={products.status === 'loading'}
                loadError={products.status === 'error'}
                error={errors.productId}
                onSelect={(p) => pickProduct(p.productId)}
              />
            </Field>
          )}
          <Field id="norm-scope" label="Phạm vi định mức" required error={errors.scopeId}>
            <select id="norm-scope" className="field-input" value={draft.scopeChoice} onChange={(e) => set('scopeChoice', e.target.value)}>
              {data.scopes.map((s) => (
                <option key={s.scopeId} value={s.scopeId}>
                  {s.scopeName}
                </option>
              ))}
              <option value={NEW_SCOPE}>+ Phạm vi mới…</option>
            </select>
          </Field>
          {draft.scopeChoice === NEW_SCOPE ? (
            <Field id="norm-scope-name" label="Tên phạm vi mới" required error={errors.scopeName}>
              <input
                id="norm-scope-name"
                className="field-input"
                maxLength={120}
                placeholder="Ví dụ: PHÒNG KẾ TOÁN"
                value={draft.scopeName}
                aria-invalid={errors.scopeName ? true : undefined}
                aria-describedby={describedBy('norm-scope-name', errors.scopeName)}
                onChange={(e) => set('scopeName', e.target.value)}
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field id="norm-qty" label="Số lượng / tháng" required error={errors.monthlyQuantity}>
            <NumberInput
              id="norm-qty"
              className="field-input"
              value={draft.monthlyQuantity}
              aria-invalid={errors.monthlyQuantity ? true : undefined}
              aria-describedby={describedBy('norm-qty', errors.monthlyQuantity)}
              onChange={(e) => set('monthlyQuantity', e.target.value)}
            />
          </Field>
          <Field id="norm-unit" label="ĐVT" error={errors.unit} hint="Để trống: dùng ĐVT của sản phẩm.">
            <input
              id="norm-unit"
              className="field-input"
              maxLength={LIMITS.unit}
              value={draft.unit}
              aria-invalid={errors.unit ? true : undefined}
              aria-describedby={describedBy('norm-unit', errors.unit, 'hint')}
              onChange={(e) => set('unit', e.target.value)}
            />
          </Field>
          <Field id="norm-price" label="Đơn giá tham khảo (₫)" error={errors.referencePrice}>
            <NumberInput
              id="norm-price"
              className="field-input"
              value={draft.referencePrice}
              aria-invalid={errors.referencePrice ? true : undefined}
              aria-describedby={describedBy('norm-price', errors.referencePrice)}
              onChange={(e) => set('referencePrice', e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2 text-sm font-medium text-stone-800">
            <input type="checkbox" className="size-5 accent-brand-700" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
            Đang áp dụng
          </label>
          <Field id="norm-from" label="Hiệu lực từ" error={errors.effectiveFrom}>
            <input id="norm-from" type="date" className="field-input" value={draft.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          </Field>
          <Field id="norm-to" label="Hiệu lực đến" error={errors.effectiveTo}>
            <input id="norm-to" type="date" className="field-input" value={draft.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          </Field>
          <Field id="norm-note" label="Ghi chú" error={errors.note} className="sm:col-span-2">
            <textarea
              id="norm-note"
              className="field-input min-h-16"
              rows={2}
              maxLength={1000}
              value={draft.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </div>
      )}
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}
