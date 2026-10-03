import {
  adminCancelHandler,
  adminDetailHandler,
  adminListHandler,
  adminLoginHandler,
  adminLogoutHandler,
  adminMeHandler,
  adminPdfHandler,
  adminRefreshCacheHandler,
  adminRegenerateLinkHandler,
  adminRegeneratePdfHandler,
  adminSignatureHandler,
  adminUpdateHandler,
} from './api/admin';
import { listCategoriesHandler, listEmployeesHandler } from './api/catalog';
import {
  confirmHandoverHandler,
  createHandoverHandler,
  downloadPublicPdfHandler,
  getPublicHandoverHandler,
  requestRevisionHandler,
} from './api/handover';
import { healthHandler } from './api/health';
import { staffLoginHandler, staffSessionHandler } from './api/staff';
import { Router } from './router';
import type { Env, RequestContext } from './types';
import { ApiError, fail } from './utils/http';
import { logError, logEvent } from './utils/log';
import { getClientIp } from './utils/request';

const router = new Router()
  .get('/api/health', healthHandler)
  // Danh mục
  .get('/api/employees', listEmployeesHandler)
  .get('/api/categories', listCategoriesHandler)
  // Mã truy cập nội bộ (tùy chọn)
  .get('/api/staff/session', staffSessionHandler)
  .post('/api/staff/login', staffLoginHandler)
  // Bàn giao (public)
  .post('/api/handover', createHandoverHandler)
  .get('/api/handover/:token', getPublicHandoverHandler)
  .post('/api/handover/:token/confirm', confirmHandoverHandler)
  .post('/api/handover/:token/request-revision', requestRevisionHandler)
  .get('/api/handover/:token/pdf', downloadPublicPdfHandler)
  // Quản trị
  .post('/api/admin/login', adminLoginHandler)
  .post('/api/admin/logout', adminLogoutHandler)
  .get('/api/admin/me', adminMeHandler)
  .get('/api/admin/handovers', adminListHandler)
  .get('/api/admin/handovers/:id', adminDetailHandler)
  .put('/api/admin/handovers/:id', adminUpdateHandler)
  .post('/api/admin/handovers/:id/cancel', adminCancelHandler)
  .post('/api/admin/handovers/:id/regenerate-link', adminRegenerateLinkHandler)
  .get('/api/admin/handovers/:id/signature', adminSignatureHandler)
  .get('/api/admin/handovers/:id/pdf', adminPdfHandler)
  .post('/api/admin/handovers/:id/pdf', adminRegeneratePdfHandler)
  .post('/api/admin/cache/refresh', adminRefreshCacheHandler);

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const started = Date.now();
  const c: RequestContext = {
    request,
    env,
    ctx,
    url,
    params: {},
    clientIp: getClientIp(request),
    requestId: crypto.randomUUID(),
  };

  let response: Response;
  const match = router.match(request.method, url.pathname);
  if (match.kind === 'not_found') {
    response = fail(404, 'NOT_FOUND', 'API không tồn tại.');
  } else if (match.kind === 'method_not_allowed') {
    response = fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', undefined, {
      Allow: [...new Set(match.allowed)].join(', '),
    });
  } else {
    c.params = match.params;
    try {
      response = await match.handler(c);
    } catch (err) {
      if (err instanceof ApiError) {
        response = fail(err.status, err.code, err.message, err.details, err.headers);
      } else {
        logError(c, 'api.unhandled_error', err);
        response = fail(500, 'INTERNAL_ERROR', 'Đã có lỗi hệ thống. Vui lòng thử lại sau.');
      }
    }
  }

  // Access log (đường dẫn đã che token; không log body, cookie, secret).
  logEvent(response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info', c, 'api.request', {
    status: response.status,
    ms: Date.now() - started,
  });

  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', c.requestId);
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, ctx, url);
    }
    // Mọi đường dẫn khác: static assets / SPA fallback (thường được phục vụ trước khi tới Worker).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
