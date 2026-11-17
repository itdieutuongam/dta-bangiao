import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newToken, setCell, setupGas } from './helpers';

/**
 * Văn phòng phẩm v2.1 — phiếu nhập kho / phiếu xuất kho nhiều mặt hàng, cập nhật danh mục + tồn kho từ file Excel
 * (Apps Script thật trong bộ giả lập).
 */

type Env = ReturnType<typeof setupGas>;

const rid = () => crypto.randomUUID();

function vppEnv() {
  return setupGas({ vpp: true });
}

function products(env: Env) {
  return env.admin('vppListProducts', { includeArchived: true }).data.products as any[];
}

function product(env: Env, name: string) {
  const p = products(env).find((x) => x.productName === name);
  if (!p) throw new Error(`Không thấy sản phẩm ${name}`);
  return p;
}

function receipt(env: Env, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return env.admin('vppStockReceipt', { reasonType: 'MUA_TRUC_TIEP', date: '2026-11-17', supplier: 'Khai Trí', invoiceNo: 'HD-001', note: '', lines, clientRequestId: rid(), ...extra });
}

function issue(env: Env, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return env.admin('vppStockIssue', { date: '2026-11-17', department: 'Kế toán', note: '', lines, clientRequestId: rid(), ...extra });
}

describe('VPP — phiếu nhập kho nhiều mặt hàng', () => {
  it('nhập nhiều mặt hàng một lần: mã NK, đơn giá, nhà cung cấp; gửi lại không nhập 2 lần; khác nội dung → REQUEST_REUSED', () => {
    const env = vppEnv();
    const a4 = product(env, 'Giấy A4 Excel 80 gsm');
    const pin = product(env, 'Pin 2A Maxell');
    const payload = {
      reasonType: 'MUA_TRUC_TIEP', date: '2026-11-17', supplier: 'Khai Trí', invoiceNo: 'HD-001', note: 'Nhập tháng 11', updatePrice: true,
      lines: [
        { productId: a4.productId, quantity: 5, unitPrice: 55600 },
        { productId: pin.productId, quantity: 10, unitPrice: 3500, note: 'vỉ 2 viên' },
      ],
      clientRequestId: rid(),
    };
    const res = env.admin('vppStockReceipt', payload);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    const v = res.data.voucher;
    expect(v.voucherCode).toMatch(/^NK-\d{8}-0001$/);
    expect(v).toMatchObject({ voucherType: 'IN', supplier: 'Khai Trí', invoiceNo: 'HD-001', lineCount: 2, totalQuantity: 15, totalAmount: 313000 });
    expect(v.lines.map((l: any) => [l.productName, l.quantity, l.unitPrice, l.amount])).toEqual(
      expect.arrayContaining([
        ['Giấy A4 Excel 80 gsm', 5, 55600, 278000],
        ['Pin 2A Maxell', 10, 3500, 35000],
      ]),
    );
    expect(product(env, 'Giấy A4 Excel 80 gsm').stock.onHand).toBe((a4.stock.onHand ?? 0) + 5);
    expect(product(env, 'Pin 2A Maxell').referencePrice).toBe(3500);

    const again = env.admin('vppStockReceipt', payload);
    expect(again.data).toMatchObject({ duplicate: true, voucher: { voucherCode: v.voucherCode } });
    expect(product(env, 'Giấy A4 Excel 80 gsm').stock.onHand).toBe((a4.stock.onHand ?? 0) + 5);
    const changed = env.admin('vppStockReceipt', { ...payload, lines: [{ productId: a4.productId, quantity: 7 }] });
    expect(changed.error?.code).toBe('REQUEST_REUSED');

    // Sổ biến động: dòng nhập có voucher_id + đơn giá; tồn tổng hợp khớp sổ.
    const moves = env.admin('vppListMovements', { productId: pin.productId }).data.items;
    expect(moves[0]).toMatchObject({ movementType: 'IN', quantity: 10, voucherCode: v.voucherCode, unitPrice: 3500 });
    expect(env.rt.run('stockLedgerDrifts_')).toEqual([]);
  });

  it('mặt hàng tồn CHƯA RÕ: nhập thường bị từ chối (báo đúng dòng), lý do "Tồn đầu kỳ" thì được; mặt hàng trùng dòng → lỗi', () => {
    const env = vppEnv();
    const kep = product(env, 'Hột quẹt');
    setCell(env, 'VPP_TON_KHO', 'product_id', kep.productId, 'on_hand', '');
    setCell(env, 'VPP_TON_KHO', 'product_id', kep.productId, 'needs_review', 'TRUE');
    const pin = product(env, 'Pin 2A Maxell');
    const bad = receipt(env, [{ productId: pin.productId, quantity: 1 }, { productId: kep.productId, quantity: 4 }]);
    expect(bad.error?.code).toBe('VALIDATION_ERROR');
    expect(bad.error?.details?.fieldErrors).toHaveProperty(['lines.1.productId']);
    expect(product(env, 'Pin 2A Maxell').stock.onHand).toBe(pin.stock.onHand); // không ghi nửa vời

    const ok = receipt(env, [{ productId: kep.productId, quantity: 4 }], { reasonType: 'TON_DAU_KY' });
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(product(env, 'Hột quẹt').stock).toMatchObject({ onHand: 4 });

    const dup = receipt(env, [{ productId: pin.productId, quantity: 1 }, { productId: pin.productId, quantity: 2 }]);
    expect(dup.error?.details?.fieldErrors).toHaveProperty(['lines.1.productId']);
  });
});

describe('VPP — phiếu xuất kho (xuất trực tiếp cho phòng ban)', () => {
  it('xuất nhiều mặt hàng: trừ tồn (không đụng giữ chỗ), mã XK, chỉ xuất phần khả dụng, báo đủ mọi dòng thiếu', () => {
    const env = vppEnv();
    const a4 = product(env, 'Giấy A4 Excel 80 gsm');
    const pin = product(env, 'Pin 2A Maxell');
    expect(receipt(env, [{ productId: a4.productId, quantity: 10 }, { productId: pin.productId, quantity: 6 }]).ok).toBe(true);
    // Một phiếu bàn giao VPP chờ ký đang giữ 3 ram giấy → khả dụng = 7.
    const token = newToken();
    const held = env.admin('adminCreateHandover', {
      handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '',
      supplies: [{ productId: a4.productId, quantity: 3, note: '', overNormReason: 'test' }], tokenHash: token.hash, tokenNonce: token.nonce,
      client: { ipHash: 'a'.repeat(32), userAgent: 'vitest' }, clientRequestId: rid(),
    });
    expect(held.ok, JSON.stringify(held.error)).toBe(true);

    const tooMuch = issue(env, [{ productId: a4.productId, quantity: 8 }, { productId: pin.productId, quantity: 7 }]);
    expect(tooMuch.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(tooMuch.error?.details?.shortages).toHaveLength(2);
    expect(tooMuch.error?.details?.fieldErrors).toHaveProperty(['lines.0.quantity']);

    const before = product(env, 'Giấy A4 Excel 80 gsm').stock;
    const out = issue(env, [{ productId: a4.productId, quantity: 7 }, { productId: pin.productId, quantity: 2, note: 'pin chuột' }], { department: 'HCNS' });
    expect(out.ok, JSON.stringify(out.error)).toBe(true);
    expect(out.data.voucher.voucherCode).toMatch(/^XK-\d{8}-0001$/);
    expect(out.data.voucher).toMatchObject({ voucherType: 'OUT', department: 'HCNS', totalQuantity: 9 });
    expect(out.data.warnings.map((w: any) => w.productName)).toContain('Giấy A4 Excel 80 gsm'); // còn 0 khả dụng
    expect(product(env, 'Giấy A4 Excel 80 gsm').stock).toMatchObject({ onHand: before.onHand - 7, reserved: 3, available: 0 });
    const moves = env.admin('vppListMovements', { productId: pin.productId, type: 'ISSUE' }).data.items;
    expect(moves[0]).toMatchObject({ movementType: 'ISSUE', quantity: 2, department: 'HCNS', voucherCode: out.data.voucher.voucherCode });
    expect(env.rt.run('stockLedgerDrifts_')).toEqual([]);
  });

  it('người nhận là nhân viên → tự lấy phòng ban; thiếu cả phòng ban lẫn người nhận → lỗi; tổng xuất theo phòng ban; CSV', () => {
    const env = vppEnv();
    const a4 = product(env, 'Giấy A4 Excel 80 gsm');
    const pin = product(env, 'Pin 2A Maxell');
    expect(receipt(env, [{ productId: a4.productId, quantity: 20 }, { productId: pin.productId, quantity: 20 }]).ok).toBe(true);
    expect(issue(env, [{ productId: a4.productId, quantity: 1 }], { department: '' }).error?.details?.fieldErrors).toHaveProperty('department');

    const byEmployee = issue(env, [{ productId: a4.productId, quantity: 2 }], { department: '', receiverEmployeeId: 'DEMO-102' });
    expect(byEmployee.ok, JSON.stringify(byEmployee.error)).toBe(true);
    expect(byEmployee.data.voucher).toMatchObject({ department: 'Kế toán', receiverEmployeeId: 'DEMO-102', receiverName: 'Trần Thị Bích Ngọc' });
    expect(issue(env, [{ productId: a4.productId, quantity: 3 }, { productId: pin.productId, quantity: 4 }], { department: 'Showroom' }).ok).toBe(true);
    expect(issue(env, [{ productId: pin.productId, quantity: 1 }], { department: 'Kế toán' }).ok).toBe(true);

    const list = env.admin('vppListVouchers', { type: 'OUT' }).data;
    expect(list.total).toBe(3);
    expect(list.issueSummary.departments).toEqual(['Kế toán', 'Showroom']);
    expect(list.issueSummary.totals).toEqual({ 'Kế toán': 3, Showroom: 7 });
    const a4Row = list.issueSummary.rows.find((r: any) => r.productName === 'Giấy A4 Excel 80 gsm');
    expect(a4Row).toMatchObject({ byDepartment: { 'Kế toán': 2, Showroom: 3 }, total: 5 });
    expect(list.departments).toEqual(expect.arrayContaining(['Kế toán', 'Showroom', 'IT']));
    expect(env.admin('vppListVouchers', { type: 'OUT', department: 'ke toan' }).data.total).toBe(2);
    expect(env.admin('vppListVouchers', { type: 'IN' }).data.items[0].voucherType).toBe('IN');

    const detail = env.admin('vppGetVoucher', { id: list.items[0].voucherId }).data.voucher;
    expect(detail.lines.length).toBeGreaterThan(0);

    const csv = env.rt.run('apiAdminExportCsv_', { dataset: 'vpp-vouchers.csv', filters: { type: 'OUT' } }) as { header: { rows: number }; body: string };
    expect(csv.header.rows).toBe(4);
    expect(csv.body).toContain('"Số phiếu","Loại","Ngày","Mã VPP","Tên vật tư"');
    expect(csv.body).toMatch(/"XK-\d{8}-\d{4}","Phiếu xuất","2026-11-17",.*"Giấy A4 Excel 80 gsm"/);
  });

  it('gửi lại phiếu xuất (mất phản hồi) không trừ kho 2 lần', () => {
    const env = vppEnv();
    const pin = product(env, 'Pin 2A Maxell');
    expect(receipt(env, [{ productId: pin.productId, quantity: 5 }]).ok).toBe(true);
    const payload = { date: '2026-11-17', department: 'MKT', note: '', lines: [{ productId: pin.productId, quantity: 2 }], clientRequestId: rid() };
    expect(env.admin('vppStockIssue', payload).ok).toBe(true);
    const again = env.admin('vppStockIssue', payload);
    expect(again.data.duplicate).toBe(true);
    expect(product(env, 'Pin 2A Maxell').stock.onHand).toBe((pin.stock.onHand ?? 0) + 3);
  });
});

describe('VPP — cập nhật danh mục + tồn kho từ Excel', () => {
  function row(line: number, code: string, name: string, extra: Record<string, unknown> = {}) {
    return { line, code, name, unit: 'Cái', price: null, stock: null, minimumStock: null, ...extra };
  }

  it('xem trước: khớp theo mã / theo tên, thêm mới, đặt tồn, mã bị dùng, giữ ĐVT khi đang có tồn, gợi ý ghép', () => {
    const env = vppEnv();
    const a4 = product(env, 'Giấy A4 Excel 80 gsm');
    const pin = product(env, 'Pin 2A Maxell');
    expect(receipt(env, [{ productId: pin.productId, quantity: 6 }]).ok).toBe(true);
    const rows = [
      row(2, a4.productCode, 'Giấy A4 Excel 80 gsm', { unit: a4.unit, price: (a4.referencePrice ?? 0) + 1000, stock: 12 }), // theo mã: đổi giá + tồn
      row(3, 'P2006', 'Pin 2A Maxell', { unit: 'Vỉ', stock: 6 }), // theo tên: đổi mã; ĐVT khác nhưng đang có tồn → giữ
      row(4, 'G1155', 'Giấy Decal A4 đế xanh', { unit: 'Xấp/ 100 tờ', price: 72600, stock: 3 }), // mới
      row(5, a4.productCode, 'Một sản phẩm khác dùng trùng mã'), // mã đã dùng → mã tự cấp
      row(6, 'H3775', 'Bút bi Thiên Long FO-03 xanh', { stock: 8 }), // mới, có gợi ý "Bút bi Thiên Long 027, xanh"
    ];
    const plan = env.admin('vppImportPlan', { rows, options: { setStock: true, archiveMissing: false } }).data.plan;
    expect(plan.summary).toMatchObject({ rows: 5, create: 3, update: 2 });
    const a4Update = plan.updates.find((u: any) => u.line === 2);
    expect(a4Update).toMatchObject({ matchedBy: 'CODE' });
    expect(a4Update.changes.map((c: any) => c.field)).toContain('referencePrice');
    const pinUpdate = plan.updates.find((u: any) => u.line === 3);
    expect(pinUpdate).toMatchObject({ matchedBy: 'NAME' });
    expect(pinUpdate.changes.map((c: any) => c.field)).toEqual(['productCode']);
    expect(plan.warnings.map((w: any) => w.message).join(' ')).toContain('giữ ĐVT cũ');
    expect(plan.warnings.map((w: any) => w.message).join(' ')).toContain('được thêm mới với mã tự cấp');
    expect(plan.creates.find((c: any) => c.line === 5)).toMatchObject({ codeAuto: true });
    expect(plan.stockChanges.find((s: any) => s.line === 2)).toMatchObject({ after: 12, isNew: false });
    expect(plan.stockChanges.find((s: any) => s.line === 3)).toBeUndefined(); // tồn đã đúng 6
    expect(plan.stockChanges.find((s: any) => s.line === 4)).toMatchObject({ after: 3, isNew: true });
    const sug = plan.suggestions.find((s: any) => s.line === 6);
    expect(sug.candidates[0].productName).toBe('Bút bi Thiên Long 027, xanh');
    // Xem trước KHÔNG ghi gì.
    expect(products(env).some((p) => p.productName === 'Giấy Decal A4 đế xanh')).toBe(false);
  });

  it('áp dụng: ghi theo lô, tồn qua sổ (tồn đầu kỳ / kiểm kê), ghép tay theo gợi ý, gửi lại không làm 2 lần', () => {
    const env = vppEnv();
    const pen = product(env, 'Bút bi Thiên Long 027, xanh');
    const before = products(env).length;
    const requestId = rid();
    const rows = [
      row(2, 'G1155', 'Giấy Decal A4 đế xanh', { unit: 'Xấp/ 100 tờ', price: 72600, stock: 3 }),
      row(3, 'G1156', 'Decal A4 đế vàng', { unit: 'Xấp/ 100 tờ', price: 76000, stock: 0 }),
      row(4, 'H3775', 'Bút bi Thiên Long FO-03, xanh', { unit: 'Cây', stock: 8, matchProductId: pen.productId }),
    ];
    const payload = { rows, options: { setStock: true, archiveMissing: false }, fileName: 'Mau_theo_doi_VPP.xlsx', clientRequestId: requestId };
    const res = env.admin('vppImportApply', payload);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    expect(res.data.result).toMatchObject({ create: 2, update: 1, stockChanges: 2 });
    expect(products(env)).toHaveLength(before + 2);
    expect(product(env, 'Giấy Decal A4 đế xanh')).toMatchObject({ productCode: 'G1155', catalogStatus: 'MASTER', referencePrice: 72600, source: 'EXCEL' });
    expect(product(env, 'Giấy Decal A4 đế xanh').stock).toMatchObject({ onHand: 3, reserved: 0 });
    expect(product(env, 'Decal A4 đế vàng').stock).toMatchObject({ onHand: 0 });
    // Ghép tay: sản phẩm cũ đổi mã + tên, tồn đặt theo file qua kiểm kê (giữ lịch sử).
    expect(product(env, 'Bút bi Thiên Long FO-03, xanh')).toMatchObject({ productId: pen.productId, productCode: 'H3775' });
    expect(product(env, 'Bút bi Thiên Long FO-03, xanh').stock.onHand).toBe(8);
    const moves = env.admin('vppListMovements', { productId: pen.productId }).data.items;
    expect(moves[0]).toMatchObject({ movementType: 'ADJUSTMENT' });
    expect(moves[0].reason).toContain('Mau_theo_doi_VPP.xlsx');
    expect(env.rt.run('stockLedgerDrifts_')).toEqual([]);

    const again = env.admin('vppImportApply', payload);
    expect(again.data).toMatchObject({ duplicate: true, result: { create: 2 } });
    expect(products(env)).toHaveLength(before + 2);
    expect(product(env, 'Giấy Decal A4 đế xanh').stock.onHand).toBe(3);
  });

  it('tùy chọn ngừng dùng sản phẩm không có trong file: chỉ sản phẩm không còn tồn / giữ chỗ / định mức', () => {
    const env = vppEnv();
    const lonely = env.admin('vppSaveProduct', { productName: 'Sản phẩm cũ không dùng', unit: 'Cái', clientRequestId: rid() }).data.product;
    const stocked = env.admin('vppSaveProduct', { productName: 'Sản phẩm cũ còn tồn', unit: 'Cái', clientRequestId: rid() }).data.product;
    expect(receipt(env, [{ productId: stocked.productId, quantity: 2 }]).ok).toBe(true);
    const rows = [row(2, 'G1155', 'Giấy Decal A4 đế xanh')];
    const plan = env.admin('vppImportPlan', { rows, options: { setStock: true, archiveMissing: true } }).data.plan;
    expect(plan.archives.map((a: any) => a.productName)).toContain('Sản phẩm cũ không dùng');
    const kept = plan.kept.find((k: any) => k.productName === 'Sản phẩm cũ còn tồn');
    expect(kept.reason).toContain('còn tồn 2');
    expect(plan.kept.find((k: any) => k.productName === 'Giấy A4 Excel 80 gsm').reason).toContain('định mức');
    const res = env.admin('vppImportApply', { rows, options: { setStock: true, archiveMissing: true }, fileName: 'x.xlsx', clientRequestId: rid() });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    expect(product(env, 'Sản phẩm cũ không dùng').catalogStatus).toBe('ARCHIVED');
    expect(product(env, 'Sản phẩm cũ còn tồn').catalogStatus).not.toBe('ARCHIVED');
    expect(lonely.productId).toBeTruthy();
  });

  it('tồn trong file nhỏ hơn số đang giữ chỗ → không đổi tồn sản phẩm đó (cảnh báo); dữ liệu sai → VALIDATION_ERROR', () => {
    const env = vppEnv();
    const a4 = product(env, 'Giấy A4 Excel 80 gsm');
    expect(receipt(env, [{ productId: a4.productId, quantity: 5 }]).ok).toBe(true);
    const token = newToken();
    expect(env.admin('adminCreateHandover', {
      handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '',
      supplies: [{ productId: a4.productId, quantity: 4, note: '', overNormReason: 'test' }], tokenHash: token.hash, tokenNonce: token.nonce,
      client: { ipHash: 'a'.repeat(32), userAgent: 'vitest' }, clientRequestId: rid(),
    }).ok).toBe(true);
    const plan = env.admin('vppImportPlan', { rows: [row(2, '', 'Giấy A4 Excel 80 gsm', { unit: a4.unit, stock: 1 })], options: { setStock: true } }).data.plan;
    expect(plan.stockChanges).toHaveLength(0);
    expect(plan.warnings[0].message).toContain('đang giữ chỗ');
    const bad = env.admin('vppImportPlan', { rows: [row(2, 'MÃ SAI!', ''), row(3, 'OK1', 'Tên', { stock: -1 })], options: {} });
    expect(bad.error?.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(bad.error?.details?.fieldErrors ?? {})).toEqual(expect.arrayContaining(['rows.0.code', 'rows.0.name', 'rows.1.stock']));
  });
});
