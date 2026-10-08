# Bảo mật — DTA Handover v2

## 1. Tài sản cần bảo vệ & mối đe dọa chính

| Tài sản | Mối đe dọa | Biện pháp |
|---|---|---|
| Secret (Apps Script URL, HMAC secret, tài khoản admin, khóa phiên) | Lộ qua frontend, repo, log | Chỉ nằm trong Cloudflare secrets / Script Properties; không có trong bundle JS; `.dev.vars` bị gitignore; không log |
| Apps Script Web App (truy cập “Anyone”) | Gọi trực tiếp bỏ qua Worker, giả mạo, phát lại, leo quyền | HMAC-SHA256 trên toàn bộ request + timestamp ±5 phút + `requestId` dùng một lần + **scope** theo từng action |
| Link xác nhận | Đoán / dò link, lộ qua log, Referer | Token 256-bit ngẫu nhiên; Sheet chỉ lưu SHA-256; giới hạn dò; che token trong log; `Referrer-Policy: no-referrer` |
| Chữ ký & nội dung đã ký | Ký nội dung chưa xem; sửa tay sau khi ký (kể cả ý kiến, ngày ký, tráo chữ ký, sửa rồi tự tính lại mã băm) | Ký gắn `contentHash` (409 khi nội dung đổi); lưu `content_hash` + `record_hash` (toàn biên bản) + **niêm phong** `record_seal` (HMAC bằng khóa chỉ Worker có); MISMATCH → không tạo PDF, không hiện chữ ký |
| Thao tác quản trị (tạo / sửa / hủy phiếu, kho, duyệt) | Gọi API trực tiếp không đăng nhập; không truy vết người làm | Mọi API `/api/admin/*` bắt buộc phiên admin (backend, không chỉ ẩn nút); action Apps Script scope `admin`; tài khoản riêng `ADMIN_USERS` → nhật ký ghi đúng người |
| Trang quản trị | Dò mật khẩu, đánh cắp phiên, CSRF | Rate limit theo IP + theo username, trễ 400ms khi sai; cookie HttpOnly/Secure/SameSite=Lax; kiểm tra Origin |
| Dữ liệu biên bản / chữ ký / PDF | Truy cập trái phép, XSS, chèn công thức Sheet, file giả mạo | API kiểm tra quyền; Drive private; chỉ trả file trong thư mục hệ thống, đúng PNG/PDF (MIME + chữ ký nhị phân), CSP sandbox; React escape; CSP; chống formula injection |
| Danh bạ nhân viên | Thu thập từ API công khai | **Không còn API danh bạ công khai**; trang đề xuất chỉ tra một người theo mã (không email / SĐT), giới hạn tần suất & số lần tra sai; tùy chọn `STAFF_ACCESS_CODE` |
| Kho văn phòng phẩm | Sửa tồn trái phép, âm tồn, ghi trùng | Chỉ admin; mọi thay đổi qua biến động bất biến (người thực hiện, lý do) trong LockService; `operation_id` chống ghi trùng; không âm tồn |

## 2. Quản lý secret

| Secret | Nơi lưu | Ghi chú |
|---|---|---|
| `GAS_WEB_APP_URL` | Cloudflare secret | Không bao giờ xuất hiện ở frontend |
| `GAS_SHARED_SECRET` = `BACKEND_SHARED_SECRET` | Cloudflare secret + Apps Script Script Properties | ≥ 32 ký tự ngẫu nhiên |
| `ADMIN_USERS` | Cloudflare secret (khuyến nghị) | JSON tài khoản riêng: username (a-z, 0-9, `. _ -`), tên, mật khẩu ≥ 12 ký tự; cấu hình sai → không ai đăng nhập được (báo lỗi cấu hình, không lộ giá trị) |
| `ADMIN_PASSWORD` | Cloudflare secret (tương thích bản cũ) | Mật khẩu chung — chỉ dùng khi không có `ADMIN_USERS`; trang quản trị cảnh báo nếu < 12 ký tự |
| `SESSION_SECRET` | Cloudflare secret | ≥ 32 ký tự; khóa ký cookie + dẫn xuất khóa link |
| `STAFF_ACCESS_CODE` | Cloudflare secret (tùy chọn, khuyến nghị) | Mã truy cập nội bộ cho trang đề xuất văn phòng phẩm `/de-xuat-vpp` |
| `RECORD_SEAL_SECRET` | Cloudflare secret (khuyến nghị) | ≥ 32 ký tự ngẫu nhiên — khóa niêm phong biên bản đã ký (mục 9). **Không** đặt ở Apps Script / Google; **không đổi** sau khi đã dùng (niêm phong cũ sẽ báo MISMATCH) |

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
- Link là bearer token để **xem**; để **ký**, người nhận có email trong `NHAN_VIEN` phải nhập **mã xác nhận (OTP) gửi tới email
  của chính họ** (`CAU_HINH.CONFIRM_OTP`, mục 4a) — người cầm link (kể cả người lập phiếu) không ký thay được. Thêm: chỉ quản trị
  viên đăng nhập mới tạo được phiếu (`created_by`); hệ thống ghi thời điểm, IP (hash), thiết bị, chữ ký và cách xác thực
  (`confirm_method`) khi xác nhận, **cảnh báo khi người nhận ký trên cùng thiết bị + mạng với lúc tạo phiếu** và khi ký không có mã;
  admin có thể **Tạo link mới** (vô hiệu link cũ); đổi người nhận khi sửa phiếu tự cấp link mới.
- Người nhận chỉ ký được **đúng nội dung đang xem**: trang gửi kèm `contentHash`; nội dung đã đổi → `409 CONFLICT`, trang tải
  bản mới và xóa chữ ký đang vẽ.
- Token không bao giờ được log: invocation log của Cloudflare bị tắt, access log của Worker che token
  (`/api/handover/AbCdEf…`); trang tĩnh gửi `Referrer-Policy: no-referrer`; link ngoài trong nội dung có
  `rel="noopener noreferrer"`.

### 4a. Mã xác nhận khi ký (OTP qua email)

- Chế độ `CAU_HINH.CONFIRM_OTP`: `EMAIL` (mặc định — bắt buộc khi người nhận có email; chưa có email vẫn ký nhưng phiếu ghi
  `NO_EMAIL` và trang quản trị cảnh báo), `REQUIRED` (chưa có email thì không ký được), `OFF`.
- Mã 6 chữ số từ SHA-256 của 2 UUID ngẫu nhiên; chỉ lưu `HMAC(BACKEND_SHARED_SECRET, "confirm-otp:" + handover_id + ":" + mã)`
  trong CacheService (mã của phiếu này không dùng được cho phiếu khác; người đọc được cache cũng không biết mã).
- Hiệu lực 10 phút; nhập sai tối đa 5 lần → hủy mã (`OTP_LOCKED`); so sánh thời gian hằng; mã chỉ bị hủy **sau khi** đã ghi chữ
  ký thành công (dùng một lần). Gửi mã: chờ 60 giây giữa hai lần, tối đa 3 lần / 15 phút và 10 lần / phiếu (chống spam email,
  bảo vệ hạn mức gửi); thêm giới hạn Worker 20 / phút / IP. Kết hợp giới hạn ký 10 / 10 phút / biên bản → đoán mã gần như không thể.
- Email gửi tới địa chỉ **hiện tại** trong `NHAN_VIEN` (không lấy email do người dùng nhập); trang ký chỉ hiện dạng che
  `t***@domain`. Email chứa mã, không chứa link ký.
- Lỗi gửi (hết hạn mức, chưa cấp quyền MailApp) → `MAIL_ERROR` cho người nhận, ghi log + `NOTIFY_STATUS` → trang Tổng quan cảnh
  báo. Không bao giờ tự bỏ qua mã khi gửi lỗi.

### 4b. Email thông báo cho quản trị viên

- Chỉ gửi tới `CAU_HINH.NOTIFY_EMAILS` (tối đa 20 địa chỉ hợp lệ); trống = không gửi. Nội dung escape HTML, link theo
  `CAU_HINH.APP_URL` tới trang quản trị (cần đăng nhập) — không chứa link ký, token hay mã OTP.
- Gửi sau khi thao tác chính đã lưu; lỗi gửi không làm hỏng thao tác nhưng luôn được ghi log + hiện trên trang quản trị.
  Hạn mức còn dưới 20 → tạm dừng email thông báo để dành cho mã OTP.

## 5. Xác thực quản trị

- `POST /api/admin/login`: tài khoản trong `ADMIN_USERS` (hoặc mật khẩu chung `ADMIN_PASSWORD`) — so sánh bằng HMAC với khóa
  ngẫu nhiên (thời gian hằng, không lộ độ dài), sai thì trễ 400ms; giới hạn 10 lần/phút/IP **và** 10 lần/phút/username tính
  chung mọi IP (dò một tài khoản từ nhiều IP vẫn bị chặn) — vượt → 429. Đánh đổi: ai cố gõ sai liên tục một tài khoản làm chủ
  tài khoản phải chờ 1 phút.
- Phiên: cookie `__Host-dta_admin` (HTTPS) — `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800` (8 giờ).
  Giá trị = claims base64url (gồm username) + HMAC; khóa ký = HMAC(`SESSION_SECRET`, loại phiên + SHA-256(mật khẩu của tài khoản)).
  ⇒ đổi mật khẩu một người → phiên của người đó hết hiệu lực; đổi `SESSION_SECRET` → mọi phiên hết hiệu lực.
- **Phân quyền ở backend:** tạo / sửa / hủy phiếu, duyệt đề xuất, nhập kho, kiểm kê, sửa định mức, quản lý sản phẩm, danh bạ —
  chỉ qua `/api/admin/*` (kiểm tra phiên) → Apps Script action scope `admin`. Gọi trực tiếp không phiên → 401; scope khác →
  `FORBIDDEN`. Ẩn nút trên giao diện chỉ là phụ.
- Không dùng `localStorage`/`sessionStorage` cho token; JavaScript không đọc được cookie phiên.
- Đăng xuất xóa cookie phía trình duyệt. Phiên là stateless nên cookie đã bị sao chép vẫn dùng được tới khi hết hạn —
  khi nghi ngờ lộ, đổi mật khẩu tài khoản đó (hoặc `SESSION_SECRET`).
- Có thể thêm lớp Cloudflare Access cho `/admin*` (xem CLOUDFLARE_DEPLOY.md §10).

### Mã truy cập nội bộ (tùy chọn, khuyến nghị)

Khi đặt `STAFF_ACCESS_CODE`, các API `/api/public/vpp/*` (tra mã NV, danh mục, gửi đề xuất) yêu cầu cookie phiên nhân viên
(30 ngày) có được sau khi nhập đúng mã. Không đặt → trang đề xuất mở cho người biết địa chỉ (vẫn phải nhập đúng mã NV, có
giới hạn tần suất); trang quản trị hiện cảnh báo. Link xác nhận của người nhận **không** yêu cầu mã này.

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
- **CSV injection (xuất CSV trong trang quản trị):** mọi ô trong dấu `"…"`; ô chữ bắt đầu bằng `= + - @` (kể cả full-width, sau
  khoảng trắng / ký tự điều khiển) hoặc Tab / CR được thêm `'` (OWASP); chỉ admin; `Cache-Control: private, no-store`. Thay cho
  việc tải CSV trực tiếp từ Google Sheets (Google bỏ dấu `'` khi xuất).
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
| Apps Script (CacheService) | Dò link: 30 lần sai / 10 phút / IP-hash; xác nhận & chỉnh sửa: 10 / 10 phút / **biên bản**; mã OTP: gửi lại sau 60 giây, 3 lần / 15 phút, 10 lần / biên bản, sai 5 lần / mã; tải PDF: 20 / 10 phút / biên bản; đề xuất VPP: 10 / ngày / **nhân viên** + 60 / giờ / IP-hash; tra mã NV: 150 / 10 phút / IP-hash, tra **sai** 20 / 10 phút / IP-hash |

Ngưỡng theo IP đặt rộng vì cả văn phòng thường đi ra Internet qua **một IP (NAT)**; giới hạn chính theo token / nhân viên / username.
IPv6 tính theo **dải /64** ở mọi lớp (IP-hash gửi Apps Script cũng băm theo dải /64): đổi địa chỉ trong cùng dải không né được giới
hạn, và cảnh báo “ký trên cùng thiết bị” không bị lỡ khi địa chỉ IPv6 tạm thời đổi.

## 9. Toàn vẹn dữ liệu

- Biên bản đã xác nhận không sửa, không hủy được (409); mọi thay đổi trạng thái ghi `LICH_SU` kèm dữ liệu cũ và người thực hiện.
- Kiểm tra trạng thái và ghi thay đổi trong cùng `LockService` → không xác nhận hai lần, không trùng mã, không xuất kho hai lần.
- Ghi theo **ID bất biến**, tìm lại dòng trước khi ghi, chỉ ghi ô thay đổi; không xóa dòng nghiệp vụ (sửa phiếu đánh dấu
  `superseded_at`, sản phẩm ngừng dùng `ARCHIVED`, biến động kho chỉ thêm).
- Toàn vẹn sau khi ký — so dữ liệu **hiện tại** với lúc ký (OK / MISMATCH / LEGACY), MISMATCH → không tạo lại PDF, không hiện chữ ký:
  - `content_hash`: nội dung bàn giao (người giao / nhận, ghi chú, từng dòng nội dung);
  - `record_hash`: toàn biên bản — mã / thời điểm lập, thời điểm ký, ý kiến người nhận, cách xác thực, mã băm + file chữ ký;
  - `record_seal` = HMAC(`record_hash`) bằng khóa Worker suy ra từ `RECORD_SEAL_SECRET` và gửi kèm từng request — khóa **không**
    lưu ở Apps Script / Sheet, nên người sửa được Sheet (kể cả xem được Script Properties, biết thuật toán băm) không tự tính lại
    được niêm phong. Worker không có khóa → “chưa kiểm tra được niêm phong” (không báo sai); ký khi chưa cấu hình → không có niêm
    phong (vẫn có `record_hash`).
- Sửa phiếu theo **phiên bản nội dung** (`items_revision` / `revision_id`, dấu `edit_pending`): lỗi giữa chừng không bao giờ để người
  nhận thấy / ký nội dung lẫn cũ – mới; đổi người nhận → link mới được ghi trước, người nhận cũ không ký được nội dung mới.
- Gửi lại cùng mã thao tác (`clientRequestId`) với nội dung khác → `409 REQUEST_REUSED` nêu bản ghi đã lưu — không trả bản cũ như
  “đã lưu”, không ghi lần hai (tạo phiếu, đề xuất, thêm sản phẩm, nhập kho, kiểm kê; nhận hàng theo đề xuất: lỗi 422 nêu số đã nhập).
- PDF có mã tham chiếu `handover_id`, mã toàn vẹn, thời điểm lập và xác nhận; tạo lại PDF giữ bản cũ trong `pdf-archive/`.
- Nâng cấp cấu trúc chỉ thêm sheet / cột, tự sao lưu trước; `SCHEMA_VERSION` + kiểm tra đủ cột chặn code mới chạy trên cấu trúc
  cũ; ghi vào cột hệ thống không có trên sheet → báo lỗi, không bỏ giá trị âm thầm.
- Kho: sổ biến động (`VPP_BIEN_DONG_KHO`) là nguồn sự thật, ghi trước số tồn; lỗi giữa chừng được đánh dấu và tự đồng bộ lại;
  lệch sổ (kể cả sửa tay sheet) hiện ở *Dữ liệu cần kiểm tra*. Ghép sản phẩm / nhập kho / kiểm kê idempotent theo mã thao tác.
- Ký tự điều khiển, ký tự định hướng chữ (bidi, kể cả Arabic Letter Mark U+061C) và ký tự vô hình (soft hyphen, combining
  grapheme joiner, ký tự đệm Hangul, ký tự tag U+E0000–E007F…) bị loại ở Worker và Apps Script (chống giả mạo hiển thị).
- Mã nguồn Apps Script: thiếu file / còn file của bản cũ (trộn phiên bản) → mọi request báo `NOT_CONFIGURED`, không chạy với code
  lẫn lộn (trước đây file v1 còn sót có thể nhận ký không cần mã OTP / không kiểm tra nội dung).

## 10. Ứng phó sự cố

| Tình huống | Hành động |
|---|---|
| Lộ mật khẩu một quản trị viên | Sửa mật khẩu người đó trong `ADMIN_USERS` (`wrangler secret put ADMIN_USERS`) — phiên của người đó mất hiệu lực; xem `LICH_SU` để rà thao tác |
| Lộ `ADMIN_PASSWORD` (chế độ mật khẩu chung) | `wrangler secret put ADMIN_PASSWORD` (mọi phiên cũ mất hiệu lực); nên chuyển sang `ADMIN_USERS` |
| Nghi ngờ phiếu đã ký bị sửa trên Sheet | Trang chi tiết hiện **MISMATCH** kèm phần không khớp (nội dung / toàn biên bản / niêm phong); đối chiếu *Lịch sử phiên bản* của Google Sheet và PDF gốc trong `pdf-archive/` |
| Lộ `RECORD_SEAL_SECRET` | Không đổi ngay (đổi → mọi niêm phong cũ báo MISMATCH): niêm phong chỉ còn tác dụng như mã băm thường cho tới khi xử lý; ghi nhận thời điểm lộ, đối chiếu biên bản ký sau thời điểm đó với PDF gốc |
| Lộ `SESSION_SECRET` | Đặt giá trị mới; phiên admin/nhân viên cũ mất hiệu lực; link cũ vẫn dùng được nhưng nên “Tạo link mới” cho biên bản đang chờ |
| Lộ `GAS_SHARED_SECRET` | Đổi đồng thời Script Property `BACKEND_SHARED_SECRET` và Cloudflare secret |
| Lộ một link xác nhận | Admin → biên bản → **Tạo link mới** (hoặc **Hủy** nếu cần) |
| Lộ `GAS_WEB_APP_URL` | Không đủ để truy cập (cần HMAC); có thể tạo deployment mới và cập nhật secret nếu muốn |
| Tài khoản Google sở hữu bị xâm phạm | Đổi mật khẩu Google, rà quyền chia sẻ Sheet/Drive, xoay `BACKEND_SHARED_SECRET` |
