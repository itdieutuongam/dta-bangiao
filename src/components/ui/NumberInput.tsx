import type { InputHTMLAttributes } from 'react';

/**
 * Ô nhập số: type="text" + bàn phím số trên điện thoại. Ô type="number" của trình duyệt đọc cách viết Việt Nam sai
 * ("1.000" → 1, "15.000" → 15: lưu nhỏ đi 1000 lần) — chữ trong ô này đọc bằng parseViNumber (src/utils/number.ts).
 */
export function NumberInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'min' | 'max' | 'step'>) {
  return <input autoComplete="off" spellCheck={false} {...props} type="text" inputMode="numeric" />;
}
