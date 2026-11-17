import { ArrowLeft, FilePlus2, Undo2, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { HandoverStatus } from '../../../../shared/constants';
import { RETURN_REASON_LABELS, RETURN_RESULT_LABELS, type UniformHolding } from '../../../../shared/uniform';
import { ConditionBadge, genderLabel, IssueKindBadge, QuotaSummary } from '../../../components/uniform/UniformBadges';
import { ProfileDialog, ReturnDialog } from '../../../components/uniform/UniformDialogs';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { ErrorState, InlineAlert, LoadingCard } from '../../../components/ui/States';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useToast } from '../../../components/ui/Toast';
import { useAsync } from '../../../hooks/useAsync';
import { useDocumentTitle } from '../../../hooks/usePageMeta';
import { useAdmin } from '../../../layouts/adminContext';
import { uniformEmployeeDetail } from '../../../services/uniformApi';
import { cn } from '../../../utils/cn';
import { formatDate, formatDateTime } from '../../../utils/format';

function currentYear(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }));
}

/** /admin/dong-phuc/nhan-vien/:employeeId — hồ sơ đồng phục một nhân viên: tiêu chuẩn năm, đang giữ, đã trả, lịch sử cấp. */
export default function UniformEmployeeDetailPage() {
  const { employeeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || currentYear();
  const toast = useToast();
  const { refreshBadges } = useAdmin();
  const detail = useAsync((signal) => uniformEmployeeDetail(employeeId, year, signal), [employeeId, year]);
  const [editing, setEditing] = useState(false);
  const [returning, setReturning] = useState<UniformHolding | null>(null);
  const d = detail.data;
  const e = d?.employee;
  useDocumentTitle(e ? `Đồng phục — ${e.fullName}` : 'Đồng phục nhân viên');

  const outstanding = (d?.holdings ?? []).filter((h) => h.outstanding > 0);
  const settled = (d?.holdings ?? []).filter((h) => h.outstanding <= 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <Link to={`/admin/dong-phuc/nhan-vien?year=${year}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Cấp phát theo nhân viên
      </Link>

      {detail.status === 'loading' && !d && <LoadingCard lines={6} />}
      {detail.status === 'error' && !d && <ErrorState title="Không tải được hồ sơ đồng phục." error={detail.error} onRetry={detail.reload} />}

      {d && e && (
        <>
          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">{e.fullName}</h1>
                <p className="mt-0.5 text-sm text-stone-600">
                  {e.employeeId} · {e.department || 'Chưa có phòng ban'}
                  {e.position ? ` · ${e.position}` : ''}
                  {e.status !== 'ACTIVE' && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">Đã nghỉ / ngừng</span>}
                </p>
                <p className="mt-2 text-sm">
                  Giới tính: <strong className={e.gender ? '' : 'text-amber-700'}>{genderLabel(e.gender)}</strong> · Size:{' '}
                  <strong className={e.uniformSize ? '' : 'text-amber-700'}>{e.uniformSize || 'chưa có'}</strong> · Nhóm tiêu chuẩn:{' '}
                  <strong>{e.scope?.scopeName ?? (e.usage.source === 'NONE' ? 'Không áp dụng' : 'Mặc định')}</strong>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select className="field-input w-auto" aria-label="Năm" value={year} onChange={(ev) => setParams({ year: ev.target.value }, { replace: true })}>
                  {[currentYear() + 1, currentYear(), currentYear() - 1, currentYear() - 2].map((y) => (
                    <option key={y} value={y}>
                      Năm {y}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => setEditing(true)} icon={<UserRoundPen className="size-4" aria-hidden="true" />}>
                  Sửa size
                </Button>
                {e.status === 'ACTIVE' && (
                  <ButtonLink
                    variant="primary"
                    to={`/admin/ban-giao/tao-moi?loai=UNIFORM&nhan=${encodeURIComponent(e.employeeId)}`}
                    icon={<FilePlus2 className="size-4" aria-hidden="true" />}
                  >
                    Cấp đồng phục
                  </ButtonLink>
                )}
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-stone-800">Tiêu chuẩn năm {d.year}</p>
              <QuotaSummary usage={e.usage} className="mt-0.5 text-sm" />
              {e.modelQuotas.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs text-stone-700 sm:grid-cols-2">
                  {e.modelQuotas.map((q) => (
                    <li key={q.modelId}>
                      {q.modelName}: tiêu chuẩn {q.yearlyQuota} · đã cấp {q.issued}
                      {q.pending ? ` · chờ ký ${q.pending}` : ''} · còn{' '}
                      <strong className={q.remaining < 0 ? 'text-red-700' : ''}>{q.remaining}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {e.status !== 'ACTIVE' && outstanding.length > 0 && (
              <InlineAlert tone="warning" className="mt-3">
                Nhân viên đã nghỉ nhưng còn giữ {outstanding.reduce((s, h) => s + h.outstanding, 0)} áo — ghi nhận thu hồi ở bảng dưới (lý do “Thu hồi khi nghỉ
                việc”).
              </InlineAlert>
            )}
          </section>

          <section className="card p-4" aria-labelledby="dp-holding">
            <h2 id="dp-holding" className="section-title">
              Đang giữ ({outstanding.reduce((s, h) => s + h.outstanding, 0)})
            </h2>
            {outstanding.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Không còn đồng phục nào chưa trả / thu hồi.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-100">
                {outstanding.map((h) => (
                  <li key={h.itemId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900">
                        {h.modelName} · Size {h.size} × {h.outstanding}
                        {h.returned > 0 && <span className="font-normal text-stone-500"> (đã trả {h.returned}/{h.quantity})</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        <ConditionBadge condition={h.condition} />
                        <IssueKindBadge kind={h.issueKind} dueDate={h.dueDate} overdue={h.overdue} />
                        <Link to={`/admin/ban-giao/${h.handoverId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                          {h.handoverCode}
                        </Link>
                        · ký nhận {formatDate(h.confirmedAt)}
                      </p>
                    </div>
                    <Button size="sm" variant={h.overdue ? 'primary' : 'secondary'} onClick={() => setReturning(h)} icon={<Undo2 className="size-4" aria-hidden="true" />}>
                      Ghi nhận trả
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {settled.length > 0 && (
              <p className="mt-2 text-xs text-stone-500">{settled.length} dòng khác đã trả / thu hồi đủ.</p>
            )}
          </section>

          <section className="card p-4" aria-labelledby="dp-issues">
            <h2 id="dp-issues" className="section-title">
              Phiếu đồng phục
            </h2>
            {d.issues.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Chưa có phiếu đồng phục nào.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-100">
                {d.issues.map((i) => (
                  <li key={i.handoverId} className="py-2.5 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/ban-giao/${i.handoverId}`} className="font-mono font-semibold text-brand-800 hover:underline">
                        {i.handoverCode}
                      </Link>
                      <StatusBadge status={i.status as HandoverStatus} />
                      <span className="text-xs text-stone-500">
                        tạo {formatDateTime(i.createdAt)}
                        {i.confirmedAt ? ` · ký ${formatDateTime(i.confirmedAt)}` : ''}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-0.5 pl-1 text-xs text-stone-700">
                      {i.lines.map((l, idx) => (
                        <li key={idx} className="flex flex-wrap items-center gap-1.5">
                          {l.modelName} · {l.size} × {l.quantity}
                          <ConditionBadge condition={l.condition} />
                          <IssueKindBadge kind={l.issueKind} dueDate={l.dueDate} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {d.returns.length > 0 && (
            <section className="card p-4" aria-labelledby="dp-returns">
              <h2 id="dp-returns" className="section-title">
                Đã trả / thu hồi
              </h2>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {d.returns.map((r) => (
                  <li key={r.returnId} className="py-2">
                    <p>
                      {r.modelName} · {r.size} × <strong>{r.quantity}</strong> —{' '}
                      <span className={cn('font-semibold', r.result === 'RESTOCK' ? 'text-emerald-700' : 'text-red-700')}>{RETURN_RESULT_LABELS[r.result]}</span>
                    </p>
                    <p className="text-xs text-stone-500">
                      {formatDateTime(r.createdAt)} · {RETURN_REASON_LABELS[r.reason]}
                      {r.note ? ` · ${r.note}` : ''} · {r.actorName || '—'} ·{' '}
                      <Link to={`/admin/ban-giao/${r.handoverId}`} className="font-mono text-brand-700 hover:underline">
                        {r.handoverCode}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.legacyItems.length > 0 && (
            <section className="card p-4" aria-labelledby="dp-legacy">
              <h2 id="dp-legacy" className="section-title">
                Đồng phục ghi ở phiếu cũ (trước khi có module)
              </h2>
              <p className="mt-1 text-xs text-stone-500">
                Dòng có chữ “đồng phục” trong phiếu loại khác đã ký năm {d.year} — vẫn được cộng vào “đã cấp”. Chỉ xem, không thu hồi được qua hệ thống.
              </p>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {d.legacyItems.map((l, idx) => (
                  <li key={`${l.handoverId}-${idx}`} className="py-2">
                    <Link to={`/admin/ban-giao/${l.handoverId}`} className="font-mono font-semibold text-brand-800 hover:underline">
                      {l.handoverCode}
                    </Link>{' '}
                    · {l.itemName || l.description}
                    {l.quantity !== null ? ` × ${l.quantity}` : ''}
                    <span className="block text-xs text-stone-500">ký {formatDate(l.confirmedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ProfileDialog
            open={editing}
            employee={e}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              toast.show('Đã lưu size / giới tính.');
              detail.reload();
            }}
          />
          <ReturnDialog
            open={returning !== null}
            holding={returning}
            onClose={() => setReturning(null)}
            onDone={(result) => {
              setReturning(null);
              toast.show(result.duplicate ? 'Lần ghi nhận này ĐÃ được lưu ở lần gửi trước — không ghi thêm.' : 'Đã ghi nhận trả / thu hồi đồng phục.');
              refreshBadges();
              detail.reload();
            }}
            onStale={detail.reload}
          />
        </>
      )}
    </div>
  );
}
