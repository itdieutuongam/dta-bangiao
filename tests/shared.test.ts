import { describe, expect, it } from 'vitest';
import { adminListQuerySchema, confirmSchema, handoverInputSchema, revisionSchema, toFieldErrors } from '../shared/schemas';
import { containsPasswordLike, isHttpUrl, isValidDateOnly, normalizeVietnamese } from '../shared/text';
import type { Category, Employee } from '../shared/types';
import { pickCategoryFields, validateItemsAgainstCategories } from '../shared/validation';
import { buildEmployeeIndex, searchEmployees } from '../src/utils/employeeSearch';

const employees: Employee[] = [
  { employeeId: '519', fullName: 'Phạm Danh Thái', department: 'KHTH', position: 'Nhân viên', email: 'thai.pham@dieutuongam.com' },
  { employeeId: '101', fullName: 'Nguyễn Văn An', department: 'IT', position: 'Trưởng phòng', email: 'an.nguyen@dieutuongam.com' },
  { employeeId: '104', fullName: 'Đỗ Thị Hương', department: 'Hành chính', position: 'Chuyên viên', email: 'huong.do@dieutuongam.com' },
  { employeeId: '1519', fullName: 'Trần Thái Bình', department: 'Kế toán', position: 'Kế toán viên', email: 'binh.tran@dieutuongam.com' },
];

const item = (overrides: Record<string, unknown> = {}) => ({
  category: 'THIET_BI_CNTT',
  itemName: 'Laptop',
  assetCode: '',
  serialNumber: '',
  model: '',
  quantity: 1,
  condition: '',
  description: '',
  workStatus: '',
  deadline: '',
  documentUrl: '',
  note: '',
  ...overrides,
});

describe('Chuẩn hóa tiếng Việt & tìm nhân viên', () => {
  it('bỏ dấu, đ → d, gộp khoảng trắng', () => {
    expect(normalizeVietnamese('  Phạm   Danh THÁI ')).toBe('pham danh thai');
    expect(normalizeVietnamese('Đỗ Thị Hương')).toBe('do thi huong');
    expect(normalizeVietnamese('Nguyễn Ưng Ơn')).toBe('nguyen ung on');
  });

  it('tìm có dấu và không dấu, theo tên / mã / email / phòng ban', () => {
    const index = buildEmployeeIndex(employees);
    const names = (q: string) => searchEmployees(index, q).map((e) => e.fullName);
    expect(names('Pham Danh Thai')[0]).toBe('Phạm Danh Thái');
    expect(names('Phạm Danh Thái')[0]).toBe('Phạm Danh Thái');
    expect(names('do thi')).toEqual(['Đỗ Thị Hương']);
    expect(names('519')[0]).toBe('Phạm Danh Thái'); // khớp mã chính xác xếp trước "1519"
    expect(names('519')).toContain('Trần Thái Bình');
    expect(names('khth')).toEqual(['Phạm Danh Thái']);
    expect(names('huong.do@')).toEqual(['Đỗ Thị Hương']);
    expect(names('thai ke toan')).toEqual(['Trần Thái Bình']);
    expect(names('khong ton tai')).toEqual([]);
    expect(names('')).toHaveLength(4);
  });
});

describe('Phát hiện mật khẩu', () => {
  it('chặn chuỗi dạng khai báo mật khẩu, không chặn câu thông thường', () => {
    for (const text of ['password: abc123', 'Mật khẩu: 123456', 'mat khau = x', 'MK: Abc@1', 'pass:1', 'pwd=hello']) {
      expect(containsPasswordLike(text), text).toBe(true);
    }
    for (const text of ['Đã đổi mật khẩu', 'Người nhận tự đặt lại mật khẩu', 'Compass: hướng bắc', 'bypass']) {
      expect(containsPasswordLike(text), text).toBe(false);
    }
  });
});

describe('Schema validation (dùng chung frontend + Worker)', () => {
  const valid = {
    sender: { name: '  Nguyễn   Văn An ', employeeId: '' },
    receiverEmployeeId: '519',
    note: 'Ghi chú',
    items: [item()],
  };

  it('chấp nhận dữ liệu hợp lệ và chuẩn hóa khoảng trắng', () => {
    const parsed = handoverInputSchema.parse(valid);
    expect(parsed.sender.name).toBe('Nguyễn Văn An');
    expect(parsed.items[0]?.quantity).toBe(1);
  });

  it('báo lỗi theo đúng đường dẫn field', () => {
    const errors = (input: unknown) => {
      const r = handoverInputSchema.safeParse(input);
      return r.success ? {} : toFieldErrors(r.error);
    };
    expect(errors({ ...valid, sender: { name: '', employeeId: '' } })).toHaveProperty(['sender.name']);
    expect(errors({ ...valid, receiverEmployeeId: '' })).toHaveProperty(['receiverEmployeeId']);
    expect(errors({ ...valid, items: [] })).toHaveProperty(['items']);
    expect(errors({ ...valid, items: [item({ itemName: '', description: '' })] })).toHaveProperty(['items.0.itemName']);
    expect(errors({ ...valid, items: [item({ quantity: 1.5 })] })).toHaveProperty(['items.0.quantity']);
    expect(errors({ ...valid, items: [item({ deadline: '2026-13-01' })] })).toHaveProperty(['items.0.deadline']);
    expect(errors({ ...valid, items: [item({ documentUrl: 'ftp://x' })] })).toHaveProperty(['items.0.documentUrl']);
    expect(errors({ ...valid, items: [item({ note: 'password: 123' })] })).toHaveProperty(['items.0.note']);
    expect(errors({ ...valid, items: [item({ category: 'abc' })] })).toHaveProperty(['items.0.category']);
    expect(errors({ ...valid, sender: { name: 'A', employeeId: '519' } })).toHaveProperty(['receiverEmployeeId']);
    expect(errors({ ...valid, items: Array.from({ length: 51 }, () => item()) })).toHaveProperty(['items']);
    expect(errors({ ...valid, note: 'x'.repeat(2001) })).toHaveProperty(['note']);
  });

  it('xác nhận bắt buộc tích ô đồng ý + chữ ký PNG; yêu cầu chỉnh sửa cần lý do', () => {
    expect(confirmSchema.safeParse({ agreed: false, signature: 'data:image/png;base64,AAAA' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, signature: 'data:image/jpeg;base64,AAAA' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, signature: 'data:image/png;base64,AAAA' }).success).toBe(true);
    expect(revisionSchema.safeParse({ reason: 'abc' }).success).toBe(false);
    expect(revisionSchema.safeParse({ reason: 'Laptop có vết xước' }).success).toBe(true);
  });

  it('bộ lọc admin bỏ qua giá trị không hợp lệ', () => {
    expect(adminListQuerySchema.parse({ page: '-3', pageSize: '1000', status: 'XYZ', from: '2026-02-31', category: 'the' })).toMatchObject({
      page: 1,
      pageSize: 20,
      status: '',
      from: '',
      category: '',
    });
    expect(adminListQuerySchema.parse({ page: '2', status: 'CONFIRMED', from: '2026-10-01' })).toMatchObject({
      page: 2,
      status: 'CONFIRMED',
      from: '2026-10-01',
    });
  });

  it('kiểm tra ngày / URL', () => {
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    expect(isValidDateOnly('2026-02-29')).toBe(false);
    expect(isHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('Quy tắc theo loại bàn giao', () => {
  const categories: Category[] = [
    {
      code: 'THE',
      name: 'Thẻ',
      hint: '',
      sortOrder: 1,
      active: true,
      fields: [
        { key: 'itemName', label: 'Loại thẻ', required: true },
        { key: 'assetCode', label: 'Mã thẻ', required: true },
      ],
    },
  ];

  it('báo trường bắt buộc theo cấu hình, loại không tồn tại', () => {
    expect(validateItemsAgainstCategories([item({ category: 'THE', assetCode: '' })], categories)).toEqual({
      'items.0.assetCode': 'Mã thẻ là bắt buộc',
    });
    expect(validateItemsAgainstCategories([item({ category: 'XYZ' })], categories)).toHaveProperty(['items.0.category']);
  });

  it('bỏ giá trị của trường không thuộc loại', () => {
    const picked = pickCategoryFields(item({ category: 'THE', serialNumber: 'SN', quantity: 3 }), categories[0]);
    expect(picked.serialNumber).toBe('');
    expect(picked.quantity).toBeNull();
    expect(picked.itemName).toBe('Laptop');
  });
});
