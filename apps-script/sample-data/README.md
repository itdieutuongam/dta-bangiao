# Dữ liệu nhân viên

| File | Dùng khi |
|---|---|
| `nhan_vien_template.csv` | Mẫu trống (chỉ dòng tiêu đề) để chuẩn bị **danh sách nhân viên thật**. |
| `nhan_vien_mau.csv` | 8 nhân viên **mẫu** (mã `DEMO-…`, email `@example.com`) để thử hệ thống. |

Cách nhanh hơn để có dữ liệu mẫu: chạy hàm `seedSampleEmployees()` trong Apps Script.
Xóa toàn bộ dữ liệu mẫu: `removeSampleEmployees()` (xóa mọi dòng có mã bắt đầu bằng `DEMO-`).

## Nhập danh sách thật vào sheet `NHAN_VIEN`

1. Mở Google Sheet → sheet `NHAN_VIEN`.
2. Giữ nguyên **dòng 1** (tiêu đề cột). Dán dữ liệu từ dòng 2 trở đi, đúng thứ tự cột:
   `employee_id, full_name, department, position, email, phone, status, created_at, updated_at`
   (hoặc File → Import → Upload CSV → *Append to current sheet*).
3. `status`: `ACTIVE` (hoặc để trống) = đang làm việc · `INACTIVE` = nghỉ việc (không hiện trong danh sách chọn).
4. `employee_id` phải **duy nhất**; có thể là số (`519`) hoặc chữ (`NV-0519`). Cột đã định dạng văn bản nên
   số 0 ở đầu (`0519`) được giữ nguyên.
5. Làm mới cache để web nhận dữ liệu mới ngay: menu **DTA Handover → Làm mới cache** (hoặc nút
   “Làm mới dữ liệu NV” trên trang quản trị). Nếu không làm gì, cache tự hết hạn sau ~10 phút.

Không cần sửa code hay build lại frontend khi thay đổi danh sách nhân viên.
