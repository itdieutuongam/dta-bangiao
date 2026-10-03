# Bảo mật — DTA Handover

## 1. Tài sản cần bảo vệ & mối đe dọa chính

| Tài sản | Mối đe dọa | Biện pháp |
|---|---|---|
| Secret (Apps Script URL, HMAC secret, mật khẩu admin, khóa phiên) | Lộ qua frontend, repo, log | Chỉ nằm trong Cloudflare secrets / Script Properties; không có trong bundle JS; `.dev.vars` bị gitignore; không log |
| Apps Script Web App (truy cập “Anyone”) | Gọi trực tiếp bỏ qua Worker, giả mạo, phát lại | HMAC-SHA256 trên toàn bộ request + timestamp ±5 phút + `requestId` dùng một lần |
| Link xác nhận | Đoán / dò link, lộ qua log, Referer | Token 256-bit ngẫu nhiên; Sheet chỉ lưu SHA-256; giới hạn dò; che token trong log; `Referrer-Policy: no-referrer` |
| Trang quản trị | Dò mật khẩu, đánh cắp phiên, CSRF | Rate limit 10/phút/IP + trễ 400ms khi sai; cookie HttpOnly/Secure/SameSite=Lax; kiểm tra Origin |
| Dữ liệu biên bản / chữ ký | Truy cập trái phép, XSS, chèn công thức Sheet | API kiểm tra quyền; Drive private; React escape; CSP; chống formula injection |
| Danh bạ nhân viên | Thu thập từ API công khai | API chỉ trả trường cần thiết (không số điện thoại); tùy chọn `STAFF_ACCESS_CODE` |

## 2. Quản lý secret

| Secret | Nơi lưu | Ghi chú |
|---|---|---|
| `GAS_WEB_APP_URL` | Cloudflare secret | Không bao giờ xuất hiện ở frontend |
| `GAS_SHARED_SECRET` = `BACKEND_SHARED_SECRET` | Cloudflare secret + Apps Script Script Properties | ≥ 32 ký tự ngẫu nhiên |
| `ADMIN_PASSWORD` | Cloudflare secret | ≥ 12 ký tự; đổi = thu hồi mọi phiên admin |
| `SESSION_SECRET` | Cloudflare secret | ≥ 32 ký tự; khóa ký cookie + dẫn xuất khóa link |
| `STAFF_ACCESS_CODE` | Cloudflare secret (tùy chọn) | Mã truy cập nội bộ cho trang tạo bàn giao |

- Local: `.dev.vars` (trong `.gitignore`, kể cả `.dev.vars.*`); repo chỉ có `.dev.vars.example` không chứa giá trị.
- Build: `dist/client/.assetsignore` loại `.dev.vars`/`wrangler.json` khỏi static assets.
- Kiểm tra định kỳ: `grep -r "script.google.com" dist/client` phải không có kết quả.
- Xoay vòng (rotate): đặt giá trị mới bằng `wrangler secret put`; với `GAS_SHARED_SECRET` phải đổi **đồng thời** Script Property.

## 3. Worker ⇄ Apps Script

- Chuỗi ký: `v1\n<action>\n<scope>\n<ts>\n<requestId>\n<payload ASCII JSON>` → HMAC-SHA256 hex.
- Apps Script từ chối: thiếu/sai chữ ký (so sánh thời gian hằng), `|now − ts| > 5 phút`, `requestId` đã dùng (CacheService
  15 phút), action không tồn tại, action admin với `scope ≠ admin`.
- Worker chỉ theo redirect tới `script.google.com` / `*.googleusercontent.com`; `GAS_WEB_APP_URL` phải là
  `https://script.google.com/…` (chỉ cho phép `http://localhost` cho bộ giả lập khi test).
- Lỗi chữ ký trả về trình duyệt dạng 502 `UPSTREAM_AUTH_FAILED` với thông báo chung; chi tiết chỉ nằm trong log Worker.

## 4. Link xác nhận

- `token = base64url(HMAC-SHA256(linkKey, "link:" + nonce))`, `nonce` 32 byte ngẫu nhiên; `linkKey` dẫn xuất từ `SESSION_SECRET`.
- Sheet lưu `public_token_hash = SHA-256(token)` và `public_token_nonce`; không lưu token. Người có quyền đọc Sheet nhưng
  không có `SESSION_SECRET` **không** dựng được link.
- Định dạng token kiểm tra ở Worker (43 ký tự base64url) trước khi gọi Apps Script; Apps Script chặn IP (đã hash) sau
  30 lần tra link sai / 10 phút; xác nhận / yêu cầu chỉnh sửa tối đa 10 lần / 10 phút / biên bản.
- Link là **bearer token**: ai có link đều xem và ký được. Giảm thiểu: chỉ gửi link qua kênh nội bộ; hệ thống ghi lại thời
  điểm, IP (hash), thiết bị và chữ ký khi xác nhận; admin có thể **Tạo link mới** (vô hiệu link cũ) bất cứ lúc nào; đổi người
  nhận khi sửa biên bản tự cấp link mới.
- Token không bao giờ được log: invocation log của Cloudflare bị tắt, access log của Worker che token
  (`/api/handover/AbCdEf…`); trang tĩnh gửi `Referrer-Policy: no-referrer`; link ngoài trong nội dung có
  `rel="noopener noreferrer"`.

## 5. Xác thực quản trị

- `POST /api/admin/login`: so sánh `ADMIN_PASSWORD` bằng HMAC với khóa ngẫu nhiên (thời gian hằng, không lộ độ dài), sai thì
  trễ 400ms; giới hạn 10 lần/phút/IP (Cloudflare Rate Limiting) — vượt → 429.
- Phiên: cookie `__Host-dta_admin` (HTTPS) — `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800` (8 giờ).
  Giá trị = claims base64url + HMAC; khóa ký = HMAC(`SESSION_SECRET`, loại phiên + SHA-256(`ADMIN_PASSWORD`)).
  ⇒ đổi `ADMIN_PASSWORD` hoặc `SESSION_SECRET` là **mọi phiên cũ hết hiệu lực**.
- Không dùng `localStorage`/`sessionStorage` cho token; JavaScript không đọc được cookie phiên.
- Đăng xuất xóa cookie phía trình duyệt. Phiên là stateless nên cookie đã bị sao chép vẫn dùng được tới khi hết hạn —
  khi nghi ngờ lộ, đổi `ADMIN_PASSWORD`.
- Có thể thêm lớp Cloudflare Access cho `/admin*` (xem CLOUDFLARE_DEPLOY.md §10).

### Mã truy cập nội bộ (tùy chọn)

Khi đặt `STAFF_ACCESS_CODE`, các API `GET /api/employees`, `GET /api/categories`, `POST /api/handover` yêu cầu cookie phiên
nhân viên (30 ngày) có được sau khi nhập đúng mã — tránh người ngoài internet xem danh bạ nhân viên hoặc tạo biên bản rác.
Link xác nhận của người nhận **không** yêu cầu mã này. Khuyến nghị bật trên production.

## 6. CSRF, XSS, injection

- **CSRF:** cookie `SameSite=Lax` + mọi request thay đổi dữ liệu (POST/PUT) phải có `Origin` cùng domain (hoặc
  `APP_BASE_URL`), nếu không → 403; body bắt buộc `Content-Type: application/json`.
- **XSS:** React luôn render nội dung người dùng dạng text; không dùng `dangerouslySetInnerHTML` (mã QR vẽ bằng SVG path,
  không chèn HTML); CSP `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'…`;
  `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`. Link tài liệu chỉ chấp nhận `http(s)://`.
- **HTTPS:** tên miền riêng chỉ phục vụ HTTPS — HTTP được Cloudflare chuyển 301 sang HTTPS, cổng Pages (`gateway/`)
  gửi `Strict-Transport-Security: max-age=31536000`.
- PDF: mọi giá trị được escape HTML trước khi dựng.
- **Formula injection (Google Sheets):** giá trị bắt đầu bằng `= + - @` được ghi kèm `'`; ô dữ liệu định dạng văn bản.
- **Validation 3 lớp:** frontend (UX) → Worker (Zod, giới hạn kích thước body, kiểm tra PNG) → Apps Script (kiểm tra lại
  độ dài, kiểu, ngày, URL, loại bàn giao, người nhận tồn tại & ACTIVE, trạng thái biên bản trong khóa).
- Giới hạn độ dài: tên 120, ghi chú 2000, mô tả 2000, ghi chú nội dung 1000, ý kiến người nhận 1000, lý do hủy 500,
  tối đa 50 nội dung/biên bản, chữ ký ≤ 300KB và ≤ 1200×600.
- **Mật khẩu tài khoản bàn giao:** không có trường mật khẩu; nội dung dạng `mật khẩu: …`, `password=…`, `MK: …` bị từ chối ở
  cả frontend, Worker và Apps Script.

## 7. Quyền riêng tư & log

Không log: mật khẩu, secret, token đầy đủ, base64 chữ ký, body request, cookie.

| Dữ liệu cá nhân | Lưu ở đâu | Ghi chú |
|---|---|---|
| IP | `BAN_GIAO.created_ip_hash`, `confirmed_ip_hash`, `LICH_SU.metadata` | HMAC có khóa (không đảo ngược bằng bảng tra) |
| User-agent | `BAN_GIAO.user_agent`, `LICH_SU.metadata` | Bằng chứng thiết bị ký |
| Chữ ký | Drive (private) | Chỉ admin xem qua API; PDF tải bởi admin hoặc người có link của biên bản đã xác nhận |

## 8. Giới hạn tần suất

| Lớp | Phạm vi |
|---|---|
| Cloudflare Rate Limiting binding | 120 đọc / 20 ghi mỗi loại / 10 đăng nhập — mỗi phút mỗi IP |
| Worker (dự phòng) | Bộ đếm trong bộ nhớ cùng ngưỡng khi không có binding |
| Apps Script (CacheService) | Dò link: 30 lần sai / 10 phút / IP-hash; xác nhận & chỉnh sửa: 10 / 10 phút / biên bản; tạo: 60 / giờ / IP-hash; tải PDF: 20 / 10 phút / biên bản |

## 9. Toàn vẹn dữ liệu

- Biên bản đã xác nhận không sửa, không hủy được (409); mọi thay đổi trạng thái ghi `LICH_SU` kèm dữ liệu cũ.
- Kiểm tra trạng thái và ghi thay đổi trong cùng `LockService` → không xác nhận hai lần, không trùng mã.
- PDF có mã tham chiếu `handover_id`, thời điểm lập và xác nhận.

## 10. Ứng phó sự cố

| Tình huống | Hành động |
|---|---|
| Lộ `ADMIN_PASSWORD` | `wrangler secret put ADMIN_PASSWORD` (mọi phiên cũ mất hiệu lực) |
| Lộ `SESSION_SECRET` | Đặt giá trị mới; phiên admin/nhân viên cũ mất hiệu lực; link cũ vẫn dùng được nhưng nên “Tạo link mới” cho biên bản đang chờ |
| Lộ `GAS_SHARED_SECRET` | Đổi đồng thời Script Property `BACKEND_SHARED_SECRET` và Cloudflare secret |
| Lộ một link xác nhận | Admin → biên bản → **Tạo link mới** (hoặc **Hủy** nếu cần) |
| Lộ `GAS_WEB_APP_URL` | Không đủ để truy cập (cần HMAC); có thể tạo deployment mới và cập nhật secret nếu muốn |
| Tài khoản Google sở hữu bị xâm phạm | Đổi mật khẩu Google, rà quyền chia sẻ Sheet/Drive, xoay `BACKEND_SHARED_SECRET` |
