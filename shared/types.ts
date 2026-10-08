import type { HandoverStatus, HandoverType, ItemFieldKey } from './constants';
import type { StockWarning, VppAlertsSummary } from './vpp';

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

/** Nhân viên trên trang quản trị "Nhân viên" (kèm trạng thái + phạm vi định mức VPP). */
export interface AdminEmployee extends Employee {
  status?: 'ACTIVE' | 'INACTIVE';
  vppScope?: { scopeId: string; scopeName: string; source: 'MAPPING' | 'AUTO' } | null;
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
  handoverType: HandoverType;
}

export interface HandoverItemInput {
  category: string;
  itemName: string;
  assetCode: string;
  serialNumber: string;
  model: string;
  quantity: number | null;
  unit: string;
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
  productId: string;
  affectsInventory: boolean;
  /** Chỉ có ở trang quản trị. */
  overNormReason?: string;
}

/** Một dòng văn phòng phẩm khi tạo / sửa phiếu OFFICE_SUPPLY (tên, ĐVT do hệ thống lấy từ danh mục). */
export interface SupplyLineInput {
  productId: string;
  quantity: number;
  note: string;
  overNormReason: string;
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
  handoverType: HandoverType;
  sender: PersonRef;
  receiverEmployeeId: string;
  note: string;
  items: HandoverItemInput[];
  supplies: SupplyLineInput[];
  /** Mã chống gửi trùng do trình duyệt sinh (UUID). */
  clientRequestId?: string;
}

/** Dữ liệu biên bản người nhận được xem qua link xác nhận. */
export interface PublicHandover {
  code: string;
  handoverType: HandoverType;
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
  /** SHA-256 nội dung người nhận đang xem — phải gửi lại khi ký / yêu cầu sửa. */
  contentHash: string;
  /** Mã xác nhận qua email khi ký (CAU_HINH.CONFIRM_OTP). Chỉ có ý nghĩa khi phiếu đang chờ ký. */
  otp: ConfirmOtpInfo;
  /** Lần lưu sửa phiếu của quản trị viên chưa hoàn tất (lỗi giữa chừng) — chưa ký / yêu cầu sửa được cho tới khi lưu lại xong. */
  updating?: boolean;
}

export interface ConfirmOtpInfo {
  /** Phải nhập mã 6 số gửi tới email người nhận. */
  required: boolean;
  /** Bắt buộc có mã nhưng người nhận chưa có email → không ký được cho tới khi quản trị viên bổ sung email. */
  blocked: boolean;
  /** Email nhận mã, đã che (d***@domain). */
  emailMasked: string;
}

/** Kết quả POST /api/handover/:token/otp. */
export interface OtpRequestResult {
  sent: boolean;
  emailMasked: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/** Cách người nhận đã xác thực khi ký (BAN_GIAO.confirm_method; rỗng với phiếu ký trước v2). */
export type ConfirmMethod = 'OTP_EMAIL' | 'NO_EMAIL' | 'OTP_OFF' | '';

export interface PublicHandoverResponse {
  handover: PublicHandover;
  categories: Category[];
}

export interface CreateHandoverResult {
  id: string;
  code: string;
  status: HandoverStatus;
  handoverType: HandoverType;
  createdAt: string;
  receiver: ReceiverInfo;
  link: string;
  warnings: StockWarning[];
  duplicate?: boolean;
  /** Người nhận có phải nhập mã OTP khi ký không; email đầy đủ (chỉ trả cho quản trị viên). */
  confirmOtp: { required: boolean; blocked: boolean; email: string };
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
  handoverType: HandoverType;
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

/** Toàn vẹn của biên bản đã ký: nội dung hiện tại có khớp mã băm lưu lúc ký không. */
export interface IntegrityInfo {
  status: 'OK' | 'MISMATCH' | 'LEGACY' | 'NOT_SIGNED';
  contentHash: string;
  signatureSha256: string;
  /**
   * Từng phần so với lúc ký (chỉ có khi đã ký): content = nội dung bàn giao; record = toàn biên bản (ý kiến người nhận, thời
   * điểm lập / ký, chữ ký — null: ký trước khi có mã này); seal = niêm phong bằng RECORD_SEAL_SECRET (NONE: ký khi chưa cấu
   * hình; UNVERIFIED: có niêm phong nhưng Worker hiện không có khóa để kiểm tra).
   */
  checks?: { content: boolean; record: boolean | null; seal: 'OK' | 'MISMATCH' | 'UNVERIFIED' | 'NONE' } | null;
}

export interface AdminHandoverDetail extends PublicHandover {
  id: string;
  signatureAvailable: boolean;
  pdfAvailable: boolean;
  confirmedUserAgent: string;
  createdBy: string;
  confirmMethod: ConfirmMethod;
  vppScopeId: string;
  integrity: IntegrityInfo;
  /** Thời điểm lần lưu sửa phiếu bị lỗi giữa chừng ('' = không có): người nhận chưa ký được cho tới khi lưu lại xong. */
  editPendingSince?: string;
  /** Người nhận ký trên cùng thiết bị + mạng với lúc tạo phiếu (cảnh báo, không chặn). */
  confirmedFromCreatorDevice: boolean;
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
  warnings: StockWarning[];
}

export interface AdminOverview {
  stats: HandoverStats;
  revisionRequested: Array<{ id: string; code: string; receiverName: string; receiverComment: string; revisionRequestedAt: string }>;
  recent: AdminHandoverSummary[];
  vpp: VppAlertsSummary;
  notify: NotifyStatus;
}

/** Kết quả gửi gần nhất của một loại email. */
export interface NotifyChannelStatus {
  lastOkAt: string;
  /** Lỗi gửi gần nhất — chỉ còn khi chưa có lần gửi thành công CÙNG LOẠI sau đó. */
  lastError: { at: string; event: string; message: string } | null;
}

/**
 * Trạng thái email — Script Property NOTIFY_STATUS + CAU_HINH. Hai loại tách riêng: mã OTP gửi được không có nghĩa
 * email thông báo cho quản trị viên đang hoạt động (có thể đang tạm dừng vì để dành hạn mức cho OTP) và ngược lại.
 */
export interface NotifyStatus {
  /** Số địa chỉ hợp lệ trong CAU_HINH.NOTIFY_EMAILS (0 = chưa bật thông báo). */
  recipients: number;
  otpMode: 'EMAIL' | 'REQUIRED' | 'OFF';
  /** Email thông báo cho quản trị viên (NOTIFY_EMAILS, tổng hợp hằng ngày, gửi thử). */
  notify: NotifyChannelStatus;
  /** Email mã xác nhận gửi người nhận khi ký. */
  otp: NotifyChannelStatus;
}

/** Số việc cần xử lý hiện trên menu quản trị. */
export interface AdminBadges {
  revisionRequested: number;
  submittedProposals: number;
}

export interface AdminUser {
  username: string;
  name: string;
}

export type AdminLoginMode = 'users' | 'shared';

export interface SessionInfo {
  authenticated: boolean;
  expiresAt: string | null;
  user?: AdminUser;
  mode?: AdminLoginMode;
  warnings?: string[];
}

export interface StaffSessionInfo {
  required: boolean;
  authenticated: boolean;
}

export interface HealthData {
  app: string;
  version: string;
  cloudflare: 'ok';
  appsScript: 'ok' | 'error' | 'not_configured';
  database: 'ok' | 'error' | 'unknown';
  drive: 'ok' | 'error' | 'unknown';
  configured: {
    appsScript: boolean;
    session: boolean;
    admin: boolean;
  };
  time: string;
}

/** Trang Cài đặt (admin). */
export interface SystemInfo {
  worker: {
    version: string;
    appBaseUrl: string;
    loginMode: AdminLoginMode;
    adminUsers: number;
    staffAccessCode: boolean;
    rateLimitBindings: boolean;
    /** Đã cấu hình RECORD_SEAL_SECRET (niêm phong biên bản đã ký). */
    recordSeal: boolean;
  };
  appsScript: {
    version: string;
    schemaVersion: number;
    requiredSchemaVersion: number;
    schemaReady: boolean;
    sheets: Array<{ name: string; exists: boolean; rows: number }>;
    spreadsheetName: string;
    spreadsheetUrl: string;
    driveFolderUrl: string;
    pendingChanges: string[];
    notify: NotifyStatus & {
      /** Hạn mức gửi mail còn lại hôm nay (null: chưa dùng được MailApp). */
      mailQuotaRemaining: number | null;
      mailError: string;
    };
  } | null;
  appsScriptError: string | null;
  warnings: string[];
}
