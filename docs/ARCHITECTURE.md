# Kiến trúc — DTA Handover

## 1. Thành phần

```text
┌──────────────────────────┐       ┌───────────────────────────────────────────────┐
│ Trình duyệt              │       │ Cloudflare (một Worker "dta-handover")        │
│ React SPA (Vite build)   │ HTTPS │ ┌───────────────────┐  ┌────────────────────┐ │
│ • /, /tao-ban-giao       │──────►│ │ Static Assets     │  │ Worker /api/*      │ │
│ • /xac-nhan/:token       │       │ │ dist/client, SPA  │  │ worker/index.ts    │ │
│ • /admin/...             │       │ │ fallback, _headers│  │ (run_worker_first) │ │
└──────────────────────────┘       │ └───────────────────┘  └─────────┬──────────┘ │
                                   └──────────────────────────────────┼────────────┘
                                                                      │ HTTPS POST (JSON, HMAC)
                                                                      ▼
                                   ┌───────────────────────────────────────────────┐
                                   │ Google Apps Script Web App (doPost)           │
                                   │ Security.gs → Code.gs router → Handovers.gs   │
                                   │ LockService · CacheService · PropertiesService│
                                   └──────────────┬──────────────────┬─────────────┘
                                                  ▼                  ▼
                                   ┌─────────────────────┐ ┌──────────────────────────┐
                                   │ Google Sheets       │ │ Google Drive             │
                                   │ NHAN_VIEN, BAN_GIAO │ │ DTA_HANDOVER/            │
                                   │ CHI_TIET_BAN_GIAO   │ │  signatures/YYYY/MM      │
                                   │ LOAI_BAN_GIAO       │ │  pdf/YYYY/MM             │
                                   │ LICH_SU, CAU_HINH   │ │  backups/                │
                                   └─────────────────────┘ └──────────────────────────┘
```

| Lớp | Công nghệ | Trách nhiệm |
|---|---|---|
| SPA | React 19, React Router 8, Tailwind CSS 4, Zod 4, Lucide | Giao diện, validate UX, khung ký Canvas (Pointer Events) |
| Worker | Cloudflare Workers + Static Assets, `@cloudflare/vite-plugin` | API `/api/*`: validate lại (Zod), rate limit, phiên admin, sinh token link, ký HMAC, chuyển lỗi thành HTTP status |
| Apps Script | V8 runtime | Xác thực request, nghiệp vụ, khóa ghi, đọc/ghi Sheet theo lô, lưu Drive, sinh PDF |
| Lưu trữ | Google Sheets / Drive | Database & file (chữ ký, PDF, backup) |

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
  "action": "createHandover",
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
- `scope` giới hạn action: action admin chỉ nhận `scope = admin` (Worker chỉ gửi scope này sau khi kiểm tra phiên admin).
- Response luôn HTTP 200 (giới hạn của Apps Script): `{ ok: true, data }` hoặc `{ ok: false, error: { code, message, details } }`.
  Worker ánh xạ `error.code` → HTTP status (`VALIDATION_ERROR`→422, `NOT_FOUND`→404, `ALREADY_CONFIRMED`/`INVALID_STATE`→409,
  `RATE_LIMITED`→429, `LOCK_TIMEOUT`/`NOT_CONFIGURED`→503, lỗi chữ ký→502 `UPSTREAM_AUTH_FAILED`, còn lại→500).
- Web App trả `302` sang `script.googleusercontent.com`; Worker tự theo redirect (chỉ tới host Google) với timeout
  30–120 giây tùy thao tác; đọc dữ liệu được thử lại 1 lần khi lỗi mạng.
- Response không phải JSON (trang HTML lỗi deploy/quyền) → 502 `UPSTREAM_ERROR`, log đoạn đầu để chẩn đoán.

## 4. Luồng nghiệp vụ

### Tạo biên bản

```text
SPA ──POST /api/handover──► Worker
                              ├─ requireStaff (nếu có STAFF_ACCESS_CODE), rate limit, kiểm tra Origin
                              ├─ Zod handoverInputSchema
                              ├─ issueLinkToken(): nonce ngẫu nhiên → token = HMAC(linkKey, nonce) → hash = SHA-256(token)
                              └─ callGas('createHandover', {..., tokenHash, tokenNonce, client:{ipHash,userAgent}})
                                      Apps Script:
                                      ├─ validate lại, người nhận phải ACTIVE trong NHAN_VIEN, áp quy tắc LOAI_BAN_GIAO
                                      └─ LockService: sinh mã BG-YYYYMMDD-XXXX → ghi BAN_GIAO + CHI_TIET_BAN_GIAO + LICH_SU
SPA ◄── 201 { code, status, receiver, link = APP_BASE_URL|origin + /xac-nhan/<token> }
```

Mã biên bản: trong khóa script, lấy `max(bộ đếm HANDOVER_SEQ của ngày, số lớn nhất đã có trong Sheet cho ngày đó) + 1`
— không trùng kể cả khi hai request tới cùng lúc hoặc property bị xóa. Ngày tính theo giờ Việt Nam.

### Người nhận xem & ký

```text
GET  /api/handover/:token          → Worker hash token → getHandoverByToken(tokenHash) → dữ liệu công khai + nhãn loại
POST /api/handover/:token/confirm  → Worker: Zod (agreed=true, PNG data URL), kiểm tra PNG (magic, IHDR, ≤300KB, ≤1200×600)
                                     → confirmHandover: LockService → đọc lại trạng thái → phải PENDING
                                       → lưu PNG vào Drive signatures/YYYY/MM → cập nhật BAN_GIAO → LICH_SU
                                     → ctx.waitUntil(generatePdf) — sinh PDF nền sau khi đã trả kết quả
POST /api/handover/:token/request-revision → REVISION_REQUESTED + lý do (LICH_SU)
GET  /api/handover/:token/pdf      → chỉ khi CONFIRMED; tự sinh PDF nếu chưa có
```

Chống ký lặp: kiểm tra trạng thái **sau khi giữ khóa**; lần thứ hai nhận `409 ALREADY_CONFIRMED`. Nếu lưu Drive lỗi,
trạng thái giữ nguyên `PENDING` (người nhận thử lại được); file mồ côi bị đưa vào thùng rác.

### Quản trị

- `POST /api/admin/login` → so sánh `ADMIN_PASSWORD` (HMAC thời gian hằng) → cookie phiên ký HMAC.
- Danh sách: Apps Script đọc `BAN_GIAO` + 2 cột của `CHI_TIET_BAN_GIAO` (1–3 lần `getValues`), lọc không dấu, sắp xếp mới
  nhất trước, phân trang, kèm thống kê toàn bộ.
- Chi tiết: kèm `tokenHash` + `tokenNonce` → Worker dựng lại link (`recoverConfirmLink`) rồi **loại bỏ** hai trường này.
- Sửa (chỉ `PENDING`/`REVISION_REQUESTED`): ghi lại thông tin + thay toàn bộ nội dung (ghi bản mới trước, xóa bản cũ sau),
  lưu nội dung cũ vào `LICH_SU.metadata`, trạng thái về `PENDING`. **Đổi người nhận → cấp link mới**, link cũ hết hiệu lực.
- Hủy: chỉ khi chưa xác nhận (biên bản đã ký là bất biến).
- Tạo link mới, xem chữ ký (PNG qua Worker), tải / tạo lại PDF.

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

- Đọc/ghi theo lô (`getValues`/`setValues`), helper `readTable_`, `appendObjects_`, `updateRowFields_` (chỉ ghi cột thay đổi,
  gộp cột liền kề, không đụng cột tự thêm của quản trị viên).
- Tra cứu theo `handover_id` / `public_token_hash` bằng `TextFinder` (khớp toàn ô) thay vì đọc cả sheet.
- ID là UUID, không phụ thuộc số dòng (sắp xếp/xóa dòng không làm hỏng dữ liệu).
- Mọi thao tác ghi quan trọng nằm trong `withScriptLock_` (LockService, chờ tối đa 25 giây) và `SpreadsheetApp.flush()` trước
  khi nhả khóa.
- Ô dữ liệu định dạng văn bản (`@`) → Sheets không tự đổi `0519` thành số hay `2026-10-15` thành ngày; giá trị bắt đầu bằng
  `= + - @` được thêm `'` để không bị hiểu là công thức.

## 7. Cache

| Tầng | Dữ liệu | Thời gian | Làm mới |
|---|---|---|---|
| Apps Script `CacheService` | Nhân viên, loại bàn giao, cấu hình (JSON chia khối ≤ 25.000 ký tự) | 10 phút | `onEdit` khi sửa sheet, menu *Làm mới cache*, `refreshCaches()`, nút admin |
| Worker (bộ nhớ isolate) | `/api/employees`, `/api/categories`, `/api/health` | 60 s / 15 s | Nút admin *Làm mới dữ liệu NV* (isolate hiện tại), tự hết hạn |

Dữ liệu biên bản/xác nhận **không** được cache (`Cache-Control: no-store`).

## 8. PDF

`Pdf.gs › ensurePdf_`: dựng HTML (bảng nội dung, người giao/nhận, ghi chú, ảnh chữ ký base64, thời điểm xác nhận, quốc hiệu
tùy chọn, logo tùy chọn từ `CAU_HINH.LOGO_FILE_ID`) → `HtmlService…getAs(PDF)` → lưu `pdf/YYYY/MM/<mã>.pdf`.
Phần chuyển đổi chạy ngoài khóa; chỉ bước ghi `pdf_file_id` chạy trong khóa (nếu request khác vừa tạo xong thì dùng file
đó và bỏ file trùng). Sinh tự động sau khi xác nhận (nền) và tự sinh lại khi tải nếu thiếu.

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
| Phiên admin dạng cookie ký (stateless) | Không cần database phiên; đổi `ADMIN_PASSWORD` là thu hồi mọi phiên |
| Bộ giả lập Apps Script cho test | Kiểm thử tự động toàn chuỗi mà không cần tài khoản Google (không dùng cho production) |
