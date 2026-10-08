# Kiến trúc — DTA Handover v2

## 1. Thành phần

```text
┌──────────────────────────┐       ┌───────────────────────────────────────────────┐
│ Trình duyệt              │       │ Cloudflare (một Worker "dta-bangiao")         │
│ React SPA (Vite build)   │ HTTPS │ ┌───────────────────┐  ┌────────────────────┐ │
│ • /  (trang chủ)         │──────►│ │ Static Assets     │  │ Worker /api/*      │ │
│ • /xac-nhan/:token       │       │ │ dist/client, SPA  │  │ worker/index.ts    │ │
│ • /de-xuat-vpp           │       │ │ fallback, _headers│  │ (run_worker_first) │ │
│ • /admin/... (đăng nhập) │       │ └───────────────────┘  └─────────┬──────────┘ │
└──────────────────────────┘       └──────────────────────────────────┼────────────┘
                                                                      │ HTTPS POST (JSON, HMAC)
                                                                      ▼
                                   ┌───────────────────────────────────────────────┐
                                   │ Google Apps Script Web App (doPost)           │
                                   │ Security.gs → Code.gs router (scope)          │
                                   │ Handovers.gs · Vpp.gs · VppProposals.gs · Pdf │
                                   │ LockService · CacheService · PropertiesService│
                                   └──────────────┬──────────────────┬─────────────┘
                                                  ▼                  ▼
                                   ┌─────────────────────┐ ┌──────────────────────────┐
                                   │ Google Sheets       │ │ Google Drive             │
                                   │ NHAN_VIEN, BAN_GIAO │ │ DTA_HANDOVER/            │
                                   │ CHI_TIET_BAN_GIAO   │ │  signatures/YYYY/MM      │
                                   │ LOAI_BAN_GIAO       │ │  pdf/YYYY/MM             │
                                   │ LICH_SU, CAU_HINH   │ │  pdf-archive/YYYY/MM     │
                                   │ VPP_SAN_PHAM …      │ │  backups/                │
                                   │ (6 sheet VPP)       │ │                          │
                                   └─────────────────────┘ └──────────────────────────┘
```

| Lớp | Công nghệ | Trách nhiệm |
|---|---|---|
| SPA | React 19, React Router 8, Tailwind CSS 4, Zod 4, Lucide | Giao diện, validate UX, khung ký Canvas (Pointer Events) |
| Worker | Cloudflare Workers + Static Assets, `@cloudflare/vite-plugin` | API `/api/*`: validate lại (Zod), rate limit, phiên admin, sinh token link, ký HMAC, chuyển lỗi thành HTTP status |
| Apps Script | V8 runtime | Xác thực request, nghiệp vụ, khóa ghi, đọc/ghi Sheet theo lô, lưu Drive, sinh PDF |
| Lưu trữ | Google Sheets / Drive | Database & file (chữ ký, PDF, backup) |
| Cổng tên miền | Cloudflare Pages Functions (`gateway/`) | Nhận `bangiao.dieutuongam.com` (DNS ở nhà cung cấp ngoài), chuyển nguyên request sang Worker qua Service Binding |

Nguyên tắc: trình duyệt **chỉ** nói chuyện với Worker cùng domain. URL Apps Script và các secret chỉ tồn tại trong
Cloudflare secrets / Script Properties.

## 2. Routing trên Cloudflare

`wrangler.jsonc`:

```jsonc
"assets": {
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",   // /xac-nhan/abc, /admin/... → index.html
  "run_worker_first": ["/api/*"]                      // API luôn qua Worker
}
```

- Đường dẫn khớp file tĩnh → trả file (JS/CSS có hash).
- Điều hướng tới route SPA → `index.html` (refresh trực tiếp route sâu không 404).
- `/api/*` → Worker (`worker/index.ts` → `worker/router.ts`).
- `public/_headers` gắn security headers (CSP, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`…) cho trang tĩnh;
  Worker tự gắn header tương ứng cho JSON.

## 3. Giao thức Worker ⇄ Apps Script

Apps Script Web App không đọc được HTTP header, nên thông tin xác thực nằm trong body:

```json
{
  "v": 1,
  "action": "adminCreateHandover",
  "scope": "public | admin | system",
  "ts": "1791117000000",
  "requestId": "6f1c…(UUID)",
  "payload": "{\"sender\":{\"name\":\"Nguy\\u1ec5n V\\u0103n An\"…}}",
  "sig": "hex(HMAC_SHA256(secret, 'v1\\n' + action + '\\n' + scope + '\\n' + ts + '\\n' + requestId + '\\n' + payload))"
}
```

- `payload` là **chuỗi JSON chỉ gồm ký tự ASCII** (ký tự tiếng Việt được escape `\uXXXX`) → chuỗi được ký giống hệt nhau ở
  hai phía, không phụ thuộc charset.
- Apps Script (`Security.gs › verifyRequest_`): kiểm tra định dạng → `|now − ts| ≤ 5 phút` → so sánh HMAC thời gian hằng →
  `requestId` chưa từng dùng (CacheService 15 phút) → parse payload.
- `scope` giới hạn action: action admin chỉ nhận `scope = admin` (Worker chỉ gửi scope này sau khi kiểm tra phiên admin,
  kèm `actor = { id: username, name }` để Apps Script ghi “ai đã làm”). Bảng action ↔ scope: `Code.gs`.
- **Cổng phiên bản dữ liệu:** Script Property `SCHEMA_VERSION` < 2 → mọi action trừ `health` / `adminSystemInfo` trả
  `NOT_CONFIGURED` (code mới không chạy trên cấu trúc Sheet cũ, không ghi nửa vời).
- **Cổng mã nguồn:** đầu `doPost` kiểm tra code thống nhất (`CODE_VERSION_` của `Code.gs` = `APP.VERSION` của `Config.gs` — còn file
  `.gs` của bản cũ nạp sau → “trộn code nhiều phiên bản”) và đủ handler cho mọi action (thiếu file → “thiếu code (… is not defined)”)
  → `NOT_CONFIGURED` cho **mọi** action. Code top-level chỉ khai báo hàm / hằng số literal nên thứ tự file trong editor không quan trọng.
- **Khóa niêm phong:** thao tác ký / xem biên bản đã ký nhận thêm `sealKey` = HMAC(`RECORD_SEAL_SECRET`, …) do Worker gửi kèm — không
  lưu ở Apps Script (xem mục 8 và [SECURITY.md](SECURITY.md) §9).
- Response luôn HTTP 200 (giới hạn của Apps Script): `{ ok: true, data }` hoặc `{ ok: false, error: { code, message, details } }`.
  Worker ánh xạ `error.code` → HTTP status (`VALIDATION_ERROR` / `NORM_EXCEEDED`→422, `NOT_FOUND`→404, `CONFLICT` /
  `ALREADY_CONFIRMED` / `INVALID_STATE` / `INSUFFICIENT_STOCK` / `INTEGRITY_ERROR` / `REQUEST_REUSED`→409, `RATE_LIMITED`→429,
  `LOCK_TIMEOUT` / `NOT_CONFIGURED`→503, `UNKNOWN_ACTION`→502 `UPSTREAM_OUTDATED`, lỗi chữ ký→502 `UPSTREAM_AUTH_FAILED`,
  còn lại→500). Bảng đầy đủ: [API.md](API.md).
- Web App trả `302` sang `script.googleusercontent.com`; Worker tự theo redirect (chỉ tới host Google) với timeout
  30–120 giây tùy thao tác; đọc dữ liệu được thử lại 1 lần khi lỗi mạng.
- Response không phải JSON (trang HTML lỗi deploy/quyền) → 502 `UPSTREAM_ERROR`, log đoạn đầu để chẩn đoán.
- **Action stream** (`adminExportCsv`): phản hồi = một dòng phong bì JSON + `\n` + nội dung tệp. Worker (`callGasStream`) chỉ đọc tới
  dòng đầu (tối đa 64 KB), phần còn lại chuyển thẳng cho trình duyệt — không giải mã / phân tích hàng MB trong Worker.

## 4. Luồng nghiệp vụ

### Tạo phiếu (chỉ quản trị viên)

```text
SPA /admin/ban-giao/tao-moi ──POST /api/admin/handovers──► Worker
                              ├─ requireAdmin (cookie phiên) → actor; rate limit; kiểm tra Origin
                              ├─ Zod handoverInputSchema (loại phiếu, items | supplies, clientRequestId)
                              ├─ issueLinkToken(): nonce ngẫu nhiên → token = HMAC(linkKey, nonce) → hash = SHA-256(token)
                              └─ callGas('adminCreateHandover', {..., tokenHash, tokenNonce, actor, client:{ipHash,userAgent}})
                                      Apps Script:
                                      ├─ validate lại: người nhận ACTIVE, loại nội dung thuộc loại phiếu & đang dùng
                                      ├─ phiếu VPP: sản phẩm dùng được, định mức tháng của phòng ban người nhận (lý do khi vượt)
                                      └─ LockService: clientRequestId đã có → đúng nội dung: trả phiếu cũ (duplicate);
                                         │                                  khác nội dung: 409 REQUEST_REUSED (nêu phiếu đã lưu)
                                         ├─ phiếu VPP: kiểm tra đủ khả dụng theo SỔ biến động (INSUFFICIENT_STOCK → chưa ghi gì)
                                         ├─ sinh mã BG-YYYYMMDD-XXXX → ghi CHI_TIET_BAN_GIAO (revision_id) → BAN_GIAO (items_revision)
                                         │  + LICH_SU (created_by)
                                         └─ phiếu VPP: đồng bộ kho → RESERVE
SPA ◄── 201 { code, status, receiver, link = APP_BASE_URL|origin + /xac-nhan/<token>, warnings[], confirmOtp }
```

Mã biên bản: trong khóa script, lấy `max(bộ đếm HANDOVER_SEQ của ngày, số lớn nhất đã có trong Sheet cho ngày đó) + 1`
— không trùng kể cả khi hai request tới cùng lúc hoặc property bị xóa. Ngày tính theo giờ Việt Nam.

### Người nhận xem & ký

```text
GET  /api/handover/:token          → Worker hash token → getHandoverByToken(tokenHash) → dữ liệu công khai + contentHash + otp
POST /api/handover/:token/otp      → requestConfirmOtp: chính sách CONFIRM_OTP, giới hạn gửi (trong khóa) → lưu HMAC mã (CacheService)
                                     → MailApp gửi mã tới email hiện tại của người nhận trong NHAN_VIEN (ngoài khóa)
POST /api/handover/:token/confirm  → Worker: Zod (agreed=true, PNG data URL, contentHash, otp?), kiểm tra PNG (magic, IHDR, ≤300KB, ≤1200×600)
                                     → confirmHandover: LockService → đọc lại trạng thái → phải PENDING
                                       → contentHash ≠ nội dung hiện tại → 409 CONFLICT (không ký bản cũ)
                                       → kiểm tra mã OTP (sai / hết hạn / thiếu → 422, sai 5 lần → 429) — trước khi ghi gì
                                       → lưu PNG vào Drive signatures/YYYY/MM → BAN_GIAO (content_hash, signature_sha256,
                                         confirm_method, record_hash, record_seal) → hủy mã OTP → LICH_SU
                                       → phiếu VPP: đồng bộ kho → OUT (lỗi → STOCK_SYNC_FAILED + email “cần đối soát”, vẫn xác nhận)
                                     → ctx.waitUntil(generatePdf, timeout 25 s) — sinh PDF nền sau khi đã trả kết quả
POST /api/handover/:token/request-revision → (contentHash) REVISION_REQUESTED + lý do (LICH_SU); phiếu VPP giữ nguyên giữ chỗ;
                                     email tới NOTIFY_EMAILS (sau khi đã lưu)
GET  /api/handover/:token/pdf      → chỉ khi CONFIRMED; tự sinh PDF nếu chưa có
```

Chống ký lặp: kiểm tra trạng thái **sau khi giữ khóa**; lần thứ hai nhận `409 ALREADY_CONFIRMED`. Nếu lưu Drive lỗi,
trạng thái giữ nguyên `PENDING` (người nhận thử lại được); file mồ côi bị đưa vào thùng rác. Khi ký cùng thiết bị + mạng
với lúc tạo phiếu, trang quản trị hiện cảnh báo (`confirmedFromCreatorDevice`).

### Quản trị

- `POST /api/admin/login` → tài khoản trong `ADMIN_USERS` (hoặc mật khẩu chung `ADMIN_PASSWORD`), so sánh thời gian hằng,
  giới hạn theo IP + theo username → cookie phiên ký HMAC (ghi username; khóa phiên gắn với mật khẩu của từng người).
- Danh sách: Apps Script đọc `BAN_GIAO` + các cột cần của `CHI_TIET_BAN_GIAO` (vài lần `getValues`), lọc không dấu, sắp xếp mới
  nhất trước, phân trang, kèm thống kê toàn bộ.
- Chi tiết: kèm `tokenHash` + `tokenNonce` → Worker dựng lại link (`recoverConfirmLink`) rồi **loại bỏ** hai trường này;
  kèm toàn vẹn (`OK` / `MISMATCH` / `LEGACY` + từng phần: nội dung, toàn biên bản, niêm phong) và `editPendingSince`.
- Sửa (chỉ `PENDING`/`REVISION_REQUESTED`) — trọn vẹn theo **phiên bản nội dung**: (1) thêm dòng nội dung mới với `revision_id`
  mới (chưa hiện cho ai), (2) phiếu VPP điều chỉnh giữ chỗ theo chênh lệch, (3) ghi dấu `edit_pending`, (4) ghi các cột phiếu — mã
  link mới (khi **đổi người nhận**) ghi trước, `items_revision` + xóa `edit_pending` ghi **sau cùng** (cột chốt), (5) đánh dấu dòng
  cũ `superseded_at` (không xóa dòng), lưu nội dung cũ vào `LICH_SU.metadata`, trạng thái về `PENDING`. Lỗi ở bất kỳ bước nào →
  người nhận vẫn thấy bản cũ trọn vẹn (hoặc “đang cập nhật”, chưa ký được); lưu lại từ trang sửa hoàn tất (không bị `CONFLICT`).
- Hủy: chỉ khi chưa xác nhận (biên bản đã ký là bất biến); phiếu VPP trả giữ chỗ.
- Tạo link mới, xem chữ ký (PNG qua Worker), tải / tạo lại PDF, đối soát kho phiếu VPP.

### Kho văn phòng phẩm

```text
available = on_hand − reserved
syncHandoverStock_(phiếu):  cần giữ = SL nếu PENDING/REVISION_REQUESTED · cần xuất = SL nếu CONFIRMED
                            đã có  = tổng biến động có handover_id của phiếu (RESERVE − RELEASE − OUT, OUT)
                            → chỉ ghi phần chênh lệch (RESERVE / RELEASE / OUT), operation_id theo thao tác
applyStockMovements_:       trong LockService: tự đồng bộ nếu lần trước ghi dở → đọc tồn mới nhất → kiểm tra (không âm,
                            khả dụng đủ, tồn đã rõ) → đánh dấu VPP_STOCK_DIRTY → thêm VPP_BIEN_DONG_KHO (nguồn sự thật:
                            trước / sau, người thực hiện, lý do) → ghi VPP_TON_KHO (số tổng hợp) → xóa dấu
```

Lỗi Google ở bất kỳ bước ghi nào để lại dấu `VPP_STOCK_DIRTY` → lần ghi kho kế tiếp (hoặc trang Tồn kho / Tổng quan kho /
Dữ liệu cần kiểm tra) tính lại tồn các sản phẩm đó từ sổ biến động — không bao giờ giữ chỗ / xuất kho hai lần.

Mọi thao tác kho (tạo / sửa / hủy / ký phiếu, nhập kho, nhận hàng, kiểm kê, ghép) chạy trong khóa script; thiếu hàng thì cả
thao tác bị hủy (không ghi một phần) — kiểm tra đủ tồn khi tạo / sửa phiếu (`allocationStockMap_`) và khi lưu trữ sản phẩm dùng
đúng số theo sổ mà bước giữ chỗ sẽ dùng, chạy trước khi ghi nội dung phiếu. Đồng bộ dạng “hội tụ” nên gửi lại request, ký 2 lần hay
bấm *Đối soát kho* không ghi trùng; nhập kho / kiểm kê gửi lại cùng mã với số khác → `REQUEST_REUSED` (không âm thầm bỏ qua).
Lệch do ai đó sửa tay sheet tồn hiện ở *Dữ liệu cần kiểm tra* (“Số tồn lệch sổ biến động kho” → *Đồng bộ theo sổ*).
Chi tiết nghiệp vụ: [VAN_PHONG_PHAM.md](VAN_PHONG_PHAM.md).

### Email (MailApp)

`Notify.gs`: mã OTP khi ký (gửi lỗi → `MAIL_ERROR` cho người nhận — không bao giờ tự bỏ qua mã) và thông báo cho quản trị viên
(`CAU_HINH.NOTIFY_EMAILS`: yêu cầu chỉnh sửa, đề xuất mua mới, cần đối soát kho, email tổng hợp hằng ngày qua trigger). Thông báo
gửi **sau khi** thao tác chính đã ghi xong (`notifyAfterCommit_`): lỗi gửi không biến thao tác đã lưu thành lỗi, nhưng luôn ghi log
+ `NOTIFY_STATUS` → trang Tổng quan / Cài đặt hiện cảnh báo. Hạn mức gửi còn dưới 20 → tạm dừng thông báo, để dành cho mã OTP.

### Xuất CSV & huy hiệu menu

`GET /api/admin/export/:dataset` → Worker kiểm tra bộ lọc (Zod) → Apps Script `adminExportCsv` (action stream) lọc dữ liệu
(`exportAll`, tối đa 5.000 dòng) và **dựng CSV** (`Export.gs`: CRLF, chống chèn công thức, ngày giờ Việt Nam) → Worker đọc dòng phong
bì (số dòng / tổng / tên tệp) rồi chuyển thẳng nội dung kèm UTF-8 BOM → file đính kèm. CPU Worker không tăng theo số dòng (đo trên
Node: 5.000 dòng ≈ 2,2 ms trung vị / 4,5 ms lần đầu — dưới giới hạn 10 ms của Workers Free; dựng CSV ở Worker trước đây ≈ 22–33 ms).
`GET /api/admin/badges` chỉ đọc cột trạng thái của `BAN_GIAO` / `VPP_DE_XUAT` — menu quản trị tải lại khi đổi trang (tối đa 1 lần / phút).

## 5. Token link xác nhận

```text
nonce  = 32 byte ngẫu nhiên (base64url)                      → lưu BAN_GIAO.public_token_nonce
token  = base64url(HMAC_SHA256(linkKey, "link:" + nonce))    → chỉ xuất hiện trong link
hash   = SHA-256(token)                                      → lưu BAN_GIAO.public_token_hash (tra cứu)
linkKey = HMAC_SHA256(SESSION_SECRET, "dta-handover/link-token/v1")   (chỉ Worker biết)
```

- Token 256-bit, không tuần tự, không suy ra được từ dữ liệu Sheet nếu không có `SESSION_SECRET`.
- Admin “Copy link” hoạt động mà Sheet không lưu token gốc. Nếu `SESSION_SECRET` đổi, link cũ **vẫn dùng được** (tra theo hash)
  nhưng admin cần “Tạo link mới” để sao chép.

## 6. Hiệu năng & đồng thời trên Google Sheets

- Đọc/ghi theo lô (`getValues`/`setValues`, `RangeList`), helper `readTable_`, `readColumns_`, `appendObjects_`,
  `updateRowFields_` — **tìm lại dòng theo ID ngay trước khi ghi** (`verifiedRowIndex_`, không tin số dòng đã đọc), chỉ ghi
  các ô thực sự thay đổi (không ghi đè ô ở giữa), không đụng cột tự thêm của quản trị viên.
- Tra cứu theo `handover_id` / `public_token_hash` bằng `TextFinder` (khớp toàn ô) thay vì đọc cả sheet.
- ID là UUID, không phụ thuộc số dòng; hệ thống không xóa dòng nghiệp vụ (sắp xếp / chèn dòng không làm hỏng dữ liệu).
- Mọi thao tác ghi quan trọng nằm trong `withScriptLock_` (LockService, chờ tối đa 25 giây) và `SpreadsheetApp.flush()` trước
  khi nhả khóa.
- Ô dữ liệu định dạng văn bản (`@`) → Sheets không tự đổi `0519` thành số hay `2026-10-15` thành ngày; giá trị bắt đầu bằng
  `= + - @` được thêm `'` để không bị hiểu là công thức.

## 7. Cache

| Tầng | Dữ liệu | Thời gian | Làm mới |
|---|---|---|---|
| Apps Script `CacheService` | Nhân viên, loại nội dung, cấu hình, danh mục VPP công khai (JSON chia khối ≤ 25.000 ký tự) | 10 phút | `onEdit` khi sửa sheet, menu *Làm mới cache*, `refreshCaches()`, nút admin, tự xóa khi sửa sản phẩm / định mức |
| Worker (bộ nhớ isolate) | Danh mục VPP công khai, `/api/health` | 60 s / 15 s | Tự hết hạn |

Dữ liệu phiếu / xác nhận / **tồn kho** **không** được cache (`Cache-Control: no-store`; tồn luôn đọc mới trong khóa).

## 8. PDF

`Pdf.gs › ensurePdf_`: kiểm tra toàn vẹn (nội dung khớp `content_hash`, toàn biên bản khớp `record_hash`, niêm phong khớp khi Worker
gửi khóa — lệch → `INTEGRITY_ERROR` nêu phần bị sửa, không tạo PDF) → dựng HTML (bảng nội dung với **mọi trường có dữ liệu** — không
phụ thuộc cấu hình form hiện tại của loại nội dung; phiếu VPP: STT · Tên VPP · ĐVT · SL —, người giao/nhận, ghi chú, ảnh chữ ký
base64, thời điểm xác nhận, mã toàn vẹn, quốc hiệu / logo tùy chọn) → `HtmlService…getAs(PDF)` → lưu `pdf/YYYY/MM/<mã>.pdf`.
Phần chuyển đổi chạy ngoài khóa; chỉ bước ghi `pdf_file_id` chạy trong khóa. “Tạo lại PDF” chuyển bản cũ vào
`pdf-archive/YYYY/MM` (không xóa). Sinh tự động sau khi xác nhận (nền) và tự sinh lại khi tải nếu thiếu.

## 9. Xử lý lỗi

- Mọi API trả `{ success, data, error }` với HTTP status đúng nghĩa; frontend hiển thị `error.message` thân thiện, không
  hiển thị stack trace; mọi màn hình có trạng thái loading / empty / error + nút thử lại; ErrorBoundary chống màn hình trắng.
- Worker log JSON có `requestId` (header `X-Request-Id`), đường dẫn đã che token; không log body, cookie, secret, chữ ký.
- Apps Script log lỗi vào *Executions* (`logError_`), không log payload.

## 10. Quyết định thiết kế

| Quyết định | Lý do |
|---|---|
| Một Worker phục vụ cả SPA và API | Cùng origin → không cần CORS, cookie `SameSite=Lax` đơn giản, deploy một lệnh |
| Worker sinh token, Apps Script chỉ thấy hash | Token không đi qua Google; Sheet bị lộ cũng không mở được link |
| HMAC trong body thay vì header | Apps Script không đọc được header |
| Danh mục loại bàn giao cấu hình trong Sheet | Thêm loại / đổi nhãn không cần build lại |
| Phiên admin dạng cookie ký (stateless), tài khoản trong secret `ADMIN_USERS` | Không cần database phiên; mỗi người một tài khoản, đổi mật khẩu một người chỉ thu hồi phiên người đó |
| Chỉ quản trị viên tạo phiếu | Người lập phiếu được xác thực và ghi nhật ký; không còn API tạo phiếu / danh bạ công khai |
| Chữ ký gắn mã băm nội dung | Người nhận chỉ ký đúng nội dung đã xem; phát hiện sửa tay trên Sheet sau khi ký |
| Niêm phong toàn biên bản bằng khóa chỉ Worker có (`RECORD_SEAL_SECRET`) | Người sửa được Sheet / xem được Script Properties (script gắn với Sheet) vẫn không tự tính lại được niêm phong |
| Sửa phiếu theo phiên bản nội dung + dấu “đang sửa”, cột chốt ghi sau cùng | Google Sheets không có giao dịch: lỗi giữa chừng không bao giờ để lộ / cho ký nội dung lẫn cũ – mới; lưu lại là hoàn tất |
| Mã thao tác kèm dấu vân tay nội dung (`REQUEST_REUSED`) | Gửi lại sau khi mất phản hồi không ghi hai lần, và bản sửa không bị âm thầm bỏ qua |
| CSV dựng tại Apps Script, Worker chuyển thẳng (stream) | Giữ CPU Worker dưới giới hạn Workers Free bất kể số dòng |
| Phiếu VPP dùng chung `BAN_GIAO` / link xác nhận | Không có hệ thống phiếu thứ hai; ký = xuất kho |
| Tồn kho = trạng thái + nhật ký biến động bất biến | Truy vết mọi thay đổi; đồng bộ hội tụ chống ghi trùng |
| `SCHEMA_VERSION` + kiểm tra đủ cột + nâng cấp idempotent có sao lưu | Code mới không chạy trên cấu trúc cũ / thiếu cột; nâng cấp chạy lại an toàn, không mất dữ liệu |
| Mã OTP qua email khi ký (`CONFIRM_OTP`) | Link chỉ đủ để xem; ký cần chứng minh là chủ email của người nhận — người lập phiếu cầm link không ký thay được. Email lấy từ `NHAN_VIEN`, không do người dùng nhập |
| Sổ biến động là nguồn sự thật, ghi trước số tồn | Lỗi giữa chừng không bao giờ làm giữ chỗ / trừ kho 2 lần; số tồn luôn tính lại được từ sổ |
| Bộ giả lập Apps Script cho test | Kiểm thử tự động toàn chuỗi mà không cần tài khoản Google (không dùng cho production) |
| `npm run local` chạy Worker build trên Node | Người dùng tự bấm thử toàn bộ ứng dụng trên Windows mà không cần workerd / Google / Cloudflare |
