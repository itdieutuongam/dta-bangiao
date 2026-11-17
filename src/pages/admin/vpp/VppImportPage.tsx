import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, Shirt, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { findSheetName, parseVppWorkbook, type ParsedVppWorkbook } from '../../../../shared/vppImport';
import { formatVnd, type VppImportPlan, type VppImportResult, type VppImportRow } from '../../../../shared/vpp';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { PageHeader } from '../../../components/ui/PageHeader';
import { InlineAlert } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/Toast';
import { useDocumentTitle, useUnsavedChangesWarning } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { errorMessage } from '../../../services/api';
import { vppImportApply, vppImportPreview } from '../../../services/vppApi';
import { cn } from '../../../utils/cn';
import { readXlsx, type XlsxWorkbook } from '../../../utils/xlsx';
import { newRequestId } from '../../../utils/requestId';

const NONE = '';

interface Loaded {
  fileName: string;
  workbook: XlsxWorkbook;
  catalogSheet: string;
  stockSheet: string;
  parsed: ParsedVppWorkbook;
}

function Section({ title, count, tone = 'neutral', children, defaultOpen = false }: { title: string; count: number; tone?: 'neutral' | 'warn' | 'good'; children: ReactNode; defaultOpen?: boolean }) {
  if (!count) return null;
  return (
    <details className="card overflow-hidden" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 font-semibold text-stone-800 hover:bg-stone-50">
        <span>{title}</span>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-sm tabular-nums',
            tone === 'warn' ? 'bg-amber-100 text-amber-900' : tone === 'good' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700',
          )}
        >
          {count}
        </span>
      </summary>
      <div className="max-h-[28rem] overflow-auto border-t border-stone-200">{children}</div>
    </details>
  );
}

function fmt(value: string | number | null): string {
  if (value === null || value === '') return '—';
  return typeof value === 'number' ? value.toLocaleString('vi-VN') : value;
}

/** /admin/vpp/nhap-excel — cập nhật danh mục + tồn kho VPP từ file Excel (sheet "Danh muc" + "Ton kho"): xem trước rồi áp dụng. */
export default function VppImportPage() {
  useDocumentTitle('Cập nhật VPP từ Excel');
  const toast = useToast();
  const { refreshBadges } = useAdmin();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [setStock, setSetStock] = useState(true);
  const [archiveMissing, setArchiveMissing] = useState(false);
  const [includeUniforms, setIncludeUniforms] = useState(false);
  const [matches, setMatches] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<VppImportPlan | null>(null);
  const [planKey, setPlanKey] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<VppImportResult | null>(null);
  const requestId = useRef(newRequestId());
  useUnsavedChangesWarning(Boolean(plan) && !result && !applying);

  const rows: VppImportRow[] = useMemo(() => {
    if (!loaded) return [];
    const base = includeUniforms ? [...loaded.parsed.rows, ...loaded.parsed.uniforms].sort((a, b) => a.line - b.line) : loaded.parsed.rows;
    return base.map((r) => (matches[r.line] ? { ...r, matchProductId: matches[r.line] } : r));
  }, [loaded, includeUniforms, matches]);
  const currentKey = JSON.stringify([loaded?.fileName, loaded?.catalogSheet, loaded?.stockSheet, setStock, archiveMissing, includeUniforms, matches]);
  const stale = Boolean(plan) && planKey !== currentKey;

  async function parse(workbook: XlsxWorkbook, fileName: string, catalogSheet: string, stockSheet: string) {
    const [catalog, stock] = await Promise.all([
      catalogSheet ? workbook.readSheet(catalogSheet) : Promise.resolve(null),
      stockSheet ? workbook.readSheet(stockSheet) : Promise.resolve(null),
    ]);
    const parsed = parseVppWorkbook(catalog, stock);
    setLoaded({ fileName, workbook, catalogSheet, stockSheet, parsed });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setReadError(null);
    setLoaded(null);
    setPlan(null);
    setResult(null);
    setMatches({});
    requestId.current = newRequestId();
    try {
      const workbook = await readXlsx(await file.arrayBuffer());
      const catalogSheet = findSheetName(workbook.sheetNames, 'Danh muc', 'Danh mục', 'Danh muc VPP') ?? NONE;
      const stockSheet = findSheetName(workbook.sheetNames, 'Ton kho', 'Tồn kho') ?? NONE;
      if (!catalogSheet && !stockSheet) {
        setLoaded({ fileName: file.name, workbook, catalogSheet, stockSheet, parsed: { rows: [], uniforms: [], skipped: [], warnings: [], stats: { catalogRows: 0, stockRows: 0, withStock: 0, errorRows: 0 } } });
        setReadError('Không thấy sheet "Danh muc" / "Ton kho" — chọn sheet danh mục và sheet tồn kho bên dưới.');
        return;
      }
      await parse(workbook, file.name, catalogSheet, stockSheet);
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Không đọc được file.');
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function chooseSheets(catalogSheet: string, stockSheet: string) {
    if (!loaded) return;
    setReadError(null);
    setPlan(null);
    try {
      await parse(loaded.workbook, loaded.fileName, catalogSheet, stockSheet);
    } catch (err) {
      setLoaded({ ...loaded, catalogSheet, stockSheet });
      setReadError(err instanceof Error ? err.message : 'Không đọc được sheet.');
    }
  }

  async function preview() {
    if (!loaded || !rows.length) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const next = await vppImportPreview({ rows, options: { setStock, archiveMissing }, fileName: loaded.fileName });
      setPlan(next);
      setPlanKey(currentKey);
      requestId.current = newRequestId();
    } catch (err) {
      setPreviewError(errorMessage(err, 'Không xem trước được.'));
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!loaded || !plan || stale) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await vppImportApply({ rows, options: { setStock, archiveMissing }, fileName: loaded.fileName, clientRequestId: requestId.current });
      setResult(res);
      setConfirming(false);
      toast.show(res.duplicate ? 'Lần cập nhật này ĐÃ được áp dụng ở lần gửi trước — không làm lại.' : 'Đã cập nhật danh mục và tồn kho từ file Excel.');
      refreshBadges();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setApplyError(errorMessage(err, 'Không áp dụng được.'));
    } finally {
      setApplying(false);
    }
  }

  const p = loaded?.parsed;
  const sheetNames = loaded?.workbook.sheetNames ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <PageHeader
        title="Cập nhật danh mục & tồn kho VPP từ Excel"
        description="Chọn file theo dõi VPP (.xlsx) có sheet “Danh muc” (mã, tên, ĐVT, đơn giá) và “Ton kho” (tồn hiện tại). File chỉ được đọc trên máy anh/chị; hệ thống hiện trước mọi thay đổi để kiểm tra rồi mới áp dụng."
        actions={<ButtonLink to="/admin/vpp/ton-kho">Tồn kho</ButtonLink>}
      />

      {result?.result && (
        <InlineAlert tone="success">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Đã cập nhật từ “{result.result.fileName}”
          </p>
          <p className="mt-1">
            Thêm {result.result.create} · cập nhật {result.result.update} · đổi tồn {result.result.stockChanges} · ngừng dùng {result.result.archive} sản phẩm.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink to="/admin/vpp/ton-kho" size="sm">
              Xem tồn kho
            </ButtonLink>
            <ButtonLink to="/admin/vpp/lich-su?type=ADJUSTMENT" size="sm" variant="ghost">
              Lịch sử kiểm kê
            </ButtonLink>
          </div>
        </InlineAlert>
      )}

      <section className="card space-y-3 p-4" aria-labelledby="import-file">
        <h2 id="import-file" className="section-title flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-emerald-700" aria-hidden="true" /> 1. Chọn file Excel
        </h2>
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" id="import-input" onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={reading} onClick={() => fileInput.current?.click()} icon={<Upload className="size-4" aria-hidden="true" />}>
            {loaded ? 'Chọn file khác' : 'Chọn file .xlsx'}
          </Button>
          {loaded && <span className="text-sm text-stone-700">{loaded.fileName}</span>}
        </div>
        {readError && <InlineAlert tone="warning">{readError}</InlineAlert>}
        {loaded && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">Sheet danh mục</span>
              <select className="field-input" value={loaded.catalogSheet} onChange={(e) => chooseSheets(e.target.value, loaded.stockSheet)}>
                <option value="">(không dùng)</option>
                {sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-stone-700">Sheet tồn kho</span>
              <select className="field-input" value={loaded.stockSheet} onChange={(e) => chooseSheets(loaded.catalogSheet, e.target.value)}>
                <option value="">(không dùng)</option>
                {sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {p && (p.rows.length > 0 || p.uniforms.length > 0) && (
          <div className="space-y-2 text-sm">
            <p>
              Đọc được <strong>{p.rows.length}</strong> mặt hàng văn phòng phẩm ({p.rows.filter((r) => (r.stock ?? 0) > 0).length} mặt hàng có tồn &gt; 0)
              {p.stats.errorRows ? `, bỏ qua ${p.stats.errorRows} dòng lỗi công thức (#REF!…)` : ''}.
            </p>
            {p.uniforms.length > 0 && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950">
                <p className="flex items-center gap-2 font-semibold">
                  <Shirt className="size-4" aria-hidden="true" /> {p.uniforms.length} dòng là đồng phục (áo) — nên nhập ở module Đồng phục theo mẫu × size
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {p.uniforms.map((u) => (
                    <li key={u.line}>
                      {u.name}: tồn {u.stock ?? '—'}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link to="/admin/dong-phuc/ton-kho" className="font-semibold underline">
                    Mở Đồng phục → Tồn kho & mẫu
                  </Link>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand-700" checked={includeUniforms} onChange={(e) => setIncludeUniforms(e.target.checked)} />
                    Vẫn nhập các dòng áo vào văn phòng phẩm
                  </label>
                </div>
              </div>
            )}
            {(p.warnings.length > 0 || p.skipped.length > 0) && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <summary className="cursor-pointer font-semibold">
                  {p.warnings.length} lưu ý · {p.skipped.length} dòng bỏ qua trong file
                </summary>
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {[...p.skipped.map((s) => ({ ...s, kind: 'Bỏ qua' })), ...p.warnings.map((w) => ({ ...w, kind: 'Lưu ý' }))].map((x, i) => (
                    <li key={i}>
                      {x.kind} — {x.sheet} dòng {x.line}
                      {x.name ? ` (${x.name})` : ''}: {x.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {p && rows.length > 0 && (
        <section className="card space-y-3 p-4" aria-labelledby="import-options">
          <h2 id="import-options" className="section-title">
            2. Tùy chọn & xem trước
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={setStock} onChange={(e) => setSetStock(e.target.checked)} />
            <span>
              <strong>Đặt tồn kho theo cột “Tồn hiện tại”</strong> — ghi như một lần kiểm kê (có lịch sử). Mặt hàng không có dòng tồn trong file giữ nguyên.
              Không bao giờ đặt thấp hơn số đang giữ chỗ cho phiếu chờ ký.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={archiveMissing} onChange={(e) => setArchiveMissing(e.target.checked)} />
            <span>
              <strong>Ngừng dùng sản phẩm không có trong file</strong> — chỉ những sản phẩm không còn tồn, không đang giữ chỗ, không có định mức (các
              sản phẩm khác được giữ lại và liệt kê để xử lý tay).
            </span>
          </label>
          {previewError && <InlineAlert>{previewError}</InlineAlert>}
          <Button variant={plan && !stale ? 'secondary' : 'primary'} loading={previewing} onClick={preview} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
            {plan ? 'Xem trước lại' : 'Xem trước thay đổi'}
          </Button>
          {stale && <p className="text-sm font-medium text-amber-800">Đã đổi tùy chọn / ghép — bấm “Xem trước lại” trước khi áp dụng.</p>}
        </section>
      )}

      {plan && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Tóm tắt thay đổi">
            {[
              ['Thêm mới', plan.summary.create, 'text-emerald-700'],
              ['Cập nhật', plan.summary.update, 'text-brand-800'],
              ['Đổi tồn kho', plan.summary.stockChanges, 'text-sky-800'],
              ['Ngừng dùng', plan.summary.archive, 'text-stone-700'],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="card p-3">
                <p className="text-xs text-stone-500">{label}</p>
                <p className={cn('text-2xl font-bold tabular-nums', tone as string)}>{value}</p>
              </div>
            ))}
          </section>

          <Section title="Có thể là sản phẩm đã có (chọn để cập nhật thay vì thêm mới)" count={plan.suggestions.length} tone="warn" defaultOpen>
            <ul className="divide-y divide-stone-100 text-sm">
              {plan.suggestions.map((s) => (
                <li key={s.line} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="min-w-0">
                    Dòng {s.line}: <strong>{s.name}</strong>
                  </span>
                  <select
                    className="field-input w-full sm:w-96"
                    aria-label={`Ghép dòng ${s.line} với`}
                    value={matches[s.line] ?? ''}
                    onChange={(e) =>
                      setMatches((prev) => {
                        const next = { ...prev };
                        if (e.target.value) next[s.line] = e.target.value;
                        else delete next[s.line];
                        return next;
                      })
                    }
                  >
                    <option value="">Thêm mới</option>
                    {s.candidates.map((c) => (
                      <option key={c.productId} value={c.productId}>
                        Cập nhật “{c.productName}” ({c.productCode}{c.unit ? ` · ${c.unit}` : ''}
                        {c.onHand ? ` · tồn ${c.onHand}` : ''}
                        {c.normCount ? ` · ${c.normCount} định mức` : ''}) — giống {c.score}%
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Thêm mới" count={plan.creates.length} tone="good">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-4 py-2">Dòng</th>
                  <th className="px-2 py-2">Mã</th>
                  <th className="px-2 py-2">Tên</th>
                  <th className="px-2 py-2">ĐVT</th>
                  <th className="px-2 py-2 text-right">Đơn giá</th>
                  <th className="px-4 py-2 text-right">Tồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {plan.creates.map((c) => (
                  <tr key={c.line}>
                    <td className="px-4 py-1.5 text-stone-500 tabular-nums">{c.line}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{c.codeAuto ? <span className="text-stone-500">(tự cấp)</span> : c.code}</td>
                    <td className="px-2 py-1.5">{c.name}</td>
                    <td className="px-2 py-1.5">{c.unit || <span className="text-amber-700">thiếu</span>}</td>
                    <td className="px-2 py-1.5 text-right">{formatVnd(c.price)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{c.stock ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Cập nhật sản phẩm có sẵn" count={plan.updates.length}>
            <ul className="divide-y divide-stone-100 text-sm">
              {plan.updates.map((u) => (
                <li key={u.productId} className="px-4 py-2">
                  <p>
                    <strong>{u.productName}</strong> <span className="font-mono text-xs text-stone-500">{u.productCode}</span>{' '}
                    <span className="text-xs text-stone-500">
                      (dòng {u.line}, khớp theo {u.matchedBy === 'CODE' ? 'mã' : u.matchedBy === 'NAME' ? 'tên' : 'lựa chọn của bạn'})
                    </span>
                  </p>
                  <ul className="mt-0.5 text-xs text-stone-700">
                    {u.changes.map((c) => (
                      <li key={c.field}>
                        {c.label}: <span className="text-stone-500 line-through">{fmt(c.before)}</span> → <strong>{fmt(c.after)}</strong>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Đổi tồn kho" count={plan.stockChanges.length}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-4 py-2">Mặt hàng</th>
                  <th className="px-2 py-2 text-right">Hiện tại</th>
                  <th className="px-4 py-2 text-right">Theo file</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {plan.stockChanges.map((s) => (
                  <tr key={`${s.line}-${s.productId}`}>
                    <td className="px-4 py-1.5">
                      {s.productName} <span className="text-xs text-stone-500">{s.unit}</span>
                      {s.isNew && <span className="ml-1 rounded bg-emerald-50 px-1.5 text-xs text-emerald-800">mới</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.isNew ? '—' : (s.before ?? 'chưa rõ')}</td>
                    <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{s.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Cảnh báo khi áp dụng" count={plan.warnings.length + plan.skipped.length} tone="warn">
            <ul className="list-disc space-y-0.5 py-2 pr-4 pl-9 text-sm">
              {plan.skipped.map((s) => (
                <li key={`s${s.line}`}>
                  Bỏ qua dòng {s.line} ({s.name}): {s.reason}
                </li>
              ))}
              {plan.warnings.map((w, i) => (
                <li key={`w${i}`}>
                  Dòng {w.line}: {w.message}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={archiveMissing ? 'Sẽ ngừng dùng (không có trong file)' : 'Sản phẩm trong hệ thống không có trong file'} count={archiveMissing ? plan.archives.length : plan.kept.length}>
            <ul className="divide-y divide-stone-100 text-sm">
              {(archiveMissing ? plan.archives.map((a) => ({ ...a, reason: '' })) : plan.kept).map((k) => (
                <li key={k.productId} className="px-4 py-1.5">
                  {k.productName} <span className="font-mono text-xs text-stone-500">{k.productCode}</span>
                  {k.reason && <span className="block text-xs text-stone-500">{k.reason}</span>}
                </li>
              ))}
            </ul>
          </Section>
          {archiveMissing && plan.kept.length > 0 && (
            <p className="text-sm text-stone-600">
              {plan.kept.length} sản phẩm không có trong file được GIỮ lại vì còn tồn / đang giữ chỗ / có định mức — xử lý ở “Dữ liệu cần kiểm tra”.
            </p>
          )}

          <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="flex items-center gap-2 text-sm text-stone-700">
              <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
              Áp dụng ghi vào Google Sheet (có lịch sử, không xóa dữ liệu). Nên chạy ngoài giờ cấp phát.
            </p>
            <Button variant="primary" size="lg" disabled={stale || previewing} onClick={() => setConfirming(true)} icon={<CheckCircle2 className="size-5" aria-hidden="true" />}>
              Áp dụng thay đổi
            </Button>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="Áp dụng cập nhật từ Excel?"
        description={
          plan
            ? `Thêm ${plan.summary.create}, cập nhật ${plan.summary.update}, đổi tồn ${plan.summary.stockChanges}${archiveMissing ? `, ngừng dùng ${plan.summary.archive}` : ''} sản phẩm.`
            : ''
        }
        confirmLabel="Áp dụng"
        cancelLabel="Xem lại"
        loading={applying}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      >
        {applyError && <InlineAlert>{applyError}</InlineAlert>}
      </ConfirmDialog>
    </div>
  );
}
