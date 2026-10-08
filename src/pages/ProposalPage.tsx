import { CircleCheck, Home, PackagePlus, Search, Send, ShoppingCart, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { LIMITS } from '../../shared/constants';
import { proposalSubmitSchema, toFieldErrors } from '../../shared/schemas';
import { exactNameKey } from '../../shared/text';
import { PROPOSAL_STATUS_LABELS, type EmployeeLookupResponse, type ProposalSubmitResult, type PublicCatalogProduct } from '../../shared/vpp';
import { EmployeeCard } from '../components/EmployeeCard';
import { newUid } from '../components/handover/formModel';
import { StaffGate, StaffGateDialog } from '../components/StaffGate';
import { Button, ButtonLink } from '../components/ui/Button';
import { describedBy, Field } from '../components/ui/Field';
import { ErrorState, InlineAlert, LoadingCard } from '../components/ui/States';
import { QuantityStepper } from '../components/vpp/QuantityStepper';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle, useUnsavedChangesWarning } from '../hooks/usePageMeta';
import { ApiClientError, errorMessage, isApiError } from '../services/api';
import { staffSession } from '../services/handoverApi';
import { vppLookupEmployee, vppPublicCatalog, vppSubmitProposal, type ProposalItemInput } from '../services/vppApi';
import { cn } from '../utils/cn';
import { searchProducts } from '../utils/productSearch';
import { newRequestId } from '../utils/requestId';

/** Sản phẩm điền sẵn từ link "TẠO ĐỀ XUẤT MUA" (?sp=<mã sản phẩm>&sl=<số lượng>&ten=<tên>&dvt=<ĐVT>). */
interface Prefill {
  productId: string;
  quantity: number;
  name: string;
  unit: string;
}

interface NormLine {
  checked: boolean;
  quantity: number;
  reason: string;
  note: string;
}

interface ExtraLine {
  uid: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  reason: string;
  referenceUrl: string;
  note: string;
}

type LineField = 'productId' | 'productName' | 'unit' | 'quantity' | 'reason' | 'referenceUrl' | 'note';
type LineErrors = Partial<Record<LineField, string>>;

function readPrefill(params: URLSearchParams): Prefill | null {
  const productId = (params.get('sp') ?? '').trim().toLowerCase();
  const name = (params.get('ten') ?? '').trim().slice(0, LIMITS.productName);
  if (!productId && !name) return null;
  const qty = Number(params.get('sl'));
  return {
    productId,
    quantity: Number.isInteger(qty) && qty >= 1 ? Math.min(qty, LIMITS.maxQuantity) : 1,
    name,
    unit: (params.get('dvt') ?? '').trim().slice(0, LIMITS.unit),
  };
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-8">{children}</div>;
}

/** Trang công khai: nhân viên đề xuất mua văn phòng phẩm (trong / vượt / ngoài định mức của phòng ban). */
export default function ProposalPage() {
  useDocumentTitle('Đề xuất văn phòng phẩm');
  const session = useAsync(() => staffSession(), []);
  const [unlocked, setUnlocked] = useState(false);
  // Phiên mã truy cập hết hạn khi đang điền: hỏi lại mã trong hộp thoại, KHÔNG gỡ form (giữ nội dung đang nhập).
  const [gateOpen, setGateOpen] = useState(false);

  if (session.status === 'loading' && !session.data) {
    return (
      <Shell>
        <LoadingCard lines={3} label="Đang kiểm tra quyền truy cập…" />
      </Shell>
    );
  }
  if (!session.data) {
    return (
      <Shell>
        <ErrorState title="Không kết nối được máy chủ." error={session.error} onRetry={session.reload} />
      </Shell>
    );
  }
  if (session.data.required && !session.data.authenticated && !unlocked) {
    return (
      <Shell>
        <StaffGate onSuccess={() => setUnlocked(true)} />
      </Shell>
    );
  }
  return (
    <Shell>
      <ProposalFlow onStaffExpired={() => setGateOpen(true)} />
      <StaffGateDialog
        open={gateOpen}
        onSuccess={() => {
          setUnlocked(true);
          setGateOpen(false);
        }}
      />
    </Shell>
  );
}

function ProposalFlow({ onStaffExpired }: { onStaffExpired: () => void }) {
  const [params] = useSearchParams();
  const prefill = useMemo(() => readPrefill(params), [params]);
  const [lookup, setLookup] = useState<EmployeeLookupResponse | null>(null);
  const [done, setDone] = useState<ProposalSubmitResult | null>(null);
  const [round, setRound] = useState(0);

  if (done) {
    return (
      <DoneView
        result={done}
        onNew={() => {
          setDone(null);
          setRound((r) => r + 1);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }
  if (!lookup) return <LookupStep prefill={prefill} onFound={setLookup} onStaffExpired={onStaffExpired} />;
  return (
    <ProposalForm
      key={`${lookup.employee.employeeId}:${round}`}
      lookup={lookup}
      // Chỉ điền sẵn cho đề xuất đầu tiên.
      prefill={round === 0 ? prefill : null}
      onChangeEmployee={() => setLookup(null)}
      onSubmitted={(result) => {
        setDone(result);
        window.scrollTo({ top: 0 });
      }}
      onStaffExpired={onStaffExpired}
    />
  );
}

function PageIntro() {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold tracking-widest text-brand-600 uppercase">Văn phòng phẩm</p>
      <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">Đề xuất mua văn phòng phẩm</h1>
    </div>
  );
}

function LookupStep({
  prefill,
  onFound,
  onStaffExpired,
}: {
  prefill: Prefill | null;
  onFound: (result: EmployeeLookupResponse) => void;
  onStaffExpired: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const id = employeeId.trim();
    if (!id) {
      setError('Nhập mã nhân viên của bạn.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      onFound(await vppLookupEmployee(id));
    } catch (err) {
      if (isApiError(err, 'STAFF_AUTH_REQUIRED')) {
        onStaffExpired();
        return;
      }
      setError(errorMessage(err, 'Không tra cứu được mã nhân viên. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageIntro />
      <form onSubmit={submit} noValidate className="card space-y-4 p-4 sm:p-6">
        <p className="text-sm text-stone-600">
          Nhập <strong>mã nhân viên</strong> của bạn để xem định mức văn phòng phẩm của phòng ban và gửi đề xuất.
        </p>
        {prefill && (
          <InlineAlert tone="info">
            Đề xuất này có sản phẩm được chọn sẵn{prefill.name ? `: ${prefill.name}` : ''} (số lượng {prefill.quantity}).
          </InlineAlert>
        )}
        <Field id="lookup-employee-id" label="Mã nhân viên" required error={error} hint="Ví dụ: NV001 — in trên thẻ nhân viên.">
          <input
            id="lookup-employee-id"
            className="field-input uppercase"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={LIMITS.employeeId}
            value={employeeId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy('lookup-employee-id', error, 'hint')}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setError(undefined);
            }}
            autoFocus
          />
        </Field>
        <Button type="submit" size="lg" fullWidth loading={loading} icon={<Search className="size-4" aria-hidden="true" />}>
          {loading ? 'Đang tra cứu…' : 'TIẾP TỤC'}
        </Button>
      </form>
    </>
  );
}

function ProposalForm({
  lookup,
  prefill,
  onChangeEmployee,
  onSubmitted,
  onStaffExpired,
}: {
  lookup: EmployeeLookupResponse;
  prefill: Prefill | null;
  onChangeEmployee: () => void;
  onSubmitted: (result: ProposalSubmitResult) => void;
  onStaffExpired: () => void;
}) {
  const { employee, scope, norms } = lookup;
  const catalog = useAsync(() => vppPublicCatalog(), []);
  const normIds = useMemo(() => new Set(norms.map((n) => n.productId)), [norms]);
  const [normLines, setNormLines] = useState<Record<string, NormLine>>(() => {
    const initial: Record<string, NormLine> = {};
    for (const n of norms) {
      const picked = prefill?.productId === n.productId;
      initial[n.productId] = {
        checked: picked,
        quantity: picked ? prefill.quantity : Math.max(1, n.monthlyQuantity),
        reason: '',
        note: '',
      };
    }
    return initial;
  });
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [reason, setReason] = useState('');
  const [normErrors, setNormErrors] = useState<Record<string, LineErrors>>({});
  const [extraErrors, setExtraErrors] = useState<Record<string, LineErrors>>({});
  const [general, setGeneral] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const prefillPending = useRef(prefill !== null && !normIds.has(prefill.productId));
  // Một mã chống gửi trùng cho lần điền form này (bấm gửi lại khi mạng chập chờn không tạo đề xuất thứ hai).
  const requestId = useRef(newRequestId());
  useUnsavedChangesWarning(dirty && !submitting);

  // Sản phẩm điền sẵn không thuộc định mức → thêm dòng ngoài định mức khi danh mục đã tải.
  useEffect(() => {
    if (!prefillPending.current || !prefill || catalog.status === 'loading') return;
    prefillPending.current = false;
    const product = catalog.data?.find((p) => p.productId === prefill.productId);
    if (product) {
      setExtras([{ ...emptyExtra(), productId: product.productId, productName: product.productName, unit: product.unit, quantity: prefill.quantity }]);
    } else if (prefill.name) {
      setExtras([{ ...emptyExtra(), productName: prefill.name, unit: prefill.unit, quantity: prefill.quantity }]);
    } else {
      setPrefillNote('Sản phẩm được chọn sẵn không có trong danh mục công khai — hãy thêm sản phẩm ngoài định mức và nhập tên.');
    }
  }, [catalog.status, catalog.data, prefill]);

  const chosenIds = new Set(extras.map((x) => x.productId).filter(Boolean));
  const extraCandidates = useMemo(
    () => (catalog.data ?? []).filter((p) => !normIds.has(p.productId)),
    [catalog.data, normIds],
  );
  const checkedCount = Object.values(normLines).filter((l) => l.checked).length;
  const totalLines = checkedCount + extras.length;

  function updateNorm(productId: string, next: Partial<NormLine>) {
    setNormLines((cur) => ({ ...cur, [productId]: { ...cur[productId]!, ...next } }));
    setNormErrors((e) => {
      if (!e[productId]) return e;
      const copy = { ...e };
      delete copy[productId];
      return copy;
    });
    setGeneral((g) => (g.items ? { ...g, items: '' } : g));
    setDirty(true);
  }

  function updateExtra(uid: string, next: Partial<ExtraLine>) {
    setExtras((cur) => cur.map((x) => (x.uid === uid ? { ...x, ...next } : x)));
    setExtraErrors((e) => {
      if (!e[uid]) return e;
      const copy = { ...e };
      delete copy[uid];
      return copy;
    });
    setDirty(true);
  }

  function addExtra() {
    const line = emptyExtra();
    setExtras((cur) => [...cur, line]);
    setGeneral((g) => (g.items ? { ...g, items: '' } : g));
    setDirty(true);
    window.setTimeout(() => document.getElementById(`extra-${line.uid}-name`)?.focus(), 0);
  }

  function removeExtra(uid: string) {
    setExtras((cur) => cur.filter((x) => x.uid !== uid));
    setDirty(true);
  }

  /** Danh sách gửi đi + khóa dòng tương ứng (để gắn lỗi máy chủ "items.3.reason" về đúng dòng). */
  function buildItems(): { items: ProposalItemInput[]; keys: string[] } {
    const items: ProposalItemInput[] = [];
    const keys: string[] = [];
    for (const n of norms) {
      const line = normLines[n.productId];
      if (!line?.checked) continue;
      items.push({ productId: n.productId, productName: '', unit: '', quantity: line.quantity, reason: line.reason.trim(), referenceUrl: '', note: line.note.trim() });
      keys.push(`norm:${n.productId}`);
    }
    for (const x of extras) {
      items.push({
        productId: x.productId,
        productName: x.productId ? '' : x.productName.trim(),
        unit: x.productId ? '' : x.unit.trim(),
        quantity: x.quantity,
        reason: x.reason.trim(),
        referenceUrl: x.referenceUrl.trim(),
        note: x.note.trim(),
      });
      keys.push(`extra:${x.uid}`);
    }
    return { items, keys };
  }

  function applyErrors(fieldErrors: Record<string, string>, keys: string[]) {
    const nextNorm: Record<string, LineErrors> = {};
    const nextExtra: Record<string, LineErrors> = {};
    const nextGeneral: Record<string, string> = {};
    for (const [path, message] of Object.entries(fieldErrors)) {
      const m = /^items\.(\d+)\.(\w+)$/.exec(path);
      const key = m ? keys[Number(m[1])] : undefined;
      if (!m || !key) {
        nextGeneral[path] = message;
        continue;
      }
      const field = m[2] as LineField;
      const [kind, id] = key.split(/:(.+)/) as [string, string];
      const bucket = kind === 'norm' ? (nextNorm[id] ??= {}) : (nextExtra[id] ??= {});
      bucket[field] ??= message;
    }
    setNormErrors(nextNorm);
    setExtraErrors(nextExtra);
    setGeneral(nextGeneral);
    return Object.keys(nextNorm)[0] ? `norm-${Object.keys(nextNorm)[0]}` : Object.keys(nextExtra)[0] ? `extra-${Object.keys(nextExtra)[0]}` : null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    const { items, keys } = buildItems();
    const body = { employeeId: employee.employeeId, reason: reason.trim(), items, clientRequestId: requestId.current };
    const parsed = proposalSubmitSchema.safeParse(body);
    const fieldErrors: Record<string, string> = parsed.success ? {} : toFieldErrors(parsed.error);
    // Cùng quy tắc với máy chủ: vượt định mức / ngoài định mức bắt buộc có lý do; không trùng sản phẩm.
    // Tên tự gõ so khớp GIỮ DẤU như máy chủ (exactNameKey): "Keo" ≠ "Kéo" — không bỏ dấu rồi báo trùng nhầm.
    const normByName = new Map(norms.map((n) => [exactNameKey(n.productName), n]));
    const seenNames = new Set<string>();
    items.forEach((item, i) => {
      const key = keys[i]!;
      if (key.startsWith('norm:')) {
        const norm = norms.find((n) => n.productId === item.productId);
        if (norm && item.quantity > norm.monthlyQuantity && !item.reason) {
          fieldErrors[`items.${i}.reason`] ??= `Vượt định mức (${norm.monthlyQuantity}${norm.unit ? ` ${norm.unit}` : ''}/tháng) — nhập lý do`;
        }
        return;
      }
      if (!item.productId && item.productName) {
        const nameKey = exactNameKey(item.productName);
        if (normByName.has(nameKey)) fieldErrors[`items.${i}.productName`] ??= 'Sản phẩm này có trong định mức — hãy chọn ở danh sách định mức phía trên.';
        else if (seenNames.has(nameKey)) fieldErrors[`items.${i}.productName`] ??= 'Sản phẩm bị trùng trong đề xuất';
        seenNames.add(nameKey);
      }
      if (!item.reason) fieldErrors[`items.${i}.reason`] ??= 'Sản phẩm ngoài định mức — nhập lý do';
    });
    if (Object.keys(fieldErrors).length) {
      const first = applyErrors(fieldErrors, keys);
      document.getElementById(first ?? 'proposal-lines')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setNormErrors({});
    setExtraErrors({});
    setGeneral({});
    setSubmitting(true);
    try {
      const result = await vppSubmitProposal(parsed.success ? { ...parsed.data, clientRequestId: requestId.current } : body);
      setDirty(false);
      onSubmitted(result);
    } catch (err) {
      if (isApiError(err, 'STAFF_AUTH_REQUIRED')) {
        onStaffExpired();
        return;
      }
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) {
        const first = applyErrors(err.fieldErrors, keys);
        if (first) document.getElementById(first)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (isApiError(err, 'REQUEST_REUSED')) {
        // Lần gửi trước (mất phản hồi) đã lưu nội dung CŨ; mã thao tác đó không dùng lại được. Mã mới: bấm gửi lần nữa là chủ động
        // gửi nội dung vừa sửa thành đề xuất MỚI (đề xuất cũ giữ nguyên — quản trị viên từ chối / đóng nếu thừa).
        requestId.current = newRequestId();
        setSubmitError(
          `${err.message} Nếu vẫn cần gửi nội dung vừa sửa, bấm GỬI ĐỀ XUẤT lần nữa — hệ thống tạo đề xuất MỚI ` +
            '(đề xuất đã gửi giữ nguyên; báo quản trị viên nếu cần hủy đề xuất đó).',
        );
        return;
      }
      setSubmitError(errorMessage(err, 'Không gửi được đề xuất. Vui lòng thử lại.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      <PageIntro />

      <section className="card p-4 sm:p-6" aria-labelledby="requester-title">
        <h2 id="requester-title" className="section-title mb-3">
          Người đề xuất
        </h2>
        <EmployeeCard
          name={employee.fullName}
          employeeId={employee.employeeId}
          department={employee.department}
          position={employee.position}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!dirty || window.confirm('Đổi mã nhân viên? Nội dung đang nhập sẽ bị bỏ.')) onChangeEmployee();
              }}
            >
              Đổi
            </Button>
          }
        />
      </section>

      {prefillNote && <InlineAlert tone="info">{prefillNote}</InlineAlert>}

      <section id="proposal-lines" className="card p-4 sm:p-6" aria-labelledby="norms-title">
        <h2 id="norms-title" className="section-title">
          Định mức {scope ? `— ${scope.scopeName}` : ''}
        </h2>
        {general.items && <InlineAlert className="mt-3">{general.items}</InlineAlert>}
        {!scope || norms.length === 0 ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            {scope
              ? 'Phạm vi định mức của phòng ban chưa có sản phẩm nào.'
              : `Phòng ban ${employee.department ? `“${employee.department}” ` : ''}chưa được gắn định mức văn phòng phẩm.`}{' '}
            Bạn vẫn có thể đề xuất sản phẩm ngoài định mức bên dưới.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-stone-500">Tích chọn sản phẩm cần mua và điều chỉnh số lượng. Vượt định mức tháng phải nhập lý do.</p>
            <ul className="mt-3 space-y-2.5">
              {norms.map((n) => {
                const line = normLines[n.productId]!;
                const errs = normErrors[n.productId] ?? {};
                const over = line.checked ? Math.max(0, line.quantity - n.monthlyQuantity) : 0;
                const qtyId = `norm-${n.productId}-qty`;
                return (
                  <li
                    key={n.productId}
                    id={`norm-${n.productId}`}
                    className={cn(
                      'rounded-xl border p-3 transition-colors',
                      Object.keys(errs).length ? 'border-red-300 bg-red-50/40' : line.checked ? 'border-brand-300 bg-brand-50/40' : 'border-stone-200 bg-white',
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 accent-brand-700"
                        checked={line.checked}
                        onChange={(e) => updateNorm(n.productId, { checked: e.target.checked })}
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold break-words text-stone-900">{n.productName}</span>
                        <span className="block text-xs text-stone-500">
                          Định mức: <strong className="text-stone-700">{n.monthlyQuantity}</strong>
                          {n.unit ? ` ${n.unit}` : ''}/tháng
                          {n.category ? ` · ${n.category}` : ''}
                        </span>
                      </span>
                    </label>
                    {line.checked && (
                      <div className="mt-3 space-y-3 pl-8">
                        <div className="flex flex-wrap items-center gap-3">
                          <label htmlFor={qtyId} className="text-sm font-medium text-stone-700">
                            Số lượng
                          </label>
                          <QuantityStepper
                            id={qtyId}
                            label={`số lượng ${n.productName}`}
                            value={line.quantity}
                            invalid={Boolean(errs.quantity)}
                            onChange={(quantity) => updateNorm(n.productId, { quantity })}
                          />
                          {n.unit && <span className="text-sm text-stone-500">{n.unit}</span>}
                        </div>
                        {errs.quantity && <p className="text-xs font-medium text-red-700">{errs.quantity}</p>}
                        {(over > 0 || errs.reason) && (
                          <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            {over > 0 && (
                              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                                <TriangleAlert className="size-4" aria-hidden="true" />
                                VƯỢT ĐỊNH MỨC {over}
                                {n.unit ? ` ${n.unit}` : ''}
                              </p>
                            )}
                            <Field id={`norm-${n.productId}-reason`} label="Lý do vượt định mức" required error={errs.reason}>
                              <textarea
                                id={`norm-${n.productId}-reason`}
                                className="field-input min-h-16"
                                rows={2}
                                maxLength={LIMITS.proposalItemText}
                                value={line.reason}
                                aria-invalid={errs.reason ? true : undefined}
                                aria-describedby={describedBy(`norm-${n.productId}-reason`, errs.reason)}
                                onChange={(e) => updateNorm(n.productId, { reason: e.target.value })}
                              />
                            </Field>
                          </div>
                        )}
                        <Field id={`norm-${n.productId}-note`} label="Ghi chú" error={errs.note}>
                          <input
                            id={`norm-${n.productId}-note`}
                            className="field-input"
                            maxLength={LIMITS.proposalItemText}
                            value={line.note}
                            aria-invalid={errs.note ? true : undefined}
                            aria-describedby={describedBy(`norm-${n.productId}-note`, errs.note)}
                            onChange={(e) => updateNorm(n.productId, { note: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="extras-title">
        <h2 id="extras-title" className="section-title">
          Sản phẩm ngoài định mức {extras.length > 0 && <span className="text-sm font-normal text-stone-500">({extras.length})</span>}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Sản phẩm không có trong định mức: chọn từ danh mục hoặc nhập tên mới. Sản phẩm mới chỉ được thêm vào danh mục khi quản trị viên duyệt.
        </p>
        {catalog.status === 'error' && !catalog.data && (
          <InlineAlert tone="warning" className="mt-3">
            Không tải được danh mục sản phẩm — bạn vẫn có thể nhập tên sản phẩm.{' '}
            <button type="button" className="font-semibold underline" onClick={catalog.reload}>
              Thử lại
            </button>
          </InlineAlert>
        )}
        {extras.length > 0 && (
          <ol className="mt-3 space-y-3">
            {extras.map((line, index) => (
              <ExtraLineCard
                key={line.uid}
                index={index}
                line={line}
                errors={extraErrors[line.uid] ?? {}}
                candidates={extraCandidates.filter((p) => !chosenIds.has(p.productId) || p.productId === line.productId)}
                onChange={(next) => updateExtra(line.uid, next)}
                onRemove={() => removeExtra(line.uid)}
              />
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={addExtra}
          disabled={totalLines >= LIMITS.maxItems}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/60 px-4 py-3 text-sm font-bold tracking-wide text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PackagePlus className="size-5" aria-hidden="true" />+ THÊM SẢN PHẨM NGOÀI ĐỊNH MỨC
        </button>
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="reason-title">
        <h2 id="reason-title" className="section-title">
          Ghi chú chung
        </h2>
        <Field id="proposal-reason" label={<span className="sr-only">Ghi chú chung cho đề xuất</span>} error={general.reason} className="mt-2">
          <textarea
            id="proposal-reason"
            className="field-input min-h-20 resize-y"
            rows={3}
            maxLength={LIMITS.proposalReason}
            value={reason}
            placeholder="Không bắt buộc — ví dụ: cần trước ngày 15 cho đợt kiểm kê."
            onChange={(e) => {
              setReason(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
      </section>

      <div className="sticky bottom-0 z-20 -mx-3 space-y-3 border-t border-stone-200 bg-white/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:p-4 sm:shadow-sm">
        {submitError && <InlineAlert>{submitError}</InlineAlert>}
        {general.employeeId && <InlineAlert>{general.employeeId}</InlineAlert>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-stone-600">
            Đã chọn <strong className="text-stone-900">{totalLines}</strong> sản phẩm
          </p>
          <Button type="submit" size="lg" loading={submitting} disabled={totalLines === 0} icon={<Send className="size-4" aria-hidden="true" />}>
            {submitting ? 'Đang gửi…' : 'GỬI ĐỀ XUẤT'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function emptyExtra(): ExtraLine {
  return { uid: newUid(), productId: '', productName: '', unit: '', quantity: 1, reason: '', referenceUrl: '', note: '' };
}

function ExtraLineCard({
  index,
  line,
  errors,
  candidates,
  onChange,
  onRemove,
}: {
  index: number;
  line: ExtraLine;
  errors: LineErrors;
  candidates: PublicCatalogProduct[];
  onChange: (next: Partial<ExtraLine>) => void;
  onRemove: () => void;
}) {
  const base = `extra-${line.uid}`;
  const query = line.productId ? '' : line.productName;
  const suggestions = query.trim().length >= 2 ? searchProducts(candidates, query, 5) : [];
  // Máy chủ chỉ tự gắn tên tự gõ vào sản phẩm danh mục trùng khớp GIỮ DẤU — "Keo" vẫn là sản phẩm mới dù có "Kéo".
  const exact = suggestions.find((p) => exactNameKey(p.productName) === exactNameKey(query));

  return (
    <li id={base} className={cn('rounded-xl border bg-white p-3.5', Object.keys(errors).length ? 'border-red-300' : 'border-stone-200')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-brand-700">Ngoài định mức #{index + 1}</p>
        <Button
          variant="ghost"
          size="sm"
          className="-mt-1 text-red-700"
          onClick={onRemove}
          aria-label={`Xóa sản phẩm ngoài định mức ${index + 1}`}
          icon={<Trash2 className="size-4" aria-hidden="true" />}
        />
      </div>

      {line.productId ? (
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
          <div className="min-w-0">
            <p className="font-semibold break-words text-stone-900">{line.productName}</p>
            <p className="text-xs text-stone-500">Trong danh mục{line.unit ? ` · ĐVT: ${line.unit}` : ''}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onChange({ productId: '', productName: '', unit: '' })}>
            Đổi
          </Button>
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          <Field
            id={`${base}-name`}
            label="Tên sản phẩm"
            required
            error={errors.productName ?? errors.productId}
            hint="Gõ có dấu hoặc không dấu để tìm trong danh mục; không có thì cứ nhập tên mới."
          >
            <input
              id={`${base}-name`}
              className="field-input"
              autoComplete="off"
              maxLength={LIMITS.productName}
              value={line.productName}
              aria-invalid={errors.productName || errors.productId ? true : undefined}
              aria-describedby={describedBy(`${base}-name`, errors.productName ?? errors.productId, 'hint')}
              onChange={(e) => onChange({ productName: e.target.value })}
            />
          </Field>
          {suggestions.length > 0 && (
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200" aria-label="Sản phẩm trong danh mục">
              {suggestions.map((p) => (
                <li key={p.productId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50"
                    onClick={() => onChange({ productId: p.productId, productName: p.productName, unit: p.unit })}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium break-words text-stone-900">{p.productName}</span>
                      <span className="block text-xs text-stone-500">{[p.unit, p.category].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-brand-700">Chọn</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!exact && line.productName.trim().length >= 2 && (
            <p className="text-xs text-stone-500">
              Sẽ đề xuất <strong className="text-stone-700">sản phẩm mới</strong> “{line.productName.trim()}” — chờ quản trị viên duyệt.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {!line.productId && (
          <Field id={`${base}-unit`} label="ĐVT" error={errors.unit} hint="Ví dụ: Cây, Hộp, Ram…">
            <input
              id={`${base}-unit`}
              className="field-input"
              maxLength={LIMITS.unit}
              value={line.unit}
              aria-invalid={errors.unit ? true : undefined}
              aria-describedby={describedBy(`${base}-unit`, errors.unit, 'hint')}
              onChange={(e) => onChange({ unit: e.target.value })}
            />
          </Field>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${base}-qty`} className="text-sm font-medium text-stone-800">
            Số lượng<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
          </label>
          <QuantityStepper
            id={`${base}-qty`}
            label={`số lượng sản phẩm ngoài định mức ${index + 1}`}
            value={line.quantity}
            invalid={Boolean(errors.quantity)}
            describedBy={errors.quantity ? `${base}-qty-error` : undefined}
            onChange={(quantity) => onChange({ quantity })}
          />
          {errors.quantity && (
            <p id={`${base}-qty-error`} className="text-xs font-medium text-red-700">
              {errors.quantity}
            </p>
          )}
        </div>
      </div>

      <Field id={`${base}-reason`} label="Lý do cần mua" required error={errors.reason} className="mt-3">
        <textarea
          id={`${base}-reason`}
          className="field-input min-h-16"
          rows={2}
          maxLength={LIMITS.proposalItemText}
          value={line.reason}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={describedBy(`${base}-reason`, errors.reason)}
          onChange={(e) => onChange({ reason: e.target.value })}
        />
      </Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field id={`${base}-url`} label="Link tham khảo" error={errors.referenceUrl}>
          <input
            id={`${base}-url`}
            type="url"
            inputMode="url"
            className="field-input"
            placeholder="https://…"
            maxLength={LIMITS.url}
            value={line.referenceUrl}
            aria-invalid={errors.referenceUrl ? true : undefined}
            aria-describedby={describedBy(`${base}-url`, errors.referenceUrl)}
            onChange={(e) => onChange({ referenceUrl: e.target.value })}
          />
        </Field>
        <Field id={`${base}-note`} label="Ghi chú" error={errors.note}>
          <input
            id={`${base}-note`}
            className="field-input"
            maxLength={LIMITS.proposalItemText}
            value={line.note}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy(`${base}-note`, errors.note)}
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </Field>
      </div>
    </li>
  );
}

function DoneView({ result, onNew }: { result: ProposalSubmitResult; onNew: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section className="card overflow-hidden" aria-labelledby="proposal-done-title">
      <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
        <CircleCheck className="mx-auto size-12 text-emerald-600" aria-hidden="true" />
        <h1 id="proposal-done-title" ref={headingRef} tabIndex={-1} className="mt-2 text-xl font-bold tracking-wide text-emerald-900 focus:outline-none">
          ĐÃ GỬI ĐỀ XUẤT
        </h1>
        <p className="mt-1 text-sm text-emerald-800">
          {result.duplicate
            ? 'Đề xuất này đã được gửi trước đó — hệ thống không tạo đề xuất thứ hai.'
            : 'Quản trị viên sẽ xem xét và duyệt đề xuất của bạn.'}
        </p>
      </div>
      <dl className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Mã đề xuất</dt>
          <dd className="mt-1 font-mono text-lg font-bold text-brand-900">{result.proposalCode}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Trạng thái</dt>
          <dd className="mt-1 font-semibold text-stone-900">{PROPOSAL_STATUS_LABELS[result.status] ?? result.status}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">Số sản phẩm</dt>
          <dd className="mt-1 font-semibold text-stone-900">{result.itemCount}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2 border-t border-stone-200 p-5 sm:flex-row">
        <Button onClick={onNew} icon={<ShoppingCart className="size-4" aria-hidden="true" />}>
          TẠO ĐỀ XUẤT KHÁC
        </Button>
        <ButtonLink to="/" icon={<Home className="size-4" aria-hidden="true" />}>
          Về trang chủ
        </ButtonLink>
      </div>
    </section>
  );
}
