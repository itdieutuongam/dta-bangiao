import { ArrowDown, ArrowUp, Trash2, TriangleAlert } from 'lucide-react';
import { ITEM_FIELD_META, type ItemFieldKey } from '../../../shared/constants';
import type { Category } from '../../../shared/types';
import { cn } from '../../utils/cn';
import { describedBy } from '../ui/Field';
import type { FormItem } from './formModel';
import { ItemFieldInput } from './ItemFieldInput';

interface ItemEditorProps {
  index: number;
  total: number;
  item: FormItem;
  categories: Category[];
  errors?: Partial<Record<ItemFieldKey | 'category', string>>;
  onCategoryChange: (code: string) => void;
  onFieldChange: (key: ItemFieldKey, value: string) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

const WIDE_FIELDS = new Set<ItemFieldKey>(['itemName', 'description', 'note', 'workStatus', 'documentUrl']);

export function ItemEditor({
  index,
  total,
  item,
  categories,
  errors = {},
  onCategoryChange,
  onFieldChange,
  onRemove,
  onMove,
}: ItemEditorProps) {
  const category = categories.find((c) => c.code === item.category);
  const number = index + 1;
  const categoryId = `item-${item.uid}-category`;
  const hasError = Object.keys(errors).length > 0;

  return (
    <section
      aria-label={`Nội dung số ${number}`}
      className={cn('rounded-xl border bg-white shadow-xs', hasError ? 'border-red-300' : 'border-stone-200')}
    >
      <header className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
            aria-hidden="true"
          >
            {number}
          </span>
          <span className="text-sm font-semibold text-stone-700">{category?.name ?? 'Nội dung'}</span>
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            id={`item-${item.uid}-up`}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Di chuyển nội dung ${number} lên trên`}
            title="Di chuyển lên"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            id={`item-${item.uid}-down`}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Di chuyển nội dung ${number} xuống dưới`}
            title="Di chuyển xuống"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
            onClick={onRemove}
            disabled={total <= 1}
            aria-label={`Xóa nội dung ${number}`}
            title="Xóa nội dung"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={categoryId} className="text-sm font-medium text-stone-800">
            Loại bàn giao
          </label>
          <select
            id={categoryId}
            className="field-input sm:max-w-sm"
            value={item.category}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describedBy(categoryId, errors.category)}
            onChange={(e) => onCategoryChange(e.target.value)}
          >
            {!category && <option value={item.category}>{item.category || 'Chọn loại'}</option>}
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
                {c.active ? '' : ' (ngừng dùng)'}
              </option>
            ))}
          </select>
          {errors.category && (
            <p id={`${categoryId}-error`} className="text-xs font-medium text-red-700">
              {errors.category}
            </p>
          )}
        </div>
        {category?.hint && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{category.hint}</span>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {(category?.fields ?? []).map((field) => (
            <ItemFieldInput
              key={field.key}
              id={`item-${item.uid}-${field.key}`}
              fieldKey={field.key}
              label={field.label}
              required={field.required}
              value={item.values[field.key]}
              error={errors[field.key]}
              onChange={(value) => onFieldChange(field.key, value)}
              className={WIDE_FIELDS.has(field.key) || ITEM_FIELD_META[field.key].kind === 'textarea' ? 'sm:col-span-2' : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
