// Hằng số dùng chung giữa React frontend và Cloudflare Worker.
// Apps Script có bản sao tương ứng trong apps-script/Config.gs — giữ đồng bộ khi sửa.

export const APP_ID = 'dta-handover';
/** Phiên bản ứng dụng — trùng APP.VERSION trong apps-script/Config.gs (trang Cài đặt cảnh báo nếu lệch). */
export const APP_VERSION = '2.0.0';
export const APP_TITLE = 'HỆ THỐNG BÀN GIAO NỘI BỘ – DIỆU TƯỚNG AM';
export const ORG_NAME = 'DIỆU TƯỚNG AM';
export const TIMEZONE = 'Asia/Ho_Chi_Minh';

export const HANDOVER_STATUSES = ['PENDING', 'CONFIRMED', 'REVISION_REQUESTED', 'CANCELLED'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export const STATUS_LABELS: Record<HandoverStatus, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  REVISION_REQUESTED: 'Yêu cầu chỉnh sửa',
  CANCELLED: 'Đã hủy',
};

/** Trạng thái cho phép sửa / hủy biên bản. */
export const EDITABLE_STATUSES: readonly HandoverStatus[] = ['PENDING', 'REVISION_REQUESTED'];

export function isEditableStatus(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** Loại phiếu bàn giao — bước đầu tiên khi admin tạo phiếu. */
export const HANDOVER_TYPES = ['ASSET', 'OFFICE_SUPPLY', 'ACCOUNT', 'DOCUMENT', 'WORK', 'OTHER'] as const;
export type HandoverType = (typeof HANDOVER_TYPES)[number];

export const HANDOVER_TYPE_LABELS: Record<HandoverType, string> = {
  ASSET: 'Thiết bị / tài sản',
  OFFICE_SUPPLY: 'Văn phòng phẩm',
  ACCOUNT: 'Tài khoản',
  DOCUMENT: 'Hồ sơ',
  WORK: 'Công việc',
  OTHER: 'Khác',
};

export const HANDOVER_TYPE_HINTS: Record<HandoverType, string> = {
  ASSET: 'Laptop, máy tính, điện thoại, thẻ, tài sản có mã / serial',
  OFFICE_SUPPLY: 'Chọn sản phẩm từ kho — tự giữ chỗ và trừ tồn khi người nhận ký',
  ACCOUNT: 'Tài khoản email, phần mềm, hệ thống (không ghi mật khẩu)',
  DOCUMENT: 'Hồ sơ, giấy tờ, chứng từ, nơi lưu',
  WORK: 'Công việc, dự án, tình trạng, hạn hoàn thành, tài liệu',
  OTHER: 'Nội dung khác hoặc gộp nhiều loại trong một phiếu',
};

/** Loại nội dung dành riêng cho văn phòng phẩm (chỉ dùng trong phiếu OFFICE_SUPPLY). */
export const VPP_CATEGORY_CODE = 'VAN_PHONG_PHAM';

export const ITEM_FIELD_KEYS = [
  'itemName',
  'assetCode',
  'serialNumber',
  'model',
  'quantity',
  'unit',
  'condition',
  'description',
  'workStatus',
  'deadline',
  'documentUrl',
  'note',
] as const;
export type ItemFieldKey = (typeof ITEM_FIELD_KEYS)[number];

export type ItemFieldKind = 'text' | 'textarea' | 'number' | 'date' | 'url';

/** Kiểu input + nhãn mặc định của từng cột trong sheet CHI_TIET_BAN_GIAO. */
export const ITEM_FIELD_META: Record<ItemFieldKey, { column: string; label: string; kind: ItemFieldKind; max: number }> = {
  itemName: { column: 'item_name', label: 'Tên', kind: 'text', max: 200 },
  assetCode: { column: 'asset_code', label: 'Mã', kind: 'text', max: 120 },
  serialNumber: { column: 'serial_number', label: 'Serial', kind: 'text', max: 120 },
  model: { column: 'model', label: 'Model', kind: 'text', max: 120 },
  quantity: { column: 'quantity', label: 'Số lượng', kind: 'number', max: 100_000 },
  unit: { column: 'unit', label: 'ĐVT', kind: 'text', max: 40 },
  condition: { column: 'condition', label: 'Tình trạng', kind: 'text', max: 120 },
  description: { column: 'description', label: 'Mô tả', kind: 'textarea', max: 2000 },
  workStatus: { column: 'work_status', label: 'Tình trạng công việc', kind: 'text', max: 500 },
  deadline: { column: 'deadline', label: 'Hạn hoàn thành', kind: 'date', max: 10 },
  documentUrl: { column: 'document_url', label: 'Link tài liệu', kind: 'url', max: 500 },
  note: { column: 'note', label: 'Ghi chú', kind: 'textarea', max: 1000 },
};

export const LIMITS = {
  personName: 120,
  employeeId: 50,
  handoverNote: 2000,
  receiverComment: 1000,
  revisionReasonMin: 5,
  cancelReason: 500,
  maxItems: 50,
  maxQuantity: 100_000,
  overNormReason: 500,
  productName: 200,
  productCode: 40,
  productCategory: 80,
  unit: 40,
  maxPrice: 1_000_000_000,
  proposalReason: 1000,
  proposalItemText: 500,
  stockReason: 500,
  url: 500,
  /** Dung lượng tối đa ảnh chữ ký PNG (bytes) sau khi decode. */
  signatureMaxBytes: 300 * 1024,
  signatureMaxWidth: 1200,
  signatureMaxHeight: 600,
  /** Kích thước ảnh chữ ký frontend xuất ra. */
  signatureExportWidth: 600,
  signatureExportHeight: 300,
} as const;

/** Token trong link xác nhận: 32 bytes base64url (43 ký tự). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CATEGORY_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CONDITION_SUGGESTIONS = ['Mới', 'Tốt', 'Bình thường', 'Đã qua sử dụng', 'Trầy xước nhẹ', 'Hư hỏng'];
export const WORK_STATUS_SUGGESTIONS = ['Chưa bắt đầu', 'Đang thực hiện', 'Tạm dừng', 'Gần hoàn thành', 'Đã hoàn thành'];

/** Mã lỗi API thống nhất. */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  STAFF_AUTH_REQUIRED: 'STAFF_AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  ALREADY_CONFIRMED: 'ALREADY_CONFIRMED',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EMPLOYEE_NOT_FOUND: 'EMPLOYEE_NOT_FOUND',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  NORM_EXCEEDED: 'NORM_EXCEEDED',
  INTEGRITY_ERROR: 'INTEGRITY_ERROR',
  OTP_REQUIRED: 'OTP_REQUIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  MAIL_ERROR: 'MAIL_ERROR',
} as const;

/** Độ dài mã xác nhận gửi qua email khi người nhận ký. */
export const OTP_LENGTH = 6;

/**
 * Email thông báo cho quản trị viên tạm dừng khi hạn mức gửi trong ngày còn dưới mức này (dành cho mã OTP).
 * Trùng APP.MAIL_RESERVE_FOR_OTP trong apps-script/Config.gs.
 */
export const MAIL_RESERVE_FOR_OTP = 20;

/** Loại email (NOTIFY_STATUS.lastError.event) — hiển thị trên trang quản trị. */
export const NOTIFY_EVENT_LABELS: Record<string, string> = {
  OTP: 'mã xác nhận khi ký',
  REVISION_REQUESTED: 'báo yêu cầu chỉnh sửa',
  PROPOSAL_SUBMITTED: 'báo đề xuất mua mới',
  STOCK_SYNC_FAILED: 'báo cần đối soát kho',
  DAILY_DIGEST: 'email tổng hợp hằng ngày',
  TEST: 'email gửi thử',
};
