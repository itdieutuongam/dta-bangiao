import type {
  Category,
  CreateHandoverResult,
  Employee,
  HandoverInput,
  PublicHandover,
  PublicHandoverResponse,
  StaffSessionInfo,
} from '../../shared/types';
import { apiRequest } from './api';

export async function getEmployees(): Promise<Employee[]> {
  return (await apiRequest<{ employees: Employee[] }>('/api/employees')).employees;
}

export async function getCategories(): Promise<Category[]> {
  return (await apiRequest<{ categories: Category[] }>('/api/categories')).categories;
}

export function staffLogin(code: string): Promise<StaffSessionInfo> {
  return apiRequest<StaffSessionInfo>('/api/staff/login', { method: 'POST', body: { code } });
}

export function createHandover(input: HandoverInput): Promise<CreateHandoverResult> {
  return apiRequest<CreateHandoverResult>('/api/handover', { method: 'POST', body: input });
}

export function getPublicHandover(token: string): Promise<PublicHandoverResponse> {
  return apiRequest<PublicHandoverResponse>(`/api/handover/${encodeURIComponent(token)}`);
}

export async function confirmHandover(
  token: string,
  body: { agreed: true; signature: string; comment: string },
): Promise<PublicHandover> {
  const data = await apiRequest<{ handover: PublicHandover }>(`/api/handover/${encodeURIComponent(token)}/confirm`, {
    method: 'POST',
    body,
  });
  return data.handover;
}

export async function requestRevision(token: string, reason: string): Promise<PublicHandover> {
  const data = await apiRequest<{ handover: PublicHandover }>(
    `/api/handover/${encodeURIComponent(token)}/request-revision`,
    { method: 'POST', body: { reason } },
  );
  return data.handover;
}

export function publicPdfUrl(token: string): string {
  return `/api/handover/${encodeURIComponent(token)}/pdf`;
}
