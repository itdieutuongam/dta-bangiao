import {
  EMPLOYEE_GENDER_LABELS,
  ISSUE_KIND_LABELS,
  UNIFORM_CONDITION_LABELS,
  UNIFORM_GENDER_LABELS,
  UNIFORM_KIND_LABELS,
  UNIFORM_MOVEMENT_LABELS,
  type EmployeeGender,
  type IssueKind,
  type UniformCondition,
  type UniformGender,
  type UniformKind,
  type UniformMovementType,
  type UniformQuotaUsage,
} from '../../../shared/uniform';
import { cn } from '../../utils/cn';
import { formatDate } from '../../utils/format';

const BASE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset';

export function ConditionBadge({ condition }: { condition: UniformCondition | '' }) {
  if (!condition) return null;
  return (
    <span className={cn(BASE, condition === 'NEW' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-stone-100 text-stone-700 ring-stone-300')}>
      {UNIFORM_CONDITION_LABELS[condition]}
    </span>
  );
}

/** Cấp phát / Cho mượn (kèm hạn trả; quá hạn tô đỏ). */
export function IssueKindBadge({ kind, dueDate, overdue }: { kind: IssueKind | ''; dueDate?: string; overdue?: boolean }) {
  if (!kind) return null;
  if (kind === 'CAP_PHAT') return <span className={cn(BASE, 'bg-brand-50 text-brand-800 ring-brand-200')}>{ISSUE_KIND_LABELS.CAP_PHAT}</span>;
  return (
    <span className={cn(BASE, overdue ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-sky-50 text-sky-800 ring-sky-200')}>
      {ISSUE_KIND_LABELS.CHO_MUON}
      {dueDate ? ` · hạn ${formatDate(dueDate)}` : ''}
      {overdue ? ' · QUÁ HẠN' : ''}
    </span>
  );
}

export function KindBadge({ kind }: { kind: UniformKind }) {
  if (kind === 'UNIFORM') return null;
  return <span className={cn(BASE, 'bg-amber-50 text-amber-900 ring-amber-200')}>{UNIFORM_KIND_LABELS[kind]}</span>;
}

export function genderLabel(gender: UniformGender | EmployeeGender | ''): string {
  if (!gender) return 'Chưa rõ';
  return gender === 'UNISEX' ? UNIFORM_GENDER_LABELS.UNISEX : (EMPLOYEE_GENDER_LABELS[gender] ?? gender);
}

const MOVEMENT_STYLES: Record<UniformMovementType, string> = {
  INITIAL: 'bg-stone-100 text-stone-700 ring-stone-300',
  IN: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  RESERVE: 'bg-amber-50 text-amber-800 ring-amber-200',
  RELEASE: 'bg-sky-50 text-sky-800 ring-sky-200',
  OUT: 'bg-red-50 text-red-800 ring-red-200',
  ADJUSTMENT: 'bg-violet-50 text-violet-800 ring-violet-200',
  RETURN: 'bg-teal-50 text-teal-800 ring-teal-200',
  DISPOSE: 'bg-stone-200 text-stone-800 ring-stone-300',
};

export function UniformMovementBadge({ type }: { type: UniformMovementType }) {
  return <span className={cn(BASE, MOVEMENT_STYLES[type] ?? MOVEMENT_STYLES.INITIAL)}>{UNIFORM_MOVEMENT_LABELS[type] ?? type}</span>;
}

/** "Tiêu chuẩn 3/năm · đã cấp 2 · chờ ký 1 · còn 0" — remaining âm tô đỏ. */
export function QuotaSummary({ usage, className }: { usage: UniformQuotaUsage | null; className?: string }) {
  if (!usage) return null;
  if (usage.yearlyQuota === null) {
    return <p className={cn('text-xs text-stone-600', className)}>Không áp dụng tiêu chuẩn cấp phát năm.</p>;
  }
  const remaining = usage.remaining ?? 0;
  return (
    <p className={cn('text-xs text-stone-700', className)}>
      Tiêu chuẩn <strong>{usage.yearlyQuota}</strong>/năm{usage.source === 'DEFAULT' ? ' (mặc định)' : ''} · đã cấp {usage.issued + usage.legacy}
      {usage.legacy ? ` (gồm ${usage.legacy} ghi tay ở phiếu cũ)` : ''}
      {usage.pending ? ` · chờ ký ${usage.pending}` : ''} · còn{' '}
      <strong className={remaining < 0 ? 'text-red-700' : remaining === 0 ? 'text-orange-700' : 'text-emerald-700'}>{remaining}</strong>
    </p>
  );
}
