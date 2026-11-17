import { Pencil, Plus } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { LIMITS } from '../../../../shared/constants';
import { toFieldErrors, uniformNormSaveSchema } from '../../../../shared/schemas';
import { EMPLOYEE_GENDER_LABELS, EMPLOYEE_GENDERS, type EmployeeGender, type UniformModel, type UniformNorm } from '../../../../shared/uniform';
import type { NormScope } from '../../../../shared/vpp';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { Field } from '../../../components/ui/Field';
import { NumberInput } from '../../../components/ui/NumberInput';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, InlineAlert, LoadingCard } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { useDialogErrors } from '../../../components/vpp/StockDialogs';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { uniformNorms, uniformSaveNorm, uniformSetScopeMapping, uniformStock } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { formatDate } from '../../../utils/format';
import { parseViNumber } from '../../../utils/number';

const NEW_SCOPE = '__new__';

function NormDialog({
  open,
  norm,
  scopes,
  models,
  presetScopeId,
  onClose,
  onSaved,
}: {
  open: boolean;
  norm: UniformNorm | null;
  scopes: NormScope[];
  models: UniformModel[];
  presetScopeId: string;
  onClose: () => void;
  onSaved: (norm: UniformNorm) => void;
}) {
  const [scopeId, setScopeId] = useState('');
  const [scopeName, setScopeName] = useState('');
  const [modelId, setModelId] = useState('');
  const [gender, setGender] = useState<EmployeeGender | ''>('');
  const [quantity, setQuantity] = useState('3');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, formError, setFormError, fromError, reset } = useDialogErrors();

  useLayoutEffect(() => {
    if (!open) return;
    setScopeId(norm?.scopeId ?? (presetScopeId || (scopes.length ? scopes[0].scopeId : NEW_SCOPE)));
    setScopeName('');
    setModelId(norm?.modelId ?? '');
    setGender(norm?.gender ?? '');
    setQuantity(String(norm?.yearlyQuantity ?? 3));
    setFrom(norm?.effectiveFrom ?? '');
    setTo(norm?.effectiveTo ?? '');
    setNote(norm?.note ?? '');
    setActive(norm?.active ?? true);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, norm?.normId]);

  async function save() {
    if (saving) return;
    const isNew = scopeId === NEW_SCOPE;
    const parsed = uniformNormSaveSchema.safeParse({
      scopeId: isNew ? '' : scopeId,
      scopeName: isNew ? scopeName.trim() : (scopes.find((s) => s.scopeId === scopeId)?.scopeName ?? ''),
      modelId,
      gender,
      yearlyQuantity: parseViNumber(quantity, 'integer'),
      note: note.trim(),
      effectiveFrom: from,
      effectiveTo: to,
      active,
    });
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error);
      if (isNew && fe.scopeId) fe.scopeName = fe.scopeId;
      setErrors(fe);
      setFormError(null);
      return;
    }
    setSaving(true);
    reset();
    try {
      onSaved(await uniformSaveNorm(parsed.data, norm?.normId));
    } catch (err) {
      fromError(err, 'Không lưu được tiêu chuẩn.');
    } finally {
      setSaving(false);
    }
  }

  const quotaModels = models.filter((m) => m.countsTowardQuota || m.modelId === modelId);

  return (
    <ConfirmDialog
      open={open}
      wide
      title={norm ? 'Sửa tiêu chuẩn năm' : 'Thêm tiêu chuẩn năm'}
      description="“Tổng mọi mẫu” = số áo tối đa / người / năm của nhóm. Tiêu chuẩn theo mẫu: giới hạn riêng từng mẫu và là mẫu gợi ý khi cấp / dự trù đặt may."
      confirmLabel="Lưu"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dp-norm-scope" label="Nhóm áp dụng" required error={errors.scopeId}>
          <select id="dp-norm-scope" className="field-input" value={scopeId} disabled={Boolean(norm)} onChange={(e) => setScopeId(e.target.value)}>
            {scopes.map((s) => (
              <option key={s.scopeId} value={s.scopeId}>
                {s.scopeName} ({s.scopeId})
              </option>
            ))}
            <option value={NEW_SCOPE}>+ Nhóm mới…</option>
          </select>
        </Field>
        {scopeId === NEW_SCOPE && (
          <Field id="dp-norm-scope-name" label="Tên nhóm mới" required error={errors.scopeName} hint="Ví dụ: Showroom, Kho, Văn phòng — sau đó gán phòng ban vào nhóm ở bảng dưới.">
            <input id="dp-norm-scope-name" className="field-input" maxLength={120} value={scopeName} onChange={(e) => setScopeName(e.target.value)} />
          </Field>
        )}
        <Field id="dp-norm-model" label="Mẫu" error={errors.modelId}>
          <select id="dp-norm-model" className="field-input" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Tổng mọi mẫu tính tiêu chuẩn</option>
            {quotaModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.modelName}
                {m.active ? '' : ' (ngừng dùng)'}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-norm-gender" label="Áp dụng cho" error={errors.gender}>
          <select id="dp-norm-gender" className="field-input" value={gender} onChange={(e) => setGender(e.target.value as EmployeeGender | '')}>
            <option value="">Cả nam và nữ</option>
            {EMPLOYEE_GENDERS.map((g) => (
              <option key={g} value={g}>
                Chỉ {EMPLOYEE_GENDER_LABELS[g].toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field id="dp-norm-qty" label="Số áo / người / năm" required error={errors.yearlyQuantity} hint={`0 = không cấp; tối đa ${LIMITS.maxYearlyQuota}.`}>
          <NumberInput id="dp-norm-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field id="dp-norm-from" label="Hiệu lực từ" error={errors.effectiveFrom}>
          <input id="dp-norm-from" type="date" className="field-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="dp-norm-to" label="Đến" error={errors.effectiveTo}>
          <input id="dp-norm-to" type="date" className="field-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field id="dp-norm-note" label="Ghi chú" error={errors.note} className="sm:col-span-2">
          <textarea id="dp-norm-note" className="field-input min-h-16" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand-700" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Đang áp dụng
        </label>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

/** /admin/dong-phuc/tieu-chuan — tiêu chuẩn cấp phát năm theo nhóm (phạm vi) + gán phòng ban vào nhóm. */
export default function UniformNormsPage() {
  useDocumentTitle('Tiêu chuẩn đồng phục năm');
  const toast = useToast();
  const { handleError } = useAdmin();
  const data = useAsync(async (signal) => {
    const [norms, stock] = await Promise.all([uniformNorms(signal), uniformStock({ includeInactive: true }, signal)]);
    return { ...norms, models: stock.models };
  }, []);
  const [editing, setEditing] = useState<{ norm: UniformNorm | null; scopeId: string } | null>(null);
  const [mappingBusy, setMappingBusy] = useState('');
  const d = data.data;

  const groups = useMemo(() => {
    const map = new Map<string, { scope: NormScope; norms: UniformNorm[] }>();
    for (const s of d?.scopes ?? []) map.set(s.scopeId, { scope: s, norms: [] });
    for (const n of d?.norms ?? []) {
      const g = map.get(n.scopeId) ?? { scope: { scopeId: n.scopeId, scopeName: n.scopeName || n.scopeId }, norms: [] };
      g.norms.push(n);
      map.set(n.scopeId, g);
    }
    return [...map.values()];
  }, [d]);

  async function changeMapping(department: string, scopeId: string) {
    setMappingBusy(department);
    try {
      await uniformSetScopeMapping(department, scopeId);
      toast.show(`Đã gán “${department}” → ${scopeId === 'NONE' ? 'không áp dụng tiêu chuẩn' : scopeId || 'tự khớp theo tên / mặc định'}.`);
      data.reload();
    } catch (err) {
      handleError(err);
    } finally {
      setMappingBusy('');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <PageHeader
        title="Tiêu chuẩn đồng phục năm"
        description="Thứ tự áp dụng: tiêu chuẩn “Tổng mọi mẫu” của nhóm → tổng các tiêu chuẩn theo mẫu → mặc định CAU_HINH.DP_TIEU_CHUAN_NAM. Vượt tiêu chuẩn vẫn cấp được nhưng phải ghi lý do."
        actions={
          <Button variant="primary" onClick={() => setEditing({ norm: null, scopeId: '' })} icon={<Plus className="size-4" aria-hidden="true" />} disabled={!d}>
            Thêm tiêu chuẩn
          </Button>
        }
      />

      {data.status === 'loading' && !d && <LoadingCard lines={6} />}
      {data.status === 'error' && !d && <ErrorState title="Không tải được tiêu chuẩn." error={data.error} onRetry={data.reload} />}

      {d && (
        <>
          <InlineAlert tone="info">
            Mặc định hiện tại: <strong>{d.defaultYearlyQuota}</strong> áo / người / năm (Chính sách người lao động 19/08/2025 — sửa ở sheet CAU_HINH, khóa
            DP_TIEU_CHUAN_NAM; 0 = không áp dụng mặc định). Năm tính theo lịch, giờ Việt Nam; đồ cho mượn và mẫu không tính tiêu chuẩn (bảo hộ lao động) không
            bị trừ.
          </InlineAlert>

          {groups.length === 0 && (
            <div className="card p-5 text-sm text-stone-600">
              Chưa có nhóm tiêu chuẩn nào — mọi nhân viên dùng mức mặc định. Thêm tiêu chuẩn để đặt mức riêng cho từng nhóm (ví dụ Showroom: áo sơmi đỏ /
              vàng cho nam, áo dài cho nữ).
            </div>
          )}

          {groups.map((g) => (
            <section key={g.scope.scopeId} className="card p-4" aria-labelledby={`dp-scope-${g.scope.scopeId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`dp-scope-${g.scope.scopeId}`} className="section-title">
                  {g.scope.scopeName} <span className="font-mono text-xs font-normal text-stone-500">{g.scope.scopeId}</span>
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ norm: null, scopeId: g.scope.scopeId })} icon={<Plus className="size-4" aria-hidden="true" />}>
                  Thêm cho nhóm này
                </Button>
              </div>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {g.norms.map((n) => (
                  <li key={n.normId} className={cn('flex flex-wrap items-center justify-between gap-2 py-2', !n.effective && 'opacity-60')}>
                    <div className="min-w-0">
                      <p>
                        <strong>{n.modelId ? n.modelName : 'Tổng mọi mẫu'}</strong>
                        {n.gender ? ` · chỉ ${EMPLOYEE_GENDER_LABELS[n.gender].toLowerCase()}` : ''}: <strong className="tabular-nums">{n.yearlyQuantity}</strong> / năm
                        {!n.effective && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">không hiệu lực</span>}
                      </p>
                      {(n.effectiveFrom || n.effectiveTo || n.note) && (
                        <p className="text-xs text-stone-500">
                          {n.effectiveFrom || n.effectiveTo ? `Hiệu lực ${n.effectiveFrom ? formatDate(n.effectiveFrom) : '…'} – ${n.effectiveTo ? formatDate(n.effectiveTo) : '…'}` : ''}
                          {n.note ? ` · ${n.note}` : ''}
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ norm: n, scopeId: n.scopeId })} icon={<Pencil className="size-4" aria-hidden="true" />}>
                      Sửa
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="card overflow-hidden" aria-labelledby="dp-mapping">
            <div className="border-b border-stone-200 px-4 py-3">
              <h2 id="dp-mapping" className="section-title">
                Phòng ban → nhóm tiêu chuẩn
              </h2>
              <p className="mt-0.5 text-xs text-stone-500">
                “Tự khớp” = phòng ban trùng tên nhóm (bỏ dấu, hoa / thường) thì theo nhóm đó, không thì dùng mặc định. Chọn “Không áp dụng” cho phòng ban không
                mặc đồng phục.
              </p>
            </div>
            {d.departments.length === 0 ? (
              <p className="p-4 text-sm text-stone-500">Chưa có nhân viên đang làm có phòng ban.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {d.departments.map((dep) => (
                  <li key={dep.department} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span>
                      <strong>{dep.department}</strong> <span className="text-stone-500">· {dep.employeeCount} NV</span>
                      <span className="block text-xs text-stone-500">
                        Đang áp dụng:{' '}
                        {dep.mapping === 'NONE'
                          ? 'không áp dụng tiêu chuẩn'
                          : dep.scope
                            ? `${dep.scope.scopeName}${dep.scope.source === 'AUTO' ? ' (tự khớp theo tên)' : ''}`
                            : `mặc định (${d.defaultYearlyQuota}/năm)`}
                      </span>
                    </span>
                    <select
                      className="field-input w-auto min-w-48"
                      aria-label={`Nhóm tiêu chuẩn của ${dep.department}`}
                      value={dep.mapping}
                      disabled={mappingBusy === dep.department}
                      onChange={(e) => changeMapping(dep.department, e.target.value)}
                    >
                      <option value="">Tự khớp / mặc định</option>
                      {d.scopes.map((s) => (
                        <option key={s.scopeId} value={s.scopeId}>
                          {s.scopeName}
                        </option>
                      ))}
                      <option value="NONE">Không áp dụng</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <NormDialog
            open={editing !== null}
            norm={editing?.norm ?? null}
            presetScopeId={editing?.scopeId ?? ''}
            scopes={d.scopes}
            models={d.models}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              toast.show('Đã lưu tiêu chuẩn.');
              data.reload();
            }}
          />
        </>
      )}
    </div>
  );
}
