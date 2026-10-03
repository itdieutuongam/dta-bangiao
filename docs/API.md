# API — DTA Handover (Cloudflare Worker)

Base URL: cùng domain với giao diện (ví dụ `https://bangiao.dieutuongam.com`). Body JSON (`Content-Type: application/json`).
Request thay đổi dữ liệu (POST/PUT) phải gửi từ cùng origin (header `Origin`).

## Định dạng response

```json
{ "success": true, "data": { }, "error": null }
```

```json
{ "success": false, "data": null, "error": { "code": "VALIDATION_ERROR", "message": "Chọn người nhận từ danh sách nhân viên",
  "details": { "fieldErrors": { "receiverEmployeeId": "Chọn người nhận từ danh sách nhân viên" } } } }
```

Mọi response có header `X-Request-Id` (đối chiếu log) và `Cache-Control: no-store`.

## Mã HTTP & mã lỗi

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 200 / 201 | — | Thành công / đã tạo |
| 400 | `BAD_REQUEST` | Body không phải JSON, sai Content-Type |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `STAFF_AUTH_REQUIRED` | Chưa đăng nhập / sai mật khẩu / cần mã truy cập nội bộ |
| 403 | `FORBIDDEN` | Origin khác domain (CSRF) |
| 404 | `NOT_FOUND` | Link/biên bản/API không tồn tại |
| 405 | `METHOD_NOT_ALLOWED` | Sai phương thức (header `Allow`) |
| 409 | `ALREADY_CONFIRMED`, `INVALID_STATE` | Đã xác nhận; trạng thái không cho phép thao tác |
| 413 | `PAYLOAD_TOO_LARGE` | Body / ảnh chữ ký quá lớn |
| 422 | `VALIDATION_ERROR`, `EMPLOYEE_NOT_FOUND`, `CATEGORY_NOT_FOUND` | Dữ liệu không hợp lệ (kèm `details.fieldErrors`) |
| 429 | `RATE_LIMITED` | Vượt giới hạn tần suất (header `Retry-After`) |
| 500 | `INTERNAL_ERROR`, `INTERNAL` | Lỗi hệ thống / lỗi xử lý tại Apps Script |
| 502 | `UPSTREAM_ERROR`, `UPSTREAM_AUTH_FAILED`, `DRIVE_ERROR`, `PDF_ERROR` | Apps Script trả dữ liệu lỗi / sai cấu hình secret / lỗi Drive |
| 503 | `NOT_CONFIGURED`, `LOCK_TIMEOUT`, `DEGRADED` | Chưa cấu hình; hệ thống bận; health không đạt |
| 504 | `UPSTREAM_TIMEOUT` | Apps Script phản hồi quá lâu |

## Công khai

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái Cloudflare / Apps Script / Sheet / Drive (200 hoặc 503 kèm `data`) |
| GET | `/api/employees` | Nhân viên ACTIVE: `{ employees: [{ employeeId, fullName, department, position, email }] }` |
| GET | `/api/categories` | Loại bàn giao đang dùng: `{ categories: [{ code, name, fields:[{key,label,required}], hint, sortOrder, active }] }` |
| GET | `/api/staff/session` | `{ required, authenticated }` — có yêu cầu mã truy cập nội bộ không |
| POST | `/api/staff/login` | `{ code }` → cookie phiên nhân viên (chỉ khi cấu hình `STAFF_ACCESS_CODE`) |
| POST | `/api/handover` | Tạo biên bản → **201** `{ id, code, status, createdAt, receiver, link }` |
| GET | `/api/handover/:token` | `{ handover, categories }` — dữ liệu người nhận xem |
| POST | `/api/handover/:token/confirm` | `{ agreed: true, signature: "data:image/png;base64,…", comment? }` → `{ handover }` |
| POST | `/api/handover/:token/request-revision` | `{ reason }` (≥ 5 ký tự) → `{ handover }` |
| GET | `/api/handover/:token/pdf` | PDF (`application/pdf`, attachment) — chỉ khi đã xác nhận |

`/api/employees`, `/api/categories`, `POST /api/handover` yêu cầu phiên nhân viên hoặc admin khi có `STAFF_ACCESS_CODE`.

### Body tạo / sửa biên bản

```json
{
  "sender": { "name": "Nguyễn Văn An", "employeeId": "101" },
  "receiverEmployeeId": "519",
  "note": "Bàn giao khi chuyển công tác",
  "items": [
    {
      "category": "THIET_BI_CNTT",
      "itemName": "Laptop Dell Latitude 5440",
      "assetCode": "TS-0001",
      "serialNumber": "5CG1234XYZ",
      "model": "Latitude 5440",
      "quantity": 1,
      "condition": "Tốt",
      "description": "Kèm sạc 65W",
      "workStatus": "",
      "deadline": "",
      "documentUrl": "",
      "note": ""
    }
  ]
}
```

- `sender.employeeId` để trống nếu người giao nhập tên tự do; nếu có, phải tồn tại trong `NHAN_VIEN`.
- `receiverEmployeeId` bắt buộc, nhân viên `ACTIVE`, khác người giao.
- `items`: 1–50; `category` là `code` trong `LOAI_BAN_GIAO`; trường bắt buộc theo `form_fields`; trường không thuộc loại bị bỏ qua.
- `quantity`: số nguyên 1–100000 hoặc `null`; `deadline`: `YYYY-MM-DD` hoặc `""`; `documentUrl`: `http(s)://…` hoặc `""`.

### `handover` (người nhận xem)

```json
{
  "code": "BG-20261003-0001", "status": "PENDING",
  "createdAt": "2026-10-03T18:07:00+07:00", "updatedAt": "…", "confirmedAt": "", "revisionRequestedAt": "",
  "cancelledAt": "", "cancelReason": "", "receiverComment": "", "note": "…",
  "sender": { "name": "Nguyễn Văn An", "employeeId": "101" },
  "receiver": { "employeeId": "519", "name": "Phạm Danh Thái", "department": "KHTH", "position": "Nhân viên", "email": "…" },
  "items": [{ "itemId": "…", "itemOrder": 1, "category": "THIET_BI_CNTT", "itemName": "…" }],
  "hasPdf": false
}
```

## Quản trị (cookie phiên admin)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/admin/login` | `{ password }` → `Set-Cookie` phiên (HttpOnly, Secure, SameSite=Lax, Path=/) |
| POST | `/api/admin/logout` | Xóa cookie |
| GET | `/api/admin/me` | `{ authenticated, expiresAt }` hoặc 401 |
| GET | `/api/admin/handovers` | Danh sách + thống kê. Query: `page`, `pageSize` (5–100), `code`, `employeeName`, `employeeId`, `sender`, `receiver`, `department`, `category`, `status`, `from`, `to` (`YYYY-MM-DD`). Tìm kiếm không phân biệt dấu |
| GET | `/api/admin/handovers/:id` | `{ handover: { …, id, signatureAvailable, pdfAvailable, confirmedUserAgent, history[], link }, categories }` |
| PUT | `/api/admin/handovers/:id` | Sửa (body như tạo) — chỉ `PENDING`/`REVISION_REQUESTED` → `{ handover, categories, linkRotated }` |
| POST | `/api/admin/handovers/:id/cancel` | `{ reason? }` — chỉ khi chưa xác nhận |
| POST | `/api/admin/handovers/:id/regenerate-link` | → `{ link }` (link cũ hết hiệu lực) |
| GET | `/api/admin/handovers/:id/signature` | Ảnh PNG chữ ký |
| GET | `/api/admin/handovers/:id/pdf` | PDF (tự sinh nếu chưa có) |
| POST | `/api/admin/handovers/:id/pdf` | Tạo lại PDF → `{ pdfAvailable: true }` |
| POST | `/api/admin/cache/refresh` | Làm mới cache nhân viên / loại bàn giao → `{ employees, categories }` |

Danh sách:

```json
{
  "items": [{ "id": "…", "code": "BG-20261003-0001", "status": "CONFIRMED", "createdAt": "…", "senderName": "…",
              "receiverName": "…", "receiverEmployeeId": "519", "receiverDepartment": "KHTH", "itemCount": 3,
              "categories": ["THIET_BI_CNTT", "THE"] }],
  "total": 42, "page": 1, "pageSize": 20,
  "stats": { "total": 42, "PENDING": 5, "CONFIRMED": 35, "REVISION_REQUESTED": 1, "CANCELLED": 1 },
  "departments": ["Hành chính", "KHTH", "Kế toán"]
}
```

## Apps Script (nội bộ, chỉ Worker gọi)

`POST <GAS_WEB_APP_URL>` với envelope ký HMAC (xem [ARCHITECTURE.md §3](ARCHITECTURE.md#3-giao-thức-worker--apps-script)).
Actions: `health`, `listEmployees`, `listCategories`, `createHandover`, `getHandoverByToken`, `confirmHandover`,
`requestRevision`, `getPdfByToken`, `generatePdf` (system), `adminListHandovers`, `adminGetHandover`, `adminUpdateHandover`,
`adminCancelHandover`, `adminRegenerateLink`, `adminGetSignature`, `adminGetPdf`, `adminGeneratePdf`, `refreshCache` (admin).
