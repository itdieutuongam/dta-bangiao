# Nâng cấp v2.0 → v2.1 (module Đồng phục + sửa lỗi audit)

Dành cho người vận hành hệ thống (chủ Google Sheet / Apps Script và người có quyền Cloudflare). Thời gian: ~20 phút, nên làm
ngoài giờ. **Thứ tự quan trọng: Apps Script trước, Worker sau** — Worker v2.1 gọi các thao tác đồng phục mà Apps Script v2.0 chưa
có (báo `UPSTREAM_OUTDATED`); ngược lại Apps Script v2.1 vẫn phục vụ đúng Worker v2.0 trong lúc chờ.

v2.1 thêm: module Đồng phục ([DONG_PHUC.md](DONG_PHUC.md)), cấu trúc dữ liệu v3 (6 sheet `DP_*`, cột mới), sửa các lỗi trong
[AUDIT_V2.1.md](AUDIT_V2.1.md) (bộ lọc mật khẩu, niêm phong, cột định danh bị đổi tên / trống, tiêu đề trùng, phiên đăng nhập hết hạn…).
Không xóa / ghi đè dữ liệu cũ; phiếu đang chờ ký vẫn dùng link cũ.

## 0. Chuẩn bị (máy có repo)

```bash
git checkout <nhánh chứa v2.1> && npm ci
npm run verify            # typecheck + lint + toàn bộ test (271 test ở v2.1) — phải xanh
npm run gas:bundle        # → dist/apps-script/DTA_Handover.gs (1 file, gồm Uniform.gs / UniformSetup.gs)
```

## 1. Apps Script

1. Google Sheet → menu **DTA Handover → Sao lưu ngay** (bước 3 cũng tự sao lưu trước khi đổi cấu trúc).
2. *Tiện ích mở rộng → Apps Script*: dán **toàn bộ** `dist/apps-script/DTA_Handover.gs` đè lên file code hiện có → **Lưu**.
   Dự án đang dùng nhiều file `.gs` (clasp): cập nhật mọi file và **thêm** `VppVouchers.gs`, `VppImport.gs`, `Uniform.gs`,
   `UniformSetup.gs` — hoặc đơn giản hơn: xóa các file `.gs` của DTA Handover (Config.gs, Code.gs, Vpp.gs…) và chỉ giữ một file
   chứa bản gộp (không đụng `appsscript.json` — v2.1 không đổi manifest).
   Web App lúc này **vẫn chạy phiên bản cũ** (deployment gắn với version) — người dùng không bị gián đoạn.
3. Mở lại Google Sheet (F5) → menu **DTA Handover → Kiểm tra cấu hình**; cấp quyền nếu Google hỏi. Dòng đầu phải là
   “✓ Code Apps Script đầy đủ, một phiên bản (v2.1.0)”; dòng cấu trúc báo cần nâng cấp v3 là bình thường.
4. Menu **DTA Handover → Nâng cấp module Đồng phục (v3)**. Hộp thoại kết quả liệt kê:
   - sao lưu tự động, các sheet `DP_MAU`, `DP_BIEN_THE`, `DP_TON_KHO`, `DP_BIEN_DONG_KHO`, `DP_DINH_MUC`, `DP_THU_HOI`, `VPP_PHIEU_KHO`
     (phiếu nhập / xuất kho VPP) + cột `voucher_id`, `unit_price`, `department` của `VPP_BIEN_DONG_KHO`;
   - cột mới `NHAN_VIEN.gender`, `NHAN_VIEN.uniform_size`, `CHI_TIET_BAN_GIAO.size`, `CHI_TIET_BAN_GIAO.issue_kind`;
   - loại nội dung `DONG_PHUC`, cấu hình `PDF_TITLE_DP`, `DP_TIEU_CHUAN_NAM = 3`;
   - **sửa sự cố `VPP_DINH_MUC`**: chép mã định danh từ cột “m” sang cột `norm_id` (định mức VPP hiện lại). Cột “m” được giữ
     nguyên — xóa tay sau khi kiểm tra ở bước 5 (tùy chọn);
   - `SCHEMA_VERSION = 3`.

   Chạy lại nhiều lần vẫn an toàn. Phiên bản Web App cũ (v2.0) vẫn chạy đúng với cấu trúc v3 (chỉ thêm, không đổi).
5. *Triển khai → Quản lý tùy chọn triển khai → Sửa (bút chì) → Phiên bản: **Phiên bản mới** → Triển khai* (giữ nguyên URL).
6. Menu **Khởi tạo danh mục đồng phục** (7 mẫu) → menu **Khóa sheet hệ thống** (khóa thêm `VPP_PHIEU_KHO`, `DP_BIEN_THE`, `DP_TON_KHO`,
   `DP_BIEN_DONG_KHO`, `DP_THU_HOI`) → **Kiểm tra cấu hình**: mọi dòng ✓, trừ cảnh báo độ phủ email (xem §3 mục 2) và dòng ✗ chia sẻ
   Sheet nếu chưa khóa (§3 mục 0).

## 2. Cloudflare Worker

- Không có secret bắt buộc mới. **Giữ nguyên `RECORD_SEAL_SECRET`** (đổi = mọi biên bản đã niêm phong báo không khớp).
- Biến tùy chọn mới `SEAL_LEGACY_IDS`: chỉ cần khi có biên bản ký **trước** lúc đặt `RECORD_SEAL_SECRET`. Dữ liệu thật (16/11/2026):
  mọi biên bản có mã nội dung đều đã niêm phong → **không cần đặt**. Nếu sau nâng cấp trang chi tiết một biên bản báo
  “Niêm phong: BỊ XÓA” thì đó là dấu hiệu dữ liệu bị sửa trên Sheet — kiểm tra lịch sử phiên bản Sheet trước khi nghĩ tới biến này.
- Deploy: merge vào nhánh mà Cloudflare Workers Builds đang theo dõi (xem *Workers & Pages → dta-bangiao → Settings → Build*),
  hoặc chạy `npm run deploy` từ máy có quyền.

Kiểm tra sau deploy:

```bash
curl -s https://bangiao.dieutuongam.com/api/health
# {"success":true,"data":{"app":"dta-handover","version":"2.1.0","cloudflare":"ok","appsScript":"ok","database":"ok","drive":"ok",…}}
```

Trên `/admin`: menu có nhóm **Đồng phục**; *Cài đặt* không còn mục “cần xử lý” ngoài cảnh báo email; *Văn phòng phẩm → Định mức*
hiện lại đủ định mức.

## 3. Việc vận hành ngay sau nâng cấp (dữ liệu thật)

Theo thứ tự ưu tiên — chi tiết lý do trong [AUDIT_V2.1.md](AUDIT_V2.1.md).

0. **Khóa chia sẻ Google Sheet dữ liệu** (SEC-0): *Chia sẻ → Quyền truy cập chung → “Bị hạn chế”*; ai cần sửa trực tiếp thì thêm đích danh.
   Nếu trước đó Sheet để “Bất kỳ ai có đường liên kết – **Người chỉnh sửa**” (production 17/11/2026) thì **đổi khóa kết nối**: menu
   *Nhập / đổi khóa kết nối (BACKEND_SHARED_SECRET)* với chuỗi ngẫu nhiên mới ≥ 32 ký tự, rồi ngay sau đó
   `npx wrangler secret put GAS_SHARED_SECRET` cùng giá trị (giữa hai bước, trang web báo lỗi kết nối vài chục giây). Xem *Lịch sử
   phiên bản* của Sheet và danh sách file trong Apps Script để phát hiện thay đổi lạ. *Kiểm tra cấu hình* hết dòng ✗ về chia sẻ là xong.
1. **Đổi ngay mật khẩu** của tài khoản được ghi trong mục *Tài khoản* của biên bản **BG-20261005-0001**. Biên bản đã ký không xóa
   được nội dung (và nội dung còn nằm trong PDF, bản sao lưu, lịch sử phiên bản Sheet) — đổi mật khẩu là cách khắc phục duy nhất.
   Từ v2.1 hệ thống chặn dạng “email / mật khẩu” này ở mục Tài khoản.
2. **Email nhân viên → bật bắt buộc mã xác nhận**: hiện 0/47 nhân viên có email nên ai cầm link cũng ký được (trang *Tổng quan* và
   *Cài đặt* hiện cảnh báo “n/N nhân viên đang làm chưa có email”). Điền email công ty vào cột `NHAN_VIEN.email` → *Làm mới dữ liệu*
   → khi cảnh báo hết, đặt `CAU_HINH.CONFIRM_OTP = REQUIRED`. **Không đặt REQUIRED trước khi đủ email** (người chưa có email sẽ không
   ký được).
3. **Gắn phòng ban → phạm vi định mức VPP** (*Văn phòng phẩm → Định mức*): hiện không phòng ban nào khớp nên định mức không áp dụng
   cho ai. Phòng ban không dùng định mức chọn “Không áp dụng”.
4. **Rà phiếu văn phòng phẩm** tạo trong thời gian sự cố `norm_id` (từ lúc tiêu đề A1 của `VPP_DINH_MUC` bị gõ đè đến khi nâng cấp):
   các phiếu này không được kiểm tra định mức — xem lại số lượng vượt định mức.
5. **Cập nhật danh mục + tồn kho VPP từ file Excel theo dõi** (*Văn phòng phẩm → Tồn kho → Cập nhật từ Excel*, chọn
   `Mau_theo_doi_VPP.xlsx`) — [VAN_PHONG_PHAM.md §5d](VAN_PHONG_PHAM.md#5d-cập-nhật-danh-mục--tồn-kho-từ-excel-adminvppnhap-excel-v21).
   Với file 17/11/2026: 484 mặt hàng VPP (23 mặt hàng còn tồn), 6 dòng áo tách sang đồng phục, 5 mã trùng / không hợp lệ được cấp mã mới,
   1 dòng trùng tên bị bỏ (“Hộp dấu nhựa Shiny SP.01 (nhựa), xanh” dòng 373 — kiểm tra lại màu). Ở bước xem trước, chọn **“Cập nhật …”**
   cho các dòng được gợi ý trùng với sản phẩm cũ đang có định mức; sau khi áp dụng, ghép phần còn lại ở *Dữ liệu cần kiểm tra*.
   Từ nay nhập / xuất hằng ngày làm ở *Nhập kho* / *Xuất kho* thay cho sheet “Nhap VPP” / “Xuat VPP”.
6. **Đưa module Đồng phục vào dùng** ([DONG_PHUC.md §6](DONG_PHUC.md#6-đưa-vào-sử-dụng-lần-đầu)) — đồng phục **chỉ** quản lý ở module
   này; các mã áo cũ trong VPP đã kiểm kê về 0 và ngừng dùng (17/11/2026). Trang *Tồn kho & mẫu* → *Nhập kho* → lý do **Tồn đầu kỳ**
   theo từng mẫu / size / tình trạng (file Excel 17/11 ghi: Áo Công Trình 29, Áo KD XL 16, Áo KD XXL 9, Áo KD L 0, ÁO NAM 14, Áo tái
   sử dụng 35 — tạo mẫu còn thiếu bằng *Thêm mẫu*; “tái sử dụng” = tình trạng *Đã qua sử dụng*); lần sau mua thêm chọn **Nhập bổ sung**.
   Điền giới tính / size nhân viên, (tùy chọn) tiêu chuẩn theo nhóm.
7. **Quyền sở hữu & sao lưu**: thực hiện kế hoạch ở [BAN_GIAO_HE_THONG.md](BAN_GIAO_HE_THONG.md) (chuyển dữ liệu khỏi tài khoản cá nhân,
   lưu secret vào kho mật khẩu công ty, kiểm tra khôi phục).

## 4. Quay lui (nếu cần)

- **Worker**: Cloudflare → *Workers & Pages → dta-bangiao → Deployments* → chọn bản v2.0 → *Rollback*.
- **Apps Script**: *Quản lý tùy chọn triển khai → Sửa → Phiên bản* chọn version v2.0 cũ → *Triển khai*. Cấu trúc v3 chỉ thêm sheet /
  cột nên bản v2.0 vẫn chạy; phiếu đồng phục đã tạo vẫn nằm nguyên trong Sheet (bản cũ không có giao diện đồng phục).
- Quay lui Apps Script thì quay lui cả Worker (Worker v2.1 cần Apps Script v2.1).
- Không cần khôi phục bản sao lưu Sheet trừ khi dữ liệu bị hỏng.

## 5. Nhật ký triển khai production — 17/11/2026

| Giờ | Việc | Kết quả |
|---|---|---|
| 13:09 | Sheet → *Sao lưu ngay* | Bản sao “… – backup 2026-11-17 1309” trong `DTA_HANDOVER/backups` |
| 13:25 | Khóa chia sẻ Sheet (SEC-0): “Bất kỳ ai có đường liên kết – Người chỉnh sửa” → **Hạn chế** | Chỉ còn chủ sở hữu; Web App vẫn chạy (chạy bằng tài khoản chủ) |
| 13:28 | Dán bản gộp v2.1.0 (12.581 dòng) đè `Mã.gs` của dự án Apps Script gắn với Sheet | *Kiểm tra cấu hình*: ✓ Code v2.1.0 |
| 13:30 | *Nâng cấp module Đồng phục (v3)* | Sao lưu tự động “… backup trước nâng cấp v3 2026-11-17 1330”; 7 sheet mới, cột mới, sửa `norm_id` (30 định mức hiện lại), `SCHEMA_VERSION = 3` |
| 13:34 | Web App: cập nhật bản triển khai đang hoạt động → **Phiên bản 3** (giữ URL) | Worker v2.0 vẫn chạy bình thường với Apps Script v2.1 |
| 13:35 | *Khởi tạo danh mục đồng phục* (7 mẫu, 35 mặt hàng mẫu × size) → *Khóa sheet hệ thống* (12 sheet) → *Kiểm tra cấu hình* | “Cấu hình hợp lệ” (còn cảnh báo email nhân viên) |
| 13:38 | Worker v2.1.0 (`npm run deploy`, 271 test) | Phiên bản Worker `3da5b300…`; `/api/health` = 2.1.0, mọi thành phần ok |
| 13:39 | Đổi khóa kết nối: menu *Nhập / đổi khóa kết nối* + `wrangler secret put GAS_SHARED_SECRET` (lệch ~1 giây) | Health ok với khóa mới |
| 13:59 | Cập nhật VPP từ `Mau_theo_doi_VPP.xlsx` (ghép tay 2 dòng có định mức: nước rửa chén 3.6kg, nước lau kiếng) | Thêm 467, cập nhật 17, đặt tồn 23; xem trước lại = 0 thay đổi |
| 14:02 | Worker sửa lỗi phát hiện khi kiểm tra production (tràn ngang danh sách biên bản, chữ cũ trang Cài đặt) | Phiên bản Worker `49a29fbd…`; quét 21 trang quản trị: không lỗi console / API, không tràn ngang |
| 14:24 | **Thống nhất đồng phục một nơi**: 4 mã áo trong VPP (Áo bảo hộ - DTA 29, Áo thun DTA 2XL 9 / L 0 / XL 17) kiểm kê về 0 + ngừng dùng | Số cũ ghi trong lý do kiểm kê; VPP còn 0 mã áo đang dùng |
| 14:29 | Apps Script **Phiên bản 4**: số cộng dồn Tồn đầu kỳ / Đã bàn giao, chặn “Áo …” trong VPP | *Kiểm tra cấu hình* hợp lệ; health ok |
| 14:33 | Worker: trang Tồn kho & mẫu mới (Tồn đầu kỳ / Đã bàn giao / Khả dụng) | Phiên bản Worker `e7729847…` |
| 15:0x | **Tồn đầu kỳ đồng phục** theo file 17/11 (đã xác nhận): đổi tên mẫu Áo bảo hộ → **Áo Công Trình** (FREE 29); tạo **Áo KD** (L 0 · XL 16 · XXL 9), **Áo nam** (FREE 14), **Áo tái sử dụng** (FREE, đã qua sử dụng 35); 6 mẫu theo danh sách chính sách chưa từng có hàng → ngừng dùng | Tồn đầu kỳ 103 · đã bàn giao 0 · khả dụng 103 |
| 15:30 | Apps Script **Phiên bản 5** + Worker: chỉ cảnh báo hết hàng mới ở mẫu từng có hàng mới (mẫu chỉ có hàng đã qua sử dụng không báo) | Cảnh báo còn đúng 1: Áo KD · L |
| 15:45 | Worker: logo chính thức Diệu Tướng Am (từ dieutuongam.com) | Phiên bản Worker `8b7117bc…` |
| 17:04 | Apps Script **Phiên bản 6** + Worker `be7a8ed5…`: nhóm định mức VPP mặc định; gắn 8 phòng ban (Showroom HCM / HN, Hỗ trợ - Giao nhận → Phòng kinh doanh; Kế toán - HCNS, MKT, Thiết kế - QLDA, Thu mua → Văn phòng), mặc định = Văn phòng | 47/47 nhân viên có định mức; 0 phòng ban chưa gắn |

Quay lui: Worker về bản trước (`2ae7ceed…` = v2.0, `3da5b300…` = v2.1 trước sửa giao diện, `49a29fbd…` = trước thống nhất đồng
phục) ở *Deployments*; Apps Script chọn **Phiên bản 2** (v2.0) hoặc **3** (v2.1 trước thống nhất đồng phục) trong *Quản lý các bản
triển khai*. Khóa kết nối đã đổi nằm ở Script Properties + Cloudflare (không lưu trong repo).
