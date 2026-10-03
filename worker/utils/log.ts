import type { RequestContext } from '../types';
import { ApiError } from './http';

/** Che token trong đường dẫn: /api/handover/AbCdEf… — không bao giờ log token đầy đủ. */
export function maskPath(pathname: string): string {
  return pathname.replace(/(\/(?:api\/handover|xac-nhan)\/)([A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/g, '$1$2…');
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) return { errorCode: err.code, status: err.status, message: err.message };
  if (err instanceof Error) return { errorName: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') };
  return { message: String(err) };
}

export function logEvent(
  level: 'info' | 'warn' | 'error',
  c: Pick<RequestContext, 'requestId' | 'url' | 'request'> | null,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry: Record<string, unknown> = { level, event, ...fields };
  if (c) {
    entry.requestId = c.requestId;
    entry.method = c.request.method;
    entry.path = maskPath(c.url.pathname);
  }
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logError(
  c: Pick<RequestContext, 'requestId' | 'url' | 'request'> | null,
  event: string,
  err: unknown,
  fields: Record<string, unknown> = {},
): void {
  logEvent('error', c, event, { ...fields, ...describeError(err) });
}
