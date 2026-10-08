# Kiểm thử — DTA Handover v2

## 0. Tự chạy thử trên máy (không cần Cloudflare / Google)

```bash
npm ci            # lần đầu
npm run local     # build rồi mở http://localhost:8787 — Ctrl+C để dừng
```

Màn hình dòng lệnh in ra: địa chỉ trang, **2 tài khoản quản trị** (`admin`, `kho` — mật khẩu ngẫu nhiên mỗi lần chạy; đặt biến
môi trường `LOCAL_ADMIN_PASSWORD` để cố định), **mã truy cập nội bộ** của trang đề xuất VPP, danh sách nhân viên mẫu.

- Dữ liệu nằm trong bộ nhớ (Apps Script giả lập: Sheet / Drive / email) — **mất khi tắt**, không đụng Google Sheet thật.
- **Hộp thư giả lập:** `http://localhost:8787/__local/mail` — mã OTP khi người nhận ký và email thông báo hiện ở đây (tự làm mới
  5 giây); không gửi email thật. `NOTIFY_EMAILS` mặc định `quan-tri@example.com` để thấy email thông báo.
- **Thử ký trên điện thoại:** `npm run local -- --lan` → mở địa chỉ `http://<IP máy>:8787` in ra màn hình từ điện thoại cùng Wi-Fi
  (Windows có thể hỏi cho phép Node.js qua tường lửa). Link xác nhận khi tạo phiếu dùng địa chỉ này.
- Tùy chọn: `--port 8800`, `--no-build` (dùng bản build có sẵn), `--otp REQUIRED|OFF` (chế độ mã xác nhận), `--notify "a@x.com"`
  (hoặc `none`), `--no-vpp` (không nạp định mức / tồn đầu kỳ), `--no-staff-code` (tắt mã truy cập nội bộ).

Kịch bản gợi ý: đăng nhập `admin` → tạo phiếu cho *Phạm Danh Thái* → mở link (tab ẩn danh hoặc điện thoại) → *Gửi mã xác nhận* →
lấy mã ở hộp thư giả lập → ký → admin xem *Xác thực khi ký* trên trang chi tiết; người nhận *Yêu cầu chỉnh sửa* → huy hiệu đỏ trên
menu + email thông báo; *Văn phòng phẩm*: nhập kho, phiếu VPP, đề xuất mua (`/de-xuat-vpp`, mã nhân viên `DEMO-103`), *Dữ liệu cần
kiểm tra*; nút **Xuất CSV** trên các trang danh sách.

## 1. Các lớp kiểm thử

| Lớp | Lệnh | Chạy gì | Cần gì |
|---|---|---|---|
| Typecheck | `npm run typecheck` | TypeScript strict cho SPA, Worker, shared, test | — |
| Lint | `npm run lint` | oxlint (`.oxlintrc.json`): lỗi đúng/sai + nghi vấn, React hooks, Vitest; `--deny-warnings` | — |
| Unit + integration | `npm test` (218 ca, 8 tệp) | Vitest trên Node: validation, crypto, session, router, chữ ký PNG, số kiểu Việt Nam, CSV (stream); **toàn bộ Worker** (`worker/index.ts`) gọi Apps Script giả lập qua HTTP; **nghiệp vụ Apps Script** (chính các file `.gs`: phiếu, mã OTP, email, kho văn phòng phẩm, niêm phong, sửa phiếu theo phiên bản, ghi dở giữa chừng) trong bộ giả lập | — |
| End-to-end | `npm run test:e2e` (30 ca) | Build production → `wrangler dev` (workerd — runtime Cloudflare thật) + Apps Script giả lập (đã nạp định mức + tồn đầu kỳ, bật mã truy cập nội bộ) → Chrome/Edge thật (playwright-core); mã OTP đọc từ hộp thư giả lập | Chrome hoặc Edge (hoặc `E2E_BROWSER_PATH`); workerd chạy được (xem §3) |
| Chạy thử cục bộ | `npm run local` | Worker build thật trên **Node** (không cần workerd) + Apps Script giả lập + hộp thư giả lập — để người dùng tự bấm thử (§0) | Node ≥ 22 |
| CI | `.github/workflows/ci.yml` | typecheck → lint → test → build → `wrangler deploy --dry-run` → bản gộp Apps Script; job E2E trên Chrome của runner | GitHub Actions (không cần secret) |
| Nghiệm thu | thủ công | Trên Google + Cloudflare thật (mục 5) | Tài khoản Google, Cloudflare |

`npm run verify` = typecheck + lint + test (chạy trước mọi lần deploy).

### Bộ giả lập Apps Script (`scripts/gas-emulator/`)

- Nạp **nguyên văn** các file `apps-script/*.gs` vào VM với SpreadsheetApp (kể cả `RangeList`, bảo vệ sheet), DriveApp,
  CacheService, LockService, PropertiesService, Utilities, HtmlService, ContentService, **MailApp** (không gửi thật — thư lưu trong
  `runtime.mail`, xem qua `GET /__emulator/mail`; có hạn mức và lỗi giả lập) giả lập; mỗi request là một “execution” mới.
- Mô phỏng hành vi dễ gây lỗi của Google Sheets: ô không định dạng văn bản tự đổi `0519`→số, `2026-10-15`→ngày; chuỗi bắt đầu
  `=` thành công thức; ghi ngoài số dòng/cột → lỗi; CacheService giới hạn 100KB/giá trị; Web App trả `302` sang trang echo.
- Có thể chèn lỗi Sheet/Drive/HTML để kiểm tra xử lý sự cố. `--vpp`: nạp sẵn định mức + tồn đầu kỳ.
- **Chỉ dùng cho phát triển và kiểm thử.** Không mô phỏng: hiển thị thực của PDF, quyền/chia sẻ Drive thật, quota, độ trễ
  thật của Google → kiểm tra ở bước nghiệm thu.

## 2. Ánh xạ ca kiểm thử bắt buộc

### Hồi quy hệ thống cũ

| Ca kiểm thử | Tự động hóa tại |
|---|---|
| Admin login / logout / session | `worker-api` › *admin: đăng nhập sai/đúng … đăng xuất*, *tài khoản quản trị riêng (ADMIN_USERS)*; `e2e` › *đăng nhập sai / đúng → Tổng quan*, *đăng xuất* |
| Employees | `gas` › *danh sách nhân viên ACTIVE*, *cache nhân viên*; `e2e` (tìm “Pham Danh Thai”, “do thi huong”, “DEMO-103”) |
| Old handover (dữ liệu v1) | `gas` › *[HỒI QUY] phiếu tạo từ v1 (trước nâng cấp)* |
| New / device handover | `gas` › *tạo biên bản 1 / nhiều nội dung*; `e2e` › *tạo phiếu “Khác” nhiều nội dung… tạo thêm 2 phiếu tài sản* |
| Confirmation / Signature | `gas` › *xác nhận lưu chữ ký…*, *[BUG-01]*; `e2e` › *ký cảm ứng 375px* (có mã OTP), *ký chuột desktop* (nhập sai rồi đúng mã) |
| Mã OTP khi ký | `gas-notify` › *EMAIL (mặc định)…*, *nhập sai 5 lần…*, *gửi mã: tối đa…*, *người nhận chưa có email…*, *REQUIRED…*, *OFF…*, *gửi mã lỗi → MAIL_ERROR…*; `worker-api` › *OTP: phải có mã…* |
| Email thông báo · huy hiệu · xuất CSV | `gas-notify` › *Email thông báo cho quản trị viên* (4 ca), *adminBadges*, *exportAll*; `gas-vpp` (email đề xuất / cần đối soát kho); `worker-api` › *huy hiệu menu*, *xuất CSV…*; `worker-unit` › *CSV xuất dữ liệu*, *callGasStream* (3 ca); `gas-review3` › *Xuất CSV dựng tại Apps Script* (3 ca) |
| Revision / Cancel | `gas` › *revision → sửa…*, *hủy biên bản*; `e2e` › *yêu cầu chỉnh sửa…*, *sửa phiếu “Yêu cầu chỉnh sửa” → “Chờ xác nhận”* |
| PDF / Drive | `gas` › *sinh PDF…*, *[BUG-04]*, *Drive lỗi khi lưu chữ ký*; `e2e` (tải PDF người nhận & admin) |
| History | `gas` › *chi tiết admin: đầy đủ lịch sử*; `e2e` (lịch sử “Người nhận xác nhận”, “bởi Quản trị viên”) |
| Deep routes | `e2e` › *mọi route SPA refresh trực tiếp không 404* (16 route); preview (§4) |
| Worker API / Apps Script | `worker-api` (23), `gas` (41), `gas-notify` (16), `gas-vpp` (33), `gas-robustness` (18), `gas-review3` (41), `worker-unit` (27), `shared` (19), bản gộp 1 file (`gas` › *bản gộp 1 file*) |
| Lỗi rà soát 3 (BUG-58…82) | `gas-review3` (41 ca: niêm phong, sửa phiếu theo phiên bản, `REQUEST_REUSED`, trường đã ký trong PDF, kiểm tra tồn theo sổ, quyết định / GHÉP lỗi giữa chừng, ĐVT giữ dấu, định mức khi GHÉP, trạng thái đề xuất, số gõ tay, CSV, thiếu file / trộn phiên bản / thứ tự file, ký tự vô hình, email tổng hợp / sao lưu trùng); `worker-api` › *[RÀ SOÁT 3]* (3 ca); `worker-unit` › *callGasStream* (3 ca); `shared` › *Ô số kiểu Việt Nam* (5 ca); `e2e` › *[RÀ SOÁT 3] Giao diện* (5 ca: số kiểu Việt Nam, nhập kho mất phản hồi, tạo phiếu mất phản hồi, hết phiên lúc tạo phiếu, rời trang khi đang nhập); kịch bản trình duyệt (Chrome + `npm run local`, 51 kiểm tra — xem `BUG_FIX_REPORT.md`) |

### Văn phòng phẩm

| Ca kiểm thử | Tự động hóa tại |
|---|---|
| Load norms · Seed initial stock | `gas-vpp` › *seedOfficeSupplyNorms…*, *seedInitialOfficeSupplyStock: giữ giá trị thô…* |
| Mapping · Unmapped item | `gas-vpp` › *liệt kê sản phẩm chưa ghép kèm gợi ý; GHÉP; TẠO SẢN PHẨM MỚI; BỎ QUA* (gồm [BUG-20]); `e2e` › *dữ liệu cần kiểm tra* |
| Create VPP handover · Reserve stock · Two pending handovers · Prevent overselling | `gas-vpp` › *tạo phiếu → giữ chỗ…; 2 phiếu chờ; không bán vượt tồn*; `e2e` › *tạo phiếu VPP…* (khả dụng / thiếu / TẠO ĐỀ XUẤT MUA) |
| Cancel releases stock | `gas-vpp` › *hủy phiếu → trả giữ chỗ (RELEASE)* |
| Revision keeps reservation · Edit revision recalculates · Confirm exports · Double confirm safe | `gas-vpp` › *yêu cầu chỉnh sửa giữ nguyên giữ chỗ; admin sửa…; ký → xuất kho; ký lại an toàn*; `e2e` › *ký phiếu văn phòng phẩm → xuất kho* |
| Last item warning · Out-of-stock dashboard · Receive stock · Warning disappears | `gas-vpp` › *cảnh báo sản phẩm cuối (LAST_ITEM), dashboard hết hàng, nhập kho → hết cảnh báo* |
| Proposal in / above / outside norm | `gas-vpp` › *trong định mức / vượt định mức (bắt lý do) / ngoài định mức*; `e2e` › *nhân viên (điện thoại 375px)…* |
| Approve TEMP product · Reject · Partial approval · Receive proposal | `gas-vpp` › *duyệt một phần → đã mua → nhập kho → đóng*, *từ chối đề xuất…*; `worker-api` › *đề xuất mua công khai → admin duyệt → nhập kho*; `e2e` › *quản trị: thêm sản phẩm mới vào danh mục → duyệt → đã mua → nhận hàng* |
| Manual stock-in · Inventory adjustment | `gas-vpp` › *nhập kho (IN) idempotent…*, *kiểm kê: ghi ADJUSTMENT…*; `e2e` › *nhập kho thủ công qua giao diện* |
| Định mức, gắn phòng ban, giới hạn NAT | `gas-vpp` › *định mức tháng…*, *gắn phòng ban → phạm vi…*, *[BUG-13]…* |
| Lỗi rà soát độc lập (REVIEW-1…8) | `gas-vpp` › *VPP – lỗi phát hiện khi rà soát độc lập* (tên có dấu, quyết định sản phẩm, lỗi Sheets giữa chừng, sửa tay tồn, khởi tạo định mức chạy lại, số liệu Tổng quan kho), *GHÉP lỗi sau khi đã chuyển tồn*, *ký phiếu nhưng chưa xuất kho được*; `worker-api` › *[REVIEW-5]…*; `gas` › *[REVIEW] … sheet thiếu cột* |

### Phân quyền

| Ca kiểm thử | Tự động hóa tại |
|---|---|
| Public cannot create handover | `worker-api` › *[QUYỀN] public KHÔNG tạo được phiếu…*; `gas` › *chỉ admin tạo / sửa / hủy phiếu*; `e2e` › *[QUYỀN] …* |
| Public cannot adjust stock · approve proposal · view admin stock | `worker-api` › *[QUYỀN] public không chỉnh kho, không duyệt đề xuất, không xem kho admin*; `gas-vpp` › *scope public không gọi được thao tác quản trị VPP*; `e2e` |
| Admin can | `worker-api` › *[QUYỀN] admin làm được: tìm "but bi" không dấu, nhập kho, phiếu VPP…* |
| Confirmation token still works | `worker-api` › *admin tạo → người nhận xem (contentHash) → ký…*; `e2e` |

Thêm: bảo mật request Apps Script (chữ ký sai, timestamp cũ, replay, sai scope), nâng cấp idempotent có sao lưu, cổng
`SCHEMA_VERSION`, cache nhân viên > 100KB, chống formula injection, bidi, CSRF (Origin khác → 403), 400/404/405/413/429,
health không lộ secret, file trả về đúng định dạng + CSP sandbox, responsive 375/390/430/768/1024/1440 không tràn ngang
(trang chủ, đề xuất VPP, ký, tổng quan, tạo phiếu, tồn kho, đề xuất mua).

## 3. Chạy test

```bash
npm test                 # nhanh (~10 giây)
npm run lint             # oxlint
npm run test:e2e         # ~2 phút: build + workerd + Chrome
```

Biến tùy chọn cho e2e: `E2E_PORT` (mặc định 8788), `E2E_BROWSER_PATH` (đường dẫn Chrome/Edge), `E2E_HEADED=1` (hiện cửa sổ).
Ảnh chụp màn hình các trang được lưu trong `.e2e/screenshots/` (gitignore).

### Windows: workerd lỗi `0xc0000005`

`workerd` (runtime của `wrangler dev` / `vite preview`) cần **Microsoft Visual C++ Redistributable 2015–2022 ≥ 14.40**.
Máy có bản cũ hơn sẽ crash (access violation). Cách khác không cần cài: chạy máy chủ trong **WSL**, trình duyệt trên Windows:

```bash
# Trong WSL (Node ≥ 22, bản sao repo — không dùng chung node_modules với Windows):
npm ci && npm run build
E2E_ENV_FILE=/mnt/d/dta-bangiao/.e2e/env.json node scripts/e2e/run-e2e.mjs --serve --skip-build
```

```powershell
# Trên Windows (WSL tự chuyển tiếp localhost):
$env:E2E_ENV_FILE = 'D:\dta-bangiao\.e2e\env.json'; npx vitest run --config vitest.e2e.config.ts
```

`--serve` chỉ chạy Apps Script giả lập + Worker và ghi `E2E_BASE_URL`, mật khẩu admin, mã truy cập ngẫu nhiên vào tệp
`E2E_ENV_FILE`; dừng bằng Ctrl+C. Dữ liệu giả lập nằm trong bộ nhớ — mỗi lượt chạy E2E cần khởi động lại máy chủ.

## 4. Production preview

```bash
npm run build && npm run preview     # http://localhost:4173 (dùng .dev.vars)
```

Kiểm tra refresh trực tiếp trả `index.html` (200): `/`, `/admin`, `/admin/ban-giao`, `/admin/ban-giao/tao-moi`, `/admin/vpp`,
`/admin/vpp/ton-kho`, `/admin/vpp/dinh-muc`, `/admin/vpp/de-xuat`, `/de-xuat-vpp`, `/xac-nhan/test`; `/api/health` trả JSON;
`/api/khong-co` trả JSON 404.

## 5. Checklist nghiệm thu trên Google + Cloudflare thật

Thực hiện sau khi nâng cấp + deploy (bộ giả lập không thay thế được các bước này):

- [ ] `GET /api/health` → 200, `appsScript/database/drive = ok`; `/admin/cai-dat` mọi mục **đạt** (cấu trúc dữ liệu v2, phiên bản khớp,
      **Gửi email (MailApp) hoạt động**). Menu *DTA Handover → Kiểm tra cấu hình*: mọi dòng ✓.
- [ ] Sheet có đủ 6 sheet `VPP_*`; bản sao lưu “backup trước nâng cấp” nằm trong `DTA_HANDOVER/backups`; dữ liệu phiếu cũ còn nguyên.
- [ ] Mở URL Web App trên trình duyệt (chưa đăng nhập Google) → JSON “Endpoint chỉ nhận POST…”, không phải trang đăng nhập.
- [ ] Trang `/` **không** còn form tạo phiếu; `/tao-ban-giao` chuyển tới trang đăng nhập quản trị.
- [ ] Đăng nhập bằng tài khoản `ADMIN_USERS`; tạo phiếu tài sản → mã `BG-<ngày VN>-0001`; `BAN_GIAO.created_by` = người lập.
- [ ] Phiếu cũ (tạo trước nâng cấp) đang chờ ký: người nhận mở link cũ, ký được; PDF đúng.
- [ ] Mở link trên **iPhone (Safari)** và **Android (Chrome)**: hiển thị đầy đủ, *Gửi mã xác nhận* → email tới đúng hộp thư của
      người nhận (kiểm tra cả Spam) → nhập mã (iPhone gợi ý mã từ Mail) → ký không làm cuộn trang, xác nhận thành công; trang chi
      tiết ghi “Nhập đúng mã xác nhận gửi tới email…”.
- [ ] Nhân viên chưa có email trong `NHAN_VIEN` (chế độ `EMAIL`): ký được không cần mã, trang chi tiết cảnh báo “Ký KHÔNG có mã”.
- [ ] Đặt `NOTIFY_EMAILS` → menu *Gửi thử email thông báo* nhận được; người nhận *Yêu cầu chỉnh sửa* → email tới quản trị viên;
      huy hiệu đỏ trên menu *Danh sách*.
- [ ] Nút **Xuất CSV** (Biên bản, Tồn kho, Lịch sử kho, Đề xuất) → mở bằng Excel: tiếng Việt đúng, ô bắt đầu bằng `=` hiện dạng chữ.
- [ ] Admin sửa phiếu trong lúc người nhận đang mở trang → người nhận bấm ký → báo “Biên bản vừa được cập nhật”, xem lại rồi ký.
- [ ] Tải PDF (người nhận và admin): tiếng Việt có dấu đúng, có chữ ký, mã toàn vẹn; PDF phiếu VPP có bảng STT/Tên/ĐVT/SL.
- [ ] Sửa tay một ô nội dung của phiếu đã ký trên Sheet → trang chi tiết báo **MISMATCH**, tải PDF bị từ chối; hoàn tác ô đó.
- [ ] Văn phòng phẩm: *Dữ liệu cần kiểm tra* → GHÉP “Giấy ướt” → “Khăn giấy ướt”; kiểm kê “Giấy toilet”; gắn phòng ban ở *Định mức*.
- [ ] Nhập kho 10 bút → tạo phiếu VPP 2 bút → *Tồn kho*: tồn 10 / giữ 2 / khả dụng 8 → người nhận ký → tồn 8 / giữ 0; *Lịch sử kho* có RESERVE, OUT với tên người thực hiện.
- [ ] `/de-xuat-vpp` trên điện thoại: mã truy cập → mã NV → định mức phòng → vượt định mức (bắt lý do) + sản phẩm ngoài định mức → gửi → admin duyệt → nhận hàng → tồn tăng.
- [ ] Response trang có `Content-Security-Policy`, `Referrer-Policy: no-referrer`; DevTools → Sources: không có `script.google.com` hay secret.
- [ ] Custom domain `https://bangiao.dieutuongam.com` hoạt động, link xác nhận dùng domain này.
- [ ] Chạy *Khóa sheet hệ thống*; `backupNow()` tạo bản sao trong `DTA_HANDOVER/backups`.
