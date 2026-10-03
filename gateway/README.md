# Cổng Cloudflare Pages cho tên miền riêng

Dùng khi DNS của tên miền **không** nằm trên Cloudflare (ví dụ `dieutuongam.com` dùng nameserver `zonedns.vn`).
Cloudflare Workers chỉ nhận custom domain thuộc zone trên Cloudflare; Pages thì cho phép tên miền phụ trỏ CNAME từ DNS
bên ngoài. Dự án Pages này nhận `bangiao.dieutuongam.com` rồi chuyển **nguyên request** (tên miền, cookie, IP người dùng)
sang Worker `dta-bangiao` qua **Service Binding** — không đi ra internet, không cần secret riêng.

```text
Trình duyệt → bangiao.dieutuongam.com (CNAME → dta-bangiao-web.pages.dev)
           → Pages Functions (functions/[[path]].js) → Service Binding APP → Worker dta-bangiao
```

## Cấu hình dự án Pages `dta-bangiao-web`

| Mục (Settings) | Giá trị |
|---|---|
| Git repository | `itdieutuongam/dta-bangiao`, production branch `main` |
| Build command | *(để trống)* |
| Build output directory | `public` |
| Root directory | `gateway` |
| Bindings → Service binding | Variable name `APP` → Service `dta-bangiao` |
| Custom domains | `bangiao.dieutuongam.com` (CNAME `bangiao` → `dta-bangiao-web.pages.dev` tại nhà cung cấp DNS) |

Binding cũng được khai báo trong `wrangler.toml`; nếu Cloudflare không áp dụng file này thì thêm thủ công trong
*Settings → Bindings*, rồi **Retry deployment** (binding chỉ có hiệu lực ở bản deploy mới).

Kiểm tra: `https://dta-bangiao-web.pages.dev/api/health` phải trả `"appsScript":"ok"`. Nếu trả
*"Cấu hình thiếu Service Binding APP"* → binding chưa có hoặc chưa deploy lại.
