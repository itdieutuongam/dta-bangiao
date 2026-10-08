import { ClipboardCheck, GitMerge, PackagePlus, Pencil, Scale, SkipForward } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LIMITS } from '../../../../shared/constants';
import { promoteProductSchema, toFieldErrors } from '../../../../shared/schemas';
import { sameUnit } from '../../../../shared/text';
import type { DataReviewResponse, NormScope, ReviewProduct, StockDrift, VppProduct } from '../../../../shared/vpp';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { describedBy, Field } from '../../../components/ui/Field';
import { NumberInput } from '../../../components/ui/NumberInput';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, InlineAlert, LoadingCard } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { CatalogBadge, Qty } from '../../../components/vpp/Badges';
import { ProductPicker, productOptionLabel } from '../../../components/vpp/ProductPicker';
import { AdjustDialog, ProductDialog, type AdjustTarget } from '../../../components/vpp/StockDialogs';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { adminReconcileStock } from '../../../services/adminApi';
import { ApiClientError, errorMessage, isApiError, isStaleStateError } from '../../../services/api';
import {
  vppDataReview,
  vppMergeProduct,
  vppProducts,
  vppPromoteProduct,
  vppSetScopeMapping,
  vppSkipReview,
  vppSyncStock,
  type MergeResult,
} from '../../../services/vppApi';
import { numberFormatError, parseViNumber, withNumberFormatErrors } from '../../../utils/number';
import { searchProducts } from '../../../utils/productSearch';

type Dialog =
  | { kind: 'merge'; source: ReviewProduct }
  | { kind: 'promote'; source: ReviewProduct }
  | { kind: 'skip'; source: ReviewProduct }
  | { kind: 'adjust'; target: AdjustTarget }
  | { kind: 'edit'; product: VppProduct }
  | null;

function adjustTargetOf(p: ReviewProduct): AdjustTarget {
  return {
    productId: p.productId,
    productName: p.productName,
    unit: p.unit,
    stock: { onHand: p.onHand, reserved: p.reserved, rawInitialValue: p.rawInitialValue },
  };
}

/** Kiểm kê sản phẩm lệch sổ: số trên sheet là số hiện có (điền sẵn — đúng thì lưu luôn để ghi vào sổ). */
function driftAdjustTarget(d: StockDrift): AdjustTarget {
  return {
    productId: d.productId,
    productName: d.productName,
    unit: d.unit,
    stock: { onHand: d.sheet.onHand, reserved: d.sheet.reserved, rawInitialValue: d.sheet.invalidValue ?? '' },
  };
}

/** /admin/vpp/data-review — dữ liệu VPP cần người kiểm tra: KHÔNG tự ghép, KHÔNG tự đoán số lượng. */
export default function VppDataReviewPage() {
  useDocumentTitle('Dữ liệu cần kiểm tra');
  const { handleError } = useAdmin();
  const toast = useToast();
  const review = useAsync(async () => {
    const [data, products] = await Promise.all([vppDataReview(), vppProducts({ includeArchived: true })]);
    return { data, products };
  }, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (review.status === 'error' && isApiError(review.error) && review.error.status === 401) handleError(review.error);
  }, [review.status, review.error, handleError]);

  const productById = useMemo(() => new Map((review.data?.products ?? []).map((p) => [p.productId, p])), [review.data]);

  function done(message: string) {
    setDialog(null);
    toast.show(message);
    review.reload();
  }

  function edit(productId: string) {
    const product = productById.get(productId);
    if (product) setDialog({ kind: 'edit', product });
    else toast.show('Không tìm thấy sản phẩm — hãy tải lại trang.', 'error');
  }

  async function skip(source: ReviewProduct) {
    setBusy(`skip:${source.productId}`);
    setSkipError(null);
    try {
      await vppSkipReview(source.productId);
      done(`Đã giữ “${source.productName}” là sản phẩm riêng.`);
    } catch (err) {
      if (isApiError(err) && err.status === 401) handleError(err);
      else {
        // Hiện trong hộp thoại (toast bị lớp phủ che); sản phẩm vừa được xử lý ở nơi khác → tải lại danh sách.
        setSkipError(errorMessage(err, 'Không bỏ qua được.'));
        if (isStaleStateError(err)) review.reload();
      }
    } finally {
      setBusy(null);
    }
  }

  async function reconcile(handoverId: string, code: string) {
    setBusy(`reconcile:${handoverId}`);
    try {
      await adminReconcileStock(handoverId);
      done(`Đã đối soát kho theo phiếu ${code}.`);
    } catch (err) {
      handleError(err, 'Không đối soát được kho.');
    } finally {
      setBusy(null);
    }
  }

  async function syncStock(drift: StockDrift) {
    setBusy(`sync:${drift.productId}`);
    try {
      await vppSyncStock(drift.productId);
      done(`Đã đồng bộ tồn “${drift.productName}” theo sổ biến động.`);
    } catch (err) {
      handleError(err, 'Không đồng bộ được tồn kho.');
      // Số liệu vừa đổi (máy chủ từ chối đồng bộ) → tải lại để thấy tình trạng hiện tại.
      if (isStaleStateError(err)) review.reload();
    } finally {
      setBusy(null);
    }
  }

  async function mapDepartment(department: string, scopeId: string) {
    if (!scopeId) return;
    setBusy(`dept:${department}`);
    try {
      await vppSetScopeMapping(department, scopeId);
      done(`Đã gắn phòng ban “${department}”.`);
    } catch (err) {
      handleError(err, 'Không gắn được phòng ban.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <PageHeader
        title="Dữ liệu cần kiểm tra"
        description="Dữ liệu tồn đầu kỳ / định mức chưa rõ được giữ nguyên bản gốc. Hệ thống chỉ GỢI Ý — mọi thao tác ghép, tạo mới, kiểm kê đều do quản trị viên quyết định."
      />
      {review.status === 'loading' && !review.data && <LoadingCard lines={8} />}
      {review.status === 'error' && !review.data && <ErrorState title="Không tải được dữ liệu cần kiểm tra." error={review.error} onRetry={review.reload} />}

      {review.data && (
        <ReviewBody
          data={review.data.data}
          busy={busy}
          onDialog={setDialog}
          onSkip={(s) => {
            setSkipError(null);
            setDialog({ kind: 'skip', source: s });
          }}
          onEdit={edit}
          onReconcile={reconcile}
          onSyncStock={syncStock}
          onMapDepartment={mapDepartment}
        />
      )}

      {review.data && (
        <>
          <MergeDialog
            open={dialog?.kind === 'merge'}
            source={dialog?.kind === 'merge' ? dialog.source : null}
            masters={review.data.data.masters}
            onClose={() => setDialog(null)}
            onDone={(target, norms) => done(`Đã ghép vào “${target}”.${mergeNormsNote(target, norms)}`)}
            onStale={review.reload}
          />
          <PromoteDialog
            open={dialog?.kind === 'promote'}
            source={dialog?.kind === 'promote' ? dialog.source : null}
            scopes={review.data.data.scopes}
            onClose={() => setDialog(null)}
            onDone={(name) => done(`Đã đưa “${name}” vào danh mục.`)}
          />
          <ConfirmDialog
            open={dialog?.kind === 'skip'}
            title="Giữ là sản phẩm riêng?"
            description={
              dialog?.kind === 'skip'
                ? `“${dialog.source.productName}” sẽ được giữ là sản phẩm tạm riêng (ngoài định mức), không ghép vào sản phẩm danh mục nào. Tồn kho giữ nguyên.`
                : undefined
            }
            confirmLabel="BỎ QUA"
            loading={dialog?.kind === 'skip' && busy === `skip:${dialog.source.productId}`}
            error={dialog?.kind === 'skip' ? skipError : null}
            onConfirm={() => dialog?.kind === 'skip' && void skip(dialog.source)}
            onClose={() => setDialog(null)}
          />
          <AdjustDialog
            open={dialog?.kind === 'adjust'}
            product={dialog?.kind === 'adjust' ? dialog.target : null}
            onClose={() => setDialog(null)}
            onDone={(p, duplicate) =>
              done(
                duplicate
                  ? `Lần kiểm kê “${p.productName}” ĐÃ được ghi ở lần gửi trước (lần đó mất kết nối) — không ghi thêm. Tồn: ${p.stock.onHand ?? 'chưa rõ'}.`
                  : `Đã kiểm kê “${p.productName}”: tồn ${p.stock.onHand ?? 'chưa rõ'}.`,
              )
            }
            onStale={review.reload}
          />
          <ProductDialog
            open={dialog?.kind === 'edit'}
            product={dialog?.kind === 'edit' ? dialog.product : null}
            onClose={() => setDialog(null)}
            onSaved={(p) => done(`Đã lưu “${p.productName}”.`)}
            onStale={review.reload}
          />
        </>
      )}
    </div>
  );
}

function Section({ id, title, count, hint, children }: { id: string; title: string; count: number; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 id={id} className="text-sm font-semibold text-stone-800">
          <span aria-hidden="true">{count > 0 ? '🟡 ' : '✅ '}</span>
          {title}
        </h2>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700 tabular-nums">{count}</span>
      </div>
      {hint && <p className="border-b border-stone-100 px-4 py-2 text-xs text-stone-500">{hint}</p>}
      {count === 0 ? <p className="px-4 py-4 text-sm text-stone-500">Không có mục nào.</p> : children}
    </section>
  );
}

function ProductLine({ p, children, extra }: { p: ReviewProduct; children?: ReactNode; extra?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium break-words text-stone-900">{p.productName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
          <span className="font-mono">{p.productCode}</span>
          <span>· ĐVT: {p.unit || <em className="text-amber-700">trống</em>}</span>
          <span>
            · Tồn: <Qty value={p.onHand} />
          </span>
          {p.rawInitialValue && <span>· Gốc: “{p.rawInitialValue}”</span>}
          <CatalogBadge status={p.catalogStatus} />
        </p>
        {p.note && <p className="mt-0.5 text-xs break-words text-stone-500">{p.note}</p>}
        {extra}
      </div>
      {children && <div className="flex flex-wrap gap-1.5">{children}</div>}
    </li>
  );
}

function ReviewBody({
  data,
  busy,
  onDialog,
  onSkip,
  onEdit,
  onReconcile,
  onSyncStock,
  onMapDepartment,
}: {
  data: DataReviewResponse;
  busy: string | null;
  onDialog: (d: Dialog) => void;
  onSkip: (p: ReviewProduct) => void;
  onEdit: (productId: string) => void;
  onReconcile: (handoverId: string, code: string) => void;
  onSyncStock: (drift: StockDrift) => void;
  onMapDepartment: (department: string, scopeId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Section
        id="rv-unmapped"
        title="Tồn đầu kỳ chưa ghép với danh mục"
        count={data.unmapped.length}
        hint="GHÉP: chuyển tồn sang sản phẩm danh mục có sẵn. TẠO SẢN PHẨM MỚI: đưa vào danh mục. BỎ QUA: giữ là sản phẩm tạm riêng."
      >
        <ul className="divide-y divide-stone-100">
          {data.unmapped.map((p) => (
            <ProductLine
              key={p.productId}
              p={p}
              extra={
                p.suggestions && p.suggestions.length > 0 ? (
                  <p className="mt-1 text-xs text-brand-800">
                    Gợi ý: {p.suggestions.map((s) => `${s.productName}${s.unit ? ` (${s.unit})` : ''} – ${s.score}%`).join(' · ')}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">Không có gợi ý tương tự trong danh mục.</p>
                )
              }
            >
              <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: 'merge', source: p })} icon={<GitMerge className="size-4" aria-hidden="true" />}>
                GHÉP
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: 'promote', source: p })} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
                TẠO SẢN PHẨM MỚI
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onSkip(p)}
                loading={busy === `skip:${p.productId}`}
                icon={<SkipForward className="size-4" aria-hidden="true" />}
              >
                BỎ QUA
              </Button>
            </ProductLine>
          ))}
        </ul>
      </Section>

      <Section
        id="rv-unclear"
        title="Số lượng tồn chưa rõ"
        count={data.unclearQuantity.length}
        hint="Giữ nguyên giá trị gốc (ví dụ “hết năm”) — không tự hiểu là 0. Đếm thực tế rồi bấm KIỂM KÊ."
      >
        <ul className="divide-y divide-stone-100">
          {data.unclearQuantity.map((p) => (
            <ProductLine key={p.productId} p={p}>
              <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: 'adjust', target: adjustTargetOf(p) })} icon={<ClipboardCheck className="size-4" aria-hidden="true" />}>
                KIỂM KÊ
              </Button>
            </ProductLine>
          ))}
        </ul>
      </Section>

      <Section id="rv-unit" title="Thiếu đơn vị tính" count={data.missingUnit.length} hint="Ví dụ “Paper clips: 5” — không rõ 5 hộp hay 5 cái. Sửa sản phẩm để nhập ĐVT.">
        <ul className="divide-y divide-stone-100">
          {data.missingUnit.map((p) => (
            <ProductLine key={p.productId} p={p}>
              <Button size="sm" variant="secondary" onClick={() => onEdit(p.productId)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                Sửa
              </Button>
            </ProductLine>
          ))}
        </ul>
      </Section>

      <Section id="rv-duplicates" title="Tên sản phẩm trùng nhau" count={data.duplicates.length} hint="Ghép sản phẩm thừa vào sản phẩm còn giữ lại.">
        <ul className="divide-y divide-stone-100">
          {data.duplicates.map((group) => (
            <li key={group.normalizedName} className="px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">“{group.normalizedName}”</p>
              <ul className="mt-1 space-y-1">
                {group.products.map((p) => (
                  <li key={p.productId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {p.productName} <span className="font-mono text-xs text-stone-500">{p.productCode}</span> · <CatalogBadge status={p.catalogStatus} /> · Tồn{' '}
                      <Qty value={p.onHand} unit={p.unit} />
                    </span>
                    {p.catalogStatus === 'PENDING_APPROVAL' ? (
                      <span className="text-xs text-stone-500">Chờ duyệt — xử lý trong đề xuất</span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: 'merge', source: p })} icon={<GitMerge className="size-4" aria-hidden="true" />}>
                        Ghép sản phẩm này
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="rv-departments"
        title="Phòng ban chưa gắn định mức"
        count={data.unmappedDepartments.length}
        hint={
          <>
            Nhân viên phòng ban này không được kiểm tra định mức. Chọn phạm vi phù hợp hoặc xem đầy đủ ở{' '}
            <Link to="/admin/vpp/dinh-muc" className="font-semibold text-brand-700 underline">
              Định mức
            </Link>
            .
          </>
        }
      >
        <ul className="divide-y divide-stone-100">
          {data.unmappedDepartments.map((d) => (
            <li key={d.department} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm">
                <span className="font-medium text-stone-900">{d.department}</span> <span className="text-stone-500">· {d.employeeCount} nhân viên</span>
              </p>
              <select
                className="field-input w-full sm:w-64"
                aria-label={`Gắn phòng ban ${d.department}`}
                defaultValue=""
                disabled={busy === `dept:${d.department}`}
                onChange={(e) => onMapDepartment(d.department, e.target.value)}
              >
                <option value="" disabled>
                  Chọn phạm vi định mức…
                </option>
                <option value="NONE">Không áp dụng định mức</option>
                {data.scopes.map((s) => (
                  <option key={s.scopeId} value={s.scopeId}>
                    {s.scopeName}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="rv-mismatch"
        title="Phiếu văn phòng phẩm lệch kho"
        count={data.stockMismatches.length}
        hint="Giữ chỗ / xuất kho không khớp trạng thái phiếu (ví dụ sau sự cố ghi dở). ĐỐI SOÁT KHO an toàn khi bấm nhiều lần."
      >
        <ul className="divide-y divide-stone-100">
          {data.stockMismatches.map((m) => (
            <li key={m.handoverId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link to={`/admin/ban-giao/${m.handoverId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                {m.handoverCode}
              </Link>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === `reconcile:${m.handoverId}`}
                onClick={() => onReconcile(m.handoverId, m.handoverCode)}
                icon={<Scale className="size-4" aria-hidden="true" />}
              >
                ĐỐI SOÁT KHO
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="rv-drift"
        title="Số tồn lệch sổ biến động kho"
        count={data.stockDrifts.length}
        hint="Số tồn trên sheet VPP_TON_KHO khác tổng các biến động đã ghi (ghi dở do sự cố, hoặc có người sửa tay sheet). ĐỒNG BỘ THEO SỔ đặt lại số tồn theo sổ biến động (có ghi lịch sử); nếu thực tế khác, hãy KIỂM KÊ sau đó. Sản phẩm chưa có dòng nào trong sổ thì không đồng bộ theo sổ được — dùng KIỂM KÊ."
      >
        <ul className="divide-y divide-stone-100">
          {data.stockDrifts.map((d) => {
            // Sổ chưa có dòng nào của sản phẩm: số trên sheet chưa từng được ghi vào sổ (thường là tồn đầu kỳ nhập tay).
            // Máy chủ từ chối "đồng bộ theo sổ" (sẽ xóa mất số đó) → phải kiểm kê để ghi số vào sổ.
            const unrecorded = d.ledger.movements === 0;
            return (
              <li key={d.productId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium break-words text-stone-900">
                    {d.productName} <span className="font-mono text-xs text-stone-500">{d.productCode}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-stone-600">
                    Trên sheet: tồn{' '}
                    {d.sheet.invalidValue ? (
                      <strong className="text-red-700">không hợp lệ “{d.sheet.invalidValue}”</strong>
                    ) : (
                      <Qty value={d.sheet.onHand} unit={d.unit} />
                    )}
                    , giữ chỗ {d.sheet.reserved} ·{' '}
                    {unrecorded ? (
                      'Sổ biến động: chưa có dòng nào'
                    ) : (
                      <>
                        Theo sổ: tồn <Qty value={d.ledger.onHand} unit={d.unit} />, giữ chỗ {d.ledger.reserved}
                      </>
                    )}
                  </p>
                  {unrecorded && (
                    <p className="mt-1 text-xs text-amber-800">
                      Số tồn trên sheet chưa từng được ghi vào sổ biến động kho (thường là tồn đầu kỳ nhập tay) nên không đồng bộ theo sổ được.
                      Nếu số này đúng, bấm KIỂM KÊ và lưu đúng số đó để ghi vào sổ; nếu sai, KIỂM KÊ với số thực tế đếm được.
                    </p>
                  )}
                </div>
                {unrecorded ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onDialog({ kind: 'adjust', target: driftAdjustTarget(d) })}
                    icon={<ClipboardCheck className="size-4" aria-hidden="true" />}
                  >
                    KIỂM KÊ
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === `sync:${d.productId}`}
                    onClick={() => onSyncStock(d)}
                    icon={<Scale className="size-4" aria-hidden="true" />}
                  >
                    ĐỒNG BỘ THEO SỔ
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="rv-pending" title="Sản phẩm mới chờ duyệt (từ đề xuất)" count={data.pendingApproval.length} hint="Xử lý trong trang chi tiết đề xuất mua.">
        <ul className="divide-y divide-stone-100">
          {data.pendingApproval.map((p) => (
            <ProductLine key={p.productId} p={p} />
          ))}
        </ul>
        <p className="px-4 pb-3">
          <Link to="/admin/vpp/de-xuat" className="text-sm font-semibold text-brand-700 hover:underline">
            Mở danh sách đề xuất →
          </Link>
        </p>
      </Section>

      <Section id="rv-norm" title="Sản phẩm danh mục chưa có định mức" count={data.missingNorm.length} hint="Không bắt buộc — sản phẩm không có định mức được xem là ngoài định mức.">
        <ul className="divide-y divide-stone-100">
          {data.missingNorm.map((p) => (
            <ProductLine key={p.productId} p={p} />
          ))}
        </ul>
        <p className="px-4 pb-3">
          <Link to="/admin/vpp/dinh-muc" className="text-sm font-semibold text-brand-700 hover:underline">
            Thêm định mức →
          </Link>
        </p>
      </Section>

      <Section
        id="rv-minimum"
        title="Sản phẩm danh mục chưa đặt tồn tối thiểu"
        count={data.missingMinimumStock.length}
        hint="Tồn tối thiểu = 0 nghĩa là chỉ cảnh báo khi hết hàng. Đặt mức phù hợp để có cảnh báo SẮP HẾT."
      >
        <ul className="divide-y divide-stone-100">
          {data.missingMinimumStock.map((p) => (
            <ProductLine key={p.productId} p={p}>
              <Button size="sm" variant="ghost" onClick={() => onEdit(p.productId)} icon={<Pencil className="size-4" aria-hidden="true" />}>
                Đặt tồn tối thiểu
              </Button>
            </ProductLine>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/**
 * Định mức của sản phẩm nguồn sau GHÉP (Apps Script transferNormsOnMerge_): cùng ĐVT → chuyển sang sản phẩm đích; khác ĐVT hoặc
 * đích đã có định mức phạm vi đó → ngừng áp dụng (không tự quy đổi số lượng định mức). Báo rõ để kiểm tra trang Định mức.
 */
function mergeNormsNote(target: string, norms: MergeResult['norms']): string {
  const parts: string[] = [];
  if (norms.moved.length) parts.push(` Định mức ${norms.moved.join(', ')} đã chuyển sang “${target}”.`);
  if (norms.deactivated.length) parts.push(` Định mức ${norms.deactivated.join(', ')} NGỪNG áp dụng — kiểm tra trang Định mức.`);
  return parts.join('');
}

function MergeDialog({
  open,
  source,
  masters,
  onClose,
  onDone,
  onStale,
}: {
  open: boolean;
  source: ReviewProduct | null;
  masters: DataReviewResponse['masters'];
  onClose: () => void;
  onDone: (targetName: string, norms: MergeResult['norms']) => void;
  /** Sản phẩm vừa được xử lý ở nơi khác (INVALID_STATE…) → trang tải lại danh sách. */
  onStale: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitConverted, setUnitConverted] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open || !source) return;
    // Không chọn sẵn sản phẩm đích (kể cả gợi ý đầu tiên) và KHÔNG điền sẵn số lượng: ghép là thao tác chuyển tồn —
    // admin phải tự chọn, và số lượng phải tính theo ĐVT của sản phẩm đích (để trống = chuyển nguyên số nếu cùng ĐVT).
    setTargetId('');
    setQuery('');
    setQuantity('');
    setUnitConverted(false);
    setReason('');
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.productId]);

  const candidates = useMemo(() => {
    const list = masters.filter((m) => m.productId !== source?.productId);
    const suggested = new Set((source?.suggestions ?? []).map((s) => s.productId));
    const found = searchProducts(
      list.map((m) => ({ ...m, category: '' })),
      query,
      200,
    );
    // Gợi ý lên đầu (chỉ để chọn nhanh — không tự ghép).
    return [...found.filter((m) => suggested.has(m.productId)), ...found.filter((m) => !suggested.has(m.productId))];
  }, [masters, source, query]);

  // Sản phẩm đích khác sản phẩm nguồn (danh sách chọn đã loại sản phẩm nguồn).
  const target = masters.find((m) => m.productId === targetId && m.productId !== source?.productId) ?? null;
  // Phải quy đổi khi ĐVT khác nhau (GIỮ DẤU: "Cuốn" ≠ "Cuộn") hoặc một bên chưa có ĐVT ("Kim bấm: 11" — 11 hộp hay 11 cái?).
  // Khớp sameUnit_ ở Apps Script.
  const needsConversion = Boolean(target && !sameUnit(source?.unit ?? '', target.unit));
  const targetUnitText = target?.unit ? `“${target.unit}”` : 'của sản phẩm đích (chưa có ĐVT)';

  function chooseTarget(id: string) {
    setTargetId(id);
    // Đổi sản phẩm đích → số đã nhập có thể theo ĐVT khác → nhập lại và xác nhận lại.
    setQuantity('');
    setUnitConverted(false);
    setErrors({});
  }

  async function save() {
    if (!source || saving) return;
    const next: Record<string, string> = {};
    if (!target) next.targetProductId = 'Chọn sản phẩm danh mục để ghép';
    const qty = parseViNumber(quantity);
    if (qty !== null && (!Number.isInteger(qty) || qty < 0 || qty > LIMITS.maxQuantity)) {
      next.quantity = numberFormatError(quantity) ?? 'Số lượng phải là số nguyên ≥ 0';
    }
    if (qty === null && source.onHand === null) next.quantity = 'Tồn nguồn chưa rõ — nhập số lượng thực tế.';
    // Nguồn tồn 0: không có gì để chuyển — để trống được (máy chủ chuyển 0), không cần quy đổi.
    else if (qty === null && needsConversion && (source.onHand ?? 0) > 0) {
      next.quantity = `Nhập số lượng đã quy đổi theo ĐVT ${targetUnitText}.`;
    }
    if (needsConversion && qty !== null && qty > 0 && !unitConverted) {
      next.unitConverted = `Xác nhận số lượng đã quy đổi sang ĐVT ${targetUnitText}.`;
    }
    setErrors(next);
    if (!target || Object.keys(next).length) return;
    setSaving(true);
    setFormError(null);
    try {
      const result = await vppMergeProduct({
        sourceProductId: source.productId,
        targetProductId: target.productId,
        quantity: qty,
        unitConverted: needsConversion && unitConverted,
        reason: reason.trim(),
      });
      onDone(target.productName, result.norms);
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không ghép được sản phẩm.'));
      if (isStaleStateError(err)) onStale();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      title={source ? `GHÉP “${source.productName}”` : 'Ghép sản phẩm'}
      description="Tồn của sản phẩm nguồn được chuyển sang sản phẩm danh mục (ghi điều chỉnh ở cả hai). Sản phẩm nguồn được lưu trữ, không xóa."
      confirmLabel="Ghép"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      {source && (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          Nguồn: <strong>{source.productName}</strong> · ĐVT {source.unit || '(trống)'} · Tồn <Qty value={source.onHand} />
          {source.rawInitialValue ? ` · Gốc “${source.rawInitialValue}”` : ''}
        </p>
      )}
      <Field id="merge-target" label="Ghép vào sản phẩm danh mục" required error={errors.targetProductId}>
        <ProductPicker
          id="merge-target"
          query={query}
          onQueryChange={setQuery}
          searchLabel="Tìm sản phẩm đích"
          searchPlaceholder="Tìm sản phẩm…"
          options={candidates}
          selected={target}
          error={errors.targetProductId}
          optionLabel={(m) => `${(source?.suggestions ?? []).some((s) => s.productId === m.productId) ? '★ ' : ''}${productOptionLabel(m)}`}
          onSelect={(m) => chooseTarget(m.productId)}
        />
      </Field>
      <Field
        id="merge-qty"
        label={`Số lượng chuyển sang${target?.unit ? ` (${target.unit})` : ''}`}
        required={needsConversion || source?.onHand === null}
        error={errors.quantity}
        hint={
          needsConversion
            ? `${source?.unit ? `ĐVT khác nhau (${source.unit} → ${target?.unit || 'chưa có'})` : 'Sản phẩm nguồn chưa có ĐVT'} — nhập số đã quy đổi theo ĐVT ${targetUnitText}.`
            : 'Để trống: chuyển toàn bộ tồn nguồn (cùng ĐVT).'
        }
      >
        <NumberInput
          id="merge-qty"
          className="field-input"
          value={quantity}
          aria-invalid={errors.quantity ? true : undefined}
          aria-describedby={describedBy('merge-qty', errors.quantity, 'hint')}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      {needsConversion && (
        <div>
          <label className="flex items-start gap-2 text-sm text-stone-800">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={unitConverted}
              aria-invalid={errors.unitConverted ? true : undefined}
              aria-describedby={errors.unitConverted ? 'merge-unit-error' : undefined}
              onChange={(e) => setUnitConverted(e.target.checked)}
            />
            <span>
              Tôi xác nhận số lượng trên đã quy đổi sang ĐVT <strong>{targetUnitText}</strong>
              {target?.unit ? ' của sản phẩm đích' : ''}.
            </span>
          </label>
          {errors.unitConverted && (
            <p id="merge-unit-error" className="mt-1 text-xs font-medium text-red-700">
              {errors.unitConverted}
            </p>
          )}
        </div>
      )}
      <Field id="merge-reason" label="Ghi chú" error={errors.reason}>
        <input id="merge-reason" className="field-input" maxLength={LIMITS.stockReason} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}

const NEW_SCOPE = '__new__';

function PromoteDialog({
  open,
  source,
  scopes,
  onClose,
  onDone,
}: {
  open: boolean;
  source: ReviewProduct | null;
  scopes: NormScope[];
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [minimum, setMinimum] = useState('0');
  const [note, setNote] = useState('');
  const [withNorm, setWithNorm] = useState(false);
  const [scope, setScope] = useState('');
  const [scopeName, setScopeName] = useState('');
  const [normQty, setNormQty] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    // Đặt lại TRƯỚC khi hộp thoại hiện (layout effect) và chỉ khi mở / đổi sang đối tượng khác (theo ID): không để
    // người dùng gõ vào form còn giá trị cũ rồi bị ghi đè, không xóa dữ liệu đang nhập khi trang tải lại cùng đối tượng.
    if (!open || !source) return;
    setName(source.productName);
    setCode('');
    setCategory(source.category);
    setUnit(source.unit);
    setPrice('');
    setMinimum('0');
    setNote(source.note);
    setWithNorm(false);
    setScope(scopes[0]?.scopeId ?? NEW_SCOPE);
    setScopeName('');
    setNormQty('');
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.productId]);

  async function save() {
    if (!source || saving) return;
    const body = {
      productId: source.productId,
      productCode: code,
      productName: name,
      category,
      unit,
      referencePrice: parseViNumber(price, 'decimal'),
      minimumStock: parseViNumber(minimum) ?? 0,
      note,
      active: true,
      norm: withNorm
        ? {
            scopeId: scope === NEW_SCOPE ? '' : scope,
            scopeName: scope === NEW_SCOPE ? scopeName.trim() : '',
            monthlyQuantity: parseViNumber(normQty) ?? NaN,
            note: '',
          }
        : null,
    };
    const parsed = promoteProductSchema.safeParse(body);
    const fieldErrors = withNumberFormatErrors(parsed.success ? {} : toFieldErrors(parsed.error), {
      referencePrice: [price, 'decimal'],
      minimumStock: [minimum, 'integer'],
      ...(withNorm ? { 'norm.monthlyQuantity': [normQty, 'integer'] as const } : {}),
    });
    if (body.norm && !body.norm.scopeId && !body.norm.scopeName) fieldErrors['norm.scopeName'] ??= 'Nhập tên phạm vi mới';
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await vppPromoteProduct(body);
      onDone(name.trim());
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err, 'Không tạo được sản phẩm danh mục.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      wide
      title={source ? `TẠO SẢN PHẨM MỚI từ “${source.productName}”` : 'Tạo sản phẩm mới'}
      description="Đưa sản phẩm tạm vào danh mục chính thức (giữ nguyên tồn kho hiện có)."
      confirmLabel="Thêm vào danh mục"
      cancelLabel="Hủy"
      loading={saving}
      onConfirm={save}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="promote-name" label="Tên sản phẩm" required error={errors.productName} className="sm:col-span-2">
          <input
            id="promote-name"
            className="field-input"
            maxLength={LIMITS.productName}
            value={name}
            aria-invalid={errors.productName ? true : undefined}
            aria-describedby={describedBy('promote-name', errors.productName)}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field id="promote-unit" label="ĐVT" required error={errors.unit}>
          <input
            id="promote-unit"
            className="field-input"
            maxLength={LIMITS.unit}
            value={unit}
            aria-invalid={errors.unit ? true : undefined}
            aria-describedby={describedBy('promote-unit', errors.unit)}
            onChange={(e) => setUnit(e.target.value)}
          />
        </Field>
        <Field id="promote-code" label="Mã sản phẩm" error={errors.productCode} hint="Để trống: giữ mã hiện tại.">
          <input
            id="promote-code"
            className="field-input font-mono uppercase"
            maxLength={LIMITS.productCode}
            value={code}
            aria-describedby={describedBy('promote-code', errors.productCode, 'hint')}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field id="promote-category" label="Nhóm" error={errors.category}>
          <input id="promote-category" className="field-input" maxLength={LIMITS.productCategory} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field id="promote-price" label="Đơn giá tham khảo (₫)" error={errors.referencePrice}>
          <NumberInput
            id="promote-price"
            className="field-input"
            value={price}
            aria-invalid={errors.referencePrice ? true : undefined}
            aria-describedby={describedBy('promote-price', errors.referencePrice)}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field id="promote-min" label="Tồn tối thiểu" error={errors.minimumStock}>
          <NumberInput
            id="promote-min"
            className="field-input"
            value={minimum}
            aria-invalid={errors.minimumStock ? true : undefined}
            aria-describedby={describedBy('promote-min', errors.minimumStock)}
            onChange={(e) => setMinimum(e.target.value)}
          />
        </Field>
        <Field id="promote-note" label="Ghi chú" error={errors.note}>
          <input id="promote-note" className="field-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="space-y-3 rounded-lg border border-stone-200 p-3 sm:col-span-2">
          <label className="flex items-center gap-2.5 text-sm font-medium text-stone-800">
            <input type="checkbox" className="size-5 accent-brand-700" checked={withNorm} onChange={(e) => setWithNorm(e.target.checked)} />
            Thêm định mức tháng
          </label>
          {withNorm && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="promote-scope" label="Phạm vi" error={errors['norm.scopeId']}>
                <select id="promote-scope" className="field-input" value={scope} onChange={(e) => setScope(e.target.value)}>
                  {scopes.map((s) => (
                    <option key={s.scopeId} value={s.scopeId}>
                      {s.scopeName}
                    </option>
                  ))}
                  <option value={NEW_SCOPE}>+ Phạm vi mới…</option>
                </select>
              </Field>
              {scope === NEW_SCOPE && (
                <Field id="promote-scope-name" label="Tên phạm vi mới" required error={errors['norm.scopeName']}>
                  <input id="promote-scope-name" className="field-input" maxLength={120} value={scopeName} onChange={(e) => setScopeName(e.target.value)} />
                </Field>
              )}
              <Field id="promote-norm-qty" label="SL / tháng" required error={errors['norm.monthlyQuantity']}>
                <NumberInput
                  id="promote-norm-qty"
                  className="field-input"
                  value={normQty}
                  aria-invalid={errors['norm.monthlyQuantity'] ? true : undefined}
                  aria-describedby={describedBy('promote-norm-qty', errors['norm.monthlyQuantity'])}
                  onChange={(e) => setNormQty(e.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      </div>
      {formError && <InlineAlert>{formError}</InlineAlert>}
    </ConfirmDialog>
  );
}
