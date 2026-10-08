import { Boxes, BriefcaseBusiness, FolderOpen, KeyRound, Laptop, Shapes, type LucideIcon } from 'lucide-react';
import { HANDOVER_TYPE_HINTS, HANDOVER_TYPE_LABELS, HANDOVER_TYPES, type HandoverType } from '../../../shared/constants';

const ICONS: Record<HandoverType, LucideIcon> = {
  ASSET: Laptop,
  OFFICE_SUPPLY: Boxes,
  ACCOUNT: KeyRound,
  DOCUMENT: FolderOpen,
  WORK: BriefcaseBusiness,
  OTHER: Shapes,
};

/** Bước 1 khi tạo phiếu: chọn loại — mỗi loại có form riêng. */
export function HandoverTypePicker({ onSelect }: { onSelect: (type: HandoverType) => void }) {
  return (
    <section aria-labelledby="type-title" className="space-y-3">
      <h2 id="type-title" className="section-title">
        Bước 1 — Chọn loại phiếu bàn giao
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HANDOVER_TYPES.map((type) => {
          const Icon = ICONS[type];
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => onSelect(type)}
                className="card flex h-full w-full items-start gap-3 p-4 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-brand-900">{HANDOVER_TYPE_LABELS[type]}</span>
                  <span className="mt-0.5 block text-sm text-stone-600">{HANDOVER_TYPE_HINTS[type]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
