# Deploy lên Cloudflare Workers

Một Worker tên **`dta-bangiao`** phục vụ cả giao diện (Workers Static Assets) và API `/api/*`.
Không cần VPS, không cần IP, SSL do Cloudflare cấp.

## 0. Chuẩn bị

- Đã hoàn tất [GOOGLE_SETUP.md](GOOGLE_SETUP.md) và có: **Web App URL** (`…/exec`) và **BACKEND_SHARED_SECRET**.
- Node.js ≥ 22.12 (khuyến nghị 24 LTS), đã chạy `npm install`.
- Tài khoản Cloudflare (gói Free đủ dùng).

Tạo các chuỗi bí mật mới (mỗi lệnh một giá trị khác nhau):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"   # mật khẩu cho từng tài khoản quản trị
```

Lưu các giá trị vào trình quản lý mật khẩu của công ty.

> **Nâng cấp từ v1:** cập nhật code Apps Script + chạy *Nâng cấp module Văn phòng phẩm (v2)* **trước** khi deploy Worker v2
> (Worker v2 cần cấu trúc dữ liệu v2) — thứ tự đầy đủ: [README §19](../README.md#19-nâng-cấp-từ-v1-lên-v2).

## 1. Đăng nhập

```bash
npx wrangler login        # mở trình duyệt, cấp quyền cho Wrangler
npx wrangler whoami       # kiểm tra tài khoản / account ID
```

## 2. Đặt secrets

```bash
npx wrangler secret put GAS_WEB_APP_URL      # https://script.google.com/macros/s/…/exec
npx wrangler secret put GAS_SHARED_SECRET    # GIỐNG HỆT BACKEND_SHARED_SECRET bên Apps Script
npx wrangler secret put ADMIN_USERS          # khuyến nghị — tài khoản riêng từng người (JSON, xem bên dưới)
npx wrangler secret put ADMIN_PASSWORD       # hoặc: một mật khẩu chung (bản cũ) — chỉ dùng khi không có ADMIN_USERS
npx wrangler secret put SESSION_SECRET       # ≥ 32 ký tự ngẫu nhiên
npx wrangler secret put STAFF_ACCESS_CODE    # (khuyến nghị) mã truy cập nội bộ cho trang /de-xuat-vpp
npx wrangler secret put RECORD_SEAL_SECRET   # (khuyến nghị) niêm phong biên bản đã ký — ≥ 32 ký tự, KHÔNG đổi sau khi dùng
```

`ADMIN_USERS` — một dòng JSON, mật khẩu ≥ 12 ký tự, username chỉ gồm `a-z 0-9 . _ -`:

```json
[{"username":"thai","name":"Phạm Danh Thái","password":"<mật khẩu riêng>"},{"username":"huong","name":"Đỗ Thị Hương","password":"<mật khẩu riêng>"}]
```

Cấu hình sai (JSON lỗi, mật khẩu ngắn, username trùng) → không ai đăng nhập được và `/api/health` báo `configured.admin: false`.

- Mỗi lệnh hỏi giá trị (dán rồi Enter). Lần đầu, Wrangler hỏi tạo Worker `dta-bangiao` chưa tồn tại → **Yes**.
- Kiểm tra danh sách: `npx wrangler secret list` (chỉ hiện tên, không hiện giá trị).
- Secret không nằm trong repo và không bao giờ được gửi xuống trình duyệt.

| Biến | Loại | Ghi chú |
|---|---|---|
| `GAS_WEB_APP_URL` | secret | bắt buộc |
| `GAS_SHARED_SECRET` | secret | bắt buộc |
| `ADMIN_USERS` | secret | khuyến nghị — tài khoản quản trị riêng từng người (nhật ký ghi đúng người) |
| `ADMIN_PASSWORD` | secret | tương thích bản cũ — cần `ADMIN_USERS` **hoặc** `ADMIN_PASSWORD` |
| `SESSION_SECRET` | secret | bắt buộc (phiên admin + sinh link) |
| `STAFF_ACCESS_CODE` | secret | khuyến nghị — yêu cầu mã truy cập cho trang đề xuất văn phòng phẩm `/de-xuat-vpp` |
| `RECORD_SEAL_SECRET` | secret | khuyến nghị — niêm phong biên bản đã ký (Apps Script nhận khóa dẫn xuất theo từng request, không lưu ở Google). Đổi / mất secret → niêm phong các biên bản đã ký trước đó báo "không khớp" — lưu giữ như mật khẩu quản trị |
| `APP_BASE_URL` | var (`wrangler.jsonc`) | hiện là `https://bangiao.dieutuongam.com`; để trống = tự lấy domain đang truy cập |

## 3. Deploy

```bash
npm run deploy:dry-run    # verify (typecheck + lint + test) + build + wrangler deploy --dry-run — KHÔNG thay production
npm run deploy            # = npm run verify && npm run build && wrangler deploy
```

Output có dạng:

```text
Uploaded dta-bangiao
Deployed dta-bangiao triggers
  https://dta-bangiao.<account-subdomain>.workers.dev
```

`wrangler deploy` dùng cấu hình đã được Vite plugin chuyển hướng tới `dist/dta_bangiao/wrangler.json`
(Worker + thư mục assets `dist/client`).

## 4. Kiểm tra sau deploy

```bash
curl https://dta-bangiao.<account-subdomain>.workers.dev/api/health
```

Kết quả mong đợi (HTTP 200):

```json
{"success":true,"data":{"app":"dta-handover","version":"2.0.0","cloudflare":"ok","appsScript":"ok","database":"ok","drive":"ok",
"configured":{"appsScript":true,"session":true,"admin":true},"time":"…"},"error":null}
```

HTTP 503 kèm `data` cho biết thành phần chưa sẵn sàng (xem *Xử lý sự cố* trong README). Chi tiết cấu hình (đăng nhập riêng
từng người, mã truy cập, phiên bản / cấu trúc dữ liệu Apps Script) xem ở `/admin/cai-dat` sau khi đăng nhập.

Kiểm tra thủ công: đăng nhập `/admin` → *Tạo phiếu* với nhân viên mẫu, mở link xác nhận trên điện thoại và ký, tải PDF;
*Văn phòng phẩm* → nhập kho / phiếu VPP; `/de-xuat-vpp` gửi thử đề xuất. Checklist đầy đủ:
[TESTING.md](TESTING.md#5-checklist-nghiệm-thu-trên-google--cloudflare-thật).

## 5. Custom domain (ví dụ `bangiao.dieutuongam.com`)

> **Không** tạo CNAME từ DNS bên ngoài trỏ thẳng tới `…workers.dev` — Cloudflare Workers chỉ nhận tên miền thuộc zone
> nằm trên Cloudflare; CNAME như vậy sẽ lỗi SSL (`ERR_SSL_PROTOCOL_ERROR` / handshake failed).

### 5a. DNS của tên miền đang ở nhà cung cấp khác (ví dụ zonedns.vn) — dùng cổng Pages

Thư mục [`gateway/`](../gateway/) là một dự án **Cloudflare Pages** rất nhỏ: nhận tên miền phụ (Pages cho phép CNAME từ DNS
bên ngoài) rồi chuyển nguyên request vào Worker `dta-bangiao` qua **Service Binding** (nội bộ Cloudflare, giữ tên miền,
cookie, IP người dùng).

1. *Workers & Pages → Create → Pages → Import an existing Git repository* → chọn repo `dta-bangiao`.
2. Cấu hình: **Project name** `dta-bangiao-web` · **Framework preset** None · **Build command** (để trống) ·
   **Build output directory** `public` · **Root directory (Advanced)** `gateway` → *Save and Deploy*.
   Service Binding `APP → dta-bangiao` được khai báo sẵn trong `gateway/wrangler.toml`; nếu
   `https://<tên-dự-án>.pages.dev/api/health` báo thiếu binding thì thêm ở *Settings → Bindings → Service binding*
   rồi *Retry deployment*.
3. Dự án `dta-bangiao-web` → *Custom domains → Set up a custom domain* → `bangiao.dieutuongam.com` → chọn
   **My DNS provider** (*Begin CNAME setup*; **không** chọn *Begin DNS transfer*): tại nhà cung cấp DNS, đặt CNAME
   `bangiao` → `<tên-dự-án>.pages.dev` (thay cho `…workers.dev`) → bấm *Check DNS records*.
4. Chờ trạng thái **Active** (SSL tự cấp, thường 5–15 phút) → mở `https://bangiao.dieutuongam.com/api/health`.
5. Đặt `"APP_BASE_URL": "https://bangiao.dieutuongam.com"` trong `wrangler.jsonc` rồi push để mọi link xác nhận dùng
   tên miền chính thức (production đã đặt).

Secrets vẫn chỉ đặt ở Worker `dta-bangiao`; dự án Pages không cần secret.

### 5b. DNS của tên miền nằm trên Cloudflare — gắn trực tiếp vào Worker

Điều kiện: zone `dieutuongam.com` đã được thêm vào **cùng tài khoản Cloudflare** và dùng nameserver của Cloudflare.

**Cách 1 — trong `wrangler.jsonc` (được version control):**

```jsonc
// bỏ comment dòng này:
"routes": [{ "pattern": "bangiao.dieutuongam.com", "custom_domain": true }],
```

```bash
npm run deploy
```

**Cách 2 — Dashboard:** *Workers & Pages → dta-bangiao → Settings → Domains & Routes → Add → Custom domain*
→ `bangiao.dieutuongam.com` → *Add domain*.

(Nếu tên miền đang gắn vào dự án Pages ở §5a, gỡ khỏi dự án Pages trước.)

Cloudflare tự tạo bản ghi DNS và chứng chỉ SSL (thường vài phút). Không cần bản ghi A/IP thủ công.

Sau đó (khuyến nghị):

1. Đặt link chính thức cho mọi biên bản: trong `wrangler.jsonc`
   ```jsonc
   "vars": { "APP_BASE_URL": "https://bangiao.dieutuongam.com" }
   ```
   rồi `npm run deploy`.
2. Zone `dieutuongam.com` → *SSL/TLS → Edge Certificates → Always Use HTTPS: On*.
3. (Tùy chọn) tắt `workers.dev`: `"workers_dev": false` khi đã dùng custom domain ổn định.

## 6. Giới hạn tần suất (Rate Limiting)

`wrangler.jsonc` khai báo 3 binding (theo IP, chu kỳ 60 giây):

| Binding | Giới hạn | Dùng cho |
|---|---|---|
| `RL_PUBLIC` | 120 / phút | đọc: health, danh mục VPP công khai, xem biên bản |
| `RL_WRITE` | 20 / phút / loại thao tác | tạo phiếu, xác nhận, yêu cầu chỉnh sửa, tải PDF, tra mã NV, gửi đề xuất |
| `RL_AUTH` | 10 / phút | đăng nhập admin (thêm giới hạn theo username), nhập mã truy cập |

`namespace_id` (7301–7303) là số tùy chọn, duy nhất trong tài khoản. Nếu tài khoản báo lỗi với khối `ratelimits`,
có thể xóa khối này — Worker tự chuyển sang bộ đếm dự phòng trong bộ nhớ. Apps Script còn một lớp giới hạn riêng
(theo token / nhân viên / IP đã hash) chống dò link, dò mã nhân viên và spam — ngưỡng theo IP đặt rộng vì cả văn phòng
thường dùng chung một IP (NAT).

## 7. Logs & giám sát

- Dashboard → *Workers & Pages → dta-bangiao → Logs* (Workers Logs đã bật trong `wrangler.jsonc`).
  Invocation log mặc định **bị tắt** vì chứa nguyên URL (có token); Worker tự ghi access log JSON với token đã che
  (`/api/handover/AbCdEf…`), mã lỗi, thời gian xử lý và `requestId` (trùng header `X-Request-Id` trả về trình duyệt).
- Xem log trực tiếp: `npx wrangler tail`.
- Giám sát uptime: gọi `GET /api/health` mỗi 5 phút (HTTP 200 = khỏe, 503 = có thành phần lỗi). Kết quả được cache 15 giây.

## 8. Cập nhật & rollback

```bash
git pull && npm ci && npm run deploy                        # cập nhật (deploy tự chạy typecheck + lint + test trước)
npx wrangler deployments list                               # lịch sử phiên bản
npx wrangler rollback                                       # quay về phiên bản trước
```

> Rollback Worker về v1 sau khi dữ liệu đã nâng cấp v2 **không** làm hỏng dữ liệu (v2 chỉ thêm cột / sheet), nhưng Worker v1
> gọi các action cũ mà Apps Script v2 không còn → cần rollback cả code Apps Script (*Manage deployments → Edit → chọn version cũ*).

Đổi secret không cần deploy lại: `npx wrangler secret put <TÊN>` có hiệu lực ngay cho request mới.

## 9. Deploy tự động từ GitHub (Workers Builds) — khuyến nghị

Cloudflare tự build và deploy mỗi khi push lên nhánh `main`, không cần chạy lệnh trên máy.

1. Cloudflare Dashboard → **Workers & Pages → Create application → Import a repository** (*Continue with GitHub*) →
   cài/ủy quyền ứng dụng **Cloudflare Workers and Pages** cho repo (ví dụ `itdieutuongam/dta-bangiao`) → chọn repo.
2. Cấu hình build:

   | Mục | Giá trị |
   |---|---|
   | Project name | **`dta-bangiao`** — phải trùng `name` trong `wrangler.jsonc` |
   | Build command | **`npm run verify && npm run build`** — typecheck + lint + toàn bộ test; lỗi thì dừng, **không deploy** |
   | Deploy command | `npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` (mặc định) |
   | Path / Root directory | `/` |
   | Build variables (Advanced) | `NODE_VERSION` = `24` (repo đã có file `.node-version`; thêm biến này nếu build dùng Node cũ) |

3. **Save and Deploy**. Lần đầu Worker chạy được nhưng `/api/health` báo `not_configured` (chưa có secret).
4. **Settings → Variables and Secrets → Add** (Type: **Secret**): `GAS_WEB_APP_URL`, `GAS_SHARED_SECRET`, `ADMIN_USERS`
   (hoặc `ADMIN_PASSWORD`), `SESSION_SECRET`, `STAFF_ACCESS_CODE` → **Deploy**. Secret không bị ghi đè khi build lại.
5. Mở `https://dta-bangiao.<account-subdomain>.workers.dev/api/health` → phải trả `"appsScript":"ok"`.

Lưu ý: biến thường (Text) đặt trong Dashboard sẽ bị `vars` của `wrangler.jsonc` ghi đè ở lần deploy sau — muốn đặt
`APP_BASE_URL` thì sửa trong `wrangler.jsonc` rồi push. Xem log build: *Worker → Deployments → View build*.

## 9b. CI/CD bằng GitHub Actions

Repo đã có [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — **chỉ kiểm tra**, không deploy: typecheck, test, build,
`wrangler deploy --dry-run`, bản gộp Apps Script, và E2E (workerd + Chrome của runner) cho mỗi push / pull request.
Không cần secret. Nên bật *Branch protection* cho `main` yêu cầu job CI đạt trước khi merge.

Muốn deploy bằng GitHub Actions thay cho Workers Builds: tạo API token Cloudflare (*My Profile → API Tokens → Edit Cloudflare
Workers* template), lưu vào GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, rồi thêm workflow:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Secrets của Worker (`GAS_WEB_APP_URL`…) vẫn đặt bằng `wrangler secret put` — deploy không ghi đè chúng.

## 10. (Tùy chọn) Bảo vệ thêm trang quản trị bằng Cloudflare Access

Ngoài mật khẩu admin, có thể đặt *Zero Trust → Access → Applications → Self-hosted* cho
`bangiao.dieutuongam.com/admin*` và `bangiao.dieutuongam.com/api/admin/*`, chỉ cho phép email `@dieutuongam.com`
(gói Free tối đa 50 người dùng). Không áp dụng cho `/xac-nhan/*`, `/api/handover/*` (người nhận ký qua link).
Điều kiện: zone `dieutuongam.com` phải nằm trên Cloudflare (hiện DNS ở zonedns.vn nên chưa dùng được cách này).

## 11. Chi phí tham khảo

Gói Workers Free: 100.000 request/ngày, đủ cho hệ thống nội bộ. Static assets không tính vào giới hạn request của Worker.
