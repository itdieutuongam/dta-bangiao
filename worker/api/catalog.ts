import type { Category, Employee } from '../../shared/types';
import { requireStaff } from '../auth/guards';
import { callGas } from '../services/gas';
import { getCached } from '../services/memoryCache';
import { enforceRateLimit } from '../services/rateLimit';
import type { RequestContext } from '../types';
import { ok } from '../utils/http';

const CATALOG_TTL_MS = 60_000;

/** GET /api/employees — nhân viên ACTIVE từ sheet NHAN_VIEN (qua Apps Script, có cache). */
export async function listEmployeesHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_PUBLIC', 'catalog');
  await requireStaff(c);
  const data = await getCached('catalog:employees', CATALOG_TTL_MS, () =>
    callGas<{ employees: Employee[] }>(c.env, 'listEmployees', {}, { scope: 'public', retries: 1 }),
  );
  return ok(data);
}

/** GET /api/categories — loại bàn giao đang hoạt động từ sheet LOAI_BAN_GIAO. */
export async function listCategoriesHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_PUBLIC', 'catalog');
  await requireStaff(c);
  const data = await getCached('catalog:categories', CATALOG_TTL_MS, () =>
    callGas<{ categories: Category[] }>(c.env, 'listCategories', {}, { scope: 'public', retries: 1 }),
  );
  return ok(data);
}
