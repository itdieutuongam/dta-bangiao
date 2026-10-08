import type { RequestContext } from '../types';
import { ApiError } from '../utils/http';
import { logEvent } from '../utils/log';

export type LimiterName = 'RL_PUBLIC' | 'RL_WRITE' | 'RL_AUTH' | 'RL_AUTH_ACCOUNT';

export const LIMITER_NAMES: readonly LimiterName[] = ['RL_PUBLIC', 'RL_WRITE', 'RL_AUTH', 'RL_AUTH_ACCOUNT'];

/** Giới hạn dự phòng (mỗi isolate) khi không có binding Rate Limiting. Khớp wrangler.jsonc. */
const FALLBACK_LIMITS: Record<LimiterName, number> = {
  RL_PUBLIC: 120,
  RL_WRITE: 20,
  RL_AUTH: 10,
  RL_AUTH_ACCOUNT: 30,
};
const WINDOW_MS = 60_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function allowInMemory(name: LimiterName, key: string): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const bucketKey = `${name}|${key}`;
  const bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= FALLBACK_LIMITS[name];
}

/**
 * Khóa IP cho giới hạn tần suất: IPv4 giữ nguyên; IPv6 gộp theo dải /64 (một người dùng / mạng thường có nguyên dải /64
 * — đổi địa chỉ trong dải không vượt được giới hạn); IPv4-mapped (::ffff:a.b.c.d) → IPv4.
 */
export function rateLimitIpKey(ip: string): string {
  const text = ip.trim().toLowerCase();
  if (!text.includes(':')) return text;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return mapped[1]!;
  const [head = '', tail = ''] = text.split('%')[0]!.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g])) : [];
  const groups = text.includes('::')
    ? [...headGroups, ...Array.from({ length: Math.max(0, 8 - headGroups.length - tailGroups.length) }, () => '0'), ...tailGroups]
    : headGroups;
  return `${groups.slice(0, 4).map((g) => (Number.parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

/**
 * Giới hạn số request theo IP (mặc định; IPv6 theo dải /64). Ưu tiên Cloudflare Workers Rate Limiting binding
 * (đồng bộ giữa các isolate trong cùng location); fallback bộ đếm trong bộ nhớ.
 * options.perIp = false: khóa chỉ theo scope (ví dụ theo tên đăng nhập) — đếm chung cho MỌI IP, để dò mật khẩu một
 * tài khoản từ nhiều IP vẫn bị chặn.
 */
export async function enforceRateLimit(
  c: RequestContext,
  name: LimiterName,
  scope: string,
  options: { perIp?: boolean } = {},
): Promise<void> {
  const key = options.perIp === false ? scope : `${scope}:${rateLimitIpKey(c.clientIp)}`;
  let allowed: boolean;
  const binding = c.env[name];
  if (binding) {
    try {
      allowed = (await binding.limit({ key })).success;
    } catch (err) {
      logEvent('warn', c, 'ratelimit.binding_failed', { limiter: name, message: err instanceof Error ? err.message : String(err) });
      allowed = allowInMemory(name, key);
    }
  } else {
    allowed = allowInMemory(name, key);
  }
  if (!allowed) {
    throw new ApiError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.', {
      headers: { 'Retry-After': '60' },
    });
  }
}
