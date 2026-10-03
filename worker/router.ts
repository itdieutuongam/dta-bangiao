import type { RouteHandler } from './types';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface Route {
  method: Method;
  segments: string[];
  handler: RouteHandler;
}

export type MatchResult =
  | { kind: 'match'; handler: RouteHandler; params: Record<string, string> }
  | { kind: 'method_not_allowed'; allowed: Method[] }
  | { kind: 'not_found' };

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Router tối giản: pattern dạng /api/handover/:token/confirm. */
export class Router {
  private readonly routes: Route[] = [];

  on(method: Method, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.on('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.on('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): this {
    return this.on('PUT', pattern, handler);
  }

  match(method: string, pathname: string): MatchResult {
    const parts = split(pathname);
    const allowed: Method[] = [];
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      // HEAD được xử lý như GET (không trả body ở tầng runtime).
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { kind: 'match', handler: route.handler, params };
      }
      allowed.push(route.method);
    }
    return allowed.length > 0 ? { kind: 'method_not_allowed', allowed } : { kind: 'not_found' };
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i]!;
    const actual = parts[i]!;
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}
