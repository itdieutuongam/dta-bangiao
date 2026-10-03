/**
 * Bindings & biến môi trường của Worker.
 * - Biến không bí mật: wrangler.jsonc → "vars".
 * - Biến bí mật: `npx wrangler secret put <TÊN>` (production) hoặc .dev.vars (local).
 */
export interface Env {
  ASSETS: Fetcher;
  RL_PUBLIC?: RateLimit;
  RL_WRITE?: RateLimit;
  RL_AUTH?: RateLimit;
  APP_BASE_URL?: string;
  GAS_WEB_APP_URL?: string;
  GAS_SHARED_SECRET?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  STAFF_ACCESS_CODE?: string;
}

export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  params: Record<string, string>;
  clientIp: string;
  requestId: string;
}

export type RouteHandler = (c: RequestContext) => Promise<Response>;
