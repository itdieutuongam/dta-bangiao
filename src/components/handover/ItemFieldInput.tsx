import { ITEM_FIELD_META, LIMITS, type ItemFieldKey } from '../../../shared/constants';
import { cn } from '../../utils/cn';
import { describedBy, Field } from '../ui/Field';

interface ItemFieldInputProps {
  id: string;
  fieldKey: ItemFieldKey;
  label: string;
  required: boolean;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  className?: string;
}

const DATALIST: Partial<Record<ItemFieldKey, string>> = {
  condition: 'dta-condition-options',
  workStatus: 'dta-work-status-options',
};

/** Ô nhập theo kiểu trường: text / textarea / số lượng / ngày / link. */
export function ItemFieldInput({ id, fieldKey, label, required, value, error, onChange, className }: ItemFieldInputProps) {
  const meta = ITEM_FIELD_META[fieldKey];
  const common = {
    id,
    name: fieldKey,
    value,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, error),
    className: 'field-input',
  } as const;

  let control;
  switch (meta.kind) {
    case 'textarea':
      control = (
        <textarea {...common} rows={3} maxLength={meta.max} className={cn(common.className, 'min-h-20 resize-y')} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case 'number':
      control = (
        <input
          {...common}
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.maxQuantity}
          step={1}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'date':
      control = <input {...common} type="date" onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'url':
      control = (
        <input
          {...common}
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={meta.max}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      control = (
        <input
          {...common}
          type="text"
          maxLength={meta.max}
          list={DATALIST[fieldKey]}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <Field id={id} label={label} required={required} error={error} className={className}>
      {control}
    </Field>
  );
}
