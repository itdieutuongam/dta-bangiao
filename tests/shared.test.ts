import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  adminListQuerySchema,
  confirmSchema,
  handoverInputSchema,
  normSaveSchema,
  proposalSubmitSchema,
  revisionSchema,
  stockAdjustSchema,
  stockInSchema,
  toFieldErrors,
} from '../shared/schemas';
import { containsPasswordLike, isHttpUrl, isValidDateOnly, normalizeVietnamese, stripControlChars } from '../shared/text';
import type { Category, Employee } from '../shared/types';
import { pickCategoryFields, validateItemsAgainstCategories } from '../shared/validation';
import { formatVnd } from '../shared/vpp';
import { buildEmployeeIndex, searchEmployees } from '../src/utils/employeeSearch';
import { numberFormatError, numberToInput, parseViNumber, withNumberFormatErrors } from '../src/utils/number';
import { searchProducts } from '../src/utils/productSearch';

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
  unit: '',
  condition: '',
  description: '',
  workStatus: '',
  deadline: '',
  documentUrl: '',
  note: '',
  ...overrides,
});

const HASH = 'a'.repeat(64);

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

  it('tìm văn phòng phẩm: "but bi" và "Bút bi" ra cùng sản phẩm; theo mã, ĐVT, nhóm', () => {
    const products = [
      { productName: 'Bút bi Thiên Long 027, xanh', productCode: 'VPP-0003', unit: 'Cây', category: 'Bút' },
      { productName: 'Bút lông dầu Thiên Long FO-PM09, xanh', productCode: 'VPP-0004', unit: 'Cây', category: 'Bút' },
      { productName: 'Giấy A4 Excel 80 gsm', productCode: 'VPP-0001', unit: 'Gream', category: 'Giấy' },
    ];
    const names = (q: string) => searchProducts(products, q).map((p) => p.productName);
    expect(names('but bi')).toEqual(['Bút bi Thiên Long 027, xanh']);
    expect(names('Bút bi')).toEqual(['Bút bi Thiên Long 027, xanh']);
    expect(names('vpp-0001')).toEqual(['Giấy A4 Excel 80 gsm']);
    expect(names('gream')).toEqual(['Giấy A4 Excel 80 gsm']);
    expect(names('thien long xanh')).toHaveLength(2);
    expect(names('')).toHaveLength(3);
  });
});

describe('Phát hiện mật khẩu & ký tự điều khiển', () => {
  it('chặn chuỗi dạng khai báo mật khẩu, không chặn câu thông thường', () => {
    for (const text of ['password: abc123', 'Mật khẩu: 123456', 'mat khau = x', 'MK: Abc@1', 'pass:1', 'pwd=hello']) {
      expect(containsPasswordLike(text), text).toBe(true);
    }
    for (const text of ['Đã đổi mật khẩu', 'Người nhận tự đặt lại mật khẩu', 'Compass: hướng bắc', 'bypass']) {
      expect(containsPasswordLike(text), text).toBe(false);
    }
  });

  it('bỏ ký tự định hướng chữ (bidi) và ký tự vô hình, giữ xuống dòng / tiếng Việt', () => {
    expect(stripControlChars('A‮gpj.exe​')).toBe('Agpj.exe');
    expect(stripControlChars('Tên⁦ẩn⁩﻿')).toBe('Tênẩn');
    expect(stripControlChars('Dòng 1\nDòng 2\tTab — Đỗ')).toBe('Dòng 1\nDòng 2\tTab — Đỗ');
  });
});

describe('Schema validation (dùng chung frontend + Worker)', () => {
  const valid = {
    handoverType: 'OTHER',
    sender: { name: '  Nguyễn   Văn An ', employeeId: '' },
    receiverEmployeeId: '519',
    note: 'Ghi chú',
    items: [item()],
  };

  it('chấp nhận dữ liệu hợp lệ và chuẩn hóa khoảng trắng', () => {
    const parsed = handoverInputSchema.parse(valid);
    expect(parsed.sender.name).toBe('Nguyễn Văn An');
    expect(parsed.items[0]?.quantity).toBe(1);
    expect(parsed.supplies).toEqual([]);
  });

  it('báo lỗi theo đúng đường dẫn field', () => {
    const errors = (input: unknown) => {
      const r = handoverInputSchema.safeParse(input);
      return r.success ? {} : toFieldErrors(r.error);
    };
    expect(errors({ ...valid, handoverType: undefined })).toHaveProperty(['handoverType']);
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

  it('phiếu văn phòng phẩm: bắt buộc chọn sản phẩm từ kho, không trùng dòng, không kèm nội dung nhập tay', () => {
    const productId = crypto.randomUUID();
    const supply = { handoverType: 'OFFICE_SUPPLY', sender: { name: 'Hương', employeeId: '' }, receiverEmployeeId: '519', items: [] };
    const errors = (input: unknown) => {
      const r = handoverInputSchema.safeParse(input);
      return r.success ? {} : toFieldErrors(r.error);
    };
    expect(errors({ ...supply, supplies: [] })).toHaveProperty(['supplies']);
    expect(errors({ ...supply, supplies: [{ productId: 'x', quantity: 1 }] })).toHaveProperty(['supplies.0.productId']);
    expect(errors({ ...supply, supplies: [{ productId, quantity: 0 }] })).toHaveProperty(['supplies.0.quantity']);
    expect(errors({ ...supply, supplies: [{ productId, quantity: 1 }, { productId, quantity: 2 }] })).toHaveProperty(['supplies.1.productId']);
    expect(errors({ ...supply, supplies: [{ productId, quantity: 1 }], items: [item()] })).toHaveProperty(['items']);
    expect(errors({ ...valid, supplies: [{ productId, quantity: 1 }] })).toHaveProperty(['supplies']);
    const parsed = handoverInputSchema.parse({ ...supply, supplies: [{ productId: productId.toUpperCase(), quantity: 3 }] });
    expect(parsed.supplies[0]).toEqual({ productId, quantity: 3, note: '', overNormReason: '' });
  });

  it('xác nhận bắt buộc tích ô đồng ý + chữ ký PNG + contentHash; yêu cầu chỉnh sửa cần lý do + contentHash', () => {
    expect(confirmSchema.safeParse({ agreed: false, contentHash: HASH, signature: 'data:image/png;base64,AAAA' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, contentHash: HASH, signature: 'data:image/jpeg;base64,AAAA' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, signature: 'data:image/png;base64,AAAA' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, contentHash: HASH, signature: 'data:image/png;base64,AAAA' }).success).toBe(true);
    expect(revisionSchema.safeParse({ reason: 'abc', contentHash: HASH }).success).toBe(false);
    expect(revisionSchema.safeParse({ reason: 'Laptop có vết xước' }).success).toBe(false);
    expect(revisionSchema.safeParse({ reason: 'Laptop có vết xước', contentHash: HASH }).success).toBe(true);
  });

  it('bộ lọc admin bỏ qua giá trị không hợp lệ', () => {
    expect(
      adminListQuerySchema.parse({ page: '-3', pageSize: '1000', status: 'XYZ', from: '2026-02-31', category: 'the', handoverType: 'abc' }),
    ).toMatchObject({ page: 1, pageSize: 20, status: '', from: '', category: '', handoverType: '' });
    expect(adminListQuerySchema.parse({ page: '2', status: 'CONFIRMED', from: '2026-10-01', handoverType: 'OFFICE_SUPPLY' })).toMatchObject({
      page: 2,
      status: 'CONFIRMED',
      from: '2026-10-01',
      handoverType: 'OFFICE_SUPPLY',
    });
  });

  it('kiểm tra ngày / URL', () => {
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    expect(isValidDateOnly('2026-02-29')).toBe(false);
    expect(isHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('schema văn phòng phẩm: nhập kho / kiểm kê / định mức / đề xuất', () => {
    const productId = crypto.randomUUID();
    const clientRequestId = crypto.randomUUID();
    expect(stockInSchema.safeParse({ productId, quantity: 0, reasonType: 'BO_SUNG', clientRequestId }).success).toBe(false);
    expect(stockInSchema.safeParse({ productId, quantity: 2, reasonType: 'KHAC', clientRequestId }).success).toBe(false); // KHAC cần ghi chú
    expect(stockInSchema.safeParse({ productId, quantity: 2, reasonType: 'MUA_TRUC_TIEP', unitPrice: 3100, clientRequestId }).success).toBe(true);
    expect(stockAdjustSchema.safeParse({ productId, countedQuantity: 3, reason: '', clientRequestId }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ productId, countedQuantity: -1, reason: 'Kiểm kê', clientRequestId }).success).toBe(false);
    expect(normSaveSchema.safeParse({ productId, monthlyQuantity: 5 }).success).toBe(false); // thiếu phạm vi
    expect(normSaveSchema.safeParse({ productId, scopeId: 'KINH_DOANH', monthlyQuantity: 5, effectiveFrom: '2026-10-10', effectiveTo: '2026-10-01' }).success).toBe(false);
    expect(proposalSubmitSchema.safeParse({ employeeId: '519', items: [] }).success).toBe(false);
    expect(proposalSubmitSchema.safeParse({ employeeId: '519', items: [{ quantity: 1 }] }).success).toBe(false); // thiếu sản phẩm
    expect(proposalSubmitSchema.safeParse({ employeeId: '519', items: [{ productName: 'Giấy note', quantity: 2, referenceUrl: 'ftp://x' }] }).success).toBe(false);
    expect(proposalSubmitSchema.safeParse({ employeeId: '519', items: [{ productName: 'Giấy note', quantity: 2, reason: 'Cần dùng' }] }).success).toBe(true);
    expect(formatVnd(323800)).toMatch(/323[.,\s]800/);
    expect(formatVnd(null)).toBe('—');
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
      handoverType: 'ASSET',
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
    const picked = pickCategoryFields(item({ category: 'THE', serialNumber: 'SN', quantity: 3, unit: 'Cái' }), categories[0]);
    expect(picked.serialNumber).toBe('');
    expect(picked.unit).toBe('');
    expect(picked.quantity).toBeNull();
    expect(picked.itemName).toBe('Laptop');
  });
});

describe('[RÀ SOÁT 3] Ô số kiểu Việt Nam (trước đây "15.000" lưu thành 15)', () => {
  it('dấu chấm / khoảng trắng phân cách hàng nghìn, như trang hiển thị "31.000 ₫"', () => {
    expect(parseViNumber('1.000')).toBe(1000);
    expect(parseViNumber('15.000', 'decimal')).toBe(15000);
    expect(parseViNumber('1.500.000', 'decimal')).toBe(1_500_000);
    expect(parseViNumber(' 1 000 ')).toBe(1000);
    const nbsp = String.fromCharCode(0xa0); // khoảng trắng không ngắt (dán từ Excel / trang web)
    expect(parseViNumber(`1${nbsp}000`)).toBe(1000);
    expect(parseViNumber('25')).toBe(25);
    expect(parseViNumber('007')).toBe(7);
    expect(parseViNumber('0')).toBe(0);
    expect(parseViNumber('-3')).toBe(-3); // schema tự báo "tối thiểu"
  });

  it('ô tiền: phần lẻ sau dấu phẩy', () => {
    expect(parseViNumber('12,5', 'decimal')).toBe(12.5);
    expect(parseViNumber('1.000,5', 'decimal')).toBe(1000.5);
    expect(parseViNumber('1.000,500', 'decimal')).toBe(1000.5);
  });

  it('cách viết hiểu được hai nghĩa → NaN (báo lỗi, không đoán)', () => {
    for (const text of ['1.5', '1.00', '1.0000', '1.', '.5', '1..000', '1,000', '15,000', 'abc', '1e3', '0x10', '+5', '5-']) {
      expect(Number.isNaN(parseViNumber(text, 'decimal')), text).toBe(true);
    }
    // Ô số nguyên không nhận phần lẻ.
    expect(Number.isNaN(parseViNumber('1,5'))).toBe(true);
    expect(Number.isNaN(parseViNumber('12,5'))).toBe(true);
  });

  it('để trống → null; thông báo định dạng chỉ cho chữ sai', () => {
    expect(parseViNumber('')).toBeNull();
    expect(parseViNumber('   ')).toBeNull();
    expect(numberFormatError('')).toBeNull();
    expect(numberFormatError('1.000')).toBeNull();
    expect(numberFormatError('1,5')).toMatch(/số nguyên/);
    expect(numberFormatError('15,000', 'decimal')).toMatch(/15\.000/);
    expect(withNumberFormatErrors({ quantity: 'Số lượng phải là số', note: 'x' }, { quantity: ['1,5', 'integer'], unitPrice: ['15.000', 'decimal'] })).toEqual({
      quantity: numberFormatError('1,5'),
      note: 'x',
    });
  });

  it('điền sẵn số có sẵn rồi đọc lại ra đúng số', () => {
    for (const n of [0, 7, 1000, 31000, 1_500_000, 12.5, 0.3, 1234.25]) {
      expect(parseViNumber(numberToInput(n), 'decimal')).toBe(n);
    }
    expect(numberToInput(null)).toBe('');
    expect(numberToInput(undefined)).toBe('');
    expect(numberToInput(Number.NaN)).toBe('');
  });
});
