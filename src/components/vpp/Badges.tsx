import {
  CATALOG_STATUS_LABELS,
  MOVEMENT_TYPE_LABELS,
  PROPOSAL_STATUS_LABELS,
  STOCK_STATUS_LABELS,
  type CatalogStatus,
  type MovementType,
  type ProposalStatus,
  type StockStatus,
} from '../../../shared/vpp';
import { cn } from '../../utils/cn';

const BASE = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset';

const STOCK_STYLES: Record<StockStatus, string> = {
  IN_STOCK: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  LOW_STOCK: 'bg-orange-50 text-orange-800 ring-orange-200',
  OUT_OF_STOCK: 'bg-red-50 text-red-800 ring-red-200',
  UNKNOWN: 'bg-amber-50 text-amber-900 ring-amber-200',
};

const STOCK_DOTS: Record<StockStatus, string> = {
  IN_STOCK: '🟢',
  LOW_STOCK: '🟠',
  OUT_OF_STOCK: '🔴',
  UNKNOWN: '🟡',
};

export function StockStatusBadge({ status, className }: { status: StockStatus; className?: string }) {
  return (
    <span className={cn(BASE, STOCK_STYLES[status], className)}>
      <span aria-hidden="true">{STOCK_DOTS[status]}</span>
      {STOCK_STATUS_LABELS[status]}
    </span>
  );
}

const PROPOSAL_STYLES: Record<ProposalStatus, string> = {
  SUBMITTED: 'bg-amber-50 text-amber-800 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  PARTIALLY_APPROVED: 'bg-lime-50 text-lime-800 ring-lime-200',
  REJECTED: 'bg-stone-100 text-stone-600 ring-stone-300',
  PURCHASED: 'bg-sky-50 text-sky-800 ring-sky-200',
  RECEIVED: 'bg-brand-50 text-brand-800 ring-brand-200',
  CLOSED: 'bg-stone-100 text-stone-700 ring-stone-300',
};

export function ProposalStatusBadge({ status, className }: { status: ProposalStatus; className?: string }) {
  return <span className={cn(BASE, PROPOSAL_STYLES[status] ?? PROPOSAL_STYLES.SUBMITTED, className)}>{PROPOSAL_STATUS_LABELS[status] ?? status}</span>;
}

const MOVEMENT_STYLES: Record<MovementType, string> = {
  INITIAL: 'bg-stone-100 text-stone-700 ring-stone-300',
  IN: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  RESERVE: 'bg-amber-50 text-amber-800 ring-amber-200',
  RELEASE: 'bg-sky-50 text-sky-800 ring-sky-200',
  OUT: 'bg-red-50 text-red-800 ring-red-200',
  ADJUSTMENT: 'bg-violet-50 text-violet-800 ring-violet-200',
};

export function MovementTypeBadge({ type }: { type: MovementType }) {
  return <span className={cn(BASE, MOVEMENT_STYLES[type] ?? MOVEMENT_STYLES.INITIAL)}>{MOVEMENT_TYPE_LABELS[type] ?? type}</span>;
}

const CATALOG_STYLES: Record<CatalogStatus, string> = {
  MASTER: 'bg-brand-50 text-brand-800 ring-brand-200',
  TEMP: 'bg-stone-100 text-stone-700 ring-stone-300',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 ring-amber-200',
  ARCHIVED: 'bg-stone-100 text-stone-500 ring-stone-200',
};

export function CatalogBadge({ status }: { status: CatalogStatus }) {
  return <span className={cn(BASE, CATALOG_STYLES[status])}>{CATALOG_STATUS_LABELS[status]}</span>;
}

/** Số tồn: null (chưa rõ) → "Chưa rõ". */
export function Qty({ value, unit }: { value: number | null | undefined; unit?: string }) {
  if (value === null || value === undefined) return <span className="text-amber-700">Chưa rõ</span>;
  return (
    <span className="tabular-nums">
      {value.toLocaleString('vi-VN')}
      {unit ? <span className="ml-1 text-xs text-stone-500">{unit}</span> : null}
    </span>
  );
}
