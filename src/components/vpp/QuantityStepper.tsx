import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import { numberToInput, parseViNumber } from '../../utils/number';
import { NumberInput } from '../ui/NumberInput';

/**
 * [-] n [+] — ô số lượng thân thiện cảm ứng. Chữ đang gõ giữ nguyên trong ô; số đọc kiểu Việt Nam ("1.000" = 1000).
 * Chữ không đọc được ("1,5") → báo NaN lên form để form báo lỗi — không giữ âm thầm số cũ khác với số đang hiện.
 */
export function QuantityStepper({
  id,
  value,
  onChange,
  min = 1,
  max = LIMITS.maxQuantity,
  disabled,
  invalid,
  label,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  describedBy?: string;
}) {
  const [text, setText] = useState(() => numberToInput(value));
  // Số từ form đổi (bấm +/−, điền sẵn, đặt lại form) khác số đang gõ → hiện số mới (điều chỉnh state khi render, không cần effect).
  const parsed = parseViNumber(text);
  const shown = parsed === null ? NaN : parsed;
  if (!Object.is(shown, value) && !(Number.isNaN(shown) && Number.isNaN(value))) setText(numberToInput(value));

  // Ô trống / chữ sai định dạng: bấm +/− đưa về số nhỏ nhất.
  const step = (delta: number) => onChange(Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value + delta))) : min);
  const current = Number.isFinite(value) ? value : min;
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-stone-300 bg-white shadow-xs">
      <button
        type="button"
        className="flex w-10 items-center justify-center text-stone-600 hover:bg-stone-100 disabled:opacity-40"
        onClick={() => step(-1)}
        disabled={disabled || (Number.isFinite(value) && current <= min)}
        aria-label={`Giảm ${label}`}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      {/* Ô chữ (để gõ "1.000") nhưng vẫn là spinbutton như ô type="number" trước đây: trình đọc màn hình đọc đúng vai trò / giá trị,
          phím ↑ / ↓ tăng / giảm. */}
      <NumberInput
        id={id}
        role="spinbutton"
        value={text}
        disabled={disabled}
        aria-label={label}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = parseViNumber(next);
          onChange(n === null ? NaN : n);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          step(e.key === 'ArrowUp' ? 1 : -1);
        }}
        className="w-16 border-x border-stone-300 text-center text-base font-semibold tabular-nums focus:outline-none sm:text-sm"
      />
      <button
        type="button"
        className="flex w-10 items-center justify-center text-stone-600 hover:bg-stone-100 disabled:opacity-40"
        onClick={() => step(1)}
        disabled={disabled || (Number.isFinite(value) && current >= max)}
        aria-label={`Tăng ${label}`}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
