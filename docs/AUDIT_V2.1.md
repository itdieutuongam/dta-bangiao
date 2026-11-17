# Báo cáo rà soát (audit) — DTA Handover v2.0 → v2.1

Ngày: 16–17/11/2026 · Phạm vi: toàn bộ mã nguồn v2.0.0 (commit `919fdb5`) — Apps Script, Cloudflare Worker, frontend, tài liệu,
quy trình vận hành — và **cấu trúc dữ liệu thật** của Google Sheet “XÁC NHẬN BÀN GIAO THIẾT BỊ” (chỉ đọc: tiêu đề cột, số dòng, có /
không có mã toàn vẹn; không chép dữ liệu cá nhân vào repo). Kết quả kiểm chứng bằng code chạy thật trong bộ giả lập Apps Script.

Ký hiệu mức: **P0** nghiêm trọng về tổ chức · **P1** cao · **P2** trung bình · **P3** thấp.
Trạng thái: ✅ đã sửa trong v2.1 · 🟡 sửa một phần · 🛠 việc vận hành (không sửa bằng code) · ⏳ chưa làm — đề xuất.

## 1. Tóm tắt

| Mức | Số phát hiện | ✅ | 🟡 | 🛠 / ⏳ |
|---|---|---|---|---|
| P0 | 2 | 0 | 1 | 1 |
| P1 | 21 | 12 | 3 | 6 |
| P2 | 17 | 7 | 6 | 4 |
| P3 | 21 | 3 | 2 | 16 |
| **Cộng** | **61** | **22** | **12** | **27** |

(Đếm theo mã phát hiện của từng nhóm rà soát — một số mã trùng nội dung giữa các nhóm, ví dụ SEC-1 = GAS-2, OPS-3 = GAS-1.)

Sáu vấn đề quan trọng nhất (đều đang xảy ra trên dữ liệu thật trước v2.1):

0. **Google Sheet dữ liệu chia sẻ “Bất kỳ ai có đường liên kết – Người chỉnh sửa”** (phát hiện 17/11/2026 khi triển khai, SEC-0) —
   ai có link xem / sửa / xóa được mọi dữ liệu (kể cả biên bản có mật khẩu bị lộ), người đăng nhập Google bất kỳ có link còn mở được
   Apps Script gắn với Sheet và đọc `BACKEND_SHARED_SECRET`. → v2.1 tự phát hiện (✗ ở *Kiểm tra cấu hình*, mục cần xử lý đầu tiên ở
   *Cài đặt*); **phải khóa chia sẻ (“Bị hạn chế”) và đổi khóa kết nối**. Thư mục DTA_HANDOVER (PDF, chữ ký) vẫn riêng tư.
1. **Mã xác nhận khi ký không bảo vệ ai** — 0/47 nhân viên có email nên mọi chữ ký đi đường “không cần mã”: người cầm link (kể cả
   người lập phiếu) ký thay được. → v2.1 cảnh báo rõ ở *Tổng quan*, *Cài đặt*, *Kiểm tra cấu hình*, in cách xác thực lên PDF;
   **cần bổ sung email rồi bật `CONFIRM_OTP = REQUIRED`**.
2. **Mật khẩu nằm trong biên bản đã ký** (BG-20261005-0001, mục Tài khoản, dạng “email / mật khẩu”) — lọt qua bộ lọc cũ. → bộ lọc mới
   chặn dạng này; **phải đổi mật khẩu tài khoản đó**.
3. **Định mức văn phòng phẩm “biến mất”** — tiêu đề `norm_id` của `VPP_DINH_MUC` bị gõ đè thành “m”, lần chạy thiết lập sau đó thêm
   cột `norm_id` trống → mọi định mức bị bỏ qua âm thầm. → v2.1 tự sửa khi nâng cấp + chặn tái diễn.
4. **Một tài khoản Google cá nhân sở hữu toàn bộ** Sheet, Drive, Apps Script, bản sao lưu — chưa có quy trình bàn giao. → kế hoạch
   ở [BAN_GIAO_HE_THONG.md](BAN_GIAO_HE_THONG.md).
5. **Niêm phong biên bản vô hiệu được** bằng cách xóa ô niêm phong và tự tính lại mã nội dung. → v2.1 coi niêm phong bị xóa là
   không khớp.

## 2. Danh sách phát hiện và trạng thái

### 2.1. Apps Script & dữ liệu (GAS)

| ID | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| GAS-1 | P1 | Tiêu đề cột bị đổi tên → cả hệ thống báo thiếu cột; “thiết lập lại” thêm cột trống, dữ liệu cột cũ bị bỏ qua (sự cố `norm_id`) | ✅ tự khôi phục tiêu đề định danh bị gõ đè, menu **Sửa cột định danh bị đổi tên** (chạy tự động khi nâng cấp), cảnh báo ở *Cài đặt* / *Kiểm tra cấu hình* |
| GAS-2 | P1 | Người nhận không có email ký không cần mã; không có số liệu độ phủ email; PDF không ghi cách xác thực | 🟡 cảnh báo độ phủ email (3 nơi) + dòng “Xác thực khi ký” trên PDF · 🛠 điền email, bật `REQUIRED` · ⏳ đặt mức tối thiểu ngoài Sheet |
| GAS-3 | P1 | Bộ lọc mật khẩu chỉ bắt “từ khóa : giá trị” | ✅ xem §3.1 · 🛠 đổi mật khẩu bị lộ · ⏳ công cụ quét / che dữ liệu cũ |
| GAS-4 | P1 | Xóa `record_hash` / `record_seal` + tự tính lại `content_hash` → hệ thống báo “khớp” | ✅ niêm phong bị xóa = `MISSING` (không khớp), chặn tạo lại PDF / xem chữ ký; ngoại lệ khai báo ở Cloudflare (`SEAL_LEGACY_IDS`) · ⏳ Worker tự kiểm niêm phong |
| GAS-5 | P1 | Mã định danh trống khớp với mọi dòng trống → đánh dấu `superseded_at` hàng loạt, link hiện 0 nội dung | ✅ mã trống không bao giờ khớp; cập nhật dòng không có mã chỉ khi dòng chưa bị thay |
| GAS-6 | P2 | Tiêu đề trùng tên: đọc cột cuối, ghi cột đầu (ký xong vẫn ký lại được) | ✅ đọc / ghi cùng cột đầu; cảnh báo tiêu đề trùng |
| GAS-7 | P2 | Dòng tiêu đề các sheet nhập tay không được bảo vệ; khóa sheet bỏ quyền của tài khoản chạy Web App | 🟡 `onEdit` tự đặt lại tiêu đề hệ thống bị gõ đè, dán đè nhiều ô → Web App dừng ghi thay vì bỏ qua cột · ⏳ khóa dòng 1, giữ quyền tài khoản triển khai |
| GAS-8 | P3 | Đọc nội dung phiếu quét cả các phiên bản cũ (chậm khi dữ liệu lớn) | ⏳ |
| GAS-9 | P3 | Tin `pdf_file_id` / `LOGO_FILE_ID` trên Sheet quá mức | ⏳ |
| GAS-10 | P3 | Sao lưu chỉ chép Sheet, không theo dõi, chưa thử khôi phục | ⏳ — kế hoạch ở BAN_GIAO_HE_THONG §6 |

### 2.2. Văn phòng phẩm (VPP)

| ID | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| VPP-1, 2, 3 | P1 | Hệ quả sự cố `norm_id`: không đọc được định mức, tạo định mức trùng, ghép sản phẩm bỏ qua định mức | ✅ (theo GAS-1) · 🛠 rà phiếu VPP tạo trong thời gian sự cố |
| VPP-4 | P1 | Không phòng ban nào khớp phạm vi định mức → định mức không áp dụng cho ai | 🛠 gắn phòng ban ở *Định mức* |
| VPP-5 | P2 | Sửa ĐVT sản phẩm khi còn tồn / giữ chỗ / định mức, không quy đổi | ⏳ |
| VPP-6 | P2 | Ghép lại sản phẩm đã kích hoạt lại bỏ qua chuyển tồn | ⏳ |
| VPP-7 | P2 | Áo bảo hộ cấp qua VPP — không có đường cho mượn / thu hồi | ✅ module Đồng phục có mẫu *Áo bảo hộ* (không tính tiêu chuẩn) · 🛠 chuyển tồn |
| VPP-8…11 | P3 | Sửa đồng thời ghi đè; đề xuất bị từ chối để sản phẩm “chờ duyệt”; quyết định quy đổi ghi đè yêu cầu gốc; quét cột khi giữ khóa | ⏳ |

### 2.3. Bảo mật (SEC)

| ID | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| SEC-0 | P0 | Sheet dữ liệu chia sẻ “Bất kỳ ai có đường liên kết – Người chỉnh sửa”: lộ + sửa / xóa được toàn bộ dữ liệu, mở được Apps Script (đọc khóa kết nối) — xem §1 | 🟡 v2.1 tự kiểm tra chia sẻ Sheet + thư mục DTA_HANDOVER (*Kiểm tra cấu hình* ✗, *Cài đặt*) · 🛠 khóa chia sẻ, đổi `BACKEND_SHARED_SECRET` = `GAS_SHARED_SECRET`, xem lịch sử phiên bản Sheet / file lạ trong Apps Script |
| SEC-1 | P1 | = GAS-2 (link ký là “vé” duy nhất) | 🟡 như GAS-2 |
| SEC-2 | P1 | = GAS-3 | ✅ |
| SEC-3 | P1 | Người sửa được Sheet đọc được `BACKEND_SHARED_SECRET`, gọi thẳng Apps Script với mọi quyền | ⏳ kiến trúc — giảm số người sửa Sheet, tách Apps Script khỏi Sheet (dự án độc lập do tài khoản công ty sở hữu); v2.1 hạn chế hệ quả bằng GAS-4 |
| SEC-4 | P1 | Request ký / yêu cầu sửa với token bịa giữ khóa toàn cục trước khi tra token (làm nghẽn hệ thống) | ✅ tra token trước khi giữ khóa, tính vào giới hạn dò link theo IP |
| SEC-5 | P2 | `CONFIRM_OTP`, `APP_URL`, email nhân viên nằm ở sheet không khóa | 🟡 *Cài đặt* cảnh báo khi `CONFIRM_OTP = OFF` · ⏳ |
| SEC-6 | P2 | Link xác nhận không hết hạn | ⏳ |
| SEC-7 | P2 | Mật khẩu chung không giới hạn đăng nhập theo tài khoản | 🛠 dùng `ADMIN_USERS` |
| SEC-8 | P3 | Kiểm tra file Drive chấp nhận mọi file trong thư mục gốc | ⏳ |
| SEC-9 | P3 | Không kiểm độ dài `SESSION_SECRET` | ✅ cảnh báo ở *Cài đặt* khi < 32 ký tự |
| SEC-10 | P3 | Log đăng nhập sai ghi nguyên văn tên đăng nhập (hay là mật khẩu gõ nhầm ô) | ✅ chỉ ghi tên có thật, còn lại “unknown” |
| SEC-11 | P3 | Địa chỉ `*.workers.dev` và bản xem trước cổng Pages vượt qua kiểm soát trên tên miền chính | 🛠 tắt `workers_dev` khi tên miền chính ổn định; tách binding cổng Pages cho preview |
| SEC-12 | P3 | `SECURITY.md` mô tả sai một số điểm | 🟡 cập nhật trong v2.1 |

### 2.4. Giao diện (FE)

| ID | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| FE-1 | P1 | Phiên hết hạn → vòng lặp đăng nhập lại | ✅ `handleError` ổn định |
| FE-2 | P1 | Người nhận ký kèm ghi chú trái nội dung, quản trị viên không biết | ✅ trang ký cảnh báo + nút chuyển ghi chú thành *Yêu cầu chỉnh sửa*; *Tổng quan* có thẻ “Đã ký kèm ghi chú”; danh sách phiếu hiện ghi chú |
| FE-3 | P2 | Khung ký lưu nét vẽ ra ngoài khung (ảnh chữ ký bị thu nhỏ / lệch) | ✅ giới hạn nét trong khung |
| FE-4 | P2 | Hộp thoại nuốt lỗi 401 | ✅ mọi 401 của API quản trị mở hộp thoại đăng nhập lại (giữ nguyên dữ liệu đang nhập) |
| FE-5 | P2 | “Làm mới dữ liệu” không cập nhật trang đang mở | ✅ mọi danh sách tự tải lại sau làm mới / đăng nhập lại |
| FE-6 | P2 | Không có cách nhập đồng phục có cấu trúc (mẫu + size + SL) | ✅ module Đồng phục |
| FE-10 | P3 | `useAsync` không hủy được, kết quả cũ ghi đè kết quả mới | ✅ AbortController + bộ đếm request |
| (thêm) | — | Ô số lượng lỗi khi xóa trống rồi gõ lại | ✅ `QuantityStepper` |
| FE-7, 8, 9, 11, 12 | P3 | Cảnh báo rời trang lúc đang gửi; thông báo trợ năng; bàn phím cho tab / radio; component quá lớn; trùng lặp code | ⏳ |
| FE-13 | P3 | Thiếu test cho các đường lỗi trên | 🟡 test Apps Script / Worker cho các sửa đổi; giao diện kiểm bằng trình duyệt (§4) |

Thêm (không có trong danh sách gốc): trang ký có link **Mở PDF trong trình duyệt** (trình duyệt trong Zalo / Facebook không tải được
tệp); màn hình tạo phiếu có nút **Chia sẻ (Zalo…)** trên điện thoại.

### 2.5. Vận hành & bàn giao (OPS)

| ID | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| OPS-1 | P0 | Một tài khoản Google cá nhân sở hữu dữ liệu, danh tính chạy Web App, email gửi đi, bản sao lưu; không có quy trình kế nhiệm | 🛠 BAN_GIAO_HE_THONG §2, §8 |
| OPS-2 | P1 | Sao lưu cùng tài khoản, chỉ Sheet, không theo dõi, chưa thử khôi phục | 🛠 BAN_GIAO_HE_THONG §6 · ⏳ ghi / hiện thời điểm sao lưu thành công |
| OPS-3 | P1 | = GAS-1 | ✅ |
| OPS-4 | P1 | Worker và Apps Script phát hành theo hai đường rời nhau, không biết bản Apps Script nào đang chạy | 🟡 quy trình phát hành + kiểm tra phiên bản (BAN_GIAO_HE_THONG §5); `Kiểm tra cấu hình` in phiên bản code |
| OPS-5 | P1 | Đổi / mất `RECORD_SEAL_SECRET` làm mọi niêm phong báo sai | 🛠 lưu secret trong kho mật khẩu công ty, KHÔNG đổi (BAN_GIAO_HE_THONG §3) · ⏳ hỗ trợ nhiều khóa |
| OPS-6 | P1 | `ADMIN_USERS` chứa mật khẩu dạng rõ trong một secret | ⏳ băm mật khẩu (scrypt / PBKDF2) |
| OPS-7 | P1 | Không có giám sát / cảnh báo | 🛠 BAN_GIAO_HE_THONG §7 |
| OPS-8 | P2 | Tài liệu nói “người cầm link không ký thay được” nhưng thực tế ký được | ✅ tài liệu + cảnh báo (GAS-2) |
| OPS-9, 10, 11 | P2 | Bộ giả lập khác Google thật; thiếu ca test đường quan trọng; Apps Script không lint / đo độ phủ | 🟡 thêm test cho mọi sửa đổi (271 test) · ⏳ lint `.gs`, đo độ phủ |
| OPS-12 | P2 | Tài liệu vận hành lỗi thời (danh sách secret, binding rate-limit, DNS…) | 🟡 cập nhật README, `wrangler.jsonc`, `.dev.vars.example`, tài liệu mới |
| OPS-13 | P3 | Phụ thuộc rất mới, không có Dependabot / `npm audit` | ⏳ |
| OPS-14 | P3 | Không có môi trường thử (staging) | ⏳ — tối thiểu dùng `npm run local` trước mỗi lần phát hành |

## 3. Chi tiết các sửa đổi chính trong v2.1

### 3.1. Bộ lọc mật khẩu (GAS-3 / SEC-2)

`shared/text.ts → containsPasswordLike / containsCredentialPair` và bản giống hệt `apps-script/Utils.gs` (test đối chiếu hai bên
cùng kết quả). Chặn thêm: “mật khẩu là …”, “mật khẩu wifi：…” (dấu full-width), “password is …”, “MK 123456”, link
`https://user:pw@host` / `…?pwd=`; mục **Tài khoản**: cặp “email / mật khẩu” (bỏ qua email / số điện thoại phía sau). Áp dụng cho
mọi ô nội dung, link tài liệu, ghi chú phiếu, **ghi chú khi ký** và **lý do yêu cầu sửa**. Không chặn câu thường (“Đã đổi mật
khẩu”, “Pass lại laptop…”, “Mật khẩu 8 ký tự…”, “Máy MKT-01…”). Test: `tests/audit-v21.test.ts`.

### 3.2. Niêm phong (GAS-4)

Khi Worker có `RECORD_SEAL_SECRET`, biên bản có mã nội dung mà ô `record_seal` trống → `seal: MISSING` → *không khớp*, không tạo lại
PDF, không hiện chữ ký như chữ ký thật. Biên bản ký trước khi có khóa khai báo ở biến Cloudflare `SEAL_LEGACY_IDS` (không nằm trên
Sheet). Dữ liệu thật (16/11/2026): 10/10 biên bản đã ký có mã nội dung đều có niêm phong (4 biên bản ký trước khi có mã nội dung
vẫn hiện “ký bằng phiên bản cũ”, không bị ảnh hưởng) → không cần khai báo. Test:
`tests/gas-review3.test.ts`, `tests/worker-api.test.ts`.

### 3.3. Cấu trúc dữ liệu (GAS-1, 5, 6, 7)

- Nâng cấp (`ensureSchemaV2_`) khôi phục tiêu đề định danh bị gõ đè trước khi thêm cột, rồi chép mã định danh sang cột định danh trống
  (không xóa cột nào). Menu **Sửa cột định danh bị đổi tên** làm riêng bước này.
- `setColumnForIds_` bỏ qua mã trống; `verifiedRowIndex_` từ chối ghi khi dòng đã bị thay.
- `rowToObject_` lấy cột đầu tiên khi trùng tên; *Kiểm tra cấu hình* / *Cài đặt* báo tiêu đề trùng.
- `onEdit`: gõ đè một ô tiêu đề hệ thống → tự đặt lại + thông báo; dán đè nhiều ô → bỏ bộ nhớ “cấu trúc đủ” để Web App dừng ghi.

### 3.4. Giao diện quản trị (FE-1, 4, 5, 10)

`src/hooks/useAsync.ts` (hủy request cũ, tự tải lại theo `ReloadEpochContext`), `src/services/api.ts` (401 của API quản trị phát sự
kiện `dta:admin-unauthorized`), `src/layouts/AdminLayout.tsx` (hộp thoại đăng nhập lại, `handleError` ổn định, làm mới dữ liệu tăng
`reloadEpoch`).

### 3.5. Module Đồng phục

Xem [DONG_PHUC.md](DONG_PHUC.md). Bộ máy sổ kho của VPP được tổng quát hóa (`stockStore_`) để đồng phục dùng chung, không nhân bản
logic kho. Mã băm nội dung giữ tương thích ngược: biên bản ký bằng v2.0 vẫn khớp (test so với chuỗi chuẩn hóa của v2.0).

## 4. Kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| `npm run typecheck`, `npm run lint` | sạch |
| `npm test` | 271 test (12 tệp) — Apps Script chạy trong bộ giả lập, Worker chạy thật trên Node |
| `npm run build` | thành công; các trang đồng phục tách chunk 5–11 KB |
| Bản gộp Apps Script | `npm run gas:bundle` → 563 KB, kiểm cú pháp đạt |
| Chạy thử cục bộ qua HTTP (`npm run local`) | tạo phiếu đồng phục → mã OTP → ký → chặn ghi chú có mật khẩu → trả đồ mượn → sổ cấp phát → PDF → 4 tệp CSV: đạt |
| Trình duyệt thật (Chrome, 1366×900 và 390×844) | 10 trang quản trị / đồng phục: không lỗi JavaScript, không tràn ngang |

Chưa kiểm trên Google thật (Apps Script / Sheets thật) — làm theo [UPGRADE_V2.1.md](UPGRADE_V2.1.md) và checklist nghiệm thu trong
[TESTING.md](TESTING.md) khi triển khai.

## 5. Lộ trình đề xuất (v2.2)

1. Vận hành: chuyển quyền sở hữu sang tài khoản / Shared Drive của công ty, sao lưu ngoài tài khoản, giám sát `/api/health` (OPS-1, 2, 7).
2. Bảo mật: băm mật khẩu `ADMIN_USERS` (OPS-6); hạn dùng link xác nhận (SEC-6); đặt mức OTP tối thiểu ở Cloudflare (GAS-2); Worker tự
   kiểm niêm phong (GAS-4); tách Apps Script khỏi Sheet (SEC-3).
3. Dữ liệu: khóa dòng tiêu đề mọi sheet hệ thống, giữ quyền tài khoản triển khai (GAS-7b); công cụ quét / che mật khẩu trong dữ liệu
   cũ (GAS-3); ghi / hiện thời điểm sao lưu thành công (GAS-10).
4. VPP: chặn đổi ĐVT khi còn tồn (VPP-5), sửa ghép lại (VPP-6), khóa lạc quan khi sửa (VPP-8).
5. Chất lượng: lint + kiểm kiểu cho `apps-script/*.gs`, đo độ phủ, Dependabot + `npm audit` trong CI, môi trường staging.
