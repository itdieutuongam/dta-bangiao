# Kiểm thử — DTA Handover

## 1. Các lớp kiểm thử

| Lớp | Lệnh | Chạy gì | Cần gì |
|---|---|---|---|
| Typecheck | `npm run typecheck` | TypeScript strict cho SPA, Worker, shared, test | — |
| Unit + integration | `npm test` | Vitest trên Node: validation, crypto, session, router, chữ ký PNG; **toàn bộ Worker** (`worker/index.ts`) gọi Apps Script giả lập qua HTTP; **nghiệp vụ Apps Script** (chính các file `.gs`) trong bộ giả lập | — |
| End-to-end | `npm run test:e2e` | Build production → `wrangler dev` (workerd — runtime Cloudflare thật) + Apps Script giả lập → Chrome/Edge thật (playwright-core): luồng người dùng, mobile/desktop, ký cảm ứng/chuột, admin, responsive | Chrome hoặc Edge cài trên máy (hoặc `E2E_BROWSER_PATH`) |
| Nghiệm thu | thủ công | Trên Google + Cloudflare thật (mục 4) | Tài khoản Google, Cloudflare |

### Bộ giả lập Apps Script (`scripts/gas-emulator/`)

- Nạp **nguyên văn** các file `apps-script/*.gs` vào VM với SpreadsheetApp, DriveApp, CacheService, LockService,
  PropertiesService, Utilities, HtmlService, ContentService giả lập; mỗi request là một “execution” mới như Apps Script thật.
- Mô phỏng hành vi dễ gây lỗi của Google Sheets: ô không định dạng văn bản tự đổi `0519`→số, `2026-10-15`→ngày; chuỗi bắt đầu
  `=` thành công thức; ghi ngoài số dòng/cột → lỗi; CacheService giới hạn 100KB/giá trị; Web App trả `302` sang trang echo.
- Có thể chèn lỗi Sheet/Drive/HTML để kiểm tra xử lý sự cố.
- **Chỉ dùng cho phát triển và kiểm thử.** Không mô phỏng: hiển thị thực của PDF (tạo PDF giả), quyền/chia sẻ Drive thật,
  quota, độ trễ thật của Google → kiểm tra ở bước nghiệm thu.

## 2. Ánh xạ ca kiểm thử bắt buộc

| Ca kiểm thử | Tự động hóa tại |
|---|---|
| Tạo bàn giao 1 item | `tests/gas.test.ts` › *tạo biên bản 1 nội dung* |
| Tạo bàn giao nhiều item | `tests/gas.test.ts` › *nhiều nội dung, giữ thứ tự*; `tests/worker-api.test.ts`; `tests/e2e/app.e2e.ts` › *tạo biên bản nhiều nội dung* (thêm, sắp xếp) |
| Nhân viên không tồn tại | `gas.test.ts` › *người nhận không tồn tại / ngừng hoạt động*; `worker-api.test.ts` (422 `EMPLOYEE_NOT_FOUND`) |
| Form thiếu trường | `shared.test.ts` › *báo lỗi theo đúng đường dẫn field*; `gas.test.ts` › *form thiếu trường*; `worker-api.test.ts` (422); `e2e` › *báo lỗi khi form thiếu trường* (focus lỗi đầu tiên) |
| Token sai | `gas.test.ts` › *token sai → NOT_FOUND, dò nhiều lần → RATE_LIMITED*; `worker-api.test.ts` (404 sai định dạng / không tồn tại) |
| Token hợp lệ | `worker-api.test.ts` › *tạo → xem → ký*; `e2e` |
| Ký bằng mouse | `e2e` › *ký bằng chuột trên desktop* (ký, xóa, ký lại) |
| Ký bằng touch | `e2e` › *ký bằng cảm ứng trên điện thoại 375px — trang không cuộn khi ký* (CDP touch events, kiểm tra `scrollY` không đổi) |
| Confirm | `gas.test.ts` (Drive `signatures/YYYY/MM`, Sheet cập nhật); `worker-api.test.ts`; `e2e`; admin e2e kiểm tra ảnh chữ ký có nét thật, ≤ 600×300 |
| Confirm lần 2 | `gas.test.ts` (`ALREADY_CONFIRMED`); `worker-api.test.ts` (409); `e2e` (gọi lại API → 409) |
| Revision request | `gas.test.ts` › *revision → sửa → link cũ dùng lại*; `worker-api.test.ts`; `e2e` › *yêu cầu chỉnh sửa bắt buộc nhập lý do* + admin sửa → *Chờ xác nhận* |
| Admin login sai / đúng / logout | `worker-api.test.ts` (401, cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, `Max-Age=0` khi logout); `e2e` (không có token trong `document.cookie`/`localStorage`) |
| Search nhân viên có dấu / không dấu | `shared.test.ts` › *tìm có dấu và không dấu*; `e2e` (gõ “Pham Danh Thai”, “do thi huong”, chọn bằng bàn phím) |
| Refresh `/xac-nhan/:token` | `e2e` (reload giữ trạng thái đã xác nhận); kiểm tra SPA fallback trên workerd |
| Refresh `/admin` | `e2e` (reload `/admin?status=…` và trang chi tiết vẫn đăng nhập, giữ bộ lọc) |
| API lỗi GAS | `worker-api.test.ts` › *lỗi Apps Script / Sheet / cấu hình* (sai secret → 502 `UPSTREAM_AUTH_FAILED`; Web App trả HTML → 502 `UPSTREAM_ERROR`; chưa cấu hình → 503; URL không phải Google → 503) |
| Google Sheet lỗi | `gas.test.ts` › *Google Sheet lỗi*; `worker-api.test.ts` (500, không lộ thông điệp nội bộ) |
| Drive upload lỗi | `gas.test.ts` › *Drive lỗi khi lưu chữ ký → DRIVE_ERROR, trạng thái giữ nguyên, thử lại thành công* |

Thêm: bảo mật request Apps Script (chữ ký sai, timestamp cũ, replay, sai scope), `setupDatabase()` idempotent, cache nhân
viên > 100KB, chống formula injection & giữ số 0 đầu, cấu hình loại bàn giao từ Sheet, PDF (nội dung, không trùng, tạo lại),
CSRF (Origin khác → 403), 400/404/405/429, mã truy cập nội bộ, health không lộ secret, responsive 375/390/430/768/1024/1440
không tràn ngang, security headers & SPA fallback trên workerd.

## 3. Chạy test

```bash
npm test                 # nhanh (~6 giây)
npm run test:e2e         # ~1–2 phút: build + workerd + Chrome
```

Biến tùy chọn cho e2e: `E2E_PORT` (mặc định 8788), `E2E_BROWSER_PATH` (đường dẫn Chrome/Edge), `E2E_HEADED=1` (hiện cửa sổ).
Ảnh chụp màn hình các trang ở mọi kích thước được lưu trong `.e2e/screenshots/` (gitignore).

## 4. Checklist nghiệm thu trên Google + Cloudflare thật

Thực hiện sau khi deploy (bộ giả lập không thay thế được các bước này):

- [ ] `GET /api/health` → 200, `appsScript/database/drive = ok`.
- [ ] Mở URL Web App trên trình duyệt (chưa đăng nhập Google) → JSON “Endpoint chỉ nhận POST…”, không phải trang đăng nhập.
- [ ] `POST` thẳng tới Web App URL với body bất kỳ → `{"ok":false,"error":{"code":"BAD_REQUEST"|"UNAUTHORIZED"…}}`.
- [ ] Trang `/`: danh sách nhân viên tải từ sheet `NHAN_VIEN`; tìm “pham danh thai” ra “Phạm Danh Thái”.
- [ ] Tạo biên bản 3 nội dung (thiết bị, thẻ, công việc) → mã `BG-<ngày VN>-0001`; dòng mới trong `BAN_GIAO`,
      3 dòng `CHI_TIET_BAN_GIAO`, 1 dòng `LICH_SU`; cột `public_token_hash` là hex 64 ký tự, không chứa token trong link.
- [ ] Tạo 2 biên bản gần như đồng thời (2 trình duyệt) → mã khác nhau.
- [ ] Mở link trên **iPhone (Safari)** và **Android (Chrome)**: hiển thị đầy đủ, ký không làm cuộn trang, xác nhận thành công.
- [ ] Ký bằng chuột trên PC.
- [ ] File `DTA_HANDOVER/signatures/<năm>/<tháng>/<mã>-signature.png` tồn tại, **không** chia sẻ công khai.
- [ ] Mở lại link sau khi ký → “BIÊN BẢN ĐÃ ĐƯỢC XÁC NHẬN” với thời gian giờ Việt Nam đúng.
- [ ] Tải PDF (người nhận và admin): **tiếng Việt có dấu hiển thị đúng**, có chữ ký, mã, người giao/nhận, danh sách nội dung,
      thời điểm xác nhận; file nằm ở `DTA_HANDOVER/pdf/<năm>/<tháng>/`. Nếu font lỗi, chỉnh `font-family` trong `Pdf.gs`.
- [ ] Yêu cầu chỉnh sửa → admin thấy lý do → sửa → người nhận mở lại link cũ và ký được.
- [ ] Đổi người nhận khi sửa → link cũ báo “Link xác nhận không hợp lệ”, link mới hoạt động.
- [ ] Admin: đăng nhập sai báo lỗi; đúng thì vào được; bộ lọc theo trạng thái, phòng ban, loại, khoảng ngày; xem chữ ký;
      Copy link; Tạo link mới; Hủy; Đăng xuất.
- [ ] Sửa trực tiếp `NHAN_VIEN` → *Làm mới dữ liệu NV* → nhân viên mới xuất hiện.
- [ ] Thêm một loại trong `LOAI_BAN_GIAO` → xuất hiện trên form sau khi làm mới.
- [ ] Custom domain `https://ban-giao.dieutuongam.com` hoạt động, link xác nhận dùng domain này.
- [ ] Response trang có header `Content-Security-Policy`, `Referrer-Policy: no-referrer` (DevTools → Network).
- [ ] View source / DevTools → Sources: không có `script.google.com` hay secret trong JS.
- [ ] Chạy `backupNow()` → bản sao trong `DTA_HANDOVER/backups`.
