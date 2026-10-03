import type {
  AdminDetailResponse,
  AdminListResponse,
  AdminUpdateResponse,
  HandoverInput,
  SessionInfo,
} from '../../shared/types';
import { apiRequest } from './api';

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
  status?: string;
  from?: string;
  to?: string;
}

export function adminLogin(password: string): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/login', { method: 'POST', body: { password } });
}

export function adminLogout(): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/logout', { method: 'POST', body: {} });
}

export function adminMe(): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/admin/me');
}

export function adminListHandovers(filters: AdminFilters): Promise<AdminListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return apiRequest<AdminListResponse>(`/api/admin/handovers${query ? `?${query}` : ''}`);
}

export function adminGetHandover(id: string): Promise<AdminDetailResponse> {
  return apiRequest<AdminDetailResponse>(`/api/admin/handovers/${encodeURIComponent(id)}`);
}

export function adminUpdateHandover(id: string, input: HandoverInput): Promise<AdminUpdateResponse> {
  return apiRequest<AdminUpdateResponse>(`/api/admin/handovers/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
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

export function adminRefreshCache(): Promise<{ employees: number; categories: number }> {
  return apiRequest<{ employees: number; categories: number }>('/api/admin/cache/refresh', { method: 'POST', body: {} });
}

export function adminPdfUrl(id: string): string {
  return `/api/admin/handovers/${encodeURIComponent(id)}/pdf`;
}

export function adminSignatureUrl(id: string): string {
  return `/api/admin/handovers/${encodeURIComponent(id)}/signature`;
}
