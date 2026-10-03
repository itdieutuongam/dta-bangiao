// Hằng số dùng chung giữa React frontend và Cloudflare Worker.
// Apps Script có bản sao tương ứng trong apps-script/Config.gs — giữ đồng bộ khi sửa.

export const APP_ID = 'dta-handover';
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

export const ITEM_FIELD_KEYS = [
  'itemName',
  'assetCode',
  'serialNumber',
  'model',
  'quantity',
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
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
