import { TIMEZONE } from '../../shared/constants';

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of dateTimeFormatter.formatToParts(date)) out[part.type] = part.value;
  return out;
}

/** ISO → "DD/MM/YYYY HH:mm" theo giờ Việt Nam (không phụ thuộc múi giờ máy người dùng). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** ISO hoặc "YYYY-MM-DD" → "DD/MM/YYYY". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year}`;
}

/** Ngày hôm nay theo giờ Việt Nam dạng YYYY-MM-DD. */
export function todayIsoDate(): string {
  const p = parts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}
