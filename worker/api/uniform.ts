import type { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import {
  uniformContextQuerySchema,
  uniformEmployeesQuerySchema,
  uniformHoldingsQuerySchema,
  uniformModelSaveSchema,
  uniformMovementListQuerySchema,
  uniformNormSaveSchema,
  uniformProfileSchema,
  uniformReturnSchema,
  scopeMappingSchema,
  uniformStockAdjustSchema,
  uniformStockDisposeSchema,
  uniformStockInSchema,
  uniformStockQuerySchema,
} from '../../shared/schemas';
import { requireAdmin } from '../auth/guards';
import { callGas } from '../services/gas';
import type { RequestContext } from '../types';
import { ApiError, ok } from '../utils/http';
import { logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { requireParamId } from './common';

/**
 * API quản trị đồng phục (/api/admin/uniform/*). Mọi thao tác yêu cầu phiên admin; thao tác ghi kiểm tra Origin, validate bằng
 * Zod rồi Apps Script kiểm tra lại (Uniform.gs) trong LockService. Người thao tác (actor) được ghi vào lịch sử / sổ biến động kho.
 */

const READ = { scope: 'admin' as const, timeoutMs: 45_000, retries: 1 };
const WRITE = { scope: 'admin' as const, timeoutMs: 60_000 };

async function readBody<S extends z.ZodType>(c: RequestContext, schema: S, maxBytes = 64 * 1024): Promise<z.output<S>> {
  assertSameOrigin(c);
  return parseOrThrow(schema, await readJson(c.request, maxBytes));
}

function query(c: RequestContext): Record<string, string> {
  return Object.fromEntries(c.url.searchParams);
}

/** Mã nhân viên trên URL (không phải UUID): chữ, số, . _ - (giống NHAN_VIEN.employee_id). */
function requireEmployeeIdParam(c: RequestContext): string {
  const id = (c.params.employeeId ?? '').trim();
  if (!id || id.length > LIMITS.employeeId || !/^[\p{L}\p{N}._-]+$/u.test(id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy nhân viên.');
  }
  return id;
}

// ---------------------------------------------------------------- Tổng quan & danh mục / tồn kho

export async function uniformDashboardHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  return ok(await callGas(c.env, 'dpDashboard', { actor }, READ));
}

/** GET /api/admin/uniform/stock — mẫu kèm mặt hàng (size × tình trạng) và tồn theo sổ. */
export async function uniformStockHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = uniformStockQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpListStock', { ...filters, actor }, READ));
}

export async function uniformCreateModelHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformModelSaveSchema);
  const data = await callGas<{ duplicate?: boolean }>(c.env, 'dpSaveModel', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.model_created', { by: actor.id, duplicate: Boolean(data.duplicate) });
  return ok(data, data.duplicate ? 200 : 201);
}

export async function uniformUpdateModelHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const modelId = requireParamId(c, 'id', 'Không tìm thấy mẫu đồng phục.');
  const input = await readBody(c, uniformModelSaveSchema);
  const data = await callGas(c.env, 'dpSaveModel', { ...input, modelId, actor }, WRITE);
  logEvent('info', c, 'uniform.model_updated', { modelId, by: actor.id });
  return ok(data);
}

export async function uniformStockInHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformStockInSchema);
  const data = await callGas(c.env, 'dpStockIn', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.stock_in', { modelId: input.modelId, size: input.size, quantity: input.quantity, by: actor.id });
  return ok(data);
}

export async function uniformStockAdjustHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformStockAdjustSchema);
  const data = await callGas(c.env, 'dpStockAdjust', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.stock_adjust', { productId: input.productId, counted: input.countedQuantity, by: actor.id });
  return ok(data);
}

export async function uniformStockDisposeHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformStockDisposeSchema);
  const data = await callGas(c.env, 'dpStockDispose', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.stock_dispose', { productId: input.productId, quantity: input.quantity, by: actor.id });
  return ok(data);
}

export async function uniformMovementsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = uniformMovementListQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpListMovements', { ...filters, actor }, READ));
}

// ---------------------------------------------------------------- Tiêu chuẩn cấp phát năm

export async function uniformNormsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  return ok(await callGas(c.env, 'dpListNorms', { actor }, READ));
}

export async function uniformCreateNormHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformNormSaveSchema);
  const data = await callGas(c.env, 'dpSaveNorm', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.norm_created', { by: actor.id });
  return ok(data, 201);
}

export async function uniformUpdateNormHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const normId = requireParamId(c, 'id', 'Không tìm thấy tiêu chuẩn.');
  const input = await readBody(c, uniformNormSaveSchema);
  const data = await callGas(c.env, 'dpSaveNorm', { ...input, normId, actor }, WRITE);
  logEvent('info', c, 'uniform.norm_updated', { normId, by: actor.id });
  return ok(data);
}

/** PUT /api/admin/uniform/scope-mapping — gắn phòng ban vào nhóm tiêu chuẩn đồng phục ('' = tự khớp, NONE = không áp dụng). */
export async function uniformScopeMappingHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, scopeMappingSchema);
  return ok(await callGas(c.env, 'dpSetScopeMapping', { ...input, actor }, WRITE));
}

// ---------------------------------------------------------------- Nhân viên

/** GET /api/admin/uniform/employees?year=&q=&department=&includeInactive= — sổ cấp phát theo nhân viên (tiêu chuẩn năm). */
export async function uniformEmployeesHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = uniformEmployeesQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpListEmployees', { ...filters, actor }, READ));
}

export async function uniformEmployeeDetailHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const employeeId = requireEmployeeIdParam(c);
  const { year } = uniformEmployeesQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpEmployeeDetail', { employeeId, year, actor }, READ));
}

/** PUT /api/admin/uniform/employees/:employeeId/profile — giới tính + size (ghi vào NHAN_VIEN). */
export async function uniformEmployeeProfileHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const employeeId = requireEmployeeIdParam(c);
  const input = await readBody(c, uniformProfileSchema, 8 * 1024);
  const data = await callGas(c.env, 'dpSaveEmployeeProfile', { ...input, employeeId, actor }, WRITE);
  logEvent('info', c, 'uniform.profile_updated', { by: actor.id });
  return ok(data);
}

// ---------------------------------------------------------------- Phiếu đồng phục, mượn / trả

/** GET /api/admin/uniform/handover-context?receiverEmployeeId=…&handoverId=… — mẫu, size, tồn khả dụng + tiêu chuẩn năm. */
export async function uniformHandoverContextHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = uniformContextQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpHandoverContext', { ...filters, actor }, READ));
}

/** GET /api/admin/uniform/holdings?status=loans|overdue|outstanding|all&employeeId=&q= */
export async function uniformHoldingsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = uniformHoldingsQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'dpListHoldings', { ...filters, actor }, READ));
}

/** POST /api/admin/uniform/returns — ghi nhận nhân viên trả / thu hồi (nhập lại kho, hư hỏng, mất). */
export async function uniformReturnHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, uniformReturnSchema, 16 * 1024);
  const data = await callGas<{ duplicate?: boolean }>(c.env, 'dpRecordReturn', { ...input, actor }, WRITE);
  logEvent('info', c, 'uniform.returned', { handoverId: input.handoverId, quantity: input.quantity, result: input.result, by: actor.id });
  return ok(data, data.duplicate ? 200 : 201);
}
