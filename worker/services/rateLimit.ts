import type { RequestContext } from '../types';
import { ApiError } from '../utils/http';
import { logEvent } from '../utils/log';

export type LimiterName = 'RL_PUBLIC' | 'RL_WRITE' | 'RL_AUTH';

/** Giới hạn dự phòng (mỗi isolate) khi không có binding Rate Limiting. Khớp wrangler.jsonc. */
const FALLBACK_LIMITS: Record<LimiterName, number> = {
  RL_PUBLIC: 120,
  RL_WRITE: 20,
  RL_AUTH: 10,
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
 * Giới hạn số request theo IP. Ưu tiên Cloudflare Workers Rate Limiting binding
 * (đồng bộ giữa các isolate trong cùng location); fallback bộ đếm trong bộ nhớ.
 */
export async function enforceRateLimit(c: RequestContext, name: LimiterName, scope: string): Promise<void> {
  const key = `${scope}:${c.clientIp}`;
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
