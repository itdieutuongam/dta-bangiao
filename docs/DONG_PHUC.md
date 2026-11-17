# Module Đồng phục (DP) — v2.1

Quản lý **mẫu đồng phục → tồn kho theo size → cấp phát / cho mượn → người nhận ký → xuất kho → trả / thu hồi** trên cùng hệ
thống phiếu bàn giao (Cloudflare Worker → Apps Script → Google Sheets). Phiếu đồng phục là phiếu `BAN_GIAO` với
`handover_type = UNIFORM`; người nhận ký bằng đúng link xác nhận như mọi phiếu khác.

Mục tiêu so với cách làm cũ (ghi tay “Đồng phục” vào phiếu loại khác + file Excel “DS đồng phục”, “Danh sách mua đồng phục”):

- mỗi dòng phiếu là **mẫu + size + tình trạng (mới / đã qua sử dụng) + số lượng** chọn từ kho — không còn gõ tay;
- biết ngay **mỗi nhân viên đã nhận bao nhiêu áo trong năm** so với **tiêu chuẩn năm** (mặc định 3 áo / người / năm — Chính sách
  người lao động 19/08/2025, mục VII.2);
- **cho mượn có hạn trả** (sự kiện, người mới chưa may kịp…), quá hạn hiện trên menu;
- **thu hồi khi nghỉ việc / đổi size**, hàng nhận lại nhập kho dưới dạng “Đã qua sử dụng”;
- **dự trù đặt may** theo size từ phần tiêu chuẩn còn lại.

Mã nguồn: `apps-script/Uniform.gs` (nghiệp vụ), `apps-script/UniformSetup.gs` (nâng cấp cấu trúc, khởi tạo, sửa cột định danh),
`apps-script/Vpp.gs` (bộ máy sổ kho dùng chung VPP / đồng phục), `worker/api/uniform.ts`, `shared/uniform.ts`,
`src/pages/admin/uniform/*`, `src/components/uniform/*`. Test: `tests/gas-uniform.test.ts`, phần “Đồng phục” trong
`tests/worker-api.test.ts`.

## 1. Khái niệm

| Khái niệm | Sheet | Ý nghĩa |
|---|---|---|
| **Mẫu** | `DP_MAU` | Áo sơmi đỏ, Áo dài vàng, Áo thun cá sấu, Áo bảo hộ… Có mã (`DP-001`…), giới tính áp dụng (Nam / Nữ / Nam & nữ), loại (Đồng phục / Bảo hộ lao động / Khác), danh sách size, ĐVT, giá tham khảo, **có tính vào tiêu chuẩn năm hay không**, tồn tối thiểu mỗi size, đối tượng sử dụng. |
| **Mặt hàng (SKU)** | `DP_BIEN_THE` | Mẫu × size × tình trạng (`NEW` Mới / `USED` Đã qua sử dụng). Kho, giữ chỗ, xuất kho đều tính theo mặt hàng. Mã hàng: `DP-001-L`, hàng đã qua sử dụng thêm `-CU`. Hệ thống tự tạo mặt hàng khi tạo / sửa mẫu. |
| **Tồn kho** | `DP_TON_KHO` | `on_hand` (thực có), `reserved` (đang giữ chỗ cho phiếu chờ ký), khả dụng = `on_hand − reserved`. |
| **Sổ biến động** | `DP_BIEN_DONG_KHO` | Nhật ký bất biến — nguồn sự thật của tồn kho (xem §4). |
| **Tiêu chuẩn năm** | `DP_DINH_MUC` | Số áo mỗi người được **cấp phát** trong một năm theo nhóm (phạm vi), có thể riêng theo mẫu / giới tính. |
| **Trả / thu hồi** | `DP_THU_HOI` | Mỗi lần nhân viên trả lại / báo hư hỏng / mất một phần hoặc toàn bộ dòng đồ đã nhận. |
| Hồ sơ nhân viên | `NHAN_VIEN.gender`, `NHAN_VIEN.uniform_size` | Giới tính (`NAM` / `NỮ`) và size thường dùng — dùng để chọn sẵn mẫu / size và dự trù đặt may. Điền thẳng trên Sheet hoặc ở trang *Cấp phát theo NV → Size*. |
| Dòng phiếu | `CHI_TIET_BAN_GIAO.size`, `.issue_kind` | Size và hình thức (`CAP_PHAT` Cấp phát / `CHO_MUON` Cho mượn) của dòng đồng phục; hạn trả lưu ở cột `deadline`. |

Danh mục khởi tạo (menu **DTA Handover → Khởi tạo danh mục đồng phục**, chạy lại không tạo trùng — theo danh sách đồng phục của HCNS):

| Mã | Mẫu | Giới tính | Đối tượng | Tính tiêu chuẩn |
|---|---|---|---|---|
| DP-001 | Áo sơmi đỏ | Nam | Nhân viên kinh doanh / showroom (nam) | Có |
| DP-002 | Áo sơmi vàng | Nam | Quản lý / giám đốc khối (nam) | Có |
| DP-003 | Áo dài vàng | Nữ | Nhân viên kinh doanh / showroom (nữ) | Có |
| DP-004 | Áo dài xanh | Nữ | Quản lý / giám đốc khối, trưởng nhóm (nữ) | Có |
| DP-005 | Áo thun cá sấu | Nam & nữ | Bộ phận Hỗ trợ – giao nhận, kỹ thuật, kho, tạp vụ | Có |
| DP-006 | Áo thun văn phòng | Nam & nữ | Khối văn phòng, Ban Tổng Giám đốc | Có |
| DP-007 | Áo bảo hộ | Nam & nữ | Hỗ trợ – giao nhận, kho (bảo hộ lao động) | **Không** |

Mọi mẫu khởi tạo có size S, M, L, XL, XXL (sửa được ở *Tồn kho & mẫu → Sửa mẫu*; không bỏ được size còn tồn / đang giữ chỗ).

## 2. Quy trình

### 2.1. Cấp phát / cho mượn

1. *Tạo phiếu → Đồng phục* (hoặc nút **Cấp** ở trang *Cấp phát theo NV* — người nhận được chọn sẵn).
2. Chọn người nhận → form hiện giới tính, size, nhóm tiêu chuẩn, **đã cấp / chờ ký / còn lại** trong năm.
3. Bấm vào **size** trên thẻ mẫu để thêm dòng (số dưới size = khả dụng hàng mới; “+n cũ” = hàng đã qua sử dụng). Mẫu gợi ý theo
   tiêu chuẩn của nhóm hiện trước; mẫu khác giới tính ẩn (tích “Hiện cả mẫu dành cho …” để xem).
4. Mỗi dòng: tình trạng, số lượng, **Cấp phát** hoặc **Cho mượn** (bắt buộc hạn trả, mặc định +7 ngày), ghi chú.
5. Vượt tiêu chuẩn năm → vẫn cấp được nhưng **bắt buộc ghi lý do** (lưu nội bộ, không hiện cho người nhận). Không đủ tồn → không
   tạo được phiếu (báo từng dòng khả dụng / thiếu).
6. **Tạo phiếu** → hệ thống **giữ chỗ** số lượng → gửi link cho người nhận (sao chép / QR / email / nút chia sẻ Zalo trên điện thoại).
7. Người nhận ký → **xuất kho**. Hủy phiếu → **trả giữ chỗ**. Sửa phiếu → giữ chỗ điều chỉnh theo chênh lệch.

PDF có tiêu đề riêng `CAU_HINH.PDF_TITLE_DP` (mặc định “BIÊN BẢN BÀN GIAO ĐỒNG PHỤC”), bảng Mẫu · Size · Tình trạng · Hình thức
(+ hạn trả) · SL, tổng số lượng, và dòng “Xác thực khi ký” (mã OTP qua email hay chỉ qua link).

### 2.2. Trả / thu hồi

*Mượn / Trả* (hoặc nút **Ghi nhận trả** ở chi tiết phiếu / hồ sơ nhân viên):

| Kết quả | Kho | Khi nào |
|---|---|---|
| Nhận lại — nhập kho | `RETURN`: `on_hand +=` vào mặt hàng **cùng mẫu / size** với tình trạng chọn (thường *Đã qua sử dụng*) | Trả đồ mượn, thu hồi khi nghỉ việc, đổi size |
| Hư hỏng — không nhập kho | không đổi | Đồ hỏng, không dùng lại (bắt buộc ghi chú) |
| Mất | không đổi | Nhân viên làm mất (bắt buộc ghi chú) |

Lý do: Trả đồ mượn · Thu hồi khi nghỉ việc · Đổi size · Hư hỏng · Khác. Trả được từng phần; dòng hết số còn giữ thì biến khỏi danh
sách “Đang mượn / Còn giữ”. Bấm lưu hai lần / mất mạng rồi gửi lại **không ghi hai lần** (mã thao tác `DP_RETURN:<mã>`).

Nhân viên nghỉ việc (`NHAN_VIEN.status = INACTIVE`): hồ sơ đồng phục hiện cảnh báo “còn giữ n áo”; lọc *Còn giữ (mọi hình thức)*
ở trang *Mượn / Trả* để thu hồi.

### 2.3. Nhập kho, kiểm kê, thanh lý

*Tồn kho & mẫu*: mỗi mẫu là một bảng size × tình trạng. Bấm vào ô → **Nhập thêm** (lý do: Mua / đặt may mới · Tồn đầu kỳ ·
Chuyển kho · Khác), **Kiểm kê** (nhập số đếm thực tế — bắt buộc lý do), **Thanh lý** (hư hỏng, lỗi may; không thấp hơn số đang giữ
chỗ). Mọi thao tác ghi sổ biến động kèm người thực hiện; xem ở *Lịch sử kho* (lọc theo mẫu / mặt hàng / loại / ngày, xuất CSV).

## 3. Tiêu chuẩn năm

Năm = **năm dương lịch, giờ Việt Nam**. Với mỗi nhân viên:

```text
đã dùng   = đã cấp (dòng Cấp phát, phiếu ĐÃ KÝ trong năm, mẫu có tính tiêu chuẩn)
          + đồng phục ghi tay ở phiếu loại khác đã ký trong năm (trước khi có module: tên / nội dung chứa “đồng phục”)
          + đang chờ ký (phiếu đồng phục PENDING / REVISION_REQUESTED — chỉ tính khi xem năm hiện tại)
còn lại   = tiêu chuẩn − đã dùng
```

Không tính: dòng **Cho mượn**, mẫu **không tính tiêu chuẩn** (áo bảo hộ). Tiêu chuẩn áp dụng theo thứ tự:

1. Quy tắc **“Tổng mọi mẫu”** của nhóm (đúng giới tính trước, rồi quy tắc cho cả nam và nữ);
2. không có → **tổng các quy tắc theo mẫu** của nhóm (đồng thời mỗi mẫu bị giới hạn riêng);
3. không có → mặc định `CAU_HINH.DP_TIEU_CHUAN_NAM` (mặc định `3`; `0` = không áp dụng mặc định).

**Nhóm (phạm vi)** của nhân viên lấy theo phòng ban: trang *Tiêu chuẩn năm → Phòng ban → nhóm tiêu chuẩn*:

- *Tự khớp / mặc định*: phòng ban trùng tên nhóm (không phân biệt dấu / hoa thường) thì theo nhóm đó, không thì mức mặc định;
- chọn nhóm cụ thể (lưu ở `CAU_HINH`, khóa `DP_SCOPE:<TÊN_PHÒNG_BAN_KHÔNG_DẤU>`);
- **Không áp dụng**: phòng ban không mặc đồng phục — không có tiêu chuẩn, không báo vượt.

Quy tắc theo mẫu cũng là **mẫu gợi ý** khi cấp và khi **dự trù đặt may** (trang *Cấp phát theo NV*, cuối trang: tổng phần “còn
lại” của nhân viên đang làm theo mẫu gợi ý × size — dùng lập “Danh sách mua đồng phục”).

## 4. Kho — bất biến dữ liệu

Bộ máy sổ kho dùng chung với văn phòng phẩm (`Vpp.gs`, `stockStore_('UNIFORM')`):

| Loại | Tác động | Khi nào |
|---|---|---|
| `INITIAL` / `IN` | `on_hand +=` | Tồn đầu kỳ / nhập kho |
| `RESERVE` / `RELEASE` | `reserved ±=` | Tạo, sửa, hủy phiếu chờ ký |
| `OUT` | `on_hand −=`, `reserved −=` | Người nhận ký |
| `ADJUSTMENT` | `on_hand = số kiểm kê` | Kiểm kê |
| `RETURN` | `on_hand +=` | Nhận lại khi nhân viên trả |
| `DISPOSE` | `on_hand −=` | Thanh lý / hủy |

- **Sổ là nguồn sự thật**: ghi sổ trước, bảng tồn sau; lệch → tự tính lại từ sổ (cờ “dirty”). Không bao giờ âm tồn.
- Đồng bộ kho của phiếu **hội tụ** theo `operation_id`: lỗi giữa chừng, bấm lại, “Đối soát kho” ở chi tiết phiếu đều không trừ hai lần.
- Không xóa / sửa dòng sổ; sai thì kiểm kê (ADJUSTMENT) mới.

## 5. Trang quản trị (menu **Đồng phục**)

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| Tổng quan | `/admin/dong-phuc` | Khả dụng, size hết / sắp hết, đang cho mượn / quá hạn, đã cấp trong năm, phiếu chờ ký, việc cần xử lý (thiếu size / giới tính, vượt tiêu chuẩn), phiếu gần đây |
| Tồn kho & mẫu | `/admin/dong-phuc/ton-kho` | Bảng size × tình trạng từng mẫu; thêm / sửa mẫu; nhập kho, kiểm kê, thanh lý; xuất CSV |
| Cấp phát theo NV | `/admin/dong-phuc/nhan-vien` | Sổ cấp phát theo năm: tiêu chuẩn, đã cấp, chờ ký, còn lại, đang mượn; sửa size; nút Cấp; dự trù đặt may; xuất CSV |
| Hồ sơ nhân viên | `/admin/dong-phuc/nhan-vien/:mã` | Tiêu chuẩn (tổng + theo mẫu), đang giữ (ghi nhận trả), phiếu đồng phục, đã trả, đồng phục ghi ở phiếu cũ |
| Mượn / Trả | `/admin/dong-phuc/muon-tra` | Đang mượn · Quá hạn · Còn giữ (mọi hình thức) · Tất cả; ghi nhận trả; xuất CSV |
| Tiêu chuẩn năm | `/admin/dong-phuc/tieu-chuan` | Quy tắc theo nhóm (tổng / theo mẫu / giới tính, hiệu lực); gán phòng ban → nhóm |
| Lịch sử kho | `/admin/dong-phuc/lich-su` | Sổ biến động (lọc, phân trang, xuất CSV) |

Tổng quan quản trị (`/admin`) có thẻ **Đồng phục**; menu có huy hiệu số đồ mượn quá hạn.

## 6. Đưa vào sử dụng (lần đầu)

1. Nâng cấp hệ thống lên v2.1 — [UPGRADE_V2.1.md](UPGRADE_V2.1.md) (menu **Nâng cấp module Đồng phục (v3)**).
2. Menu **DTA Handover → Khởi tạo danh mục đồng phục** (7 mẫu ở §1). Sửa / thêm mẫu cho đúng thực tế ở *Tồn kho & mẫu*.
3. **Tồn đầu kỳ**: đếm kho theo mẫu × size → *Tồn kho & mẫu* → bấm ô → *Nhập thêm*, lý do **Tồn đầu kỳ**. Hàng cũ còn dùng được
   nhập ở dòng *Đã qua sử dụng*.
4. **Size & giới tính nhân viên**: điền cột `gender` (`NAM` / `NỮ`) và `uniform_size` trong sheet `NHAN_VIEN` (chép từ “DS đồng phục
   2023/2024”), hoặc sửa từng người ở *Cấp phát theo NV → Size*. Sau khi sửa Sheet: bấm **Làm mới dữ liệu** (cuối menu quản trị).
5. (Tùy chọn) *Tiêu chuẩn năm*: tạo nhóm (ví dụ “Showroom”: áo sơmi đỏ 3 cho nam, áo dài vàng 3 cho nữ) và gán phòng ban; phòng
   ban không mặc đồng phục chọn **Không áp dụng**.
6. **Áo bảo hộ đang cấp qua văn phòng phẩm**: ngừng cấp qua VPP; đếm số còn trong kho VPP → *Nhập thêm* vào mẫu **Áo bảo hộ** (lý do
   *Chuyển kho*) → kiểm kê sản phẩm VPP tương ứng về 0 (lý do “chuyển sang module đồng phục”). Từ đó áo bảo hộ cấp / cho mượn / thu
   hồi như đồng phục nhưng không trừ tiêu chuẩn năm.

Lịch sử cấp phát trước khi có module **không cần nhập lại**: dòng chứa chữ “đồng phục” ở phiếu đã ký trong năm tự được cộng vào
“đã cấp” (mục *Đồng phục ghi ở phiếu cũ* trong hồ sơ nhân viên). Các năm trước không ảnh hưởng tiêu chuẩn năm nay.

## 7. Xuất CSV

| Nút ở trang | Tệp | Nội dung |
|---|---|---|
| Tồn kho & mẫu | `ton-kho-dong-phuc-*.csv` | Một dòng / mặt hàng: tồn, giữ chỗ, khả dụng, tối thiểu, tình trạng tồn |
| Lịch sử kho | `lich-su-kho-dong-phuc-*.csv` | Sổ biến động theo bộ lọc (số lượng có dấu theo chiều tác động) |
| Cấp phát theo NV | `cap-phat-dong-phuc-<năm>-*.csv` | Sổ cấp phát của năm: tiêu chuẩn, đã cấp (phiếu đồng phục / phiếu cũ), chờ ký, còn lại, đang mượn |
| Mượn / Trả | `muon-tra-dong-phuc-*.csv` | Các dòng theo bộ lọc trạng thái |

CSV có BOM UTF-8 (Excel mở đúng tiếng Việt), chống chèn công thức, tối đa 5.000 dòng / lần.

## 8. Câu hỏi thường gặp

- **Cấp cùng mẫu / size vừa cấp phát vừa cho mượn?** Được — hai dòng khác hình thức (trùng mẫu + size + hình thức thì gộp số lượng).
- **Muốn cấp vượt tiêu chuẩn?** Ghi lý do ở dòng vượt (ví dụ “đổi ca, cần thêm 1 áo”); quản trị viên xem lại ở chi tiết phiếu.
- **Đổi size**: ghi nhận trả (lý do *Đổi size*, nhập kho *Đã qua sử dụng* nếu dùng lại được) rồi tạo phiếu cấp size mới — phiếu mới
  tính vào tiêu chuẩn; nếu không muốn trừ tiêu chuẩn, ghi lý do vượt hoặc tạo quy tắc riêng.
- **Sửa thẳng `DP_TON_KHO` trên Sheet?** Không nên — bảng tồn được tính lại từ sổ; mọi thay đổi số lượng làm qua *Kiểm kê*.
- **Thêm size 3XL cho một mẫu**: *Sửa mẫu → thêm size*; hệ thống tạo mặt hàng mới với tồn 0.
