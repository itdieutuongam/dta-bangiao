import type {
  EmployeeGender,
  ReturnReason,
  ReturnResult,
  UniformCondition,
  UniformDashboard,
  UniformEmployeeDetail,
  UniformEmployeeRow,
  UniformEmployeesResponse,
  UniformGender,
  UniformHandoverContext,
  UniformHoldingsResponse,
  UniformKind,
  UniformMovementListResponse,
  UniformNorm,
  UniformNormsResponse,
  UniformReturnResult,
  UniformSku,
  UniformStockInReason,
  UniformStockModel,
  UniformStockResponse,
} from '../../shared/uniform';
import { toQuery } from './adminApi';
import { apiRequest } from './api';

/** API quản trị đồng phục (/api/admin/uniform/*). duplicate = máy chủ nhận ra thao tác (cùng mã) đã ghi ở lần gửi trước. */

export function uniformDashboard(signal?: AbortSignal): Promise<UniformDashboard> {
  return apiRequest<UniformDashboard>('/api/admin/uniform/dashboard', { signal });
}

export function uniformStock(filters: { q?: string; includeInactive?: boolean } = {}, signal?: AbortSignal): Promise<UniformStockResponse> {
  return apiRequest<UniformStockResponse>(`/api/admin/uniform/stock${toQuery({ ...filters })}`, { signal });
}

export interface UniformModelInput {
  modelCode: string;
  modelName: string;
  kind: UniformKind;
  gender: UniformGender;
  sizes: string[];
  unit: string;
  referencePrice: number | null;
  countsTowardQuota: boolean;
  minimumStock: number;
  appliesTo: string;
  note: string;
  active: boolean;
  clientRequestId?: string;
}

export function uniformSaveModel(input: UniformModelInput, modelId?: string) {
  const path = modelId ? `/api/admin/uniform/models/${encodeURIComponent(modelId)}` : '/api/admin/uniform/models';
  return apiRequest<{ model: UniformStockModel; duplicate?: boolean }>(path, { method: modelId ? 'PUT' : 'POST', body: input });
}

export interface SkuWriteResult {
  sku: UniformSku;
  duplicate: boolean;
}

async function skuWrite(path: string, body: unknown): Promise<SkuWriteResult> {
  const data = await apiRequest<{ sku: UniformSku; duplicate?: boolean }>(path, { method: 'POST', body });
  return { sku: data.sku, duplicate: data.duplicate === true };
}

export function uniformStockIn(input: {
  modelId: string;
  size: string;
  condition: UniformCondition;
  quantity: number;
  reasonType: UniformStockInReason;
  unitPrice: number | null;
  date: string;
  note: string;
  clientRequestId: string;
}): Promise<SkuWriteResult> {
  return skuWrite('/api/admin/uniform/stock/in', input);
}

export function uniformStockAdjust(input: { productId: string; countedQuantity: number; reason: string; clientRequestId: string }) {
  return skuWrite('/api/admin/uniform/stock/adjust', input);
}

export function uniformStockDispose(input: { productId: string; quantity: number; reason: string; clientRequestId: string }) {
  return skuWrite('/api/admin/uniform/stock/dispose', input);
}

export function uniformMovements(
  filters: { page?: number; pageSize?: number; modelId?: string; productId?: string; type?: string; from?: string; to?: string; q?: string },
  signal?: AbortSignal,
) {
  return apiRequest<UniformMovementListResponse>(`/api/admin/uniform/movements${toQuery({ ...filters })}`, { signal });
}

export function uniformNorms(signal?: AbortSignal): Promise<UniformNormsResponse> {
  return apiRequest<UniformNormsResponse>('/api/admin/uniform/norms', { signal });
}

export interface UniformNormInput {
  scopeId: string;
  scopeName: string;
  modelId: string;
  gender: EmployeeGender | '';
  yearlyQuantity: number;
  note: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
}

export async function uniformSaveNorm(input: UniformNormInput, normId?: string): Promise<UniformNorm> {
  const path = normId ? `/api/admin/uniform/norms/${encodeURIComponent(normId)}` : '/api/admin/uniform/norms';
  return (await apiRequest<{ norm: UniformNorm }>(path, { method: normId ? 'PUT' : 'POST', body: input })).norm;
}

export function uniformSetScopeMapping(department: string, scopeId: string) {
  return apiRequest('/api/admin/uniform/scope-mapping', { method: 'PUT', body: { department, scopeId } });
}

export function uniformEmployees(
  filters: { year?: number; q?: string; department?: string; includeInactive?: boolean } = {},
  signal?: AbortSignal,
): Promise<UniformEmployeesResponse> {
  return apiRequest<UniformEmployeesResponse>(`/api/admin/uniform/employees${toQuery({ ...filters })}`, { signal });
}

export function uniformEmployeeDetail(employeeId: string, year?: number, signal?: AbortSignal): Promise<UniformEmployeeDetail> {
  return apiRequest<UniformEmployeeDetail>(`/api/admin/uniform/employees/${encodeURIComponent(employeeId)}${toQuery({ year })}`, { signal });
}

export async function uniformSaveProfile(employeeId: string, body: { gender: EmployeeGender | ''; uniformSize: string }) {
  return (await apiRequest<{ employee: UniformEmployeeRow | null }>(`/api/admin/uniform/employees/${encodeURIComponent(employeeId)}/profile`, {
    method: 'PUT',
    body,
  })).employee;
}

export function uniformHandoverContext(receiverEmployeeId: string, handoverId = '', signal?: AbortSignal): Promise<UniformHandoverContext> {
  return apiRequest<UniformHandoverContext>(`/api/admin/uniform/handover-context${toQuery({ receiverEmployeeId, handoverId })}`, { signal });
}

export type HoldingStatusFilter = 'loans' | 'overdue' | 'outstanding' | 'all';

export function uniformHoldings(
  filters: { status?: HoldingStatusFilter; employeeId?: string; q?: string } = {},
  signal?: AbortSignal,
): Promise<UniformHoldingsResponse> {
  return apiRequest<UniformHoldingsResponse>(`/api/admin/uniform/holdings${toQuery({ ...filters })}`, { signal });
}

export function uniformRecordReturn(body: {
  handoverId: string;
  itemId: string;
  quantity: number;
  result: ReturnResult;
  restockCondition: UniformCondition | '';
  reason: ReturnReason;
  note: string;
  clientRequestId: string;
}): Promise<UniformReturnResult> {
  return apiRequest<UniformReturnResult>('/api/admin/uniform/returns', { method: 'POST', body });
}
