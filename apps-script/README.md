# Apps Script backend — DTA Handover

JSON API chạy dưới dạng **Web App** của Google Apps Script, lưu dữ liệu vào Google Sheets và file vào Google Drive.
Chỉ Cloudflare Worker gọi API này (request ký HMAC-SHA256). Hướng dẫn đầy đủ: [../docs/GOOGLE_SETUP.md](../docs/GOOGLE_SETUP.md).

## Các file

| File | Nội dung |
|---|---|
| `Code.gs` | `doGet` (thông báo trạng thái), `doPost` (kiểm tra code thống nhất `CODE_VERSION_` / đủ handler → xác thực → kiểm tra `SCHEMA_VERSION` → định tuyến action theo scope → JSON; action `stream` trả dòng phong bì JSON + nội dung tệp), `apiHealth_`, `apiAdminSystemInfo_` |
| `Config.gs` | Hằng số, tên sheet, cấu trúc cột (12 sheet), trường nội dung, loại phiếu / loại nội dung mặc định, cấu hình PDF mặc định, trạng thái VPP, nhân viên mẫu. **Không có secret** |
| `Security.gs` | `verifyRequest_` (HMAC, timestamp, chống replay), so sánh thời gian hằng, giới hạn tần suất bằng CacheService, người thực hiện (`sanitizeActor_`) |
| `Utils.gs` | Lỗi, thời gian (Asia/Ho_Chi_Minh), chuỗi (loại ký tự bidi / vô hình), LockService (`withScriptLock_`, `requireLock_`), cache chia khối, đọc/ghi Sheet theo lô — ghi theo ID bất biến (`verifiedRowIndex_`), chỉ ghi ô thay đổi |
| `Employees.gs` | Nhân viên, loại nội dung (`form_fields`, `handover_type`), cấu hình `CAU_HINH`, phòng ban → phạm vi định mức — có cache |
| `Handovers.gs` | Tạo phiếu (admin; gửi lại cùng mã thao tác khác nội dung → `REQUEST_REUSED`), sinh mã, tra cứu theo hash token, mã băm nội dung, xác nhận (kiểm tra mã OTP, mã băm + niêm phong toàn biên bản), yêu cầu chỉnh sửa, toàn vẹn, danh sách/chi tiết/sửa (theo phiên bản nội dung — lỗi giữa chừng không lộ nội dung lẫn cũ / mới)/hủy/tạo link, tổng quan, huy hiệu menu |
| `Notify.gs` | Email qua MailApp: mã xác nhận (OTP) khi ký — gửi, kiểm tra, giới hạn; thông báo cho quản trị viên (`NOTIFY_EMAILS`), `NOTIFY_STATUS`, email tổng hợp hằng ngày |
| `Drive.gs` | Thư mục `DTA_HANDOVER/<loại>/YYYY/MM`, lưu chữ ký PNG, đọc file (chỉ trong thư mục hệ thống, đúng định dạng), lưu trữ PDF cũ, Advanced Drive (tùy chọn) |
| `Pdf.gs` | Dựng HTML phiếu (kể cả phiếu văn phòng phẩm; in mọi trường có dữ liệu) → PDF → lưu Drive; từ chối khi toàn vẹn MISMATCH (nội dung, toàn biên bản hoặc niêm phong) |
| `Export.gs` | Dựng CSV cho “Xuất CSV” (phiếu, tồn kho, lịch sử kho, đề xuất): chống chèn công thức, ngày giờ Việt Nam, CRLF — Worker chỉ chuyển thẳng tệp |
| `Setup.gs` | Hàm chạy thủ công + menu + `onEdit` + khóa sheet hệ thống |
| `Vpp.gs` | Kho văn phòng phẩm: tồn / giữ chỗ / xuất kho (đồng bộ hội tụ; sổ biến động ghi trước, tự đồng bộ sau lỗi giữa chừng), định mức, sản phẩm, nhập kho, kiểm kê, lịch sử, dashboard, rà soát dữ liệu (cả lệch sổ), tra mã NV công khai |
| `VppProposals.gs` | Đề xuất mua: gửi, duyệt từng dòng, từ chối, đã mua, nhận hàng (nhập kho), đóng, quyết định sản phẩm mới |
| `VppSetup.gs` | `upgradeOfficeSupplyModule` (nâng cấp idempotent + sao lưu), `seedOfficeSupplyNorms`, `seedInitialOfficeSupplyStock`, dữ liệu nguồn |
| `appsscript.json` | Múi giờ `Asia/Ho_Chi_Minh`, runtime V8, Web App: *Execute as me*, *Anyone* |
| `sample-data/` | CSV mẫu / template cho sheet `NHAN_VIEN` |

## Dán code nhanh: 1 file gộp

```bash
npm run gas:bundle      # → dist/apps-script/DTA_Handover.gs (gộp toàn bộ *.gs, không sửa trực tiếp)
```

Dán toàn bộ nội dung file gộp vào **một** file `.gs` trong editor (ví dụ `Code.gs` / `Mã.gs`), thay thế nội dung cũ.
Bản gộp được kiểm thử tự động trong `tests/gas.test.ts`. Khi cập nhật code: chạy lại lệnh, dán đè, rồi tạo *New version*
deployment.

## Hàm chạy thủ công (chọn hàm → Run)

| Hàm | Tác dụng |
|---|---|
| `setupDatabase()` | Tạo / bổ sung sheet, cột, loại bàn giao mặc định, cấu hình, thư mục Drive; lưu `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `SCHEMA_VERSION`. Không xóa dữ liệu |
| `upgradeOfficeSupplyModule()` | Nâng cấp lên v2 (module Văn phòng phẩm): sao lưu nếu có dữ liệu → thêm sheet / cột thiếu → loại “Văn phòng phẩm” → `SCHEMA_VERSION = 2`. Chạy lại an toàn |
| `seedOfficeSupplyNorms()` | Nạp định mức PHÒNG KINH DOANH / VĂN PHÒNG từ bản định mức. Không tạo trùng, không sửa định mức đã có |
| `seedInitialOfficeSupplyStock()` | Nạp tồn đầu kỳ (chạy **một lần**, thủ công). Không tự ghép, không đoán số / ĐVT chưa rõ, không ghi đè tồn đã có |
| `protectSystemSheets()` | Khóa các sheet hệ thống (chỉ chủ script ghi được) |
| `checkSetup()` | Báo cáo cấu hình, phiên bản dữ liệu, số liệu VPP, quyền gửi email (MailApp) + chế độ mã xác nhận (không in secret) |
| `sendTestNotification()` | Gửi thử email tới `NOTIFY_EMAILS` — lần đầu Google hỏi quyền “Gửi email thay bạn” |
| `installDailyDigestTrigger()` | Email tổng hợp hằng ngày ~8h sáng (`sendDailyDigest`); chạy lại không tạo trùng. Nhiều người cùng cài (mỗi người một trigger) vẫn chỉ gửi **một** email / ngày |
| `seedSampleEmployees()` / `removeSampleEmployees()` | Thêm / xóa nhân viên mẫu `DEMO-…` |
| `refreshCaches()` | Xóa cache sau khi sửa `NHAN_VIEN`, `LOAI_BAN_GIAO`, `CAU_HINH` |
| `backupNow()` | Sao lưu Spreadsheet vào `DTA_HANDOVER/backups` |
| `installWeeklyBackupTrigger()` | Sao lưu tự động 2h sáng Chủ nhật (`scheduledBackup` — trigger trùng của người khác không sao lưu thêm trong 6 ngày) |

Menu **DTA Handover** trong Google Sheet có các chức năng tương tự (khi script gắn với Sheet).

## Script Properties

`BACKEND_SHARED_SECRET` (bắt buộc), `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `USE_ADVANCED_DRIVE`, `SCHEMA_VERSION`, hệ thống tự ghi:
`NOTIFY_STATUS`, `VPP_STOCK_DIRTY`, `DAILY_DIGEST_SENT_DAY`, `LAST_SCHEDULED_BACKUP_AT` — xem bảng ở
[../docs/DATABASE.md](../docs/DATABASE.md#13-script-properties-apps-script). Khóa niêm phong biên bản **không** nằm ở đây (Worker
giữ `RECORD_SEAL_SECRET` và gửi kèm từng request — người sửa được Sheet / Script Properties không tự tính lại được niêm phong).

## Deploy / cập nhật

- Lần đầu: *Deploy → New deployment → Web app* — **Execute as: Me**, **Who has access: Anyone** → copy URL `/exec`.
- Cập nhật code: *Deploy → Manage deployments → Edit → Version: New version → Deploy* (giữ nguyên URL).

## Dùng clasp (tùy chọn, thay cho copy/paste)

```bash
npm install -g @google/clasp
clasp login
# Script đã tạo từ Google Sheet: lấy Script ID tại Project Settings
clasp clone <SCRIPT_ID> --rootDir apps-script     # tạo .clasp.json (đã gitignore) — hoặc tạo tay:
# echo {"scriptId":"<SCRIPT_ID>","rootDir":"apps-script"} > .clasp.json
clasp push                                        # đẩy *.gs + appsscript.json
```

Lưu ý: `clasp clone` có thể ghi đè file local — nên tạo `.clasp.json` thủ công rồi chỉ dùng `clasp push`.
File `apps-script/.claspignore` đã giới hạn chỉ đẩy `*.gs` và `appsscript.json` (bỏ qua README, `sample-data/`).
Sau `clasp push` vẫn cần *Manage deployments → New version* để Web App chạy code mới.

## Kiểm thử cục bộ

Các file `.gs` được kiểm thử tự động bằng bộ giả lập (`scripts/gas-emulator/`, gồm cả MailApp giả lập) — `npm test`; bấm thử
toàn bộ ứng dụng với bộ giả lập: `npm run local`. Bộ giả lập chỉ phục vụ kiểm thử, không thay thế Apps Script thật.
