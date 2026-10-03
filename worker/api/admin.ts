import { adminListQuerySchema, adminLoginSchema, cancelSchema, handoverInputSchema } from '../../shared/schemas';
import type {
  AdminDetailResponse,
  AdminHandoverDetail,
  AdminListResponse,
  AdminUpdateResponse,
  Category,
  SessionInfo,
} from '../../shared/types';
import { requireAdmin } from '../auth/guards';
import { clearSessionCookie, createSessionCookie, readSession } from '../auth/session';
import { callGas } from '../services/gas';
import { invalidateCached } from '../services/memoryCache';
import { enforceRateLimit } from '../services/rateLimit';
import { buildConfirmLink, issueLinkToken, recoverConfirmLink } from '../services/token';
import type { RequestContext } from '../types';
import { secretEquals, sleep } from '../utils/crypto';
import { ApiError, ok } from '../utils/http';
import { logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { clientInfo, gasFileResponse, requireHandoverId, type GasFile } from './common';

/** Dữ liệu chi tiết từ Apps Script — có thêm hash/nonce token (Worker dùng để dựng link rồi loại bỏ). */
type GasAdminDetail = Omit<AdminHandoverDetail, 'link'> & { tokenHash: string; tokenNonce: string };

interface GasDetailResponse {
  handover: GasAdminDetail;
  categories: Category[];
}

async function finalizeDetail(c: RequestContext, raw: GasAdminDetail): Promise<AdminHandoverDetail> {
  const { tokenHash, tokenNonce, ...rest } = raw;
  const link = rest.status === 'CANCELLED' ? null : await recoverConfirmLink(c.env, c.url, tokenNonce, tokenHash);
  return { ...rest, link };
}

// ---------------------------------------------------------------- Auth

/** POST /api/admin/login — so sánh với ADMIN_PASSWORD, cấp cookie phiên ký HMAC. */
export async function adminLoginHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_AUTH', 'admin-login');
  assertSameOrigin(c);
  const expected = c.env.ADMIN_PASSWORD?.trim();
  if (!expected || !c.env.SESSION_SECRET?.trim()) {
    throw new ApiError(503, 'NOT_CONFIGURED', 'Chưa cấu hình ADMIN_PASSWORD / SESSION_SECRET cho trang quản trị.');
  }
  const { password } = parseOrThrow(adminLoginSchema, await readJson(c.request, 4 * 1024));
  if (!(await secretEquals(password, expected))) {
    await sleep(400);
    logEvent('warn', c, 'admin.login_failed');
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Mật khẩu không đúng.');
  }
  const session = await createSessionCookie(c, 'admin');
  logEvent('info', c, 'admin.login_succeeded');
  const body: SessionInfo = { authenticated: true, expiresAt: session.expiresAt };
  return ok(body, 200, { 'Set-Cookie': session.cookie });
}

/** POST /api/admin/logout — xóa cookie phiên. */
export async function adminLogoutHandler(c: RequestContext): Promise<Response> {
  assertSameOrigin(c);
  const body: SessionInfo = { authenticated: false, expiresAt: null };
  return ok(body, 200, { 'Set-Cookie': clearSessionCookie(c, 'admin') });
}

/** GET /api/admin/me — kiểm tra phiên hiện tại. */
export async function adminMeHandler(c: RequestContext): Promise<Response> {
  const session = await readSession(c, 'admin');
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
  const body: SessionInfo = { authenticated: true, expiresAt: new Date(session.exp * 1000).toISOString() };
  return ok(body);
}

// ---------------------------------------------------------------- Handovers

/** GET /api/admin/handovers — danh sách + thống kê + bộ lọc. */
export async function adminListHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  const filters = adminListQuerySchema.parse(Object.fromEntries(c.url.searchParams));
  const data = await callGas<AdminListResponse>(c.env, 'adminListHandovers', filters, {
    scope: 'admin',
    timeoutMs: 45_000,
    retries: 1,
  });
  return ok(data);
}

/** GET /api/admin/handovers/:id — chi tiết đầy đủ + lịch sử + link xác nhận. */
export async function adminDetailHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  const id = requireHandoverId(c);
  const data = await callGas<GasDetailResponse>(c.env, 'adminGetHandover', { id }, { scope: 'admin', retries: 1 });
  const body: AdminDetailResponse = { handover: await finalizeDetail(c, data.handover), categories: data.categories };
  return ok(body);
}

/** PUT /api/admin/handovers/:id — sửa biên bản (chỉ khi PENDING / REVISION_REQUESTED). */
export async function adminUpdateHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const input = parseOrThrow(handoverInputSchema, await readJson(c.request, 256 * 1024));
  // Token dự phòng: Apps Script chỉ dùng khi đổi người nhận (link cũ bị vô hiệu).
  const candidate = await issueLinkToken(c.env);
  const data = await callGas<GasDetailResponse & { linkRotated: boolean }>(
    c.env,
    'adminUpdateHandover',
    { id, ...input, candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce, client: await clientInfo(c) },
    { scope: 'admin', timeoutMs: 60_000 },
  );
  logEvent('info', c, 'admin.handover_updated', { code: data.handover.code, linkRotated: data.linkRotated });
  const body: AdminUpdateResponse = {
    handover: await finalizeDetail(c, data.handover),
    categories: data.categories,
    linkRotated: data.linkRotated,
  };
  return ok(body);
}

/** POST /api/admin/handovers/:id/cancel — hủy biên bản chưa xác nhận. */
export async function adminCancelHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const { reason } = parseOrThrow(cancelSchema, await readJson(c.request, 8 * 1024));
  const data = await callGas<GasDetailResponse>(
    c.env,
    'adminCancelHandover',
    { id, reason, client: await clientInfo(c) },
    { scope: 'admin', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'admin.handover_cancelled', { code: data.handover.code });
  const body: AdminDetailResponse = { handover: await finalizeDetail(c, data.handover), categories: data.categories };
  return ok(body);
}

/** POST /api/admin/handovers/:id/regenerate-link — cấp link mới, link cũ hết hiệu lực. */
export async function adminRegenerateLinkHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const link = await issueLinkToken(c.env);
  const data = await callGas<{ code: string }>(
    c.env,
    'adminRegenerateLink',
    { id, tokenHash: link.hash, tokenNonce: link.nonce, client: await clientInfo(c) },
    { scope: 'admin', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'admin.link_regenerated', { code: data.code });
  return ok({ link: buildConfirmLink(c.env, c.url, link.token) });
}

/** GET /api/admin/handovers/:id/signature — ảnh chữ ký (Drive private, đi qua Worker). */
export async function adminSignatureHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  const id = requireHandoverId(c);
  const file = await callGas<GasFile>(c.env, 'adminGetSignature', { id }, { scope: 'admin', timeoutMs: 45_000 });
  return gasFileResponse(file, 'inline');
}

/** GET /api/admin/handovers/:id/pdf — tải PDF (tự sinh nếu chưa có). */
export async function adminPdfHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  const id = requireHandoverId(c);
  const file = await callGas<GasFile>(c.env, 'adminGetPdf', { id }, { scope: 'admin', timeoutMs: 120_000 });
  return gasFileResponse(file, 'attachment');
}

/** POST /api/admin/handovers/:id/pdf — tạo lại PDF. */
export async function adminRegeneratePdfHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const data = await callGas<{ pdfAvailable: boolean }>(
    c.env,
    'adminGeneratePdf',
    { id, force: true },
    { scope: 'admin', timeoutMs: 120_000 },
  );
  return ok(data);
}

/** POST /api/admin/cache/refresh — làm mới cache nhân viên / loại bàn giao sau khi sửa Sheet. */
export async function adminRefreshCacheHandler(c: RequestContext): Promise<Response> {
  await requireAdmin(c);
  assertSameOrigin(c);
  const data = await callGas<{ employees: number; categories: number }>(
    c.env,
    'refreshCache',
    {},
    { scope: 'admin', timeoutMs: 45_000 },
  );
  invalidateCached('catalog:');
  return ok(data);
}
