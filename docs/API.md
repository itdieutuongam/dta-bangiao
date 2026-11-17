# API — DTA Handover v2.1 (Cloudflare Worker)

Base URL: cùng domain với giao diện (ví dụ `https://bangiao.dieutuongam.com`). Body JSON (`Content-Type: application/json`).
Request thay đổi dữ liệu (POST/PUT) phải gửi từ cùng origin (header `Origin`) — khác origin → `403 FORBIDDEN`.

## Định dạng response

```json
{ "success": true, "data": { }, "error": null }
```

```json
{ "success": false, "data": null, "error": { "code": "VALIDATION_ERROR", "message": "Chọn người nhận từ danh sách nhân viên",
  "details": { "fieldErrors": { "receiverEmployeeId": "Chọn người nhận từ danh sách nhân viên" } } } }
```

Mọi response có header `X-Request-Id` (đối chiếu log) và `Cache-Control: no-store`. Thời gian dạng ISO 8601 giờ Việt Nam.

## Mã HTTP & mã lỗi

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 200 / 201 | — | Thành công / đã tạo (gửi lại cùng `clientRequestId` **đúng nội dung** — lần trước đã lưu nhưng mất phản hồi → 200 kèm `duplicate: true`, không ghi lần hai) |
| 400 | `BAD_REQUEST` | Body không phải JSON, sai Content-Type |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `STAFF_AUTH_REQUIRED` | Chưa đăng nhập admin (kèm `details.loginMode`) / sai tài khoản / cần mã truy cập nội bộ |
| 403 | `FORBIDDEN` | Origin khác domain (CSRF) |
| 404 | `NOT_FOUND` | Link / phiếu / đề xuất / API không tồn tại |
| 405 | `METHOD_NOT_ALLOWED` | Sai phương thức (header `Allow`) |
| 409 | `CONFLICT` | Nội dung phiếu đã đổi so với bản người nhận đang xem (`details.contentChanged`) — tải lại rồi thao tác |
| 409 | `ALREADY_CONFIRMED`, `INVALID_STATE`, `INVALID_STATUS_TRANSITION` | Đã xác nhận; trạng thái không cho phép; chuyển trạng thái đề xuất sai |
| 409 | `INSUFFICIENT_STOCK`, `STOCK_UNKNOWN`, `STOCK_INCONSISTENT` | Không đủ khả dụng (`details.shortages[]`: available, requested, shortage); tồn chưa rõ; dữ liệu kho lệch (đối soát) |
| 409 | `INTEGRITY_ERROR` | Phiếu đã ký bị sửa trực tiếp trên Sheet (nội dung, ý kiến / thời điểm / chữ ký, hoặc niêm phong không khớp) — không tạo PDF, không trả ảnh chữ ký |
| 409 | `REQUEST_REUSED` | Gửi lại cùng `clientRequestId` với nội dung **khác** (lần trước mất phản hồi nhưng ĐÃ lưu): không ghi, không trả bản cũ như “đã lưu”; `message` nêu bản ghi đã lưu, `details.existing` (`{ id, code }` phiếu · `{ code }` đề xuất · `{ productId, code }` sản phẩm · `{ operationId }` nhập kho / kiểm kê). Nhận hàng theo đề xuất: 422 kèm lỗi của dòng nêu số đã nhập |
| 413 | `PAYLOAD_TOO_LARGE` | Body / ảnh chữ ký quá lớn |
| 422 | `VALIDATION_ERROR`, `EMPLOYEE_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `NORM_EXCEEDED` | Dữ liệu không hợp lệ, kể cả thiếu / sai mã thao tác `clientRequestId` (kèm `details.fieldErrors`); vượt định mức chưa có lý do |
| 422 | `OTP_REQUIRED`, `OTP_INVALID`, `OTP_EXPIRED` | Ký thiếu mã / sai mã (`details.fieldErrors.otp`: “còn N lần thử”) / mã hết hạn hoặc chưa gửi |
| 429 | `RATE_LIMITED` | Vượt giới hạn tần suất (header `Retry-After`; gửi mã OTP quá sớm → `details.retryAfterSeconds`) |
| 429 | `OTP_LOCKED` | Nhập sai mã OTP 5 lần — mã bị hủy, phải gửi mã mới |
| 500 | `INTERNAL_ERROR`, `INTERNAL` | Lỗi hệ thống / lỗi xử lý tại Apps Script |
| 502 | `UPSTREAM_ERROR`, `UPSTREAM_AUTH_FAILED`, `UPSTREAM_OUTDATED`, `DRIVE_ERROR`, `SHEET_ERROR`, `PDF_ERROR` | Apps Script lỗi / sai secret / code Apps Script cũ hơn Worker / lỗi Drive, Sheet |
| 502 | `MAIL_ERROR` | Không gửi được email mã xác nhận (hết hạn mức / chưa cấp quyền gửi email cho script) |
| 503 | `NOT_CONFIGURED`, `LOCK_TIMEOUT`, `DEGRADED` | Chưa cấu hình hoặc dữ liệu chưa nâng cấp v2; hệ thống bận; health không đạt |
| 504 | `UPSTREAM_TIMEOUT` | Apps Script phản hồi quá lâu |

`OUT_OF_STOCK`, `LOW_STOCK` là **trạng thái tồn** (`stock.status`) và loại cảnh báo (`warnings[].type`: `LAST_ITEM`, `LOW_STOCK`),
không phải lỗi HTTP — thiếu hàng khi tạo phiếu trả `INSUFFICIENT_STOCK`.

## Công khai

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái Cloudflare / Apps Script / Sheet / Drive + `version` + 3 cờ sẵn sàng (200 hoặc 503 kèm `data`) |
| GET | `/api/staff/session` | `{ required, authenticated }` — trang đề xuất có yêu cầu mã truy cập nội bộ không |
| POST | `/api/staff/login` | `{ code }` → cookie phiên nhân viên (chỉ khi cấu hình `STAFF_ACCESS_CODE`) |
| GET | `/api/handover/:token` | `{ handover, categories }` — dữ liệu người nhận xem, có `handover.contentHash`, `handover.otp { required, blocked, emailMasked }` và `handover.updating` (`true` = lần lưu sửa phiếu của quản trị viên chưa hoàn tất: chưa ký / yêu cầu sửa / gửi mã được — `409 INVALID_STATE` kèm `details.updating`) |
| POST | `/api/handover/:token/otp` | Gửi mã 6 số tới email người nhận → `{ sent, emailMasked, expiresInSeconds: 600, resendAfterSeconds: 60 }`. Gửi lại sau 60 giây, tối đa 3 lần / 15 phút, 10 lần / phiếu |
| POST | `/api/handover/:token/confirm` | `{ agreed: true, signature: "data:image/png;base64,…", comment?, contentHash, otp? }` → `{ handover }`. `otp` (6 số) bắt buộc khi `handover.otp.required` |
| POST | `/api/handover/:token/request-revision` | `{ reason (≥ 5 ký tự), contentHash }` → `{ handover }` |
| GET | `/api/handover/:token/pdf` | PDF (`application/pdf`, attachment) — chỉ khi đã xác nhận |
| POST | `/api/public/vpp/employee-lookup` | `{ employeeId }` → `{ employee: { employeeId, fullName, department, position }, scope, norms[] }` (một người; không có email / SĐT) |
| GET | `/api/public/vpp/catalog` | `{ products: [{ productId, productName, unit, category }] }` — chỉ sản phẩm `MASTER` đang dùng; không có tồn / giá |
| POST | `/api/public/vpp/proposals` | Gửi đề xuất mua → **201** `{ proposalCode, status, itemCount, duplicate }` (gửi lại cùng mã đúng nội dung → 200 `duplicate: true`; khác nội dung → 409 `REQUEST_REUSED`) |

Ba API `/api/public/vpp/*` yêu cầu phiên nhân viên (hoặc admin) khi có `STAFF_ACCESS_CODE`.
**Không còn** API tạo phiếu hay danh bạ nhân viên công khai (`/api/handover` POST, `/api/employees`, `/api/categories` đã gỡ).

### Body gửi đề xuất

```json
{
  "employeeId": "519",
  "reason": "Bổ sung tháng 10",
  "clientRequestId": "6f1c…-uuid",
  "items": [
    { "productId": "<uuid sản phẩm định mức>", "quantity": 4, "reason": "Vượt định mức: in nhiều hợp đồng" },
    { "productId": "", "productName": "Bìa còng 7cm", "unit": "Cái", "quantity": 2, "reason": "Lưu hồ sơ",
      "referenceUrl": "https://…", "note": "" }
  ]
}
```

Vượt định mức tháng hoặc ngoài định mức → `reason` bắt buộc. Tên tự gõ chỉ được gắn vào sản phẩm danh mục đang dùng khi
**trùng khớp hoàn toàn có dấu** (không phân biệt hoa / thường, khoảng trắng) **và cùng ĐVT** (ĐVT gõ khác hoặc để trống khi sản
phẩm có ĐVT → không tự gắn, giữ nguyên ĐVT đã gõ); còn lại mỗi dòng tạo một sản phẩm `PENDING_APPROVAL` riêng (không vào danh
mục) chờ quản trị viên quyết định.

### Mã xác nhận khi ký (OTP)

`CAU_HINH.CONFIRM_OTP`: `EMAIL` (mặc định) — người nhận có email trong `NHAN_VIEN` phải nhập mã; chưa có email vẫn ký được nhưng
phiếu ghi `confirmMethod = NO_EMAIL`. `REQUIRED` — chưa có email thì `handover.otp.blocked = true`, không ký được. `OFF` — không dùng mã.
Mã gửi tới email **hiện tại** trong `NHAN_VIEN` (sửa email có hiệu lực ngay sau “Làm mới dữ liệu”), hiệu lực 10 phút, sai 5 lần → hủy.

## Quản trị (cookie phiên admin — mọi API dưới đây trả 401 nếu chưa đăng nhập)

### Phiên, tổng quan, hệ thống

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/admin/login` | `{ username?, password }` (username bắt buộc khi dùng `ADMIN_USERS`) → `Set-Cookie` (HttpOnly, Secure, SameSite=Lax) + `{ authenticated, expiresAt, user, mode, warnings }` |
| POST | `/api/admin/logout` | Xóa cookie |
| GET | `/api/admin/me` | Phiên hiện tại + `user { username, name }` + cảnh báo cấu hình |
| GET | `/api/admin/overview` | `{ stats, revisionRequested[], signedWithComment[] (đã ký kèm ghi chú, 30 ngày), recent[], vpp: { ready, outOfStock[], outOfStockCount, lowStock[], lowStockCount, needsReviewCount, needsReviewProducts, submittedProposals }, uniform: { outOfStockSkus, lowStockSkus, loansOverdue, pendingHandovers, employeesMissingSize } \| null, notify: { recipients, otpMode, notify: { lastOkAt, lastError }, otp: { lastOkAt, lastError }, emailCoverage: { active, withEmail } } }` — email thông báo và email mã OTP báo riêng |
| GET | `/api/admin/badges` | `{ revisionRequested, submittedProposals, overdueUniformLoans }` — huy hiệu trên menu (chỉ đọc cột trạng thái) |
| GET | `/api/admin/system` | Trang Cài đặt: cấu hình Worker (không lộ secret; `worker.recordSeal` = đã đặt `RECORD_SEAL_SECRET` hợp lệ), phiên bản + cấu trúc dữ liệu Apps Script, danh sách sheet, cảnh báo, `appsScript.notify` (+ `mailQuotaRemaining`, `mailError`) |
| GET | `/api/admin/export/:dataset` | Xuất CSV theo bộ lọc của trang: `handovers.csv` (query như danh sách phiếu), `stock.csv` (`q`, `stockStatus`, `catalogStatus`, `includeArchived`), `movements.csv` (`productId`, `type`, `from`, `to`, `q`), `proposals.csv` (`status`, `q`). UTF-8 BOM, CRLF, chống chèn công thức; tối đa 5.000 dòng — header `X-Export-Rows`, `X-Export-Total`, `X-Export-Truncated: 1` khi bị cắt. CSV dựng tại Apps Script (`Export.gs`), Worker chuyển thẳng dạng stream (CPU Worker không tăng theo số dòng) |
| GET | `/api/admin/employees` | Nhân viên ACTIVE (`?all=1`: kèm đã nghỉ + phạm vi định mức VPP) |
| GET | `/api/admin/categories` | Loại nội dung (kèm `handoverType`) |
| POST | `/api/admin/cache/refresh` | Làm mới cache nhân viên / loại nội dung / danh mục VPP |

### Phiếu bàn giao

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/handovers` | Danh sách + thống kê. Query: `page`, `pageSize`, `code`, `employeeName`, `employeeId`, `sender`, `receiver`, `department`, `handoverType`, `category`, `status`, `from`, `to`. Tìm không phân biệt dấu |
| POST | `/api/admin/handovers` | **Tạo phiếu** (body bên dưới) → 201 `{ id, code, status, handoverType, createdAt, receiver, link, warnings[], confirmOtp: { required, blocked, email } }` (gửi lại cùng mã đúng nội dung → 200 `duplicate: true`; khác nội dung → 409 `REQUEST_REUSED` kèm `details.existing { id, code }`) |
| GET | `/api/admin/handovers/:id` | `{ handover: { …, createdBy, confirmMethod (OTP_EMAIL \| NO_EMAIL \| OTP_OFF \| ""), otp, integrity { status, contentHash, signatureSha256, checks: { content, record (null = ký trước khi có mã này), seal: OK \| MISMATCH \| MISSING \| UNVERIFIED \| NONE } \| null }, editPendingSince ("" hoặc thời điểm lần lưu sửa dở), confirmedFromCreatorDevice, history[], link }, categories }` |
| PUT | `/api/admin/handovers/:id` | Sửa — chỉ `PENDING` / `REVISION_REQUESTED` → `{ handover, categories, linkRotated, warnings[] }`. Lưu trọn vẹn theo phiên bản nội dung: lỗi giữa chừng → người nhận vẫn thấy bản cũ (hoặc “đang cập nhật”), lưu lại từ trang sửa sẽ hoàn tất |
| POST | `/api/admin/handovers/:id/cancel` | `{ reason? }` — chỉ khi chưa xác nhận (phiếu VPP: trả giữ chỗ) |
| POST | `/api/admin/handovers/:id/regenerate-link` | → `{ link }` (link cũ hết hiệu lực) |
| POST | `/api/admin/handovers/:id/reconcile-stock` | Đối soát kho phiếu VPP (idempotent) → `{ reconciled, warnings[] }` |
| GET | `/api/admin/handovers/:id/signature` | Ảnh PNG chữ ký (CSP sandbox) |
| GET | `/api/admin/handovers/:id/pdf` | PDF (tự sinh nếu chưa có; từ chối nếu toàn vẹn MISMATCH) |
| POST | `/api/admin/handovers/:id/pdf` | Tạo lại PDF (bản cũ chuyển `pdf-archive/`) → `{ pdfAvailable: true }` |

Body tạo / sửa phiếu:

```json
{
  "handoverType": "ASSET",
  "sender": { "name": "Nguyễn Văn An", "employeeId": "101" },
  "receiverEmployeeId": "519",
  "note": "Bàn giao khi chuyển công tác",
  "clientRequestId": "6f1c…-uuid",
  "items": [
    { "category": "THIET_BI_CNTT", "itemName": "Laptop Dell Latitude 5440", "assetCode": "TS-0001", "serialNumber": "5CG1234XYZ",
      "model": "Latitude 5440", "quantity": 1, "unit": "", "condition": "Tốt", "description": "Kèm sạc 65W",
      "workStatus": "", "deadline": "", "documentUrl": "", "note": "" }
  ],
  "supplies": []
}
```

- `handoverType`: `ASSET` · `OFFICE_SUPPLY` · `ACCOUNT` · `DOCUMENT` · `WORK` · `OTHER`. Loại nội dung (`category`) phải thuộc loại phiếu
  (phiếu `OTHER` dùng được mọi loại trừ văn phòng phẩm) và đang dùng (`ACTIVE`).
- Phiếu **văn phòng phẩm**: `items: []`, `supplies: [{ productId, quantity, note, overNormReason }]` — tên, ĐVT lấy từ danh mục;
  vượt định mức tháng của phòng ban người nhận → `overNormReason` bắt buộc (`NORM_EXCEEDED`); không đủ khả dụng → `INSUFFICIENT_STOCK`.
- `receiverEmployeeId` bắt buộc, nhân viên `ACTIVE`, khác người giao. `items`: 1–50 (phiếu thường).

### Văn phòng phẩm

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/vpp/dashboard` | Số liệu + danh sách hết hàng / sắp hết / chưa rõ tồn + đề xuất mới |
| GET | `/api/admin/vpp/products`, `/api/admin/vpp/stock` | Sản phẩm + tồn (`?q=`, `stockStatus`, `catalogStatus`, `includeArchived`) |
| POST · PUT | `/api/admin/vpp/products` · `/api/admin/vpp/products/:id` | Thêm / sửa sản phẩm (không sửa tồn ở đây) → `{ product, duplicate? }`. Thêm: gửi lại cùng `clientRequestId` đúng thông tin → `duplicate: true`; cùng tên khác thông tin → 409 `REQUEST_REUSED`; tên khác → 409 `CONFLICT` |
| GET | `/api/admin/vpp/norms` | `{ norms[], scopes[], departments[{ department, employeeCount, scope, mapping }] }` |
| POST · PUT | `/api/admin/vpp/norms` · `/api/admin/vpp/norms/:id` | Thêm / sửa định mức (không trùng phạm vi + sản phẩm đang hiệu lực) |
| PUT | `/api/admin/vpp/scope-mapping` | `{ department, scopeId }` — `""` = tự khớp theo tên, `"NONE"` = không áp dụng |
| POST | `/api/admin/vpp/stock/in` | `{ productId, quantity, reasonType, unitPrice?, date?, note, clientRequestId }` → `IN` / `INITIAL` → `{ product, duplicate }` |
| POST | `/api/admin/vpp/stock/adjust` | `{ productId, countedQuantity, reason, clientRequestId }` → `ADJUSTMENT` → `{ product, duplicate }` |

Nhập kho / kiểm kê gửi lại cùng `clientRequestId`: đúng số → `duplicate: true` (không ghi lần hai); số khác → 409 `REQUEST_REUSED`
nêu số đã ghi. Giao diện giữ lại mã của lần bấm lỗi chưa rõ kết quả (mất mạng, hết thời gian chờ) khi mở lại hộp thoại cho cùng
sản phẩm — không ghi hai lần dù người dùng đóng hộp thoại rồi nhập lại.
| GET | `/api/admin/vpp/movements` | Lịch sử kho (`page`, `pageSize`, `productId`, `type`, `from`, `to`, `q`) |
| GET | `/api/admin/vpp/handover-context` | `?receiverEmployeeId=&handoverId=` → sản phẩm + khả dụng + định mức tháng của người nhận |
| GET | `/api/admin/vpp/proposals`, `/api/admin/vpp/proposals/:id` | Danh sách (`status`, `q`, phân trang, thống kê) / chi tiết + lịch sử |
| POST | `/api/admin/vpp/proposals/:id/approve` | `{ decisions: [{ proposalItemId, approvedQuantity, approvedPrice }], adminNote }` (đủ mọi dòng) |
| POST | `/api/admin/vpp/proposals/:id/reject` | `{ reason }` (bắt buộc) |
| POST | `/api/admin/vpp/proposals/:id/purchased` · `/close` | `{ note? }` |
| POST | `/api/admin/vpp/proposals/:id/receive` | `{ lines: [{ proposalItemId, receivedQuantity, unitPrice }], receivedDate, note }` → `IN`. Mọi dòng số 0 → 422 (không chuyển “Đã nhập kho” — dùng Đóng đề xuất); dòng duyệt 0 không nhận hàng (422); lần trước đã nhập kho dòng đó (mất phản hồi) mà gửi số khác → 422 nêu số đã nhập, không nhập thêm |
| POST | `/api/admin/vpp/proposals/:id/items/:itemId/decision` | Sản phẩm mới: `{ decision: MASTER \| TEMP \| MAP \| REJECT, …, convertedQuantity?, unitConverted? }` — ĐVT mới của dòng (sản phẩm đích khi GHÉP, ĐVT nhập khi thêm vào danh mục / giữ tạm) khác ĐVT đề xuất (so **giữ dấu**) → bắt buộc số lượng đã quy đổi + `unitConverted: true`. Trạng thái đề xuất tự tính lại sau quyết định |
| GET | `/api/admin/vpp/data-review` | Dữ liệu cần kiểm tra (chưa ghép + gợi ý, thiếu ĐVT, số lượng chưa rõ, trùng tên, phòng ban chưa gắn, phiếu lệch kho, `stockDrifts[]` số tồn lệch sổ biến động…) |
| POST | `/api/admin/vpp/data-review/merge` | GHÉP `{ sourceProductId, targetProductId, quantity?, unitConverted, reason }` → `{ merged, target, norms: { moved[], deactivated[] } }` — ĐVT khác nhau (so **giữ dấu**: “Cuốn” ≠ “Cuộn”) / một bên chưa có ĐVT: bắt buộc `quantity` đã quy đổi + `unitConverted: true`. Định mức đang bật của nguồn: cùng ĐVT và đích chưa có định mức phạm vi đó → chuyển sang đích; còn lại → ngừng áp dụng (tên phạm vi trong `norms`) |
| POST | `/api/admin/vpp/data-review/promote` · `/skip` | TẠO SẢN PHẨM MỚI / BỎ QUA (không áp dụng cho sản phẩm chờ duyệt từ đề xuất) |
| POST | `/api/admin/vpp/data-review/sync-stock` | `{ productId }` — đặt số tồn theo sổ biến động (có ghi lịch sử) → `{ synced, product }` |

### Văn phòng phẩm — phiếu nhập / xuất, cập nhật từ Excel *(v2.1)*

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/admin/vpp/stock/receipt` | Phiếu nhập: `{ reasonType, date, supplier, invoiceNo, note, updatePrice, lines: [{ productId, quantity, unitPrice, note }] (1–300), clientRequestId }` → 201 `{ voucher, duplicate }` (gửi lại → 200 `duplicate: true`; khác nội dung → 409 `REQUEST_REUSED`) |
| POST | `/api/admin/vpp/stock/issue` | Phiếu xuất: `{ date, department, receiverEmployeeId, receiverName, note, lines: [{ productId, quantity, note }], clientRequestId }` (cần phòng ban hoặc người nhận) → 201 `{ voucher, duplicate, warnings[] }`; vượt khả dụng → 409 `INSUFFICIENT_STOCK` (`details.shortages[]`, `fieldErrors["lines.i.quantity"]`) |
| GET | `/api/admin/vpp/vouchers` | `?type=IN\|OUT&from=&to=&department=&q=&page=&pageSize=` → `{ items[], total, page, pageSize, issueSummary { departments[], totals, total, rows[{ productId, productName, unit, byDepartment, total }] }, departments[] }` |
| GET | `/api/admin/vpp/vouchers/:id` | `{ voucher: { …, lines[{ productId, productName, unit, movementType, quantity, unitPrice, amount, onHandBefore, onHandAfter }] } }` |
| POST | `/api/admin/vpp/import/preview` | Xem trước cập nhật từ Excel (không ghi): `{ rows: [{ line, code, name, unit, price, stock, minimumStock, matchProductId? }] (≤ 3000), options: { setStock, archiveMissing }, fileName }` → `{ plan: { summary, creates[], updates[], stockChanges[], archives[], kept[], skipped[], warnings[], suggestions[] } }` |
| POST | `/api/admin/vpp/import/apply` | Như trên + `clientRequestId` → `{ result: { …summary, fileName, at }, duplicate }` (gửi lại cùng mã → `duplicate: true`, không làm lại) |

Xuất CSV: `vpp-vouchers.csv` (bộ lọc như `/vouchers`) — một dòng / mặt hàng của phiếu.

### Đồng phục *(v2.1 — [DONG_PHUC.md](DONG_PHUC.md))*

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/uniform/dashboard` | Số liệu (tồn, size hết / sắp hết, đang mượn / quá hạn, đã cấp trong năm, thiếu size / giới tính, vượt tiêu chuẩn), cảnh báo, đồ mượn quá hạn, phiếu gần đây |
| GET | `/api/admin/uniform/stock` | `?q=&includeInactive=` → `{ models: [{ …mẫu, stock (tổng hợp), skus: [{ productId, skuCode, size, condition, stock }] }] }` |
| POST · PUT | `/api/admin/uniform/models` · `/api/admin/uniform/models/:id` | Thêm (201; gửi lại cùng `clientRequestId` → 200 `duplicate: true`) / sửa mẫu `{ modelCode?, modelName, kind, gender, sizes[], unit, referencePrice, countsTowardQuota, minimumStock, appliesTo, note, active }`. Bỏ size còn tồn / giữ chỗ → 409 `INVALID_STATE` |
| POST | `/api/admin/uniform/stock/in` | `{ modelId, size, condition, quantity, reasonType (MUA_MOI \| TON_DAU_KY \| CHUYEN_KHO \| KHAC), unitPrice?, date?, note, clientRequestId }` → `{ sku, duplicate }` |
| POST | `/api/admin/uniform/stock/adjust` | `{ productId, countedQuantity, reason, clientRequestId }` → `ADJUSTMENT` |
| POST | `/api/admin/uniform/stock/dispose` | `{ productId, quantity, reason, clientRequestId }` → `DISPOSE` (không thấp hơn số đang giữ chỗ) |
| GET | `/api/admin/uniform/movements` | Sổ biến động (`page`, `pageSize`, `modelId`, `productId`, `type`, `from`, `to`, `q`) |
| GET | `/api/admin/uniform/norms` | `{ norms[], scopes[], departments[{ department, employeeCount, scope, mapping }], defaultYearlyQuota }` |
| POST · PUT | `/api/admin/uniform/norms` · `/api/admin/uniform/norms/:id` | `{ scopeId \| scopeName (nhóm mới), modelId ("" = tổng mọi mẫu), gender ("" \| NAM \| NU), yearlyQuantity, note, effectiveFrom, effectiveTo, active }` |
| PUT | `/api/admin/uniform/scope-mapping` | `{ department, scopeId }` — `""` = tự khớp / mặc định, `"NONE"` = không áp dụng tiêu chuẩn |
| GET | `/api/admin/uniform/employees` | Sổ cấp phát: `?year=&q=&department=&includeInactive=` → `{ year, employees[{ …, usage { yearlyQuota, source, issued, pending, legacy, remaining }, modelQuotas[], holdings, suggestedModelIds[] }], stats }` |
| GET | `/api/admin/uniform/employees/:employeeId` | Hồ sơ đồng phục: `{ employee, holdings[], returns[], issues[], legacyItems[] }` (`?year=`) |
| PUT | `/api/admin/uniform/employees/:employeeId/profile` | `{ gender ("" \| NAM \| NU), uniformSize }` → ghi `NHAN_VIEN.gender / uniform_size` |
| GET | `/api/admin/uniform/handover-context` | `?receiverEmployeeId=&handoverId=` → người nhận (giới tính, size), tiêu chuẩn + đã dùng, mẫu + mặt hàng + khả dụng (cộng phần đang giữ cho chính phiếu đang sửa) |
| GET | `/api/admin/uniform/holdings` | `?status=loans \| overdue \| outstanding \| all&employeeId=&q=` → `{ items[], total, stats { loans, overdue, dueSoon, issued } }` |
| POST | `/api/admin/uniform/returns` | `{ handoverId, itemId, quantity, result (RESTOCK \| DAMAGED \| LOST), restockCondition, reason, note, clientRequestId }` → 201 `{ record, holding, duplicate }` (gửi lại cùng mã → 200 `duplicate: true`; khác nội dung → 409 `REQUEST_REUSED`) |

Phiếu đồng phục: `POST /api/admin/handovers` với `handoverType: "UNIFORM"`, `items: []`, `supplies: []`,
`uniforms: [{ productId, quantity, issueKind (CAP_PHAT \| CHO_MUON), dueDate (bắt buộc khi cho mượn), note, overQuotaReason }]`.
Vượt tiêu chuẩn năm mà dòng cấp phát chưa có `overQuotaReason` → 422 `NORM_EXCEEDED`; không đủ khả dụng → 409 `INSUFFICIENT_STOCK`.
Xuất CSV: `uniform-stock.csv` (`q`, `includeInactive`), `uniform-movements.csv` (bộ lọc như sổ biến động), `uniform-employees.csv`
(`year`, `q`, `department`), `uniform-holdings.csv` (`status`, `q`).

## Apps Script (nội bộ, chỉ Worker gọi)

`POST <GAS_WEB_APP_URL>` với envelope ký HMAC (xem [ARCHITECTURE.md](ARCHITECTURE.md)). Mỗi action có **scope**; gọi sai scope → `FORBIDDEN`.

- `public`: `health`, `getHandoverByToken`, `requestConfirmOtp`, `confirmHandover`, `requestRevision`, `getPdfByToken`,
  `vppEmployeeLookup`, `vppPublicCatalog`, `vppSubmitProposal`
- `system`: `generatePdf`
- `admin` (kèm `actor` = người thao tác): `adminOverview`, `adminBadges`, `adminSystemInfo`, `adminListEmployees`, `adminListCategories`,
  `adminCreateHandover`, `adminListHandovers`, `adminGetHandover`, `adminUpdateHandover`, `adminCancelHandover`,
  `adminRegenerateLink`, `adminGetSignature`, `adminGetPdf`, `adminGeneratePdf`, `refreshCache`, `vppDashboard`,
  `vppListProducts`, `vppSaveProduct`, `vppListNorms`, `vppSaveNorm`, `vppSetScopeMapping`, `vppStockIn`, `vppStockAdjust`,
  `vppListMovements`, `vppHandoverContext`, `vppReconcileHandover`, `vppDataReview`, `vppMergeProduct`, `vppPromoteProduct`,
  `vppSkipReview`, `vppSyncStock`, `vppListProposals`, `vppGetProposal`, `vppReviewProposal`, `vppRejectProposal`,
  `vppSetProposalStatus`, `vppReceiveProposal`, `vppProductDecision`, *(v2.1)* `vppStockReceipt`, `vppStockIssue`, `vppListVouchers`,
  `vppGetVoucher`, `vppImportPlan`, `vppImportApply`, `dpDashboard`, `dpListStock`, `dpSaveModel`,
  `dpStockIn`, `dpStockAdjust`, `dpStockDispose`, `dpListMovements`, `dpListNorms`, `dpSaveNorm`, `dpSetScopeMapping`,
  `dpListEmployees`, `dpSaveEmployeeProfile`, `dpEmployeeDetail`, `dpHandoverContext`, `dpListHoldings`, `dpRecordReturn`

Payload các action kiểm tra niêm phong (`confirmHandover`, `adminGetHandover`, `adminGetSignature`, `adminGetPdf`, `adminGeneratePdf`,
`getPdfByToken`, `generatePdf`…) có thể kèm `sealKey` (khóa dẫn xuất từ `RECORD_SEAL_SECRET`) và *(v2.1)* `sealLegacyIds[]`
(từ `SEAL_LEGACY_IDS`) — không lưu ở Apps Script.

`adminListHandovers`, `vppListMovements`, `vppListProposals` nhận `exportAll: true` (boolean) → một trang tối đa 5.000 dòng theo
đúng bộ lọc (dùng cho xuất CSV).

`adminExportCsv` (`{ dataset, filters }`) là action **stream**: phản hồi là MỘT dòng phong bì JSON
`{"ok":true,"data":{"fileBase","rows","total"}}` + `\n` + nội dung CSV nguyên văn (lỗi → chỉ một dòng `{"ok":false,"error":…}`).
Worker chỉ đọc dòng đầu, phần còn lại chuyển thẳng cho trình duyệt; phong bì “ok” mà thiếu phần nội dung → 502 (không trả tệp rỗng).

Thao tác ký / xem biên bản đã ký (`confirmHandover`, `adminGetHandover`, `adminGetPdf`, `adminGeneratePdf`, `adminGetSignature`,
`getPdfByToken`, `generatePdf`, `adminUpdateHandover`, `adminCancelHandover`) nhận thêm `sealKey` — khóa niêm phong Worker suy ra
từ `RECORD_SEAL_SECRET` (không lưu ở Apps Script).

Khi `SCHEMA_VERSION` < 2 **hoặc** sheet thiếu sheet / cột mà code cần, mọi action trừ `health` và `adminSystemInfo` trả
`NOT_CONFIGURED` (kèm tên cột thiếu — chạy “Thiết lập / cập nhật database”). Mã nguồn Apps Script thiếu file (“thiếu code (…
is not defined)”) hoặc trộn file nhiều phiên bản → **mọi** action (kể cả `health`) trả `NOT_CONFIGURED`. Action không tồn tại →
`UNKNOWN_ACTION` (Worker báo `UPSTREAM_OUTDATED`: code Apps Script cũ hơn Worker).
