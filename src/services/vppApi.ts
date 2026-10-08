import type {
  CatalogStatus,
  DataReviewResponse,
  EmployeeLookupResponse,
  MovementListResponse,
  ProposalDetail,
  ProposalListResponse,
  ProposalSubmitResult,
  PublicCatalogProduct,
  StockInReason,
  VppDashboard,
  VppHandoverContext,
  VppNorm,
  VppNormsResponse,
  VppProduct,
} from '../../shared/vpp';
import { toQuery } from './adminApi';
import { apiRequest } from './api';

// ---------------------------------------------------------------- Quản trị

export function vppDashboard(): Promise<VppDashboard> {
  return apiRequest<VppDashboard>('/api/admin/vpp/dashboard');
}

export async function vppProducts(filters: { q?: string; stockStatus?: string; catalogStatus?: string; includeArchived?: boolean } = {}) {
  return (await apiRequest<{ products: VppProduct[] }>(`/api/admin/vpp/products${toQuery({ ...filters })}`)).products;
}

export interface ProductFormInput {
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  referencePrice: number | null;
  minimumStock: number;
  note: string;
  catalogStatus?: CatalogStatus;
  active: boolean;
  /** Chỉ gửi khi TẠO: gửi lại cùng mã (mạng chập chờn, bấm lại) → máy chủ trả sản phẩm đã tạo, không tạo trùng. */
  clientRequestId?: string;
}

/**
 * Kết quả thêm sản phẩm / nhập kho / kiểm kê. duplicate: máy chủ nhận ra thao tác (cùng mã) ĐÃ được ghi ở lần gửi trước — lần
 * đó mất phản hồi — nên KHÔNG ghi thêm; product là số liệu hiện tại.
 */
export interface ProductWriteResult {
  product: VppProduct;
  duplicate: boolean;
}

async function productWrite(path: string, method: 'POST' | 'PUT', body: unknown): Promise<ProductWriteResult> {
  const data = await apiRequest<{ product: VppProduct; duplicate?: boolean }>(path, { method, body });
  return { product: data.product, duplicate: data.duplicate === true };
}

export function vppSaveProduct(input: ProductFormInput, productId?: string): Promise<ProductWriteResult> {
  const path = productId ? `/api/admin/vpp/products/${encodeURIComponent(productId)}` : '/api/admin/vpp/products';
  return productWrite(path, productId ? 'PUT' : 'POST', input);
}

export function vppNorms(): Promise<VppNormsResponse> {
  return apiRequest<VppNormsResponse>('/api/admin/vpp/norms');
}

export interface NormFormInput {
  productId: string;
  scopeId: string;
  scopeName: string;
  monthlyQuantity: number;
  unit: string;
  referencePrice: number | null;
  note: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
}

export async function vppSaveNorm(input: NormFormInput, normId?: string): Promise<VppNorm> {
  const path = normId ? `/api/admin/vpp/norms/${encodeURIComponent(normId)}` : '/api/admin/vpp/norms';
  return (await apiRequest<{ norm: VppNorm }>(path, { method: normId ? 'PUT' : 'POST', body: input })).norm;
}

export function vppSetScopeMapping(department: string, scopeId: string) {
  return apiRequest('/api/admin/vpp/scope-mapping', { method: 'PUT', body: { department, scopeId } });
}

export function vppStockIn(input: {
  productId: string;
  quantity: number;
  reasonType: StockInReason;
  unitPrice: number | null;
  date: string;
  note: string;
  clientRequestId: string;
}): Promise<ProductWriteResult> {
  return productWrite('/api/admin/vpp/stock/in', 'POST', input);
}

export function vppStockAdjust(input: { productId: string; countedQuantity: number; reason: string; clientRequestId: string }): Promise<ProductWriteResult> {
  return productWrite('/api/admin/vpp/stock/adjust', 'POST', input);
}

export function vppMovements(filters: { page?: number; pageSize?: number; productId?: string; type?: string; from?: string; to?: string; q?: string }) {
  return apiRequest<MovementListResponse>(`/api/admin/vpp/movements${toQuery({ ...filters })}`);
}

export function vppHandoverContext(receiverEmployeeId: string, handoverId = ''): Promise<VppHandoverContext> {
  return apiRequest<VppHandoverContext>(`/api/admin/vpp/handover-context${toQuery({ receiverEmployeeId, handoverId })}`);
}

export function vppProposals(filters: { page?: number; pageSize?: number; status?: string; q?: string }) {
  return apiRequest<ProposalListResponse>(`/api/admin/vpp/proposals${toQuery({ ...filters })}`);
}

export function vppProposal(id: string): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(`/api/admin/vpp/proposals/${encodeURIComponent(id)}`);
}

export function vppApproveProposal(
  id: string,
  body: { decisions: Array<{ proposalItemId: string; approvedQuantity: number; approvedPrice: number | null }>; adminNote: string },
): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(`/api/admin/vpp/proposals/${encodeURIComponent(id)}/approve`, { method: 'POST', body });
}

export function vppRejectProposal(id: string, reason: string): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(`/api/admin/vpp/proposals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } });
}

export function vppProposalStatus(id: string, action: 'purchased' | 'close', note = ''): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(`/api/admin/vpp/proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { note } });
}

export function vppReceiveProposal(
  id: string,
  body: { lines: Array<{ proposalItemId: string; receivedQuantity: number; unitPrice: number | null }>; receivedDate: string; note: string },
): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(`/api/admin/vpp/proposals/${encodeURIComponent(id)}/receive`, { method: 'POST', body });
}

export interface ProductDecisionInput {
  decision: 'MASTER' | 'TEMP' | 'REJECT' | 'MAP';
  productCode?: string;
  productName?: string;
  category?: string;
  unit?: string;
  referencePrice?: number | null;
  minimumStock?: number;
  note?: string;
  targetProductId?: string;
  norm?: { scopeId: string; scopeName: string; monthlyQuantity: number; note: string } | null;
  /**
   * ĐVT mới của dòng khác ĐVT đề xuất (GHÉP sang sản phẩm khác ĐVT, hoặc thêm vào danh mục / giữ tạm với ĐVT khác): số lượng đề xuất
   * đã quy đổi sang ĐVT mới + xác nhận đã quy đổi.
   */
  convertedQuantity?: number | null;
  unitConverted?: boolean;
}

export function vppProductDecision(id: string, itemId: string, body: ProductDecisionInput): Promise<ProposalDetail> {
  return apiRequest<ProposalDetail>(
    `/api/admin/vpp/proposals/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/decision`,
    { method: 'POST', body },
  );
}

export function vppDataReview(): Promise<DataReviewResponse> {
  return apiRequest<DataReviewResponse>('/api/admin/vpp/data-review');
}

/** Kết quả GHÉP: định mức đang bật của sản phẩm nguồn — chuyển sang sản phẩm đích / ngừng áp dụng (tên phạm vi). */
export interface MergeResult {
  merged: boolean;
  target: VppProduct;
  norms: { moved: string[]; deactivated: string[] };
}

export function vppMergeProduct(body: {
  sourceProductId: string;
  targetProductId: string;
  quantity: number | null;
  /** Đã quy đổi số lượng sang ĐVT sản phẩm đích (bắt buộc khi ĐVT khác nhau / nguồn chưa có ĐVT). */
  unitConverted: boolean;
  reason: string;
}): Promise<MergeResult> {
  return apiRequest<MergeResult>('/api/admin/vpp/data-review/merge', { method: 'POST', body });
}

/** Đồng bộ số tồn của một sản phẩm theo sổ biến động (mục "Tồn kho lệch sổ"). */
export function vppSyncStock(productId: string) {
  return apiRequest<{ synced: boolean; product: VppProduct }>('/api/admin/vpp/data-review/sync-stock', { method: 'POST', body: { productId } });
}

export function vppPromoteProduct(body: ProductFormInput & { productId: string; norm: ProductDecisionInput['norm'] }) {
  return apiRequest<{ product: VppProduct }>('/api/admin/vpp/data-review/promote', { method: 'POST', body });
}

export function vppSkipReview(productId: string) {
  return apiRequest('/api/admin/vpp/data-review/skip', { method: 'POST', body: { productId } });
}

// ---------------------------------------------------------------- Công khai (/de-xuat-vpp)

export function vppLookupEmployee(employeeId: string): Promise<EmployeeLookupResponse> {
  return apiRequest<EmployeeLookupResponse>('/api/public/vpp/employee-lookup', { method: 'POST', body: { employeeId } });
}

export async function vppPublicCatalog(): Promise<PublicCatalogProduct[]> {
  return (await apiRequest<{ products: PublicCatalogProduct[] }>('/api/public/vpp/catalog')).products;
}

export interface ProposalItemInput {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  reason: string;
  referenceUrl: string;
  note: string;
}

export function vppSubmitProposal(body: { employeeId: string; reason: string; items: ProposalItemInput[]; clientRequestId: string }) {
  return apiRequest<ProposalSubmitResult>('/api/public/vpp/proposals', { method: 'POST', body });
}
