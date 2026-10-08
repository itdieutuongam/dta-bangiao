import { ClipboardCheck, History, PackagePlus, Pencil, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  CATALOG_STATUS_LABELS,
  CATALOG_STATUSES,
  STOCK_STATUS_LABELS,
  STOCK_STATUSES,
  formatVnd,
  type VppProduct,
} from '../../../../shared/vpp';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { CatalogBadge, Qty, StockStatusBadge } from '../../../components/vpp/Badges';
import { AdjustDialog, ProductDialog, StockInDialog } from '../../../components/vpp/StockDialogs';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { isApiError } from '../../../services/api';
import { vppProducts } from '../../../services/vppApi';
import { searchProducts } from '../../../utils/productSearch';

type DialogState = { kind: 'product'; product: VppProduct | null } | { kind: 'in' | 'adjust'; product: VppProduct } | null;

/** Máy chủ nhận ra thao tác (cùng mã) đã được ghi ở lần gửi trước — lần đó mất phản hồi — nên không ghi lần hai. */
const ALREADY_RECORDED = 'Thao tác này ĐÃ được ghi ở lần gửi trước (lần đó mất kết nối) — không ghi thêm.';

/** /admin/vpp/ton-kho — danh mục + tồn kho: tồn, giữ chỗ, khả dụng, tối thiểu; thêm / sửa sản phẩm, nhập kho, kiểm kê. */
export default function VppStockPage() {
  useDocumentTitle('Tồn kho văn phòng phẩm');
  const { handleError } = useAdmin();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const stockStatus = params.get('stockStatus') ?? '';
  const catalogStatus = params.get('catalogStatus') ?? '';
  // Lọc "Ngừng dùng" luôn phải lấy cả sản phẩm ngừng dùng (nếu không, danh sách luôn trống).
  const archivedFilter = catalogStatus === 'ARCHIVED';
  const includeArchived = params.get('includeArchived') === 'true' || archivedFilter;
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [dialog, setDialog] = useState<DialogState>(null);

  const list = useAsync(
    () => vppProducts({ stockStatus, catalogStatus, includeArchived }),
    [stockStatus, catalogStatus, includeArchived],
  );

  useEffect(() => {
    if (list.status === 'error' && isApiError(list.error) && list.error.status === 401) handleError(list.error);
  }, [list.status, list.error, handleError]);

  // Tìm ngay trên trình duyệt — không dấu / có dấu đều khớp ("but bi" = "Bút bi").
  const products = useMemo(() => searchProducts(list.data ?? [], query), [list.data, query]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function replaceProduct(updated: VppProduct, message: string) {
    if (list.data) {
      const exists = list.data.some((p) => p.productId === updated.productId);
      list.setData(exists ? list.data.map((p) => (p.productId === updated.productId ? { ...updated, normCount: p.normCount } : p)) : [updated, ...list.data]);
    }
    setDialog(null);
    toast.show(message);
    list.reload();
  }

  // Hộp thoại luôn hiện số liệu MỚI NHẤT của sản phẩm (vd. trang vừa tải lại sau một lần ghi lỗi chưa rõ kết quả) — cùng sản phẩm
  // nên nội dung đang nhập không bị xóa.
  const dialogProduct = dialog?.product ? (list.data?.find((p) => p.productId === dialog.product?.productId) ?? dialog.product) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Tồn kho văn phòng phẩm"
        description="Khả dụng = Tồn − Đang giữ chỗ (phiếu chờ ký). Tồn chỉ thay đổi qua nhập kho, phiếu bàn giao và kiểm kê — mọi biến động đều được ghi lịch sử."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportCsvButton dataset="stock" filters={{ q: query.trim(), stockStatus, catalogStatus, includeArchived: includeArchived ? 'true' : '' }} />
            <Button variant="primary" onClick={() => setDialog({ kind: 'product', product: null })} icon={<Plus className="size-4" aria-hidden="true" />}>
              Thêm sản phẩm
            </Button>
          </div>
        }
      />

      <section className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Bộ lọc">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Tìm tên, mã, ĐVT, nhóm…"
            aria-label="Tìm sản phẩm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="field-input" aria-label="Trạng thái tồn" value={stockStatus} onChange={(e) => setFilter('stockStatus', e.target.value)}>
          <option value="">Mọi trạng thái tồn</option>
          {STOCK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STOCK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="field-input" aria-label="Loại danh mục" value={catalogStatus} onChange={(e) => setFilter('catalogStatus', e.target.value)}>
          <option value="">Mọi loại danh mục</option>
          {CATALOG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CATALOG_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={includeArchived}
            disabled={archivedFilter}
            title={archivedFilter ? 'Đang lọc “Ngừng dùng” — luôn hiện sản phẩm ngừng dùng' : undefined}
            onChange={(e) => setFilter('includeArchived', e.target.checked ? 'true' : '')}
          />
          Hiện sản phẩm ngừng dùng
        </label>
      </section>

      <section className="card overflow-hidden" aria-labelledby="stock-title" aria-busy={list.status === 'loading'}>
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
          <h2 id="stock-title" className="text-sm font-semibold text-stone-800">
            {list.data ? `${products.length} sản phẩm` : 'Danh sách sản phẩm'}
          </h2>
          {list.status === 'loading' && list.data && <span className="text-xs text-stone-500">Đang cập nhật…</span>}
        </div>

        {list.status === 'loading' && !list.data && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {list.status === 'error' && !list.data && (
          <ErrorState className="border-0 shadow-none" title="Không tải được tồn kho." error={list.error} onRetry={list.reload} />
        )}
        {list.data && products.length === 0 && (
          <EmptyState
            title={list.data.length === 0 ? 'Chưa có sản phẩm nào.' : 'Không có sản phẩm phù hợp.'}
            description={list.data.length === 0 ? 'Chạy “Nạp định mức” trên Google Sheet hoặc thêm sản phẩm mới.' : 'Thử bỏ bớt bộ lọc hoặc từ khóa.'}
          />
        )}

        {products.length > 0 && (
          <>
            {/* Bảng — màn hình rộng */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Sản phẩm</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Tồn</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Giữ chỗ</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Khả dụng</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Tối thiểu</th>
                    <th scope="col" className="px-3 py-2.5">Trạng thái</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Đơn giá TK</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {products.map((p) => (
                    <tr key={p.productId} className={p.active ? '' : 'opacity-60'}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-stone-900">{p.productName}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                          <span className="font-mono">{p.productCode}</span>
                          {p.unit ? <span>· {p.unit}</span> : <span className="text-amber-700">· thiếu ĐVT</span>}
                          {p.category && <span>· {p.category}</span>}
                          {p.catalogStatus !== 'MASTER' && <CatalogBadge status={p.catalogStatus} />}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Qty value={p.stock.onHand} />
                        {p.stock.onHand === null && p.stock.rawInitialValue && (
                          <span className="block text-xs text-stone-500">“{p.stock.rawInitialValue}”</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.stock.reserved}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">
                        <Qty value={p.stock.available} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.minimumStock}</td>
                      <td className="px-3 py-2.5">
                        <StockStatusBadge status={p.stock.status} />
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatVnd(p.referencePrice)}</td>
                      <td className="px-4 py-2.5">
                        <RowActions product={p} onOpen={setDialog} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Thẻ — mobile / tablet */}
            <ul className="divide-y divide-stone-100 lg:hidden">
              {products.map((p) => (
                <li key={p.productId} className={p.active ? 'p-4' : 'p-4 opacity-60'}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-stone-900">{p.productName}</p>
                      <p className="text-xs text-stone-500">
                        <span className="font-mono">{p.productCode}</span>
                        {p.unit ? ` · ${p.unit}` : ' · thiếu ĐVT'}
                        {p.category ? ` · ${p.category}` : ''}
                      </p>
                    </div>
                    <StockStatusBadge status={p.stock.status} />
                  </div>
                  <dl className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-stone-50 p-2 text-center text-xs">
                    <div>
                      <dt className="text-stone-500">Tồn</dt>
                      <dd className="font-semibold">
                        <Qty value={p.stock.onHand} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">Giữ</dt>
                      <dd className="font-semibold">{p.stock.reserved}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">Khả dụng</dt>
                      <dd className="font-semibold text-brand-800">
                        <Qty value={p.stock.available} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">Tối thiểu</dt>
                      <dd className="font-semibold">{p.minimumStock}</dd>
                    </div>
                  </dl>
                  {p.stock.onHand === null && p.stock.rawInitialValue && (
                    <p className="mt-1 text-xs text-amber-800">Dữ liệu gốc: “{p.stock.rawInitialValue}” — cần kiểm kê.</p>
                  )}
                  <div className="mt-2">
                    <RowActions product={p} onOpen={setDialog} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <ProductDialog
        open={dialog?.kind === 'product'}
        product={dialog?.kind === 'product' ? dialogProduct : null}
        onClose={() => setDialog(null)}
        onSaved={(p, duplicate) =>
          replaceProduct(
            p,
            duplicate
              ? `Sản phẩm ${p.productCode} ĐÃ được thêm ở lần gửi trước (lần đó mất kết nối) — không tạo thêm.`
              : dialog?.kind === 'product' && dialog.product
                ? 'Đã lưu sản phẩm.'
                : `Đã thêm sản phẩm ${p.productCode}.`,
          )
        }
        onStale={list.reload}
      />
      <StockInDialog
        open={dialog?.kind === 'in'}
        product={dialog?.kind === 'in' ? dialogProduct : null}
        onClose={() => setDialog(null)}
        onDone={(p, duplicate) =>
          replaceProduct(
            p,
            duplicate
              ? `${ALREADY_RECORDED} Tồn hiện tại: ${p.stock.onHand ?? 'chưa rõ'}.`
              : `Đã nhập kho ${p.productName}. Tồn mới: ${p.stock.onHand ?? 'chưa rõ'}.`,
          )
        }
        onStale={list.reload}
      />
      <AdjustDialog
        open={dialog?.kind === 'adjust'}
        product={dialog?.kind === 'adjust' ? dialogProduct : null}
        onClose={() => setDialog(null)}
        onDone={(p, duplicate) =>
          replaceProduct(
            p,
            duplicate
              ? `${ALREADY_RECORDED} Tồn hiện tại: ${p.stock.onHand ?? 'chưa rõ'}.`
              : `Đã kiểm kê ${p.productName}. Tồn mới: ${p.stock.onHand ?? 'chưa rõ'}.`,
          )
        }
        onStale={list.reload}
      />
    </div>
  );
}

function RowActions({ product, onOpen }: { product: VppProduct; onOpen: (state: DialogState) => void }) {
  // Sản phẩm chờ duyệt (từ đề xuất mua): máy chủ không cho nhập kho / kiểm kê / đổi trạng thái — quyết định trong đề xuất trước.
  const pendingApproval = product.catalogStatus === 'PENDING_APPROVAL';
  const usable = product.active && product.catalogStatus !== 'ARCHIVED' && !pendingApproval;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {pendingApproval && (
        <Link to="/admin/vpp/de-xuat" className="px-2 py-1.5 text-xs font-medium text-amber-800 underline-offset-2 hover:underline">
          Xử lý trong đề xuất mua
        </Link>
      )}
      {usable && (
        <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: 'in', product })} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
          Nhập
        </Button>
      )}
      {product.catalogStatus !== 'ARCHIVED' && !pendingApproval && (
        <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: 'adjust', product })} icon={<ClipboardCheck className="size-4" aria-hidden="true" />}>
          Kiểm kê
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: 'product', product })} icon={<Pencil className="size-4" aria-hidden="true" />}>
        Sửa
      </Button>
      <Link
        to={`/admin/vpp/lich-su?productId=${product.productId}`}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
        aria-label={`Lịch sử kho ${product.productName}`}
      >
        <History className="size-4" aria-hidden="true" />
        Lịch sử
      </Link>
    </div>
  );
}
