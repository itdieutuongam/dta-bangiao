# Báo cáo sửa lỗi tồn đọng — DTA Handover v2.0.0

Phạm vi: toàn bộ phát hiện của đợt audit 06/10/2026 (H1–H2, M1–M7, L1–L9, tệp scan nhạy cảm), lỗi phát sinh trong lúc
phát triển module Văn phòng phẩm, 8 lỗi do **đợt rà soát độc lập** bản v2 tìm ra (REVIEW-1…8, đều đã dựng lại kịch bản trên
Apps Script giả lập trước khi sửa), **đợt rà soát 2** (07/10/2026 — “lỗi có thể phát sinh”: ghi dở, thao tác lặp, dữ liệu sửa tay,
giao diện; BUG-35…57) và **đợt rà soát 3** (08/10/2026 — toàn vẹn biên bản đã ký, ghi dở khi sửa phiếu, gửi lại sau khi mất
phản hồi, số kiểu Việt Nam, cài đặt Apps Script, CPU Workers Free; BUG-58…82). Mức độ theo quy ước: **P0** dữ liệu / bảo mật / hệ
thống không chạy · **P1** chức năng chính lỗi · **P2** logic / UX ảnh hưởng sử dụng · **P3** thẩm mỹ.

Trạng thái: **VERIFIED** = đã sửa và có kiểm thử tự động chứng minh · **FIXED** = đã sửa, kiểm chứng bằng lệnh / thao tác
(ghi rõ cách) · **GIẢM THIỂU** = đã giảm rủi ro, phần còn lại ghi ở “Rủi ro còn lại” · **CÒN LẠI** = chưa sửa, có lý do.

Bộ kiểm thử dẫn chiếu: `tests/gas.test.ts` (Apps Script), `tests/gas-vpp.test.ts` (văn phòng phẩm),
`tests/gas-notify.test.ts` (mã OTP, email thông báo, huy hiệu, xuất dữ liệu), `tests/gas-robustness.test.ts` (ghi dở giữa chừng, thao
tác lặp, dữ liệu sửa tay — rà soát 2), `tests/gas-review3.test.ts` (rà soát 3), `tests/worker-api.test.ts` (Worker ⇄ Apps Script),
`tests/worker-unit.test.ts`, `tests/shared.test.ts`, `tests/e2e/app.e2e.ts` (Chrome thật + Worker build production trên workerd).
Kết quả lần chạy cuối ở cuối tài liệu.

## Bảng tổng hợp

| ID | Audit | Mức | Tóm tắt | Trạng thái |
|---|---|---|---|---|
| BUG-01 | H1 | P0 | Chữ ký không gắn với phiên bản nội dung người nhận đã xem | VERIFIED |
| BUG-02 | H2 | P1 | Người lập phiếu giữ link, có thể ký thay người nhận | VERIFIED (mã OTP qua email) |
| BUG-03 | M1 | P0 | Ghi / xóa nhầm dòng khi Sheet bị sắp xếp hoặc sửa đồng thời | VERIFIED |
| BUG-04 | M2 | P1 | Không phát hiện sửa tay sau khi ký; tạo lại PDF xóa bản cũ | VERIFIED |
| BUG-05 | M3 | P1 | Một mật khẩu admin chung, không biết ai thao tác | VERIFIED |
| BUG-06 | M4 | P0 | Không đặt mã truy cập → danh bạ nhân viên & tạo phiếu công khai | VERIFIED |
| BUG-07 | M5 | P1 | File trả về không kiểm tra định dạng, hiển thị inline cùng domain | VERIFIED |
| BUG-08 | M6 | P2 | Không báo yêu cầu chỉnh sửa; trang người nhận ghi sai “Người bàn giao sẽ cập nhật” | VERIFIED (+ email, huy hiệu menu) |
| BUG-09 | M7 | P2 | Không có CI; push `main` là deploy không qua test | FIXED |
| BUG-10 | L1 | P2 | Loại nội dung đã tắt vẫn dùng được cho phiếu mới | VERIFIED |
| BUG-11 | L2 | P3 | `/api/health` công khai lộ cấu hình | VERIFIED |
| BUG-12 | L3 | P2 | Không loại ký tự bidi / vô hình (giả mạo tên, nội dung) | VERIFIED |
| BUG-13 | L4 | P2 | Giới hạn theo IP có thể chặn cả văn phòng dùng chung IP | VERIFIED |
| BUG-14 | L5 | P1 | Bấm gửi 2 lần / mạng chập chờn tạo phiếu trùng | VERIFIED |
| BUG-15 | L6 | P3 | Rủi ro CSV injection khi tải Sheet ra CSV | VERIFIED (xuất CSV an toàn trong ứng dụng) |
| BUG-16 | L7 | P2 | `readJson` đọc hết body rồi mới kiểm tra kích thước | VERIFIED |
| BUG-17 | L8 | P2 | Tác vụ nền tạo PDF đặt timeout 120 s, vượt giới hạn ~30 s của `waitUntil` | VERIFIED |
| BUG-18 | L9 | P3 | `upload_source_maps` bật nhưng không sinh source map | FIXED |
| BUG-19 | — | P0 | Tệp scan nhạy cảm `20261006104349488.pdf` (trang 2: sổ quỹ) nằm ở gốc repo, chưa bị ignore | FIXED |
| BUG-20 | mới | P1 | Gợi ý ghép tồn kho bỏ dấu (“Kéo” → “Kẹo phòng họp” 80%) và hộp thoại GHÉP chọn sẵn gợi ý | VERIFIED |
| BUG-21 | mới | P2 | Thêm sản phẩm vào danh mục kèm định mức lỗi: sản phẩm đã lưu nhưng báo lỗi; định mức thiếu phạm vi bị bỏ qua âm thầm | VERIFIED |
| BUG-22 | REVIEW-1 | P0 | Tên tự gõ trong đề xuất bị gắn bỏ dấu vào sản phẩm có sẵn (“Kẹo” / “Keo” → “Kéo”) — nhập kho nhầm | VERIFIED |
| BUG-23 | REVIEW-2 | P0 | Quyết định sản phẩm ở đề xuất khác lưu trữ / đổi mã sản phẩm đang có tồn + giữ chỗ | VERIFIED |
| BUG-24 | REVIEW-3 | P1 | Lỗi Sheets giữa chừng → giữ chỗ / ghép tồn bị cộng 2 lần, không phát hiện được | VERIFIED |
| BUG-25 | REVIEW-4 | P1 | GHÉP điền sẵn số lượng nguồn → “11 hộp” thành “11 cái” không cảnh báo ĐVT | VERIFIED |
| BUG-26 | REVIEW-5 | P2 | Giới hạn đăng nhập “theo tài khoản” thực ra vẫn theo IP | VERIFIED |
| BUG-27 | REVIEW-6 | P2 | Ô “Lý do vượt định mức” ẩn khi số liệu trên trang cũ → không lưu được phiếu | FIXED |
| BUG-28 | REVIEW-7 | P2 | Chạy lại “Khởi tạo định mức” sau khi sửa ĐVT / tên → tạo sản phẩm & định mức trùng | VERIFIED |
| BUG-29 | REVIEW-8 | P3 | “Ước tính” đề xuất không cập nhật; số liệu Tổng quan kho khác danh sách khi bấm vào | VERIFIED |
| BUG-30 | REVIEW | P1 | Sheet thiếu cột mới (ví dụ `confirm_method`) → giá trị bị bỏ âm thầm | VERIFIED |
| BUG-31 | mới | P1 | Phiếu VPP đã ký nhưng chưa xuất kho được chỉ ghi log — quản trị viên không biết | VERIFIED |
| BUG-32 | mới | P3 | 4 lỗi giao diện nhỏ (kiểm kê, chi tiết đề xuất, đếm “cần kiểm tra”, khung tải trong `<p>`) | FIXED |
| BUG-33 | mới | P3 | `onOpen` / `onEdit` nuốt lỗi không ghi log | FIXED |
| BUG-34 | mới | P2 | Không có lint; chạy thử cục bộ cần workerd (lỗi trên Windows) | FIXED |
| BUG-35 | RÀ SOÁT 2 | P1 | Mã OTP không gắn với email người nhận; gửi lại lỗi làm mất mã đã nhận; người cầm link chặn được việc ký | VERIFIED |
| BUG-36 | RÀ SOÁT 2 | P1 | Giới hạn đề xuất / nhân viên xin cache 24 giờ (Apps Script tối đa 6 giờ); đề xuất lỗi dữ liệu vẫn bị tính lượt | VERIFIED |
| BUG-37 | RÀ SOÁT 2 | P1 | Ghi dở giữa chừng: phiếu rỗng, “Đã xác nhận” khi chưa có chữ ký, đề xuất 0 dòng, tồn đầu kỳ không chạy lại được | VERIFIED |
| BUG-38 | RÀ SOÁT 2 | P2 | Thao tác đã lưu bị báo lỗi (ghi lịch sử lỗi), hủy phiếu trước khi trả giữ chỗ, lỗi `flush` bị nuốt | VERIFIED |
| BUG-39 | RÀ SOÁT 2 | P2 | Kho tính theo số trên sheet thay vì sổ biến động: kiểm kê bị “hoàn tác”, đồng bộ xóa tồn đầu kỳ nhập tay | VERIFIED |
| BUG-40 | RÀ SOÁT 2 | P2 | GHÉP: làm lại với đích khác ghi sai đích; tạo tồn “từ không khí”; nhận hàng cho sản phẩm đã ghép | VERIFIED |
| BUG-41 | RÀ SOÁT 2 | P2 | GHÉP sản phẩm mới trong đề xuất đổi ĐVT mà không quy đổi số lượng (“2 hộp” thành “2 cây”) | VERIFIED |
| BUG-42 | RÀ SOÁT 2 | P2 | Nhóm “có thể trùng” báo “Kéo” = “Kẹo”; định mức kèm theo lưu ở khóa thứ hai; sinh mã đọc từng ô; thứ tự đề xuất sai | VERIFIED |
| BUG-43 | RÀ SOÁT 2 | P2 | Trạng thái email: mã OTP gửi được xóa cảnh báo email thông báo; hạn mức 0 vẫn hiện tick xanh | VERIFIED |
| BUG-44 | RÀ SOÁT 2 | P2 | Trang ký công khai trả email đầy đủ của người nhận (khối OTP thì đã che) | VERIFIED |
| BUG-45 | RÀ SOÁT 2 | P2 | Một IP dò mật khẩu khóa được tài khoản quản trị (ngưỡng tài khoản = ngưỡng IP) | VERIFIED |
| BUG-46 | RÀ SOÁT 2 | P2 | Xuất CSV lớn có thể vượt CPU Workers Free; ngày gõ tay bị đảo ngày/tháng; số lượng biến động không có dấu | VERIFIED |
| BUG-47 | RÀ SOÁT 2 | P3 | Worker và Apps Script khác quy tắc link; 429 từ Apps Script thiếu `Retry-After`; IPv6 né giới hạn; tạo sản phẩm không chống trùng | VERIFIED |
| BUG-48 | RÀ SOÁT 2 | P1 | Đăng xuất / hết phiên rồi không đăng nhập lại được (form thiếu ô “Tên đăng nhập”, không báo lỗi) | VERIFIED |
| BUG-49 | RÀ SOÁT 2 | P1 | Trang ký kẹt khi chính sách OTP đổi sau lúc mở trang (không có ô nhập mã) | VERIFIED |
| BUG-50 | RÀ SOÁT 2 | P1 | Danh sách chọn sản phẩm tô sáng một mục khác giá trị thật → GHÉP / định mức vào nhầm sản phẩm | VERIFIED |
| BUG-51 | RÀ SOÁT 2 | P2 | Chi tiết đề xuất xóa số đang nhập; lỗi trong hộp thoại bị lớp phủ che; huy hiệu menu không cập nhật | VERIFIED |
| BUG-52 | RÀ SOÁT 2 | P2 | Trang ký: chuyển tab mất chữ ký; CONFLICT mất lý do / mã / đếm ngược; báo “bản mới nhất” khi tải lại lỗi; đếm ngược sai | VERIFIED |
| BUG-53 | RÀ SOÁT 2 | P2 | Hai quản trị viên cùng sửa một phiếu → người lưu sau ghi đè âm thầm | VERIFIED |
| BUG-54 | RÀ SOÁT 2 | P3 | Menu điện thoại không dùng được bàn phím; “Kéo”/“Keo” bị chặn ở trang đề xuất; lọc “Ngừng dùng” rỗng; nút thừa cho sản phẩm chờ duyệt | VERIFIED |
| BUG-55 | mới | P2 | Hộp thoại đặt lại form SAU khi đã hiện → số lượng đang gõ bị ghi đè (nhập kho sai số lượng) | VERIFIED |
| BUG-56 | mới | P2 | Đăng xuất lỗi mạng vẫn báo “Đã đăng xuất” trong khi phiên còn hiệu lực | FIXED |
| BUG-57 | RÀ SOÁT 2 | P3 | Máy chủ chạy thử: mở bằng 127.0.0.1 bị chặn, chọn nhầm card mạng ảo, đích yêu cầu do người gửi chọn, kết nối hỏng | VERIFIED |
| BUG-58 | RÀ SOÁT 3 | P1 | Biên bản đã ký: ý kiến người nhận, ngày lập / ký, chữ ký sửa được mà vẫn “OK”; người sửa Sheet tự tính lại được mã toàn vẹn | VERIFIED |
| BUG-59 | RÀ SOÁT 3 | P1 | Sửa phiếu không trọn vẹn: lỗi giữa chừng → nội dung lẫn cũ / mới vẫn ký được, lưu lại bị từ chối; người nhận cũ ký nội dung mới | VERIFIED |
| BUG-60 | RÀ SOÁT 3 | P1 | Phiếu VPP báo “không đủ tồn” nhưng vẫn lưu (kiểm tra đọc số trên sheet, giữ chỗ đọc sổ); lưu trữ được sản phẩm đang giữ chỗ | VERIFIED |
| BUG-61 | RÀ SOÁT 3 | P1 | README §7 thiếu `Notify.gs` trong danh sách file — cài theo đó thì mọi request lỗi INTERNAL | VERIFIED |
| BUG-62 | RÀ SOÁT 3 | P2 | Thứ tự file / file `.gs` bản cũ còn sót làm hỏng hoặc trộn code (v1 nhận ký không mã OTP) | VERIFIED |
| BUG-63 | RÀ SOÁT 3 | P2 | Gửi lại cùng mã thao tác với nội dung đã sửa (lần trước mất phản hồi): phiếu / đề xuất / sản phẩm cũ trả về như “đã lưu” | VERIFIED |
| BUG-64 | RÀ SOÁT 3 | P2 | Nhập kho / kiểm kê / nhận hàng: gửi lại khác số bị bỏ qua âm thầm; đóng rồi mở lại hộp thoại nhập kho → ghi 2 lần | VERIFIED |
| BUG-65 | RÀ SOÁT 3 | P1 | Số gõ kiểu Việt Nam bị chia 1000 (“15.000” lưu thành 15) ở mọi ô số; số gõ tay trên Sheet đọc sai | VERIFIED |
| BUG-66 | RÀ SOÁT 3 | P2 | ĐVT chỉ khác dấu (“Cuốn” / “Cuộn”) coi là một; thêm vào danh mục / giữ tạm đổi ĐVT không quy đổi; tên gõ đúng mất ĐVT gõ | VERIFIED |
| BUG-67 | RÀ SOÁT 3 | P2 | Lỗi giữa chừng khi quyết định sản phẩm / GHÉP → kẹt vĩnh viễn (“đã được xử lý trước đó”) | VERIFIED |
| BUG-68 | RÀ SOÁT 3 | P2 | GHÉP sản phẩm có định mức làm mất định mức của phòng ban âm thầm; trang Định mức vẫn tính | VERIFIED |
| BUG-69 | RÀ SOÁT 3 | P3 | Trạng thái đề xuất lệch thực tế (đã duyệt 0 sản phẩm; nhận toàn số 0 thành “Đã nhập kho”; sản phẩm chờ duyệt mồ côi) | VERIFIED (giao nhiều đợt: CÒN LẠI) |
| BUG-70 | RÀ SOÁT 3 | P3 | Số tồn gõ tay âm / có phần lẻ: kiểm kê ghi sai chênh lệch, số lẻ hiện “hết hàng” | VERIFIED |
| BUG-71 | RÀ SOÁT 3 | P3 | Phòng ban “Không áp dụng định mức” vẫn bị liệt kê là “chưa gắn” | VERIFIED |
| BUG-72 | RÀ SOÁT 3 | P2 | PDF / trang ký ẩn trường đã ký khi cấu hình form của loại nội dung đổi sau đó | VERIFIED |
| BUG-73 | RÀ SOÁT 3 | P3 | Email tổng hợp / sao lưu tự động chạy trùng khi nhiều người cùng cài trigger | VERIFIED |
| BUG-74 | RÀ SOÁT 3 | P2 | Xuất CSV vẫn vượt CPU Workers Free (BUG-46 chưa đủ): 5.000 dòng ≈ 22–33 ms | VERIFIED |
| BUG-75 | RÀ SOÁT 3 | P3 | IPv6 né giới hạn tra mã NV của Apps Script; cảnh báo “ký trên cùng thiết bị” bị lỡ (BUG-47 chưa đủ) | VERIFIED |
| BUG-76 | RÀ SOÁT 3 | P3 | Arabic Letter Mark và một số ký tự vô hình vẫn lọt (BUG-12 chưa đủ) | VERIFIED |
| BUG-77 | RÀ SOÁT 3 | P2 | Hết phiên khi đang điền form → mất toàn bộ nội dung (quản trị & trang đề xuất) | VERIFIED |
| BUG-78 | RÀ SOÁT 3 | P2 | Menu điện thoại: thông báo “Đăng xuất” / “Làm mới dữ liệu” bị menu che, không đọc được | VERIFIED |
| BUG-79 | RÀ SOÁT 3 | P3 | Chuyển trang trong ứng dụng (Back, link menu) bỏ form đang nhập không hỏi | VERIFIED |
| BUG-80 | RÀ SOÁT 3 | P3 | Số trang vượt quá → “không có kết quả” mâu thuẫn, không có đường quay lại | VERIFIED |
| BUG-81 | RÀ SOÁT 3 | P3 | Lỗi giao diện nhỏ: form VPP hiện số liệu người nhận cũ khi tải lỗi; Nhận hàng không tải lại khi dữ liệu đổi; ô số lượng mất vai trò spinbutton | VERIFIED |
| BUG-82 | RÀ SOÁT 3 | P3 | Tài liệu / CI lệch thực tế (`API.md`: kiểu `notify`, mã lỗi thiếu mã thao tác; CI Node 22 khác `.node-version` 24) | FIXED |

---

## BUG-01 — Chữ ký không gắn với phiên bản nội dung (H1, P0)

- **Before:** người nhận mở link (nội dung A); admin sửa phiếu thành B; người nhận bấm ký → chữ ký được ghi cho B — nội dung
  họ chưa từng thấy. Biên bản mất giá trị chứng cứ.
- **Root cause:** API ký / yêu cầu sửa chỉ nhận token, không kiểm tra phiên bản nội dung.
- **Fix:** `contentHash` = SHA-256 của JSON chuẩn hóa nội dung (người giao, người nhận, ghi chú, từng dòng). Trang người nhận
  nhận `contentHash` khi tải; ký / yêu cầu sửa **bắt buộc** gửi lại; Apps Script so với nội dung hiện tại trong khóa →
  lệch thì `409 CONFLICT`. Khi ký, lưu `content_hash` + `signature_sha256`. Giao diện: nhận CONFLICT → tải bản mới, xóa chữ
  ký đang vẽ, hiện “Biên bản vừa được cập nhật — kiểm tra lại trước khi ký”.
- **Files:** `apps-script/Handovers.gs` (`computeContentHash_`, `apiConfirmHandover_`, `apiRequestRevision_`),
  `shared/schemas.ts`, `shared/types.ts`, `worker/api/handover.ts`, `src/pages/ConfirmHandoverPage.tsx`, `src/services/handoverApi.ts`.
- **Test:** `gas.test.ts` “[BUG-01] admin sửa nội dung trong lúc người nhận đang mở trang → ký bản cũ bị chặn (CONFLICT)…”;
  `worker-api.test.ts` “[BUG-01] … ký bằng nội dung cũ trả 409 CONFLICT”; E2E ký trên điện thoại / desktop.
- **Status:** VERIFIED.

## BUG-02 — Người lập phiếu có thể ký thay người nhận (H2, P1)

- **Before:** ai mở trang tạo phiếu (công khai) cũng tạo được phiếu và cầm link ký; không phân biệt người ký.
- **Root cause:** link xác nhận là “bearer token”; người tạo không được xác thực; không có tín hiệu cảnh báo.
- **Fix:** (1) chỉ **quản trị viên đã đăng nhập** tạo phiếu (backend từ chối public), người lập ghi vào `created_by`;
  (2) lưu IP-hash + trình duyệt lúc tạo; khi ký trên **cùng thiết bị + mạng** → trang quản trị hiện cảnh báo
  “Người nhận ký trên cùng thiết bị…”; (3) màn hình kết quả & trang ký nhắc “ký trên điện thoại của chính bạn”, “chỉ
  <tên> được ký”.
- **Files:** `apps-script/Handovers.gs`, `worker/api/admin.ts`, `src/components/handover/CreatedPanel.tsx`,
  `src/pages/admin/AdminHandoverDetailPage.tsx`, `src/pages/ConfirmHandoverPage.tsx`.
- **Test:** `gas.test.ts` “[BUG-02] người nhận ký trên cùng thiết bị + mạng với lúc tạo phiếu → admin thấy cảnh báo”,
  “chỉ admin tạo / sửa / hủy phiếu…”; `worker-api.test.ts` “[QUYỀN] public KHÔNG tạo được phiếu…”.
- **Fix bổ sung (đợt 2 — mã OTP qua email):** khi ký, người nhận phải nhập **mã 6 số gửi tới email của chính họ** (email hiện tại
  trong `NHAN_VIEN`, che dạng `t***@example.com` trên trang ký). Mã chỉ lưu dạng HMAC (gắn với mã phiếu + khóa bí mật) trong
  CacheService, hết hạn 10 phút, sai 5 lần thì hủy, gửi lại sau 60 giây, tối đa 3 lần / 15 phút và 10 lần / phiếu; mã chỉ bị
  hủy **sau khi** ghi chữ ký thành công (lỗi Sheet/Drive tạm thời không bắt chờ mã mới). Chế độ theo `CAU_HINH.CONFIRM_OTP`:
  `EMAIL` (mặc định — người nhận chưa có email vẫn ký được nhưng phiếu ghi `confirm_method = NO_EMAIL` và hiện cảnh báo),
  `REQUIRED` (chưa có email thì không ký được), `OFF`. Cách xác thực lưu ở cột mới `BAN_GIAO.confirm_method`, lịch sử và trang
  chi tiết phiếu; màn hình tạo phiếu báo trước người nhận có phải nhập mã không.
- **Files (đợt 2):** `apps-script/Notify.gs` (mới), `apps-script/Handovers.gs`, `apps-script/Config.gs`, `apps-script/Code.gs`,
  `worker/api/handover.ts` (`POST /api/handover/:token/otp`), `worker/services/gas.ts`, `shared/schemas.ts`, `shared/types.ts`,
  `src/pages/ConfirmHandoverPage.tsx`, `src/components/handover/CreatedPanel.tsx`, `src/pages/admin/AdminHandoverDetailPage.tsx`.
- **Test (đợt 2):** `gas-notify.test.ts` “EMAIL (mặc định)…”, “nhập sai 5 lần → hủy mã; hết hạn; mã phiếu này không ký được phiếu
  khác”, “gửi mã: tối đa 3 lần / 15 phút và 10 lần / phiếu”, “người nhận chưa có email…”, “REQUIRED…”, “OFF…”, “gửi mã lỗi →
  MAIL_ERROR…”; `worker-api.test.ts` “OTP: phải có mã…”; E2E ký trên điện thoại (đọc mã từ hộp thư giả lập) và desktop (nhập
  sai mã → báo “còn 4 lần thử”, nhập đúng → ký được).
- **Status:** VERIFIED. **Lưu ý vận hành:** chủ sở hữu script phải cấp quyền “Gửi email” cho MailApp khi cập nhật code
  (menu *Kiểm tra cấu hình* báo ✗ nếu thiếu); hạn mức ~100 người nhận / ngày với Gmail thường. Muốn giữ luồng cũ: `CONFIRM_OTP = OFF`.

## BUG-03 — Ghi / xóa nhầm dòng (M1, P0)

- **Before:** `updateRowFields_` ghi một dải liên tục từ cột thay đổi đầu tới cuối, kéo theo giá trị cũ của các cột ở giữa
  (đè sửa đồng thời); `replaceItems_` xóa dòng theo số dòng đã đọc — nếu Sheet vừa được sắp xếp / chèn dòng thì xóa nhầm phiếu khác.
- **Root cause:** tin số dòng đọc trước đó; ghi theo dải thay vì theo ô.
- **Fix:** `verifiedRowIndex_` tìm lại dòng theo ID bất biến ngay trước khi ghi; chỉ ghi các ô thay đổi (theo nhóm ô liền
  nhau thực sự thay đổi); sửa phiếu **không xóa dòng** — dòng cũ đánh dấu `superseded_at` (RangeList); bỏ `deleteRowNumbers_`.
- **Files:** `apps-script/Utils.gs`, `apps-script/Handovers.gs`, `apps-script/Config.gs` (`ROW_ID_COLUMNS`).
- **Test:** `gas.test.ts` “[BUG-03] sheet BAN_GIAO bị sắp xếp đúng lúc đang lưu chữ ký → vẫn ghi đúng biên bản…”,
  “revision → sửa (không xóa dòng cũ, đánh dấu superseded)…”.
- **Status:** VERIFIED.

## BUG-04 — Không có bằng chứng toàn vẹn; tạo lại PDF xóa bản cũ (M2, P1)

- **Before:** ai có quyền sửa Sheet có thể sửa nội dung phiếu đã ký mà không để lại dấu; “Tạo lại PDF” dựng PDF từ dữ liệu
  hiện tại và đưa PDF gốc vào thùng rác.
- **Root cause:** không lưu dấu vân tay nội dung lúc ký.
- **Fix:** so `content_hash` lúc ký với nội dung hiện tại → `OK` / `MISMATCH` / `LEGACY` (phiếu v1); MISMATCH → từ chối tạo
  PDF (`INTEGRITY_ERROR`), trang quản trị hiện cảnh báo đỏ; PDF in mã toàn vẹn; PDF cũ chuyển vào `pdf-archive/YYYY/MM`.
- **Files:** `apps-script/Pdf.gs`, `apps-script/Drive.gs`, `apps-script/Handovers.gs` (`integrityOf_`),
  `src/pages/admin/AdminHandoverDetailPage.tsx`.
- **Test:** `gas.test.ts` “[BUG-04] dữ liệu biên bản đã ký bị sửa trực tiếp trên Sheet → admin thấy MISMATCH, không tạo PDF…”,
  “sinh PDF … tạo lại giữ bản cũ trong pdf-archive”, “[HỒI QUY] phiếu tạo từ v1 … LEGACY”; E2E kiểm tra “Nội dung hiện tại khớp…”.
- **Status:** VERIFIED.

## BUG-05 — Mật khẩu admin dùng chung (M3, P1)

- **Before:** một `ADMIN_PASSWORD` cho mọi người, nhật ký chỉ ghi “Quản trị viên”; giới hạn đăng nhập chỉ theo IP; không
  yêu cầu độ dài mật khẩu.
- **Fix:** secret `ADMIN_USERS` (JSON, mỗi người một tài khoản, mật khẩu ≥ 12 ký tự, kiểm tra cấu hình chặt); phiên ghi
  username; người thao tác `Tên (username)` được ghi vào `LICH_SU`, biến động kho, `created_by`; giới hạn đăng nhập thêm theo
  username; đổi mật khẩu một người chỉ hủy phiên người đó. `ADMIN_PASSWORD` vẫn chạy (tương thích) kèm cảnh báo trên trang quản trị.
- **Files:** `worker/auth/adminUsers.ts` (mới), `worker/auth/session.ts`, `worker/auth/guards.ts`, `worker/api/admin.ts`,
  `apps-script/Security.gs` (`sanitizeActor_`), `src/pages/admin/AdminLoginPage.tsx`, `src/layouts/AdminLayout.tsx`.
- **Test:** `worker-api.test.ts` “tài khoản quản trị riêng (ADMIN_USERS): bắt buộc username, nhật ký ghi đúng người, đổi mật
  khẩu → phiên cũ hết hiệu lực”; `gas-vpp.test.ts` (actor trong biến động kho, lịch sử định mức).
- **Status:** VERIFIED.

## BUG-06 — Danh bạ & tạo phiếu công khai khi không đặt mã truy cập (M4, P0)

- **Before:** `STAFF_ACCESS_CODE` để trống (mặc định) → ai biết địa chỉ cũng tải được **toàn bộ danh bạ** (tên, phòng ban,
  email) và tạo phiếu.
- **Root cause:** kiểm soát truy cập “fail-open”; dữ liệu nhạy cảm phục vụ trên API công khai.
- **Fix:** gỡ hẳn API tạo phiếu & danh bạ công khai (action Apps Script cũ trả `UNKNOWN_ACTION`); tạo phiếu và danh bạ chỉ qua
  `/api/admin/*` (phiên admin). Trang đề xuất VPP công khai chỉ tra **một** nhân viên theo mã (giới hạn tần suất + số lần tra
  sai), danh mục công khai chỉ có tên / ĐVT / nhóm. `STAFF_ACCESS_CODE` nay bảo vệ `/de-xuat-vpp`; trang quản trị cảnh báo khi chưa đặt.
- **Files:** `worker/index.ts`, `worker/api/handover.ts`, `worker/api/publicVpp.ts`, `worker/api/catalog.ts` (xóa),
  `apps-script/Code.gs`, `src/App.tsx`, `src/pages/CreateHandoverPage.tsx` (xóa).
- **Test:** `worker-api.test.ts` “[QUYỀN] public KHÔNG tạo được phiếu, không xem danh bạ — kể cả gọi API trực tiếp”,
  “[QUYỀN] public không chỉnh kho, không duyệt đề xuất, không xem kho admin”; `gas.test.ts` “chỉ admin tạo / sửa / hủy phiếu…”;
  `gas-vpp.test.ts` “scope public không gọi được thao tác quản trị VPP…”, “tra mã NV … danh mục công khai không có tồn / giá”;
  E2E “[QUYỀN] public không tạo phiếu / không xem kho / không chỉnh kho”.
- **Status:** VERIFIED.

## BUG-07 — File trả về không kiểm tra định dạng (M5, P1)

- **Before:** nếu ID file trong Sheet bị sửa trỏ tới một file HTML/JS trên Drive, Worker trả nội dung đó inline trên domain
  ứng dụng → XSS lưu trữ.
- **Fix:** Apps Script chỉ trả file **nằm trong thư mục `DTA_HANDOVER`** và đúng MIME mong đợi; Worker kiểm tra MIME + chữ ký
  nhị phân (PNG / `%PDF`), gắn `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`, PDF dạng `attachment`.
- **Files:** `apps-script/Drive.gs`, `apps-script/Pdf.gs`, `worker/api/common.ts`, `worker/utils/http.ts`.
- **Test:** `gas.test.ts` “[BUG-07] ID file trong Sheet bị sửa trỏ tới file ngoài hệ thống / sai định dạng → không trả về”;
  `worker-unit.test.ts` “chỉ trả đúng PNG / PDF (MIME + chữ ký nhị phân), có CSP sandbox”; `worker-api.test.ts` “admin: xem chữ
  ký & tải PDF qua Worker (Drive private, CSP sandbox)”.
- **Status:** VERIFIED.

## BUG-08 — Yêu cầu chỉnh sửa không được báo; văn bản sai (M6, P2)

- **Before:** người nhận yêu cầu sửa nhưng admin không có chỗ nào thấy ngay; trang người nhận ghi “Người bàn giao sẽ cập nhật”
  (người giao không sửa được phiếu).
- **Fix:** trang *Tổng quan* có khối “Yêu cầu chỉnh sửa cần xử lý” (mã, người nhận, lý do, thời gian) và số đếm; văn bản đổi
  thành “Quản trị viên sẽ cập nhật biên bản”; toast “Đã gửi yêu cầu chỉnh sửa tới quản trị viên”.
- **Files:** `apps-script/Handovers.gs` (`apiAdminOverview_`), `src/pages/admin/AdminOverviewPage.tsx`, `src/pages/ConfirmHandoverPage.tsx`.
- **Test:** `gas.test.ts` (danh sách admin: `adminOverview.revisionRequested`); E2E “yêu cầu chỉnh sửa … trang báo quản trị viên sẽ cập nhật”.
- **Fix bổ sung (đợt 2):** email tới `CAU_HINH.NOTIFY_EMAILS` (để trống = không gửi) khi người nhận yêu cầu chỉnh sửa, có đề xuất
  mua mới, phiếu VPP đã ký nhưng chưa xuất kho được; email tổng hợp hằng ngày (menu “Bật email tổng hợp hằng ngày”); huy hiệu số
  việc cần xử lý trên menu quản trị (`GET /api/admin/badges`). Gửi lỗi **không** làm hỏng thao tác đã lưu nhưng luôn được ghi log +
  lưu `NOTIFY_STATUS` → trang Tổng quan hiện cảnh báo đỏ, trang Cài đặt hiện chi tiết; còn dưới 20 lượt gửi / ngày thì tạm dừng email
  thông báo để dành cho mã OTP. Nội dung email đã escape HTML, link theo `CAU_HINH.APP_URL`, không chứa link ký.
- **Test (đợt 2):** `gas-notify.test.ts` “chưa cấu hình → không gửi…”, “yêu cầu chỉnh sửa → 1 email…”, “gửi lỗi → yêu cầu vẫn được
  lưu…; hạn mức thấp → tạm dừng thông báo nhưng vẫn gửi mã OTP”, “email tổng hợp hằng ngày…”, “adminBadges…”; `gas-vpp.test.ts`
  (email đề xuất mua đúng 1 lần, email “Cần đối soát kho”); `worker-api.test.ts` “huy hiệu menu”.
- **Status:** VERIFIED.

## BUG-09 — Không có CI, deploy không qua test (M7, P2)

- **Before:** push `main` → Cloudflare build `npm run build` và deploy ngay; test không chạy ở đâu cả.
- **Fix:** `.github/workflows/ci.yml` (typecheck → test → build → `wrangler deploy --dry-run` → bản gộp Apps Script; job E2E
  trên Chrome của runner); script `npm run verify`; `npm run deploy` = verify + build + deploy; tài liệu hướng dẫn đặt Build
  command của Cloudflare Workers Builds = `npm run verify && npm run build` để test lỗi thì không deploy.
- **Files:** `.github/workflows/ci.yml` (mới), `package.json`, `README.md`, `docs/CLOUDFLARE_DEPLOY.md`.
- **Test:** chạy cục bộ đúng các bước của workflow: `npm run typecheck` PASS, `npm run lint` PASS, `npm test` PASS (137),
  `npm run build` PASS, `npx wrangler deploy --dry-run` PASS, `npm run test:e2e` tương đương PASS (25). Workflow chạy trên GitHub
  sau lần push đầu.
- **Status:** FIXED. **Việc còn lại thủ công:** đổi Build command trong Cloudflare Dashboard.

## BUG-10 — Loại nội dung đã tắt vẫn nhận phiếu mới (L1, P2)

- **Fix:** kiểm tra `status` loại nội dung khi tạo; khi sửa phiếu cũ vẫn cho giữ loại đã có trong phiếu. Thêm kiểm tra loại
  nội dung thuộc đúng loại phiếu; văn phòng phẩm không nhập tay.
- **Files:** `apps-script/Handovers.gs`, `src/components/handover/formModel.ts`, `HandoverForm.tsx`.
- **Test:** `gas.test.ts` “loại phiếu giới hạn loại nội dung; văn phòng phẩm không nhập tay; loại đã tắt không dùng được cho phiếu mới”.
- **Status:** VERIFIED.

## BUG-11 — Health công khai lộ cấu hình (L2, P3)

- **Fix:** `/api/health` chỉ còn trạng thái tổng quát + 3 cờ sẵn sàng (`appsScript`, `session`, `admin`) — không còn cho biết
  mã truy cập nội bộ, số tài khoản, URL Apps Script…; chi tiết chuyển sang trang *Cài đặt* (chỉ admin).
- **Files:** `worker/api/health.ts`, `worker/api/admin.ts` (`/api/admin/system`), `src/pages/admin/AdminSettingsPage.tsx`.
- **Test:** `worker-api.test.ts` “GET /api/health: đủ thành phần, không lộ secret / cấu hình chi tiết”.
- **Status:** VERIFIED.

## BUG-12 — Ký tự bidi / vô hình (L3, P2)

- **Fix:** loại ký tự điều khiển C0/C1, định hướng chữ (U+202A–202E, U+2066–2069), vô hình (U+200B–200F, U+2060–2064, U+FEFF)
  ở cả Worker (`stripControlChars`) và Apps Script (`stripControl_`).
- **Files:** `shared/text.ts`, `apps-script/Utils.gs`.
- **Test:** `gas.test.ts` “chống formula injection, giữ nguyên số 0 đầu, loại ký tự định hướng chữ (bidi) / vô hình”; `shared.test.ts`.
- **Status:** VERIFIED.

## BUG-13 — Giới hạn theo IP chặn cả văn phòng (L4, P2)

- **Before:** các giới hạn tính theo IP; văn phòng ra Internet qua một IP (NAT) → nhiều người cùng thao tác bị chặn. Bản đầu của
  trang đề xuất VPP chỉ cho **10 đề xuất / giờ / IP**.
- **Fix:** thao tác của người nhận giới hạn theo **token** (không theo IP); đăng nhập admin thêm giới hạn theo username;
  đề xuất VPP: 60 / giờ / IP + **10 / ngày / nhân viên**; tra mã NV: 150 / 10 phút / IP, tra **sai** tối đa 20 / 10 phút / IP.
- **Files:** `apps-script/VppProposals.gs`, `apps-script/Vpp.gs`, `apps-script/Handovers.gs`, `worker/api/admin.ts`.
- **Test:** `gas-vpp.test.ts` “[BUG-13] cả văn phòng chung 1 IP (NAT) vẫn gửi được; giới hạn theo nhân viên (10/ngày) và số lần
  tra sai mã”; `gas.test.ts` “token sai → NOT_FOUND; dò nhiều lần → RATE_LIMITED”.
- **Status:** VERIFIED.

## BUG-14 — Gửi trùng tạo phiếu trùng (L5, P1)

- **Fix:** trình duyệt sinh `clientRequestId` (UUID) cho mỗi lần điền form; Apps Script kiểm tra trong khóa → gửi lại trả về
  phiếu đã tạo (`duplicate: true`, khôi phục link). Áp dụng cho đề xuất mua; nhập kho / kiểm kê dùng `operation_id`.
- **Files:** `apps-script/Handovers.gs`, `apps-script/VppProposals.gs`, `apps-script/Vpp.gs`, `src/utils/requestId.ts`,
  `src/pages/admin/AdminHandoverCreatePage.tsx`, `src/pages/ProposalPage.tsx`, `src/components/vpp/StockDialogs.tsx`.
- **Test:** `gas.test.ts` “gửi lại cùng clientRequestId … không tạo phiếu thứ hai”; `gas-vpp.test.ts` “gửi lại cùng
  clientRequestId → không giữ chỗ 2 lần…”, “… gửi lại không trùng”, “nhập kho (IN) idempotent theo clientRequestId”.
- **Status:** VERIFIED.

## BUG-15 — CSV injection (L6, P3)

- **Hiện trạng trước:** mọi giá trị bắt đầu bằng `= + - @` được lưu kèm `'` nên **trong Google Sheets** không thành công thức
  (đã có test). Khi *tải Sheet ra CSV* rồi mở bằng Excel, Google bỏ dấu `'` → công thức có thể chạy trên máy người mở.
- **Fix:** nút **Xuất CSV** ngay trong trang quản trị (danh sách biên bản, tồn kho, lịch sử kho, đề xuất mua) — xuất đúng bộ lọc
  đang xem, tối đa 5.000 dòng / lần (nhiều hơn → báo cắt bớt qua `X-Export-Truncated`). File UTF-8 có BOM (Excel đọc đúng tiếng
  Việt), CRLF, mọi ô trong dấu `"…"`; ô chữ bắt đầu bằng `= + - @` (kể cả dạng full-width, sau khoảng trắng / ký tự điều khiển) hoặc
  Tab / CR được thêm `'` theo khuyến nghị OWASP; số giữ nguyên. Chỉ admin; header `Cache-Control: private, no-store`, CSP sandbox.
- **Files:** `worker/utils/csv.ts` (mới), `worker/api/export.ts` (mới), `worker/utils/http.ts`, `apps-script/*` (cờ `exportAll`),
  `src/components/ExportCsvButton.tsx` (mới), 4 trang danh sách.
- **Test:** `worker-unit.test.ts` “CSV xuất dữ liệu …”; `worker-api.test.ts` “xuất CSV: chỉ admin, UTF-8 BOM + CRLF, chống chèn
  công thức…”; `gas-notify.test.ts` “exportAll…”.
- **Status:** VERIFIED. **Lưu ý:** menu *Tệp → Tải xuống → CSV* của chính Google Sheets vẫn nằm ngoài ứng dụng — dùng nút Xuất CSV
  của ứng dụng thay cho thao tác đó.

## BUG-16 — Đọc hết body trước khi kiểm tra kích thước (L7, P2)

- **Fix:** `readJson` đọc dạng stream, dừng ngay khi vượt giới hạn (kể cả không có `Content-Length`) → `413`.
- **Files:** `worker/utils/request.ts`.
- **Test:** `worker-unit.test.ts` “readJson dừng đọc khi vượt giới hạn, kể cả không có Content-Length”; `worker-api.test.ts`
  “HTTP status & bảo vệ: 400 / 403 / 404 / 405 / 413 / 429”.
- **Status:** VERIFIED.

## BUG-17 — Timeout tác vụ nền vượt giới hạn `waitUntil` (L8, P2)

- **Fix:** timeout tạo PDF nền 25 s (`BACKGROUND_PDF_TIMEOUT_MS`); nếu chưa xong, endpoint tải PDF tự sinh lại.
- **Files:** `worker/api/handover.ts`.
- **Test:** `worker-unit.test.ts` “[BUG-17] tác vụ nền sinh PDF (waitUntil) kết thúc trước giới hạn ~30 giây”.
- **Status:** VERIFIED.

## BUG-18 — `upload_source_maps` không có tác dụng (L9, P3)

- **Fix:** bật source map **chỉ cho Worker** (`environments.dta_bangiao.build.sourcemap` trong `vite.config.ts`) — stack trace
  trong Workers Logs đọc được; không bật cho client để không phát hành mã nguồn frontend.
- **Files:** `vite.config.ts`.
- **Test:** `npm run build` → có `dist/dta_bangiao/index.js.map`, bundle kết thúc bằng `//# sourceMappingURL=index.js.map`;
  `dist/client` không có tệp `.map`; `wrangler deploy --dry-run` PASS.
- **Status:** FIXED.

## BUG-19 — Tệp scan nhạy cảm ở gốc repo (P0)

- **Before:** `20261006104349488.pdf` (bản scan định mức, **trang 2 là sổ quỹ**) nằm ở thư mục gốc, chưa bị ignore → dễ bị commit
  lên GitHub.
- **Fix:** `.gitignore` thêm `/*.pdf`; script đồng bộ WSL loại trừ `*.pdf`. Tệp **không** bị xóa (là tài liệu của người dùng).
- **Test:** `git check-ignore -v 20261006104349488.pdf` → `.gitignore:37:/*.pdf`.
- **Status:** FIXED. **Khuyến nghị:** chuyển tệp ra khỏi thư mục repo.

## BUG-20 — Gợi ý ghép tồn kho bỏ dấu + chọn sẵn (mới, P1)

- **Before:** trang *Dữ liệu cần kiểm tra* gợi ý “Kéo” (cái kéo) → “Kẹo phòng họp” 80%, “Bút lông bảng” → “Bút bi” vì so khớp
  không dấu; hộp thoại GHÉP **chọn sẵn** gợi ý đầu tiên → bấm “Ghép” là chuyển tồn kéo sang kẹo.
- **Root cause:** so khớp tên sau khi bỏ dấu tiếng Việt (kéo = kẹo = keo); giao diện coi gợi ý là mặc định.
- **Fix:** so khớp **có dấu** là chính (bỏ dấu chỉ là phương án phụ, điểm × 0.6); từ đồng nghĩa kính ↔ kiếng; hộp thoại GHÉP
  không chọn sẵn sản phẩm đích (gợi ý chỉ được đánh dấu ★).
- **Files:** `apps-script/Vpp.gs` (`toneTokens_`, `nameSimilarity_`), `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-vpp.test.ts` “liệt kê sản phẩm chưa ghép kèm gợi ý…” ([BUG-20]: “Kéo” không có gợi ý; “Bút lông bảng” không gợi ý
  “Bút bi”; “Giấy ướt” → “Khăn giấy ướt”, “Lau kính” → “Nước lau kiếng”).
- **Status:** VERIFIED.

## BUG-21 — Định mức kèm theo được kiểm tra sau khi đã lưu sản phẩm (mới, P2)

- **Before:** *TẠO SẢN PHẨM MỚI* / *THÊM VÀO DANH MỤC* kèm định mức: sản phẩm được lưu trong khóa, định mức kiểm tra **sau** khi
  nhả khóa → định mức trùng / phạm vi mới chưa có tên làm API báo lỗi trong khi sản phẩm đã đổi trạng thái; định mức gửi lên
  thiếu phạm vi thì bị **bỏ qua âm thầm** (chỉ chặn ở giao diện, gọi API trực tiếp thì lọt).
- **Root cause:** hai bước ghi không cùng một đơn vị kiểm tra; điều kiện “có định mức” lọc bỏ dữ liệu sai thay vì báo lỗi.
- **Fix:** `precheckAttachedNorm_` kiểm tra định mức kèm theo (phạm vi, tên phạm vi mới, số lượng, trùng định mức đang hiệu lực)
  **trong khóa, trước khi ghi** sản phẩm; có gửi định mức thì bắt buộc hợp lệ.
- **Files:** `apps-script/Vpp.gs` (`precheckAttachedNorm_`, `apiVppPromoteProduct_`), `apps-script/VppProposals.gs`
  (`apiVppProductDecision_`), `src/pages/admin/vpp/VppDataReviewPage.tsx` (hiện lỗi phạm vi).
- **Test:** `gas-vpp.test.ts` “[BUG-21] định mức kèm theo không hợp lệ / trùng → báo lỗi và KHÔNG lưu sản phẩm”, “duyệt một phần
  → đã mua → nhập kho …” ([BUG-21]: quyết định THÊM VÀO DANH MỤC với định mức thiếu phạm vi → sản phẩm vẫn chờ duyệt).
- **Status:** VERIFIED.

## BUG-22 — Tên tự gõ trong đề xuất bị gắn nhầm sản phẩm (REVIEW-1, P0)

- **Before:** nhân viên đề xuất “Kẹo” (bánh kẹo) hoặc “Keo” (keo dán) → hệ thống so tên **bỏ dấu** và gắn thẳng vào sản phẩm tạm
  “Kéo” (cái kéo) có sẵn, bỏ tên đã gõ, không cần duyệt; duyệt + nhập 5 → tồn **kéo** 1 → 6. Tên trùng sản phẩm đã ngừng dùng thì
  dòng bị kẹt (không nhập kho được, không có nút xử lý).
- **Root cause:** `matchKey_` bỏ dấu tiếng Việt (kéo = kẹo = keo) và cho khớp cả sản phẩm tạm / ngừng dùng.
- **Fix:** chỉ tự gắn khi tên **trùng khớp hoàn toàn có dấu** (`exactNameKey_`: bỏ khác biệt hoa / thường, khoảng trắng, dạng
  Unicode) với **sản phẩm danh mục đang dùng**; còn lại mỗi dòng tạo **sản phẩm chờ duyệt riêng** để quản trị viên quyết định.
- **Files:** `apps-script/Utils.gs` (`exactNameKey_`), `apps-script/VppProposals.gs` (`apiVppSubmitProposal_`).
- **Test:** `gas-vpp.test.ts` “[REVIEW-1] tên tự gõ chỉ gắn vào sản phẩm DANH MỤC trùng tên có dấu…”.
- **Status:** VERIFIED.

## BUG-23 — Quyết định sản phẩm ở đề xuất khác phá sản phẩm đang dùng (REVIEW-2, P0)

- **Before:** hai nhân viên đề xuất cùng một món mới (cùng trỏ một sản phẩm chờ duyệt). Admin thêm vào danh mục từ đề xuất 1, nhập
  10, phiếu giữ chỗ 4. Đề xuất 2 vẫn hiện “Xử lý sản phẩm mới”: bấm TỪ CHỐI → **lưu trữ** sản phẩm đang có tồn 10 / giữ chỗ 4 (biến
  mất khỏi danh mục, phiếu chờ không sửa được, không nhập kho được); GHÉP lưu trữ mà không chuyển tồn; THÊM lại đổi mã sản phẩm.
  Trạng thái tương tự xảy ra khi đổi trạng thái “Chờ duyệt” trong hộp thoại sản phẩm hoặc kiểm kê sản phẩm chờ duyệt.
- **Root cause:** điều kiện chặn dùng `&&` thay vì `||` (chỉ cần dòng còn PENDING là cho quyết định); không có ràng buộc giữa trạng
  thái sản phẩm và các dòng đề xuất trỏ vào nó.
- **Fix:** chỉ quyết định khi **cả dòng lẫn sản phẩm** còn chờ duyệt; quyết định áp luôn cho mọi dòng khác còn chờ của cùng sản
  phẩm (dữ liệu cũ) và tính lại ước tính các đề xuất đó; sản phẩm chờ duyệt **không** đổi trạng thái / kiểm kê / nhập kho / GHÉP /
  TẠO MỚI / BỎ QUA ngoài trang đề xuất (báo rõ cách làm); không cho tự đặt trạng thái “Chờ duyệt”.
- **Files:** `apps-script/VppProposals.gs` (`apiVppProductDecision_`, `syncPendingProposalLines_`), `apps-script/Vpp.gs`
  (`apiVppSaveProduct_`, `apiVppStockAdjust_`, `apiVppMergeProduct_`, `apiVppPromoteProduct_`, `apiVppSkipReview_`),
  `src/pages/admin/vpp/VppDataReviewPage.tsx` (ẩn nút ghép với sản phẩm chờ duyệt).
- **Test:** `gas-vpp.test.ts` “[REVIEW-2] sản phẩm chờ duyệt chỉ xử lý trong đề xuất…”, “[REVIEW-2/8] dữ liệu cũ: 2 đề xuất cùng trỏ
  1 sản phẩm chờ duyệt…”.
- **Status:** VERIFIED.

## BUG-24 — Lỗi Sheets giữa chừng làm lệch kho không phát hiện được (REVIEW-3, P1)

- **Before:** `applyStockMovements_` ghi **số tồn trước, sổ biến động sau**. Một lỗi Sheets tạm thời khi ghi sổ lúc tạo phiếu VPP
  → giữ chỗ = 3 nhưng sổ không có dòng nào; bấm tạo lại (cùng `clientRequestId`) → giữ chỗ 6; danh sách “lệch kho” trống, “Đối soát
  kho” không sửa được; hủy phiếu vẫn còn 3 bị giữ vĩnh viễn. GHÉP lỗi sau khi đã chuyển tồn → làm lại cộng tồn đích lần 2.
- **Root cause:** hai lần ghi không nguyên tử, ghi phần “tổng hợp” trước phần “nguồn sự thật”; GHÉP không có khóa chống lặp.
- **Fix:** **sổ biến động là nguồn sự thật, ghi trước** (1 lần `setValues`), rồi mới cập nhật số tồn; trước khi ghi đặt dấu
  `VPP_STOCK_DIRTY` (Script Property) và xóa khi xong → lỗi ở bất kỳ bước nào để lại dấu → lần ghi kho kế tiếp (hoặc trang
  Tồn kho / Tổng quan kho / Dữ liệu cần kiểm tra) **tự tính lại** tồn các sản phẩm đó từ sổ, ghi lịch sử `VPP_STOCK_SYNCED`.
  GHÉP idempotent theo `MERGE:{nguồn}` (đã chuyển tồn → chỉ hoàn tất lưu trữ). Mục mới **“Số tồn lệch sổ biến động kho”** trong
  Dữ liệu cần kiểm tra phát hiện cả trường hợp sửa tay sheet, nút **ĐỒNG BỘ THEO SỔ** (có lịch sử, chỉ admin).
- **Files:** `apps-script/Vpp.gs` (`applyStockMovements_`, `stockFromLedger_`, `stockLedgerDrifts_`, `healStockFromLedger_`,
  `healDirtyStock_`, `apiVppSyncStock_`, `apiVppMergeProduct_`), `apps-script/Config.gs` (`PROP.VPP_STOCK_DIRTY`),
  `apps-script/Code.gs`, `worker/api/vpp.ts`, `worker/index.ts`, `shared/vpp.ts`, `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-vpp.test.ts` “[REVIEW-3] Sheets lỗi khi ghi SỔ biến động…”, “[REVIEW-3] Sheets lỗi khi cập nhật SỐ TỒN…”,
  “[REVIEW-3] ai đó sửa tay số tồn…”, “[REVIEW-3] GHÉP lỗi sau khi đã chuyển tồn…” (lỗi Sheets được giả lập đúng tại bước ghi).
- **Status:** VERIFIED.

## BUG-25 — GHÉP bỏ qua kiểm tra quy đổi đơn vị tính (REVIEW-4, P1)

- **Before:** hộp thoại GHÉP điền sẵn số tồn nguồn → máy chủ chỉ kiểm tra ĐVT khi **không** có số lượng → “Kim bấm: 11 hộp” ghép vào
  sản phẩm tính theo “Cái” thành 11 cái. Nguồn chưa có ĐVT (“Giấy ướt: 5”) cũng chuyển nguyên số.
- **Fix:** không điền sẵn số lượng; đổi sản phẩm đích thì xóa số đã nhập. ĐVT khác nhau hoặc nguồn chưa có ĐVT → **bắt buộc** nhập
  số đã quy đổi **và** tích xác nhận “đã quy đổi sang ĐVT …” (`unitConverted`); máy chủ kiểm tra lại (gọi API trực tiếp cũng bị chặn).
- **Files:** `apps-script/Vpp.gs` (`apiVppMergeProduct_`, `sameUnit_`), `shared/schemas.ts` (`mergeProductSchema.unitConverted`),
  `src/pages/admin/vpp/VppDataReviewPage.tsx`, `src/services/vppApi.ts`.
- **Test:** `gas-vpp.test.ts` “liệt kê sản phẩm chưa ghép… GHÉP chuyển tồn…” ([REVIEW-4]: thiếu số / thiếu xác nhận đều bị chặn,
  cùng ĐVT để trống vẫn chuyển nguyên số).
- **Status:** VERIFIED.

## BUG-26 — Giới hạn đăng nhập theo tài khoản vẫn tính theo IP (REVIEW-5, P2)

- **Before:** khóa giới hạn là `admin-login-user:<username>:<IP>` → dò mật khẩu một tài khoản từ 30 IP khác nhau không bị chặn lần nào
  (trái với BUG-05).
- **Fix:** `enforceRateLimit(..., { perIp: false })` — khóa chỉ theo username, đếm chung mọi IP (10 lần / phút).
- **Files:** `worker/services/rateLimit.ts`, `worker/api/admin.ts`.
- **Test:** `worker-api.test.ts` “[REVIEW-5] dò mật khẩu MỘT tài khoản từ nhiều IP vẫn bị chặn…”.
- **Status:** VERIFIED. **Đánh đổi:** người cố tình gõ sai liên tục một tài khoản làm chủ tài khoản phải chờ 1 phút để đăng nhập.

## BUG-27 — Ô “Lý do vượt định mức” bị ẩn khi số liệu trên trang đã cũ (REVIEW-6, P2)

- **Before:** ô lý do chỉ hiện khi dữ liệu định mức tải lúc mở form cho thấy vượt; admin khác / tab khác vừa dùng bớt định mức →
  máy chủ trả `NORM_EXCEEDED` nhưng ô vẫn ẩn → không lưu được phiếu; số liệu chỉ tải lại khi thiếu tồn.
- **Fix:** hiện ô khi máy chủ báo lỗi ô đó (hoặc đã có nội dung); tải lại số liệu cả khi `NORM_EXCEEDED`.
- **Files:** `src/components/vpp/VppHandoverForm.tsx`.
- **Test:** typecheck + lint; kịch bản cần 2 phiên admin đồng thời — đã kiểm tra bằng đọc mã (chưa có E2E riêng).
- **Status:** FIXED.

## BUG-28 — Chạy lại “Khởi tạo định mức” tạo trùng (REVIEW-7, P2)

- **Before:** `seedOfficeSupplyNorms` tìm sản phẩm theo tên + ĐVT; sau khi admin sửa theo hướng dẫn (Gream → Ream, đổi tên “Hột
  quẹt”) mà chạy lại → thêm 2 sản phẩm danh mục trùng + 3 định mức; nhân viên KD thấy 15 dòng thay vì 13.
- **Fix:** khóa chống trùng là **phạm vi + STT** của bản định mức (`source_ref`), không phụ thuộc tên / ĐVT.
- **Files:** `apps-script/VppSetup.gs`.
- **Test:** `gas-vpp.test.ts` “[REVIEW-7] khởi tạo định mức chạy lại sau khi admin sửa ĐVT / đổi tên…”.
- **Status:** VERIFIED.

## BUG-29 — Ước tính đề xuất & số liệu Tổng quan kho lệch (REVIEW-8, P3)

- **Before:** “Ước tính” chỉ tính lại lúc duyệt — quyết định sản phẩm (đơn giá mới) và nhận hàng theo giá thực tế không cập nhật;
  “phiếu chờ ký” đếm cả phiếu yêu cầu sửa nhưng link lọc PENDING; “Hết hàng” không đếm sản phẩm chờ duyệt / ngừng dùng nhưng danh sách
  khi bấm vào lại có; “SP danh mục / SP tạm” đếm khác danh sách.
- **Fix:** `proposalEstimateCell_` / `refreshProposalEstimate_` tính lại sau quyết định sản phẩm và khi nhận hàng; Tổng quan kho tách
  “chờ ký” và “người nhận yêu cầu sửa” (mỗi số một link đúng bộ lọc); lọc tình trạng tồn chỉ tính sản phẩm đang dùng (khớp cảnh
  báo); số SP danh mục / tạm khớp danh sách.
- **Files:** `apps-script/VppProposals.gs`, `apps-script/Vpp.gs` (`apiVppDashboard_`, `apiVppListProducts_`), `shared/vpp.ts`,
  `src/pages/admin/vpp/VppOverviewPage.tsx`.
- **Test:** `gas-vpp.test.ts` “duyệt một phần → … nhập kho” ([REVIEW-8] ước tính theo giá thực mua), “[REVIEW-2/8] …ước tính…”,
  “[REVIEW-8] số liệu Tổng quan kho khớp danh sách khi bấm vào”.
- **Status:** VERIFIED.

## BUG-30 — Sheet thiếu cột code mới cần → giá trị bị bỏ âm thầm (REVIEW, P1)

- **Before:** cổng kiểm tra chỉ so `SCHEMA_VERSION`; `updateRowFields_` / `appendObjects_` bỏ qua cột không có trên sheet → sheet đã
  nâng cấp v2 trước khi có cột `confirm_method` sẽ mất cách xác thực khi ký mà không báo lỗi.
- **Fix:** `requireSchemaReady_` kiểm tra thêm **đủ sheet / cột** theo `HEADERS` (nhớ kết quả 10 phút, khóa theo dấu vân tay cấu trúc
  code cần) → thiếu thì báo `NOT_CONFIGURED` “chạy Thiết lập / cập nhật database”; ghi vào cột hệ thống không có trên sheet → lỗi rõ
  ràng thay vì bỏ qua.
- **Files:** `apps-script/VppSetup.gs`, `apps-script/Utils.gs`.
- **Test:** `gas.test.ts` “[REVIEW] đúng SCHEMA_VERSION nhưng sheet thiếu cột…”, “chạy lại nhiều lần … bổ sung cột thiếu”.
- **Status:** VERIFIED.

## BUG-31 — Phiếu VPP đã ký nhưng chưa xuất kho được: không ai biết (mới, P1)

- **Before:** nếu bước xuất kho lỗi khi người nhận ký (ví dụ ai đó sửa tay tồn), lỗi chỉ ghi log Apps Script.
- **Fix:** phiếu vẫn xác nhận (người nhận đã nhận hàng) nhưng ghi lịch sử `STOCK_SYNC_FAILED` (hiện trên trang chi tiết), hiện ở
  “Phiếu văn phòng phẩm lệch kho”, gửi email “Cần đối soát kho” tới `NOTIFY_EMAILS`; không bao giờ trừ kho âm.
- **Files:** `apps-script/Handovers.gs`, `apps-script/Notify.gs`, `src/pages/admin/AdminHandoverDetailPage.tsx`.
- **Test:** `gas-vpp.test.ts` “ký phiếu nhưng chưa xuất kho được (Sheet tồn bị sửa tay)…”.
- **Status:** VERIFIED.

## BUG-32 — 4 lỗi giao diện nhỏ (mới, P3)

- Kiểm kê không cho thấy chênh lệch trước khi lưu → hộp thoại hiện ngay “Chênh lệch: +/−N (hệ thống X → kiểm kê Y)”.
- Chi tiết đề xuất không có tồn kho từng dòng → thêm cột “Tồn kho” và “Khả dụng”.
- “Cần kiểm tra” đếm số vấn đề như số sản phẩm (một sản phẩm 3 vấn đề = 3) → hiện “N sản phẩm · M vấn đề”, chỉ tính sản phẩm còn dùng.
- Khung tải (`<div>`) nằm trong `<span>` / `<p>` → DOM sai chuẩn, React cảnh báo → `Skeleton inline` dùng `<span>`.
- **Files:** `src/components/vpp/StockDialogs.tsx`, `src/pages/admin/vpp/VppProposalDetailPage.tsx`, `apps-script/Vpp.gs`
  (`vppReviewCounts_`), `src/pages/admin/AdminOverviewPage.tsx`, `src/pages/admin/vpp/VppOverviewPage.tsx`, `src/components/ui/States.tsx`.
- **Status:** FIXED (kiểm bằng typecheck, test số đếm trong `gas-vpp.test.ts`, E2E chụp màn hình).

## BUG-33 — `onOpen` / `onEdit` nuốt lỗi (mới, P3)

- **Fix:** các khối `catch` của trigger đơn giản ghi log (`onOpen.no_ui`, `onEdit.invalidate_cache`), thông báo chạy từ trình soạn thảo
  ghi `console.log` thay vì im lặng; trang Cài đặt ghi log lỗi mở Sheet / Drive.
- **Files:** `apps-script/Setup.gs`, `apps-script/Code.gs`.
- **Status:** FIXED.

## BUG-34 — Không có lint; chạy thử cục bộ phụ thuộc workerd (mới, P2)

- **Fix:** `npm run lint` (oxlint — `typescript-eslint` chưa hỗ trợ TypeScript 7), cấu hình `.oxlintrc.json` (ghi rõ lý do từng quy
  tắc tắt), `--deny-warnings`; thêm vào `npm run verify` và CI. Sửa các phát hiện thật (gọi hàm không thuần khi render, regex ký tự
  điều khiển trong test, `startsWith` thay regex…). Thêm `npm run local`: chạy **Worker build thật trên Node** + Apps Script giả lập +
  hộp thư giả lập `/__local/mail` — chạy được trên Windows (không cần workerd), có `--lan` để thử ký trên điện thoại.
- **Files:** `.oxlintrc.json`, `package.json`, `.github/workflows/ci.yml`, `scripts/local/server.mjs` (mới), `scripts/gas-emulator/*`.
- **Test:** `npm run lint` 0 lỗi / 0 cảnh báo; `npm run local` + kịch bản 17 bước (đăng nhập, tạo phiếu, OTP, ký, CSV, huy hiệu,
  dữ liệu cần kiểm tra) PASS trên Windows.
- **Status:** FIXED.

---

# Đợt rà soát 2 (07/10/2026) — “lỗi có thể phát sinh”

Ba nhóm rà soát độc lập (Apps Script, Worker + dữ liệu dùng chung, giao diện) dựng lại từng kịch bản trên Apps Script giả lập /
Worker build thật / Chrome thật trước khi báo; thêm lỗi tìm thấy khi chạy thử trên trình duyệt sau khi sửa (BUG-55, BUG-56).
Kiểm thử mới: `tests/gas-robustness.test.ts` (18 ca), thêm ca trong `gas-notify` / `gas-vpp` / `worker-api` / `worker-unit`, và
kịch bản trình duyệt 9 bước cho các lỗi giao diện (chạy với `npm run local` + Chrome).

## BUG-35 — Mã OTP không gắn với người nhận; gửi lại lỗi làm mất mã (P1)

- **Before:** (1) mã đã gửi tới email người nhận CŨ vẫn ký được sau khi quản trị viên đổi người nhận / đổi email trong NHAN_VIEN;
  (2) bấm “Gửi lại mã” đúng lúc MailApp lỗi → mã đã nằm trong hộp thư bị thay bằng mã chưa gửi được, lần gửi lỗi vẫn bị tính vào
  giới hạn 3 lần / 15 phút và 10 lần / phiếu; (3) người cầm link gửi mã hết số lần → người nhận thật không ký được, quản trị viên
  không có cách mở khóa (cấp link mới không xóa bộ đếm).
- **Root cause:** mã băm chỉ gắn với phiếu; mã mới ghi đè mã cũ và bộ đếm tăng TRƯỚC khi gửi mail; không có chỗ nào xóa trạng thái OTP
  ngoài lúc ký xong.
- **Fix:** băm mã gắn cả email nhận mã (`otpHash_(id, email, code)`) + dấu vân tay email trong trạng thái — email đổi → mã cũ báo
  “Email nhận mã đã thay đổi”, bộ đếm gửi tính lại; giữ **2 mã gần nhất** (gửi lại lỗi không làm mất mã đã nhận); lần gửi lỗi không tính
  vào giới hạn (vẫn phải chờ 60 giây, trả `retryAfterSeconds`); **cấp link mới / sửa / hủy phiếu xóa mã + bộ đếm** (cách mở khóa).
- **Files:** `apps-script/Notify.gs`, `apps-script/Handovers.gs`, `apps-script/Config.gs` (`OTP_KEEP_CODES`).
- **Test:** `gas-notify` “gửi lại mã bị lỗi → mã đã nằm trong hộp thư vẫn ký được”, “mã gắn với email người nhận: đổi email … cấp link
  mới”, “gửi mã lỗi … không tính vào giới hạn”, “chỉ 2 mã gần nhất còn hiệu lực”.
- **Status:** VERIFIED.

## BUG-36 — Giới hạn đề xuất / nhân viên xin cache 24 giờ (P1)

- **Before:** `enforceRateLimit_('vpp-proposal-emp', …, 86400)` — CacheService chỉ giữ tối đa 6 giờ (21 600 giây); trên Apps Script
  thật giá trị lớn hơn có thể bị từ chối → mọi lần gửi đề xuất lỗi. Bộ giả lập âm thầm cắt về 6 giờ nên test không phát hiện. Đề xuất
  bị lỗi dữ liệu (thiếu sản phẩm…) vẫn bị trừ lượt.
- **Fix:** đếm số đề xuất nhân viên đã gửi **hôm nay** từ sheet `VPP_DE_XUAT` (trong khóa, sau khi dữ liệu hợp lệ) — tối đa
  `APP.PROPOSALS_PER_EMPLOYEE_PER_DAY` = 10; `rateLimitHit_` từ chối cửa sổ > 6 giờ (lỗi lập trình); bộ giả lập báo lỗi khi xin thời hạn
  ngoài 1…21 600 giây thay vì cắt bớt.
- **Files:** `apps-script/VppProposals.gs`, `apps-script/Security.gs`, `apps-script/Config.gs`, `scripts/gas-emulator/runtime.mjs`.
- **Test:** `gas-robustness` “giới hạn đề xuất / nhân viên / ngày đếm từ sheet; đề xuất bị lỗi dữ liệu không bị tính”.
- **Status:** VERIFIED.

## BUG-37 — Ghi dở giữa chừng để lại dữ liệu sai (P1)

- **Before:** (1) tạo phiếu ghi dòng `BAN_GIAO` trước nội dung → nội dung lỗi thì có **phiếu rỗng**, gửi lại cùng mã trả phiếu rỗng như
  hợp lệ; (2) `updateRowFields_` ghi từng khối cột theo thứ tự cột → `status = CONFIRMED` có thể đã ghi khi khối chữ ký lỗi;
  `public_token_hash` và `public_token_nonce` ghi ở 2 lần → link mới không khôi phục được; (3) gửi đề xuất ghi dòng đề xuất tổng trước
  các dòng → đề xuất 0 dòng, sản phẩm chờ duyệt mồ côi; (4) “Nạp tồn đầu kỳ” lỗi giữa chừng thì chạy lại chỉ báo “bỏ qua”.
- **Fix:** nội dung ghi trước, dòng phiếu ghi sau; gửi lại gặp phiếu không nội dung → báo `INTEGRITY_ERROR` thay vì trả như hợp lệ.
  `updateRowFields_` ghi **cột chốt sau cùng** (`status` cuối cùng, `public_token_hash` sau nonce). Đề xuất: ID suy ra cố định từ mã thao
  tác (`uuidFrom_`), thứ tự sản phẩm chờ duyệt → dòng → đề xuất tổng; gửi lại ghi tiếp phần còn thiếu. Tồn đầu kỳ: ID sản phẩm cố định
  theo số dòng, chạy lại hoàn tất phần thiếu (sản phẩm / dòng tồn / biến động), không tạo trùng.
- **Files:** `apps-script/Handovers.gs`, `apps-script/Utils.gs` (`updateRowFields_`, `uuidFrom_`), `apps-script/VppProposals.gs`,
  `apps-script/VppSetup.gs`, `apps-script/Vpp.gs` (`createProduct_` nhận ID định trước).
- **Test:** `gas-robustness` “tạo phiếu: ghi dòng phiếu lỗi…”, “ký: lỗi ghi giữa chừng dòng phiếu → trạng thái KHÔNG thành Đã xác nhận”,
  “gửi đề xuất: lỗi ghi giữa chừng…”; `gas-vpp` “seedInitialOfficeSupplyStock lỗi giữa chừng → chạy lại hoàn tất phần còn thiếu”.
- **Status:** VERIFIED.

## BUG-38 — Thao tác đã lưu bị báo lỗi; lỗi `flush` bị nuốt (P2)

- **Before:** ký / yêu cầu sửa / sửa / hủy đã ghi trạng thái nhưng bước ghi lịch sử lỗi → người dùng thấy lỗi, bấm lại gặp “đã xác nhận”;
  hủy phiếu VPP ghi “Đã hủy” trước khi trả giữ chỗ → trả giữ chỗ lỗi thì phiếu đã hủy mà kho vẫn giữ hàng, hủy lại không được;
  `withScriptLock_` nuốt lỗi `SpreadsheetApp.flush()` (dữ liệu có thể chưa lưu nhưng báo thành công); dấu `VPP_STOCK_DIRTY` bị xóa trước
  khi `flush`; trang Cài đặt / “Kiểm tra cấu hình” hỏng hẳn khi đọc CAU_HINH lỗi.
- **Fix:** `afterCommit_` cho bước phụ sau mốc đã lưu — lỗi được ghi log **và** lưu Script Property `POST_COMMIT_ERRORS` (20 lỗi / 7 ngày),
  hiện ở trang Cài đặt (mục cần xử lý) — không im lặng, không biến thao tác đã lưu thành lỗi. Hủy phiếu: trả giữ chỗ TRƯỚC, ghi
  trạng thái sau. `withScriptLock_`: lỗi `flush` sau thao tác thành công → báo lỗi; khi thao tác đã lỗi thì giữ lỗi gốc. `flush` trước
  khi xóa dấu ghi dở. Trang Cài đặt / `checkSetup` báo riêng lỗi đọc CAU_HINH.
- **Files:** `apps-script/Utils.gs`, `apps-script/Handovers.gs`, `apps-script/Vpp.gs`, `apps-script/Code.gs`, `apps-script/Setup.gs`,
  `apps-script/Config.gs` (`PROP.POST_COMMIT_ERRORS`), `scripts/gas-emulator/runtime.mjs` (lỗi giả lập `flush`).
- **Test:** `gas-robustness` “ký xong nhưng ghi lịch sử lỗi → người nhận vẫn thấy đã ký; lỗi hiện ở trang Cài đặt”, “lỗi khi đẩy dữ liệu
  (flush) sau thao tác → báo lỗi”, “hủy phiếu VPP: trả giữ chỗ lỗi → phiếu CHƯA bị hủy”.
- **Status:** VERIFIED.

## BUG-39 — Kho tính theo số trên sheet thay vì sổ biến động (P2)

- **Before:** sổ `VPP_BIEN_DONG_KHO` là nguồn sự thật (BUG-24) nhưng mọi thao tác vẫn tính từ số trên sheet `VPP_TON_KHO`: ai đó sửa tay
  số tồn rồi kiểm kê → chênh lệch tính so với số sửa tay, lần đồng bộ sau “hoàn tác” kiểm kê; số sửa tay có thể làm sổ ra số âm;
  “Đồng bộ theo sổ” có thể đặt tồn < giữ chỗ hoặc xóa về 0 tồn đầu kỳ nhập tay (chưa từng vào sổ); mục “lệch sổ” bỏ sót sản phẩm chưa
  có biến động nào.
- **Fix:** `applyStockMovements_` lấy số tồn theo **sổ**: sheet khác sổ → dùng số theo sổ, ghi lịch sử `VPP_STOCK_SYNCED`; sản phẩm chưa có
  biến động mà sheet có số → ghi số đó vào sổ trước (biến động `INITIAL`, mã `ADOPT:<id>`); sổ không hợp lệ (âm / tồn < giữ chỗ) → chỉ cho
  kiểm kê. Đồng bộ theo sổ: bỏ qua khi sổ không hợp lệ, **từ chối** sản phẩm chưa có biến động (hướng dẫn kiểm kê). Mục lệch sổ thêm
  `ledger.movements` và sản phẩm chưa có biến động; giao diện không hiện nút đồng bộ cho trường hợp đó mà hướng dẫn + nút KIỂM KÊ.
- **Files:** `apps-script/Vpp.gs`, `shared/vpp.ts` (`StockDrift.ledger.movements`), `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-robustness` “kiểm kê sau khi số trên sheet bị sửa tay…”, “tồn đầu kỳ nhập tay … KHÔNG đồng bộ về 0”, “tồn nhập tay rồi
  bàn giao…”; `gas-vpp` “sửa tay số tồn trên sheet không làm hỏng ký phiếu”, “ký phiếu nhưng chưa xuất kho được (sổ biến động bị sửa tay)”.
- **Status:** VERIFIED.

## BUG-40 — GHÉP: sai đích khi làm lại, tồn “từ không khí”, nhận hàng sản phẩm đã ghép (P2)

- **Before:** lần ghép trước lỗi sau khi đã chuyển tồn → làm lại với sản phẩm đích KHÁC vẫn “hoàn tất” và ghi `merged_into` sai đích;
  ghép vào sản phẩm chưa rõ tồn biến nó thành “đã rõ = số chuyển sang”; nguồn đã kiểm (tồn 0) mà nhập số lượng → cộng tồn từ không khí;
  dòng đề xuất đã duyệt có sản phẩm bị ghép đi → không nhận hàng được, thông báo sai (“chưa được duyệt”).
- **Fix:** làm lại phải chọn đúng đích đã nhận tồn (`CONFLICT` kèm tên đích cũ); đích chưa rõ tồn → yêu cầu kiểm kê đích trước; nguồn tồn 0
  thì số chuyển phải là 0; nhận hàng đi theo `merged_into_product_id` tới sản phẩm đích (cùng ĐVT), khác ĐVT → báo rõ cách xử lý; thông
  báo tách riêng: chờ duyệt / ngừng dùng / ghép khác ĐVT.
- **Files:** `apps-script/Vpp.gs` (`apiVppMergeProduct_`, `effectiveStockMap_`), `apps-script/VppProposals.gs` (`receivingProduct_`).
- **Test:** `gas-robustness` “lần ghép trước lỗi giữa chừng → làm lại với sản phẩm đích KHÁC bị từ chối”, “không tạo tồn từ không khí”,
  “nhận hàng cho dòng có sản phẩm đã được GHÉP”.
- **Status:** VERIFIED.

## BUG-41 — GHÉP trong đề xuất đổi ĐVT mà không quy đổi (P2)

- **Before:** nhân viên đề xuất “Ruột bút bi — 2 Hộp”, quản trị viên GHÉP vào “Bút bi (Cây)” → dòng thành “2 Cây”, ước tính và nhập kho
  theo 2 cây (cùng loại lỗi với BUG-25).
- **Fix:** khác ĐVT (hoặc dòng chưa có ĐVT) → bắt buộc `convertedQuantity` + `unitConverted`; số đề xuất (và số đã duyệt nếu duyệt đủ)
  đổi theo số quy đổi; lịch sử ghi “quy đổi 2 Hộp → 20 Cây”. Hộp thoại có ô “Số lượng đã quy đổi sang …” + ô xác nhận.
- **Files:** `apps-script/VppProposals.gs`, `shared/schemas.ts` (`productDecisionSchema`), `src/components/vpp/ProductDecisionDialog.tsx`.
- **Test:** `gas-robustness` “GHÉP sản phẩm mới trong đề xuất sang sản phẩm khác ĐVT → bắt quy đổi”; trình duyệt “[FIX] Đề xuất: GHÉP
  Ruột bút bi (Hộp) vào bút bi (Cây)…”.
- **Status:** VERIFIED.

## BUG-42 — “Kéo” = “Kẹo” trong nhóm có thể trùng và các lỗi nhỏ của module VPP (P2)

- **Fix:** nhóm “có thể trùng” so tên **giữ dấu** (bỏ khác biệt hoa / thường, khoảng trắng, dấu câu); tên gõ không dấu (“Keo”) nằm trong nhóm
  của từng tên có dấu cùng mặt chữ. “Khởi tạo định mức” tìm sản phẩm có sẵn theo tên giữ dấu, bỏ qua sản phẩm chờ duyệt. Định mức kèm
  theo (thêm vào danh mục / quyết định MASTER) lưu trong CÙNG khóa. Sinh mã (BG-, DX-, VPP-) đọc cả cột một lần thay vì từng ô khi đang
  giữ khóa. Danh sách đề xuất gửi cùng giây xếp theo mã (trước đây theo thứ tự dòng → cũ lên trước).
- **Files:** `apps-script/Vpp.gs` (`duplicateProductGroups_`), `apps-script/VppSetup.gs`, `apps-script/VppProposals.gs`,
  `apps-script/Handovers.gs` (`maxSequenceForPrefix_`).
- **Test:** `gas-robustness` “so tên giữ dấu: Kéo và Kẹo không bị báo trùng…”; `gas-vpp` (đề xuất) chạy ổn định.
- **Status:** VERIFIED.

## BUG-43 — Trạng thái email gộp chung hai loại (P2)

- **Before:** một mã OTP gửi được → xóa cảnh báo “email thông báo đang tạm dừng (để dành hạn mức cho OTP)”; trang Cài đặt hiện tick xanh
  “còn 0 lượt hôm nay”.
- **Fix:** `NOTIFY_STATUS` tách `otp` / `notify` (bản cũ được tách khi đọc); trang Tổng quan / Cài đặt hiện riêng từng loại; hạn mức 0 →
  đỏ (không gửi được mã), dưới `MAIL_RESERVE_FOR_OTP` → vàng (email thông báo tạm dừng).
- **Files:** `apps-script/Notify.gs`, `shared/types.ts` (`NotifyStatus`), `shared/constants.ts`, `src/pages/admin/AdminOverviewPage.tsx`,
  `src/pages/admin/AdminSettingsPage.tsx`.
- **Test:** `gas-notify` “hạn mức thấp → tạm dừng thông báo nhưng vẫn gửi mã OTP” (mã gửi được không xóa cảnh báo), “NOTIFY_STATUS bản cũ…”.
- **Status:** VERIFIED.

## BUG-44 — Trang ký công khai lộ email đầy đủ của người nhận (P2)

- **Fix:** `toPublicHandover_` trả email đã che (`t***@example.com`, như khối OTP); trang quản trị vẫn thấy đầy đủ. Mã băm nội dung tính
  phía máy chủ trên email đầy đủ nên không đổi.
- **Files:** `apps-script/Handovers.gs`.
- **Test:** `gas-robustness` “trang công khai chỉ thấy email người nhận đã che…”; `worker-api` OTP.
- **Status:** VERIFIED.

## BUG-45 — Một IP khóa được tài khoản quản trị (P2)

- **Before:** giới hạn theo tài khoản (BUG-26) dùng chung ngưỡng 10 lần / phút với giới hạn theo IP → một IP dò mật khẩu làm đầy ngưỡng
  của tài khoản, quản trị viên thật bị 429 liên tục.
- **Fix:** binding mới `RL_AUTH_ACCOUNT` (30 lần / phút / tên đăng nhập); giới hạn theo IP (10) kiểm tra trước nên một IP không làm đầy được
  ngưỡng tài khoản — dò từ nhiều IP vẫn bị chặn. Trang Cài đặt kiểm tra đủ 4 binding.
- **Files:** `wrangler.jsonc`, `worker/types.ts`, `worker/services/rateLimit.ts`, `worker/api/admin.ts`.
- **Test:** `worker-api` “[REVIEW-5] dò mật khẩu MỘT tài khoản từ nhiều IP vẫn bị chặn”, “MỘT IP dò mật khẩu không khóa được tài khoản…”;
  `wrangler deploy --dry-run` liệt kê `RL_AUTH_ACCOUNT (30 requests/60s)`.
- **Status:** VERIFIED.

## BUG-46 — Xuất CSV: CPU, ngày gõ tay, dấu số lượng (P2)

- **Before:** `Intl.formatToParts` ~3 µs mỗi ô ngày giờ → xuất vài nghìn dòng có thể vượt 10 ms CPU của Workers Free (lỗi 1102); chuỗi không
  phải ISO (“06/10/2026”) bị đọc thành ngày 10/06; số lượng xuất kho / trả giữ chỗ là số dương (trang Lịch sử kho hiện số âm).
- **Fix:** giờ Việt Nam cố định UTC+7 tính trực tiếp (chuỗi `+07:00` lấy thẳng); chỉ đọc ISO có múi giờ, chuỗi khác giữ nguyên;
  `signedMovementQuantity` dùng chung.
- **Files:** `worker/utils/csv.ts`, `worker/api/export.ts`, `shared/vpp.ts`.
- **Test:** `worker-unit` “ngày giờ: chỉ đọc ISO có múi giờ…”, “ngày giờ đủ nhanh cho 5.000 dòng × 3 cột”, “số lượng biến động kho theo
  chiều tác động”. Dấu phân cách: máy văn phòng (vi-VN) dùng dấu phẩy làm dấu phân cách danh sách → Excel mở đúng cột.
- **Status:** VERIFIED.

## BUG-47 — Nhóm lỗi nhỏ Worker / dữ liệu dùng chung (P3)

- **Fix:** `isHttpUrl` dùng đúng quy tắc của Apps Script (không còn link “hợp lệ ở Worker, bị Apps Script từ chối”); 429 từ Apps Script có
  `Retry-After` theo `details.retryAfterSeconds`; giới hạn theo IP gộp IPv6 theo dải /64 (đổi địa chỉ trong dải không né được), cảnh báo
  `STAFF_ACCESS_CODE` ngắn hơn 10 ký tự; tạo sản phẩm có `clientRequestId` (dùng làm `product_id` → gửi lại không tạo trùng); bỏ ký tự vô
  hình viết thẳng trong biểu thức chính quy (dùng `\u…`).
- **Files:** `shared/text.ts`, `shared/schemas.ts`, `worker/services/gas.ts`, `worker/services/rateLimit.ts`, `worker/auth/adminUsers.ts`,
  `apps-script/Vpp.gs`, `apps-script/Utils.gs`, `src/components/vpp/StockDialogs.tsx`.
- **Test:** `worker-unit` (link, khóa IPv6, Retry-After, khóa tên giữ dấu); `worker-api` “IPv6: đổi địa chỉ trong cùng dải /64…”, OTP có
  `Retry-After`; `gas-robustness` “tạo sản phẩm gửi lại cùng mã thao tác…”.
- **Status:** VERIFIED.

## BUG-48 — Không đăng nhập lại được sau khi đăng xuất / hết phiên (P1)

- **Before:** chế độ đăng nhập (`users` / `shared`) không được nhớ khi kiểm tra phiên thành công → đăng xuất / hết phiên hiện form chỉ có ô
  mật khẩu; bấm Đăng nhập nhận lỗi cho ô “Tên đăng nhập” đang ẩn — màn hình đứng yên, không báo gì.
- **Fix:** lưu `session.mode`; mọi phản hồi 401 đọc `details.loginMode`; lỗi cho ô tên đăng nhập đang ẩn → hiện ô kèm lỗi.
- **Files:** `src/layouts/AdminLayout.tsx`, `src/pages/admin/AdminLoginPage.tsx`.
- **Test:** trình duyệt “[FIX] Đăng xuất rồi đăng nhập lại (nhiều tài khoản)…”.
- **Status:** VERIFIED.

## BUG-49 — Trang ký kẹt khi chính sách OTP đổi sau lúc mở trang (P1)

- **Fix:** máy chủ báo `OTP_REQUIRED` khi trang đang ở trạng thái “không cần mã” → trang tải lại, hiện phần mã xác nhận và hướng dẫn; chữ ký
  đã vẽ được giữ. Thông báo máy chủ nói rõ “Bấm Gửi mã xác nhận”.
- **Files:** `src/pages/ConfirmHandoverPage.tsx`, `apps-script/Notify.gs`.
- **Test:** trình duyệt “[FIX] Trang mở lúc chưa cần mã, máy chủ nay đòi mã → hiện phần mã, giữ chữ ký, ký được”.
- **Status:** VERIFIED.

## BUG-50 — Danh sách chọn sản phẩm tô sáng một mục khác giá trị thật (P1)

- **Before:** `<select size=6>` khi giá trị không khớp mục nào (mới mở, hoặc gõ tìm lại làm ẩn mục đang chọn) → trình duyệt tô sáng mục đầu,
  state vẫn giữ giá trị cũ → GHÉP / MAP / định mức vào sản phẩm khác với sản phẩm đang thấy.
- **Fix:** thành phần chung `ProductPicker`: dòng giữ chỗ không chọn được khi chưa chọn, sản phẩm đang chọn luôn được ghim trong danh sách,
  luôn hiện “Đã chọn: tên (ĐVT)”. Dùng cho GHÉP (Rà soát dữ liệu), quyết định sản phẩm trong đề xuất, định mức.
- **Files:** `src/components/vpp/ProductPicker.tsx` (mới), `src/pages/admin/vpp/VppDataReviewPage.tsx`,
  `src/components/vpp/ProductDecisionDialog.tsx`, `src/pages/admin/vpp/VppNormsPage.tsx`.
- **Test:** trình duyệt “Dữ liệu cần kiểm tra: GHÉP Giấy ướt…”, “[FIX] Đề xuất: GHÉP Ruột bút bi…” (kiểm tra dòng “Đã chọn”).
- **Status:** VERIFIED.

## BUG-51 — Chi tiết đề xuất, lỗi trong hộp thoại, huy hiệu (P2)

- **Fix:** lưu “Xử lý sản phẩm mới” không còn xóa SL / đơn giá / ghi chú duyệt đang nhập (chỉ đặt lại dòng có giá trị máy chủ thay đổi);
  quyết định đã được xử lý ở nơi khác → tải lại, đóng hộp thoại khi dòng không còn chờ; lỗi trong hộp thoại xác nhận hiện NGAY trong hộp
  thoại (`role="alert"`), lỗi trạng thái cũ (`INVALID_STATE`, `CONFLICT`…) tự tải lại trang; huy hiệu menu làm mới ngay sau thao tác.
- **Files:** `src/pages/admin/vpp/VppProposalDetailPage.tsx`, `src/components/ui/Dialog.tsx`, `src/layouts/AdminLayout.tsx`,
  `src/layouts/adminContext.ts`, `src/pages/admin/AdminHandoverDetailPage.tsx`, `src/services/api.ts`.
- **Test:** trình duyệt “[FIX] Huy hiệu Danh sách giảm ngay sau khi sửa phiếu…”, “Đề xuất mua: quyết định sản phẩm Kẹo → duyệt…”.
- **Status:** VERIFIED.

## BUG-52 — Trang ký: mất dữ liệu đang nhập và đếm ngược sai (P2)

- **Fix:** hai form (ký / yêu cầu sửa) luôn nằm trong trang, chỉ ẩn form không dùng → chuyển tab không mất chữ ký; tab, ghi chú, lý do sửa,
  mã đã nhập, thời gian chờ gửi lại giữ ở cấp trên → CONFLICT chỉ làm lại chữ ký + ô xác nhận; chỉ báo “bản mới nhất” khi tải lại thành
  công (lỗi → nút Thử lại); gửi mã lỗi cũng đếm ngược theo máy chủ; chờ lâu hiện theo phút; bộ đếm dừng khi hết giờ.
- **Files:** `src/pages/ConfirmHandoverPage.tsx`.
- **Test:** trình duyệt “[FIX] Trang ký: chuyển sang Yêu cầu chỉnh sửa rồi quay lại — chữ ký vẫn còn”; E2E ký có mã OTP (điện thoại /
  desktop).
- **Status:** VERIFIED.

## BUG-53 — Hai quản trị viên cùng sửa một phiếu ghi đè âm thầm (P2)

- **Fix:** trang sửa gửi `expectedContentHash` (mã băm nội dung lúc mở); Apps Script so trong khóa → khác thì `409 CONFLICT`; trang báo
  “Biên bản đã thay đổi ở nơi khác”, nút “Tải bản mới nhất”.
- **Files:** `shared/schemas.ts` (`handoverUpdateMetaSchema`), `worker/api/admin.ts`, `apps-script/Handovers.gs`,
  `src/pages/admin/AdminHandoverEditPage.tsx`, `src/services/adminApi.ts`.
- **Test:** `gas-robustness` “sửa phiếu: bản đang mở đã cũ…”; `worker-api` (409, 422 khi mã băm sai định dạng); trình duyệt “[FIX] Hai
  quản trị viên cùng sửa một phiếu…”.
- **Status:** VERIFIED.

## BUG-54 — Nhóm lỗi giao diện nhỏ (P3)

- **Fix:** menu quản trị trên điện thoại là `<dialog>` thật (focus vào trong, Esc đóng, trả focus về nút Menu); trang đề xuất so trùng tên
  giữ dấu (“Kéo” và “Keo” là hai sản phẩm); lọc “Ngừng dùng” tự lấy cả sản phẩm ngừng dùng; sản phẩm chờ duyệt không còn nút Kiểm kê /
  đổi trạng thái (máy chủ luôn từ chối) — thay bằng liên kết “Xử lý trong đề xuất mua”.
- **Files:** `src/layouts/AdminLayout.tsx`, `src/pages/ProposalPage.tsx`, `src/pages/admin/vpp/VppStockPage.tsx`,
  `src/components/vpp/StockDialogs.tsx`.
- **Test:** trình duyệt “[FIX] Menu quản trị trên điện thoại…”, “[FIX] Đề xuất VPP: Kéo và Keo…”, “[FIX] Tồn kho: lọc Ngừng dùng…”.
- **Status:** VERIFIED.

## BUG-55 — Hộp thoại đặt lại form sau khi đã hiện (P2, phát hiện khi chạy thử trên trình duyệt)

- **Before:** hộp thoại Nhập kho / Kiểm kê / Sửa sản phẩm / GHÉP / định mức / nhận hàng đặt lại form trong `useEffect` — chạy SAU khi hộp
  thoại đã hiện với giá trị lần trước; gõ ngay (hoặc máy chậm) thì giá trị vừa nhập bị ghi đè: kịch bản trình duyệt gõ “10” nhưng máy chủ
  nhận “1” → nhập kho sai số lượng. Hộp thoại còn đặt lại khi trang tải lại cùng đối tượng (đối tượng mới, cùng ID).
- **Fix:** đặt lại bằng `useLayoutEffect` (trước khi hộp thoại hiện) và chỉ khi mở / đổi sang đối tượng khác theo ID.
- **Files:** `src/components/vpp/StockDialogs.tsx`, `src/pages/admin/vpp/VppDataReviewPage.tsx`, `src/pages/admin/vpp/VppNormsPage.tsx`,
  `src/pages/admin/vpp/VppProposalDetailPage.tsx`, `src/components/vpp/ProductDecisionDialog.tsx`.
- **Test:** trình duyệt “Tồn kho: nhập 10 bút, kiểm kê thấy chênh lệch −2…” (nhập lần 2 → tồn 18) PASS.
- **Status:** VERIFIED.

## BUG-56 — Đăng xuất lỗi mạng vẫn báo “Đã đăng xuất” (P2)

- **Before:** `catch {}` bỏ qua lỗi gọi `/api/admin/logout` rồi chuyển về trang đăng nhập — cookie phiên (8 giờ) vẫn còn: máy dùng chung, người
  sau mở lại trang là vào được quản trị.
- **Fix:** lỗi → báo “Chưa đăng xuất được do lỗi kết nối. Vui lòng thử lại.”, giữ nguyên trạng thái.
- **Files:** `src/layouts/AdminLayout.tsx`.
- **Status:** FIXED (kiểm tra mã + đăng xuất thành công trong kịch bản trình duyệt).

## BUG-57 — Máy chủ chạy thử (`npm run local`) (P3)

- **Fix:** mở bằng `127.0.0.1` / địa chỉ IP của máy được coi là cùng nguồn gốc với localhost (Origin trang khác vẫn bị chặn); `--lan` ưu tiên
  card mạng thật dải nội bộ, bỏ card ảo (WSL, Hyper-V…), thêm `--lan-ip`; chỉ nhận đích dạng `/…` (đích tuyệt đối / `//host` → 400, không
  để Worker nhận tên máy do người gửi chọn); phản hồi khi body chưa đọc hết → `Connection: close`; kiểm tra thư mục tĩnh theo
  “thư mục + dấu phân cách”; có Rate Limiting giống binding Cloudflare.
- **Files:** `scripts/local/server.mjs`.
- **Test:** kịch bản `local-runner-checks` 8/8 (127.0.0.1, Origin lạ 403, `//evil` 400, đích tuyệt đối 400, body lớn + request kế tiếp,
  `..%2fclient-old` 403, đủ binding, email 2 kênh) + kịch bản HTTP 17 bước.
- **Status:** VERIFIED.

### Rủi ro còn lại sau đợt rà soát 2

- Thông báo nổi (toast) vẫn nằm dưới lớp phủ hộp thoại — các luồng đã sửa đều hiện lỗi ngay trong hộp thoại nên không còn phụ thuộc toast.
- Yêu cầu chỉnh sửa không cần mã OTP (giữ nguyên quy trình): người cầm link có thể chuyển phiếu sang “Yêu cầu chỉnh sửa” — quản trị viên thấy
  ngay (email + huy hiệu), cấp link mới nếu link bị lộ.
- Giới hạn đăng nhập là đánh đổi: dò mật khẩu một tài khoản từ ≥ 3 IP cùng khu vực Cloudflare vẫn có thể tạm khóa tài khoản đó (tối đa 1
  phút sau khi ngừng). Mật khẩu quản trị dài (≥ 12 ký tự, ngẫu nhiên) là lớp bảo vệ chính.
- Excel trên máy dùng dấu chấm phẩy làm dấu phân cách danh sách sẽ mở CSV vào một cột — dùng Dữ liệu → Từ văn bản/CSV (máy văn phòng
  hiện dùng dấu phẩy).

---

# Đợt rà soát 3 (08/10/2026)

Bốn nhóm rà soát độc lập (Apps Script lõi, module văn phòng phẩm, Worker + dữ liệu dùng chung + cổng Pages, giao diện) — mỗi phát
hiện đều được dựng lại trên Apps Script giả lập / Worker build production / Chrome thật trước khi báo (trừ BUG-73: theo tài liệu
nền tảng). Không lặp lại BUG-01…57. Sau khi sửa: chạy lại các kịch bản dựng lỗi của người rà soát trên code mới, thêm
`tests/gas-review3.test.ts` (41 ca) + ca mới trong `worker-api` / `worker-unit` / `shared` / E2E, và **51 kiểm tra trên Chrome thật**
với `npm run local` (kịch bản v1–v7 ở cuối mục này).

## BUG-58 — Biên bản đã ký sửa được mà vẫn “OK” (P1)

- **Before:** mã toàn vẹn (BUG-04) chỉ phủ nội dung bàn giao. Trên Sheet: xóa ý kiến người nhận (“CHƯA nhận sạc 65W”), đổi ngày lập /
  ngày ký → toàn vẹn vẫn **OK**, PDF tạo lại mất ý kiến, in ngày sai mà vẫn ghi “Mã toàn vẹn nội dung”. Chép 3 cột chữ ký của phiếu B
  sang phiếu A → A “OK”, PDF và trang quản trị hiện chữ ký của người khác. Sửa nội dung rồi **tự tính lại** `content_hash` (thuật toán
  SHA-256 đọc được trong script gắn với Sheet) → “OK”.
- **Fix:** lúc ký lưu thêm `record_hash` = SHA-256 **toàn biên bản** (nội dung, mã / thời điểm lập, thời điểm ký, ý kiến, cách xác
  thực, mã băm + file chữ ký) và **niêm phong** `record_seal` = HMAC(`record_hash`) bằng khóa Worker suy ra từ secret mới
  `RECORD_SEAL_SECRET` — gửi kèm từng request, **không** lưu ở Apps Script / Sheet / Script Properties. Toàn vẹn tính lại từ dữ liệu
  hiện tại: `checks { content, record, seal: OK | MISMATCH | UNVERIFIED | NONE }`; lệch bất kỳ phần nào → MISMATCH: không tạo lại PDF,
  không trả ảnh chữ ký (kiểm tra niêm phong trước khi so mã băm ảnh). Worker không có khóa → “chưa kiểm tra được” (không báo sai); ký
  khi chưa cấu hình → không có niêm phong nhưng vẫn có `record_hash`. Trang chi tiết hiện từng phần; trang Cài đặt báo đã đặt
  `RECORD_SEAL_SECRET` hay chưa; Worker cảnh báo khi thiếu / ngắn hơn 32 ký tự.
- **Files:** `apps-script/Handovers.gs` (`computeRecordHash_`, `recordSeal_`, `sealKeyOf_`, `integrityOf_`, `apiAdminGetSignature_`),
  `apps-script/Pdf.gs`, `apps-script/Config.gs`, `worker/services/seal.ts` (mới), `worker/api/handover.ts`, `worker/api/admin.ts`,
  `worker/auth/adminUsers.ts`, `worker/types.ts`, `shared/types.ts`, `src/pages/admin/AdminHandoverDetailPage.tsx`,
  `src/pages/admin/AdminSettingsPage.tsx`, `scripts/local/server.mjs`, `scripts/e2e/run-e2e.mjs`, `.dev.vars.example`, tài liệu triển khai.
- **Test:** `gas-review3` › *Toàn vẹn biên bản đã ký* (5 ca: sửa ý kiến / ngày ký, tự tính lại mã băm, tráo chữ ký, ký khi chưa có
  khóa); `worker-api` › *niêm phong: Worker gửi khóa…* (khóa không có trong phản hồi, sheet, Script Properties, log); E2E chi tiết phiếu
  (“Niêm phong: khớp.”); trình duyệt v5 (b, d).
- **Status:** VERIFIED. Cần đặt secret `RECORD_SEAL_SECRET` khi deploy — xem “Việc cần làm khi triển khai”.

## BUG-59 — Sửa phiếu không trọn vẹn (P1)

- **Before:** sửa phiếu ghi nội dung mới → đồng bộ kho → ghi dòng phiếu. Lỗi Google ở giữa: nội dung hiện “Laptop A | Laptop A (đã
  sửa serial) | Chuột” (lẫn cũ – mới, cả dòng đã xóa) và người nhận **ký được**; lưu lại từ trang sửa bị `CONFLICT` (BUG-53). Đổi
  người nhận mà lỗi khi ghi dòng phiếu → link của người nhận CŨ vẫn mở và ký nội dung mới (mã OTP gửi tới email của chính họ).
- **Fix:** nội dung theo **phiên bản** — dòng mới ghi với `revision_id` mới (chưa hiện cho ai), `BAN_GIAO.items_revision` chỉ đổi ở
  bước **cuối** (cột chốt, cùng lần ghi xóa dấu `edit_pending`); dấu `edit_pending` (phiên bản, mã nội dung gốc, thời điểm, người nhận
  gốc) ghi trước các cột phiếu → trong lúc chưa hoàn tất người nhận không ký / yêu cầu sửa / gửi mã được (trang ký báo “đang được quản
  trị viên cập nhật”, nút Tải lại); mã link mới (đổi người nhận) ghi trước bước chốt. Lưu lại từ trang sửa nhận ra lần sửa dở (không
  `CONFLICT`), hoàn tất và báo đúng “đã cấp link mới”; hủy phiếu xóa dấu. Dòng cũ đánh dấu `superseded_at` sau khi chốt. Trang chi tiết
  cảnh báo “Lần lưu sửa biên bản lúc … chưa hoàn tất”.
- **Files:** `apps-script/Handovers.gs`, `apps-script/Utils.gs` (`COMMIT_COLUMN_RANK_`), `apps-script/Config.gs` (`items_revision`,
  `edit_pending`, `revision_id`), `apps-script/Vpp.gs` (định mức / đối soát theo phiên bản), `shared/types.ts` (`updating`,
  `editPendingSince`), `src/pages/ConfirmHandoverPage.tsx`, `src/pages/admin/AdminHandoverDetailPage.tsx`.
- **Test:** `gas-review3` › *Sửa phiếu trọn vẹn* (4 ca: lỗi ở cột phiếu, lỗi ở dòng nội dung / dấu, đổi người nhận, hủy phiếu sửa dở);
  trình duyệt v5 (a, c).
- **Status:** VERIFIED.

## BUG-60 — Phiếu VPP “không đủ tồn” nhưng vẫn lưu (P1)

- **Before:** kiểm tra đủ tồn đọc số trên sheet `VPP_TON_KHO`, còn bước giữ chỗ đọc **sổ biến động** (BUG-39). Khi hai số lệch (lần ghi
  kho trước lỗi giữa chừng — dấu ghi dở chưa xử lý; hoặc số bị sửa tay): sửa phiếu lên 8 → API báo `INSUFFICIENT_STOCK` nhưng nội dung
  phiếu **đã đổi** thành 8, người nhận ký được (xác nhận nhưng không xuất kho); tạo phiếu → báo lỗi mà vẫn có phiếu chờ ký không giữ
  chỗ. Lưu trữ được sản phẩm đang giữ chỗ (phiếu đó không sửa được nữa).
- **Fix:** `allocationStockMap_` — tự đồng bộ dấu ghi dở rồi lấy tồn / giữ chỗ **theo sổ** (đúng số bước giữ chỗ dùng), kiểm tra
  **trước** khi ghi bất cứ gì (lệch không xử lý được → `STOCK_INCONSISTENT` sớm); dùng cho tạo / sửa phiếu và chặn lưu trữ sản phẩm
  đang giữ chỗ. Form tạo phiếu (`handover-context`) cũng hiện số theo sổ. Thông báo nêu đúng số yêu cầu.
- **Files:** `apps-script/Vpp.gs` (`allocationStockMap_`, `ledgerStockMap_`, `vppValidateAllocation_`, `apiVppSaveProduct_`),
  `apps-script/Handovers.gs`.
- **Test:** `gas-review3` › *VPP — kiểm tra tồn khi tạo / sửa phiếu dùng đúng số của bước giữ chỗ* (3 ca).
- **Status:** VERIFIED.

## BUG-61 — README §7 thiếu `Notify.gs` → cả hệ thống lỗi (P1)

- **Before:** cài nhiều file đúng 12 file README liệt kê: `setupDatabase` chạy được nhưng mọi request (kể cả `health`) trả `INTERNAL`
  (“apiRequestConfirmOtp_ is not defined”), *Kiểm tra cấu hình* chỉ báo khó hiểu “otpMode_ is not defined”.
- **Fix:** README / GOOGLE_SETUP liệt kê đủ **14 file** (thêm `Notify.gs`, `Export.gs` mới). `doPost` kiểm tra đủ handler trước khi
  định tuyến → `NOT_CONFIGURED` “thiếu code (… is not defined)” cho mọi action; *Kiểm tra cấu hình* đặt mục “Code Apps Script” lên đầu.
- **Files:** `README.md`, `docs/GOOGLE_SETUP.md`, `apps-script/README.md`, `apps-script/Code.gs` (`loadRoutes_`), `apps-script/Setup.gs`.
- **Test:** `gas-review3` › *thiếu Notify.gs (cài nhiều file theo README cũ) → NOT_CONFIGURED nêu rõ thiếu code*.
- **Status:** VERIFIED.

## BUG-62 — Thứ tự file / file bản cũ còn sót (P2)

- **Before:** (1) `VppProposals.gs` dựng mảng từ `PROPOSAL_STATUS` (của `Config.gs`) ngay khi nạp — Apps Script nạp file theo thứ tự
  trong editor, file này đứng trước `Config.gs` thì **mọi** request lỗi; bộ giả lập và bản gộp luôn đặt `Config.gs` trước nên test không
  thấy. (2) Nâng cấp từ v1 nhiều file bằng cách dán bản gộp đè `Code.gs` (đúng như hướng dẫn cũ): các file v1 còn lại nạp sau, ghi đè
  code v2 — `APP.VERSION` = 1.0.0, nâng cấp lỗi, `requireSchemaReady_` cho qua (`0 < undefined` là false), và Apps Script **nhận ký
  không cần mã OTP, không kiểm tra nội dung**.
- **Fix:** hằng số top-level chỉ dùng literal; `CODE_VERSION_` trong `Code.gs` phải bằng `APP.VERSION` của `Config.gs` (kiểm tra đầu
  `doPost` và khi nâng cấp) → “trộn code nhiều phiên bản” → `NOT_CONFIGURED`; `requireSchemaReady_` từ chối khi `SCHEMA_VERSION` không
  phải số; hướng dẫn dán bản gộp nói rõ **xóa mọi file `.gs` khác**.
- **Files:** `apps-script/VppProposals.gs`, `apps-script/Code.gs`, `apps-script/VppSetup.gs`, `README.md`, `docs/GOOGLE_SETUP.md`.
- **Test:** `gas-review3` › *phiên bản code thống nhất*, *còn file .gs cũ (v1) nạp sau bản mới*, *nạp file theo thứ tự bất kỳ* (đảo
  ngược / xen kẽ — khôi phục cách viết cũ thì ca này báo “PROPOSAL_STATUS is not defined”).
- **Status:** VERIFIED.

## BUG-63 — Gửi lại cùng mã thao tác với nội dung đã sửa (P2)

- **Before:** lần gửi đầu đã lưu nhưng trình duyệt không nhận được phản hồi (Worker hết 30 s trong khi Apps Script chờ khóa tới 25 s rồi
  vẫn ghi; điện thoại mất sóng) → người dùng **sửa form** rồi bấm lại cùng `clientRequestId` → máy chủ trả bản cũ như “đã tạo / đã gửi
  (gửi trùng)”: phiếu thiếu nội dung vừa thêm (người nhận ký bản thiếu), đề xuất giữ số 50 thay vì 5, phiếu VPP giữ chỗ 10 thay vì 1.
  Đề xuất lỗi giữa chừng rồi gửi lại nội dung khác → báo “gồm 2 sản phẩm” nhưng lưu 3 dòng cũ. Thêm sản phẩm (phát hiện thêm khi sửa):
  lần đầu đã tạo, sửa giá / ĐVT rồi bấm lại → trả sản phẩm với thông tin cũ như “đã thêm”.
- **Fix:** so **dấu vân tay nội dung** đã chuẩn hóa với bản đã lưu theo mã: khớp → `duplicate` như trước; khác → **409
  `REQUEST_REUSED`** nêu bản đã lưu (mã, thời điểm) + `details.existing`, không ghi. Đề xuất: ID dòng suy ra từ mã + dấu vân tay, dòng ghi
  dở của nội dung cũ được tách khỏi đề xuất. Giao diện: trang tạo phiếu hiện link **Mở phiếu …** (tab mới, giữ form) và nút **Tạo thêm
  phiếu mới với nội dung đang nhập** (mã mới); trang đề xuất báo đề xuất đã gửi, bấm gửi lần nữa = đề xuất mới.
- **Files:** `apps-script/Handovers.gs` (`createRequestFingerprint_`), `apps-script/VppProposals.gs` (`proposalLinesFingerprint_`,
  `detachUnsubmittedProposalItems_`), `apps-script/Vpp.gs` (`sameProductFields_`), `worker/services/gas.ts`,
  `src/pages/admin/AdminHandoverCreatePage.tsx`, `src/components/handover/HandoverForm.tsx`, `src/components/vpp/VppHandoverForm.tsx`
  (`submitErrorActions`), `src/pages/ProposalPage.tsx`.
- **Test:** `gas-review3` › *tạo phiếu…*, *thêm sản phẩm…*, *đề xuất…* (2 ca); `worker-api` › *409 REQUEST_REUSED kèm phiếu đã tạo*;
  E2E › *tạo phiếu mất phản hồi…*; trình duyệt v4 (a, d).
- **Status:** VERIFIED.

## BUG-64 — Nhập kho / kiểm kê / nhận hàng gửi lại khác số; mở lại hộp thoại ghi 2 lần (P2)

- **Before:** nhập kho +10 (đã ghi, mất phản hồi) → người dùng sửa thành 4 bấm lại → “thành công”, tồn vẫn +10, không cảnh báo (kiểm
  kê tương tự); nhận hàng ghi +6 rồi lỗi, sửa thành 5 gửi lại → dòng ghi 5, kho +6. Đóng hộp thoại sau lỗi 504 (bảng vẫn hiện tồn cũ)
  rồi mở lại nhập 10 → mã thao tác mới → **+10 lần hai**.
- **Fix:** máy chủ: mã đã có mà số / lý do khác → `REQUEST_REUSED` nêu số đã ghi; đúng số → `duplicate: true`. Nhận hàng: báo lỗi của
  dòng nêu số đã nhập (không nhập thêm). Giao diện: lần bấm lỗi **chưa rõ kết quả** (mất mạng, 5xx, hết thời gian chờ) giữ mã cho
  sản phẩm đó — mở lại hộp thoại dùng lại mã kèm nhắc; đúng số → “ĐÃ được ghi ở lần gửi trước — không ghi thêm”; trang tải lại số tồn
  ngay khi lỗi; hộp thoại luôn hiện số mới nhất.
- **Files:** `apps-script/Vpp.gs` (`priorOperation_`, `requestReusedStockError_`), `apps-script/VppProposals.gs`,
  `src/services/vppApi.ts` (`ProductWriteResult`), `src/components/vpp/StockDialogs.tsx` (`useOperationKey`),
  `src/pages/admin/vpp/VppStockPage.tsx`, `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-review3` › *nhập kho / kiểm kê: số khác → REQUEST_REUSED*, *nhận hàng: lần trước đã nhập kho 6 rồi lỗi*; E2E › *nhập
  kho mất phản hồi…*; trình duyệt v4 (b, c).
- **Status:** VERIFIED.

## BUG-65 — Số gõ kiểu Việt Nam bị chia 1000 (P1)

- **Before:** trang hiển thị tiền dạng “31.000 ₫” nên người dùng gõ “15.000”, nhưng 21 ô `type="number"` đọc bằng `Number()`: nhập
  kho “1.000” cái / đơn giá “15.000” → lưu 1 cái / 15 ₫; thêm sản phẩm giá “25.000” → “25 ₫”; “1.500.000” → 1,5. Ảnh hưởng nhập kho,
  kiểm kê, duyệt / nhận hàng, GHÉP, định mức, số lượng phiếu. Apps Script đọc số gõ tay trong ô văn bản: “55.600” → 55,6; “1.000” → 1.
- **Fix:** ô số dạng chữ (`NumberInput`, bàn phím số) + `parseViNumber`: dấu chấm / khoảng trắng phân cách nghìn, phẩy thập phân (chỉ ô
  tiền); cách viết hai nghĩa (“1,500”, “15,000”) → báo lỗi ngay, không đoán. Apps Script `parseSheetNumber_` đọc cùng quy tắc; đơn giá
  làm tròn tối đa 2 chữ số lẻ (`roundPrice_`) để hệ thống không bao giờ ghi dạng “12.345”.
- **Files:** `src/utils/number.ts` (mới), `src/components/ui/NumberInput.tsx` (mới), `src/components/vpp/StockDialogs.tsx`,
  `QuantityStepper.tsx`, `ProductDecisionDialog.tsx`, `src/components/handover/ItemFieldInput.tsx`, `formModel.ts`,
  `src/pages/admin/vpp/VppNormsPage.tsx`, `VppProposalDetailPage.tsx`, `VppDataReviewPage.tsx`, `apps-script/Utils.gs`,
  `apps-script/Vpp.gs`, `apps-script/VppProposals.gs`.
- **Test:** `shared` › *Ô số kiểu Việt Nam* (5 ca); `gas-review3` › *số gõ tay kiểu Việt Nam trên Sheet*; E2E › *ô số gõ kiểu Việt
  Nam…*; trình duyệt v1 (6 kiểm tra).
- **Status:** VERIFIED.

## BUG-66 — ĐVT khác dấu coi là một; đổi ĐVT khi thêm vào danh mục không quy đổi (P2)

- **Before:** `sameUnit_` bỏ dấu → GHÉP “5 Cuốn” vào sản phẩm tính theo “Cuộn”, “Bó” → “Bộ” không hỏi quy đổi; quyết định GHÉP “2 Cuốn”
  thành “2 Cuộn”. Quyết định THÊM VÀO DANH MỤC / GIỮ TẠM với ĐVT khác (“Ruột bút bi: 2 **Hộp**” → “Cây”) đổi dòng thành “2 Cây” rồi duyệt /
  nhập kho 2 cây (BUG-41 chỉ sửa GHÉP). Nhân viên gõ đúng tên sản phẩm danh mục nhưng ĐVT khác (“2 Thùng”) → lưu thành “2 Cuộn”, mất ĐVT.
- **Fix:** so ĐVT **giữ dấu** (chỉ bỏ khác biệt hoa / thường, khoảng trắng, dấu câu) ở Apps Script và giao diện (`sameUnit` dùng
  chung); mọi quyết định đổi ĐVT của dòng (GHÉP, thêm vào danh mục, giữ tạm) bắt buộc số đã quy đổi + xác nhận; tên gõ chỉ tự gắn khi
  cùng ĐVT, còn lại thành dòng chờ quyết định giữ ĐVT đã gõ.
- **Files:** `apps-script/Vpp.gs` (`sameUnit_`), `apps-script/VppProposals.gs` (`unitNeedsConversion_`, `requireLineConversion_`),
  `shared/text.ts` (`sameUnit`), `src/components/vpp/ProductDecisionDialog.tsx`, `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-review3` › *THÊM VÀO DANH MỤC với ĐVT khác…*, *nhân viên gõ đúng tên… ĐVT khác*, *GHÉP “Cuốn” vào … “Cuộn”*;
  trình duyệt v5 (e — 6 kiểm tra: “hộp” không hỏi, “Hợp” / “Cây” bắt quy đổi, lưu thành 20 Cây), v6.
- **Status:** VERIFIED.

## BUG-67 — Quyết định sản phẩm / GHÉP lỗi giữa chừng thì kẹt vĩnh viễn (P2)

- **Before:** quyết định ghi sản phẩm trước, dòng đề xuất sau → lỗi ở bước dòng: sản phẩm đã MASTER / ARCHIVED, dòng mãi “chờ quyết
  định”, mọi lần làm lại báo “đã được xử lý trước đó”, không nhận hàng được (MAP mất số quy đổi). GHÉP lỗi giữa hai khối cột → nguồn
  ARCHIVED thiếu `merged_into`, làm lại bị từ chối, không có lịch sử.
- **Fix:** làm lại **đúng** quyết định đã ghi lên sản phẩm thì hoàn tất phần dòng (không đụng sản phẩm); GHÉP kiểm tra “đã chuyển tồn /
  lưu trữ dở” trước khi chặn nguồn đã lưu trữ; `catalog_status` là cột chốt (ghi sau cùng).
- **Files:** `apps-script/VppProposals.gs` (`decisionAlreadyApplied_`), `apps-script/Vpp.gs` (`apiVppMergeProduct_`), `apps-script/Utils.gs`.
- **Test:** `gas-review3` › *quyết định THÊM VÀO DANH MỤC lỗi khi ghi dòng đề xuất → làm lại được*, *GHÉP bị lỗi giữa chừng…*.
- **Status:** VERIFIED.

## BUG-68 — GHÉP làm mất định mức của phòng ban (P2)

- **Before:** GHÉP sản phẩm danh mục có định mức (KD 9 / tháng, VP 8 / tháng) vào bản trùng tên → nhân viên KD không còn thấy sản phẩm,
  phiếu 6 bịch không cần lý do vượt định mức, trang Định mức vẫn cộng hai định mức “đang áp dụng”; hộp thoại không nhắc gì.
- **Fix:** định mức đang bật của nguồn: cùng ĐVT và đích chưa có định mức phạm vi đó → **chuyển sang đích**; khác ĐVT / đích đã có →
  **ngừng áp dụng** kèm ghi chú lý do. Kết quả GHÉP trả `norms { moved, deactivated }`, thông báo nêu rõ; định mức của sản phẩm đã
  ngừng dùng không còn tính “đang áp dụng”.
- **Files:** `apps-script/Vpp.gs` (`transferNormsOnMerge_`, `apiVppListNorms_`), `shared/vpp.ts`, `src/services/vppApi.ts`,
  `src/pages/admin/vpp/VppDataReviewPage.tsx`, `src/pages/admin/vpp/VppNormsPage.tsx`.
- **Test:** `gas-review3` › *GHÉP sản phẩm có định mức: định mức chuyển sang sản phẩm đích…*; trình duyệt v6 (GHÉP khác ĐVT → báo
  định mức ngừng áp dụng, định mức đã tắt).
- **Status:** VERIFIED.

## BUG-69 — Trạng thái đề xuất lệch thực tế (P3)

- **Before:** từ chối sản phẩm duy nhất của đề xuất đã duyệt → vẫn “Đã duyệt” với 0 sản phẩm, vẫn đánh dấu đã mua được; nhận hàng toàn
  số 0 → “Đã nhập kho”; từ chối / đóng đề xuất để lại sản phẩm “chờ duyệt” mồ côi; qua API nhận được hàng cho dòng duyệt 0.
- **Fix:** tính lại trạng thái sau mỗi quyết định sản phẩm (0 sản phẩm được duyệt → `REJECTED`); nhận hàng toàn số 0 bị từ chối (dùng
  Đóng); dòng duyệt 0 không nhận hàng; từ chối / đóng → dòng chờ thành “từ chối sản phẩm”, sản phẩm chờ duyệt được lưu trữ (nếu không
  còn ở đề xuất khác).
- **Files:** `apps-script/VppProposals.gs` (`refreshReviewedStatus_`, `closePendingProducts_`, `apiVppReceiveProposal_`).
- **Test:** `gas-review3` › *đề xuất đã duyệt mà sản phẩm duy nhất bị từ chối…*, *từ chối / đóng đề xuất còn sản phẩm mới…*, *nhận hàng
  toàn số 0…*.
- **Status:** VERIFIED. **Còn lại (cần quyết định nghiệp vụ):** nhận hàng là một lần — giao thiếu rồi giao tiếp đợt sau không nhận được
  theo đề xuất đó; nhận nhiều hơn số duyệt vẫn được phép. Xem “Rủi ro còn lại”.

## BUG-70 — Số tồn gõ tay âm / có phần lẻ (P3)

- **Before:** sản phẩm chưa có biến động, `on_hand` gõ −5 → kiểm kê 3 ghi ADJUSTMENT **+8** (sổ ra 8), sau đó “Đồng bộ theo sổ” đặt tồn 8
  (5 cái không có thật); gõ 2.5 → hiện 0 (HẾT HÀNG), không vào danh sách lệch sổ.
- **Fix:** giá trị gõ tay âm / có phần lẻ / không phải số → **chưa rõ** (giữ nguyên chữ đã gõ để hiện), không nhận vào sổ, kiểm kê tính
  chênh lệch từ 0; hiện ở “Số tồn lệch sổ” kèm giá trị đã gõ.
- **Files:** `apps-script/Vpp.gs` (`stockFromRow_`, `stockLedgerDrifts_`), `shared/vpp.ts` (`invalidValue`), `src/pages/admin/vpp/VppDataReviewPage.tsx`.
- **Test:** `gas-review3` › *số tồn gõ tay âm / có phần lẻ (chưa có biến động) → "chưa rõ"…*.
- **Status:** VERIFIED.

## BUG-71 — Phòng ban “Không áp dụng định mức” vẫn bị báo chưa gắn (P3)

- **Fix:** *Dữ liệu cần kiểm tra* bỏ qua phòng ban gắn `NONE`. **Files:** `apps-script/Employees.gs`, `apps-script/Vpp.gs`.
- **Test:** `gas-review3` › *phòng ban chọn "Không áp dụng định mức" không còn bị liệt kê là "chưa gắn"*. **Status:** VERIFIED.

## BUG-72 — PDF / trang ký ẩn trường đã ký khi cấu hình form đổi (P2)

- **Before:** PDF và trang ký chỉ in các trường đang bật trong `LOAI_BAN_GIAO.form_fields`. Bỏ ô Serial khỏi loại “Thiết bị CNTT” (thao
  tác cấu hình bình thường) → PDF tạo lại / PDF đầu tiên (nếu tác vụ nền lỗi) không còn “SN123456” dù dữ liệu vẫn có và mã toàn vẹn
  vẫn phủ trường đó; người nhận phiếu chờ ký ký một mã băm có trường họ không nhìn thấy.
- **Fix:** in / hiện các trường của loại nội dung **và mọi trường khác có dữ liệu** (nhãn mặc định).
- **Files:** `apps-script/Pdf.gs` (`describeItemForPdf_`), `src/components/handover/HandoverItemsView.tsx`.
- **Test:** `gas-review3` › *bỏ ô Serial khỏi loại THIET_BI_CNTT sau khi ký → PDF vẫn in Serial*. **Status:** VERIFIED.

## BUG-73 — Email tổng hợp / sao lưu tự động chạy trùng (P3)

- **Before:** `ScriptApp.getProjectTriggers()` chỉ thấy trigger của người đang chạy → mỗi người bấm menu cài một trigger riêng → email
  tổng hợp gửi 2 lần / ngày (từ Gmail và hạn mức của người kia), sao lưu 2 bản / tuần; không ai xóa được trigger của người khác.
- **Fix:** đánh dấu dùng chung trong Script Properties (trong khóa): `DAILY_DIGEST_SENT_DAY` — mỗi ngày một email; `LAST_SCHEDULED_BACKUP_AT`
  — mỗi tuần một bản (`scheduledBackup`); lỗi thì xóa dấu để lần sau thử lại.
- **Files:** `apps-script/Notify.gs`, `apps-script/Setup.gs`, `apps-script/Config.gs`, `scripts/gas-emulator/runtime.mjs` (lỗi Drive giả
  lập cho `makeCopy`).
- **Test:** `gas-review3` › *nhiều trigger email tổng hợp…*, *nhiều trigger sao lưu tự động → mỗi tuần chỉ MỘT bản; lần sao lưu lỗi
  không chặn lần sau*. **Status:** VERIFIED (cơ chế nhiều trigger theo người dùng: theo tài liệu Google, không giả lập được hoàn toàn).

## BUG-74 — Xuất CSV vẫn vượt CPU Workers Free (P2)

- **Before:** BUG-46 giảm việc nhưng Worker vẫn phân tích JSON 2–3 MB và dựng CSV: 5.000 dòng ≈ 21,9 ms (trung vị), 27–33 ms lần đầu —
  gấp 2–3 lần giới hạn 10 ms CPU của Workers Free (lỗi 1102, người dùng chỉ thấy “Không tải được tệp”).
- **Fix:** CSV dựng tại Apps Script (`Export.gs`: chống chèn công thức, ngày giờ Việt Nam, CRLF, nhãn khớp giao diện). Action **stream**:
  một dòng phong bì JSON + `\n` + nội dung; Worker (`callGasStream`) chỉ đọc dòng đầu rồi chuyển thẳng nội dung kèm BOM (không giải mã /
  phân tích). Phong bì “ok” mà thiếu nội dung (Apps Script khác phiên bản) → 502, không trả tệp rỗng (phát hiện khi viết test).
  **Đo lại** (Worker build production trên Node, phản hồi giả lập đúng kích thước): 1.000 dòng 1,0 ms trung vị / 4,0 ms lần đầu;
  5.000 dòng (tối đa mỗi lần) **2,2 ms / 4,5 ms**.
- **Files:** `apps-script/Export.gs` (mới), `apps-script/Code.gs`, `worker/services/gas.ts` (`callGasStream`), `worker/api/export.ts`,
  `worker/utils/http.ts`, `worker/utils/csv.ts`, `scripts/build-gas-bundle.mjs`.
- **Test:** `gas-review3` › *Xuất CSV dựng tại Apps Script* (3 ca); `worker-unit` › *callGasStream* (3 ca: cắt đoạn giữa ký tự UTF-8,
  lỗi Apps Script, HTML / thiếu nội dung / dòng đầu quá dài); `worker-api` › *xuất CSV…* (đi qua đường stream thật).
- **Status:** VERIFIED (giới hạn CPU thật của Cloudflare không kiểm được ngoài môi trường Cloudflare — số đo trên Node).

## BUG-75 — IPv6 né giới hạn của Apps Script (P3)

- **Before:** chỉ bộ giới hạn của Worker gộp IPv6 theo /64; mã băm IP gửi Apps Script băm địa chỉ thô → đổi địa chỉ trong một dải /64:
  60/60 lần tra mã NV sai đều được trả lời (thiết kế: 20 / 10 phút), cảnh báo “ký trên cùng thiết bị” bị lỡ khi địa chỉ tạm thời đổi.
- **Fix:** `ipHash` gửi Apps Script băm theo khóa /64. **Files:** `worker/api/common.ts`.
- **Test:** `worker-api` › *IPv6: tạo & ký từ hai địa chỉ cùng dải /64… → cảnh báo; khác dải → không*; `worker-unit` › *rateLimitIpKey*.
  **Status:** VERIFIED.

## BUG-76 — Ký tự vô hình còn lọt (P3)

- **Fix:** loại thêm Arabic Letter Mark U+061C (“SN 12-34” hiện thành “34-12”), soft hyphen, combining grapheme joiner, ký tự đệm Hangul,
  Mongolian vowel separator, Khmer U+17B4/17B5, ký tự tag U+E0000–E007F — ở cả Worker / giao diện và Apps Script.
- **Files:** `shared/text.ts`, `apps-script/Utils.gs`.
- **Test:** `gas-review3` › *bỏ Arabic Letter Mark, soft hyphen, ký tự đệm Hangul, ký tự tag*; `shared` › *bỏ ký tự định hướng chữ…*.
  **Status:** VERIFIED.

## BUG-77 — Hết phiên khi đang điền form → mất nội dung (P2)

- **Before:** phiên quản trị 8 giờ cố định; 401 lúc bấm TẠO PHIẾU → cả trang thay bằng màn hình đăng nhập → đăng nhập lại thì form trống.
  Trang đề xuất: phiên mã truy cập không còn hợp lệ lúc gửi → quay về bước nhập mã NV, mất hết.
- **Fix:** đăng nhập lại trong **hộp thoại** phủ lên trang (trang không bị gỡ), xong thì bấm lại; trang đề xuất dùng hộp thoại nhập mã
  truy cập tương tự.
- **Files:** `src/layouts/AdminLayout.tsx`, `src/pages/admin/AdminLoginPage.tsx` (`AdminLoginForm`), `src/components/StaffGate.tsx`,
  `src/pages/ProposalPage.tsx`.
- **Test:** E2E › *phiên hết hạn lúc bấm TẠO PHIẾU…*; trình duyệt v2 (a, b — 6 kiểm tra). **Status:** VERIFIED.

## BUG-78 — Thông báo bị menu điện thoại che (P2)

- **Before:** 375 px: “Đăng xuất” lỗi mạng / “Làm mới dữ liệu” nằm trong menu dạng hộp thoại; thông báo nổi nằm **dưới** lớp phủ — đọc
  được mỗi chữ “kiểm”, trình đọc màn hình không đọc; nội dung lỗi chung chung không nói phiên vẫn còn.
- **Fix:** vùng thông báo đặt trong hộp thoại đang mở trên cùng (`modalLayer`), không chặn bấm; lỗi đăng xuất: “Chưa đăng xuất được — phiên
  đăng nhập vẫn còn hiệu lực…”.
- **Files:** `src/components/ui/modalLayer.ts` (mới), `src/components/ui/Toast.tsx`, `src/components/ui/Dialog.tsx`, `src/layouts/AdminLayout.tsx`.
- **Test:** trình duyệt v3 (a — 3 kiểm tra: toast nằm trên menu ở mọi điểm, nội dung rõ). Đây cũng là rủi ro “toast dưới lớp phủ” còn
  lại của đợt 2. **Status:** VERIFIED (kịch bản trình duyệt).

## BUG-79 — Chuyển trang trong ứng dụng bỏ form không hỏi (P3)

- **Fix:** chuyển sang data router (`createBrowserRouter`) và chặn chuyển trang (`useBlocker`) khi form có thay đổi chưa lưu — Back, link
  menu đều hỏi “Rời trang này? Nội dung đang nhập chưa được lưu sẽ bị mất.”.
- **Files:** `src/App.tsx`, `src/components/ErrorBoundary.tsx`, `src/hooks/usePageMeta.ts`.
- **Test:** E2E › *đang nhập form rồi bấm Back / link khác…*; trình duyệt v2 (c — 4 kiểm tra). **Status:** VERIFIED.

## BUG-80 — Số trang vượt quá (P3)

- **Fix:** trang danh sách phiếu / đề xuất tự chuyển về trang cuối có dữ liệu. **Files:** `src/pages/admin/AdminHandoverListPage.tsx`,
  `src/pages/admin/vpp/VppProposalsPage.tsx`. **Test:** trình duyệt v3 (b — 2 kiểm tra). **Status:** VERIFIED (kịch bản trình duyệt).

## BUG-81 — Lỗi giao diện nhỏ (P3)

- Form phiếu VPP: tải định mức / tồn của người nhận **mới** lỗi → báo rõ, không hiện phạm vi định mức của người nhận trước (trình duyệt v3c).
- Hộp thoại “Nhận hàng & nhập kho” gặp lỗi dữ liệu đã đổi → tải lại chi tiết đề xuất như các hộp thoại khác (trình duyệt v7).
- Ô số lượng `[-] n [+]` sau BUG-65 mất vai trò `spinbutton` và phím ↑ / ↓ (phát hiện khi chạy E2E) → khôi phục vai trò, `aria-valuenow /
  min / max`, phím mũi tên (E2E › *tạo phiếu VPP…*).
- **Files:** `src/components/vpp/VppHandoverForm.tsx`, `src/pages/admin/vpp/VppProposalDetailPage.tsx`, `src/components/vpp/QuantityStepper.tsx`.
- **Status:** VERIFIED.

## BUG-82 — Tài liệu / CI lệch thực tế (P3)

- `docs/API.md`: kiểu `notify` của Tổng quan (tách email thông báo / email mã OTP), thiếu mã thao tác là **422** (không phải 400), bổ
  sung `REQUEST_REUSED`, `updating`, `integrity.checks`, giao thức stream. CI kiểm Node 22 trong khi `.node-version` / Cloudflare build
  dùng 24 → job kiểm tra chạy cả 24 và 22 (bản thấp nhất trong `engines`), E2E đọc `.node-version`.
- **Files:** `docs/API.md`, `.github/workflows/ci.yml`. **Status:** FIXED (`.github/` chưa commit nên CI chưa từng chạy).

### Kiểm chứng trên Chrome thật (`npm run local`, 08/10/2026)

| Kịch bản | Nội dung | Kết quả |
|---|---|---|
| v1 | Nhập kho “1.000” / đơn giá “15.000” → gửi 1000 / 15000, tồn +1000; “1,5” báo lỗi không gửi; thêm sản phẩm “25.000” → 25.000 ₫, mở lại sửa hiện 25000 | 6/6 |
| v2 | Hết phiên lúc TẠO PHIẾU → hộp thoại đăng nhập, form còn, tạo được; phiên nhân viên hết lúc GỬI ĐỀ XUẤT → nhập lại mã, đề xuất còn, gửi được; Back / link menu khi đang nhập → hỏi, Hủy ở lại, Đồng ý rời trang | 10/10 |
| v3 | Menu điện thoại: toast đăng xuất lỗi / làm mới nằm trên menu, nội dung rõ; `?page=99` → trang cuối; form VPP tải người nhận mới lỗi → báo rõ, không hiện phạm vi cũ | 7/7 |
| v4 | Mất phản hồi sau khi đã lưu: tạo phiếu (REQUEST_REUSED + link + tạo thêm phiếu mới), nhập kho (bảng tải lại, nhắc, không ghi 2 lần), kiểm kê số khác (báo số đã ghi), đề xuất trên điện thoại (báo đã gửi, gửi lại = đề xuất mới) | 11/11 |
| v5 | Trang ký “đang cập nhật” (không có nút ký, Tải lại); chi tiết phiếu đã ký: nội dung / toàn biên bản / niêm phong khớp (dữ liệu thật); cảnh báo sửa dở; Cài đặt báo niêm phong; quyết định sản phẩm “Hộp” → “hộp” không hỏi, “Hợp” / “Cây” bắt quy đổi, lưu 20 Cây | 12/12 |
| v6 | GHÉP “Cuốn” → “Cuộn” bắt quy đổi; sau GHÉP báo định mức ngừng áp dụng, định mức đã tắt | 4/4 |
| v7 | “Nhận hàng” gặp 409 → hiện lỗi + tải lại chi tiết đề xuất | 1/1 |

Log máy chủ chạy thử: không có phản hồi 5xx; các 401 / 409 đều là ca cố ý (hết phiên, gửi lại cùng mã).

### Việc cần làm khi triển khai (đợt 3)

Production hiện vẫn chạy **v1** (v2 chưa commit / deploy) → triển khai theo **README §19 “Nâng cấp từ v1 lên v2”**; thay đổi của đợt 3
đã nằm trong các bước đó:

- Bước 1 — **sao lưu** Google Sheet trước khi làm gì khác.
- Bước 2 — dán bản gộp **một file** và **xóa mọi file `.gs` khác** (file v1 còn sót → Apps Script từ chối mọi thao tác, BUG-62); dòng
  đầu *Kiểm tra cấu hình* phải là “✓ Code Apps Script đầy đủ, một phiên bản”. Cài nhiều file thì đủ **14 file** (có `Export.gs`).
- Bước 4 — *Nâng cấp module Văn phòng phẩm (v2)* thêm cả các cột mới của đợt 3: `items_revision`, `edit_pending`, `record_hash`,
  `record_seal` (`BAN_GIAO`), `revision_id` (`CHI_TIET_BAN_GIAO`) — chỉ thêm cột, tự sao lưu trước, không đổi dữ liệu cũ (phiếu cũ:
  `items_revision` trống = mọi dòng chưa `superseded_at`). Chưa chạy bước này thì mọi thao tác ghi báo `NOT_CONFIGURED` (kèm tên cột).
- Bước 6 — đặt secret mới **`RECORD_SEAL_SECRET`** (≥ 32 ký tự ngẫu nhiên, **không đổi** về sau) trước khi deploy Worker; phiếu ký
  trước thời điểm này không có niêm phong (biên bản v1 hiện LEGACY như trước).
- Bước 7 — trang *Cài đặt*: mọi mục đạt, gồm “Biên bản ký được niêm phong (RECORD_SEAL_SECRET)”. Nên thử **Xuất CSV** tồn kho / lịch
  sử kho một lần để xác nhận chạy trong giới hạn CPU thật của Cloudflare.
- Thứ tự Apps Script trước, Worker sau (Worker mới gọi `adminExportCsv` — Apps Script cũ chưa có sẽ báo `UPSTREAM_OUTDATED`).

### Rủi ro còn lại sau đợt rà soát 3

- **Giao hàng nhiều đợt (cần quyết định nghiệp vụ):** “Nhận hàng” là một lần cho cả đề xuất — giao thiếu (nhận 6/10) thì 4 cái còn lại
  phải nhập kho thủ công hoặc tạo đề xuất mới; nhận **nhiều hơn** số duyệt vẫn được phép (nhà cung cấp giao dư). Chưa đổi vì là quy
  trình nghiệp vụ.
- `RECORD_SEAL_SECRET` là một khóa duy nhất: lộ khóa thì người sửa được Sheet có thể niêm phong lại dữ liệu đã sửa; đổi khóa thì mọi niêm
  phong cũ báo MISMATCH (chưa hỗ trợ nhiều khóa). Lưu như các secret khác, không chia sẻ.
- Đơn giá được làm tròn tối đa 2 chữ số lẻ khi lưu (tiền VND thực tế không có phần lẻ).
- Chưa kiểm được trên Google thật (cần tài khoản): thư mục gốc `DTA_HANDOVER` bị đưa vào thùng rác vẫn báo Drive OK; nhập CSV nhân viên
  với “chuyển văn bản thành số” có thể mất số 0 đầu mã NV; mã NV trùng chỉ dùng dòng đầu (không cảnh báo).
- Số đo CPU xuất CSV là trên Node; giới hạn CPU thật chỉ kiểm được sau khi deploy (khuyến nghị thử xuất 5.000 dòng một lần).

---

## Kiểm thử hồi quy (regression)

| Hạng mục | Kiểm thử |
|---|---|
| Admin login / logout / session | `worker-api` “admin: đăng nhập sai/đúng … đăng xuất”, “ADMIN_USERS …”; E2E đăng nhập, đăng xuất, cookie HttpOnly |
| Employees | `gas` “danh sách nhân viên ACTIVE…”, “cache nhân viên…”; E2E chọn nhân viên tìm không dấu |
| Old handover (dữ liệu v1) | `gas` “[HỒI QUY] phiếu tạo từ v1 (trước nâng cấp): vẫn mở link, ký, tạo PDF; phiếu v1 đã ký → LEGACY” |
| New / device handover | `gas` “tạo biên bản 1 / nhiều nội dung”; E2E tạo phiếu “Khác” nhiều nội dung, phiếu tài sản |
| Confirmation / Signature | `gas` “xác nhận lưu chữ ký…”; `gas-notify` mã OTP (7 ca); E2E ký cảm ứng 375px + mã OTP, ký chuột desktop + nhập sai mã, chặn ký lần 2 |
| Revision / Cancel | `gas` “revision → sửa…”, “hủy biên bản…”; E2E yêu cầu sửa → admin sửa → chờ xác nhận |
| PDF / Drive | `gas` “sinh PDF vào Drive…”, “Drive lỗi khi lưu chữ ký…”; E2E tải PDF (người nhận, admin) |
| History | `gas` “chi tiết admin: đầy đủ lịch sử…”; E2E lịch sử “Người nhận xác nhận” |
| Deep routes | E2E 16 route SPA refresh trực tiếp; preview 19 route; `npm run local` SPA fallback |
| Email / thông báo / xuất dữ liệu | `gas-notify` (16 ca), `worker-api` OTP / huy hiệu / CSV (3 ca), `worker-unit` CSV + `callGasStream` (5 ca), `gas-review3` CSV (3 ca) |
| Ghi dở / thao tác lặp / dữ liệu sửa tay (rà soát 2) | `gas-robustness` (18 ca) |
| Toàn vẹn, sửa phiếu, gửi lại cùng mã, số kiểu Việt Nam, cài đặt Apps Script (rà soát 3) | `gas-review3` (41 ca), `worker-api` “[RÀ SOÁT 3]” (3 ca), `worker-unit` `callGasStream` (3 ca), `shared` số kiểu Việt Nam (5 ca), E2E “[RÀ SOÁT 3]” (5 ca), Chrome thật 51 kiểm tra |
| Worker API / Apps Script | `worker-api` (23 ca), `gas` (41 ca), `worker-unit` (27 ca), `shared` (19 ca), bản gộp 1 file |

## Kiểm thử văn phòng phẩm & phân quyền

Định mức, tồn đầu kỳ, ghép, sản phẩm chưa ghép, tạo phiếu VPP, giữ chỗ, 2 phiếu chờ, chống bán vượt tồn, hủy trả giữ chỗ,
yêu cầu sửa giữ chỗ, sửa tính lại giữ chỗ, ký xuất kho, ký 2 lần an toàn, cảnh báo sản phẩm cuối, dashboard hết hàng, nhập kho
→ hết cảnh báo, đề xuất trong / vượt / ngoài định mức, thêm sản phẩm tạm vào danh mục, từ chối, duyệt một phần, nhận hàng,
nhập kho thủ công, kiểm kê, lỗi Sheets giữa chừng, lệch sổ biến động, các lỗi REVIEW-1…8: `tests/gas-vpp.test.ts` (33 ca) +
`tests/gas-robustness.test.ts` (kho theo sổ, GHÉP, đề xuất — 11 ca) + `worker-api` “Worker API — văn phòng phẩm” (3 ca) + E2E (6 ca).
Phân quyền (public không tạo phiếu / không chỉnh kho / không duyệt / không xem kho admin; admin làm được; link xác nhận vẫn
chạy): `worker-api` “[QUYỀN] …”, `gas` “chỉ admin…”, `gas-vpp` “scope public…”, E2E “[QUYỀN] …”.

## Kết quả lần chạy cuối (08/10/2026, sau đợt rà soát 3)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | PASS (0 lỗi) |
| `npm run lint` | PASS — oxlint 0 lỗi, 0 cảnh báo (`--deny-warnings`) |
| `npm test` | PASS — 218/218 (8 tệp: `gas` 41 · `gas-notify` 16 · `gas-vpp` 33 · `gas-robustness` 18 · `gas-review3` 41 · `worker-api` 23 · `worker-unit` 27 · `shared` 19) |
| `npm run build` | PASS — `dist/client` + `dist/dta_bangiao` (+ source map Worker) |
| `npm run gas:bundle` | PASS — `dist/apps-script/DTA_Handover.gs` (418,0 KB, 8 656 dòng; gồm `Export.gs`) |
| `npx wrangler deploy --dry-run` | PASS — bindings RL_PUBLIC / RL_WRITE / RL_AUTH / RL_AUTH_ACCOUNT / ASSETS / APP_BASE_URL; tải lên 266,45 KiB (gzip 64,39 KiB) — **không deploy** |
| E2E (Worker build trên workerd Linux/WSL + Chrome Windows) | PASS — 30/30 (25 ca cũ + 5 ca rà soát 3; Worker chạy có `RECORD_SEAL_SECRET`) |
| Chạy thử trên Chrome thật với `npm run local` | PASS — 51/51 kiểm tra đợt 3 (v1–v7, desktop 1366–1440 px + điện thoại 375–390 px); không có phản hồi 5xx, 401 / 409 đều là ca cố ý |
| Đo CPU xuất CSV (Worker build trên Node) | 5.000 dòng: 2,2 ms trung vị / 4,5 ms lần đầu (trước: 21,9 / 27–33 ms) |
| Production preview (`vite preview`, workerd) | PASS (đợt 2) — route SPA trả `index.html` (200); `/api/health` JSON 200; `/api/khong-co` JSON 404 |
