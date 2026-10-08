import type { OtpRequestResult, PublicHandover, PublicHandoverResponse, StaffSessionInfo } from '../../shared/types';
import { apiRequest } from './api';

/** API công khai: người nhận xem / ký / yêu cầu sửa qua link; mã truy cập nội bộ (trang đề xuất VPP). */

export function staffSession(): Promise<StaffSessionInfo> {
  return apiRequest<StaffSessionInfo>('/api/staff/session');
}

export function staffLogin(code: string): Promise<StaffSessionInfo> {
  return apiRequest<StaffSessionInfo>('/api/staff/login', { method: 'POST', body: { code } });
}

export function getPublicHandover(token: string): Promise<PublicHandoverResponse> {
  return apiRequest<PublicHandoverResponse>(`/api/handover/${encodeURIComponent(token)}`);
}

/** Gửi mã xác nhận 6 số tới email người nhận (khi biên bản yêu cầu mã OTP). */
export function requestConfirmOtp(token: string): Promise<OtpRequestResult> {
  return apiRequest<OtpRequestResult>(`/api/handover/${encodeURIComponent(token)}/otp`, { method: 'POST', body: {} });
}

export async function confirmHandover(
  token: string,
  body: { agreed: true; signature: string; comment: string; contentHash: string; otp: string },
): Promise<PublicHandover> {
  const data = await apiRequest<{ handover: PublicHandover }>(`/api/handover/${encodeURIComponent(token)}/confirm`, {
    method: 'POST',
    body,
  });
  return data.handover;
}

export async function requestRevision(token: string, reason: string, contentHash: string): Promise<PublicHandover> {
  const data = await apiRequest<{ handover: PublicHandover }>(
    `/api/handover/${encodeURIComponent(token)}/request-revision`,
    { method: 'POST', body: { reason, contentHash } },
  );
  return data.handover;
}

export function publicPdfUrl(token: string): string {
  return `/api/handover/${encodeURIComponent(token)}/pdf`;
}
