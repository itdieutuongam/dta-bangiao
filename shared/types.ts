import type { HandoverStatus, ItemFieldKey } from './constants';

/** Định dạng response thống nhất của mọi API. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiEnvelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiErrorBody };

export interface Employee {
  employeeId: string;
  fullName: string;
  department: string;
  position: string;
  email: string;
}

export interface CategoryField {
  key: ItemFieldKey;
  label: string;
  required: boolean;
}

export interface Category {
  code: string;
  name: string;
  fields: CategoryField[];
  hint: string;
  sortOrder: number;
  active: boolean;
}

export interface HandoverItemInput {
  category: string;
  itemName: string;
  assetCode: string;
  serialNumber: string;
  model: string;
  quantity: number | null;
  condition: string;
  description: string;
  workStatus: string;
  deadline: string;
  documentUrl: string;
  note: string;
}

export interface HandoverItem extends HandoverItemInput {
  itemId: string;
  itemOrder: number;
}

export interface PersonRef {
  name: string;
  employeeId: string;
}

export interface ReceiverInfo {
  employeeId: string;
  name: string;
  department: string;
  position: string;
  email: string;
}

export interface HandoverInput {
  sender: PersonRef;
  receiverEmployeeId: string;
  note: string;
  items: HandoverItemInput[];
}

/** Dữ liệu biên bản người nhận được xem qua link xác nhận. */
export interface PublicHandover {
  code: string;
  status: HandoverStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
  revisionRequestedAt: string;
  cancelledAt: string;
  cancelReason: string;
  receiverComment: string;
  note: string;
  sender: PersonRef;
  receiver: ReceiverInfo;
  items: HandoverItem[];
  hasPdf: boolean;
}

export interface PublicHandoverResponse {
  handover: PublicHandover;
  categories: Category[];
}

export interface CreateHandoverResult {
  id: string;
  code: string;
  status: HandoverStatus;
  createdAt: string;
  receiver: ReceiverInfo;
  link: string;
}

export interface HistoryEntry {
  logId: string;
  action: string;
  actor: string;
  oldStatus: string;
  newStatus: string;
  message: string;
  createdAt: string;
}

export interface AdminHandoverSummary {
  id: string;
  code: string;
  status: HandoverStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
  senderName: string;
  senderEmployeeId: string;
  receiverEmployeeId: string;
  receiverName: string;
  receiverDepartment: string;
  itemCount: number;
  categories: string[];
}

export interface HandoverStats {
  total: number;
  PENDING: number;
  CONFIRMED: number;
  REVISION_REQUESTED: number;
  CANCELLED: number;
}

export interface AdminListResponse {
  items: AdminHandoverSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: HandoverStats;
  departments: string[];
}

export interface AdminHandoverDetail extends PublicHandover {
  id: string;
  signatureAvailable: boolean;
  pdfAvailable: boolean;
  confirmedUserAgent: string;
  history: HistoryEntry[];
  /** Link xác nhận khôi phục được từ nonce (null nếu không khôi phục được). */
  link: string | null;
}

export interface AdminDetailResponse {
  handover: AdminHandoverDetail;
  categories: Category[];
}

export interface AdminUpdateResponse extends AdminDetailResponse {
  linkRotated: boolean;
}

export interface SessionInfo {
  authenticated: boolean;
  expiresAt: string | null;
}

export interface StaffSessionInfo {
  required: boolean;
  authenticated: boolean;
}

export interface HealthData {
  app: string;
  cloudflare: 'ok';
  appsScript: 'ok' | 'error' | 'not_configured';
  database: 'ok' | 'error' | 'unknown';
  drive: 'ok' | 'error' | 'unknown';
  configured: {
    appsScript: boolean;
    session: boolean;
    admin: boolean;
    staffAccessCode: boolean;
  };
  time: string;
}
