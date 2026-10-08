# Cấu trúc dữ liệu (Google Sheets + Google Drive) — v2

Hệ thống đọc/ghi theo **tên cột ở dòng 1**, không theo vị trí → có thể đổi thứ tự cột hoặc thêm cột riêng (ghi chú nội bộ,
công thức) mà không ảnh hưởng. Không đổi tên / xóa các cột dưới đây. `setupDatabase()` / `upgradeOfficeSupplyModule()`
tự bổ sung sheet / cột thiếu (không xóa, không ghi đè; tự sao lưu trước khi đổi cấu trúc nếu Sheet đã có dữ liệu).

Quy ước chung:

- ID là **UUID bất biến** (`handover_id`, `item_id`, `log_id`, `product_id`, `movement_id`…) — **không** dùng số dòng làm ID.
  Trước mỗi lần ghi, hệ thống tìm lại dòng theo ID (không tin số dòng đã đọc), chỉ ghi các ô thay đổi; sắp xếp / lọc / chèn
  dòng trên Sheet trong lúc hệ thống đang ghi không làm ghi nhầm dòng.
- Hệ thống **không xóa dòng** dữ liệu nghiệp vụ: sửa phiếu đánh dấu dòng nội dung cũ `superseded_at`; sản phẩm ngừng dùng
  chuyển `ARCHIVED`; biến động kho chỉ thêm mới.
- Thời gian lưu dạng **ISO 8601 giờ Việt Nam**: `2026-10-03T18:07:00+07:00`. Giao diện hiển thị `DD/MM/YYYY HH:mm`
  theo giờ Việt Nam (không phụ thuộc múi giờ máy người xem).
- Ô dữ liệu định dạng **văn bản thuần (`@`)** → giữ nguyên `0519`, `2026-10-15`; giá trị bắt đầu bằng `= + - @` được lưu
  kèm dấu `'` (chống chèn công thức). Ký tự điều khiển, ký tự định hướng chữ (bidi) và ký tự vô hình bị loại bỏ.
- Ngày không giờ dạng `YYYY-MM-DD`. Ô đúng/sai dạng `TRUE` / `FALSE`.
- Số gõ tay vào ô văn bản được đọc theo kiểu Việt Nam: `55.600` = 55 600, `1.000.000` = 1 000 000, `12,5` = 12,5 (hệ thống tự
  ghi dạng `55600`, `12.5`; đơn giá làm tròn tối đa 2 chữ số lẻ). Cách viết hiểu được hai nghĩa (`1,500`) hoặc không phải số →
  coi là **không hợp lệ** (không đoán): số tồn thành “chưa rõ” và hiện ở *Dữ liệu cần kiểm tra*.

## 1. `NHAN_VIEN` — danh sách nhân viên (quản trị viên nhập)

| Cột | Bắt buộc | Mô tả |
|---|---|---|
| `employee_id` | ✔ | Mã nhân viên, **duy nhất** (ví dụ `519`, `NV-0519`) |
| `full_name` | ✔ | Họ tên đầy đủ có dấu |
| `department` | | Phòng ban — quyết định **định mức văn phòng phẩm** áp dụng (xem `VPP_DINH_MUC`) |
| `position` | | Chức vụ |
| `email` | | Email (hiển thị khi chọn người nhận, dùng nút “Gửi qua email”) |
| `phone` | | Số điện thoại — **không** trả về qua bất kỳ API nào |
| `status` | | `ACTIVE` hoặc để trống = đang làm việc · `INACTIVE` (hoặc giá trị khác) = không chọn được, không đề xuất VPP được |
| `created_at`, `updated_at` | | Tùy chọn, để tham khảo |

Dòng trùng `employee_id`: hệ thống dùng dòng đầu tiên — nên tránh trùng. Danh sách nhân viên chỉ trả cho **quản trị viên**;
trang đề xuất công khai chỉ tra **một** người theo mã. Biên bản lưu **bản chụp** thông tin người nhận lúc tạo.

## 2. `BAN_GIAO` — phiếu bàn giao (hệ thống ghi; không sửa tay)

| Cột | Mô tả |
|---|---|
| `handover_id` | UUID phiếu |
| `handover_code` | Mã hiển thị `BG-YYYYMMDD-XXXX` (theo ngày giờ Việt Nam, tăng dần trong ngày, không trùng) |
| `handover_type` | Loại phiếu: `ASSET` · `OFFICE_SUPPLY` · `ACCOUNT` · `DOCUMENT` · `WORK` · `OTHER` *(v2; phiếu v1 để trống → suy ra từ loại nội dung)* |
| `sender_name`, `sender_employee_id` | Người giao (chọn từ danh sách hoặc nhập tên; mã có thể trống) |
| `receiver_employee_id`, `receiver_name`, `receiver_department`, `receiver_position`, `receiver_email` | Bản chụp thông tin người nhận |
| `status` | `PENDING` · `CONFIRMED` · `REVISION_REQUESTED` · `CANCELLED` |
| `public_token_hash` | `SHA-256(token)` của link xác nhận (hex 64 ký tự). **Không lưu token gốc** |
| `public_token_nonce` | Nonce để Worker dựng lại link khi admin “Copy link”; vô dụng nếu không có `SESSION_SECRET` |
| `created_at`, `updated_at` | Thời điểm tạo / cập nhật nội dung (tạo link mới không đổi `updated_at`) |
| `created_by` | Quản trị viên lập phiếu, dạng `Tên (username)` *(v2)* |
| `created_ip_hash`, `created_user_agent` | HMAC IP và trình duyệt lúc tạo — để cảnh báo “ký trên cùng thiết bị với người lập” *(user agent: v2)* |
| `client_request_id` | Mã chống gửi trùng do trình duyệt sinh — gửi lại cùng mã **đúng nội dung** trả về phiếu đã tạo; khác nội dung → `REQUEST_REUSED` (không trả phiếu cũ như “đã tạo”) *(v2)* |
| `vpp_scope_id` | Phạm vi định mức VPP chốt lúc tạo phiếu (`KINH_DOANH`, `VAN_PHONG`…) *(v2)* |
| `confirmed_at`, `confirmed_ip_hash`, `user_agent` | Thời điểm, HMAC IP, trình duyệt lúc người nhận ký |
| `content_hash` | SHA-256 nội dung người nhận **đã ký** (người giao / nhận / ghi chú / từng dòng nội dung) *(v2)* |
| `signature_sha256` | SHA-256 file PNG chữ ký *(v2)* |
| `rejected_at` | Dự phòng (chưa dùng) |
| `revision_requested_at`, `receiver_comment` | Lần gần nhất người nhận yêu cầu chỉnh sửa / ghi chú khi ký (lịch sử đầy đủ ở `LICH_SU`) |
| `signature_file_id`, `signature_file_url` | File PNG chữ ký trên Drive (private) |
| `pdf_file_id`, `pdf_file_url` | File PDF trên Drive (private) |
| `note` | Ghi chú chung của phiếu |
| `cancelled_at`, `cancel_reason` | Thời điểm & lý do hủy |
| `confirm_method` | Cách người nhận xác thực khi ký: `OTP_EMAIL` (nhập đúng mã gửi tới email) · `NO_EMAIL` (chưa có email — ký không mã) · `OTP_OFF` (đã tắt `CONFIRM_OTP`); trống = ký trước khi có tính năng *(v2)* |
| `items_revision` | Phiên bản nội dung **đã chốt**: chỉ dòng `CHI_TIET_BAN_GIAO` có `revision_id` này là nội dung hiện tại (trống = phiếu cũ — mọi dòng chưa `superseded_at`) *(v2)* |
| `edit_pending` | Dấu “đang sửa” (phiên bản mới, mã nội dung gốc, thời điểm, người nhận gốc). Chỉ còn lại khi lần lưu sửa phiếu lỗi giữa chừng: người nhận chưa ký / yêu cầu sửa được, link vẫn hiện nội dung trước khi sửa; quản trị viên lưu lại để hoàn tất *(v2)* |
| `record_hash` | SHA-256 **toàn biên bản** lúc ký: nội dung (`content_hash`) + mã / thời điểm lập + thời điểm ký + ý kiến người nhận + cách xác thực + mã băm và file chữ ký *(v2)* |
| `record_seal` | Niêm phong = HMAC(`record_hash`) bằng khóa Worker suy ra từ `RECORD_SEAL_SECRET` (khóa **không** lưu ở Google). Trống = ký khi chưa cấu hình secret *(v2)* |

**Toàn vẹn:** sau khi ký, mọi thay đổi trên Sheet ở phần PDF chứng nhận bị phát hiện — nội dung (`content_hash`), ý kiến người
nhận / thời điểm / chữ ký (`record_hash`), kể cả khi người sửa tự tính lại mã băm (`record_seal`) → trang quản trị hiện
**MISMATCH** (kèm phần nào không khớp), hệ thống từ chối tạo lại PDF và hiện chữ ký (`INTEGRITY_ERROR`). Phiếu ký từ v1 (không có
`content_hash`) hiện **LEGACY**; ký trước khi có `record_hash` → chỉ kiểm tra nội dung.

## 3. `CHI_TIET_BAN_GIAO` — nội dung phiếu (1 phiếu → N dòng)

| Cột | Mô tả |
|---|---|
| `item_id` | UUID |
| `handover_id` | Liên kết `BAN_GIAO.handover_id` |
| `item_order` | Thứ tự hiển thị (1, 2, 3…) |
| `category` | Mã loại nội dung (`THIET_BI_CNTT`, `THE`, `VAN_PHONG_PHAM`…) — xem `LOAI_BAN_GIAO` |
| `item_name` | Tên thiết bị / loại thẻ / tài khoản-hệ thống / công việc / hồ sơ / văn phòng phẩm |
| `asset_code` | Mã tài sản / mã thẻ / username |
| `serial_number`, `model` | Serial, model |
| `quantity`, `unit` | Số lượng (số nguyên ≥ 1 hoặc trống), ĐVT *(unit: v2)* |
| `condition`, `description`, `work_status`, `deadline`, `document_url`, `note` | Tình trạng, mô tả / nơi lưu, tình trạng công việc, hạn `YYYY-MM-DD`, link `http(s)://`, ghi chú |
| `product_id` | Sản phẩm `VPP_SAN_PHAM` (phiếu văn phòng phẩm) *(v2)* |
| `affects_inventory` | `TRUE` = dòng này giữ chỗ / xuất kho *(v2)* |
| `over_norm_reason` | Lý do vượt định mức (chỉ quản trị viên thấy) *(v2)* |
| `superseded_at` | Thời điểm dòng bị thay thế khi admin sửa phiếu — dòng cũ **giữ lại**, không xóa *(v2)* |
| `revision_id` | Phiên bản nội dung của dòng — dòng của lần sửa chưa chốt (`BAN_GIAO.items_revision` khác) không bao giờ hiện / được ký *(v2)* |
| `created_at` | Thời điểm ghi |

**Không có cột mật khẩu**: hệ thống từ chối nội dung dạng `mật khẩu: …`, `password = …`, `MK: …` ở mọi trường.

## 4. `LOAI_BAN_GIAO` — loại nội dung & form nhập

| Cột | Mô tả |
|---|---|
| `code` | Mã loại: chữ IN HOA, số, `_` (≤ 40 ký tự), **duy nhất**, không đổi sau khi đã dùng |
| `name` | Tên hiển thị |
| `form_fields` | Danh sách trường của form (cú pháp bên dưới) |
| `hint` | Ghi chú hiển thị trên form |
| `sort_order` | Thứ tự trong danh sách chọn |
| `status` | `ACTIVE` / trống = đang dùng · `INACTIVE` = **không dùng được cho phiếu mới** (phiếu cũ vẫn hiển thị và sửa được) |
| `handover_type` | Loại phiếu chứa loại nội dung này: `ASSET`, `ACCOUNT`, `DOCUMENT`, `WORK`, `OTHER`, `OFFICE_SUPPLY` *(v2)*. Phiếu loại “Khác” dùng được mọi loại nội dung (trừ văn phòng phẩm). |
| `created_at`, `updated_at` | Tham khảo |

**Cú pháp `form_fields`**: các trường cách nhau bởi `|`, mỗi trường `<tên_cột>[*]:<Nhãn>`; `*` = bắt buộc.
`<tên_cột>` là một cột của `CHI_TIET_BAN_GIAO`: `item_name`, `asset_code`, `serial_number`, `model`, `quantity`, `unit`,
`condition`, `description`, `work_status`, `deadline`, `document_url`, `note`.

Loại mặc định:

| code | name | handover_type | form_fields |
|---|---|---|---|
| `THIET_BI_CNTT` | Thiết bị CNTT | ASSET | `item_name*:Tên thiết bị\|asset_code:Mã tài sản\|serial_number:Serial\|model:Model\|quantity:Số lượng\|condition:Tình trạng\|description:Phụ kiện / mô tả\|note:Ghi chú` |
| `TAI_SAN` | Tài sản | ASSET | `item_name*:Tên tài sản\|asset_code:Mã tài sản\|serial_number:Số seri\|quantity:Số lượng\|condition:Tình trạng\|description:Mô tả\|note:Ghi chú` |
| `THE` | Thẻ | ASSET | `item_name*:Loại thẻ\|asset_code:Mã thẻ\|quantity:Số lượng\|condition:Tình trạng\|note:Ghi chú` |
| `TAI_KHOAN` | Tài khoản | ACCOUNT | `item_name*:Tên tài khoản / hệ thống\|asset_code:Username\|description:Mô tả\|note:Ghi chú` |
| `CONG_VIEC` | Công việc | WORK | `item_name*:Tên công việc\|description:Nội dung\|work_status:Tình trạng hiện tại\|deadline:Deadline\|document_url:Link tài liệu\|note:Ghi chú` |
| `HO_SO` | Hồ sơ | DOCUMENT | `item_name*:Tên hồ sơ\|quantity:Số lượng\|condition:Tình trạng\|description:Nơi lưu\|note:Ghi chú` |
| `KHAC` | Khác | OTHER | `description*:Nội dung bàn giao\|quantity:Số lượng\|note:Ghi chú` |
| `VAN_PHONG_PHAM` | Văn phòng phẩm | OFFICE_SUPPLY | Do hệ thống quản lý — phiếu VPP chọn sản phẩm từ kho, không nhập tay |

## 5. `LICH_SU` — nhật ký thao tác (không sửa / xóa)

| Cột | Mô tả |
|---|---|
| `log_id` | UUID |
| `handover_id` | ID đối tượng liên quan (phiếu, sản phẩm, định mức, đề xuất — theo `entity_type`) |
| `entity_type` | `HANDOVER` (trống = phiếu, dữ liệu v1) · `VPP_PRODUCT` · `VPP_NORM` · `VPP_PROPOSAL` *(v2)* |
| `action` | `CREATED`, `UPDATED`, `CONFIRMED` (metadata `confirmMethod`, `otpEmail` đã che), `REVISION_REQUESTED`, `CANCELLED`, `LINK_REGENERATED`, `PDF_GENERATED`, `STOCK_SYNC_FAILED` (ký nhưng chưa xuất kho được), `VPP_PRODUCT_*`, `VPP_STOCK_SYNCED`, `VPP_NORM_*`, `VPP_SCOPE_MAPPED`, `VPP_PROPOSAL_*`, `VPP_REVIEW_SKIPPED`… |
| `actor` | Người thực hiện: quản trị viên `Tên (username)`, người nhận, nhân viên đề xuất `Tên (mã NV)`, “Hệ thống” |
| `old_status`, `new_status` | Trạng thái trước / sau |
| `message` | Mô tả (lý do chỉnh sửa, số lượng thay đổi, ghi chú…) |
| `created_at` | Thời điểm |
| `metadata` | JSON: HMAC IP, user-agent, nội dung cũ trước khi sửa, ID file… |

Không ghi log mỗi lần xem phiếu (tránh phình dữ liệu).

## 6. `CAU_HINH` — cấu hình (không chứa secret)

| key | Mặc định | Ý nghĩa |
|---|---|---|
| `ORG_NAME` | DIỆU TƯỚNG AM | Tên đơn vị trên PDF |
| `ORG_FULL_NAME`, `ORG_ADDRESS` | | Tên pháp lý, địa chỉ (tùy chọn) |
| `PDF_TITLE` | BIÊN BẢN BÀN GIAO | Tiêu đề PDF |
| `PDF_TITLE_VPP` | BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM | Tiêu đề PDF phiếu văn phòng phẩm *(v2)* |
| `PDF_SHOW_NATIONAL_HEADER` | TRUE | In Quốc hiệu – Tiêu ngữ |
| `LOGO_FILE_ID` | | ID file logo trên Drive (PNG / JPEG) |
| `PDF_FOOTER` | Biên bản được xác nhận điện tử… | Chú thích cuối PDF |
| `CONFIRM_OTP` | EMAIL | Mã xác nhận khi ký: `EMAIL` = bắt buộc nếu người nhận có email (chưa có email vẫn ký, phiếu bị đánh dấu) · `REQUIRED` = luôn bắt buộc (chưa có email thì không ký được) · `OFF` = tắt *(v2)* |
| `NOTIFY_EMAILS` | *(trống)* | Email nhận thông báo, cách nhau bởi dấu phẩy (tối đa 20): yêu cầu chỉnh sửa, đề xuất mua mới, cần đối soát kho, tổng hợp hằng ngày. Trống = không gửi *(v2)* |
| `APP_URL` | https://bangiao.dieutuongam.com | Địa chỉ trang dùng cho link trong email thông báo *(v2)* |
| `VPP_SCOPE:<PHÒNG BAN>` | | Gắn phòng ban → phạm vi định mức (mã phạm vi, hoặc `NONE`). Sửa qua trang *Định mức* *(v2)* |

`setupDatabase()` / nâng cấp chỉ **thêm** khóa còn thiếu — không ghi đè giá trị đã sửa (11 khóa mặc định).

## 7–12. Văn phòng phẩm *(v2)*

### 7. `VPP_SAN_PHAM` — danh mục sản phẩm

`product_id` · `product_code` (`VPP-0001`… hoặc mã tự đặt, duy nhất) · `product_name` · `normalized_name` (tên chuẩn hóa không
dấu để chống trùng) · `category` · `unit` · `reference_price` (đơn giá tham khảo) · `minimum_stock` · `catalog_status`
(`MASTER` / `TEMP` / `PENDING_APPROVAL` / `ARCHIVED`) · `active` · `source` (`NORM_SEED` / `INITIAL_STOCK` / `PROPOSAL` / `ADMIN`)
· `created_at` · `updated_at` · `review_status` (`PENDING` / `MAPPED` / `RESOLVED` / `SKIPPED`) · `merged_into_product_id` · `note`.

### 8. `VPP_DINH_MUC` — định mức tháng

`norm_id` · `product_id` · `scope_type` (`DEPARTMENT`) · `scope_id` · `scope_name` · `monthly_quantity` · `unit` ·
`reference_price` · `note` · `effective_from` · `effective_to` · `active` · `created_at` · `updated_at` · `source_ref`
(vị trí dòng trên bản định mức nguồn — `… · STT n`; “Khởi tạo định mức” dùng phạm vi + STT để không tạo trùng khi chạy lại,
kể cả sau khi đã sửa tên / ĐVT sản phẩm). Không trùng (phạm vi + sản phẩm) trong thời gian hiệu lực.

### 9. `VPP_TON_KHO` — tồn kho (1 dòng / sản phẩm)

`product_id` · `on_hand` (**trống = chưa rõ**; số gõ tay âm / có phần lẻ / không phải số cũng là chưa rõ — giữ nguyên chữ đã gõ
để hiện, kiểm kê tính chênh lệch từ 0) · `reserved` · `minimum_stock` · `raw_initial_value` · `needs_review` ·
`updated_at` · `updated_by`. `available = on_hand − reserved` tính động, không lưu. Chỉ thay đổi qua biến động kho; mọi kiểm tra
đủ tồn (tạo / sửa phiếu, lưu trữ sản phẩm) dùng số theo **sổ biến động** — đúng số mà bước giữ chỗ sẽ ghi.
Đây là **số tổng hợp** của `VPP_BIEN_DONG_KHO` (nguồn sự thật — luôn ghi trước): lệch nhau (ghi dở / sửa tay sheet) hiện ở mục
“Số tồn lệch sổ biến động kho” của *Dữ liệu cần kiểm tra*, nút *ĐỒNG BỘ THEO SỔ* sửa lại (có lịch sử `VPP_STOCK_SYNCED`).

### 10. `VPP_BIEN_DONG_KHO` — biến động kho (chỉ thêm, không sửa / xóa)

`movement_id` · `product_id` · `movement_type` (`INITIAL` / `IN` / `RESERVE` / `RELEASE` / `OUT` / `ADJUSTMENT`) · `quantity`
· `on_hand_before` · `on_hand_after` · `reserved_before` · `reserved_after` · `handover_id` · `proposal_id` · `operation_id`
(khóa chống ghi trùng: `HANDOVER_RESERVE:{id}`, `HANDOVER_CONFIRM:{id}`, `PROPOSAL_RECEIVE:{id}:{dòng}`, `STOCK_IN:{uuid}`,
`ADJUST:{uuid}`, `MERGE:{id}`, `INITIAL_STOCK:v1:{n}`…) · `actor_id` · `actor_name` · `reason` · `created_at`.

### 11. `VPP_DE_XUAT` — đề xuất mua

`proposal_id` · `proposal_code` (`DX-YYYYMMDD-XXXX`) · `requester_employee_id` · `requester_name` · `department` · `status`
(`SUBMITTED` / `APPROVED` / `PARTIALLY_APPROVED` / `REJECTED` / `PURCHASED` / `RECEIVED` / `CLOSED`) · `reason` ·
`estimated_total` · `created_at` · `updated_at` · `reviewed_at` · `reviewed_by` · `requester_position` · `scope_id` ·
`admin_note` · `client_request_id` · `received_at` · `closed_at`.

### 12. `VPP_DE_XUAT_CHI_TIET` — dòng đề xuất

`proposal_item_id` · `proposal_id` · `product_id` · `temporary_product_name` · `is_outside_norm` · `unit` ·
`requested_quantity` · `norm_quantity` · `approved_quantity` · `reference_price` · `approved_price` · `reason` · `note` ·
`product_approval_status` (`NOT_REQUIRED` / `PENDING` / `APPROVED_MASTER` / `KEPT_TEMP` / `MAPPED` / `REJECTED`) ·
`reference_url` · `received_quantity` · `item_order`.

## 13. Script Properties (Apps Script)

| Property | Ai đặt | Mô tả |
|---|---|---|
| `BACKEND_SHARED_SECRET` | Quản trị viên | Secret HMAC dùng chung với Worker |
| `SPREADSHEET_ID` | `setupDatabase()` / quản trị viên | ID Google Sheet |
| `DRIVE_FOLDER_ID` | `setupDatabase()` / quản trị viên | ID thư mục gốc `DTA_HANDOVER` |
| `USE_ADVANCED_DRIVE` | Quản trị viên (tùy chọn) | `true` để dùng Drive API v3 (Shared Drive) |
| `SCHEMA_VERSION` | `upgradeOfficeSupplyModule()` | Phiên bản cấu trúc dữ liệu (v2 = `2`). Thấp hơn yêu cầu → mọi thao tác (trừ kiểm tra sức khỏe) báo `NOT_CONFIGURED`, không ghi nửa vời. Đủ phiên bản nhưng sheet thiếu cột code cần → cũng báo `NOT_CONFIGURED` (kèm tên cột) |
| `HANDOVER_SEQ`, `VPP_PROPOSAL_SEQ`, `VPP_PRODUCT_SEQ` | Hệ thống | Bộ đếm mã phiếu / đề xuất / sản phẩm (luôn lấy max với dữ liệu thật — xóa property không gây trùng mã) |
| `FOLDER_<LOẠI>_<YYYY>_<MM>` | Hệ thống | ID thư mục tháng đã tạo |
| `NOTIFY_STATUS` | Hệ thống | JSON kết quả gửi email gần nhất (`lastOkAt`, `lastOkEvent`, `lastError { at, event, message }`) — trang Tổng quan / Cài đặt hiện lỗi gửi mail *(v2)* |
| `VPP_STOCK_DIRTY` | Hệ thống | Danh sách sản phẩm đang ghi kho dở. Chỉ còn lại sau lỗi giữa chừng → lần ghi kho kế tiếp tự tính lại tồn các sản phẩm đó từ sổ biến động rồi xóa *(v2)* |
| `POST_COMMIT_ERRORS` | Hệ thống | Lỗi ở bước phụ sau khi thao tác đã lưu (ghi lịch sử, gửi mail…) — tối đa 20 lỗi / 7 ngày, hiện ở trang Cài đặt *(v2)* |
| `DAILY_DIGEST_SENT_DAY` | Hệ thống | Ngày đã gửi email tổng hợp — nhiều trigger (mỗi người cài một cái) vẫn chỉ gửi một email / ngày; gửi lỗi thì xóa để lần sau gửi lại *(v2)* |
| `LAST_SCHEDULED_BACKUP_AT` | Hệ thống | Lần sao lưu tự động gần nhất — trigger trùng không sao lưu thêm trong 6 ngày *(v2)* |

**CacheService** (tự hết hạn, không phải dữ liệu nghiệp vụ): `otp:<handover_id>` (HMAC mã OTP, hạn, số lần sai — 10 phút),
`otp-send:<handover_id>` (bộ đếm gửi mã — 6 giờ), `schema-ok:<dấu vân tay>` (kết quả kiểm tra đủ cột — 10 phút), cache nhân viên /
loại nội dung / cấu hình / danh mục, bộ đếm giới hạn tần suất.

## 14. Google Drive

```text
DTA_HANDOVER/
├── signatures/2026/10/BG-20261003-0001-signature.png
├── pdf/2026/10/BG-20261003-0001.pdf
├── pdf-archive/2026/10/…            ← bản PDF cũ khi “Tạo lại PDF” (không xóa, không đưa vào thùng rác)
└── backups/DTA Handover – … backup trước nâng cấp / backup 2026-10-04 0200
```

- Chữ ký: PNG nền trắng, cắt sát vùng ký, tối đa 600×300 (≤ 300KB). Sheet **không** lưu base64.
- File private (chỉ chủ sở hữu script); người dùng tải qua Worker sau khi kiểm tra quyền (admin) hoặc token (người nhận tải
  PDF của chính phiếu đã xác nhận). Hệ thống chỉ trả file **nằm trong thư mục `DTA_HANDOVER`** và đúng định dạng (PNG / PDF) —
  ID file bị sửa trỏ ra ngoài sẽ bị từ chối.

## 15. Chỉnh sửa dữ liệu trực tiếp — nên & không nên

| Được phép sửa trực tiếp | Không sửa tay (dùng trang quản trị) |
|---|---|
| `NHAN_VIEN` (thêm, sửa, đổi `status`) | `BAN_GIAO` (trạng thái, token, `content_hash`, `record_hash` / `record_seal`, `items_revision` / `edit_pending`, các cột file) — sửa phiếu đã ký sẽ bị đánh dấu MISMATCH |
| `LOAI_BAN_GIAO` (thêm loại, đổi nhãn, tắt loại) | `CHI_TIET_BAN_GIAO` |
| `CAU_HINH` (trừ khóa `VPP_SCOPE:` — dùng trang *Định mức*) | `LICH_SU`, `VPP_BIEN_DONG_KHO` (nhật ký kiểm toán) |
| Thêm cột riêng ở bất kỳ sheet nào | `VPP_TON_KHO` (tồn chỉ đổi qua nhập kho / phiếu / kiểm kê), `VPP_*` khác |

Menu *DTA Handover → Khóa sheet hệ thống* khóa các sheet hệ thống (chỉ chủ script ghi được).
Sau khi sửa `NHAN_VIEN` / `LOAI_BAN_GIAO` / `CAU_HINH`: nút *Làm mới dữ liệu* (trang quản trị) hoặc menu *Làm mới cache*.
