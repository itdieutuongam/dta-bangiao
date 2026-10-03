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
  VERSION: '1.0.0',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  // Việt Nam không áp dụng giờ mùa hè → offset cố định.
  TZ_OFFSET: '+07:00',
  CODE_PREFIX: 'BG',
  // Request từ Worker lệch thời gian quá 5 phút bị từ chối.
  REQUEST_MAX_SKEW_MS: 5 * 60 * 1000,
  REPLAY_TTL_SECONDS: 15 * 60,
  LOCK_WAIT_MS: 25000,
  CACHE_TTL_SECONDS: 10 * 60,
  // CacheService giới hạn 100KB/giá trị → chia nhỏ JSON (ký tự tiếng Việt tối đa 3 byte).
  CACHE_CHUNK_CHARS: 25000,
  SIGNATURE_MAX_BYTES: 300 * 1024,
  MAX_ITEMS: 50,
  MAX_REQUEST_CHARS: 2 * 1024 * 1024,
  DRIVE_ROOT_NAME: 'DTA_HANDOVER',
  SAMPLE_EMPLOYEE_PREFIX: 'DEMO-'
};

var PROP = {
  SHARED_SECRET: 'BACKEND_SHARED_SECRET',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',
  USE_ADVANCED_DRIVE: 'USE_ADVANCED_DRIVE',
  HANDOVER_SEQ: 'HANDOVER_SEQ'
};

var SHEETS = {
  EMPLOYEES: 'NHAN_VIEN',
  HANDOVERS: 'BAN_GIAO',
  ITEMS: 'CHI_TIET_BAN_GIAO',
  CATEGORIES: 'LOAI_BAN_GIAO',
  HISTORY: 'LICH_SU',
  SETTINGS: 'CAU_HINH'
};

/**
 * Cấu trúc cột từng sheet. Hệ thống đọc/ghi theo TÊN CỘT (không theo vị trí),
 * nên có thể thêm cột riêng hoặc đổi thứ tự cột mà không hỏng dữ liệu.
 * setupDatabase() chỉ thêm cột còn thiếu, không xóa cột / dữ liệu.
 */
var HEADERS = {
  NHAN_VIEN: [
    'employee_id', 'full_name', 'department', 'position', 'email', 'phone', 'status', 'created_at', 'updated_at'
  ],
  BAN_GIAO: [
    'handover_id', 'handover_code', 'sender_name', 'sender_employee_id', 'receiver_employee_id', 'receiver_name',
    'receiver_department', 'receiver_position', 'receiver_email', 'status', 'public_token_hash', 'created_at',
    'updated_at', 'confirmed_at', 'rejected_at', 'revision_requested_at', 'receiver_comment', 'signature_file_id',
    'signature_file_url', 'pdf_file_id', 'pdf_file_url', 'created_ip_hash', 'confirmed_ip_hash', 'user_agent',
    // Cột bổ sung (xem docs/DATABASE.md)
    'note', 'public_token_nonce', 'cancelled_at', 'cancel_reason'
  ],
  CHI_TIET_BAN_GIAO: [
    'item_id', 'handover_id', 'item_order', 'category', 'item_name', 'asset_code', 'serial_number', 'model',
    'quantity', 'condition', 'description', 'work_status', 'deadline', 'document_url', 'note', 'created_at'
  ],
  LOAI_BAN_GIAO: ['code', 'name', 'form_fields', 'hint', 'sort_order', 'status', 'created_at', 'updated_at'],
  LICH_SU: ['log_id', 'handover_id', 'action', 'actor', 'old_status', 'new_status', 'message', 'created_at', 'metadata'],
  CAU_HINH: ['key', 'value', 'description', 'updated_at']
};

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

var LIMITS = {
  PERSON_NAME: 120,
  EMPLOYEE_ID: 50,
  HANDOVER_NOTE: 2000,
  RECEIVER_COMMENT: 1000,
  REVISION_MIN: 5,
  CANCEL_REASON: 500,
  MAX_QUANTITY: 100000
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
 *                quantity, condition, description, work_status, deadline, document_url, note)
 *   - dấu * sau tên cột = bắt buộc nhập
 * Ví dụ: item_name*:Tên thiết bị|serial_number:Serial|note:Ghi chú
 */
var DEFAULT_CATEGORIES = [
  {
    code: 'THIET_BI_CNTT',
    name: 'Thiết bị CNTT',
    form_fields: 'item_name*:Tên thiết bị|asset_code:Mã tài sản|serial_number:Serial|model:Model|quantity:Số lượng|condition:Tình trạng|description:Phụ kiện / mô tả|note:Ghi chú',
    hint: '',
    sort_order: 1
  },
  {
    code: 'TAI_SAN',
    name: 'Tài sản',
    form_fields: 'item_name*:Tên tài sản|asset_code:Mã tài sản|serial_number:Số seri|quantity:Số lượng|condition:Tình trạng|description:Mô tả|note:Ghi chú',
    hint: '',
    sort_order: 2
  },
  {
    code: 'THE',
    name: 'Thẻ',
    form_fields: 'item_name*:Loại thẻ|asset_code:Mã thẻ|quantity:Số lượng|condition:Tình trạng|note:Ghi chú',
    hint: 'Ví dụ: thẻ nhân viên, thẻ thang máy, thẻ ra vào.',
    sort_order: 3
  },
  {
    code: 'TAI_KHOAN',
    name: 'Tài khoản',
    form_fields: 'item_name*:Tên tài khoản / hệ thống|asset_code:Username|description:Mô tả|note:Ghi chú',
    hint: 'TUYỆT ĐỐI KHÔNG nhập mật khẩu. Bàn giao mật khẩu trực tiếp hoặc yêu cầu người nhận tự đặt lại mật khẩu.',
    sort_order: 4
  },
  {
    code: 'CONG_VIEC',
    name: 'Công việc',
    form_fields: 'item_name*:Tên công việc|description:Nội dung|work_status:Tình trạng hiện tại|deadline:Deadline|document_url:Link tài liệu|note:Ghi chú',
    hint: '',
    sort_order: 5
  },
  {
    code: 'HO_SO',
    name: 'Hồ sơ',
    form_fields: 'item_name*:Tên hồ sơ|quantity:Số lượng|condition:Tình trạng|description:Nơi lưu|note:Ghi chú',
    hint: '',
    sort_order: 6
  },
  {
    code: 'KHAC',
    name: 'Khác',
    form_fields: 'description*:Nội dung bàn giao|quantity:Số lượng|note:Ghi chú',
    hint: '',
    sort_order: 7
  }
];

/** Cấu hình hiển thị (không bí mật) — sửa trực tiếp trong sheet CAU_HINH. */
var DEFAULT_SETTINGS = [
  { key: 'ORG_NAME', value: 'DIỆU TƯỚNG AM', description: 'Tên đơn vị in trên PDF biên bản' },
  { key: 'ORG_FULL_NAME', value: '', description: 'Tên pháp lý đầy đủ của đơn vị (tùy chọn, in dưới tên đơn vị)' },
  { key: 'ORG_ADDRESS', value: '', description: 'Địa chỉ đơn vị (tùy chọn)' },
  { key: 'PDF_TITLE', value: 'BIÊN BẢN BÀN GIAO', description: 'Tiêu đề PDF' },
  { key: 'PDF_SHOW_NATIONAL_HEADER', value: 'TRUE', description: 'TRUE = in Quốc hiệu – Tiêu ngữ trên PDF' },
  { key: 'LOGO_FILE_ID', value: '', description: 'ID file ảnh logo (PNG/JPG) trên Google Drive để in lên PDF (tùy chọn)' },
  {
    key: 'PDF_FOOTER',
    value: 'Biên bản được xác nhận điện tử qua Hệ thống bàn giao nội bộ – Diệu Tướng Am.',
    description: 'Dòng chú thích cuối PDF'
  }
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
