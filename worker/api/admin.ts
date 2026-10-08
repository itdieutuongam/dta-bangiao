import { APP_VERSION } from '../../shared/constants';
import {
  adminListQuerySchema,
  adminLoginSchema,
  cancelSchema,
  handoverInputSchema,
  handoverUpdateMetaSchema,
} from '../../shared/schemas';
import type {
  AdminBadges,
  AdminDetailResponse,
  AdminEmployee,
  AdminHandoverDetail,
  AdminListResponse,
  AdminOverview,
  AdminUpdateResponse,
  Category,
  CreateHandoverResult,
  ReceiverInfo,
  SessionInfo,
  SystemInfo,
} from '../../shared/types';
import type { StockWarning } from '../../shared/vpp';
import { adminConfigWarnings, findAdminAccount, readAdminConfig } from '../auth/adminUsers';
import { requireAdmin } from '../auth/guards';
import { adminUserOf, clearSessionCookie, createSessionCookie, readSession } from '../auth/session';
import { callGas } from '../services/gas';
import { invalidateCached } from '../services/memoryCache';
import { enforceRateLimit, LIMITER_NAMES } from '../services/rateLimit';
import { recordSealKey, withSealKey } from '../services/seal';
import { buildConfirmLink, issueLinkToken, recoverConfirmLink } from '../services/token';
import type { RequestContext } from '../types';
import { randomBytes, secretEquals, sleep, toHex } from '../utils/crypto';
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

/** POST /api/admin/login — tài khoản ADMIN_USERS (username + mật khẩu) hoặc mật khẩu chung ADMIN_PASSWORD. */
export async function adminLoginHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_AUTH', 'admin-login');
  assertSameOrigin(c);
  const config = readAdminConfig(c.env);
  if (config.error || !c.env.SESSION_SECRET?.trim()) {
    if (config.error) logEvent('error', c, 'admin.config_invalid', { message: config.error });
    throw new ApiError(503, 'NOT_CONFIGURED', 'Chưa cấu hình đúng tài khoản quản trị (ADMIN_USERS / ADMIN_PASSWORD) hoặc SESSION_SECRET.');
  }
  const { username, password } = parseOrThrow(adminLoginSchema, await readJson(c.request, 4 * 1024));
  if (config.mode === 'users') {
    if (!username) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Nhập tên đăng nhập.', { details: { fieldErrors: { username: 'Nhập tên đăng nhập.' } } });
    }
    // Giới hạn thêm theo tài khoản (đếm chung mọi IP): dò mật khẩu một tài khoản từ nhiều IP vẫn bị chặn. Ngưỡng
    // (RL_AUTH_ACCOUNT) cao hơn ngưỡng theo IP (RL_AUTH, kiểm tra trước): một IP dò mật khẩu bị chặn theo IP trước khi kịp
    // làm đầy ngưỡng của tài khoản → không khóa được quản trị viên thật đăng nhập từ IP khác.
    await enforceRateLimit(c, 'RL_AUTH_ACCOUNT', `admin-login-user:${username}`, { perIp: false });
  }
  const account = findAdminAccount(config, username);
  // Luôn so sánh (kể cả khi không có tài khoản) để thời gian phản hồi không lộ username tồn tại hay không.
  const matched = await secretEquals(password, account?.password ?? toHex(randomBytes(24)));
  if (!account || !matched) {
    await sleep(400);
    logEvent('warn', c, 'admin.login_failed', { username: config.mode === 'users' ? username : 'shared' });
    throw new ApiError(401, 'INVALID_CREDENTIALS', config.mode === 'users' ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : 'Mật khẩu không đúng.');
  }
  const user = { username: account.username, name: account.name };
  const session = await createSessionCookie(c, 'admin', user);
  logEvent('info', c, 'admin.login_succeeded', { username: user.username });
  const body: SessionInfo = { authenticated: true, expiresAt: session.expiresAt, user, mode: config.mode, warnings: adminConfigWarnings(c.env, config) };
  return ok(body, 200, { 'Set-Cookie': session.cookie });
}

/** POST /api/admin/logout — xóa cookie phiên. */
export async function adminLogoutHandler(c: RequestContext): Promise<Response> {
  assertSameOrigin(c);
  const body: SessionInfo = { authenticated: false, expiresAt: null };
  return ok(body, 200, { 'Set-Cookie': clearSessionCookie(c, 'admin') });
}

/** GET /api/admin/me — phiên hiện tại; 401 kèm loginMode để trang đăng nhập biết có cần ô tên đăng nhập. */
export async function adminMeHandler(c: RequestContext): Promise<Response> {
  const config = readAdminConfig(c.env);
  const session = await readSession(c, 'admin');
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Chưa đăng nhập.', { details: { loginMode: config.mode } });
  const body: SessionInfo = {
    authenticated: true,
    expiresAt: new Date(session.exp * 1000).toISOString(),
    user: adminUserOf(c.env, session),
    mode: config.mode,
    warnings: adminConfigWarnings(c.env, config),
  };
  return ok(body);
}

// ---------------------------------------------------------------- Tổng quan / hệ thống / danh mục

/** GET /api/admin/overview — thống kê phiếu, việc cần xử lý, cảnh báo văn phòng phẩm. */
export async function adminOverviewHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const data = await callGas<AdminOverview>(c.env, 'adminOverview', { actor }, { scope: 'admin', timeoutMs: 45_000, retries: 1 });
  return ok(data);
}

/** GET /api/admin/badges — số yêu cầu chỉnh sửa / đề xuất chờ duyệt cho huy hiệu trên menu (chỉ đọc cột trạng thái). */
export async function adminBadgesHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const data = await callGas<AdminBadges>(c.env, 'adminBadges', { actor }, { scope: 'admin', retries: 1 });
  return ok(data);
}

/** GET /api/admin/system — trang Cài đặt: cấu hình Worker + phiên bản / cấu trúc dữ liệu Apps Script (không lộ secret). */
export async function adminSystemHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const config = readAdminConfig(c.env);
  const body: SystemInfo = {
    worker: {
      version: APP_VERSION,
      appBaseUrl: c.env.APP_BASE_URL?.trim() || c.url.origin,
      loginMode: config.mode,
      adminUsers: config.accounts.length,
      staffAccessCode: Boolean(c.env.STAFF_ACCESS_CODE?.trim()),
      rateLimitBindings: LIMITER_NAMES.every((name) => Boolean(c.env[name])),
      recordSeal: Boolean(await recordSealKey(c.env)),
    },
    appsScript: null,
    appsScriptError: null,
    warnings: adminConfigWarnings(c.env, config),
  };
  try {
    body.appsScript = await callGas<NonNullable<SystemInfo['appsScript']>>(c.env, 'adminSystemInfo', { actor }, { scope: 'admin', retries: 1 });
    if (!body.appsScript.schemaReady) {
      body.warnings.push('Cơ sở dữ liệu chưa nâng cấp lên v2 — chủ sở hữu Google Sheet cần chạy menu DTA Handover → Nâng cấp module Văn phòng phẩm.');
    }
    if (body.appsScript.version !== APP_VERSION) {
      body.warnings.push(`Phiên bản Apps Script (${body.appsScript.version}) khác Worker (${APP_VERSION}) — hãy cập nhật code Apps Script và tạo New version.`);
    }
  } catch (err) {
    // Lỗi kết nối / cấu hình Apps Script → hiển thị trên trang Cài đặt; lỗi lập trình khác → ném tiếp (500 + log).
    if (!(err instanceof ApiError)) throw err;
    body.appsScriptError = err.message;
  }
  return ok(body);
}

/** GET /api/admin/employees — danh sách nhân viên (không công khai). ?all=1: kèm nhân viên đã nghỉ + phạm vi định mức. */
export async function adminEmployeesHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const includeInactive = c.url.searchParams.get('all') === '1';
  const data = await callGas<{ employees: AdminEmployee[] }>(c.env, 'adminListEmployees', { includeInactive, actor }, { scope: 'admin', retries: 1 });
  return ok(data);
}

/** GET /api/admin/categories — loại nội dung đang dùng (kèm loại phiếu). */
export async function adminCategoriesHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const data = await callGas<{ categories: Category[] }>(c.env, 'adminListCategories', { actor }, { scope: 'admin', retries: 1 });
  return ok(data);
}

// ---------------------------------------------------------------- Handovers

/** GET /api/admin/handovers — danh sách + thống kê + bộ lọc. */
export async function adminListHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = adminListQuerySchema.parse(Object.fromEntries(c.url.searchParams));
  const data = await callGas<AdminListResponse>(c.env, 'adminListHandovers', { ...filters, actor }, {
    scope: 'admin',
    timeoutMs: 45_000,
    retries: 1,
  });
  return ok(data);
}

interface GasCreateResult {
  id: string;
  code: string;
  status: CreateHandoverResult['status'];
  handoverType: CreateHandoverResult['handoverType'];
  createdAt: string;
  receiver: ReceiverInfo;
  warnings: StockWarning[];
  confirmOtp: CreateHandoverResult['confirmOtp'];
  duplicate?: boolean;
  tokenHash?: string;
  tokenNonce?: string;
}

/**
 * POST /api/admin/handovers — CHỈ quản trị viên tạo phiếu (mọi loại, kể cả văn phòng phẩm) + sinh link xác nhận.
 * clientRequestId: gửi lại cùng mã (bấm 2 lần / mạng chập chờn) → trả phiếu đã tạo, không tạo trùng.
 */
export async function adminCreateHandoverHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  await enforceRateLimit(c, 'RL_WRITE', 'create');
  const input = parseOrThrow(handoverInputSchema, await readJson(c.request, 256 * 1024));
  const link = await issueLinkToken(c.env);
  const result = await callGas<GasCreateResult>(
    c.env,
    'adminCreateHandover',
    { ...input, tokenHash: link.hash, tokenNonce: link.nonce, client: await clientInfo(c), actor },
    { scope: 'admin', timeoutMs: 60_000 },
  );
  let confirmLink = buildConfirmLink(c.env, c.url, link.token);
  if (result.duplicate) {
    confirmLink = (await recoverConfirmLink(c.env, c.url, result.tokenNonce ?? '', result.tokenHash ?? '')) ?? '';
  }
  logEvent('info', c, 'handover.created', { code: result.code, type: result.handoverType, duplicate: Boolean(result.duplicate), by: actor.id });
  const body: CreateHandoverResult = {
    id: result.id,
    code: result.code,
    status: result.status,
    handoverType: result.handoverType,
    createdAt: result.createdAt,
    receiver: result.receiver,
    warnings: result.warnings ?? [],
    link: confirmLink,
    confirmOtp: result.confirmOtp,
  };
  if (result.duplicate) body.duplicate = true;
  return ok(body, result.duplicate ? 200 : 201);
}

/** GET /api/admin/handovers/:id — chi tiết đầy đủ + lịch sử + link xác nhận + toàn vẹn. */
export async function adminDetailHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireHandoverId(c);
  // sealKey: Apps Script kiểm tra cả niêm phong của biên bản đã ký (integrity.checks.seal).
  const data = await callGas<GasDetailResponse>(c.env, 'adminGetHandover', await withSealKey(c.env, { id, actor }), {
    scope: 'admin',
    retries: 1,
  });
  const body: AdminDetailResponse = { handover: await finalizeDetail(c, data.handover), categories: data.categories };
  return ok(body);
}

/** PUT /api/admin/handovers/:id — sửa biên bản (chỉ khi PENDING / REVISION_REQUESTED). */
export async function adminUpdateHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const raw = await readJson(c.request, 256 * 1024);
  const input = parseOrThrow(handoverInputSchema, raw);
  // Mã băm nội dung lúc mở trang sửa → Apps Script báo CONFLICT nếu phiếu đã bị người khác sửa trong lúc đó.
  const { expectedContentHash } = parseOrThrow(handoverUpdateMetaSchema, raw);
  // Token dự phòng: Apps Script chỉ dùng khi đổi người nhận (link cũ bị vô hiệu).
  const candidate = await issueLinkToken(c.env);
  const data = await callGas<GasDetailResponse & { linkRotated: boolean; warnings: StockWarning[] }>(
    c.env,
    'adminUpdateHandover',
    await withSealKey(c.env, {
      id, ...input, expectedContentHash, candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce,
      client: await clientInfo(c), actor,
    }),
    { scope: 'admin', timeoutMs: 60_000 },
  );
  logEvent('info', c, 'admin.handover_updated', { code: data.handover.code, linkRotated: data.linkRotated, by: actor.id });
  const body: AdminUpdateResponse = {
    handover: await finalizeDetail(c, data.handover),
    categories: data.categories,
    linkRotated: data.linkRotated,
    warnings: data.warnings ?? [],
  };
  return ok(body);
}

/** POST /api/admin/handovers/:id/cancel — hủy biên bản chưa xác nhận (VPP: trả lại số đang giữ chỗ). */
export async function adminCancelHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const { reason } = parseOrThrow(cancelSchema, await readJson(c.request, 8 * 1024));
  const data = await callGas<GasDetailResponse>(
    c.env,
    'adminCancelHandover',
    await withSealKey(c.env, { id, reason, client: await clientInfo(c), actor }),
    { scope: 'admin', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'admin.handover_cancelled', { code: data.handover.code, by: actor.id });
  const body: AdminDetailResponse = { handover: await finalizeDetail(c, data.handover), categories: data.categories };
  return ok(body);
}

/** POST /api/admin/handovers/:id/regenerate-link — cấp link mới, link cũ hết hiệu lực. */
export async function adminRegenerateLinkHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const link = await issueLinkToken(c.env);
  const data = await callGas<{ code: string }>(
    c.env,
    'adminRegenerateLink',
    { id, tokenHash: link.hash, tokenNonce: link.nonce, client: await clientInfo(c), actor },
    { scope: 'admin', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'admin.link_regenerated', { code: data.code, by: actor.id });
  return ok({ link: buildConfirmLink(c.env, c.url, link.token) });
}

/** GET /api/admin/handovers/:id/signature — ảnh chữ ký (Drive private, đi qua Worker, chỉ PNG). */
export async function adminSignatureHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireHandoverId(c);
  const file = await callGas<GasFile>(c.env, 'adminGetSignature', await withSealKey(c.env, { id, actor }), { scope: 'admin', timeoutMs: 45_000 });
  return gasFileResponse(file, 'inline', 'png');
}

/** GET /api/admin/handovers/:id/pdf — tải PDF (tự sinh nếu chưa có). */
export async function adminPdfHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireHandoverId(c);
  const file = await callGas<GasFile>(c.env, 'adminGetPdf', await withSealKey(c.env, { id, actor }), { scope: 'admin', timeoutMs: 120_000 });
  return gasFileResponse(file, 'attachment', 'pdf');
}

/** POST /api/admin/handovers/:id/pdf — tạo lại PDF (bản cũ được lưu trữ, không xóa). */
export async function adminRegeneratePdfHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const data = await callGas<{ pdfAvailable: boolean }>(
    c.env,
    'adminGeneratePdf',
    await withSealKey(c.env, { id, force: true, actor }),
    { scope: 'admin', timeoutMs: 120_000 },
  );
  return ok(data);
}

/** POST /api/admin/handovers/:id/reconcile-stock — đối soát kho cho phiếu văn phòng phẩm (sửa lệch sau sự cố). */
export async function adminReconcileStockHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const id = requireHandoverId(c);
  const data = await callGas<{ reconciled: boolean; warnings: StockWarning[] }>(
    c.env,
    'vppReconcileHandover',
    { id, actor },
    { scope: 'admin', timeoutMs: 60_000 },
  );
  logEvent('info', c, 'admin.stock_reconciled', { id, by: actor.id });
  return ok(data);
}

/** POST /api/admin/cache/refresh — làm mới cache nhân viên / loại bàn giao / danh mục VPP sau khi sửa Sheet. */
export async function adminRefreshCacheHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  assertSameOrigin(c);
  const data = await callGas<{ employees: number; categories: number }>(
    c.env,
    'refreshCache',
    { actor },
    { scope: 'admin', timeoutMs: 45_000 },
  );
  invalidateCached('catalog:');
  return ok(data);
}
