# Cấu trúc dữ liệu (Google Sheets + Google Drive)

Hệ thống đọc/ghi theo **tên cột ở dòng 1**, không theo vị trí → có thể đổi thứ tự cột hoặc thêm cột riêng (ví dụ ghi chú
nội bộ, công thức) mà không ảnh hưởng. Không đổi tên / xóa các cột dưới đây. `setupDatabase()` tự bổ sung cột thiếu.

Quy ước chung:

- ID là **UUID** (`handover_id`, `item_id`, `log_id`) — không phụ thuộc số dòng; sắp xếp hoặc xóa dòng không làm hỏng liên kết.
- Thời gian lưu dạng **ISO 8601 giờ Việt Nam**: `2026-10-03T18:07:00+07:00`. Giao diện hiển thị `DD/MM/YYYY HH:mm`.
- Ô dữ liệu định dạng **văn bản thuần (`@`)** → giữ nguyên `0519`, `2026-10-15`; giá trị bắt đầu bằng `= + - @` được lưu
  kèm dấu `'` (chống chèn công thức).
- Ngày không giờ (deadline) dạng `YYYY-MM-DD`.

## 1. `NHAN_VIEN` — danh sách nhân viên (quản trị viên nhập)

| Cột | Bắt buộc | Mô tả |
|---|---|---|
| `employee_id` | ✔ | Mã nhân viên, **duy nhất** (ví dụ `519`, `NV-0519`) |
| `full_name` | ✔ | Họ tên đầy đủ có dấu |
| `department` | | Phòng ban |
| `position` | | Chức vụ |
| `email` | | Email (hiển thị khi chọn người nhận, dùng nút “Gửi qua email”) |
| `phone` | | Số điện thoại — **không** trả về qua API công khai |
| `status` | | `ACTIVE` hoặc để trống = đang làm việc · giá trị khác (ví dụ `INACTIVE`) = không hiện trong danh sách chọn |
| `created_at`, `updated_at` | | Tùy chọn, để tham khảo |

Dòng trùng `employee_id`: hệ thống dùng dòng đầu tiên (`checkSetup()` không báo lỗi — nên tránh trùng).
Biên bản lưu **bản chụp** thông tin người nhận lúc tạo, nên sửa/đổi phòng ban sau này không làm thay đổi biên bản cũ.

## 2. `BAN_GIAO` — biên bản (hệ thống ghi; không sửa tay)

| Cột | Mô tả |
|---|---|
| `handover_id` | UUID biên bản |
| `handover_code` | Mã hiển thị `BG-YYYYMMDD-XXXX` (theo ngày giờ Việt Nam, tăng dần trong ngày, không trùng) |
| `sender_name`, `sender_employee_id` | Người giao (chọn từ danh sách hoặc nhập tên; mã có thể trống) |
| `receiver_employee_id`, `receiver_name`, `receiver_department`, `receiver_position`, `receiver_email` | Bản chụp thông tin người nhận |
| `status` | `PENDING` · `CONFIRMED` · `REVISION_REQUESTED` · `CANCELLED` |
| `public_token_hash` | `SHA-256(token)` của link xác nhận (hex 64 ký tự). **Không lưu token gốc** |
| `created_at`, `updated_at` | Thời điểm tạo / cập nhật |
| `confirmed_at` | Thời điểm người nhận ký xác nhận |
| `rejected_at` | Dự phòng cho trạng thái từ chối (chưa dùng trong phiên bản này) |
| `revision_requested_at` | Lần gần nhất người nhận yêu cầu chỉnh sửa |
| `receiver_comment` | Lý do yêu cầu chỉnh sửa, hoặc ghi chú khi xác nhận (lịch sử đầy đủ ở `LICH_SU`) |
| `signature_file_id`, `signature_file_url` | File PNG chữ ký trên Drive (private) |
| `pdf_file_id`, `pdf_file_url` | File PDF biên bản trên Drive (private) |
| `created_ip_hash`, `confirmed_ip_hash` | HMAC của địa chỉ IP (32 ký tự hex) — không lưu IP gốc |
| `user_agent` | Trình duyệt / thiết bị lúc ký xác nhận |
| `note` | Ghi chú chung của biên bản *(cột bổ sung)* |
| `public_token_nonce` | Nonce để Worker dựng lại link khi admin “Copy link”; vô dụng nếu không có `SESSION_SECRET` *(cột bổ sung)* |
| `cancelled_at`, `cancel_reason` | Thời điểm & lý do hủy *(cột bổ sung)* |

## 3. `CHI_TIET_BAN_GIAO` — nội dung bàn giao (1 biên bản → N dòng)

| Cột | Mô tả |
|---|---|
| `item_id` | UUID |
| `handover_id` | Liên kết `BAN_GIAO.handover_id` |
| `item_order` | Thứ tự hiển thị (1, 2, 3…) |
| `category` | Mã loại (`THIET_BI_CNTT`, `THE`, …) — xem `LOAI_BAN_GIAO` |
| `item_name` | Tên thiết bị / loại thẻ / tên tài khoản-hệ thống / tên công việc / tên hồ sơ |
| `asset_code` | Mã tài sản / mã thẻ / username (định danh của nội dung) |
| `serial_number`, `model` | Serial, model |
| `quantity` | Số nguyên ≥ 1 hoặc trống |
| `condition` | Tình trạng |
| `description` | Mô tả / phụ kiện / nội dung / nơi lưu (tùy loại) |
| `work_status` | Tình trạng công việc |
| `deadline` | `YYYY-MM-DD` |
| `document_url` | Link tài liệu (`http(s)://`) |
| `note` | Ghi chú |
| `created_at` | Thời điểm ghi |

Khi admin sửa biên bản, toàn bộ dòng của biên bản được thay thế (bản cũ lưu trong `LICH_SU.metadata`).
**Không có cột mật khẩu**: hệ thống từ chối nội dung dạng `mật khẩu: …`, `password = …`, `MK: …` ở mọi trường.

## 4. `LOAI_BAN_GIAO` — loại bàn giao & form nhập

| Cột | Mô tả |
|---|---|
| `code` | Mã loại: chữ IN HOA, số, `_` (≤ 40 ký tự), **duy nhất**, không đổi sau khi đã dùng |
| `name` | Tên hiển thị |
| `form_fields` | Danh sách trường của form (xem bên dưới) |
| `hint` | Ghi chú cảnh báo hiển thị trên form (ví dụ: không nhập mật khẩu) |
| `sort_order` | Thứ tự trong danh sách chọn |
| `status` | `ACTIVE` / trống = đang dùng · `INACTIVE` = ẩn khỏi form tạo mới (biên bản cũ vẫn hiển thị đúng nhãn) |
| `created_at`, `updated_at` | Tham khảo |

**Cú pháp `form_fields`**: các trường cách nhau bởi `|`, mỗi trường `<tên_cột>[*]:<Nhãn>`; `*` = bắt buộc.
`<tên_cột>` là một cột của `CHI_TIET_BAN_GIAO`: `item_name`, `asset_code`, `serial_number`, `model`, `quantity`,
`condition`, `description`, `work_status`, `deadline`, `document_url`, `note`. Kiểu ô nhập tự động theo cột
(`quantity` → số, `deadline` → ngày, `document_url` → link, `description`/`note` → nhiều dòng).

Loại mặc định (`setupDatabase()` thêm khi sheet trống):

| code | name | form_fields |
|---|---|---|
| `THIET_BI_CNTT` | Thiết bị CNTT | `item_name*:Tên thiết bị\|asset_code:Mã tài sản\|serial_number:Serial\|model:Model\|quantity:Số lượng\|condition:Tình trạng\|description:Phụ kiện / mô tả\|note:Ghi chú` |
| `TAI_SAN` | Tài sản | `item_name*:Tên tài sản\|asset_code:Mã tài sản\|serial_number:Số seri\|quantity:Số lượng\|condition:Tình trạng\|description:Mô tả\|note:Ghi chú` |
| `THE` | Thẻ | `item_name*:Loại thẻ\|asset_code:Mã thẻ\|quantity:Số lượng\|condition:Tình trạng\|note:Ghi chú` |
| `TAI_KHOAN` | Tài khoản | `item_name*:Tên tài khoản / hệ thống\|asset_code:Username\|description:Mô tả\|note:Ghi chú` |
| `CONG_VIEC` | Công việc | `item_name*:Tên công việc\|description:Nội dung\|work_status:Tình trạng hiện tại\|deadline:Deadline\|document_url:Link tài liệu\|note:Ghi chú` |
| `HO_SO` | Hồ sơ | `item_name*:Tên hồ sơ\|quantity:Số lượng\|condition:Tình trạng\|description:Nơi lưu\|note:Ghi chú` |
| `KHAC` | Khác | `description*:Nội dung bàn giao\|quantity:Số lượng\|note:Ghi chú` |

Ví dụ thêm loại mới “Phương tiện”: dòng mới `XE | Phương tiện | item_name*:Tên xe|asset_code*:Biển số|condition:Tình trạng|note:Ghi chú | | 8 | ACTIVE`
→ *Làm mới dữ liệu* → loại mới xuất hiện trên form, không cần build lại.

## 5. `LICH_SU` — nhật ký thao tác

| Cột | Mô tả |
|---|---|
| `log_id` | UUID |
| `handover_id` | Biên bản liên quan |
| `action` | `CREATED`, `CONFIRMED`, `REVISION_REQUESTED`, `UPDATED`, `CANCELLED`, `LINK_REGENERATED`, `PDF_GENERATED` |
| `actor` | Người thực hiện (tên người giao / người nhận / “Quản trị viên” / “Hệ thống”) |
| `old_status`, `new_status` | Trạng thái trước / sau |
| `message` | Mô tả (lý do chỉnh sửa, ghi chú xác nhận, …) |
| `created_at` | Thời điểm |
| `metadata` | JSON: IP đã hash, user-agent, số nội dung, ID file chữ ký/PDF, **nội dung cũ trước khi sửa** |

Hệ thống không ghi log `VIEWED` (mỗi lần xem) để tránh phình dữ liệu.

## 6. `CAU_HINH` — cấu hình hiển thị (không chứa secret)

| key | Mặc định | Ý nghĩa |
|---|---|---|
| `ORG_NAME` | DIỆU TƯỚNG AM | Tên đơn vị trên PDF |
| `ORG_FULL_NAME` | | Tên pháp lý (tùy chọn) |
| `ORG_ADDRESS` | | Địa chỉ (tùy chọn) |
| `PDF_TITLE` | BIÊN BẢN BÀN GIAO | Tiêu đề PDF |
| `PDF_SHOW_NATIONAL_HEADER` | TRUE | In Quốc hiệu – Tiêu ngữ |
| `LOGO_FILE_ID` | | ID file logo trên Drive |
| `PDF_FOOTER` | Biên bản được xác nhận điện tử… | Chú thích cuối PDF |

## 7. Script Properties (Apps Script)

| Property | Ai đặt | Mô tả |
|---|---|---|
| `BACKEND_SHARED_SECRET` | Quản trị viên | Secret HMAC dùng chung với Worker |
| `SPREADSHEET_ID` | `setupDatabase()` / quản trị viên | ID Google Sheet |
| `DRIVE_FOLDER_ID` | `setupDatabase()` / quản trị viên | ID thư mục gốc `DTA_HANDOVER` |
| `USE_ADVANCED_DRIVE` | Quản trị viên (tùy chọn) | `true` để dùng Drive API v3 (Shared Drive) |
| `HANDOVER_SEQ` | Hệ thống | Bộ đếm mã biên bản trong ngày (`YYYYMMDD:n`) |
| `FOLDER_<LOẠI>_<YYYY>_<MM>` | Hệ thống | ID thư mục tháng đã tạo (tránh duyệt lại) |

## 8. Google Drive

```text
DTA_HANDOVER/
├── signatures/2026/10/BG-20261003-0001-signature.png
├── pdf/2026/10/BG-20261003-0001.pdf
└── backups/DTA Handover – Database – backup 2026-10-04 0200
```

- Chữ ký: PNG nền trắng, đã cắt sát vùng ký, tối đa 600×300 (≤ 300KB). Sheet **không** lưu base64.
- File private (chỉ chủ sở hữu script); người dùng xem/tải qua Worker sau khi kiểm tra quyền (admin) hoặc token (người nhận
  tải PDF của chính biên bản đã xác nhận).
- “Tạo lại PDF” đưa file cũ vào thùng rác Drive (khôi phục được trong 30 ngày).

## 9. Chỉnh sửa dữ liệu trực tiếp — nên & không nên

| Được phép sửa trực tiếp | Không nên sửa tay |
|---|---|
| `NHAN_VIEN` (thêm, sửa, đổi `status`) | `BAN_GIAO.status`, `public_token_hash`, `public_token_nonce`, các cột file |
| `LOAI_BAN_GIAO` (thêm loại, đổi nhãn, tắt loại) | `CHI_TIET_BAN_GIAO.handover_id`, `item_id` |
| `CAU_HINH` | `LICH_SU` (nhật ký kiểm toán) |
| Thêm cột riêng ở bất kỳ sheet nào | Đổi tên / xóa cột hệ thống |

Sau khi sửa `NHAN_VIEN` / `LOAI_BAN_GIAO` / `CAU_HINH`: *Làm mới dữ liệu NV* (trang admin) hoặc menu *Làm mới cache*.
