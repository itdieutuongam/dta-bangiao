# Thiết lập Google (Sheets + Apps Script + Drive)

Thực hiện bằng **một tài khoản Google sở hữu dữ liệu** (nên là tài khoản dịch vụ/phòng IT của công ty, không phải tài
khoản cá nhân của một nhân viên có thể nghỉ việc). Tài khoản này sở hữu Sheet, thư mục Drive và chạy Web App.

## Bước 1 — Tạo Google Sheet

1. Mở <https://sheets.new>, đặt tên **DTA Handover – Database**.
2. Giữ nguyên sheet mặc định — `setupDatabase()` sẽ tạo các sheet cần thiết và xóa sheet trống mặc định.

## Bước 2 — Tạo Apps Script gắn với Sheet

1. Trong Sheet: **Extensions → Apps Script** (giao diện tiếng Việt: **Tiện ích → Apps Script**).
2. **Cách nhanh — 1 file:** chạy `npm run gas:bundle`, mở `dist/apps-script/DTA_Handover.gs`, chọn tất cả (Ctrl+A),
   sao chép, rồi trong editor mở file `Code.gs` (tiếng Việt: `Mã.gs`), chọn tất cả và **dán đè** → **Lưu** (Ctrl+S).
   Dự án chỉ giữ **một** file `.gs` này — xóa mọi file `.gs` khác (ví dụ file của bản cũ): file nạp sau ghi đè code mới, Apps
   Script khi đó từ chối mọi thao tác ("trộn code nhiều phiên bản"). Bỏ qua bước 3.
3. **Hoặc nhiều file:** xóa nội dung `Code.gs` mặc định, tạo đủ các file (nút **+ → Script**, nhập tên không kèm `.gs`)
   và dán nội dung tương ứng từ thư mục `apps-script/`:

   | File | Nội dung |
   |---|---|
   | `Code.gs` | `doGet`, `doPost`, bảng action → handler (scope), kiểm tra phiên bản dữ liệu |
   | `Config.gs` | Hằng số, cấu trúc cột, loại bàn giao mặc định, dữ liệu mẫu |
   | `Security.gs` | Xác thực HMAC, chống replay, giới hạn tần suất, người thực hiện |
   | `Utils.gs` | Tiện ích thời gian, chuỗi, khóa, cache, đọc/ghi Sheet theo lô (ghi theo ID bất biến) |
   | `Employees.gs` | Nhân viên, loại bàn giao, cấu hình, phòng ban → phạm vi định mức (có cache) |
   | `Handovers.gs` | Nghiệp vụ phiếu (tạo, xác nhận, chỉnh sửa, toàn vẹn, admin) |
   | `Notify.gs` | Email qua MailApp: mã xác nhận (OTP) khi ký, thông báo cho quản trị viên, email tổng hợp hằng ngày |
   | `Drive.gs` | Lưu chữ ký / đọc file trên Drive (chỉ trong thư mục hệ thống) |
   | `Pdf.gs` | Sinh PDF phiếu (kể cả phiếu văn phòng phẩm) |
   | `Export.gs` | Dựng file CSV cho nút “Xuất CSV” của trang quản trị (chống chèn công thức, ngày giờ Việt Nam) |
   | `Setup.gs` | `setupDatabase`, `checkSetup`, dữ liệu mẫu, sao lưu, khóa sheet, menu |
   | `Vpp.gs` | Kho văn phòng phẩm: tồn, giữ chỗ / xuất kho, định mức, nhập kho, kiểm kê, rà soát dữ liệu |
   | `VppProposals.gs` | Đề xuất mua văn phòng phẩm |
   | `VppSetup.gs` | `upgradeOfficeSupplyModule`, `seedOfficeSupplyNorms`, `seedInitialOfficeSupplyStock` |

   Đủ 14 file như bảng trên (thiếu file — ví dụ `Notify.gs` — thì mọi request báo `NOT_CONFIGURED` "thiếu code …" và menu
   *Kiểm tra cấu hình* báo ✗; còn file `.gs` của bản cũ thì báo "trộn code nhiều phiên bản"). Thứ tự file không quan trọng:
   code top-level chỉ khai báo hàm / hằng số dạng literal (có kiểm thử nạp theo thứ tự đảo ngược / xen kẽ).
4. **Project Settings (⚙)**:
   - *Time zone*: `(GMT+07:00) Bangkok, Hanoi, Jakarta` (`Asia/Ho_Chi_Minh`).
   - Bật **Show "appsscript.json" manifest file in editor**, mở `appsscript.json` và thay bằng nội dung file
     `apps-script/appsscript.json`.

> Dùng dòng lệnh thay cho copy/paste: xem mục *clasp* trong [apps-script/README.md](../apps-script/README.md).

## Bước 3 — Script Properties (secret)

Tạo secret (dùng chung với Cloudflare):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Chọn **một** trong hai cách lưu khóa vào Script Property `BACKEND_SHARED_SECRET` (≥ 32 ký tự, **giống hệt**
`GAS_SHARED_SECRET` bên Cloudflare / `.dev.vars`):

- **Dễ nhất — từ Google Sheet:** tải lại Sheet (F5) → menu **DTA Handover → Thiết lập / cập nhật database**. Nếu chưa có
  khóa, hộp thoại sẽ hỏi — dán khóa → OK (bước 4 chạy luôn). Đổi khóa sau này:
  **DTA Handover → Nhập / đổi khóa kết nối (BACKEND_SHARED_SECRET)**.
- **Hoặc trong Apps Script:** ⚙ **Project Settings** (tiếng Việt: *Cài đặt dự án*) → kéo xuống **Script properties**
  (*Thuộc tính tập lệnh*) → **Add script property** → Property `BACKEND_SHARED_SECRET`, Value = khóa → **Save**.

Không viết secret vào file `.gs`. `SPREADSHEET_ID`, `DRIVE_FOLDER_ID` để trống — `setupDatabase()` tự điền.

## Bước 4 — Chạy `setupDatabase()`

1. Trong Google Sheet: menu **DTA Handover → Thiết lập / cập nhật database** (hoặc trong editor: chọn hàm
   **`setupDatabase`** → **Run**). Chạy từ menu sẽ hỏi khóa kết nối nếu chưa có và hiện kết quả trong hộp thoại.
2. Lần đầu Google yêu cầu cấp quyền: *Review permissions* → chọn tài khoản → (tài khoản Gmail cá nhân có thể thấy cảnh báo
   *Google hasn't verified this app* — chọn *Advanced → Go to DTA Handover API*) → **Allow**. Nếu chạy từ menu, sau khi cấp
   quyền hãy bấm lại menu một lần nữa.
   Quyền cần: xem/sửa Google Sheets, Google Drive, **gửi email thay bạn** (mã xác nhận khi ký, thông báo), chạy khi bạn không
   có mặt, quản lý trigger (sao lưu / email tổng hợp tự động), hiển thị menu trong Sheet.
3. Xem **Execution log**:
   - tạo 12 sheet: `NHAN_VIEN`, `BAN_GIAO`, `CHI_TIET_BAN_GIAO`, `LOAI_BAN_GIAO`, `LICH_SU`, `CAU_HINH` và
     `VPP_SAN_PHAM`, `VPP_DINH_MUC`, `VPP_TON_KHO`, `VPP_BIEN_DONG_KHO`, `VPP_DE_XUAT`, `VPP_DE_XUAT_CHI_TIET`;
   - thêm 8 loại nội dung mặc định (kèm loại phiếu) và 11 khóa cấu hình (gồm `CONFIRM_OTP`, `NOTIFY_EMAILS`, `APP_URL`);
   - tạo thư mục Drive `DTA_HANDOVER/{signatures,pdf,backups}`;
   - lưu `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `SCHEMA_VERSION = 2`;
   - báo trạng thái `BACKEND_SHARED_SECRET`.
4. Tải lại Google Sheet → xuất hiện menu **DTA Handover** (thiết lập, nâng cấp v2, kiểm tra, khóa kết nối, nạp dữ liệu văn phòng
   phẩm, làm mới cache, dữ liệu mẫu, khóa sheet hệ thống, sao lưu, gửi thử email thông báo, bật email tổng hợp hằng ngày).

`setupDatabase()` / **Nâng cấp module Văn phòng phẩm (v2)** chạy lại bao nhiêu lần cũng được: chỉ thêm sheet/cột còn thiếu,
không xóa/ghi đè dữ liệu. Nếu Sheet đã có dữ liệu và cần đổi cấu trúc, hệ thống **tự sao lưu toàn bộ Spreadsheet** vào
`DTA_HANDOVER/backups` trước. Khi `SCHEMA_VERSION` < 2 **hoặc** sheet thiếu cột mà code cần, Apps Script từ chối mọi thao tác
(trừ kiểm tra sức khỏe) với `NOT_CONFIGURED` (kèm tên cột) — không chạy code mới trên cấu trúc cũ.

## Bước 4a — Email: mã xác nhận khi ký & thông báo

- **Cấp quyền gửi email:** menu **DTA Handover → Gửi thử email thông báo** (hoặc **Kiểm tra cấu hình**) → Google hỏi quyền “Gửi
  email thay bạn” → **Allow**. Thiếu quyền này, người nhận có email sẽ **không nhận được mã để ký** (chế độ mặc định `EMAIL`) —
  *Kiểm tra cấu hình* báo ✗ dòng “Gửi email (MailApp)”, trang *Cài đặt* của ứng dụng cũng báo.
- Sheet `CAU_HINH`:
  - `CONFIRM_OTP` = `EMAIL` (mặc định: bắt buộc mã khi người nhận có email trong `NHAN_VIEN`; chưa có email vẫn ký được nhưng phiếu bị
    đánh dấu) · `REQUIRED` (luôn bắt buộc — người nhận chưa có email không ký được) · `OFF` (không dùng mã).
  - `NOTIFY_EMAILS` = email quản trị viên nhận thông báo (cách nhau bởi dấu phẩy; trống = không gửi): người nhận yêu cầu chỉnh sửa,
    đề xuất mua mới, phiếu văn phòng phẩm đã ký nhưng chưa xuất kho được.
  - `APP_URL` = địa chỉ trang (mặc định `https://bangiao.dieutuongam.com`) — link trong email thông báo.
- Email tổng hợp hằng ngày (~8h sáng, chỉ gửi khi có việc): menu **DTA Handover → Bật email tổng hợp hằng ngày** (chạy lại không
  tạo trùng trigger).
- Hạn mức gửi của Google: ~100 người nhận / ngày (Gmail thường), ~1.500 (Google Workspace). Còn dưới 20 → hệ thống tạm dừng email
  thông báo để dành cho mã xác nhận. Lỗi gửi luôn hiện trên trang *Tổng quan* / *Cài đặt* của ứng dụng.
- Email nhân viên trong `NHAN_VIEN` phải đúng — mã gửi tới email hiện tại trong sheet (sửa xong bấm *Làm mới cache*).

## Bước 4b — Dữ liệu văn phòng phẩm (chạy một lần)

1. Menu **DTA Handover → Khởi tạo định mức VPP** (`seedOfficeSupplyNorms`): 24 sản phẩm danh mục + 30 dòng định mức
   (PHÒNG KINH DOANH 13, VĂN PHÒNG 17) theo bản định mức. Chạy lại không tạo trùng, không sửa định mức đã có.
2. Menu **DTA Handover → Nhập tồn đầu kỳ VPP (chạy 1 lần)** (`seedInitialOfficeSupplyStock`): 25 dòng tồn đầu kỳ thành sản
   phẩm tạm cần rà soát; giá trị chưa rõ (“hết năm”, thiếu ĐVT) giữ nguyên bản gốc. Không chạy tự động, không ghi đè tồn đã có.
3. Vào trang quản trị *Văn phòng phẩm → Dữ liệu cần kiểm tra* để ghép / tạo mới / bỏ qua — xem [VAN_PHONG_PHAM.md](VAN_PHONG_PHAM.md).
4. Menu **DTA Handover → Khóa sheet hệ thống** (`protectSystemSheets`): chỉ chủ script ghi được các sheet dữ liệu.

## Bước 5 — Dữ liệu nhân viên

- Thử nghiệm: chạy **`seedSampleEmployees`** (8 nhân viên mã `DEMO-…`, trong đó 1 người `INACTIVE`).
  Khi có dữ liệu thật: **`removeSampleEmployees`**.
- Dữ liệu thật: dán vào sheet `NHAN_VIEN` từ dòng 2 — hướng dẫn và file mẫu ở
  [apps-script/sample-data/](../apps-script/sample-data/README.md).
- Sau khi sửa trực tiếp sheet: menu **DTA Handover → Làm mới cache** (hoặc tự hết hạn sau 10 phút).

## Bước 6 — Kiểm tra

Chạy **`checkSetup`** (menu *Kiểm tra cấu hình*) → log phải kết thúc bằng `KẾT QUẢ: Cấu hình hợp lệ.` (không in giá trị secret);
dòng “Gửi email (MailApp)” phải là ✓ khi dùng mã xác nhận khi ký.

## Bước 7 — Deploy Web App

1. **Deploy → New deployment** → ⚙ **Select type → Web app**.
2. *Description*: `DTA Handover API v2`
3. **Execute as: Me (<tài khoản sở hữu>)**
4. **Who has access: Anyone**
5. **Deploy** → sao chép **Web app URL** (kết thúc bằng `/exec`) → đây là `GAS_WEB_APP_URL`.

Kiểm tra nhanh: mở URL trên trình duyệt → JSON `{"ok":true,"data":{"service":"dta-handover",…}}`.

### Vì sao “Anyone” mà vẫn an toàn?

- Cloudflare Worker gọi Web App **server-to-server** — không có phiên đăng nhập Google. Nếu chọn “Anyone with Google account”
  hoặc “Only myself”, Google trả trang đăng nhập HTML và Worker báo `UPSTREAM_ERROR`.
- Người dùng cuối **không** dùng URL này và không cần tài khoản Google.
- `doPost` từ chối mọi request không có chữ ký HMAC-SHA256 hợp lệ bằng `BACKEND_SHARED_SECRET`, timestamp quá 5 phút, hoặc
  `requestId` đã dùng. `doGet` chỉ trả thông báo trạng thái, không trả dữ liệu.
- “Execute as: Me” → script dùng quyền tài khoản sở hữu để đọc/ghi Sheet và Drive; file không cần chia sẻ công khai.

### Google Workspace

Nếu không thấy lựa chọn **Anyone** (chỉ có “Anyone within dieutuongam.com”), quản trị viên Workspace đã chặn chia sẻ Web App ra
ngoài. Cách xử lý: nhờ quản trị viên cho phép (*Admin console → Apps → Google Workspace → Drive and Docs → Sharing settings*),
hoặc tạo project bằng tài khoản được phép.

### Cập nhật code sau này

**Deploy → Manage deployments → ✏ (Edit) → Version: New version → Deploy.**
URL giữ nguyên → không phải đổi `GAS_WEB_APP_URL`. Nếu tạo *New deployment* mới, URL sẽ khác và phải cập nhật secret bên
Cloudflare. Nếu code mới dùng quyền mới (bản này thêm quyền **gửi email**), chạy menu *Kiểm tra cấu hình* để cấp quyền trước
khi tạo *New version* — Web App chạy bằng quyền đã cấp của chủ sở hữu.

**Nâng cấp từ v1 lên v2:** dán code mới → *New version* → menu **Nâng cấp module Văn phòng phẩm (v2)** → nạp dữ liệu văn phòng
phẩm (Bước 4b) → deploy Worker. Thứ tự đầy đủ: [README §19](../README.md#19-nâng-cấp-từ-v1-lên-v2).

## Bước 8 — (Tùy chọn) Shared Drive

1. Tạo thư mục trong Shared Drive, tài khoản sở hữu script là *Content manager*.
2. Đặt `DRIVE_FOLDER_ID` = ID thư mục, chạy lại `setupDatabase()`.
3. Nếu tạo file lỗi: editor → **Services (+) → Drive API (v3)** → Add, rồi đặt Script Property `USE_ADVANCED_DRIVE = true`
   và tạo *New version* deployment.

## Bước 9 — (Tùy chọn) Sao lưu tự động

Chạy **`installWeeklyBackupTrigger`** một lần → mỗi 2h sáng Chủ nhật tạo bản sao Spreadsheet trong `DTA_HANDOVER/backups`.
Sao lưu thủ công: **`backupNow`** hoặc menu *DTA Handover → Sao lưu ngay*.

## Tùy biến PDF (sheet `CAU_HINH`)

| key | Ý nghĩa |
|---|---|
| `ORG_NAME` | Tên đơn vị in trên PDF (mặc định `DIỆU TƯỚNG AM`) |
| `ORG_FULL_NAME`, `ORG_ADDRESS` | Tên pháp lý, địa chỉ (tùy chọn) |
| `PDF_TITLE` | Tiêu đề (mặc định `BIÊN BẢN BÀN GIAO`) |
| `PDF_TITLE_VPP` | Tiêu đề phiếu văn phòng phẩm (mặc định `BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM`) |
| `PDF_SHOW_NATIONAL_HEADER` | `TRUE`/`FALSE` — in Quốc hiệu, Tiêu ngữ |
| `LOGO_FILE_ID` | ID file ảnh logo trên Drive mà tài khoản script đọc được — chỉ nhận PNG / JPEG (định dạng khác bị bỏ qua) |
| `PDF_FOOTER` | Dòng chú thích cuối trang |

Sau khi sửa: *DTA Handover → Làm mới cache*. PDF đã tạo không tự đổi — dùng nút **Tạo lại PDF** trên trang quản trị nếu cần.
Các khóa email (`CONFIRM_OTP`, `NOTIFY_EMAILS`, `APP_URL`): xem Bước 4a.

## Nhật ký & theo dõi

- Apps Script → **Executions**: mỗi request là một execution; lỗi có `context` và `message` (không chứa payload/secret).
- Quota Apps Script (tài khoản thường): đủ cho vài nghìn biên bản/ngày; mỗi thao tác của người dùng tốn 1 execution
  (tạo PDF thêm 1).
