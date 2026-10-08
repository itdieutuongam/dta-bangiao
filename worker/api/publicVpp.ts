import { employeeLookupSchema, proposalSubmitSchema } from '../../shared/schemas';
import type { EmployeeLookupResponse, ProposalSubmitResult, PublicCatalogProduct } from '../../shared/vpp';
import { requireStaff } from '../auth/guards';
import { callGas } from '../services/gas';
import { getCached } from '../services/memoryCache';
import { enforceRateLimit } from '../services/rateLimit';
import type { RequestContext } from '../types';
import { ok } from '../utils/http';
import { logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { clientInfo } from './common';

/**
 * API công khai cho trang đề xuất văn phòng phẩm (/de-xuat-vpp).
 *   • Nếu đặt STAFF_ACCESS_CODE: phải nhập mã truy cập nội bộ trước (như trang tạo bàn giao cũ).
 *   • Không công khai danh bạ: chỉ tra MỘT nhân viên theo mã (giới hạn tần suất ở cả Worker và Apps Script).
 *   • Danh mục công khai chỉ gồm tên / ĐVT / nhóm — không có tồn kho, giá hay dữ liệu nội bộ.
 */

/** POST /api/public/vpp/employee-lookup — { employeeId } → họ tên, phòng ban, chức vụ + định mức của phòng ban. */
export async function vppEmployeeLookupHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'vpp-lookup');
  assertSameOrigin(c);
  await requireStaff(c);
  const { employeeId } = parseOrThrow(employeeLookupSchema, await readJson(c.request, 2 * 1024));
  const data = await callGas<EmployeeLookupResponse>(
    c.env,
    'vppEmployeeLookup',
    { employeeId, client: await clientInfo(c) },
    { scope: 'public', retries: 1 },
  );
  return ok(data);
}

/** GET /api/public/vpp/catalog — sản phẩm chính thức đang dùng (cache ngắn trong isolate). */
export async function vppPublicCatalogHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_PUBLIC', 'vpp-catalog');
  await requireStaff(c);
  const data = await getCached('catalog:vpp', 60_000, () =>
    callGas<{ products: PublicCatalogProduct[] }>(c.env, 'vppPublicCatalog', {}, { scope: 'public', retries: 1 }),
  );
  return ok(data);
}

/** POST /api/public/vpp/proposals — nhân viên gửi đề xuất mua (trong / vượt / ngoài định mức). */
export async function vppSubmitProposalHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'vpp-proposal');
  assertSameOrigin(c);
  await requireStaff(c);
  const input = parseOrThrow(proposalSubmitSchema, await readJson(c.request, 64 * 1024));
  const data = await callGas<ProposalSubmitResult>(
    c.env,
    'vppSubmitProposal',
    { ...input, client: await clientInfo(c) },
    { scope: 'public', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'vpp.proposal_submitted', { code: data.proposalCode, items: input.items.length, duplicate: data.duplicate });
  return ok(data, data.duplicate ? 200 : 201);
}
