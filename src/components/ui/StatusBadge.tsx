import { Ban, CircleCheck, Clock, MessageSquareWarning } from 'lucide-react';
import { STATUS_LABELS, type HandoverStatus } from '../../../shared/constants';
import { cn } from '../../utils/cn';

const STYLES: Record<HandoverStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REVISION_REQUESTED: 'bg-orange-50 text-orange-800 ring-orange-200',
  CANCELLED: 'bg-stone-100 text-stone-600 ring-stone-300',
};

const ICONS = {
  PENDING: Clock,
  CONFIRMED: CircleCheck,
  REVISION_REQUESTED: MessageSquareWarning,
  CANCELLED: Ban,
} satisfies Record<HandoverStatus, unknown>;

export function StatusBadge({ status, className }: { status: HandoverStatus; className?: string }) {
  const Icon = ICONS[status] ?? Clock;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        STYLES[status] ?? STYLES.PENDING,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
