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
6. **Đưa module Đồng phục vào dùng** ([DONG_PHUC.md §6](DONG_PHUC.md#6-đưa-vào-sử-dụng-lần-đầu)): nhập tồn đầu kỳ theo size (file Excel VPP
   đang ghi: Áo Công Trình 29, Áo KD XL 16, Áo KD XXL 9, ÁO NAM 14, Áo tái sử dụng 35 — chọn đúng mẫu / size / tình trạng), điền giới tính /
   size nhân viên, chuyển **Áo bảo hộ** từ văn phòng phẩm sang đồng phục, (tùy chọn) tiêu chuẩn theo nhóm.
7. **Quyền sở hữu & sao lưu**: thực hiện kế hoạch ở [BAN_GIAO_HE_THONG.md](BAN_GIAO_HE_THONG.md) (chuyển dữ liệu khỏi tài khoản cá nhân,
   lưu secret vào kho mật khẩu công ty, kiểm tra khôi phục).

## 4. Quay lui (nếu cần)

- **Worker**: Cloudflare → *Workers & Pages → dta-bangiao → Deployments* → chọn bản v2.0 → *Rollback*.
- **Apps Script**: *Quản lý tùy chọn triển khai → Sửa → Phiên bản* chọn version v2.0 cũ → *Triển khai*. Cấu trúc v3 chỉ thêm sheet /
  cột nên bản v2.0 vẫn chạy; phiếu đồng phục đã tạo vẫn nằm nguyên trong Sheet (bản cũ không có giao diện đồng phục).
- Quay lui Apps Script thì quay lui cả Worker (Worker v2.1 cần Apps Script v2.1).
- Không cần khôi phục bản sao lưu Sheet trừ khi dữ liệu bị hỏng.
