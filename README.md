# DTA Handover — Hệ thống bàn giao nội bộ Diệu Tướng Am

Ứng dụng web lập **biên bản bàn giao** tài sản, thiết bị, thẻ, tài khoản, hồ sơ, công việc, **văn phòng phẩm** và quản lý
**kho văn phòng phẩm** (định mức, tồn kho, giữ chỗ, đề xuất mua, nhập kho, kiểm kê, cảnh báo).
**Quản trị viên** tạo phiếu (chọn loại → người nhận → nội dung) → hệ thống sinh **link xác nhận** → người nhận mở link trên
điện thoại của mình, kiểm tra và **ký tên** → biên bản, chữ ký và PDF được lưu trên Google Sheets / Google Drive → quản trị
viên theo dõi toàn bộ lịch sử. Nhân viên gửi **đề xuất mua văn phòng phẩm** tại `/de-xuat-vpp`.

- Frontend: React 19 + TypeScript + Vite + Tailwind CSS (SPA)
- API: Cloudflare Worker (`/api/*`), phục vụ SPA bằng Workers Static Assets
- Backend dữ liệu: Google Apps Script Web App → Google Sheets (database) + Google Drive (chữ ký, PDF)
- Không dùng VPS, Docker hay database ngoài.

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Kiến trúc](#2-kiến-trúc)
3. [Yêu cầu môi trường](#3-yêu-cầu-môi-trường)
4. [Cài đặt (`npm install`)](#4-cài-đặt)
5. [Chạy local](#5-chạy-local)
6. [Tạo Google Sheet](#6-tạo-google-sheet)
7. [Setup Apps Script](#7-setup-apps-script)
8. [Deploy Apps Script](#8-deploy-apps-script)
9. [Lấy Web App URL](#9-lấy-web-app-url)
10. [Thư mục Google Drive](#10-thư-mục-google-drive)
11. [Script Properties](#11-script-properties)
12. [Cloudflare secrets](#12-cloudflare-secrets)
13. [Build](#13-build)
14. [Preview](#14-preview)
15. [Deploy lên Cloudflare](#15-deploy-lên-cloudflare)
16. [Custom domain `bangiao.dieutuongam.com`](#16-custom-domain)
17. [Sao lưu (backup)](#17-sao-lưu-backup)
18. [Xử lý sự cố (troubleshooting)](#18-xử-lý-sự-cố)
19. [Nâng cấp từ v1 lên v2 (module Văn phòng phẩm)](#19-nâng-cấp-từ-v1-lên-v2)
- [Lệnh npm](#lệnh-npm) · [Kiểm thử](#kiểm-thử) · [Vận hành hằng ngày](#vận-hành-hằng-ngày) · [Tài liệu chi tiết](#tài-liệu-chi-tiết)

---

## 1. Tổng quan

| Chức năng | Mô tả |
|---|---|
| Tạo phiếu (`/admin/ban-giao/tao-moi`) — **chỉ quản trị viên** | Chọn loại phiếu (Thiết bị / tài sản · Văn phòng phẩm · Tài khoản · Hồ sơ · Công việc · Khác) → mỗi loại một form riêng. Người nhận **bắt buộc** chọn từ danh sách nhân viên (tìm có dấu / không dấu). Mã phiếu `BG-YYYYMMDD-XXXX`. API tạo phiếu yêu cầu phiên quản trị — gọi trực tiếp từ public bị từ chối (401). Link cũ `/tao-ban-giao` chuyển vào trang này. |
| Link xác nhận | Token ngẫu nhiên 256-bit, Sheet chỉ lưu `SHA-256(token)`. Màn hình sau khi tạo có **Sao chép link**, **mã QR**, **Gửi qua email**. |
| Xác nhận (`/xac-nhan/:token`) | Mobile-first. Người nhận tích “Tôi đã kiểm tra…”, nhập **mã xác nhận 6 số gửi tới email của mình** (`CAU_HINH.CONFIRM_OTP` — người cầm link không ký thay được), **ký tên** (chuột / cảm ứng / bút), hoặc **yêu cầu chỉnh sửa** (bắt buộc nhập lý do). Chữ ký gắn với **đúng phiên bản nội dung** người nhận đang xem (mã băm SHA-256) — nội dung vừa bị sửa thì phải xem lại trước khi ký. Không ký lại được biên bản đã xác nhận. |
| Email & thông báo | Email tới quản trị viên (`CAU_HINH.NOTIFY_EMAILS`) khi người nhận yêu cầu chỉnh sửa, có đề xuất mua mới, phiếu VPP cần đối soát kho; email tổng hợp hằng ngày; huy hiệu số việc cần xử lý trên menu quản trị. Lỗi gửi mail hiện trên trang Tổng quan. |
| Xuất CSV | Nút **Xuất CSV** trên trang Biên bản, Tồn kho, Lịch sử kho, Đề xuất mua — theo bộ lọc đang xem, mở đúng tiếng Việt bằng Excel, chống chèn công thức. |
| Chữ ký & PDF | Chữ ký PNG (cắt sát, ≤ 600×300) lưu Drive `DTA_HANDOVER/signatures/YYYY/MM`; PDF lưu `DTA_HANDOVER/pdf/YYYY/MM` (bản cũ khi tạo lại chuyển vào `pdf-archive/`). PDF có mã toàn vẹn; dữ liệu bị sửa thẳng trên Sheet sau khi ký → không tạo PDF, admin thấy cảnh báo. File **private**, chỉ tải qua API. |
| Quản trị (`/admin`) | Tài khoản riêng từng người (`ADMIN_USERS`) hoặc mật khẩu chung. Sidebar: **Tổng quan** · **Phiếu bàn giao** (Danh sách, Tạo phiếu) · **Văn phòng phẩm** (Tổng quan, Tồn kho, Định mức, Đề xuất mua, Lịch sử kho, Dữ liệu cần kiểm tra) · **Nhân viên** · **Cài đặt**. Nhật ký ghi rõ ai tạo / sửa / hủy / duyệt / nhập kho / kiểm kê. |
| Văn phòng phẩm | Định mức tháng theo phòng ban (PHÒNG KINH DOANH, VĂN PHÒNG…), tồn kho `on_hand / reserved / available`, phiếu VPP **giữ chỗ** khi tạo, **xuất kho** khi người nhận ký, **trả giữ chỗ** khi hủy; không bao giờ âm tồn; cảnh báo 🔴 hết hàng / 🟠 sắp hết / 🟡 dữ liệu cần kiểm tra. Chi tiết: [docs/VAN_PHONG_PHAM.md](docs/VAN_PHONG_PHAM.md). |
| Đề xuất mua (`/de-xuat-vpp`) | Công khai (mobile-first, có thể yêu cầu mã truy cập nội bộ): nhân viên nhập **mã NV** → thấy định mức phòng ban → chọn số lượng; vượt định mức / ngoài định mức bắt buộc ghi lý do. Không công khai danh bạ nhân viên. |
| Dữ liệu cấu hình được | Nhân viên (`NHAN_VIEN`), loại bàn giao và form của từng loại (`LOAI_BAN_GIAO`), nội dung PDF (`CAU_HINH`) — sửa trực tiếp trong Google Sheet, **không cần build lại**. |

Trạng thái phiếu: `PENDING` (Chờ xác nhận) · `CONFIRMED` (Đã xác nhận) · `REVISION_REQUESTED` (Yêu cầu chỉnh sửa) · `CANCELLED` (Đã hủy).
Trạng thái đề xuất mua: `SUBMITTED` · `APPROVED` · `PARTIALLY_APPROVED` · `REJECTED` · `PURCHASED` · `RECEIVED` · `CLOSED`.

## 2. Kiến trúc

```text
Trình duyệt (React SPA)
   │  HTTPS — chỉ gọi /api/* cùng domain
   ▼
Cloudflare Worker  ─────────── Static Assets (SPA, fallback index.html cho route sâu)
   │  • validate (Zod), rate limit, session cookie, sinh token link
   │  • ký mỗi request bằng HMAC-SHA256 (GAS_SHARED_SECRET) — URL & secret Apps Script không bao giờ tới trình duyệt
   ▼
Google Apps Script Web App (doPost — JSON API)
   │  • xác thực HMAC + timestamp + chống replay • LockService cho thao tác ghi • CacheService
   ├──► Google Sheets: NHAN_VIEN · BAN_GIAO · CHI_TIET_BAN_GIAO · LOAI_BAN_GIAO · LICH_SU · CAU_HINH
   │                   VPP_SAN_PHAM · VPP_DINH_MUC · VPP_TON_KHO · VPP_BIEN_DONG_KHO · VPP_DE_XUAT · VPP_DE_XUAT_CHI_TIET
   └──► Google Drive:  DTA_HANDOVER/signatures/YYYY/MM · pdf/YYYY/MM · pdf-archive/YYYY/MM · backups
```

Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md) · Bảo mật: [docs/SECURITY.md](docs/SECURITY.md)

### Cấu trúc thư mục

```text
├── src/                 React SPA (pages, components, layouts, hooks, services, utils, styles)
├── worker/              Cloudflare Worker: index.ts (entry), router.ts, api/, auth/, services/, utils/, types.ts
├── shared/              Code dùng chung frontend + Worker: hằng số, type, schema Zod, chuẩn hóa tiếng Việt
├── apps-script/         Google Apps Script backend (*.gs + appsscript.json) + sample-data/
├── public/              logo.svg, favicon.svg, _headers (security headers/CSP), robots.txt
├── docs/                Tài liệu kiến trúc, cài đặt Google, deploy Cloudflare, database, bảo mật, kiểm thử, API
├── tests/               Unit/integration test (Vitest) + tests/e2e (Chrome thật + workerd)
├── scripts/             gas-emulator (Apps Script giả lập CHỈ để test), e2e runner, local (npm run local — chạy thử cục bộ)
├── wrangler.jsonc       Cấu hình Cloudflare Worker (assets, SPA, run_worker_first, rate limit, logs)
├── vite.config.ts       Vite + @cloudflare/vite-plugin + React + Tailwind
└── .dev.vars.example    Mẫu biến môi trường local
```

## 3. Yêu cầu môi trường

| Thành phần | Yêu cầu |
|---|---|
| Node.js | **≥ 22.12** (khuyến nghị **24 LTS**). Kiểm tra: `node -v` |
| npm | ≥ 10 (đi kèm Node) |
| Tài khoản Google | Google Workspace hoặc Gmail — sở hữu Google Sheet, Drive và Apps Script |
| Tài khoản Cloudflare | Gói Free là đủ. Domain `dieutuongam.com` cần nằm trên Cloudflare DNS để gắn custom domain |
| Trình duyệt Chrome/Edge | Chỉ cần nếu chạy test end-to-end (`npm run test:e2e`) |

## 4. Cài đặt

```bash
git clone <repo> dta-handover
cd dta-handover
npm install
```

> npm 11+ chặn install script mặc định; `package.json` đã khai báo `allowScripts` cho `esbuild` và `workerd`
> (binary cần cho build và chạy Worker local). Nếu npm hỏi, chạy `npm install-scripts approve esbuild workerd`.

## 5. Chạy local

### Chạy thử nhanh — không cần Google / Cloudflare (khuyến nghị để tự kiểm tra)

```bash
npm run local                           # build rồi mở http://localhost:8787 (Ctrl+C để dừng)
npm run local -- --lan                  # mở được từ điện thoại cùng Wi-Fi — thử ký xác nhận trên điện thoại
```

Chạy **đúng bản Worker sẽ deploy** trên Node (không cần workerd — chạy được trên Windows) với Apps Script **giả lập** (Sheet /
Drive / email trong bộ nhớ, đã nạp nhân viên mẫu `DEMO-…`, định mức + tồn đầu kỳ văn phòng phẩm). Màn hình in ra tài khoản quản trị
(`admin`, `kho`), mã truy cập trang đề xuất, và **hộp thư giả lập** `http://localhost:8787/__local/mail` — mã xác nhận khi ký và
email thông báo hiện ở đó, không gửi email thật. Dữ liệu mất khi tắt. Kịch bản gợi ý và tùy chọn: [docs/TESTING.md §0](docs/TESTING.md).

### Dev server (cần `.dev.vars`, workerd)

```bash
cp .dev.vars.example .dev.vars          # PowerShell: Copy-Item .dev.vars.example .dev.vars
# điền giá trị vào .dev.vars (xem mục 11–12), rồi:
npm run dev                             # http://localhost:5173 — SPA + Worker API chạy chung trong workerd
```

`.dev.vars` đã nằm trong `.gitignore` — **không commit**. Các biến:

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `GAS_WEB_APP_URL` | ✔ | URL Web App Apps Script (`https://script.google.com/macros/s/…/exec`) |
| `GAS_SHARED_SECRET` | ✔ | Chuỗi bí mật ≥ 32 ký tự, **trùng** Script Property `BACKEND_SHARED_SECRET` |
| `ADMIN_USERS` | ✔* | **Khuyến nghị.** Tài khoản quản trị riêng từng người (JSON, mật khẩu ≥ 12 ký tự): `[{"username":"thai","name":"Phạm Danh Thái","password":"…"}]`. Có `ADMIN_USERS` thì `ADMIN_PASSWORD` không còn dùng để đăng nhập. |
| `ADMIN_PASSWORD` | ✔* | Mật khẩu quản trị **dùng chung** (tương thích bản cũ; nhật ký ghi “Quản trị viên”). *Cần `ADMIN_USERS` **hoặc** `ADMIN_PASSWORD`. |
| `SESSION_SECRET` | ✔ | Khóa ≥ 32 ký tự ký cookie phiên + sinh link xác nhận |
| `APP_BASE_URL` | – | URL gốc cho link xác nhận. Local: để trống = tự lấy domain đang truy cập (ghi đè giá trị production `https://bangiao.dieutuongam.com` trong `wrangler.jsonc`) |
| `STAFF_ACCESS_CODE` | – | Nếu đặt: trang đề xuất văn phòng phẩm `/de-xuat-vpp` yêu cầu nhập mã truy cập nội bộ (khuyến nghị cho production) |
| `RECORD_SEAL_SECRET` | – | **Khuyến nghị.** Khóa ≥ 32 ký tự niêm phong biên bản đã ký (nội dung, ý kiến người nhận, thời điểm, chữ ký) — không lưu ở Google nên người sửa được Sheet không tự tính lại được. **Không đổi** sau khi đã dùng; lưu giữ cẩn thận |

Tạo chuỗi bí mật ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Thử giao diện khi chưa có Google:** có thể chạy *Apps Script giả lập* (chỉ dùng để phát triển/kiểm thử,
dữ liệu nằm trong bộ nhớ và mất khi tắt — **không phải backend production**):

```bash
npm run gas:emulator              # in ra GAS_WEB_APP_URL=http://127.0.0.1:8790/macros/s/emulator/exec
npm run gas:emulator -- --vpp     # kèm định mức + tồn đầu kỳ văn phòng phẩm (như sau khi chạy 2 hàm nạp dữ liệu)
```

Đặt `GAS_WEB_APP_URL` theo URL được in ra và `GAS_SHARED_SECRET` bằng giá trị trong `.dev.vars` (emulator đọc
secret từ `.dev.vars`), rồi `npm run dev` ở một terminal khác. Nhân viên mẫu có mã `DEMO-…`.

## 6. Tạo Google Sheet

1. Vào <https://sheets.new> (bằng tài khoản sẽ sở hữu dữ liệu), đặt tên ví dụ **DTA Handover – Database**.
2. Không cần tạo sheet/cột thủ công — `setupDatabase()` (mục 7) tự tạo:
   `NHAN_VIEN`, `BAN_GIAO`, `CHI_TIET_BAN_GIAO`, `LOAI_BAN_GIAO`, `LICH_SU`, `CAU_HINH` và 6 sheet văn phòng phẩm
   `VPP_SAN_PHAM`, `VPP_DINH_MUC`, `VPP_TON_KHO`, `VPP_BIEN_DONG_KHO`, `VPP_DE_XUAT`, `VPP_DE_XUAT_CHI_TIET`.
3. Chạy lại `setupDatabase()` / `upgradeOfficeSupplyModule()` bất cứ lúc nào cũng an toàn: chỉ bổ sung sheet/cột còn thiếu,
   **không xóa, không ghi đè dữ liệu**; nếu Sheet đã có dữ liệu thì tự **sao lưu** trước khi đổi cấu trúc.

Cấu trúc cột: [docs/DATABASE.md](docs/DATABASE.md).

## 7. Setup Apps Script

1. Trong Google Sheet: **Extensions → Apps Script** (script gắn với Sheet — khuyến nghị).
2. Dán code — chọn **một** trong hai cách:
   - **Nhanh (1 file — khuyến nghị):** `npm run gas:bundle` → mở `dist/apps-script/DTA_Handover.gs`, Ctrl+A, Ctrl+C → dán đè
     toàn bộ file `Code.gs`/`Mã.gs` mặc định trong editor → Lưu. Dự án chỉ được có **một** file `.gs` này (xóa mọi file `.gs`
     khác nếu có — file cũ nạp sau sẽ ghi đè code mới; Apps Script khi đó từ chối mọi thao tác với lỗi "trộn code nhiều phiên bản").
   - **Nhiều file:** tạo các file đúng tên và dán nội dung từ thư mục [`apps-script/`](apps-script/) — đủ **14 file**:
     `Code.gs`, `Config.gs`, `Security.gs`, `Utils.gs`, `Employees.gs`, `Handovers.gs`, `Notify.gs`, `Drive.gs`, `Pdf.gs`,
     `Export.gs`, `Setup.gs`, `Vpp.gs`, `VppProposals.gs`, `VppSetup.gs` (thứ tự file trong editor không quan trọng). Thiếu file
     nào thì mọi request báo `NOT_CONFIGURED` "thiếu code (… is not defined)" và menu *Kiểm tra cấu hình* báo
     "✗ Code Apps Script: …"; còn file `.gs` của bản cũ thì báo "trộn code nhiều phiên bản".
3. **Project Settings (⚙)** → bật *Show "appsscript.json" manifest file in editor* → mở `appsscript.json`, dán nội dung từ
   [`apps-script/appsscript.json`](apps-script/appsscript.json) (múi giờ `Asia/Ho_Chi_Minh`, runtime V8).
4. Tải lại Google Sheet (F5) → xuất hiện menu **DTA Handover**.
5. **DTA Handover → Thiết lập / cập nhật database** → cấp quyền khi Google hỏi (rồi bấm lại menu) → dán khóa kết nối
   (`BACKEND_SHARED_SECRET`, mục 11) khi được hỏi → hộp thoại hiện kết quả. (Cách khác: trong editor chọn hàm
   **`setupDatabase`** → **Run**, khóa đặt trong *Project Settings → Script properties*.)
6. (Tùy chọn) chạy **`seedSampleEmployees`** để có nhân viên mẫu `DEMO-…`; xóa bằng **`removeSampleEmployees`**.
7. Nhập danh sách nhân viên thật vào sheet `NHAN_VIEN` — xem [apps-script/sample-data/README.md](apps-script/sample-data/README.md).
8. **Văn phòng phẩm** (chạy **một lần**, chạy lại không tạo trùng / không ghi đè): menu **DTA Handover → Khởi tạo định mức VPP**
   (`seedOfficeSupplyNorms`) rồi **Nhập tồn đầu kỳ VPP** (`seedInitialOfficeSupplyStock`). Không chạy tự động khi deploy.
9. Menu **DTA Handover → Khóa sheet hệ thống** (`protectSystemSheets`) — chỉ chủ script ghi được các sheet dữ liệu.
10. Chạy **`checkSetup`** để kiểm tra (không in secret).

Có thể dùng [clasp](https://github.com/google/clasp) thay cho copy/paste — xem [apps-script/README.md](apps-script/README.md).
Hướng dẫn chi tiết từng bước: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## 8. Deploy Apps Script

1. **Deploy → New deployment** → biểu tượng ⚙ → **Web app**.
2. *Description*: `DTA Handover API v2`.
3. **Execute as: Me** (tài khoản sở hữu Sheet/Drive).
4. **Who has access: Anyone**.
5. **Deploy** → cấp quyền nếu được hỏi.

Vì sao *Anyone*? Cloudflare Worker gọi Web App theo kiểu **server-to-server**, không có tài khoản Google. Người dùng cuối
**không bao giờ** truy cập URL này và không cần đăng nhập Google. Mọi request phải mang chữ ký HMAC-SHA256 hợp lệ (bằng
`BACKEND_SHARED_SECRET`), timestamp trong ±5 phút và `requestId` chưa dùng — request khác đều bị từ chối.

**Cập nhật code Apps Script sau này:** *Deploy → Manage deployments → ✏ Edit → Version: **New version** → Deploy*.
Cách này **giữ nguyên URL** Web App (không cần đổi secret bên Cloudflare).

## 9. Lấy Web App URL

Sau khi deploy, sao chép **Web app URL** dạng:

```text
https://script.google.com/macros/s/AKfycb…/exec
```

Dùng URL kết thúc bằng **`/exec`** (không dùng `/dev`). Đây là giá trị `GAS_WEB_APP_URL`.
Mở URL bằng trình duyệt sẽ thấy JSON `{"ok":true,…"Endpoint chỉ nhận POST có chữ ký…"}` — Web App đang hoạt động.

## 10. Thư mục Google Drive

- **Mặc định:** `setupDatabase()` tự tạo thư mục `DTA_HANDOVER` trong *My Drive* của tài khoản chạy script, kèm
  `signatures/`, `pdf/`, `backups/`, và lưu ID vào Script Property `DRIVE_FOLDER_ID`.
- **Dùng thư mục có sẵn** (ví dụ trên Shared Drive): tạo thư mục, copy ID trên URL
  (`https://drive.google.com/drive/folders/<ID>`), đặt Script Property `DRIVE_FOLDER_ID = <ID>` rồi chạy lại
  `setupDatabase()`. Tài khoản chạy script phải có quyền *Content manager/Editor*.
- Shared Drive: nếu gặp lỗi tạo file, bật *Services → Drive API (v3)* trong editor và đặt `USE_ADVANCED_DRIVE = true`.

File chữ ký/PDF **không** được chia sẻ “Anyone with the link”; người dùng tải qua API của Worker.

## 11. Script Properties

Cách dễ nhất cho `BACKEND_SHARED_SECRET`: menu Google Sheet **DTA Handover → Nhập / đổi khóa kết nối** (hoặc tự hỏi khi chạy
*Thiết lập / cập nhật database*). Cách thủ công: Apps Script editor → **Project Settings (⚙) → Script properties → Add script property**:

| Property | Bắt buộc | Giá trị |
|---|---|---|
| `BACKEND_SHARED_SECRET` | ✔ | Chuỗi ngẫu nhiên ≥ 32 ký tự — **giống hệt** `GAS_SHARED_SECRET` bên Cloudflare |
| `SPREADSHEET_ID` | tự điền | `setupDatabase()` tự lưu khi script gắn với Sheet. Script độc lập: điền ID Sheet thủ công |
| `DRIVE_FOLDER_ID` | tự điền | `setupDatabase()` tự tạo thư mục nếu trống |
| `USE_ADVANCED_DRIVE` | – | `true` khi dùng Shared Drive + Advanced Drive Service |

Secret **không** được viết trong code `.gs`. Hệ thống tự thêm các property kỹ thuật (`HANDOVER_SEQ`, `FOLDER_…`) — không cần sửa.

## 12. Cloudflare secrets

```bash
npx wrangler login                              # mở trình duyệt đăng nhập Cloudflare

npx wrangler secret put GAS_WEB_APP_URL         # dán URL /exec ở mục 9
npx wrangler secret put GAS_SHARED_SECRET       # dán đúng BACKEND_SHARED_SECRET
npx wrangler secret put ADMIN_USERS             # khuyến nghị: JSON tài khoản riêng từng người (mục 5)
npx wrangler secret put ADMIN_PASSWORD          # hoặc: một mật khẩu chung (bản cũ)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put STAFF_ACCESS_CODE       # tùy chọn (khuyến nghị) — mã cho trang /de-xuat-vpp
npx wrangler secret put RECORD_SEAL_SECRET      # khuyến nghị — niêm phong biên bản đã ký (≥ 32 ký tự, KHÔNG đổi sau khi dùng)
```

Nếu Worker chưa tồn tại, lệnh đầu tiên sẽ hỏi tạo Worker `dta-bangiao` — chọn **Yes**.
Secret được mã hóa trên Cloudflare, không nằm trong repo, không hiển thị cho trình duyệt. Xem/sửa: Dashboard →
*Workers & Pages → dta-bangiao → Settings → Variables and Secrets*.

`APP_BASE_URL` là biến thường trong `wrangler.jsonc` (`vars`), hiện là `https://bangiao.dieutuongam.com`
(để trống = tự lấy domain đang truy cập).

## 13. Build

```bash
npm run typecheck     # TypeScript: frontend + Worker + test
npm run build         # tsc -b && vite build → dist/client (SPA) + dist/dta_bangiao (Worker + wrangler.json)
```

## 14. Preview

```bash
npm run preview       # chạy bản build production trong workerd: http://localhost:4173
```

Kiểm tra (refresh trực tiếp không 404): `/`, `/admin`, `/admin/ban-giao`, `/admin/ban-giao/tao-moi`, `/admin/vpp`,
`/admin/vpp/ton-kho`, `/admin/vpp/dinh-muc`, `/admin/vpp/de-xuat`, `/de-xuat-vpp`, `/xac-nhan/test` và `/api/health` (JSON).
Preview dùng `.dev.vars` giống `npm run dev`.

> Windows: nếu `npm run dev` / `preview` / `test:e2e` báo lỗi `workerd` (access violation `0xc0000005`), máy cần
> **Microsoft Visual C++ Redistributable 2015–2022 bản ≥ 14.40** — hoặc chạy trong WSL (xem [docs/TESTING.md](docs/TESTING.md)).

## 15. Deploy lên Cloudflare

**Cách 1 — tự động từ GitHub (khuyến nghị):** kết nối repo trong Cloudflare Dashboard (*Workers & Pages → Create →
Import a repository*), project name `dta-bangiao`, build **`npm run verify && npm run build`** (typecheck + lint + test — lỗi
thì KHÔNG deploy), deploy `npx wrangler deploy`, rồi thêm secrets trong *Settings → Variables and Secrets*. Mỗi lần push
`main` sẽ tự deploy — chi tiết [docs/CLOUDFLARE_DEPLOY.md §9](docs/CLOUDFLARE_DEPLOY.md#9-deploy-tự-động-từ-github-workers-builds--khuyến-nghị).
GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) chạy typecheck, test, build, dry-run deploy và E2E
cho mỗi push / pull request.

**Cách 2 — từ máy local:**

```bash
npx wrangler login       # nếu chưa đăng nhập
npm run deploy:dry-run   # kiểm tra + build + wrangler deploy --dry-run (không thay production)
npm run deploy           # = npm run verify && npm run build && wrangler deploy
```

> **Thứ tự khi nâng cấp từ v1:** cập nhật Apps Script + nâng cấp dữ liệu **trước**, deploy Worker **sau** — xem [mục 19](#19-nâng-cấp-từ-v1-lên-v2).

Kết quả in ra URL dạng `https://dta-bangiao.<account-subdomain>.workers.dev`. Kiểm tra ngay:

```bash
curl https://dta-bangiao.<account-subdomain>.workers.dev/api/health
# {"success":true,"data":{"app":"dta-handover","cloudflare":"ok","appsScript":"ok","database":"ok","drive":"ok",…}}
```

Chi tiết (rollback, logs, CI): [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md).

## 16. Custom domain

Đang dùng: **https://bangiao.dieutuongam.com** (SSL do Cloudflare cấp và tự gia hạn, không cần VPS/IP).

```text
DNS Nhân Hòa (zonedns.vn): CNAME bangiao → dta-bangiao-web.pages.dev
Trình duyệt → Cloudflare Pages dta-bangiao-web (gateway/) → Service Binding APP → Worker dta-bangiao
```

- `wrangler.jsonc` → `"APP_BASE_URL": "https://bangiao.dieutuongam.com"`: mọi link xác nhận dùng tên miền này, kể cả khi
  biên bản được tạo từ địa chỉ `…workers.dev` (địa chỉ này vẫn chạy, dùng làm dự phòng).
- HTTP tự chuyển sang HTTPS (301); cổng Pages gửi thêm `Strict-Transport-Security`.

> CNAME từ DNS bên ngoài trỏ thẳng tới `…workers.dev` **không hoạt động** (Workers chỉ nhận tên miền thuộc zone trên
> Cloudflare → lỗi SSL). Vì vậy cần cổng Pages trong thư mục [`gateway/`](gateway/).

**Thiết lập lại từ đầu (DNS ở nhà cung cấp khác):** tạo dự án Pages từ repo (Root directory `gateway`, Build output
`public`, không build command), thêm Service binding `APP` → `dta-bangiao`, rồi *Custom domains → Set up a custom domain*
→ **My DNS provider** → đặt CNAME `bangiao` → `<dự-án>.pages.dev` → *Check DNS records*. Chi tiết:
[docs/CLOUDFLARE_DEPLOY.md §5a](docs/CLOUDFLARE_DEPLOY.md#5a-dns-của-tên-miền-đang-ở-nhà-cung-cấp-khác-ví-dụ-zonednsvn--dùng-cổng-pages).

**Nếu sau này chuyển DNS `dieutuongam.com` sang Cloudflare (cùng tài khoản):** có thể bỏ cổng Pages, gắn thẳng vào
Worker — gỡ tên miền khỏi dự án Pages trước, rồi bỏ comment dòng `routes` trong `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "bangiao.dieutuongam.com", "custom_domain": true }],
```

hoặc Dashboard: *Workers & Pages → dta-bangiao → Settings → Domains & Routes → Add → Custom domain*. Nên bật
*SSL/TLS → Edge Certificates → Always Use HTTPS* cho zone.

## 17. Sao lưu (backup)

| Dữ liệu | Cách sao lưu |
|---|---|
| Google Sheet | Chạy `backupNow()` (bản sao vào `DTA_HANDOVER/backups`) hoặc `installWeeklyBackupTrigger()` để tự động 2h sáng Chủ nhật hằng tuần. Ngoài ra: *File → Version history* và *File → Download → .xlsx*. |
| Chữ ký & PDF | Nằm trong `DTA_HANDOVER/` trên Drive — sao chép thư mục hoặc Google Takeout định kỳ. |
| Code | Repo git (cả `apps-script/`). |
| Secret | Lưu trong trình quản lý mật khẩu của công ty (không lưu trong repo). |

Khôi phục: sao chép file backup thành Sheet mới → đặt `SPREADSHEET_ID` = ID mới → chạy `setupDatabase()` → tạo *New version* deployment.

## 18. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `/api/health` → `appsScript: "not_configured"` | Thiếu `GAS_WEB_APP_URL` / `GAS_SHARED_SECRET` | `npx wrangler secret put …` (mục 12), local: kiểm tra `.dev.vars` |
| `appsScript: "error"`; log Worker có `gas.invalid_response` | Web App trả trang HTML: chưa deploy *Anyone*, dùng URL `/dev`, deployment đã xóa, hoặc Workspace chặn chia sẻ ra ngoài | Deploy lại đúng mục 8–9; với Workspace: nhờ admin cho phép hoặc deploy từ tài khoản được phép |
| Lỗi `UPSTREAM_AUTH_FAILED` (502) | `GAS_SHARED_SECRET` ≠ `BACKEND_SHARED_SECRET` | Đặt lại hai giá trị giống hệt nhau (không có khoảng trắng thừa) |
| `database: "error"` | Chưa chạy `setupDatabase()` / `SPREADSHEET_ID` sai | Chạy `setupDatabase()`, `checkSetup()` |
| Mọi thao tác báo `NOT_CONFIGURED` “… Nâng cấp module Văn phòng phẩm” | Code Apps Script v2 nhưng dữ liệu chưa nâng cấp (`SCHEMA_VERSION` < 2) | Menu **DTA Handover → Nâng cấp module Văn phòng phẩm (v2)** — xem [mục 19](#19-nâng-cấp-từ-v1-lên-v2) |
| Lỗi `UPSTREAM_OUTDATED` | Worker v2 gọi Apps Script còn code v1 | Cập nhật code Apps Script + *New version* (mục 8) |
| Văn phòng phẩm “Hết hàng” toàn bộ ngay sau khi nạp dữ liệu | Tồn đầu kỳ chưa được ghép vào sản phẩm danh mục (không tự ghép) | *Văn phòng phẩm → Dữ liệu cần kiểm tra*: GHÉP / TẠO SẢN PHẨM MỚI / BỎ QUA, kiểm kê số chưa rõ |
| Tạo phiếu VPP báo `INSUFFICIENT_STOCK` | Khả dụng (= tồn − đang giữ chỗ) không đủ | Nhập kho / hủy phiếu chờ ký đang giữ chỗ, hoặc bấm **TẠO ĐỀ XUẤT MUA** |
| Người nhận báo “Biên bản vừa được cập nhật” khi ký | Admin sửa phiếu lúc người nhận đang mở trang | Bình thường: trang tự tải bản mới — người nhận xem lại rồi ký |
| `drive: "error"` | `DRIVE_FOLDER_ID` sai hoặc không có quyền | Sửa property hoặc để trống rồi chạy `setupDatabase()` |
| Đã sửa code `.gs` nhưng không có tác dụng | Web App vẫn chạy version cũ | *Manage deployments → Edit → New version* |
| Lỗi quyền DriveApp/SpreadsheetApp sau khi cập nhật code | Script cần cấp quyền mới | Chạy một hàm (ví dụ `checkSetup`) trong editor để cấp quyền, rồi tạo *New version* |
| Nhân viên mới chưa hiện | Cache (tối đa ~10 phút) | Nút **Làm mới dữ liệu NV** trên `/admin` hoặc menu *DTA Handover → Làm mới cache* |
| Admin báo “Không khôi phục được link” | `SESSION_SECRET` đã đổi | Bấm **Tạo link mới** (link cũ vẫn dùng được cho người nhận) |
| Đăng nhập admin báo `NOT_CONFIGURED` (503) | Thiếu `ADMIN_PASSWORD` / `SESSION_SECRET` | Đặt secret rồi thử lại |
| Lỗi 429 | Vượt giới hạn tần suất | Chờ 1 phút |
| `wrangler deploy` lỗi phần `ratelimits` | Tài khoản chưa hỗ trợ Rate Limiting binding | Xóa khối `ratelimits` trong `wrangler.jsonc` — Worker tự dùng bộ giới hạn dự phòng |
| `wrangler deploy` báo thiếu entry-point/assets | Chưa build | Dùng `npm run deploy` (build rồi deploy) |
| PDF hiển thị sai font tiếng Việt | Bộ chuyển HTML→PDF của Google | Đổi `font-family` trong `apps-script/Pdf.gs` (ví dụ `'Times New Roman'`) |
| Windows: `cp` không chạy | PowerShell | `Copy-Item .dev.vars.example .dev.vars` |

Log: Cloudflare Dashboard → *Workers & Pages → dta-bangiao → Logs* (Worker tự ghi access log, đã che token);
Apps Script → *Executions*.

---

## Lệnh npm

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Dev server Vite + Worker (workerd) tại `http://localhost:5173` |
| `npm run typecheck` | Kiểm tra TypeScript toàn bộ (app, worker, test) |
| `npm run build` | Typecheck + build production |
| `npm run preview` | Chạy bản build production local tại `http://localhost:4173` |
| `npm run local` | **Chạy thử cục bộ**: Worker build thật trên Node + Apps Script giả lập + hộp thư giả lập (`/__local/mail`) tại `http://localhost:8787`; `-- --lan` để mở từ điện thoại |
| `npm run lint` | oxlint (lỗi + nghi vấn, React hooks, Vitest) — không cho phép cảnh báo |
| `npm run verify` | Typecheck + lint + toàn bộ test (chạy trước mọi lần deploy) |
| `npm run deploy:dry-run` | Verify + build + `wrangler deploy --dry-run` (không thay production) |
| `npm run deploy` | Verify + build + `wrangler deploy` |
| `npm test` | Unit + integration test (Worker chạy thật trên Node, Apps Script chạy trong bộ giả lập) |
| `npm run test:e2e` | E2E: bản build trên workerd + Chrome/Edge thật (admin tạo phiếu, phiếu VPP + kho, ký cảm ứng/chuột, đề xuất mua, responsive) |
| `npm run gas:emulator` | Apps Script giả lập cho dev/test (không dùng cho production); `-- --vpp` để nạp sẵn định mức + tồn đầu kỳ |
| `npm run gas:bundle` | Gộp `apps-script/*.gs` thành 1 file `dist/apps-script/DTA_Handover.gs` để dán vào Apps Script editor |

## Kiểm thử

```bash
npm test            # 137 test: validation, crypto, session, router, CSV, API Worker ⇄ Apps Script (giả lập), mã OTP, email, kho VPP, quyền, bản gộp 1 file
npm run test:e2e    # 25 test trên trình duyệt thật (kể cả ký có mã OTP) — cần Chrome hoặc Edge
```

Danh sách lỗi đã sửa và bằng chứng kiểm thử: [docs/BUG_FIX_REPORT.md](docs/BUG_FIX_REPORT.md).

Danh sách ca kiểm thử và checklist nghiệm thu trên Google thật: [docs/TESTING.md](docs/TESTING.md).

## Vận hành hằng ngày

- **Thêm/sửa nhân viên:** sửa sheet `NHAN_VIEN` → *Làm mới dữ liệu*. Nhân viên nghỉ việc: `status = INACTIVE` (biên bản cũ giữ nguyên).
  Cột `email` phải đúng hộp thư của nhân viên — mã xác nhận khi ký gửi tới đó.
- **Email:** `CAU_HINH.NOTIFY_EMAILS` (người nhận thông báo), `CONFIRM_OTP` (`EMAIL` / `REQUIRED` / `OFF`). Cảnh báo đỏ “Gửi email lỗi”
  trên *Tổng quan* → xem *Cài đặt → Email* (thường do hết hạn mức trong ngày hoặc chưa cấp quyền gửi email).
- **Xuất báo cáo:** nút **Xuất CSV** trên các trang danh sách (thay cho tải CSV trực tiếp từ Google Sheets).
- **Thêm loại bàn giao:** thêm dòng vào `LOAI_BAN_GIAO` (`form_fields`, `handover_type` theo hướng dẫn trong [docs/DATABASE.md](docs/DATABASE.md)).
- **Thêm / đổi quản trị viên:** sửa secret `ADMIN_USERS` (`npx wrangler secret put ADMIN_USERS`). Đổi mật khẩu của một người
  → chỉ phiên của người đó hết hiệu lực. Mật khẩu chung `ADMIN_PASSWORD` đổi → mọi phiên cũ hết hiệu lực.
- **Văn phòng phẩm:** nhập kho / kiểm kê ở *Tồn kho*; duyệt đề xuất ở *Đề xuất mua*; gắn phòng ban với định mức ở *Định mức*.
  Không sửa tay số tồn trên Sheet — mọi thay đổi tồn phải qua biến động kho (có lịch sử, người thực hiện).
- **Đổi secret Apps Script:** đổi đồng thời `BACKEND_SHARED_SECRET` (Script Properties) và `GAS_SHARED_SECRET` (Cloudflare).
- **Không sửa tay** các cột hệ thống trong `BAN_GIAO` (`status`, `public_token_hash`, `content_hash`, …) — dùng trang quản trị.
  Biên bản đã ký bị sửa thẳng trên Sheet sẽ bị đánh dấu **MISMATCH** và không tạo được PDF.

## Tài liệu chi tiết

| Tài liệu | Nội dung |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Luồng dữ liệu, giao thức Worker ⇄ Apps Script, token, cache, khóa, PDF |
| [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md) | Thiết lập Google Sheet, Apps Script, Drive, deploy Web App |
| [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md) | Secrets, deploy, custom domain, logs, rollback, CI |
| [docs/DATABASE.md](docs/DATABASE.md) | Cấu trúc 12 sheet (6 sheet bàn giao + 6 sheet văn phòng phẩm), cấu hình loại bàn giao, Drive |
| [docs/VAN_PHONG_PHAM.md](docs/VAN_PHONG_PHAM.md) | Module văn phòng phẩm: định mức, tồn kho, giữ chỗ, đề xuất mua, nhập kho, kiểm kê, dữ liệu ban đầu |
| [docs/SECURITY.md](docs/SECURITY.md) | Mô hình bảo mật, secret, phân quyền, chống CSRF/XSS/injection, toàn vẹn biên bản |
| [docs/TESTING.md](docs/TESTING.md) | Chiến lược kiểm thử, ca kiểm thử, chạy E2E qua WSL, checklist nghiệm thu |
| [docs/API.md](docs/API.md) | Danh sách API, định dạng response, mã lỗi |
| [docs/BUG_FIX_REPORT.md](docs/BUG_FIX_REPORT.md) | Lỗi tồn đọng sau audit: nguyên nhân, cách sửa, bằng chứng kiểm thử |
| [apps-script/README.md](apps-script/README.md) | Các file `.gs`, hàm chạy thủ công, clasp |

## 19. Nâng cấp từ v1 lên v2

v2 thêm module văn phòng phẩm, chuyển quyền tạo phiếu vào trang quản trị và gắn chữ ký với phiên bản nội dung.
**Làm theo đúng thứ tự, liền nhau, ngoài giờ làm việc** — từ bước 3 đến khi xong bước 6 (vài phút), Worker cũ và Apps Script
mới không khớp nhau nên chưa tạo / ký phiếu được. Phiếu đang chờ ký vẫn dùng link cũ bình thường sau nâng cấp.

1. **Sao lưu**: menu *DTA Handover → Sao lưu ngay* (bước 4 cũng tự sao lưu nếu Sheet có dữ liệu).
2. `npm run gas:bundle` → dán `dist/apps-script/DTA_Handover.gs` đè toàn bộ code trong Apps Script editor → **xóa mọi file `.gs`
   khác của bản v1** (Config, Utils, Handovers…; chỉ giữ một file vừa dán và `appsscript.json`) → Lưu → trên Google Sheet chạy menu
   **DTA Handover → Kiểm tra cấu hình** (dòng đầu phải là "✓ Code Apps Script đầy đủ, một phiên bản") và **cấp quyền** khi Google
   hỏi (bản này thêm quyền *gửi email* cho mã xác nhận khi ký).
3. *Deploy → Manage deployments → Edit → Version: New version → Deploy* (giữ nguyên URL).
4. Trên Google Sheet: **DTA Handover → Nâng cấp module Văn phòng phẩm (v2)** — thêm cột / sheet mới, không xóa / ghi đè dữ liệu,
   chạy lại nhiều lần vẫn an toàn. Trước bước này, Apps Script v2 trả `NOT_CONFIGURED` cho mọi thao tác ghi (không ghi nửa vời).
5. **Khởi tạo định mức VPP** rồi **Nhập tồn đầu kỳ VPP (chạy 1 lần)**; sau đó **Khóa sheet hệ thống**.
6. Đặt secret `ADMIN_USERS` (khuyến nghị), `STAFF_ACCESS_CODE` và `RECORD_SEAL_SECRET` (khuyến nghị — niêm phong biên bản ký
   từ nay; lưu giữ cẩn thận, không đổi về sau), rồi deploy Worker (`npm run deploy` hoặc push `main`).
7. Mở `/admin/cai-dat` — mọi mục phải **đạt** (kể cả *Email: Gửi email (MailApp) hoạt động*); vào *Văn phòng phẩm → Dữ liệu cần
   kiểm tra* để xử lý dữ liệu tồn đầu kỳ chưa rõ (danh sách dữ liệu chưa rõ:
   [docs/VAN_PHONG_PHAM.md](docs/VAN_PHONG_PHAM.md#dữ-liệu-chưa-rõ-unresolved-data)).
8. Email (tùy chọn nhưng khuyến nghị): điền `NOTIFY_EMAILS` trong sheet `CAU_HINH` → menu *Gửi thử email thông báo* → *Bật email
   tổng hợp hằng ngày*. **Lưu ý thay đổi luồng ký:** từ bản này, người nhận có email trong `NHAN_VIEN` phải nhập mã gửi qua email
   khi ký (`CONFIRM_OTP = EMAIL`). Kiểm tra email nhân viên trước khi đưa vào dùng; muốn giữ luồng cũ đặt `CONFIRM_OTP = OFF`.
