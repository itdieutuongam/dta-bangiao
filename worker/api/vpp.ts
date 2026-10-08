import type { z } from 'zod';
import {
  handoverContextQuerySchema,
  mergeProductSchema,
  movementListQuerySchema,
  normSaveSchema,
  productDecisionSchema,
  productListQuerySchema,
  productSaveSchema,
  promoteProductSchema,
  proposalListQuerySchema,
  proposalNoteSchema,
  proposalReceiveSchema,
  proposalRejectSchema,
  proposalReviewSchema,
  scopeMappingSchema,
  skipReviewSchema,
  stockAdjustSchema,
  stockInSchema,
  syncStockSchema,
} from '../../shared/schemas';
import { requireAdmin } from '../auth/guards';
import { callGas } from '../services/gas';
import type { RequestContext } from '../types';
import { ok } from '../utils/http';
import { logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { requireParamId } from './common';

/**
 * API quản trị văn phòng phẩm (/api/admin/vpp/*). Mọi thao tác đều yêu cầu phiên admin; thao tác ghi kiểm tra Origin,
 * validate bằng Zod rồi Apps Script kiểm tra lại (lớp 3) trong LockService. Người thao tác (actor) được ghi vào lịch sử.
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

// ---------------------------------------------------------------- Tổng quan & danh mục

export async function vppDashboardHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  return ok(await callGas(c.env, 'vppDashboard', { actor }, READ));
}

/** GET /api/admin/vpp/products (và /stock) — danh mục kèm tồn: on_hand, reserved, available, trạng thái. */
export async function vppProductsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = productListQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'vppListProducts', { ...filters, actor }, READ));
}

export async function vppCreateProductHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, productSaveSchema);
  const data = await callGas(c.env, 'vppSaveProduct', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.product_created', { by: actor.id });
  return ok(data, 201);
}

export async function vppUpdateProductHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const productId = requireParamId(c, 'id', 'Không tìm thấy sản phẩm.');
  const input = await readBody(c, productSaveSchema);
  const data = await callGas(c.env, 'vppSaveProduct', { ...input, productId, actor }, WRITE);
  logEvent('info', c, 'vpp.product_updated', { productId, by: actor.id });
  return ok(data);
}

// ---------------------------------------------------------------- Định mức

export async function vppNormsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  return ok(await callGas(c.env, 'vppListNorms', { actor }, READ));
}

export async function vppCreateNormHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, normSaveSchema);
  const data = await callGas(c.env, 'vppSaveNorm', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.norm_created', { by: actor.id });
  return ok(data, 201);
}

export async function vppUpdateNormHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const normId = requireParamId(c, 'id', 'Không tìm thấy định mức.');
  const input = await readBody(c, normSaveSchema);
  const data = await callGas(c.env, 'vppSaveNorm', { ...input, normId, actor }, WRITE);
  logEvent('info', c, 'vpp.norm_updated', { normId, by: actor.id });
  return ok(data);
}

/** PUT /api/admin/vpp/scope-mapping — gắn phòng ban vào phạm vi định mức. */
export async function vppScopeMappingHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, scopeMappingSchema);
  return ok(await callGas(c.env, 'vppSetScopeMapping', { ...input, actor }, WRITE));
}

// ---------------------------------------------------------------- Kho

export async function vppStockInHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, stockInSchema);
  const data = await callGas(c.env, 'vppStockIn', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.stock_in', { productId: input.productId, quantity: input.quantity, by: actor.id });
  return ok(data);
}

export async function vppStockAdjustHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, stockAdjustSchema);
  const data = await callGas(c.env, 'vppStockAdjust', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.stock_adjust', { productId: input.productId, counted: input.countedQuantity, by: actor.id });
  return ok(data);
}

export async function vppMovementsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = movementListQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'vppListMovements', { ...filters, actor }, READ));
}

/** GET /api/admin/vpp/handover-context?receiverEmployeeId=…&handoverId=… — tồn khả dụng + định mức cho form phiếu VPP. */
export async function vppHandoverContextHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = handoverContextQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'vppHandoverContext', { ...filters, actor }, READ));
}

// ---------------------------------------------------------------- Đề xuất mua

export async function vppProposalsHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const filters = proposalListQuerySchema.parse(query(c));
  return ok(await callGas(c.env, 'vppListProposals', { ...filters, actor }, READ));
}

export async function vppProposalDetailHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
  return ok(await callGas(c.env, 'vppGetProposal', { id, actor }, READ));
}

/** POST …/proposals/:id/approve — duyệt từng dòng (SL duyệt 0 = không duyệt); trạng thái tính theo kết quả. */
export async function vppApproveProposalHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
  const input = await readBody(c, proposalReviewSchema);
  const data = await callGas(c.env, 'vppReviewProposal', { ...input, id, actor }, WRITE);
  logEvent('info', c, 'vpp.proposal_reviewed', { id, by: actor.id });
  return ok(data);
}

export async function vppRejectProposalHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
  const input = await readBody(c, proposalRejectSchema);
  const data = await callGas(c.env, 'vppRejectProposal', { ...input, id, actor }, WRITE);
  logEvent('info', c, 'vpp.proposal_rejected', { id, by: actor.id });
  return ok(data);
}

function statusHandler(status: 'PURCHASED' | 'CLOSED') {
  return async (c: RequestContext): Promise<Response> => {
    const { actor } = await requireAdmin(c);
    const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
    const input = await readBody(c, proposalNoteSchema);
    const data = await callGas(c.env, 'vppSetProposalStatus', { ...input, id, status, actor }, WRITE);
    logEvent('info', c, `vpp.proposal_${status.toLowerCase()}`, { id, by: actor.id });
    return ok(data);
  };
}

export const vppPurchasedProposalHandler = statusHandler('PURCHASED');
export const vppCloseProposalHandler = statusHandler('CLOSED');

/** POST …/proposals/:id/receive — nhập kho theo đề xuất (SL thực nhận, đơn giá, ngày). */
export async function vppReceiveProposalHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
  const input = await readBody(c, proposalReceiveSchema);
  const data = await callGas(c.env, 'vppReceiveProposal', { ...input, id, actor }, WRITE);
  logEvent('info', c, 'vpp.proposal_received', { id, by: actor.id });
  return ok(data);
}

/** POST …/proposals/:id/items/:itemId/decision — xử lý sản phẩm ngoài danh mục: MASTER / TEMP / REJECT / MAP. */
export async function vppProductDecisionHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const id = requireParamId(c, 'id', 'Không tìm thấy đề xuất.');
  const proposalItemId = requireParamId(c, 'itemId', 'Không tìm thấy dòng đề xuất.');
  const input = await readBody(c, productDecisionSchema);
  const data = await callGas(c.env, 'vppProductDecision', { ...input, id, proposalItemId, actor }, WRITE);
  logEvent('info', c, 'vpp.product_decision', { id, decision: input.decision, by: actor.id });
  return ok(data);
}

// ---------------------------------------------------------------- Dữ liệu cần kiểm tra

export async function vppDataReviewHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  return ok(await callGas(c.env, 'vppDataReview', { actor }, READ));
}

/** GHÉP sản phẩm tạm (tên tồn kho) vào sản phẩm danh mục — chuyển tồn. */
export async function vppMergeHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, mergeProductSchema);
  const data = await callGas(c.env, 'vppMergeProduct', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.product_merged', { source: input.sourceProductId, target: input.targetProductId, by: actor.id });
  return ok(data);
}

/** TẠO SẢN PHẨM MỚI từ sản phẩm tạm (đưa vào danh mục, có thể kèm định mức). */
export async function vppPromoteHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, promoteProductSchema);
  const data = await callGas(c.env, 'vppPromoteProduct', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.product_promoted', { productId: input.productId, by: actor.id });
  return ok(data);
}

/** BỎ QUA — giữ sản phẩm tạm là sản phẩm riêng ngoài định mức. */
export async function vppSkipHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, skipReviewSchema);
  return ok(await callGas(c.env, 'vppSkipReview', { ...input, actor }, WRITE));
}

/** ĐỒNG BỘ TỒN theo sổ biến động (sản phẩm có số tồn trên sheet lệch sổ — ghi dở / sửa tay sheet). */
export async function vppSyncStockHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const input = await readBody(c, syncStockSchema);
  const data = await callGas(c.env, 'vppSyncStock', { ...input, actor }, WRITE);
  logEvent('info', c, 'vpp.stock_synced', { productId: input.productId, by: actor.id });
  return ok(data);
}
