# Module Văn phòng phẩm (VPP)

Quản lý **định mức → danh mục → tồn kho → đề xuất mua → duyệt → nhập kho → bàn giao → xác nhận → xuất kho** trên cùng
hệ thống phiếu bàn giao hiện có (Cloudflare Worker → Apps Script → Google Sheets). Không có hệ thống phiếu thứ hai:
phiếu văn phòng phẩm là phiếu `BAN_GIAO` với `handover_type = OFFICE_SUPPLY`, người nhận ký bằng đúng link xác nhận cũ.

Mã nguồn: `apps-script/Vpp.gs` (kho, định mức, rà soát dữ liệu), `apps-script/VppProposals.gs` (đề xuất mua),
`apps-script/VppSetup.gs` (nâng cấp cấu trúc + dữ liệu ban đầu), `worker/api/vpp.ts`, `worker/api/publicVpp.ts`,
`src/pages/admin/vpp/*`, `src/pages/ProposalPage.tsx`, `src/components/vpp/*`, `shared/vpp.ts`.

## 1. Khái niệm

### Sản phẩm (`VPP_SAN_PHAM`)

| `catalog_status` | Ý nghĩa |
|---|---|
| `MASTER` | Sản phẩm chính thức: hiện trong danh mục công khai của trang đề xuất, gắn được định mức. |
| `TEMP` | Sản phẩm tạm / ngoài định mức (ví dụ tồn đầu kỳ chưa ghép, hoặc admin chọn GIỮ TẠM): nhập / xuất kho được, không hiện công khai. |
| `PENDING_APPROVAL` | Sản phẩm nhân viên đề xuất ngoài danh mục — chờ admin quyết định. Chưa nhập / xuất kho được. |
| `ARCHIVED` | Ngừng dùng (đã ghép vào sản phẩm khác, bị từ chối…). Không xóa dòng; lịch sử giữ nguyên. |

`review_status` (`PENDING` / `MAPPED` / `RESOLVED` / `SKIPPED`) đánh dấu sản phẩm tồn đầu kỳ đã được người xem xét hay chưa.

### Tồn kho (`VPP_TON_KHO`)

```text
available = on_hand − reserved        (tính động, không lưu)
```

| Cột | Ý nghĩa |
|---|---|
| `on_hand` | Số thực có trong kho. **Trống = chưa rõ** (ví dụ tồn đầu kỳ “hết năm”) — không bao giờ tự hiểu là 0. Số gõ tay âm / có phần lẻ / không phải số cũng là **chưa rõ** (giữ nguyên chữ đã gõ để hiện; kiểm kê tính chênh lệch từ 0, không từ số sai). Số kiểu Việt Nam (`1.000`) được đọc đúng. |
| `reserved` | Đang giữ chỗ cho phiếu VPP chờ ký (`PENDING` / `REVISION_REQUESTED`). |
| `minimum_stock` | Mức tối thiểu để cảnh báo SẮP HẾT. |
| `raw_initial_value` | Giá trị gốc của tồn đầu kỳ, giữ nguyên văn (“hết năm”, “4 vuông nhỏ”…). |
| `needs_review` | Cần người kiểm tra (chưa rõ số lượng / ĐVT). |

Trạng thái tồn: `available ≤ 0` → 🔴 **HẾT HÀNG**; `0 < available ≤ minimum_stock` → 🟠 **SẮP HẾT**;
`on_hand` chưa rõ → 🟡 **CẦN KIỂM TRA**; còn lại → còn hàng.

### Biến động kho (`VPP_BIEN_DONG_KHO`) — nhật ký bất biến

| Loại | Tác động | Khi nào |
|---|---|---|
| `INITIAL` | `on_hand +=` | Tồn đầu kỳ (seed hoặc nhập kho lý do “Tồn đầu kỳ”) |
| `IN` | `on_hand +=` | Nhập kho thủ công, nhận hàng từ đề xuất |
| `RESERVE` | `reserved +=` | Tạo / sửa tăng số lượng phiếu VPP |
| `RELEASE` | `reserved −=` | Hủy phiếu, sửa giảm số lượng |
| `OUT` | `on_hand −=`, `reserved −=` | Người nhận ký xác nhận phiếu VPP |
| `ADJUSTMENT` | `on_hand = số kiểm kê` | Kiểm kê (bắt buộc lý do), ghép sản phẩm |

Mỗi dòng ghi `on_hand / reserved` trước & sau, phiếu / đề xuất liên quan, `operation_id`, **người thực hiện** và lý do.
Không bao giờ xóa hay sửa dòng biến động; sai sót xử lý bằng kiểm kê (ADJUSTMENT) mới.

## 2. Định mức (`VPP_DINH_MUC`)

- Mỗi dòng: sản phẩm × **phạm vi** (`scope_id` / `scope_name`, ví dụ `KINH_DOANH` / “PHÒNG KINH DOANH”) × SL/tháng, ĐVT,
  đơn giá tham khảo, ghi chú, hiệu lực từ–đến, bật/tắt. Khóa không trùng: phạm vi + sản phẩm (đang hiệu lực).
- **Phòng ban → phạm vi** (trang *Định mức*, phần “Phòng ban → phạm vi định mức”):
  - *Tự khớp theo tên*: tên phòng ban trùng tên phạm vi (bỏ chữ “phòng”, không phân biệt dấu / hoa thường) — “Kinh doanh” ↔ “PHÒNG KINH DOANH”.
  - *Gắn thủ công*: lưu ở `CAU_HINH` khóa `VPP_SCOPE:<PHÒNG BAN>` = mã phạm vi.
  - *Không áp dụng định mức*: giá trị `NONE` (không còn bị liệt kê là “chưa gắn” ở *Dữ liệu cần kiểm tra*).
- Định mức của sản phẩm **đã ngừng dùng / đã ghép** không còn tính là “đang áp dụng” (trang *Định mức* ghi rõ, không cộng vào tổng).
- Phạm vi được **chốt trên phiếu lúc tạo** (`BAN_GIAO.vpp_scope_id`) — đổi cách gắn phòng ban không làm lệch số đã cấp của phiếu cũ.
- Mức đã dùng trong tháng (giờ Việt Nam) = phiếu đã ký trong tháng (**đã cấp**) + phiếu đang chờ ký (**đang chờ**).
  Phiếu mới vượt phần còn lại → hiện “⚠ VƯỢT ĐỊNH MỨC n”, **không chặn** nhưng bắt buộc nhập *Lý do vượt định mức*
  (lưu ở `CHI_TIET_BAN_GIAO.over_norm_reason`, chỉ admin thấy; API trả `NORM_EXCEEDED` nếu thiếu lý do).

## 3. Phiếu bàn giao văn phòng phẩm

Tạo tại `/admin/ban-giao/tao-moi` → **Văn phòng phẩm**: người giao, người nhận (mã NV, phòng ban, định mức áp dụng),
ngày lập, danh sách VPP (tìm theo tên / mã / ĐVT / nhóm, có dấu hoặc không: “but bi” = “Bút bi”), ghi chú.
Mỗi sản phẩm hiện **Tồn · Đang giữ · Khả dụng · Định mức tháng (đã cấp / còn)** và ô `[-] n [+]`.

| Sự kiện | Kho |
|---|---|
| Tạo phiếu (`PENDING`) | `RESERVE` — `on_hand` giữ nguyên, `available` giảm |
| Người nhận yêu cầu sửa (`REVISION_REQUESTED`) | Giữ nguyên giữ chỗ |
| Admin sửa số lượng | Điều chỉnh theo **chênh lệch** (`RESERVE` / `RELEASE`) |
| Người nhận ký (`CONFIRMED`) | `OUT` — `on_hand −= SL`, `reserved −= SL` |
| Admin hủy (`CANCELLED`) | `RELEASE` — `on_hand` giữ nguyên |
| Ký lần 2 | `ALREADY_CONFIRMED` — không xuất kho lần 2 |

- **Không âm tồn:** yêu cầu > khả dụng → không tạo được phiếu; giao diện hiện *Không đủ tồn kho · Khả dụng · Yêu cầu · Thiếu*
  và lối tắt **[TẠO ĐỀ XUẤT MUA]** (mở `/de-xuat-vpp` điền sẵn sản phẩm + số lượng thiếu). API trả `INSUFFICIENT_STOCK`.
  Kiểm tra dùng số tồn / giữ chỗ theo **sổ biến động** — đúng số mà bước giữ chỗ sẽ ghi — và chạy **trước** khi ghi bất cứ gì: không
  bao giờ có phiếu “báo không đủ tồn nhưng vẫn lưu” (kể cả khi số trên sheet bị sửa tay hoặc lần ghi kho trước lỗi giữa chừng).
  Form tạo / sửa phiếu cũng hiện số theo sổ; tải số liệu của người nhận mới bị lỗi → báo rõ, không hiện số của người nhận trước.
- **Sản phẩm cuối:** nếu sau phiếu khả dụng = 0 → hộp thoại “⚠ SẢN PHẨM SẼ HẾT SAU PHIẾU NÀY” (khả dụng / bàn giao / còn lại);
  admin vẫn được tiếp tục. Sau khi tạo, màn hình kết quả hiện cảnh báo hết / sắp hết.
- Tồn chưa rõ (`on_hand` trống) → không bàn giao được cho tới khi kiểm kê.
- **Đồng bộ kho hội tụ (idempotent):** mọi thao tác tính *số cần giữ / cần xuất* từ trạng thái + nội dung hiện tại của phiếu
  rồi so với tổng biến động đã ghi cho phiếu đó, chỉ ghi phần chênh lệch (`operation_id`: `HANDOVER_RESERVE|UPDATE|CANCEL|CONFIRM:{id}`).
  Gửi lại request, ký 2 lần, hoặc bấm **Đối soát kho** (trang chi tiết phiếu / *Dữ liệu cần kiểm tra*) đều không ghi trùng.
- PDF phiếu VPP: tiêu đề “BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM”, bảng STT · Tên VPP · ĐVT · SL, ghi chú, chữ ký, ngày xác nhận.

## 4. Đề xuất mua (`/de-xuat-vpp` → `/admin/vpp/de-xuat`)

**Nhân viên** (mobile-first, không cần tài khoản; nếu Worker đặt `STAFF_ACCESS_CODE` thì phải nhập mã truy cập nội bộ):

1. Nhập **mã nhân viên** → hệ thống trả họ tên, phòng ban, chức vụ của **đúng một** người (không công khai danh bạ;
   giới hạn tần suất và số lần tra sai theo IP).
2. Danh sách định mức của phòng ban: tích chọn, chỉnh SL. SL > định mức tháng → “⚠ Vượt định mức”, **bắt buộc lý do**.
3. **+ THÊM SẢN PHẨM NGOÀI ĐỊNH MỨC**: chọn từ danh mục hoặc nhập tên mới — *Tên\*, ĐVT, SL\*, Lý do\*, Link tham khảo, Ghi chú*.
   Tên gõ tay chỉ được gắn vào sản phẩm danh mục đang dùng khi **trùng khớp hoàn toàn có dấu** (không phân biệt hoa / thường,
   khoảng trắng) **và cùng ĐVT** — “Kẹo” / “Keo” **không** bị gắn vào “Kéo”; “Giấy toilet · 2 Thùng” không thành “2 Cuộn”. Còn lại
   mỗi dòng tạo một sản phẩm `PENDING_APPROVAL` riêng (giữ ĐVT đã gõ), không tự vào danh mục.
4. Gửi → mã đề xuất `DX-YYYYMMDD-XXXX`. Bấm gửi lại (mạng chập chờn) không tạo đề xuất thứ hai (`clientRequestId`). Lần gửi trước
   mất phản hồi nhưng đã lưu mà nhân viên **sửa nội dung** rồi gửi lại → trang báo đề xuất đã gửi (mã, thời điểm) và nội dung sửa
   CHƯA được gửi; bấm gửi lần nữa = chủ động gửi thành đề xuất **mới** (đề xuất cũ giữ nguyên — báo quản trị viên nếu cần hủy).
   Phiên mã truy cập hết hạn lúc gửi → nhập lại mã trong hộp thoại, nội dung đang nhập giữ nguyên.

**Quản trị viên:**

| Trạng thái | Thao tác tiếp theo |
|---|---|
| `SUBMITTED` | Duyệt từng dòng (SL duyệt, đơn giá) → `APPROVED` / `PARTIALLY_APPROVED` (tất cả 0 → `REJECTED`); hoặc **Từ chối** (bắt buộc lý do). Trạng thái **tự tính lại** sau mỗi quyết định sản phẩm mới (từ chối sản phẩm duy nhất của đề xuất đã duyệt → `REJECTED`) |
| `APPROVED`, `PARTIALLY_APPROVED` | Duyệt lại, Từ chối, **Đánh dấu đã mua** → `PURCHASED`, **Nhận hàng & nhập kho**, Đóng |
| `PURCHASED` | **Nhận hàng & nhập kho** → `RECEIVED`, Đóng |
| `RECEIVED`, `REJECTED` | **Đóng** → `CLOSED` |

Chuyển trạng thái sai → `INVALID_STATUS_TRANSITION`.

- **Giá dự kiến** = Σ SL (đề xuất khi chưa duyệt / duyệt sau khi duyệt) × đơn giá (đơn giá duyệt / thực mua, hoặc
  `reference_price`) — tự tính lại khi duyệt, khi quyết định sản phẩm mới và khi nhận hàng theo giá thực tế.
- **Sản phẩm mới (🆕)**: [THÊM VÀO DANH MỤC] (mã, nhóm, ĐVT, đơn giá, tồn tối thiểu, kèm định mức theo phạm vi) ·
  [GIỮ TẠM] · [GHÉP] vào sản phẩm có sẵn · [TỪ CHỐI] (dòng được duyệt SL 0). Phải quyết định trước khi nhập kho dòng đó.
  Chỉ quyết định được khi sản phẩm **còn chờ duyệt**; đã quyết định thì không quyết định lại (sản phẩm đang có tồn / giữ chỗ không
  bao giờ bị lưu trữ từ một đề xuất khác) — trừ khi lần quyết định trước lỗi giữa chừng (sản phẩm đã đổi, dòng chưa): làm lại đúng
  quyết định đó sẽ hoàn tất. Sản phẩm chờ duyệt **chỉ** xử lý ở đây — hộp thoại sản phẩm, kiểm kê, nhập kho, GHÉP /
  TẠO MỚI / BỎ QUA ở *Dữ liệu cần kiểm tra* đều từ chối kèm hướng dẫn.
- **Đổi ĐVT phải quy đổi số lượng** — mọi quyết định: GHÉP sang sản phẩm khác ĐVT, hoặc THÊM VÀO DANH MỤC / GIỮ TẠM với ĐVT khác ĐVT
  của dòng (“Ruột bút bi: 2 **Hộp**” → sản phẩm tính theo “Cây”) → bắt buộc nhập số **đã quy đổi** (thay cho SL đề xuất của dòng) và
  tích xác nhận. ĐVT so **giữ dấu** (“Cuốn” ≠ “Cuộn”, “Bó” ≠ “Bộ”), chỉ bỏ khác biệt hoa / thường, khoảng trắng, dấu câu.
- Từ chối / đóng đề xuất còn sản phẩm mới chưa quyết định → dòng thành “từ chối sản phẩm” (duyệt 0), sản phẩm chờ duyệt được lưu
  trữ nếu không còn chờ ở đề xuất khác (không còn “chờ duyệt” mồ côi trong *Dữ liệu cần kiểm tra*).
- **Nhận hàng**: SL thực nhận, đơn giá thực tế, ngày, ghi chú từng dòng → `IN` (`operation_id` `PROPOSAL_RECEIVE:{đề xuất}:{dòng}`
  — bấm lại không nhập trùng; lần trước đã nhập kho dòng đó mà gửi số khác → báo số đã nhập, không nhập thêm). Mọi dòng số 0 →
  không chuyển “Đã nhập kho” (dùng **Đóng**); dòng duyệt 0 không nhập kho theo đề xuất. Nhận hàng là **một lần** cho cả đề xuất
  (giao thiếu / giao nhiều đợt: phần còn lại tạo đề xuất mới — xem *Rủi ro còn lại* trong `BUG_FIX_REPORT.md`).

## 5. Nhập kho thủ công & kiểm kê (`/admin/vpp/ton-kho`)

- **+ Nhập**: SL, lý do (*Mua trực tiếp · Bổ sung · Chuyển kho · Tồn đầu kỳ · Khác* — “Khác” bắt buộc ghi chú), đơn giá, ngày.
  “Tồn đầu kỳ” ghi `INITIAL`, còn lại `IN`. Sản phẩm tồn chưa rõ chỉ nhập được với lý do “Tồn đầu kỳ” (hoặc kiểm kê trước).
- **Kiểm kê**: tồn hệ thống → tồn thực tế, **bắt buộc lý do**, ghi `ADJUSTMENT` theo chênh lệch; không thấp hơn số đang giữ chỗ.
- Mỗi lần mở hộp thoại là một thao tác (`clientRequestId`) — bấm lại không ghi 2 lần. Lần bấm lỗi mà **chưa rõ** đã ghi hay chưa
  (mất mạng, hết thời gian chờ): trang tải lại số tồn; mở lại hộp thoại cho cùng sản phẩm dùng lại mã đó (kèm nhắc) — nhập lại đúng số
  → “đã ghi ở lần gửi trước”, không cộng lần hai; số khác → báo số đã ghi (`REQUEST_REUSED`), không ghi.
- Ô số nhận cách gõ kiểu Việt Nam: `1.000` = một nghìn, đơn giá `15.000` hoặc `12,5`; cách viết hai nghĩa (`1,500`) → báo lỗi, không đoán.
- Không sửa tay số tồn trên Google Sheet (sheet được khóa bằng *Khóa sheet hệ thống*).

## 6. Dữ liệu cần kiểm tra (`/admin/vpp/data-review`)

Không tự ghép, không tự đoán. Trang liệt kê: tồn đầu kỳ chưa ghép (kèm gợi ý), thiếu ĐVT, số lượng chưa rõ, tên trùng,
sản phẩm chờ duyệt, phòng ban chưa gắn định mức, phiếu VPP lệch kho, **số tồn lệch sổ biến động kho**, sản phẩm danh mục chưa có
định mức / tồn tối thiểu.

```text
Tên tồn:  Giấy ướt          Gợi ý: Khăn giấy ướt (Bịch) 90%
[GHÉP]   [TẠO SẢN PHẨM MỚI]   [BỎ QUA]
```

- **GHÉP**: chuyển tồn sang sản phẩm danh mục admin **tự chọn** (không chọn sẵn, không điền sẵn số lượng). Cùng ĐVT → để trống =
  chuyển nguyên số. **Khác ĐVT (so giữ dấu: “Cuốn” ≠ “Cuộn”) hoặc một bên chưa có ĐVT** (“Kim bấm: 11 hộp” → sản phẩm tính theo
  “Cái”) → bắt buộc nhập số **đã quy đổi** và tích “Tôi xác nhận số lượng đã quy đổi sang ĐVT …”. Tồn nguồn chưa rõ → bắt buộc nhập
  số thực tế. Ghi `ADJUSTMENT` ở cả hai sản phẩm (`MERGE:{nguồn}` — lỗi giữa chừng rồi làm lại hoàn tất, không chuyển tồn lần 2);
  sản phẩm nguồn chuyển `ARCHIVED` (không xóa).
- **Định mức khi GHÉP**: định mức đang bật của sản phẩm nguồn được **chuyển sang sản phẩm đích** khi cùng ĐVT và đích chưa có định
  mức phạm vi đó; còn lại (khác ĐVT — số định mức không tự quy đổi được; đích đã có định mức) → **ngừng áp dụng** kèm ghi chú lý do.
  Thông báo sau khi ghép nêu rõ phạm vi nào được chuyển / ngừng — kiểm tra lại trang *Định mức*.
- **TẠO SẢN PHẨM MỚI**: đưa sản phẩm tạm vào danh mục (`MASTER`), giữ nguyên tồn, có thể kèm định mức.
- **BỎ QUA**: giữ là sản phẩm tạm riêng (ngoài định mức).
- Gợi ý so khớp tên **có dấu** (kéo ≠ kẹo ≠ keo), có từ đồng nghĩa kính ↔ kiếng; ngưỡng 50%, tối đa 3 gợi ý.
- **Số tồn lệch sổ biến động kho**: số trên sheet `VPP_TON_KHO` khác tổng các biến động đã ghi (ghi dở do sự cố Google, hoặc ai đó
  sửa tay sheet). **ĐỒNG BỘ THEO SỔ** đặt lại số tồn theo sổ (ghi lịch sử `VPP_STOCK_SYNCED`); nếu số thực tế khác, *Kiểm kê* sau đó.
  Lỗi giữa chừng khi ghi kho được hệ thống tự đồng bộ ở lần ghi kho kế tiếp — mục này chủ yếu bắt trường hợp sửa tay.

## 7. Dữ liệu ban đầu

### Định mức — `seedOfficeSupplyNorms()`

Nguồn: bản scan “CÔNG TY CỔ PHẦN DTA SPACE – ĐỊNH MỨC VVP HÀNG THÁNG”. Giữ nguyên ĐVT, đơn giá, SL/tháng, ghi chú;
`source_ref` ghi số thứ tự trên bản nguồn. Chạy lại không tạo trùng, không sửa định mức đã có — kể cả khi admin đã sửa tên /
ĐVT sản phẩm (chống trùng theo phạm vi + STT, không theo tên).

| Phạm vi | Số dòng | Σ SL/tháng | Σ đơn giá (dòng “Tổng” trên bản scan) | Chi phí dự kiến/tháng (Σ SL × đơn giá) |
|---|---|---|---|---|
| PHÒNG KINH DOANH (`KINH_DOANH`) | 13 | 47 | 323.800 ₫ (khớp bản scan) | 990.200 ₫ |
| VĂN PHÒNG (`VAN_PHONG`) | 17 | 88 | 679.000 ₫ (bản scan ghi 651.800 / 87 — thiếu dòng “Nước lau kiếng”) | 2.274.800 ₫ |

Tạo 24 sản phẩm `MASTER` (6 sản phẩm dùng chung cho 2 phạm vi), tồn ban đầu = 0.

### Tồn đầu kỳ — `seedInitialOfficeSupplyStock()`

Chạy **thủ công một lần** (không chạy khi deploy, không ghi đè tồn đã có). 25 dòng nguồn “Tên: giá trị” → 25 sản phẩm `TEMP`
(`review_status = PENDING`), 24 biến động `INITIAL` (dòng “Giấy toilet: hết năm” không có số lượng nên không ghi biến động).

| Kết quả đọc | Dòng |
|---|---|
| Rõ số lượng + ĐVT (14) | Nước lau sàn 1 túi · Lau kính 1 chai · Vim 1 chai · Xịt phòng 2 chai · Bút lông bảng 10 cây · Bút lông đỏ 4 cây · Bút lông xanh 3 cây · Bút lông đen 4 cây · Bút đỏ 7 cây · Bút xanh 24 cây · Thước 30 cm 2 cây · Kẹp giấy lớn 3 hộp · Kẹp giấy nhỏ 1 hộp · Kim bấm 11 hộp |
| Có số, **thiếu ĐVT** (9) → `unit` trống, `needs_review` | Giấy ướt 5 · Giấy khô 9 · Xóa kéo 9 · Mực mộc 1 · Dao rọc giấy 2 · Kéo 1 · Paper clips 5 · Bút chì 4 · Bông bảng trắng 1 |
| Có số, **ĐVT không rõ** (1) | Giấy note “4 vuông nhỏ” |
| **Số lượng không rõ** (1) → `on_hand` trống, `raw_initial_value = "hết năm"` | Giấy toilet |

## Dữ liệu chưa rõ (UNRESOLVED DATA)

Hệ thống **giữ nguyên** các mục dưới đây và gắn cờ cần kiểm tra — cần người nắm thực tế quyết định:

| # | Dữ liệu | Vấn đề | Việc cần làm |
|---|---|---|---|
| 1 | Tồn “Giấy toilet: **hết năm**” | Không rõ là *hết* (0) hay *đủ dùng hết năm*, hay số “năm” (5) | Đếm thực tế → *Kiểm kê*, hoặc GHÉP vào “Giấy Toilet VP và Showroom” kèm số thực tế |
| 2 | Tồn “**Paper clips: 5**” | Không có ĐVT (5 hộp hay 5 cái?) | Sửa sản phẩm nhập ĐVT, hoặc GHÉP / TẠO SẢN PHẨM MỚI kèm ĐVT |
| 3 | Tồn “Giấy note: 4 **vuông nhỏ**” | “vuông nhỏ” không phải ĐVT rõ ràng (xấp? tệp?) | Xác định ĐVT + kích thước |
| 4 | Tồn thiếu ĐVT: Giấy ướt 5 · Giấy khô 9 · Xóa kéo 9 · Mực mộc 1 · Dao rọc giấy 2 · Kéo 1 · Bút chì 4 · Bông bảng trắng 1 | Không có ĐVT | Bổ sung ĐVT khi ghép / tạo mới |
| 5 | Ghép tên tồn ↔ danh mục | Chưa ghép tự động. Gợi ý: Giấy ướt → Khăn giấy ướt (Bịch) · Lau kính → Nước lau kiếng · Xịt phòng → Xịt thơm phòng · Nước lau sàn (1 **túi**) → Nước lau sàn 3.6 (**Bịch**) · Giấy toilet → Giấy Toilet VP và Showroom · Bút xanh → Bút bi Thiên Long 027, xanh **hoặc** Bút lông dầu … xanh · Bút lông xanh / đen → Bút lông dầu Thiên Long FO-PM09 xanh / đen | Admin xác nhận từng cặp; khác ĐVT phải nhập số quy đổi |
| 6 | Không có gợi ý: Giấy khô, Vim, Bút đỏ, Xóa kéo, Giấy note, Mực mộc, Dao rọc giấy, Thước 30 cm, Kéo, Kẹp giấy lớn / nhỏ, Kim bấm, Paper clips, Bút chì, Bông bảng trắng | Sản phẩm ngoài định mức | TẠO SẢN PHẨM MỚI hoặc BỎ QUA (giữ tạm) |
| 6b | Gợi ý yếu (≈ 53%): Bút lông bảng, Bút lông đỏ → Bút lông dầu Thiên Long FO-PM09 (xanh / đen) | Khác loại (bút viết bảng) hoặc khác màu — nhiều khả năng **không** nên ghép | Thường là TẠO SẢN PHẨM MỚI / BỎ QUA |
| 7 | Định mức KD dòng 12 “**Hột quẹt**” (Cái, 10.000 ₫, 4/tháng) | Danh sách yêu cầu ghi “Hốt quét”; bản scan ghi “Hột quẹt” — hệ thống dùng bản scan | Xác nhận tên đúng; sửa tên sản phẩm nếu cần |
| 8 | ĐVT “**Gream**” (Giấy A4 / A5) | Có thể là “Ream” (ram giấy) — giữ nguyên như bản scan | Xác nhận, sửa ĐVT sản phẩm nếu cần |
| 9 | Dòng “Tổng” VĂN PHÒNG trên bản scan: 651.800 ₫ / 87 | Thiếu dòng “Nước lau kiếng” (27.200 ₫, 1) — đúng phải là 679.000 ₫ / 88 | Đối chiếu bản gốc; hệ thống lưu theo từng dòng nên không bị ảnh hưởng |
| 10 | Phòng ban áp dụng định mức “VĂN PHÒNG” | Bản định mức không ghi phòng ban nào thuộc “VĂN PHÒNG”. Chỉ “Kinh doanh” tự khớp “PHÒNG KINH DOANH” | Trang *Định mức* → gắn từng phòng ban (IT, Kế toán, Hành chính, KHTH, Marketing…) hoặc chọn “Không áp dụng” |
| 11 | `minimum_stock` (tồn tối thiểu) | Bản nguồn không có → mặc định 0 (chỉ cảnh báo khi hết hàng) | Đặt mức tối thiểu cho từng sản phẩm để có cảnh báo SẮP HẾT |
| 12 | Tồn của 24 sản phẩm danh mục | Bằng 0 cho tới khi ghép tồn đầu kỳ / nhập kho → dashboard báo 🔴 hết hàng | Xử lý mục 1–6, rồi nhập kho / kiểm kê |

## 8. API

Công khai: `POST /api/public/vpp/employee-lookup` · `GET /api/public/vpp/catalog` (chỉ tên, ĐVT, nhóm) · `POST /api/public/vpp/proposals`.
Quản trị (phiên admin bắt buộc): `/api/admin/vpp/dashboard`, `products`, `norms`, `scope-mapping`, `stock`, `stock/in`,
`stock/adjust`, `movements`, `handover-context`, `proposals` (+ `approve`, `reject`, `purchased`, `receive`, `close`,
`items/:itemId/decision`), `data-review` (+ `merge`, `promote`, `skip`, `sync-stock`), `/api/admin/handovers/:id/reconcile-stock`,
xuất CSV `/api/admin/export/stock.csv` · `movements.csv` · `proposals.csv`.
Chi tiết, mã lỗi: [API.md](API.md).
