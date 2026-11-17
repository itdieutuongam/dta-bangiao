import { ClipboardCheck, History, MoreHorizontal, PackagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EMPTY_UNIFORM_TOTALS, UNIFORM_CONDITIONS, type UniformCondition, type UniformSku, type UniformStockModel } from '../../../../shared/uniform';
import { formatVnd } from '../../../../shared/vpp';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { genderLabel, KindBadge } from '../../../components/uniform/UniformBadges';
import { ModelDialog, SkuStockDialog, UniformStockInDialog } from '../../../components/uniform/UniformDialogs';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { Qty } from '../../../components/vpp/Badges';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { uniformStock } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { normalizeVietnamese } from '../../../../shared/text';

type DialogState =
  | { kind: 'model'; model: UniformStockModel | null }
  | { kind: 'in'; model: UniformStockModel; size?: string; condition?: UniformCondition }
  | { kind: 'adjust' | 'dispose'; model: UniformStockModel; sku: UniformSku }
  | null;

const ALREADY_RECORDED = 'Thao tác này ĐÃ được ghi ở lần gửi trước (lần đó mất kết nối) — không ghi thêm.';

const CELL_STYLES: Record<string, string> = {
  IN_STOCK: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  LOW_STOCK: 'bg-orange-50 text-orange-900 ring-orange-200',
  OUT_OF_STOCK: 'bg-red-50 text-red-800 ring-red-200',
  UNKNOWN: 'bg-amber-50 text-amber-900 ring-amber-200',
};

/** /admin/dong-phuc/ton-kho — mẫu đồng phục + ma trận tồn theo size (hàng mới / đã qua sử dụng); nhập kho, kiểm kê, thanh lý. */
export default function UniformStockPage() {
  useDocumentTitle('Tồn kho đồng phục');
  const toast = useToast();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const list = useAsync((signal) => uniformStock({ includeInactive }, signal), [includeInactive]);

  const models = useMemo(() => {
    const needle = normalizeVietnamese(query);
    const all = list.data?.models ?? [];
    if (!needle) return all;
    return all.filter((m) => normalizeVietnamese([m.modelName, m.modelCode, m.appliesTo, m.sizes.join(' ')].join(' ')).includes(needle));
  }, [list.data, query]);

  // Hộp thoại luôn dùng số liệu mới nhất của mẫu (trang vừa tải lại) — cùng mẫu nên dữ liệu đang nhập không bị xóa.
  const freshModel = (m: UniformStockModel | null) => (m ? (list.data?.models.find((x) => x.modelId === m.modelId) ?? m) : null);

  function done(message: string) {
    setDialog(null);
    toast.show(message);
    list.reload();
  }

  const totals = useMemo(() => {
    let received = 0;
    let handedOver = 0;
    let available = 0;
    let reserved = 0;
    for (const m of list.data?.models ?? []) {
      received += m.stock.received ?? 0;
      handedOver += m.stock.handedOver ?? 0;
      available += Math.max(0, m.stock.available ?? 0);
      reserved += m.stock.reserved;
    }
    return { received, handedOver, available, reserved };
  }, [list.data]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <PageHeader
        title="Tồn kho & mẫu đồng phục"
        description="Mỗi dòng là một mặt hàng (mẫu × size × tình trạng). Tồn đầu kỳ: số nhập lần đầu cộng các lần nhập bổ sung — không giảm khi bàn giao. Khả dụng = Tồn đầu kỳ − Đã bàn giao (± trả về, kiểm kê, thanh lý; trừ phần đang giữ cho phiếu chờ ký). Mọi biến động đều có lịch sử."
        actions={
          <>
            <ExportCsvButton dataset="uniform-stock" filters={{ q: query.trim(), includeInactive: includeInactive ? 'true' : '' }} />
            <Button variant="primary" onClick={() => setDialog({ kind: 'model', model: null })} icon={<Plus className="size-4" aria-hidden="true" />}>
              Thêm mẫu
            </Button>
          </>
        }
      />

      <section className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto]" aria-label="Bộ lọc">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            className="field-input pl-9"
            placeholder="Tìm tên mẫu, mã, đối tượng, size…"
            aria-label="Tìm mẫu đồng phục"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" className="size-4 accent-brand-700" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Hiện mẫu ngừng dùng
        </label>
      </section>

      {list.data && list.data.models.length > 0 && (
        <p className="text-sm text-stone-600">
          Tồn đầu kỳ: <strong className="tabular-nums">{totals.received.toLocaleString('vi-VN')}</strong> · Đã bàn giao:{' '}
          <strong className="tabular-nums">{totals.handedOver.toLocaleString('vi-VN')}</strong> · Khả dụng:{' '}
          <strong className="tabular-nums text-brand-800">{totals.available.toLocaleString('vi-VN')}</strong>
          {totals.reserved > 0 && <> · Đang giữ chỗ (phiếu chờ ký): {totals.reserved}</>}
        </p>
      )}

      {list.status === 'loading' && !list.data && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}
      {list.status === 'error' && !list.data && <ErrorState title="Không tải được tồn kho đồng phục." error={list.error} onRetry={list.reload} />}
      {list.data && models.length === 0 && (
        <div className="card">
          <EmptyState
            title={list.data.models.length === 0 ? 'Chưa có mẫu đồng phục nào.' : 'Không có mẫu phù hợp.'}
            description={
              list.data.models.length === 0
                ? 'Chủ Google Sheet chạy menu “DTA Handover → Khởi tạo danh mục đồng phục” (7 mẫu theo DS đồng phục của HCNS), hoặc bấm “Thêm mẫu”.'
                : 'Thử từ khóa khác.'
            }
          />
        </div>
      )}

      <div className="space-y-4">
        {models.map((m) => (
          <ModelCard key={m.modelId} model={m} onOpen={setDialog} />
        ))}
      </div>

      <ModelDialog
        open={dialog?.kind === 'model'}
        model={dialog?.kind === 'model' ? freshModel(dialog.model) : null}
        onClose={() => setDialog(null)}
        onSaved={(model, duplicate) =>
          done(
            duplicate
              ? `Mẫu ${model.modelCode} ĐÃ được thêm ở lần gửi trước — không tạo thêm.`
              : dialog?.kind === 'model' && dialog.model
                ? `Đã lưu mẫu ${model.modelName}.`
                : `Đã thêm mẫu ${model.modelCode} – ${model.modelName}.`,
          )
        }
        onStale={list.reload}
      />
      <UniformStockInDialog
        open={dialog?.kind === 'in'}
        model={dialog?.kind === 'in' ? freshModel(dialog.model) : null}
        initialSize={dialog?.kind === 'in' ? dialog.size : undefined}
        initialCondition={dialog?.kind === 'in' ? dialog.condition : undefined}
        onClose={() => setDialog(null)}
        onDone={(sku, duplicate) =>
          done(
            duplicate
              ? `${ALREADY_RECORDED} Khả dụng hiện tại: ${sku.stock.available ?? 'chưa rõ'}.`
              : `Đã nhập kho size ${sku.size}. Tồn đầu kỳ: ${sku.totals?.received ?? '—'} · khả dụng: ${sku.stock.available ?? 'chưa rõ'}.`,
          )
        }
        onStale={list.reload}
      />
      <SkuStockDialog
        open={dialog?.kind === 'adjust' || dialog?.kind === 'dispose'}
        mode={dialog?.kind === 'dispose' ? 'dispose' : 'adjust'}
        model={dialog?.kind === 'adjust' || dialog?.kind === 'dispose' ? freshModel(dialog.model) : null}
        sku={
          dialog?.kind === 'adjust' || dialog?.kind === 'dispose'
            ? (freshModel(dialog.model)?.skus.find((s) => s.productId === dialog.sku.productId) ?? dialog.sku)
            : null
        }
        onClose={() => setDialog(null)}
        onDone={(sku, duplicate) =>
          done(duplicate ? `${ALREADY_RECORDED} Tồn hiện tại: ${sku.stock.onHand ?? 'chưa rõ'}.` : `Đã cập nhật tồn size ${sku.size}: ${sku.stock.onHand ?? 'chưa rõ'}.`)
        }
        onStale={list.reload}
      />
    </div>
  );
}

function ModelCard({ model, onOpen }: { model: UniformStockModel; onOpen: (state: DialogState) => void }) {
  const extraSizes = [...new Set(model.skus.map((s) => s.size))].filter((s) => !model.sizes.includes(s));
  const sizes = [...model.sizes, ...extraSizes];
  // Mỗi dòng một mặt hàng: size × tình trạng (hàng mới trước, đã qua sử dụng sau)
  const rows = sizes.flatMap((size) =>
    UNIFORM_CONDITIONS.map((c) => model.skus.find((s) => s.size === size && s.condition === c)).filter((s): s is UniformSku => Boolean(s)),
  );
  // Mẫu từng có hàng mới? Không (chỉ hàng đã qua sử dụng / chưa nhập) → dòng "mới" = 0 không phải "hết hàng" (khớp dpNewStockTracked_).
  const newTracked = model.skus.some(
    (s) => s.condition === 'NEW' && ((s.totals?.received ?? 0) > 0 || (s.totals?.handedOver ?? 0) > 0 || (s.stock.onHand ?? 0) > 0),
  );
  const sum = rows.reduce(
    (acc, s) => {
      const t = s.totals ?? EMPTY_UNIFORM_TOTALS;
      acc.received += t.received;
      acc.handedOver += t.handedOver;
      acc.available += Math.max(0, s.stock.available ?? 0);
      return acc;
    },
    { received: 0, handedOver: 0, available: 0 },
  );
  return (
    <section className={cn('card p-4 sm:p-5', !model.active && 'opacity-60')} aria-labelledby={`dp-model-${model.modelId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`dp-model-${model.modelId}`} className="flex flex-wrap items-center gap-2 font-semibold text-stone-900">
            {model.modelName}
            <span className="font-mono text-xs font-normal text-stone-500">{model.modelCode}</span>
            <KindBadge kind={model.kind} />
            {!model.active && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">Ngừng dùng</span>}
          </h2>
          <p className="mt-0.5 text-xs text-stone-600">
            {genderLabel(model.gender)} · {model.unit}
            {model.referencePrice !== null ? ` · ${formatVnd(model.referencePrice)}` : ''}
            {model.countsTowardQuota ? ' · tính tiêu chuẩn năm' : ' · không tính tiêu chuẩn'}
            {model.minimumStock ? ` · tối thiểu ${model.minimumStock}/size` : ''}
          </p>
          {model.appliesTo && <p className="mt-0.5 text-xs text-stone-500">Đối tượng: {model.appliesTo}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {model.active && (
            <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: 'in', model })} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
              Nhập kho
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: 'model', model })} icon={<Pencil className="size-4" aria-hidden="true" />}>
            Sửa mẫu
          </Button>
          <Link
            to={`/admin/dong-phuc/lich-su?modelId=${model.modelId}`}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
          >
            <History className="size-4" aria-hidden="true" />
            Lịch sử
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-4 py-4 text-center text-sm text-stone-500">
          Chưa có size nào — bấm “Sửa mẫu” để thêm size.
        </p>
      ) : (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full text-sm" aria-label={`Tồn kho ${model.modelName} theo size`}>
            <thead className="text-xs text-stone-500">
              <tr className="border-b border-stone-200">
                <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                  Size
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                  Tồn đầu kỳ
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                  Đã bàn giao
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                  Khả dụng
                </th>
                <th scope="col" className="w-10 px-1 py-1.5">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sku) => (
                <SkuRow key={sku.productId} model={model} sku={sku} newTracked={newTracked} onOpen={onOpen} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200 font-semibold text-stone-800">
                <th scope="row" className="px-2 py-1.5 text-left text-xs">
                  Cộng
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums">{sum.received.toLocaleString('vi-VN')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{sum.handedOver.toLocaleString('vi-VN')}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-brand-800">{sum.available.toLocaleString('vi-VN')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-1 text-xs text-stone-500">
        Tồn đầu kỳ gồm cả các lần nhập bổ sung · Khả dụng = Tồn đầu kỳ − Đã bàn giao (± trả về, kiểm kê, thanh lý; trừ phần đang giữ cho phiếu chờ
        ký).
      </p>
    </section>
  );
}

function SkuRow({
  model,
  sku,
  newTracked,
  onOpen,
}: {
  model: UniformStockModel;
  sku: UniformSku;
  newTracked: boolean;
  onOpen: (state: DialogState) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = sku.totals ?? EMPTY_UNIFORM_TOTALS;
  const neverStocked = !newTracked && sku.condition === 'NEW' && (sku.stock.available ?? 0) <= 0;
  const label = `${sku.size}${sku.condition === 'USED' ? ' (đã qua sử dụng)' : ''}`;
  // Phần làm khả dụng khác "Tồn đầu kỳ − Đã bàn giao" — ghi rõ để phép cộng luôn khớp.
  const extras = [
    sku.stock.reserved > 0 ? `đang giữ ${sku.stock.reserved}` : '',
    t.returned > 0 ? `trả về +${t.returned}` : '',
    t.adjusted !== 0 ? `kiểm kê ${t.adjusted > 0 ? '+' : '−'}${Math.abs(t.adjusted)}` : '',
    t.disposed > 0 ? `thanh lý −${t.disposed}` : '',
  ].filter(Boolean);
  const actionsId = `dp-sku-actions-${sku.productId}`;
  return (
    <>
      <tr className={cn('border-b border-stone-100', !sku.active && 'opacity-60')}>
        <th scope="row" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-stone-800">
          {sku.size}
          {sku.condition === 'USED' && <span className="ml-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">đã qua SD</span>}
        </th>
        <td className="px-2 py-1.5 text-right tabular-nums">{t.received.toLocaleString('vi-VN')}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{t.handedOver.toLocaleString('vi-VN')}</td>
        <td className="px-2 py-1.5 text-right">
          <span
            className={cn(
              'inline-block min-w-10 rounded-md px-2 py-0.5 text-center font-bold tabular-nums ring-1 ring-inset',
              neverStocked ? 'bg-stone-50 text-stone-500 ring-stone-200' : CELL_STYLES[sku.stock.status],
            )}
            title={neverStocked ? 'Mẫu chưa từng có hàng mới — không tính là hết hàng' : undefined}
          >
            <Qty value={sku.stock.available} />
          </span>
          {extras.length > 0 && <span className="block text-[11px] leading-tight text-stone-500">{extras.join(' · ')}</span>}
        </td>
        <td className="px-1 py-1.5 text-right">
          <button
            type="button"
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-brand-600"
            aria-expanded={open}
            aria-controls={actionsId}
            aria-label={`Thao tác size ${label}`}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </td>
      </tr>
      {open && (
        <tr id={actionsId} className="border-b border-stone-100 bg-stone-50">
          <td colSpan={5} className="px-2 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-[11px] text-stone-500">{sku.skuCode}</span>
              <span className="text-stone-500">· Tồn thực tế: <Qty value={sku.stock.onHand} /></span>
              {model.active && (
                <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: 'in', model, size: sku.size, condition: sku.condition })} icon={<PackagePlus className="size-4" aria-hidden="true" />}>
                  Nhập thêm
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: 'adjust', model, sku })} icon={<ClipboardCheck className="size-4" aria-hidden="true" />}>
                Kiểm kê
              </Button>
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => onOpen({ kind: 'dispose', model, sku })} icon={<Trash2 className="size-4" aria-hidden="true" />}>
                Thanh lý
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
