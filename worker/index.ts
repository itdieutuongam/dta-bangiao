import {
  adminBadgesHandler,
  adminCancelHandler,
  adminCategoriesHandler,
  adminCreateHandoverHandler,
  adminDetailHandler,
  adminEmployeesHandler,
  adminListHandler,
  adminLoginHandler,
  adminLogoutHandler,
  adminMeHandler,
  adminOverviewHandler,
  adminPdfHandler,
  adminReconcileStockHandler,
  adminRefreshCacheHandler,
  adminRegenerateLinkHandler,
  adminRegeneratePdfHandler,
  adminSignatureHandler,
  adminSystemHandler,
  adminUpdateHandler,
} from './api/admin';
import { exportCsvHandler } from './api/export';
import {
  confirmHandoverHandler,
  downloadPublicPdfHandler,
  getPublicHandoverHandler,
  requestConfirmOtpHandler,
  requestRevisionHandler,
} from './api/handover';
import { healthHandler } from './api/health';
import { vppEmployeeLookupHandler, vppPublicCatalogHandler, vppSubmitProposalHandler } from './api/publicVpp';
import { staffLoginHandler, staffSessionHandler } from './api/staff';
import {
  vppApproveProposalHandler,
  vppCloseProposalHandler,
  vppCreateNormHandler,
  vppCreateProductHandler,
  vppDashboardHandler,
  vppDataReviewHandler,
  vppHandoverContextHandler,
  vppMergeHandler,
  vppMovementsHandler,
  vppNormsHandler,
  vppProductDecisionHandler,
  vppProductsHandler,
  vppPromoteHandler,
  vppProposalDetailHandler,
  vppProposalsHandler,
  vppPurchasedProposalHandler,
  vppReceiveProposalHandler,
  vppRejectProposalHandler,
  vppScopeMappingHandler,
  vppSkipHandler,
  vppStockAdjustHandler,
  vppStockInHandler,
  vppSyncStockHandler,
  vppUpdateNormHandler,
  vppUpdateProductHandler,
} from './api/vpp';
import { Router } from './router';
import type { Env, RequestContext } from './types';
import { ApiError, fail } from './utils/http';
import { logError, logEvent } from './utils/log';
import { getClientIp } from './utils/request';

const router = new Router()
  .get('/api/health', healthHandler)
  // Mã truy cập nội bộ (tùy chọn) — dùng cho trang đề xuất văn phòng phẩm
  .get('/api/staff/session', staffSessionHandler)
  .post('/api/staff/login', staffLoginHandler)
  // Người nhận (public, qua link xác nhận). Tạo phiếu: CHỈ admin (POST /api/admin/handovers).
  .get('/api/handover/:token', getPublicHandoverHandler)
  .post('/api/handover/:token/otp', requestConfirmOtpHandler)
  .post('/api/handover/:token/confirm', confirmHandoverHandler)
  .post('/api/handover/:token/request-revision', requestRevisionHandler)
  .get('/api/handover/:token/pdf', downloadPublicPdfHandler)
  // Đề xuất văn phòng phẩm (public)
  .post('/api/public/vpp/employee-lookup', vppEmployeeLookupHandler)
  .get('/api/public/vpp/catalog', vppPublicCatalogHandler)
  .post('/api/public/vpp/proposals', vppSubmitProposalHandler)
  // Quản trị
  .post('/api/admin/login', adminLoginHandler)
  .post('/api/admin/logout', adminLogoutHandler)
  .get('/api/admin/me', adminMeHandler)
  .get('/api/admin/overview', adminOverviewHandler)
  .get('/api/admin/badges', adminBadgesHandler)
  .get('/api/admin/system', adminSystemHandler)
  // Xuất CSV (handovers | stock | movements | proposals)
  .get('/api/admin/export/:dataset', exportCsvHandler)
  .get('/api/admin/employees', adminEmployeesHandler)
  .get('/api/admin/categories', adminCategoriesHandler)
  .get('/api/admin/handovers', adminListHandler)
  .post('/api/admin/handovers', adminCreateHandoverHandler)
  .get('/api/admin/handovers/:id', adminDetailHandler)
  .put('/api/admin/handovers/:id', adminUpdateHandler)
  .post('/api/admin/handovers/:id/cancel', adminCancelHandler)
  .post('/api/admin/handovers/:id/regenerate-link', adminRegenerateLinkHandler)
  .post('/api/admin/handovers/:id/reconcile-stock', adminReconcileStockHandler)
  .get('/api/admin/handovers/:id/signature', adminSignatureHandler)
  .get('/api/admin/handovers/:id/pdf', adminPdfHandler)
  .post('/api/admin/handovers/:id/pdf', adminRegeneratePdfHandler)
  .post('/api/admin/cache/refresh', adminRefreshCacheHandler)
  // Quản trị — văn phòng phẩm
  .get('/api/admin/vpp/dashboard', vppDashboardHandler)
  .get('/api/admin/vpp/products', vppProductsHandler)
  .post('/api/admin/vpp/products', vppCreateProductHandler)
  .put('/api/admin/vpp/products/:id', vppUpdateProductHandler)
  .get('/api/admin/vpp/norms', vppNormsHandler)
  .post('/api/admin/vpp/norms', vppCreateNormHandler)
  .put('/api/admin/vpp/norms/:id', vppUpdateNormHandler)
  .put('/api/admin/vpp/scope-mapping', vppScopeMappingHandler)
  .get('/api/admin/vpp/stock', vppProductsHandler)
  .post('/api/admin/vpp/stock/in', vppStockInHandler)
  .post('/api/admin/vpp/stock/adjust', vppStockAdjustHandler)
  .get('/api/admin/vpp/movements', vppMovementsHandler)
  .get('/api/admin/vpp/handover-context', vppHandoverContextHandler)
  .get('/api/admin/vpp/proposals', vppProposalsHandler)
  .get('/api/admin/vpp/proposals/:id', vppProposalDetailHandler)
  .post('/api/admin/vpp/proposals/:id/approve', vppApproveProposalHandler)
  .post('/api/admin/vpp/proposals/:id/reject', vppRejectProposalHandler)
  .post('/api/admin/vpp/proposals/:id/purchased', vppPurchasedProposalHandler)
  .post('/api/admin/vpp/proposals/:id/receive', vppReceiveProposalHandler)
  .post('/api/admin/vpp/proposals/:id/close', vppCloseProposalHandler)
  .post('/api/admin/vpp/proposals/:id/items/:itemId/decision', vppProductDecisionHandler)
  .get('/api/admin/vpp/data-review', vppDataReviewHandler)
  .post('/api/admin/vpp/data-review/merge', vppMergeHandler)
  .post('/api/admin/vpp/data-review/promote', vppPromoteHandler)
  .post('/api/admin/vpp/data-review/skip', vppSkipHandler)
  .post('/api/admin/vpp/data-review/sync-stock', vppSyncStockHandler);

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
