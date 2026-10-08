/**
 * Cache trong bộ nhớ isolate (ngắn hạn) cho dữ liệu ít thay đổi: nhân viên, loại bàn giao.
 * Mỗi isolate có cache riêng — TTL ngắn để dữ liệu mới trong Sheet xuất hiện sau tối đa ~1 phút.
 * Chỉ lưu giá trị đã resolve (không chia sẻ Promise giữa các request — ràng buộc của Workers).
 */

interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();
const MAX_ENTRIES = 50;

export async function getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await loader();
  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

export function invalidateCached(prefix = ''): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
