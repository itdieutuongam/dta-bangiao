# DTA Handover — Hệ thống bàn giao nội bộ Diệu Tướng Am

Ứng dụng web lập **biên bản bàn giao** tài sản, thiết bị, thẻ, tài khoản, hồ sơ, công việc giữa nhân viên với nhân viên.
Người giao tạo biên bản (nhiều nội dung) → hệ thống sinh **link xác nhận** → người nhận mở link trên điện thoại,
kiểm tra và **ký tên** → biên bản, chữ ký và PDF được lưu trên Google Sheets / Google Drive → quản trị viên theo dõi toàn bộ lịch sử.

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
16. [Custom domain `ban-giao.dieutuongam.com`](#16-custom-domain)
17. [Sao lưu (backup)](#17-sao-lưu-backup)
18. [Xử lý sự cố (troubleshooting)](#18-xử-lý-sự-cố)
- [Lệnh npm](#lệnh-npm) · [Kiểm thử](#kiểm-thử) · [Vận hành hằng ngày](#vận-hành-hằng-ngày) · [Tài liệu chi tiết](#tài-liệu-chi-tiết)

---

## 1. Tổng quan

| Chức năng | Mô tả |
|---|---|
| Tạo biên bản (`/` hoặc `/tao-ban-giao`) | Người giao nhập/chọn tên; người nhận **bắt buộc** chọn từ danh sách nhân viên (tìm theo tên, mã NV, email, phòng ban — có dấu hoặc không dấu). Thêm / sửa / xóa / sắp xếp nhiều nội dung; mỗi loại có form riêng. Mã biên bản `BG-YYYYMMDD-XXXX`. |
| Link xác nhận | Token ngẫu nhiên 256-bit, Sheet chỉ lưu `SHA-256(token)`. Màn hình sau khi tạo có **Sao chép link**, **mã QR**, **Gửi qua email**. |
| Xác nhận (`/xac-nhan/:token`) | Mobile-first. Người nhận tích “Tôi đã kiểm tra…”, **ký tên** (chuột / cảm ứng / bút), hoặc **yêu cầu chỉnh sửa** (bắt buộc nhập lý do). Không ký lại được biên bản đã xác nhận. Tải PDF sau khi xác nhận. |
| Chữ ký & PDF | Chữ ký PNG (cắt sát, ≤ 600×300) lưu Drive `DTA_HANDOVER/signatures/YYYY/MM`; PDF biên bản lưu `DTA_HANDOVER/pdf/YYYY/MM`. File **private**, chỉ tải qua API. |
| Quản trị (`/admin`) | Đăng nhập bằng mật khẩu (cookie HttpOnly). Thống kê theo trạng thái, bộ lọc (mã, tên/mã NV, người giao, người nhận, phòng ban, loại, trạng thái, khoảng ngày), chi tiết, copy/tạo lại link, xem chữ ký, tải/tạo lại PDF, sửa (khi *Chờ xác nhận* / *Yêu cầu chỉnh sửa*), hủy, lịch sử thao tác. |
| Dữ liệu cấu hình được | Nhân viên (`NHAN_VIEN`), loại bàn giao và form của từng loại (`LOAI_BAN_GIAO`), nội dung PDF (`CAU_HINH`) — sửa trực tiếp trong Google Sheet, **không cần build lại**. |

Trạng thái: `PENDING` (Chờ xác nhận) · `CONFIRMED` (Đã xác nhận) · `REVISION_REQUESTED` (Yêu cầu chỉnh sửa) · `CANCELLED` (Đã hủy).

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
   └──► Google Drive:  DTA_HANDOVER/signatures/YYYY/MM · pdf/YYYY/MM · backups
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
├── scripts/             gas-emulator (Apps Script giả lập CHỈ để test), e2e runner
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
| `ADMIN_PASSWORD` | ✔ | Mật khẩu trang `/admin` (nên ≥ 12 ký tự) |
| `SESSION_SECRET` | ✔ | Khóa ≥ 32 ký tự ký cookie phiên + sinh link xác nhận |
| `APP_BASE_URL` | – | URL gốc cho link xác nhận. Để trống = tự lấy domain đang truy cập |
| `STAFF_ACCESS_CODE` | – | Nếu đặt: trang tạo bàn giao yêu cầu nhập mã truy cập nội bộ (khuyến nghị cho production) |

Tạo chuỗi bí mật ngẫu nhiên:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Thử giao diện khi chưa có Google:** có thể chạy *Apps Script giả lập* (chỉ dùng để phát triển/kiểm thử,
dữ liệu nằm trong bộ nhớ và mất khi tắt — **không phải backend production**):

```bash
npm run gas:emulator     # in ra GAS_WEB_APP_URL=http://127.0.0.1:8790/macros/s/emulator/exec
```

Đặt `GAS_WEB_APP_URL` theo URL được in ra và `GAS_SHARED_SECRET` bằng giá trị trong `.dev.vars` (emulator đọc
secret từ `.dev.vars`), rồi `npm run dev` ở một terminal khác. Nhân viên mẫu có mã `DEMO-…`.

## 6. Tạo Google Sheet

1. Vào <https://sheets.new> (bằng tài khoản sẽ sở hữu dữ liệu), đặt tên ví dụ **DTA Handover – Database**.
2. Không cần tạo sheet/cột thủ công — `setupDatabase()` (mục 7) tự tạo:
   `NHAN_VIEN`, `BAN_GIAO`, `CHI_TIET_BAN_GIAO`, `LOAI_BAN_GIAO`, `LICH_SU`, `CAU_HINH`.
3. Chạy lại `setupDatabase()` bất cứ lúc nào cũng an toàn: chỉ bổ sung sheet/cột còn thiếu, **không xóa dữ liệu**.

Cấu trúc cột: [docs/DATABASE.md](docs/DATABASE.md).

## 7. Setup Apps Script

1. Trong Google Sheet: **Extensions → Apps Script** (script gắn với Sheet — khuyến nghị).
2. Dán code — chọn **một** trong hai cách:
   - **Nhanh (1 file):** `npm run gas:bundle` → mở `dist/apps-script/DTA_Handover.gs`, Ctrl+A, Ctrl+C → dán đè toàn bộ
     file `Code.gs`/`Mã.gs` mặc định trong editor → Lưu.
   - **Nhiều file:** tạo các file đúng tên và dán nội dung từ thư mục [`apps-script/`](apps-script/):
     `Code.gs`, `Config.gs`, `Setup.gs`, `Employees.gs`, `Handovers.gs`, `Drive.gs`, `Pdf.gs`, `Security.gs`, `Utils.gs`.
3. **Project Settings (⚙)** → bật *Show "appsscript.json" manifest file in editor* → mở `appsscript.json`, dán nội dung từ
   [`apps-script/appsscript.json`](apps-script/appsscript.json) (múi giờ `Asia/Ho_Chi_Minh`, runtime V8).
4. Tải lại Google Sheet (F5) → xuất hiện menu **DTA Handover**.
5. **DTA Handover → Thiết lập / cập nhật database** → cấp quyền khi Google hỏi (rồi bấm lại menu) → dán khóa kết nối
   (`BACKEND_SHARED_SECRET`, mục 11) khi được hỏi → hộp thoại hiện kết quả. (Cách khác: trong editor chọn hàm
   **`setupDatabase`** → **Run**, khóa đặt trong *Project Settings → Script properties*.)
6. (Tùy chọn) chạy **`seedSampleEmployees`** để có nhân viên mẫu `DEMO-…`; xóa bằng **`removeSampleEmployees`**.
7. Nhập danh sách nhân viên thật vào sheet `NHAN_VIEN` — xem [apps-script/sample-data/README.md](apps-script/sample-data/README.md).
8. Chạy **`checkSetup`** để kiểm tra (không in secret).

Có thể dùng [clasp](https://github.com/google/clasp) thay cho copy/paste — xem [apps-script/README.md](apps-script/README.md).
Hướng dẫn chi tiết từng bước: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## 8. Deploy Apps Script

1. **Deploy → New deployment** → biểu tượng ⚙ → **Web app**.
2. *Description*: `DTA Handover API v1`.
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
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put STAFF_ACCESS_CODE       # tùy chọn (khuyến nghị)
```

Nếu Worker chưa tồn tại, lệnh đầu tiên sẽ hỏi tạo Worker `dta-handover` — chọn **Yes**.
Secret được mã hóa trên Cloudflare, không nằm trong repo, không hiển thị cho trình duyệt. Xem/sửa: Dashboard →
*Workers & Pages → dta-handover → Settings → Variables and Secrets*.

`APP_BASE_URL` là biến thường trong `wrangler.jsonc` (`vars`), mặc định để trống (tự lấy domain).

## 13. Build

```bash
npm run typecheck     # TypeScript: frontend + Worker + test
npm run build         # tsc -b && vite build → dist/client (SPA) + dist/dta_handover (Worker + wrangler.json)
```

## 14. Preview

```bash
npm run preview       # chạy bản build production trong workerd: http://localhost:4173
```

Kiểm tra: `/`, `/xac-nhan/test`, `/admin` (refresh trực tiếp không 404) và `/api/health`.
Preview dùng `.dev.vars` giống `npm run dev`.

## 15. Deploy lên Cloudflare

**Cách 1 — tự động từ GitHub (khuyến nghị):** kết nối repo trong Cloudflare Dashboard (*Workers & Pages → Create →
Import a repository*), project name `dta-handover`, build `npm run build`, deploy `npx wrangler deploy`, rồi thêm secrets
trong *Settings → Variables and Secrets*. Mỗi lần push `main` sẽ tự deploy — chi tiết
[docs/CLOUDFLARE_DEPLOY.md §9](docs/CLOUDFLARE_DEPLOY.md#9-deploy-tự-động-từ-github-workers-builds--khuyến-nghị).

**Cách 2 — từ máy local:**

```bash
npx wrangler login    # nếu chưa đăng nhập
npm run deploy        # = npm run build && wrangler deploy
```

Kết quả in ra URL dạng `https://dta-handover.<account-subdomain>.workers.dev`. Kiểm tra ngay:

```bash
curl https://dta-handover.<account-subdomain>.workers.dev/api/health
# {"success":true,"data":{"app":"dta-handover","cloudflare":"ok","appsScript":"ok","database":"ok","drive":"ok",…}}
```

Chi tiết (rollback, logs, CI): [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md).

## 16. Custom domain

Mục tiêu: `https://ban-giao.dieutuongam.com` (SSL do Cloudflare cấp tự động, không cần VPS/IP).
Điều kiện: zone `dieutuongam.com` đang dùng DNS của Cloudflare trong **cùng tài khoản**.

**Cách 1 — bằng cấu hình (khuyến nghị):** trong `wrangler.jsonc` bỏ comment dòng

```jsonc
"routes": [{ "pattern": "ban-giao.dieutuongam.com", "custom_domain": true }],
```

rồi `npm run deploy`. Cloudflare tự tạo bản ghi DNS và chứng chỉ SSL.

**Cách 2 — Dashboard:** *Workers & Pages → dta-handover → Settings → Domains & Routes → Add → Custom domain* →
nhập `ban-giao.dieutuongam.com`.

Sau khi domain hoạt động, có thể đặt `"APP_BASE_URL": "https://ban-giao.dieutuongam.com"` trong `wrangler.jsonc` (mục
`vars`) để mọi link xác nhận luôn dùng domain chính thức, rồi deploy lại. Nên bật *SSL/TLS → Edge Certificates →
Always Use HTTPS* cho zone.

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

Log: Cloudflare Dashboard → *Workers & Pages → dta-handover → Logs* (Worker tự ghi access log, đã che token);
Apps Script → *Executions*.

---

## Lệnh npm

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Dev server Vite + Worker (workerd) tại `http://localhost:5173` |
| `npm run typecheck` | Kiểm tra TypeScript toàn bộ (app, worker, test) |
| `npm run build` | Typecheck + build production |
| `npm run preview` | Chạy bản build production local tại `http://localhost:4173` |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm test` | Unit + integration test (Worker chạy thật trên Node, Apps Script chạy trong bộ giả lập) |
| `npm run test:e2e` | E2E: bản build trên workerd + Chrome/Edge thật (mobile/desktop, ký cảm ứng/chuột, admin, responsive) |
| `npm run gas:emulator` | Apps Script giả lập cho dev/test (không dùng cho production) |
| `npm run gas:bundle` | Gộp `apps-script/*.gs` thành 1 file `dist/apps-script/DTA_Handover.gs` để dán vào Apps Script editor |

## Kiểm thử

```bash
npm test            # 60 test: validation, crypto, session, router, toàn bộ API Worker ⇄ Apps Script (giả lập), bản gộp 1 file
npm run test:e2e    # 16 test trên trình duyệt thật — cần Chrome hoặc Edge
```

Danh sách ca kiểm thử và checklist nghiệm thu trên Google thật: [docs/TESTING.md](docs/TESTING.md).

## Vận hành hằng ngày

- **Thêm/sửa nhân viên:** sửa sheet `NHAN_VIEN` → *Làm mới dữ liệu NV*. Nhân viên nghỉ việc: `status = INACTIVE` (biên bản cũ giữ nguyên).
- **Thêm loại bàn giao:** thêm dòng vào `LOAI_BAN_GIAO` (`form_fields` theo hướng dẫn trong [docs/DATABASE.md](docs/DATABASE.md)).
- **Đổi mật khẩu admin:** `npx wrangler secret put ADMIN_PASSWORD` — mọi phiên admin cũ tự hết hiệu lực.
- **Đổi secret Apps Script:** đổi đồng thời `BACKEND_SHARED_SECRET` (Script Properties) và `GAS_SHARED_SECRET` (Cloudflare).
- **Không sửa tay** các cột hệ thống trong `BAN_GIAO` (`status`, `public_token_hash`, …) — dùng trang quản trị.

## Tài liệu chi tiết

| Tài liệu | Nội dung |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Luồng dữ liệu, giao thức Worker ⇄ Apps Script, token, cache, khóa, PDF |
| [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md) | Thiết lập Google Sheet, Apps Script, Drive, deploy Web App |
| [docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md) | Secrets, deploy, custom domain, logs, rollback, CI |
| [docs/DATABASE.md](docs/DATABASE.md) | Cấu trúc 6 sheet, cấu hình loại bàn giao, Drive |
| [docs/SECURITY.md](docs/SECURITY.md) | Mô hình bảo mật, secret, chống CSRF/XSS/injection, quyền riêng tư |
| [docs/TESTING.md](docs/TESTING.md) | Chiến lược kiểm thử, ca kiểm thử, checklist nghiệm thu |
| [docs/API.md](docs/API.md) | Danh sách API, định dạng response, mã lỗi |
| [apps-script/README.md](apps-script/README.md) | Các file `.gs`, hàm chạy thủ công, clasp |
