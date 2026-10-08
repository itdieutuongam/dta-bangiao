import type {
  AdminBadges,
  AdminDetailResponse,
  AdminEmployee,
  AdminListResponse,
  AdminOverview,
  AdminUpdateResponse,
  Category,
  CreateHandoverResult,
  Employee,
  HandoverInput,
  SessionInfo,
  SystemInfo,
} from '../../shared/types';
import type { StockWarning } from '../../shared/vpp';
import { apiRequest, downloadFile } from './api';

export interface AdminFilters {
  page?: number;
  pageSize?: number;
  code?: string;
  employeeName?: string;
  employeeId?: string;
  sender?: string;
  receiver?: string;
  department?: string;
  category?: string;
  handoverType?: string;
  status?: string;
  from?: string;
  to?: string;
}

/** Ghép query string, bỏ giá trị rỗng. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function adminLogin(password: string, username = ''): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/login', { method: 'POST', body: { username, password } });
}

export function adminLogout(): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/logout', { method: 'POST', body: {} });
}

export function adminMe(): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/me');
}

export function adminOverview(): Promise<AdminOverview> {
  return apiRequest<AdminOverview>('/api/admin/overview');
}

export function adminBadges(): Promise<AdminBadges> {
  return apiRequest<AdminBadges>('/api/admin/badges');
}

export type ExportDataset = 'handovers' | 'stock' | 'movements' | 'proposals';

export interface ExportResult {
  rows: number;
  total: number;
  truncated: boolean;
}

/**
 * Tải CSV theo đúng bộ lọc đang xem (chỉ admin). truncated = true: nhiều hơn giới hạn 1 lần xuất (5.000 dòng) —
 * giao diện nhắc lọc theo khoảng ngày để xuất phần còn lại.
 */
export async function adminExportCsv(dataset: ExportDataset, filters: Record<string, unknown>): Promise<ExportResult> {
  const query = toQuery({ ...filters, page: undefined, pageSize: undefined });
  const headers = await downloadFile(`/api/admin/export/${dataset}.csv${query}`, `${dataset}.csv`);
  return {
    rows: Number(headers.get('X-Export-Rows') ?? 0),
    total: Number(headers.get('X-Export-Total') ?? 0),
    truncated: headers.get('X-Export-Truncated') === '1',
  };
}

export function adminSystem(): Promise<SystemInfo> {
  return apiRequest<SystemInfo>('/api/admin/system');
}

export async function adminEmployees(): Promise<Employee[]> {
  return (await apiRequest<{ employees: Employee[] }>('/api/admin/employees')).employees;
}

export async function adminAllEmployees(): Promise<AdminEmployee[]> {
  return (await apiRequest<{ employees: AdminEmployee[] }>('/api/admin/employees?all=1')).employees;
}

export async function adminCategories(): Promise<Category[]> {
  return (await apiRequest<{ categories: Category[] }>('/api/admin/categories')).categories;
}

export function adminListHandovers(filters: AdminFilters): Promise<AdminListResponse> {
  return apiRequest<AdminListResponse>(`/api/admin/handovers${toQuery({ ...filters })}`);
}

export function adminCreateHandover(input: HandoverInput): Promise<CreateHandoverResult> {
  return apiRequest<CreateHandoverResult>('/api/admin/handovers', { method: 'POST', body: input });
}

export function adminGetHandover(id: string): Promise<AdminDetailResponse> {
  return apiRequest<AdminDetailResponse>(`/api/admin/handovers/${encodeURIComponent(id)}`);
}

/**
 * expectedContentHash = contentHash của phiếu lúc mở trang sửa: người khác đã lưu bản sửa trong lúc đó → máy chủ trả
 * 409 CONFLICT thay vì ghi đè.
 */
export function adminUpdateHandover(id: string, input: HandoverInput, expectedContentHash: string): Promise<AdminUpdateResponse> {
  return apiRequest<AdminUpdateResponse>(`/api/admin/handovers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { ...input, expectedContentHash },
  });
}

export function adminCancelHandover(id: string, reason: string): Promise<AdminDetailResponse> {
  return apiRequest<AdminDetailResponse>(`/api/admin/handovers/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

export function adminRegenerateLink(id: string): Promise<{ link: string }> {
  return apiRequest<{ link: string }>(`/api/admin/handovers/${encodeURIComponent(id)}/regenerate-link`, {
    method: 'POST',
    body: {},
  });
}

export function adminRegeneratePdf(id: string): Promise<{ pdfAvailable: boolean }> {
  return apiRequest<{ pdfAvailable: boolean }>(`/api/admin/handovers/${encodeURIComponent(id)}/pdf`, {
    method: 'POST',
    body: {},
  });
}

export function adminReconcileStock(id: string): Promise<{ reconciled: boolean; warnings: StockWarning[] }> {
  return apiRequest(`/api/admin/handovers/${encodeURIComponent(id)}/reconcile-stock`, { method: 'POST', body: {} });
}

export function adminRefreshCache(): Promise<{ employees: number; categories: number }> {
  return apiRequest<{ employees: number; categories: number }>('/api/admin/cache/refresh', { method: 'POST', body: {} });
}

export function adminPdfUrl(id: string): string {
  return `/api/admin/handovers/${encodeURIComponent(id)}/pdf`;
}

export function adminSignatureUrl(id: string): string {
  return `/api/admin/handovers/${encodeURIComponent(id)}/signature`;
}
