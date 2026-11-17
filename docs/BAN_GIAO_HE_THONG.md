# Tài liệu bàn giao hệ thống DTA Handover (v2.1)

Dành cho người tiếp nhận vận hành / phát triển hệ thống (IT nội bộ hoặc đơn vị ngoài) và người quản lý chịu trách nhiệm cấp quyền.
Đọc kèm: [README.md](../README.md) (cài đặt), [UPGRADE_V2.1.md](UPGRADE_V2.1.md), [AUDIT_V2.1.md](AUDIT_V2.1.md),
[DONG_PHUC.md](DONG_PHUC.md), [VAN_PHONG_PHAM.md](VAN_PHONG_PHAM.md), [SECURITY.md](SECURITY.md).

## 1. Hệ thống gồm những gì

```text
Người dùng ── https://bangiao.dieutuongam.com ──► Cổng Cloudflare Pages (gateway/) ──► Cloudflare Worker "dta-bangiao"
                                                                                         │ SPA React + API /api/*
                                                                                         ▼ (HMAC, GAS_SHARED_SECRET)
                                         Google Apps Script Web App (gắn với Google Sheet, chạy bằng tài khoản triển khai)
                                                   ├─► Google Sheet “XÁC NHẬN BÀN GIAO THIẾT BỊ” — 19 sheet dữ liệu
                                                   ├─► Google Drive thư mục DTA_HANDOVER (chữ ký, PDF, bản sao lưu)
                                                   └─► Gmail (MailApp) — mã xác nhận khi ký, email thông báo
```

Ba nơi phải nắm được quyền: **Google** (Sheet + Apps Script + Drive + Gmail của tài khoản triển khai), **Cloudflare** (Worker,
Pages, secret), **GitHub** (mã nguồn `itdieutuongam/dta-bangiao`). Không có máy chủ / cơ sở dữ liệu nào khác.

## 2. Tài sản và quyền sở hữu

| Tài sản | Ở đâu | Hiện trạng (11/2026) | Mục tiêu |
|---|---|---|---|
| Google Sheet dữ liệu | Google Drive | Thuộc **tài khoản Google cá nhân** của người phụ trách IT; ngày 17/11/2026 đang chia sẻ **“Bất kỳ ai có đường liên kết – Người chỉnh sửa”** (SEC-0) | Thuộc tài khoản / Shared Drive của công ty; quyền truy cập chung **“Bị hạn chế”**, chỉ người được thêm đích danh (*Kiểm tra cấu hình* báo ✗ nếu chia sẻ bằng link) |
| Thư mục `DTA_HANDOVER` (chữ ký, PDF, `backups/`) | Google Drive của chủ Sheet | Như trên | Như trên |
| Dự án Apps Script (gắn với Sheet) | Sheet → Tiện ích mở rộng → Apps Script | Như trên; Web App “Thực thi với tư cách: tôi” → mọi quyền đọc / ghi và email gửi đi là của tài khoản này | Tài khoản công ty triển khai |
| Trigger (sao lưu hằng tuần, email tổng hợp) | Apps Script → Trình kích hoạt | Chạy bằng tài khoản đã cài | Cài lại bằng tài khoản công ty |
| Worker `dta-bangiao`, Pages cổng, secret | Cloudflare | Tài khoản Cloudflare của công ty | ≥ 2 thành viên quản trị |
| Mã nguồn | GitHub `itdieutuongam/dta-bangiao` | Tài khoản GitHub của công ty | ≥ 2 người có quyền admin repo |
| Tên miền `dieutuongam.com` | Nhà cung cấp DNS hiện tại (không phải Cloudflare) | Bản ghi trỏ về cổng Pages | Ghi rõ người giữ tài khoản DNS |

**Rủi ro lớn nhất (OPS-1, P0):** tài khoản cá nhân bị khóa / người phụ trách nghỉ → mất dữ liệu, chữ ký, PDF, bản sao lưu và hệ thống
ngừng ngay. Thực hiện §8 càng sớm càng tốt.

## 3. Danh mục secret và cấu hình

**Mọi giá trị secret phải được lưu trong kho mật khẩu của công ty** (ít nhất 2 người truy cập được). Cloudflare không cho đọc lại
secret sau khi đặt — mất giá trị là phải tạo mới (với hậu quả ở cột cuối).

### 3.1. Cloudflare Worker (`npx wrangler secret put <TÊN>` hoặc Dashboard → Settings → Variables)

| Tên | Bắt buộc | Dùng để | Đổi giá trị thì |
|---|---|---|---|
| `GAS_WEB_APP_URL` | Có | URL `/exec` của Web App Apps Script | Đổi khi tạo deployment mới bằng tài khoản khác (URL mới) |
| `GAS_SHARED_SECRET` | Có | Ký HMAC mọi request Worker → Apps Script | Phải đổi **cùng lúc** với Script Property `BACKEND_SHARED_SECRET` (menu *Nhập / đổi khóa kết nối*) |
| `ADMIN_USERS` | Khuyến nghị | JSON tài khoản quản trị `[{"username","name","password"}]` (mật khẩu ≥ 12 ký tự) | Phiên của người bị đổi mật khẩu hết hiệu lực; JSON sai → không ai đăng nhập được (kiểm tra kỹ trước khi lưu) |
| `ADMIN_PASSWORD` | Khi không dùng `ADMIN_USERS` | Mật khẩu quản trị dùng chung | Mọi phiên hết hiệu lực |
| `SESSION_SECRET` | Có | Ký cookie phiên, sinh link xác nhận (≥ 32 ký tự ngẫu nhiên) | Mọi phiên đăng xuất; link cũ vẫn ký được nhưng không “khôi phục / sao chép lại” được — bấm *Tạo link mới* |
| `STAFF_ACCESS_CODE` | Khuyến nghị | Mã vào trang đề xuất VPP `/de-xuat-vpp` | Báo mã mới cho nhân viên |
| `RECORD_SEAL_SECRET` | Khuyến nghị (đang dùng) | Niêm phong biên bản đã ký (≥ 32 ký tự) | **KHÔNG BAO GIỜ ĐỔI** — mọi biên bản đã niêm phong sẽ báo “không khớp”, không xem chữ ký / tạo lại PDF được |
| `SEAL_LEGACY_IDS` | Không | Danh sách biên bản ký trước khi có `RECORD_SEAL_SECRET` (hiện không cần) | — |
| `APP_BASE_URL` (biến thường, `wrangler.jsonc`) | Có | Gốc link xác nhận `https://bangiao.dieutuongam.com` | Link mới dùng gốc mới |

Binding Rate Limiting: `RL_PUBLIC`, `RL_WRITE`, `RL_AUTH`, `RL_AUTH_ACCOUNT` (namespace 7301–7304, khai báo trong `wrangler.jsonc`).

### 3.2. Apps Script — Script Properties (Cài đặt dự án → Thuộc tính tập lệnh)

| Tên | Ý nghĩa | Ghi chú |
|---|---|---|
| `BACKEND_SHARED_SECRET` | = `GAS_SHARED_SECRET` | Người xem được Script Properties gọi thẳng được Apps Script với mọi quyền (SEC-3) → hạn chế người có quyền sửa Sheet / script |
| `SPREADSHEET_ID`, `DRIVE_FOLDER_ID` | Sheet và thư mục gốc đang dùng | Đổi khi khôi phục từ bản sao lưu (§6) |
| `SCHEMA_VERSION` | Phiên bản cấu trúc dữ liệu (v2.1: `3`) | Chỉ menu nâng cấp được ghi |
| `HANDOVER_SEQ`, `VPP_PROPOSAL_SEQ`, `VPP_PRODUCT_SEQ`, `DP_MODEL_SEQ` | Bộ đếm mã phiếu / đề xuất / sản phẩm / mẫu | **Không sửa tay** (trùng mã) |
| `VPP_STOCK_DIRTY`, `DP_STOCK_DIRTY`, `NOTIFY_STATUS`, `POST_COMMIT_ERRORS`, `DAILY_DIGEST_SENT_DAY`, `LAST_SCHEDULED_BACKUP_AT` | Trạng thái nội bộ | Không sửa tay |

### 3.3. Cấu hình nghiệp vụ trong sheet `CAU_HINH` (sửa trực tiếp, không cần deploy)

`CONFIRM_OTP` (`EMAIL` / `REQUIRED` / `OFF` — mục tiêu `REQUIRED` khi đủ email), `NOTIFY_EMAILS`, `APP_URL`, `ORG_*`, `PDF_TITLE`,
`PDF_TITLE_VPP`, `PDF_TITLE_DP`, `PDF_FOOTER`, `PDF_SHOW_NATIONAL_HEADER`, `LOGO_FILE_ID`, `DP_TIEU_CHUAN_NAM` (tiêu chuẩn đồng phục
mặc định / năm), khóa gán phòng ban `DP_SCOPE:*` (đồng phục) và khóa gán phạm vi định mức VPP (ghi qua trang quản trị).
Sau khi sửa Sheet: nút **Làm mới dữ liệu** cuối menu quản trị.

## 4. Mã nguồn và môi trường làm việc

- Cấu trúc thư mục, lệnh npm: [README.md](../README.md#cấu-trúc-thư-mục). Phiên bản ghi ở 4 nơi, tăng cùng nhau khi phát hành:
  `package.json`, `shared/constants.ts → APP_VERSION`, `apps-script/Config.gs → APP.VERSION`, `apps-script/Code.gs → CODE_VERSION_`.
  Đổi cấu trúc Sheet → tăng `APP.SCHEMA_VERSION` + thêm bước vào `ensureSchemaV2_` (chỉ thêm, không xóa / đổi tên cột).
- **Chạy thử không cần Google / Cloudflare**: `npm run local` (Worker thật + Apps Script giả lập + hộp thư giả lập, có sẵn dữ liệu
  mẫu VPP và đồng phục). Đây là “staging” duy nhất hiện có — chạy trước mỗi lần phát hành.
- Kiểm thử: `npm run verify` (typecheck + lint + 271 test); `npm run test:e2e` (trình duyệt thật, cần Chrome / Edge).
- Apps Script chạy trong bộ giả lập `scripts/gas-emulator/` — giống Google ở các hành vi quan trọng nhưng **không phải** Google thật;
  thay đổi lớn cần thử trên một bản sao Sheet (§6.3) trước khi đưa lên dữ liệu thật.

## 5. Quy trình phát hành

1. `npm run verify` xanh → `npm run local`, thử luồng vừa sửa trên trình duyệt (cả điện thoại: `npm run local -- --lan`).
2. Tăng phiên bản (§4). Ghi thay đổi vào tài liệu tương ứng.
3. **Apps Script trước**: `npm run gas:bundle` → dán đè → Lưu → *Kiểm tra cấu hình* (dòng đầu “✓ Code Apps Script đầy đủ, một phiên
   bản (vX)”) → nếu có đổi cấu trúc: chạy menu nâng cấp → *Quản lý triển khai → Sửa → Phiên bản mới* (giữ URL).
4. **Worker sau**: đẩy code lên nhánh **`main`** trên GitHub — Cloudflare **Workers Builds** đã nối với repo và **tự build + deploy
   `main` sau ~2 phút** (xác nhận 17/11/2026: *Workers & Pages → dta-bangiao → Deployments* hiện “Build · main”). Hoặc chạy
   `npm run deploy` từ máy có quyền (bản đó sẽ bị bản build kế tiếp từ `main` thay thế — luôn giữ `main` = code muốn chạy).
   ⚠ Vì `main` tự deploy: **không đẩy code mới lên `main` trước khi Apps Script đã cập nhật** (bước 3); làm việc trên nhánh
   `release/…` rồi mới đưa lên `main`.
5. Kiểm tra: `/api/health` (`version` mới, mọi thành phần `ok`), *Cài đặt* không có mục cần xử lý mới, tạo + hủy một phiếu thử.
6. Quay lui: Worker → *Deployments → Rollback*; Apps Script → *Quản lý triển khai → chọn phiên bản cũ* (cấu trúc Sheet chỉ thêm nên
   bản cũ vẫn chạy). Luôn quay lui cả hai.

## 6. Sao lưu và khôi phục

### 6.1. Hiện có

Menu **Sao lưu ngay** và trigger hằng tuần (tùy chọn) chép **file Sheet** vào `DTA_HANDOVER/backups/` — **cùng tài khoản** với bản
gốc, không gồm chữ ký / PDF, không giới hạn số bản (mỗi bản chứa dữ liệu nhân viên). Nâng cấp cấu trúc tự sao lưu trước khi đổi.

### 6.2. Cần làm (OPS-2 / GAS-10)

| Việc | Tần suất | Ghi chú |
|---|---|---|
| Chép bản sao lưu Sheet mới nhất sang Shared Drive của công ty (ngoài tài khoản chủ Sheet) | Hằng tuần | Có thể thay bằng trigger chạy bằng tài khoản công ty |
| Chép thư mục `DTA_HANDOVER/signatures` + `pdf` (hoặc Google Takeout) | Hằng tháng | Chữ ký là bằng chứng — mất thì biên bản không còn ảnh chữ ký |
| Xóa bản sao lưu cũ, giữ ~12 bản gần nhất | Hằng tháng | Bản cũ chứa cả dữ liệu đã xóa / mật khẩu bị lộ (§3 AUDIT) |
| Xuất toàn bộ secret vào kho mật khẩu (§3) | Khi thay đổi | |
| **Diễn tập khôi phục** (§6.3) | Mỗi quý | Ghi lại thời gian, kết quả |

### 6.3. Khôi phục / dựng bản thử

1. Sao chép bản sao lưu thành Sheet mới (hoặc *Tạo bản sao* của Sheet thật để làm bản thử).
2. Mở Apps Script của Sheet mới: dán code, đặt `BACKEND_SHARED_SECRET` (bản thử: giá trị khác production), chạy `setupDatabase`
   (giữ dữ liệu, chỉ bổ sung cấu trúc), *Kiểm tra cấu hình*.
3. Triển khai Web App mới → được URL mới.
   - **Khôi phục thật**: đặt `GAS_WEB_APP_URL` (+ `GAS_SHARED_SECRET` nếu đổi) trên Worker production.
   - **Bản thử**: dùng với `npm run dev` / `.dev.vars` — không trỏ Worker production vào bản thử.
4. Chữ ký / PDF: nếu thư mục Drive gốc mất, chép bản lưu thư mục về và đặt `DRIVE_FOLDER_ID`.

## 7. Giám sát (OPS-7)

| Kiểm tra | Cách | Ai / khi nào |
|---|---|---|
| Hệ thống sống | Cloudflare Health Checks hoặc UptimeRobot gọi `https://bangiao.dieutuongam.com/api/health` 5 phút / lần, báo email 2 người khi không phải `success:true` hoặc có thành phần ≠ `ok` | Tự động |
| Cảnh báo nghiệp vụ | Trang *Tổng quan* `/admin`: lỗi gửi email, độ phủ email / OTP, yêu cầu chỉnh sửa, đã ký kèm ghi chú, kho VPP / đồng phục, đồ mượn quá hạn | Quản trị viên, hằng ngày |
| Cấu hình | Trang *Cài đặt* `/admin/cai-dat`: mục “cần xử lý” (cột định danh trống, tiêu đề trùng, bước phụ lỗi sau khi lưu, MailApp) | IT, hằng tuần |
| Lỗi Apps Script | Apps Script → *Lượt thực thi* (lọc *Không thành công*) | IT, hằng tuần |
| Log Worker | Cloudflare → Workers → `dta-bangiao` → *Logs* (`admin.login_failed`, `gas.*`) | Khi có sự cố |
| Email tổng hợp hằng ngày | Menu *Bật email tổng hợp hằng ngày (8h sáng)* | Tự động tới `NOTIFY_EMAILS` |

## 8. Chuyển quyền sở hữu khỏi tài khoản cá nhân (OPS-1)

Làm ngoài giờ, theo thứ tự; cần cả chủ hiện tại và tài khoản công ty (ví dụ hộp thư dùng chung của bộ phận IT, bật xác minh 2 bước).

1. **Sao lưu ngay**; xuất secret hiện có vào kho mật khẩu (§3).
2. Chia sẻ Sheet + thư mục `DTA_HANDOVER` cho tài khoản công ty quyền *Chỉnh sửa* → *Chuyển quyền sở hữu* (hoặc di chuyển vào Shared
   Drive của công ty). Dự án Apps Script gắn với Sheet đi theo Sheet.
3. Đăng nhập bằng tài khoản công ty → mở Apps Script → kiểm tra Script Properties còn đủ → chạy *Kiểm tra cấu hình* (cấp quyền).
4. **Triển khai mới** Web App bằng tài khoản công ty (*Thực thi với tư cách: tôi*, *Bất kỳ ai*) → URL mới → cập nhật secret
   `GAS_WEB_APP_URL` trên Cloudflare → `/api/health` phải `ok`. Lưu trữ (archive) deployment cũ của tài khoản cá nhân.
5. Cài lại trigger (sao lưu hằng tuần, email tổng hợp) bằng tài khoản công ty; xóa trigger của tài khoản cũ.
6. Menu **Khóa sheet hệ thống** bằng tài khoản công ty (người chạy + chủ sở hữu là người được ghi các sheet hệ thống).
7. Gửi thử email (*Gửi thử email thông báo*) — email từ nay gửi từ hộp thư công ty.

## 9. Khi người phụ trách rời đi (offboarding)

- [ ] §8 đã xong (không còn gì thuộc tài khoản cá nhân).
- [ ] Gỡ người đó khỏi: quyền sửa Sheet / Drive / Apps Script, thành viên Cloudflare, quyền repo GitHub, `ADMIN_USERS`.
- [ ] Đổi: `GAS_SHARED_SECRET` + `BACKEND_SHARED_SECRET` (cùng lúc), `SESSION_SECRET`, `STAFF_ACCESS_CODE`, mật khẩu quản trị dùng chung (nếu có).
- [ ] **Không đổi `RECORD_SEAL_SECRET`** — người biết khóa chỉ giả được niêm phong khi còn quyền sửa Sheet; gỡ quyền sửa Sheet là đủ.
- [ ] Bàn giao kho mật khẩu và tài liệu này; người mới chạy thử `npm run local` và một lần phát hành không đổi chức năng (§5).

## 10. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| Mọi thao tác báo `NOT_CONFIGURED` ngay sau khi ai đó sửa Sheet | Tiêu đề cột hệ thống bị gõ đè / dán đè | Hoàn tác (Ctrl+Z) hoặc *Lịch sử phiên bản*; rồi menu **Sửa cột định danh bị đổi tên** → *Kiểm tra cấu hình*. **Không** chạy “Thiết lập database” trước khi tiêu đề đúng |
| *Cài đặt* báo “dòng có cột định danh trống / sai” hoặc “tiêu đề trùng tên” | Dòng thêm tay thiếu mã; cột tự thêm trùng tên cột hệ thống | Menu **Sửa cột định danh bị đổi tên**; đổi tên / xóa cột tự thêm |
| `UPSTREAM_OUTDATED` | Worker mới, Apps Script cũ | Phát hành Apps Script (§5 bước 3) |
| Chi tiết biên bản báo **không khớp** / *Niêm phong: BỊ XÓA* | Dữ liệu biên bản đã ký bị sửa trên Sheet | Xem *Lịch sử phiên bản* của Sheet để tìm người / thời điểm sửa, khôi phục ô đã sửa; PDF gốc (nếu có) vẫn tải được |
| Người nhận không nhận được mã xác nhận | Sai email trong `NHAN_VIEN`, hết hạn mức MailApp / ngày, thư rác | *Tổng quan* / *Cài đặt → Email*; sửa email → *Làm mới dữ liệu* |
| Tồn kho VPP / đồng phục lệch | Bước kho lỗi giữa chừng | Chi tiết phiếu → **Đối soát kho** (không trừ hai lần) |
| Quản trị viên quên mật khẩu | — | Sửa `ADMIN_USERS` (đặt mật khẩu mới cho người đó) |
| Mất `RECORD_SEAL_SECRET` | Không lưu vào kho mật khẩu | Không khôi phục được. Đặt khóa mới (biên bản ký từ nay niêm phong bằng khóa mới); biên bản niêm phong bằng khóa cũ sẽ báo **không khớp** — muốn dùng tiếp: sao lưu, xóa ô `record_seal` của các biên bản đó trên Sheet và khai báo `handover_id` của chúng vào `SEAL_LEGACY_IDS` (mất khả năng phát hiện sửa đổi với các biên bản này) |

Bảng đầy đủ hơn: [README.md §18](../README.md#18-xử-lý-sự-cố).
