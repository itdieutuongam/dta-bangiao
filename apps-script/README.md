# Apps Script backend — DTA Handover

JSON API chạy dưới dạng **Web App** của Google Apps Script, lưu dữ liệu vào Google Sheets và file vào Google Drive.
Chỉ Cloudflare Worker gọi API này (request ký HMAC-SHA256). Hướng dẫn đầy đủ: [../docs/GOOGLE_SETUP.md](../docs/GOOGLE_SETUP.md).

## Các file

| File | Nội dung |
|---|---|
| `Code.gs` | `doGet` (thông báo trạng thái), `doPost` (xác thực → định tuyến action → JSON), `apiHealth_`, `apiRefreshCache_` |
| `Config.gs` | Hằng số, tên sheet, cấu trúc cột, trường nội dung, loại bàn giao mặc định, cấu hình PDF mặc định, nhân viên mẫu. **Không có secret** |
| `Security.gs` | `verifyRequest_` (HMAC, timestamp, chống replay), so sánh thời gian hằng, giới hạn tần suất bằng CacheService |
| `Utils.gs` | Lỗi, thời gian (Asia/Ho_Chi_Minh), chuỗi, LockService (`withScriptLock_`), cache chia khối, đọc/ghi Sheet theo lô, TextFinder |
| `Employees.gs` | Nhân viên, loại bàn giao (`form_fields`), cấu hình `CAU_HINH` — có cache |
| `Handovers.gs` | Tạo biên bản, sinh mã, tra cứu theo hash token, xác nhận, yêu cầu chỉnh sửa, danh sách/chi tiết/sửa/hủy/tạo link (admin) |
| `Drive.gs` | Thư mục `DTA_HANDOVER/<loại>/YYYY/MM`, lưu chữ ký PNG, đọc file, Advanced Drive (tùy chọn) |
| `Pdf.gs` | Dựng HTML biên bản → PDF → lưu Drive |
| `Setup.gs` | Hàm chạy thủ công + menu + `onEdit` |
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
| `setupDatabase()` | Tạo / bổ sung sheet, cột, loại bàn giao mặc định, cấu hình, thư mục Drive; lưu `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`. Không xóa dữ liệu |
| `checkSetup()` | Báo cáo cấu hình (không in secret) |
| `seedSampleEmployees()` / `removeSampleEmployees()` | Thêm / xóa nhân viên mẫu `DEMO-…` |
| `refreshCaches()` | Xóa cache sau khi sửa `NHAN_VIEN`, `LOAI_BAN_GIAO`, `CAU_HINH` |
| `backupNow()` | Sao lưu Spreadsheet vào `DTA_HANDOVER/backups` |
| `installWeeklyBackupTrigger()` | Sao lưu tự động 2h sáng Chủ nhật |

Menu **DTA Handover** trong Google Sheet có các chức năng tương tự (khi script gắn với Sheet).

## Script Properties

`BACKEND_SHARED_SECRET` (bắt buộc), `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `USE_ADVANCED_DRIVE` — xem bảng ở
[../docs/DATABASE.md](../docs/DATABASE.md#7-script-properties-apps-script).

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

Các file `.gs` được kiểm thử tự động bằng bộ giả lập (`scripts/gas-emulator/`) — `npm test`. Bộ giả lập chỉ phục vụ kiểm thử,
không thay thế Apps Script thật.
