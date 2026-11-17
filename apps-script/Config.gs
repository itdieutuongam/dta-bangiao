/**
 * =============================================================================
 *  DTA HANDOVER – Google Apps Script backend
 *  Config.gs — hằng số cấu hình. TUYỆT ĐỐI KHÔNG đặt secret trong file này.
 *
 *  Secret và ID được lưu trong Script Properties
 *  (Project Settings ⚙ → Script properties):
 *
 *    BACKEND_SHARED_SECRET  (bắt buộc) trùng giá trị GAS_SHARED_SECRET bên Cloudflare
 *    SPREADSHEET_ID         ID Google Sheet. Tự điền khi chạy setupDatabase() trong
 *                           script gắn với Sheet (Extensions → Apps Script)
 *    DRIVE_FOLDER_ID        ID thư mục Drive gốc. setupDatabase() tự tạo "DTA_HANDOVER"
 *                           trong My Drive nếu để trống
 *    USE_ADVANCED_DRIVE     "true" nếu thư mục nằm trên Shared Drive và đã bật
 *                           Advanced Drive Service (Drive API v3) — tùy chọn
 *
 *  Các file chỉ khai báo function / hằng số dạng literal — không có code chạy
 *  ở top-level phụ thuộc file khác, nên thứ tự file trong project không quan trọng.
 * =============================================================================
 */

var APP = {
  NAME: 'dta-handover',
  VERSION: '2.1.0',
  // Phiên bản cấu trúc dữ liệu. Code cần cột/sheet mới chỉ chạy khi Script Property SCHEMA_VERSION >= giá trị này
  // (do setupDatabase() / upgradeUniformModule() đặt sau khi nâng cấp xong). v3 = module Đồng phục.
  SCHEMA_VERSION: 3,
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  // Việt Nam không áp dụng giờ mùa hè → offset cố định.
  TZ_OFFSET: '+07:00',
  CODE_PREFIX: 'BG',
  PROPOSAL_CODE_PREFIX: 'DX',
  // Request từ Worker lệch thời gian quá 5 phút bị từ chối.
  REQUEST_MAX_SKEW_MS: 5 * 60 * 1000,
  REPLAY_TTL_SECONDS: 15 * 60,
  LOCK_WAIT_MS: 25000,
  CACHE_TTL_SECONDS: 10 * 60,
  // CacheService giữ một giá trị tối đa 6 giờ (giới hạn theo tài liệu Apps Script) — không xin thời hạn dài hơn.
  CACHE_MAX_TTL_SECONDS: 6 * 60 * 60,
  // Mỗi nhân viên gửi tối đa ngần này đề xuất mua văn phòng phẩm mỗi ngày (đếm từ sheet VPP_DE_XUAT, giờ Việt Nam).
  PROPOSALS_PER_EMPLOYEE_PER_DAY: 10,
  // CacheService giới hạn 100KB/giá trị → chia nhỏ JSON (ký tự tiếng Việt tối đa 3 byte).
  CACHE_CHUNK_CHARS: 25000,
  SIGNATURE_MAX_BYTES: 300 * 1024,
  MAX_ITEMS: 50,
  MAX_REQUEST_CHARS: 2 * 1024 * 1024,
  DRIVE_ROOT_NAME: 'DTA_HANDOVER',
  SAMPLE_EMPLOYEE_PREFIX: 'DEMO-',
  VPP_PRODUCT_CODE_PREFIX: 'VPP-',
  // Phiếu nhập kho NK-YYYYMMDD-NNNN / phiếu xuất kho XK-YYYYMMDD-NNNN (văn phòng phẩm, v2.1).
  VPP_RECEIPT_CODE_PREFIX: 'NK',
  VPP_ISSUE_CODE_PREFIX: 'XK',
  // Mã mẫu đồng phục DP-001… ; mặt hàng = <mã mẫu>-<size>[-CU] (CU = đã qua sử dụng).
  DP_MODEL_CODE_PREFIX: 'DP-',
  // Số ngày trước hạn trả được coi là "sắp đến hạn" (trang Mượn / Trả).
  DP_DUE_SOON_DAYS: 7,
  // Mã OTP khi người nhận ký (gửi qua email): hiệu lực, số lần nhập sai, chống gửi dồn dập
  // (gửi lại sau 60 giây; tối đa 3 lần / 15 phút; tối đa 10 lần / phiếu, đếm lại sau 6 giờ không gửi — giới hạn của CacheService).
  OTP_TTL_SECONDS: 10 * 60,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_SECONDS: 60,
  OTP_MAX_SENDS: 3,
  OTP_SEND_WINDOW_SECONDS: 15 * 60,
  OTP_MAX_SENDS_TOTAL: 10,
  OTP_SEND_STATE_SECONDS: 6 * 60 * 60,
  // Số mã gần nhất còn dùng được cùng lúc: gửi lại mã (kể cả khi gửi lỗi) không làm mất mã đã nằm trong hộp thư.
  OTP_KEEP_CODES: 2,
  MAIL_SENDER_NAME: 'DTA Handover',
  // Email thông báo cho quản trị viên tạm dừng khi hạn mức gửi trong ngày còn dưới mức này (dành cho mã OTP).
  MAIL_RESERVE_FOR_OTP: 20,
  // Xuất CSV từ trang quản trị: tối đa số dòng mỗi lần (lọc theo ngày nếu nhiều hơn).
  EXPORT_MAX_ROWS: 5000
};

var PROP = {
  SHARED_SECRET: 'BACKEND_SHARED_SECRET',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',
  USE_ADVANCED_DRIVE: 'USE_ADVANCED_DRIVE',
  HANDOVER_SEQ: 'HANDOVER_SEQ',
  PROPOSAL_SEQ: 'VPP_PROPOSAL_SEQ',
  PRODUCT_SEQ: 'VPP_PRODUCT_SEQ',
  SCHEMA_VERSION: 'SCHEMA_VERSION',
  // Kết quả gửi email thông báo gần nhất (JSON) — hiện trên trang quản trị để lỗi gửi mail không bị "im lặng".
  NOTIFY_STATUS: 'NOTIFY_STATUS',
  // Sản phẩm đang ghi kho dở (JSON mảng productId): còn lại sau lỗi giữa chừng → lần ghi kho sau tính lại tồn từ sổ biến động.
  VPP_STOCK_DIRTY: 'VPP_STOCK_DIRTY',
  // Lỗi ở bước phụ sau khi thao tác đã lưu (ví dụ ghi lịch sử) — JSON, 20 lỗi gần nhất trong 7 ngày, hiện trên trang Cài đặt.
  POST_COMMIT_ERRORS: 'POST_COMMIT_ERRORS',
  // Ngày (YYYY-MM-DD) đã gửi email tổng hợp — nhiều trigger (mỗi người cài một cái) vẫn chỉ gửi một email mỗi ngày.
  DIGEST_SENT_DAY: 'DAILY_DIGEST_SENT_DAY',
  // Lần sao lưu tự động gần nhất (ISO) — tương tự, nhiều trigger sao lưu vẫn chỉ tạo một bản mỗi tuần.
  LAST_SCHEDULED_BACKUP: 'LAST_SCHEDULED_BACKUP_AT',
  // Đồng phục: mặt hàng đang ghi kho dở (như VPP_STOCK_DIRTY) + bộ đếm mã mẫu DP-001…
  DP_STOCK_DIRTY: 'DP_STOCK_DIRTY',
  DP_MODEL_SEQ: 'DP_MODEL_SEQ',
  // Bộ đếm mã phiếu nhập / xuất kho VPP theo ngày ("YYYYMMDD:n").
  VPP_RECEIPT_SEQ: 'VPP_RECEIPT_SEQ',
  VPP_ISSUE_SEQ: 'VPP_ISSUE_SEQ'
};

var SHEETS = {
  EMPLOYEES: 'NHAN_VIEN',
  HANDOVERS: 'BAN_GIAO',
  ITEMS: 'CHI_TIET_BAN_GIAO',
  CATEGORIES: 'LOAI_BAN_GIAO',
  HISTORY: 'LICH_SU',
  SETTINGS: 'CAU_HINH',
  VPP_PRODUCTS: 'VPP_SAN_PHAM',
  VPP_NORMS: 'VPP_DINH_MUC',
  VPP_STOCK: 'VPP_TON_KHO',
  VPP_MOVEMENTS: 'VPP_BIEN_DONG_KHO',
  VPP_PROPOSALS: 'VPP_DE_XUAT',
  VPP_PROPOSAL_ITEMS: 'VPP_DE_XUAT_CHI_TIET',
  VPP_VOUCHERS: 'VPP_PHIEU_KHO',
  DP_MODELS: 'DP_MAU',
  DP_SKUS: 'DP_BIEN_THE',
  DP_STOCK: 'DP_TON_KHO',
  DP_MOVEMENTS: 'DP_BIEN_DONG_KHO',
  DP_NORMS: 'DP_DINH_MUC',
  DP_RETURNS: 'DP_THU_HOI'
};

/**
 * Cấu trúc cột từng sheet. Hệ thống đọc/ghi theo TÊN CỘT (không theo vị trí),
 * nên có thể thêm cột riêng hoặc đổi thứ tự cột mà không hỏng dữ liệu.
 * setupDatabase() / upgradeOfficeSupplyModule() chỉ thêm cột còn thiếu, không xóa cột / dữ liệu.
 */
var HEADERS = {
  NHAN_VIEN: [
    'employee_id', 'full_name', 'department', 'position', 'email', 'phone', 'status', 'created_at', 'updated_at',
    // Cột bổ sung v3 (đồng phục): giới tính (NAM / NỮ) + size thường dùng — HCNS điền thẳng trên Sheet hoặc qua trang quản trị
    'gender', 'uniform_size'
  ],
  BAN_GIAO: [
    'handover_id', 'handover_code', 'sender_name', 'sender_employee_id', 'receiver_employee_id', 'receiver_name',
    'receiver_department', 'receiver_position', 'receiver_email', 'status', 'public_token_hash', 'created_at',
    'updated_at', 'confirmed_at', 'rejected_at', 'revision_requested_at', 'receiver_comment', 'signature_file_id',
    'signature_file_url', 'pdf_file_id', 'pdf_file_url', 'created_ip_hash', 'confirmed_ip_hash', 'user_agent',
    // Cột bổ sung v1 (xem docs/DATABASE.md)
    'note', 'public_token_nonce', 'cancelled_at', 'cancel_reason',
    // Cột bổ sung v2: loại phiếu, toàn vẹn nội dung, chống tạo trùng, người lập, cách người nhận xác thực khi ký
    'handover_type', 'content_hash', 'signature_sha256', 'created_user_agent', 'client_request_id', 'vpp_scope_id',
    'created_by', 'confirm_method',
    // Phiên bản nội dung đã chốt + dấu "đang sửa" (sửa phiếu trọn vẹn, xem apiAdminUpdateHandover_) — luôn liền nhau, ghi cùng lúc;
    // mã băm toàn bộ biên bản đã ký + niêm phong (HMAC bằng khóa Worker giữ) — phát hiện sửa tay sau khi ký.
    'items_revision', 'edit_pending', 'record_hash', 'record_seal'
  ],
  CHI_TIET_BAN_GIAO: [
    'item_id', 'handover_id', 'item_order', 'category', 'item_name', 'asset_code', 'serial_number', 'model',
    'quantity', 'condition', 'description', 'work_status', 'deadline', 'document_url', 'note', 'created_at',
    // Cột bổ sung v2: văn phòng phẩm + thay thế mềm khi sửa phiếu (không xóa dòng) + phiên bản nội dung
    'unit', 'product_id', 'affects_inventory', 'over_norm_reason', 'superseded_at', 'revision_id',
    // Cột bổ sung v3 (đồng phục): size + hình thức (CAP_PHAT / CHO_MUON; hạn trả ở cột deadline)
    'size', 'issue_kind'
  ],
  LOAI_BAN_GIAO: ['code', 'name', 'form_fields', 'hint', 'sort_order', 'status', 'created_at', 'updated_at', 'handover_type'],
  LICH_SU: [
    'log_id', 'handover_id', 'action', 'actor', 'old_status', 'new_status', 'message', 'created_at', 'metadata',
    'entity_type'
  ],
  CAU_HINH: ['key', 'value', 'description', 'updated_at'],
  VPP_SAN_PHAM: [
    'product_id', 'product_code', 'product_name', 'normalized_name', 'category', 'unit', 'reference_price',
    'minimum_stock', 'catalog_status', 'active', 'source', 'created_at', 'updated_at',
    'review_status', 'merged_into_product_id', 'note'
  ],
  VPP_DINH_MUC: [
    'norm_id', 'product_id', 'scope_type', 'scope_id', 'scope_name', 'monthly_quantity', 'unit', 'reference_price',
    'note', 'effective_from', 'effective_to', 'active', 'created_at', 'updated_at', 'source_ref'
  ],
  VPP_TON_KHO: [
    'product_id', 'on_hand', 'reserved', 'minimum_stock', 'raw_initial_value', 'needs_review', 'updated_at', 'updated_by'
  ],
  VPP_BIEN_DONG_KHO: [
    'movement_id', 'product_id', 'movement_type', 'quantity', 'on_hand_before', 'on_hand_after', 'reserved_before',
    'reserved_after', 'handover_id', 'proposal_id', 'operation_id', 'actor_id', 'actor_name', 'reason', 'created_at',
    // v3: dòng của phiếu nhập / xuất kho (VPP_PHIEU_KHO) — đơn giá nhập, phòng ban nhận khi xuất.
    'voucher_id', 'unit_price', 'department'
  ],
  VPP_DE_XUAT: [
    'proposal_id', 'proposal_code', 'requester_employee_id', 'requester_name', 'department', 'status', 'reason',
    'estimated_total', 'created_at', 'updated_at', 'reviewed_at', 'reviewed_by',
    'requester_position', 'scope_id', 'admin_note', 'client_request_id', 'received_at', 'closed_at'
  ],
  VPP_DE_XUAT_CHI_TIET: [
    'proposal_item_id', 'proposal_id', 'product_id', 'temporary_product_name', 'is_outside_norm', 'unit',
    'requested_quantity', 'norm_quantity', 'approved_quantity', 'reference_price', 'approved_price', 'reason', 'note',
    'product_approval_status',
    'reference_url', 'received_quantity', 'item_order'
  ],
  // Phiếu nhập kho (IN) / xuất kho trực tiếp (OUT) văn phòng phẩm (v3). Dòng hàng = các dòng VPP_BIEN_DONG_KHO cùng voucher_id.
  VPP_PHIEU_KHO: [
    'voucher_id', 'voucher_code', 'voucher_type', 'voucher_date', 'reason_type', 'department', 'receiver_employee_id',
    'receiver_name', 'supplier', 'invoice_no', 'note', 'line_count', 'total_quantity', 'total_amount', 'actor_id', 'actor_name',
    'client_request_id', 'created_at'
  ],
  // ---- Đồng phục (v3) ----
  // Mẫu: sizes = "S,M,L,XL,XXL"; counts_toward_quota = tính vào tiêu chuẩn cấp phát năm.
  DP_MAU: [
    'model_id', 'model_code', 'model_name', 'kind', 'gender', 'sizes', 'unit', 'reference_price', 'counts_toward_quota',
    'minimum_stock', 'applies_to', 'active', 'note', 'created_at', 'updated_at'
  ],
  // Mặt hàng (biến thể) = mẫu × size × tình trạng (NEW / USED). product_id là mã dùng trong kho / phiếu / sổ biến động.
  DP_BIEN_THE: ['product_id', 'sku_code', 'model_id', 'size', 'condition', 'active', 'created_at', 'updated_at'],
  // Tồn kho & sổ biến động: cùng cấu trúc với VPP_TON_KHO / VPP_BIEN_DONG_KHO (dùng chung bộ máy kho của Vpp.gs).
  DP_TON_KHO: [
    'product_id', 'on_hand', 'reserved', 'minimum_stock', 'raw_initial_value', 'needs_review', 'updated_at', 'updated_by'
  ],
  DP_BIEN_DONG_KHO: [
    'movement_id', 'product_id', 'movement_type', 'quantity', 'on_hand_before', 'on_hand_after', 'reserved_before',
    'reserved_after', 'handover_id', 'operation_id', 'actor_id', 'actor_name', 'reason', 'created_at', 'employee_id', 'return_id'
  ],
  // Tiêu chuẩn cấp phát / năm: nhóm × mẫu ('' = tổng mọi mẫu tính tiêu chuẩn) × giới tính ('' = cả hai).
  DP_DINH_MUC: [
    'norm_id', 'scope_id', 'scope_name', 'model_id', 'gender', 'yearly_quantity', 'note', 'effective_from', 'effective_to',
    'active', 'created_at', 'updated_at'
  ],
  // Trả / thu hồi đồng phục của một dòng phiếu đã ký (RESTOCK: nhập lại kho · DAMAGED · LOST).
  DP_THU_HOI: [
    'return_id', 'handover_id', 'item_id', 'employee_id', 'employee_name', 'department', 'product_id', 'model_id', 'size',
    'quantity', 'result', 'restock_product_id', 'restock_condition', 'reason', 'note', 'actor_id', 'actor_name',
    'client_request_id', 'created_at'
  ]
};

/** Cột định danh bất biến của từng sheet — dùng để kiểm tra đúng dòng trước khi ghi (không tin số dòng). */
var ROW_ID_COLUMNS = {
  NHAN_VIEN: 'employee_id',
  BAN_GIAO: 'handover_id',
  CHI_TIET_BAN_GIAO: 'item_id',
  LOAI_BAN_GIAO: 'code',
  LICH_SU: 'log_id',
  CAU_HINH: 'key',
  VPP_SAN_PHAM: 'product_id',
  VPP_DINH_MUC: 'norm_id',
  VPP_TON_KHO: 'product_id',
  VPP_BIEN_DONG_KHO: 'movement_id',
  VPP_DE_XUAT: 'proposal_id',
  VPP_DE_XUAT_CHI_TIET: 'proposal_item_id',
  VPP_PHIEU_KHO: 'voucher_id',
  DP_MAU: 'model_id',
  DP_BIEN_THE: 'product_id',
  DP_TON_KHO: 'product_id',
  DP_BIEN_DONG_KHO: 'movement_id',
  DP_DINH_MUC: 'norm_id',
  DP_THU_HOI: 'return_id'
};

/**
 * Cột định danh là UUID (mọi dòng dữ liệu phải có): dùng để phát hiện tiêu đề cột bị đổi tên / cột ID bị xóa trống — ví dụ
 * VPP_DINH_MUC "norm_id" bị gõ đè thành "m" (đã xảy ra 10/2026): nâng cấp thêm cột "norm_id" MỚI (trống) và mọi định mức bị bỏ
 * qua âm thầm. NHAN_VIEN / LOAI_BAN_GIAO / CAU_HINH dùng mã do người nhập (không phải UUID) nên không nằm trong danh sách.
 */
var UUID_ID_SHEETS = [
  'BAN_GIAO', 'CHI_TIET_BAN_GIAO', 'LICH_SU', 'VPP_SAN_PHAM', 'VPP_DINH_MUC', 'VPP_TON_KHO', 'VPP_BIEN_DONG_KHO', 'VPP_DE_XUAT',
  'VPP_DE_XUAT_CHI_TIET', 'VPP_PHIEU_KHO', 'DP_MAU', 'DP_BIEN_THE', 'DP_TON_KHO', 'DP_BIEN_DONG_KHO', 'DP_DINH_MUC', 'DP_THU_HOI'
];

var STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  CANCELLED: 'CANCELLED'
};

var STATUS_LABELS = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  REVISION_REQUESTED: 'Yêu cầu chỉnh sửa',
  CANCELLED: 'Đã hủy'
};

/** Loại phiếu bàn giao (bước đầu tiên khi admin tạo phiếu). */
var HANDOVER_TYPES = {
  ASSET: 'Thiết bị / tài sản',
  UNIFORM: 'Đồng phục',
  OFFICE_SUPPLY: 'Văn phòng phẩm',
  ACCOUNT: 'Tài khoản',
  DOCUMENT: 'Hồ sơ',
  WORK: 'Công việc',
  OTHER: 'Khác'
};

/** Loại nội dung (LOAI_BAN_GIAO.code) dành riêng cho văn phòng phẩm — chỉ dùng trong phiếu OFFICE_SUPPLY. */
var VPP_CATEGORY_CODE = 'VAN_PHONG_PHAM';

/** Loại nội dung dành riêng cho đồng phục — chỉ dùng trong phiếu UNIFORM (chọn mẫu / size từ kho đồng phục). */
var UNIFORM_CATEGORY_CODE = 'DONG_PHUC';

/** Loại phiếu mặc định của các loại nội dung có sẵn (khi cột handover_type trong LOAI_BAN_GIAO để trống). */
var DEFAULT_CATEGORY_TYPES = {
  THIET_BI_CNTT: 'ASSET',
  TAI_SAN: 'ASSET',
  THE: 'ASSET',
  TAI_KHOAN: 'ACCOUNT',
  HO_SO: 'DOCUMENT',
  CONG_VIEC: 'WORK',
  KHAC: 'OTHER',
  VAN_PHONG_PHAM: 'OFFICE_SUPPLY',
  DONG_PHUC: 'UNIFORM'
};

var LIMITS = {
  PERSON_NAME: 120,
  EMPLOYEE_ID: 50,
  HANDOVER_NOTE: 2000,
  RECEIVER_COMMENT: 1000,
  REVISION_MIN: 5,
  CANCEL_REASON: 500,
  MAX_QUANTITY: 100000,
  OVER_NORM_REASON: 500,
  PRODUCT_NAME: 200,
  PRODUCT_CODE: 40,
  PRODUCT_CATEGORY: 80,
  UNIT: 40,
  MAX_PRICE: 1000000000,
  PROPOSAL_REASON: 1000,
  PROPOSAL_ITEMS: 50,
  STOCK_REASON: 500,
  URL: 500,
  UNIFORM_MODEL_NAME: 120,
  UNIFORM_APPLIES_TO: 200,
  UNIFORM_MAX_SIZES: 12,
  MAX_YEARLY_QUOTA: 100,
  // Phiếu nhập / xuất kho VPP và cập nhật danh mục từ Excel.
  VOUCHER_MAX_LINES: 300,
  VOUCHER_TEXT: 120,
  VOUCHER_NOTE: 1000,
  IMPORT_MAX_ROWS: 3000
};

/**
 * Trường nội dung bàn giao ↔ cột trong CHI_TIET_BAN_GIAO.
 * key: tên dùng trong API (camelCase) · column: tên cột trong Sheet.
 */
var ITEM_FIELDS = [
  { key: 'itemName', column: 'item_name', label: 'Tên', kind: 'text', max: 200 },
  { key: 'assetCode', column: 'asset_code', label: 'Mã', kind: 'text', max: 120 },
  { key: 'serialNumber', column: 'serial_number', label: 'Serial', kind: 'text', max: 120 },
  { key: 'model', column: 'model', label: 'Model', kind: 'text', max: 120 },
  { key: 'quantity', column: 'quantity', label: 'Số lượng', kind: 'number', max: 100000 },
  { key: 'unit', column: 'unit', label: 'ĐVT', kind: 'text', max: 40 },
  { key: 'condition', column: 'condition', label: 'Tình trạng', kind: 'text', max: 120 },
  { key: 'description', column: 'description', label: 'Mô tả', kind: 'textarea', max: 2000 },
  { key: 'workStatus', column: 'work_status', label: 'Tình trạng công việc', kind: 'text', max: 500 },
  { key: 'deadline', column: 'deadline', label: 'Hạn hoàn thành', kind: 'date', max: 10 },
  { key: 'documentUrl', column: 'document_url', label: 'Link tài liệu', kind: 'url', max: 500 },
  { key: 'note', column: 'note', label: 'Ghi chú', kind: 'textarea', max: 1000 }
];

/**
 * Loại bàn giao mặc định (ghi vào sheet LOAI_BAN_GIAO khi chạy setupDatabase()).
 *
 * form_fields: danh sách trường hiển thị trên form, phân tách bằng "|":
 *     <tên_cột>[*]:<Nhãn hiển thị>
 *   - <tên_cột>: một cột của CHI_TIET_BAN_GIAO (item_name, asset_code, serial_number, model,
 *                quantity, unit, condition, description, work_status, deadline, document_url, note)
 *   - dấu * sau tên cột = bắt buộc nhập
 * Ví dụ: item_name*:Tên thiết bị|serial_number:Serial|note:Ghi chú
 * handover_type: loại phiếu chứa loại nội dung này (ASSET, ACCOUNT, DOCUMENT, WORK, OTHER, OFFICE_SUPPLY).
 */
var DEFAULT_CATEGORIES = [
  {
    code: 'THIET_BI_CNTT',
    name: 'Thiết bị CNTT',
    form_fields: 'item_name*:Tên thiết bị|asset_code:Mã tài sản|serial_number:Serial|model:Model|quantity:Số lượng|condition:Tình trạng|description:Phụ kiện / mô tả|note:Ghi chú',
    hint: '',
    sort_order: 1,
    handover_type: 'ASSET'
  },
  {
    code: 'TAI_SAN',
    name: 'Tài sản',
    form_fields: 'item_name*:Tên tài sản|asset_code:Mã tài sản|serial_number:Số seri|quantity:Số lượng|condition:Tình trạng|description:Mô tả|note:Ghi chú',
    hint: '',
    sort_order: 2,
    handover_type: 'ASSET'
  },
  {
    code: 'THE',
    name: 'Thẻ',
    form_fields: 'item_name*:Loại thẻ|asset_code:Mã thẻ|quantity:Số lượng|condition:Tình trạng|note:Ghi chú',
    hint: 'Ví dụ: thẻ nhân viên, thẻ thang máy, thẻ ra vào.',
    sort_order: 3,
    handover_type: 'ASSET'
  },
  {
    code: 'TAI_KHOAN',
    name: 'Tài khoản',
    form_fields: 'item_name*:Tên tài khoản / hệ thống|asset_code:Username|description:Mô tả|note:Ghi chú',
    hint: 'TUYỆT ĐỐI KHÔNG nhập mật khẩu. Bàn giao mật khẩu trực tiếp hoặc yêu cầu người nhận tự đặt lại mật khẩu.',
    sort_order: 4,
    handover_type: 'ACCOUNT'
  },
  {
    code: 'CONG_VIEC',
    name: 'Công việc',
    form_fields: 'item_name*:Tên công việc|description:Nội dung|work_status:Tình trạng hiện tại|deadline:Deadline|document_url:Link tài liệu|note:Ghi chú',
    hint: '',
    sort_order: 5,
    handover_type: 'WORK'
  },
  {
    code: 'HO_SO',
    name: 'Hồ sơ',
    form_fields: 'item_name*:Tên hồ sơ|quantity:Số lượng|condition:Tình trạng|description:Nơi lưu|note:Ghi chú',
    hint: '',
    sort_order: 6,
    handover_type: 'DOCUMENT'
  },
  {
    code: 'KHAC',
    name: 'Khác',
    form_fields: 'description*:Nội dung bàn giao|quantity:Số lượng|note:Ghi chú',
    hint: '',
    sort_order: 7,
    handover_type: 'OTHER'
  },
  {
    code: 'VAN_PHONG_PHAM',
    name: 'Văn phòng phẩm',
    form_fields: 'item_name*:Tên văn phòng phẩm|unit:ĐVT|quantity*:Số lượng|note:Ghi chú',
    hint: 'Chỉ dùng trong phiếu bàn giao văn phòng phẩm (chọn sản phẩm từ kho).',
    sort_order: 8,
    handover_type: 'OFFICE_SUPPLY'
  },
  {
    code: 'DONG_PHUC',
    name: 'Đồng phục',
    form_fields: 'item_name*:Mẫu đồng phục|unit:ĐVT|quantity*:Số lượng|condition:Tình trạng|deadline:Hạn trả|note:Ghi chú',
    hint: 'Chỉ dùng trong phiếu bàn giao đồng phục (chọn mẫu, size từ kho đồng phục).',
    sort_order: 9,
    handover_type: 'UNIFORM'
  }
];

/** Cấu hình hiển thị (không bí mật) — sửa trực tiếp trong sheet CAU_HINH. */
var DEFAULT_SETTINGS = [
  { key: 'ORG_NAME', value: 'DIỆU TƯỚNG AM', description: 'Tên đơn vị in trên PDF biên bản' },
  { key: 'ORG_FULL_NAME', value: '', description: 'Tên pháp lý đầy đủ của đơn vị (tùy chọn, in dưới tên đơn vị)' },
  { key: 'ORG_ADDRESS', value: '', description: 'Địa chỉ đơn vị (tùy chọn)' },
  { key: 'PDF_TITLE', value: 'BIÊN BẢN BÀN GIAO', description: 'Tiêu đề PDF' },
  { key: 'PDF_TITLE_VPP', value: 'BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM', description: 'Tiêu đề PDF của phiếu văn phòng phẩm' },
  { key: 'PDF_TITLE_DP', value: 'BIÊN BẢN BÀN GIAO ĐỒNG PHỤC', description: 'Tiêu đề PDF của phiếu đồng phục' },
  {
    key: 'DP_TIEU_CHUAN_NAM',
    value: '3',
    description: 'Số đồng phục mỗi nhân viên được cấp phát / năm khi nhóm chưa có tiêu chuẩn riêng (Chính sách người lao động ' +
      '19/08/2025, mục VII.2: 03). 0 = không áp dụng tiêu chuẩn mặc định'
  },
  { key: 'PDF_SHOW_NATIONAL_HEADER', value: 'TRUE', description: 'TRUE = in Quốc hiệu – Tiêu ngữ trên PDF' },
  { key: 'LOGO_FILE_ID', value: '', description: 'ID file ảnh logo (PNG/JPG) trên Google Drive để in lên PDF (tùy chọn)' },
  {
    key: 'PDF_FOOTER',
    value: 'Biên bản được xác nhận điện tử qua Hệ thống bàn giao nội bộ – Diệu Tướng Am.',
    description: 'Dòng chú thích cuối PDF'
  },
  {
    key: 'CONFIRM_OTP',
    value: 'EMAIL',
    description: 'Mã OTP khi người nhận ký. EMAIL = bắt buộc nếu người nhận có email (không có email vẫn ký được nhưng phiếu bị đánh dấu); ' +
      'REQUIRED = luôn bắt buộc (người nhận chưa có email thì không ký được); OFF = tắt'
  },
  {
    key: 'NOTIFY_EMAILS',
    value: '',
    description: 'Email nhận thông báo, cách nhau bởi dấu phẩy: yêu cầu chỉnh sửa, đề xuất mua mới, cần đối soát kho, tổng hợp hằng ngày. Để trống = không gửi'
  },
  {
    key: 'APP_URL',
    value: 'https://bangiao.dieutuongam.com',
    description: 'Địa chỉ ứng dụng — dùng cho đường dẫn trong email thông báo'
  }
];

/** Cách người nhận xác thực khi ký (BAN_GIAO.confirm_method). */
var CONFIRM_METHODS = {
  OTP_EMAIL: 'OTP_EMAIL',   // nhập đúng mã gửi tới email người nhận
  NO_EMAIL: 'NO_EMAIL',     // chế độ EMAIL nhưng người nhận chưa có email → ký không OTP (cảnh báo cho admin)
  OTP_OFF: 'OTP_OFF'        // CONFIRM_OTP = OFF
};

// ============================================================================
// Văn phòng phẩm (VPP)
// ============================================================================

/** Trạng thái sản phẩm trong danh mục. */
var CATALOG_STATUS = {
  MASTER: 'MASTER',                     // sản phẩm chính thức trong danh mục
  TEMP: 'TEMP',                         // sản phẩm tạm / ngoài định mức (vẫn quản lý kho được)
  PENDING_APPROVAL: 'PENDING_APPROVAL', // nhân viên đề xuất, chờ admin quyết định
  ARCHIVED: 'ARCHIVED'                  // ngừng dùng / đã ghép vào sản phẩm khác / bị từ chối
};

/** Trạng thái rà soát dữ liệu (ghép tên tồn kho ↔ danh mục). */
var REVIEW_STATUS = {
  PENDING: 'PENDING',   // cần admin xử lý (ghép / tạo mới / bỏ qua)
  MAPPED: 'MAPPED',     // đã ghép vào sản phẩm khác
  RESOLVED: 'RESOLVED', // đã chuyển thành sản phẩm chính thức
  SKIPPED: 'SKIPPED'    // admin chọn giữ riêng (ngoài định mức)
};

var MOVEMENT_TYPES = {
  INITIAL: 'INITIAL',       // tồn đầu kỳ
  IN: 'IN',                 // nhập kho
  RESERVE: 'RESERVE',       // giữ chỗ cho phiếu chờ ký
  RELEASE: 'RELEASE',       // trả giữ chỗ (hủy phiếu / giảm số lượng)
  OUT: 'OUT',               // xuất kho khi người nhận ký xác nhận
  ADJUSTMENT: 'ADJUSTMENT', // kiểm kê / điều chỉnh / ghép dữ liệu
  RETURN: 'RETURN',         // (đồng phục) nhân viên trả lại — nhập lại kho
  DISPOSE: 'DISPOSE',       // (đồng phục) thanh lý / hủy hàng trong kho
  ISSUE: 'ISSUE'            // (VPP) xuất kho trực tiếp theo phiếu xuất (không qua phiếu bàn giao ký nhận)
};

var PROPOSAL_STATUS = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  PURCHASED: 'PURCHASED',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED'
};

/** Quyết định của admin với sản phẩm ngoài danh mục trong đề xuất. */
var PRODUCT_APPROVAL = {
  NOT_REQUIRED: 'NOT_REQUIRED', // sản phẩm có sẵn trong danh mục
  PENDING: 'PENDING',
  APPROVED_MASTER: 'APPROVED_MASTER',
  KEPT_TEMP: 'KEPT_TEMP',
  MAPPED: 'MAPPED',
  REJECTED: 'REJECTED'
};

/** Lý do nhập kho thủ công. TON_DAU_KY ghi movement INITIAL, còn lại ghi IN. */
var STOCK_IN_REASONS = {
  MUA_TRUC_TIEP: 'Mua trực tiếp',
  BO_SUNG: 'Bổ sung',
  CHUYEN_KHO: 'Chuyển kho',
  TON_DAU_KY: 'Tồn đầu kỳ',
  KHAC: 'Khác'
};

// ============================================================================
// Đồng phục (DP) — khớp shared/uniform.ts
// ============================================================================

var UNIFORM_KINDS = { UNIFORM: 'Đồng phục', PPE: 'Bảo hộ lao động', OTHER: 'Khác' };
var UNIFORM_GENDERS = { NAM: 'Nam', NU: 'Nữ', UNISEX: 'Nam & nữ' };
var EMPLOYEE_GENDERS = { NAM: 'Nam', NU: 'Nữ' };
var UNIFORM_CONDITIONS = { NEW: 'Mới', USED: 'Đã qua sử dụng' };
var ISSUE_KINDS = { CAP_PHAT: 'Cấp phát', CHO_MUON: 'Cho mượn' };
var RETURN_RESULTS = { RESTOCK: 'Nhận lại — nhập kho', DAMAGED: 'Hư hỏng — không nhập kho', LOST: 'Mất' };
var RETURN_REASONS = {
  TRA_MUON: 'Trả đồ mượn',
  NGHI_VIEC: 'Thu hồi khi nghỉ việc',
  DOI_SIZE: 'Đổi size',
  HU_HONG: 'Hư hỏng',
  KHAC: 'Khác'
};
/** Lý do nhập kho đồng phục. TON_DAU_KY ghi movement INITIAL, còn lại ghi IN. */
var UNIFORM_STOCK_IN_REASONS = { MUA_MOI: 'Nhập bổ sung (mua / đặt may mới)', TON_DAU_KY: 'Tồn đầu kỳ', CHUYEN_KHO: 'Chuyển kho', KHAC: 'Khác' };
/** Size: chữ in hoa / số / dấu gạch (S, XL, 3XL, 38, FREE) — khớp UNIFORM_SIZE_PATTERN (shared/uniform.ts). */
var UNIFORM_SIZE_PATTERN_ = /^[A-Z0-9][A-Z0-9-]{0,9}$/;
var DEFAULT_UNIFORM_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
/** Tiền tố khóa CAU_HINH gắn phòng ban → nhóm tiêu chuẩn đồng phục ("NONE" = không áp dụng tiêu chuẩn). */
var DP_SCOPE_SETTING_PREFIX = 'DP_SCOPE:';

/**
 * Danh mục mẫu đồng phục khởi tạo (seedUniformCatalog) — theo "DS đồng phục 2023 / 2024" của P.HCNS (các mẫu ÁO SƠMI ĐỎ, ÁO SƠMI
 * VÀNG, ÁO DÀI VÀNG, ÁO DÀI XANH, ÁO THUN CÁ SẤU, ÁO THUN VP; size S–XXL) + áo bảo hộ (đang cấp qua module văn phòng phẩm).
 * Không có tồn kho / đơn giá: nhập qua trang Tồn kho (lý do "Tồn đầu kỳ") sau khi đếm thực tế. Đối tượng sử dụng chỉ là mô tả.
 */
var UNIFORM_SEED_MODELS = [
  { code: 'DP-001', name: 'Áo sơmi đỏ', kind: 'UNIFORM', gender: 'NAM', appliesTo: 'Nhân viên kinh doanh / showroom (nam)' },
  { code: 'DP-002', name: 'Áo sơmi vàng', kind: 'UNIFORM', gender: 'NAM', appliesTo: 'Quản lý / giám đốc khối (nam)' },
  { code: 'DP-003', name: 'Áo dài vàng', kind: 'UNIFORM', gender: 'NU', appliesTo: 'Nhân viên kinh doanh / showroom (nữ)' },
  { code: 'DP-004', name: 'Áo dài xanh', kind: 'UNIFORM', gender: 'NU', appliesTo: 'Quản lý / giám đốc khối, trưởng nhóm (nữ)' },
  { code: 'DP-005', name: 'Áo thun cá sấu', kind: 'UNIFORM', gender: 'UNISEX', appliesTo: 'Bộ phận Hỗ trợ - Giao nhận, kỹ thuật, kho, tạp vụ' },
  { code: 'DP-006', name: 'Áo thun văn phòng', kind: 'UNIFORM', gender: 'UNISEX', appliesTo: 'Khối văn phòng, Ban Tổng Giám đốc' },
  { code: 'DP-007', name: 'Áo bảo hộ', kind: 'PPE', gender: 'UNISEX', appliesTo: 'Hỗ trợ - Giao nhận, kho (bảo hộ lao động)', countsTowardQuota: false }
];

/**
 * Dữ liệu nhân viên MẪU để thử hệ thống — mã bắt đầu bằng "DEMO-".
 * Thêm bằng seedSampleEmployees(), xóa bằng removeSampleEmployees().
 * Cột: employee_id, full_name, department, position, email, phone, status
 */
var SAMPLE_EMPLOYEES = [
  ['DEMO-519', 'Phạm Danh Thái', 'KHTH', 'Nhân viên', 'thai.pham@example.com', '', 'ACTIVE'],
  ['DEMO-101', 'Nguyễn Văn An', 'IT', 'Trưởng phòng', 'an.nguyen@example.com', '', 'ACTIVE'],
  ['DEMO-102', 'Trần Thị Bích Ngọc', 'Kế toán', 'Kế toán viên', 'ngoc.tran@example.com', '', 'ACTIVE'],
  ['DEMO-103', 'Lê Hoàng Đức', 'Kinh doanh', 'Nhân viên kinh doanh', 'duc.le@example.com', '', 'ACTIVE'],
  ['DEMO-104', 'Đỗ Thị Hương', 'Hành chính', 'Chuyên viên hành chính', 'huong.do@example.com', '', 'ACTIVE'],
  ['DEMO-105', 'Võ Minh Quân', 'IT', 'Kỹ thuật viên', 'quan.vo@example.com', '', 'ACTIVE'],
  ['DEMO-106', 'Bùi Thanh Tâm', 'Marketing', 'Nhân viên thiết kế', 'tam.bui@example.com', '', 'ACTIVE'],
  ['DEMO-107', 'Huỳnh Gia Bảo', 'Kho vận', 'Thủ kho', 'bao.huynh@example.com', '', 'INACTIVE']
];
