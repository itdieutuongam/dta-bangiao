import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { confirmAs, contentHashOf, failNextAppend, failNextUpdate, newToken, setCell, setSetting, setupGas } from './helpers';

/**
 * Module Văn phòng phẩm trên bộ giả lập Apps Script: định mức, tồn đầu kỳ, rà soát dữ liệu, giữ chỗ / xuất kho theo phiếu,
 * đề xuất mua, nhập kho, kiểm kê, idempotency.
 */

type Env = ReturnType<typeof setupGas>;

function vppEnv(options: { initialStock?: boolean } = {}) {
  const env = setupGas({ vpp: true });
  if (options.initialStock) env.rt.run('seedInitialOfficeSupplyStock');
  return env;
}

function products(env: Env, q = '') {
  return env.admin('vppListProducts', { q, includeArchived: true }).data.products as any[];
}

function productByName(env: Env, name: string) {
  const p = products(env).find((x) => x.productName === name);
  if (!p) throw new Error(`Không thấy sản phẩm ${name}`);
  return p;
}

function stockIn(env: Env, productId: string, quantity: number, reasonType = 'BO_SUNG') {
  const res = env.admin('vppStockIn', { productId, quantity, reasonType, note: 'test', clientRequestId: crypto.randomUUID() });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return res.data.product;
}

function createSupplyHandover(env: Env, lines: Array<{ productId: string; quantity: number; overNormReason?: string }>, receiver = 'DEMO-103', extra: Record<string, unknown> = {}) {
  const token = newToken();
  const res = env.admin('adminCreateHandover', {
    handoverType: 'OFFICE_SUPPLY',
    sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' },
    receiverEmployeeId: receiver,
    note: '',
    supplies: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, note: '', overNormReason: l.overNormReason ?? '' })),
    tokenHash: token.hash,
    tokenNonce: token.nonce,
    client: { ipHash: 'a'.repeat(32), userAgent: 'vitest-admin' },
    clientRequestId: crypto.randomUUID(),
    ...extra,
  });
  return { res, token, id: res.data?.id as string, code: res.data?.code as string };
}

function stockOf(env: Env, name: string) {
  return productByName(env, name).stock;
}

describe('VPP – khởi tạo định mức & tồn đầu kỳ', () => {
  it('seedOfficeSupplyNorms: đúng số liệu bản định mức, không trùng khi chạy lại', () => {
    const env = vppEnv();
    const norms = env.admin('vppListNorms').data;
    expect(norms.norms).toHaveLength(30);
    expect(norms.scopes.map((s: any) => s.scopeId)).toEqual(['KINH_DOANH', 'VAN_PHONG']);
    const kd = norms.norms.filter((n: any) => n.scopeId === 'KINH_DOANH');
    const vp = norms.norms.filter((n: any) => n.scopeId === 'VAN_PHONG');
    expect(kd).toHaveLength(13);
    expect(vp).toHaveLength(17);
    const pen = kd.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    expect(pen).toMatchObject({ monthlyQuantity: 10, unit: 'Cây', referencePrice: 3100, note: 'Showroom 5\nHỗ trợ 3\nKho 2' });
    expect(vp.find((n: any) => n.productName === 'Giấy Toilet VP và Showroom')).toMatchObject({ monthlyQuantity: 25, unit: 'Cuộn', referencePrice: 30000 });
    expect(kd.find((n: any) => n.productName === 'Bao thư 12x22(không keo)')).toMatchObject({ unit: 'Xấp/100', note: '2 tháng đặt 1 lần' });
    // Tổng SL/tháng khớp bản nguồn: Phòng Kinh doanh 47; Văn phòng 88 (bản scan ghi 87 do dòng tổng bỏ sót dòng "Nước lau kiếng")
    expect(kd.reduce((s: number, n: any) => s + n.monthlyQuantity, 0)).toBe(47);
    expect(vp.reduce((s: number, n: any) => s + n.monthlyQuantity, 0)).toBe(88);
    // Cùng tên + ĐVT ở 2 phạm vi → 1 sản phẩm, 2 định mức; "Bao rác" ≠ "Bao rác 3 cuộn…" (không tự gộp)
    const master = products(env).filter((p) => p.catalogStatus === 'MASTER');
    expect(master).toHaveLength(24);
    expect(master.filter((p) => p.productName.startsWith('Bao rác'))).toHaveLength(3);
    expect(productByName(env, 'Giấy A4 Excel 80 gsm').normCount).toBe(2);

    for (let i = 0; i < 3; i++) expect(env.rt.run('seedOfficeSupplyNorms')).toMatch(/tạo 0 sản phẩm, 0 định mức; bỏ qua 30/);
    expect(env.admin('vppListNorms').data.norms).toHaveLength(30);
    expect(products(env).filter((p) => p.catalogStatus === 'MASTER')).toHaveLength(24);
  });

  it('seedInitialOfficeSupplyStock: giữ giá trị thô, đánh dấu cần kiểm tra, không đoán, không ghi đè khi chạy lại', () => {
    const env = vppEnv({ initialStock: true });
    const temp = products(env).filter((p) => p.source === 'INITIAL_STOCK');
    expect(temp).toHaveLength(25);
    expect(temp.every((p) => p.catalogStatus === 'TEMP' && p.reviewStatus === 'PENDING')).toBe(true);
    const toilet = temp.find((p) => p.productName === 'Giấy toilet');
    expect(toilet.stock).toMatchObject({ onHand: null, rawInitialValue: 'hết năm', needsReview: true, status: 'UNKNOWN' }); // không đổi thành 0
    const clips = temp.find((p) => p.productName === 'Paper clips');
    expect(clips.unit).toBe('');
    expect(clips.stock).toMatchObject({ onHand: 5, needsReview: true, rawInitialValue: '5' });
    expect(temp.find((p) => p.productName === 'Giấy note').stock).toMatchObject({ onHand: 4, needsReview: true, rawInitialValue: '4 vuông nhỏ' });
    expect(temp.find((p) => p.productName === 'Bút xanh')).toMatchObject({ unit: 'Cây', stock: { onHand: 24, needsReview: false } });
    expect(temp.find((p) => p.productName === 'Nước lau sàn')).toMatchObject({ unit: 'Túi', stock: { onHand: 1 } });
    const movements = env.admin('vppListMovements', { type: 'INITIAL', pageSize: 100 }).data;
    expect(movements.total).toBe(24); // 25 dòng − 1 dòng chưa rõ số lượng

    expect(env.rt.run('seedInitialOfficeSupplyStock')).toMatch(/đã nạp đủ 25 dòng/);
    expect(products(env).filter((p) => p.source === 'INITIAL_STOCK')).toHaveLength(25);
    expect(env.admin('vppListMovements', { type: 'INITIAL', pageSize: 100 }).data.total).toBe(24);
  });

  it('seedInitialOfficeSupplyStock lỗi giữa chừng → chạy lại hoàn tất phần còn thiếu, không tạo trùng', () => {
    const env = vppEnv();
    failNextAppend(env, 'VPP_TON_KHO'); // sản phẩm đã tạo, ghi dòng tồn lỗi
    expect(() => env.rt.run('seedInitialOfficeSupplyStock')).toThrow(/Service Spreadsheets failed/);
    expect(products(env).filter((p) => p.source === 'INITIAL_STOCK')).toHaveLength(25);
    expect(env.admin('vppListMovements', { type: 'INITIAL', pageSize: 100 }).data.total).toBe(0);

    expect(env.rt.run('seedInitialOfficeSupplyStock')).toMatch(/tạo 0 sản phẩm tạm.*24 dòng tồn đầu kỳ \(hoàn tất phần còn thiếu/);
    const temp = new Set(products(env).filter((p) => p.source === 'INITIAL_STOCK').map((p) => p.productId));
    expect(temp.size).toBe(25);
    expect(env.rt.sheet('VPP_TON_KHO').toObjects().filter((r: any) => temp.has(r.product_id))).toHaveLength(25);
    expect(env.admin('vppListMovements', { type: 'INITIAL', pageSize: 100 }).data.total).toBe(24);
    expect(stockOf(env, 'Bút xanh')).toMatchObject({ onHand: 24 });
    expect(env.rt.run('seedInitialOfficeSupplyStock')).toMatch(/đã nạp đủ 25 dòng/);
  });
});

describe('VPP – rà soát dữ liệu & ghép sản phẩm', () => {
  it('liệt kê sản phẩm chưa ghép kèm gợi ý; GHÉP chuyển tồn; TẠO SẢN PHẨM MỚI; BỎ QUA', () => {
    const env = vppEnv({ initialStock: true });
    const review = env.admin('vppDataReview').data;
    expect(review.unmapped).toHaveLength(25);
    const giayUot = review.unmapped.find((u: any) => u.productName === 'Giấy ướt');
    expect(giayUot.suggestions[0]).toMatchObject({ productName: 'Khăn giấy ướt' });
    expect(review.unmapped.find((u: any) => u.productName === 'Lau kính').suggestions[0].productName).toBe('Nước lau kiếng');
    expect(review.unmapped.find((u: any) => u.productName === 'Vim').suggestions).toEqual([]); // không gợi ý bừa
    expect(review.unmapped.find((u: any) => u.productName === 'Giấy khô').suggestions).toEqual([]);
    // [BUG-20] so khớp có dấu: "Kéo" (cái kéo) không được gợi ý thành "Kẹo phòng họp" / "(không keo)"
    expect(review.unmapped.find((u: any) => u.productName === 'Kéo').suggestions).toEqual([]);
    // "Bút lông bảng" (bút viết bảng) không bị gợi ý thành "Bút bi" — "lông" ≠ "long"
    expect(review.unmapped.find((u: any) => u.productName === 'Bút lông bảng').suggestions.map((s: any) => s.productName)).not.toContain('Bút bi Thiên Long 027, xanh');
    expect(review.unmapped.find((u: any) => u.productName === 'Bút xanh').suggestions[0].productName).toBe('Bút bi Thiên Long 027, xanh');
    expect(review.unmapped.find((u: any) => u.productName === 'Giấy toilet').suggestions[0].productName).toBe('Giấy Toilet VP và Showroom');
    expect(review.unclearQuantity.map((u: any) => u.productName)).toEqual(['Giấy toilet']);
    expect(review.missingUnit.map((u: any) => u.productName)).toEqual(expect.arrayContaining(['Paper clips', 'Giấy note', 'Giấy ướt']));
    expect(review.unmappedDepartments.map((d: any) => d.department)).toEqual(expect.arrayContaining(['IT', 'Kế toán']));
    expect(review.unmappedDepartments.map((d: any) => d.department)).not.toContain('Kinh doanh'); // tự khớp "PHÒNG KINH DOANH"

    const merge = (source: any, target: any, extra: Record<string, unknown> = {}) =>
      env.admin('vppMergeProduct', { sourceProductId: source.productId, targetProductId: target.productId, reason: 'Cùng loại', ...extra });
    // [REVIEW-4] GHÉP "Giấy ướt: 5" (nguồn chưa có ĐVT — 5 gói hay 5 thùng?) → bắt buộc nhập số đã quy đổi + xác nhận
    const khanUot = productByName(env, 'Khăn giấy ướt');
    expect(merge(giayUot, khanUot).error?.details.fieldErrors.quantity).toMatch(/chưa có ĐVT/);
    expect(merge(giayUot, khanUot, { quantity: 5 }).error?.details.fieldErrors.unitConverted).toMatch(/quy đổi/);
    expect(stockOf(env, 'Khăn giấy ướt').onHand).toBe(0); // chưa chuyển gì
    expect(merge(giayUot, khanUot, { quantity: 5, unitConverted: true }).ok).toBe(true);
    expect(stockOf(env, 'Khăn giấy ướt').onHand).toBe(5);
    expect(productByName(env, 'Giấy ướt')).toMatchObject({ catalogStatus: 'ARCHIVED', reviewStatus: 'MAPPED', mergedIntoProductId: khanUot.productId });
    // Khác ĐVT ("1 túi" → "Bịch") → không nhập SL / không xác nhận quy đổi đều bị chặn, không tự đoán
    const sanSrc = productByName(env, 'Nước lau sàn');
    const sanTarget = productByName(env, 'Nước lau sàn 3.6');
    expect(merge(sanSrc, sanTarget).error?.details.fieldErrors.quantity).toMatch(/ĐVT khác nhau/);
    expect(merge(sanSrc, sanTarget, { quantity: 1 }).error?.details.fieldErrors.unitConverted).toMatch(/ĐVT khác nhau/);
    expect(merge(sanSrc, sanTarget, { quantity: 1, unitConverted: true }).ok).toBe(true);
    expect(stockOf(env, 'Nước lau sàn 3.6').onHand).toBe(1);
    // Cùng ĐVT ("Bút xanh: 24 cây" → "Cây") → để trống = chuyển nguyên số
    expect(merge(productByName(env, 'Bút xanh'), productByName(env, 'Bút bi Thiên Long 027, xanh')).ok).toBe(true);
    expect(stockOf(env, 'Bút bi Thiên Long 027, xanh').onHand).toBe(24);
    // "Giấy toilet: hết năm" → bắt buộc nhập số lượng thực tế khi ghép (0 thì không cần xác nhận quy đổi)
    const toilet = productByName(env, 'Giấy toilet');
    const toiletTarget = productByName(env, 'Giấy Toilet VP và Showroom');
    expect(merge(toilet, toiletTarget).error?.details.fieldErrors.quantity).toMatch(/chưa rõ/);
    expect(merge(toilet, toiletTarget, { quantity: 0 }).ok).toBe(true);
    expect(stockOf(env, 'Giấy Toilet VP và Showroom')).toMatchObject({ onHand: 0, status: 'OUT_OF_STOCK' });

    // TẠO SẢN PHẨM MỚI: "Kim bấm: 11 hộp" → sản phẩm danh mục + định mức VĂN PHÒNG
    const kim = productByName(env, 'Kim bấm');
    const promoted = env.admin('vppPromoteProduct', {
      productId: kim.productId, productCode: 'KIM-BAM-10', productName: 'Kim bấm số 10', category: 'Dụng cụ VP', unit: 'Hộp',
      referencePrice: 4000, minimumStock: 3, norm: { scopeId: 'VAN_PHONG', monthlyQuantity: 2 },
    });
    expect(promoted.ok, JSON.stringify(promoted.error)).toBe(true);
    expect(promoted.data.product).toMatchObject({ catalogStatus: 'MASTER', productCode: 'KIM-BAM-10', stock: { onHand: 11, status: 'IN_STOCK' } });
    expect(env.admin('vppListNorms').data.norms.find((n: any) => n.productName === 'Kim bấm số 10')).toMatchObject({ scopeId: 'VAN_PHONG', monthlyQuantity: 2 });

    // BỎ QUA: "Kéo" giữ là sản phẩm riêng ngoài định mức
    expect(env.admin('vppSkipReview', { productId: productByName(env, 'Kéo').productId }).ok).toBe(true);
    const after = env.admin('vppDataReview').data;
    expect(after.unmapped.map((u: any) => u.productName)).not.toEqual(expect.arrayContaining(['Giấy ướt', 'Kim bấm', 'Kéo', 'Giấy toilet']));
    expect(after.unmapped).toHaveLength(19);
    expect(after.unclearQuantity).toHaveLength(0);
    expect(after.stockDrifts).toEqual([]); // mọi thao tác đi qua sổ biến động
  });

  it('[REVIEW-3] GHÉP lỗi sau khi đã chuyển tồn (chưa kịp lưu trữ nguồn) → làm lại chỉ hoàn tất, không cộng tồn lần 2', () => {
    const env = vppEnv({ initialStock: true });
    const src = productByName(env, 'Bút xanh'); // 24 cây
    const target = productByName(env, 'Bút bi Thiên Long 027, xanh');
    expect(env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: target.productId }).ok).toBe(true);
    expect(stockOf(env, target.productName).onHand).toBe(24);
    // Mô phỏng: bước lưu trữ nguồn bị lỗi → nguồn vẫn còn "chưa ghép"
    setCell(env, 'VPP_SAN_PHAM', 'product_id', src.productId, 'catalog_status', 'TEMP');
    setCell(env, 'VPP_SAN_PHAM', 'product_id', src.productId, 'review_status', 'PENDING');
    setCell(env, 'VPP_SAN_PHAM', 'product_id', src.productId, 'active', 'TRUE');
    const retry = env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: target.productId, quantity: 24 });
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(stockOf(env, target.productName).onHand).toBe(24); // không thành 48
    expect(productByName(env, 'Bút xanh')).toMatchObject({ catalogStatus: 'ARCHIVED', mergedIntoProductId: target.productId });
    const targetMoves = env.admin('vppListMovements', { productId: target.productId }).data.items;
    expect(targetMoves.filter((m: any) => m.movementType === 'ADJUSTMENT' && m.reason.startsWith('Ghép "Bút xanh"'))).toHaveLength(1);
  });

  it('[BUG-21] định mức kèm theo không hợp lệ / trùng → báo lỗi và KHÔNG lưu sản phẩm (không ghi nửa vời)', () => {
    const env = vppEnv({ initialStock: true });
    const kim = productByName(env, 'Kim bấm');
    const promote = (norm: Record<string, unknown>) =>
      env.admin('vppPromoteProduct', { productId: kim.productId, productName: 'Kim bấm số 10', unit: 'Hộp', norm });

    // Thiếu phạm vi → trước đây bị bỏ qua âm thầm; nay báo lỗi, sản phẩm vẫn là sản phẩm tạm
    expect(promote({ scopeId: '', scopeName: '', monthlyQuantity: 2 }).error?.details.fieldErrors['norm.scopeId']).toBeTruthy();
    expect(productByName(env, 'Kim bấm')).toMatchObject({ catalogStatus: 'TEMP' });

    // Đã có định mức đang hiệu lực cùng phạm vi → báo lỗi, không đổi sản phẩm
    expect(env.admin('vppSaveNorm', { productId: kim.productId, scopeId: 'VAN_PHONG', monthlyQuantity: 1 }).ok).toBe(true);
    const dup = promote({ scopeId: 'VAN_PHONG', monthlyQuantity: 2 });
    expect(dup.error?.code).toBe('VALIDATION_ERROR');
    expect(dup.error?.details.fieldErrors['norm.scopeId']).toMatch(/đã có định mức/);
    expect(productByName(env, 'Kim bấm')).toMatchObject({ catalogStatus: 'TEMP', productName: 'Kim bấm' });

    // Phạm vi mới chưa có tên → báo lỗi
    expect(promote({ scopeId: 'KHO_VAN', monthlyQuantity: 2 }).error?.details.fieldErrors['norm.scopeName']).toBeTruthy();
    expect(promote({ scopeId: 'KINH_DOANH', monthlyQuantity: 2 }).ok).toBe(true);
    expect(productByName(env, 'Kim bấm số 10')).toMatchObject({ catalogStatus: 'MASTER' });
  });
});

describe('VPP – phiếu bàn giao văn phòng phẩm & kho', () => {
  it('tạo phiếu → giữ chỗ (on_hand giữ nguyên, available giảm); 2 phiếu chờ; không bán vượt tồn', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 5);
    const a = createSupplyHandover(env, [{ productId: pen.productId, quantity: 2 }]);
    expect(a.res.ok, JSON.stringify(a.res.error)).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });

    const b = createSupplyHandover(env, [{ productId: pen.productId, quantity: 2 }], 'DEMO-104', { sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' } });
    expect(b.res.ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 5, reserved: 4, available: 1 });

    const c = createSupplyHandover(env, [{ productId: pen.productId, quantity: 4 }]);
    expect(c.res.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(c.res.error?.details.shortages[0]).toMatchObject({ available: 1, requested: 4, shortage: 3 });
    expect(c.res.error?.details.fieldErrors['supplies.0.quantity']).toMatch(/Khả dụng: 1, yêu cầu: 4, thiếu: 3/);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 5, reserved: 4, available: 1 });
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(2);
  });

  it('cảnh báo sản phẩm cuối (LAST_ITEM), dashboard hết hàng, nhập kho → hết cảnh báo', () => {
    const env = vppEnv();
    const pin = productByName(env, 'Pin 2A Maxell');
    stockIn(env, pin.productId, 2);
    const a = createSupplyHandover(env, [{ productId: pin.productId, quantity: 2 }]);
    expect(a.res.data.warnings).toEqual([expect.objectContaining({ type: 'LAST_ITEM', productName: 'Pin 2A Maxell', available: 0 })]);
    const dash = env.admin('vppDashboard').data;
    expect(dash.outOfStock.map((p: any) => p.productName)).toContain('Pin 2A Maxell');
    const overview = env.admin('adminOverview').data.vpp;
    expect(overview.outOfStockCount).toBe(dash.outOfStock.length); // trang Tổng quan: số lượng + 10 sản phẩm đầu
    expect(overview.outOfStock.length).toBeLessThanOrEqual(10);

    // Tồn tối thiểu 3 → nhập thêm 3 (available 3) = sắp hết; nhập thêm → còn hàng
    env.admin('vppSaveProduct', { ...pin, productId: pin.productId, minimumStock: 3 });
    stockIn(env, pin.productId, 3);
    let d = env.admin('vppDashboard').data;
    expect(d.outOfStock.map((p: any) => p.productName)).not.toContain('Pin 2A Maxell');
    expect(d.lowStock.map((p: any) => p.productName)).toContain('Pin 2A Maxell');
    stockIn(env, pin.productId, 10);
    d = env.admin('vppDashboard').data;
    expect(d.lowStock.map((p: any) => p.productName)).not.toContain('Pin 2A Maxell');
    expect(stockOf(env, 'Pin 2A Maxell')).toMatchObject({ onHand: 15, reserved: 2, available: 13, status: 'IN_STOCK' });
  });

  it('hủy phiếu → trả giữ chỗ (RELEASE), on_hand không đổi', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    const a = createSupplyHandover(env, [{ productId: pen.productId, quantity: 4 }]);
    expect(env.admin('adminCancelHandover', { id: a.id, reason: 'Tạo nhầm' }).ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
    const release = env.admin('vppListMovements', { type: 'RELEASE' }).data.items[0];
    expect(release).toMatchObject({ quantity: 4, handoverCode: a.code, operationId: `HANDOVER_CANCEL:${a.id}`, actorName: 'Phạm Danh Thái' });
  });

  it('yêu cầu chỉnh sửa giữ nguyên giữ chỗ; admin sửa số lượng → điều chỉnh theo chênh lệch; ký → xuất kho; ký lại an toàn', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    const a4 = productByName(env, 'Giấy A4 Excel 80 gsm');
    stockIn(env, pen.productId, 10);
    stockIn(env, a4.productId, 6);
    const h = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }, { productId: a4.productId, quantity: 2 }]);
    const rev = env.call('requestRevision', { tokenHash: h.token.hash, contentHash: contentHashOf(env, h.token.hash), reason: 'Cần thêm bút' });
    expect(rev.data.handover.status).toBe('REVISION_REQUESTED');
    expect(stockOf(env, pen.productName)).toMatchObject({ reserved: 3, available: 7 }); // giữ nguyên
    expect(stockOf(env, a4.productName)).toMatchObject({ reserved: 2, available: 4 });

    const candidate = newToken();
    const upd = env.admin('adminUpdateHandover', {
      id: h.id, handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '',
      supplies: [{ productId: pen.productId, quantity: 5 }], // tăng bút 3→5, bỏ giấy A4
      candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce, clientRequestId: crypto.randomUUID(),
    });
    expect(upd.ok, JSON.stringify(upd.error)).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 5, available: 5 });
    expect(stockOf(env, a4.productName)).toMatchObject({ onHand: 6, reserved: 0, available: 6 });

    // Không cho tăng vượt khả dụng (khả dụng của phiếu này = 5 khả dụng + 5 đang giữ = 10)
    const tooMany = env.admin('adminUpdateHandover', {
      id: h.id, handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103', note: '',
      supplies: [{ productId: pen.productId, quantity: 11, overNormReason: 'thử' }], candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce,
    });
    expect(tooMany.error?.code).toBe('INSUFFICIENT_STOCK');

    expect(confirmAs(env, h.token.hash).ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    const out = env.admin('vppListMovements', { type: 'OUT' }).data.items;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ quantity: 5, onHandBefore: 10, onHandAfter: 5, operationId: `HANDOVER_CONFIRM:${h.id}`, actorName: 'Lê Hoàng Đức' });

    // Ký lại → ALREADY_CONFIRMED, không xuất kho lần 2; đối soát lại cũng không ghi gì thêm
    expect(confirmAs(env, h.token.hash).error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.admin('vppReconcileHandover', { id: h.id }).ok).toBe(true);
    expect(env.admin('vppListMovements', { type: 'OUT' }).data.items).toHaveLength(1);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 5, reserved: 0 });

    // PDF văn phòng phẩm
    expect(env.call('generatePdf', { id: h.id }, 'system').ok).toBe(true);
    const html = env.rt.lastPdfHtml;
    expect(html).toContain('BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM');
    expect(html).toContain('Bút bi Thiên Long 027, xanh');
    expect(html).toContain('Tên văn phòng phẩm');
  });

  it('định mức tháng: vượt định mức bắt buộc lý do (không chặn tuyệt đối); phòng ban chưa gắn định mức thì không kiểm tra', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh'); // KD: 10/tháng
    stockIn(env, pen.productId, 50);
    expect(createSupplyHandover(env, [{ productId: pen.productId, quantity: 7 }]).res.ok).toBe(true);
    const ctx = env.admin('vppHandoverContext', { receiverEmployeeId: 'DEMO-103' }).data;
    expect(ctx.scope).toMatchObject({ scopeId: 'KINH_DOANH' });
    expect(ctx.products.find((p: any) => p.productId === pen.productId).norm).toMatchObject({ monthlyQuantity: 10, pending: 7, remaining: 3 });

    const over = createSupplyHandover(env, [{ productId: pen.productId, quantity: 4 }]);
    expect(over.res.error?.code).toBe('NORM_EXCEEDED');
    expect(over.res.error?.details.fieldErrors['supplies.0.overNormReason']).toMatch(/Vượt định mức 1/);
    const withReason = createSupplyHandover(env, [{ productId: pen.productId, quantity: 4, overNormReason: 'Showroom khai trương' }]);
    expect(withReason.res.ok).toBe(true);
    expect(env.admin('adminGetHandover', { id: withReason.id }).data.handover.items[0].overNormReason).toBe('Showroom khai trương');
    // Lý do vượt định mức là thông tin nội bộ — không hiện cho người nhận
    expect(JSON.stringify(env.call('getHandoverByToken', { tokenHash: withReason.token.hash }).data)).not.toContain('Showroom khai trương');

    // IT chưa gắn phạm vi → không có định mức → không chặn; gắn IT → VĂN PHÒNG thì áp định mức VP (5/tháng).
    // Phạm vi được chốt trên phiếu lúc tạo (vpp_scope_id) — phiếu tạo trước khi gắn không tính vào định mức VP.
    expect(createSupplyHandover(env, [{ productId: pen.productId, quantity: 6 }], 'DEMO-105').res.ok).toBe(true);
    expect(env.admin('vppSetScopeMapping', { department: 'IT', scopeId: 'VAN_PHONG' }).ok).toBe(true);
    expect(createSupplyHandover(env, [{ productId: pen.productId, quantity: 5 }], 'DEMO-105').res.ok).toBe(true); // 5/5
    const it2 = createSupplyHandover(env, [{ productId: pen.productId, quantity: 1 }], 'DEMO-105');
    expect(it2.res.error?.code).toBe('NORM_EXCEEDED'); // 5 đang chờ + 1 > 5
    expect(env.admin('adminListEmployees', { includeInactive: true }).data.employees.find((e: any) => e.employeeId === 'DEMO-105').vppScope).toMatchObject({
      scopeId: 'VAN_PHONG', source: 'MAPPING',
    });
  });

  it('gửi lại cùng clientRequestId → không giữ chỗ 2 lần; phiếu lệch kho được phát hiện và đối soát', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    const clientRequestId = crypto.randomUUID();
    const first = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    const second = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    expect(second.res.data).toMatchObject({ duplicate: true, code: first.code });
    expect(stockOf(env, pen.productName)).toMatchObject({ reserved: 3, available: 7 });

    // Mô phỏng sự cố: phiếu đã xác nhận nhưng bước xuất kho chưa chạy (đổi trạng thái thẳng trên Sheet)
    const sheet = env.rt.sheet('BAN_GIAO');
    const col = Object.keys(sheet.toObjects()[0]).indexOf('status') + 1;
    sheet.getRange(2, col).setValue('CONFIRMED');
    const review = env.admin('vppDataReview').data;
    expect(review.stockMismatches).toEqual([expect.objectContaining({ handoverCode: first.code, status: 'CONFIRMED' })]);
    expect(env.admin('vppReconcileHandover', { id: first.id }).ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
    expect(env.admin('vppDataReview').data.stockMismatches).toEqual([]);
  });

  it('ký phiếu nhưng chưa xuất kho được (sổ biến động bị sửa tay) → phiếu vẫn xác nhận, ghi STOCK_SYNC_FAILED, email "Cần đối soát kho"', () => {
    const env = vppEnv();
    setSetting(env, 'NOTIFY_EMAILS', 'kho@example.com');
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 5);
    const h = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }]);
    expect(h.res.ok).toBe(true);
    // Ai đó sửa tay SỔ BIẾN ĐỘNG: dòng nhập 5 → 1 (sổ cho ra tồn 1 < đang giữ chỗ 3 — không hợp lệ)
    const stockInRow = env.rt.sheet('VPP_BIEN_DONG_KHO').toObjects().find((m: any) => m.movement_type === 'IN' && m.product_id === pen.productId);
    setCell(env, 'VPP_BIEN_DONG_KHO', 'movement_id', stockInRow.movement_id, 'quantity', 1);

    const confirmed = confirmAs(env, h.token.hash);
    expect(confirmed.ok, JSON.stringify(confirmed.error)).toBe(true);
    expect(confirmed.data.handover.status).toBe('CONFIRMED');
    const history = env.admin('adminGetHandover', { id: h.id }).data.handover.history;
    expect(history.map((x: { action: string }) => x.action)).toContain('STOCK_SYNC_FAILED');
    expect(env.admin('vppListMovements', { type: 'OUT' }).data.items).toHaveLength(0); // không trừ âm kho
    const alert = env.rt.mail.find((m: { subject: string }) => m.subject.startsWith('[DTA] Cần đối soát kho'));
    expect(alert).toMatchObject({ to: 'kho@example.com', subject: `[DTA] Cần đối soát kho — phiếu ${h.code}` });
    expect(env.admin('vppDataReview').data.stockMismatches).toEqual([expect.objectContaining({ handoverCode: h.code })]);
    // Sổ không hợp lệ → không tự đồng bộ theo sổ (sẽ thành tồn < giữ chỗ), báo phải kiểm kê
    expect(env.admin('vppSyncStock', { productId: pen.productId }).error).toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('Kiểm kê') });

    // Kiểm kê lại đúng thực tế (được phép dù sổ đang sai) rồi "Đối soát kho" → xuất kho đúng 1 lần
    const counted = env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: 5, reason: 'Đếm lại thực tế', clientRequestId: crypto.randomUUID() });
    expect(counted.ok, JSON.stringify(counted.error)).toBe(true);
    expect(env.admin('vppReconcileHandover', { id: h.id }).ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(env.admin('vppDataReview').data.stockMismatches).toEqual([]);
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
  });

  it('sửa tay số tồn trên sheet không làm hỏng ký phiếu: kho tính theo sổ biến động, có ghi lịch sử', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 5);
    const h = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }]);
    expect(h.res.ok).toBe(true);
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', 1); // ai đó sửa tay: tồn < số đang giữ chỗ

    const confirmed = confirmAs(env, h.token.hash);
    expect(confirmed.ok, JSON.stringify(confirmed.error)).toBe(true);
    const history = env.admin('adminGetHandover', { id: h.id }).data.handover.history;
    expect(history.map((x: { action: string }) => x.action)).not.toContain('STOCK_SYNC_FAILED');
    expect(env.admin('vppListMovements', { type: 'OUT' }).data.items).toHaveLength(1);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 2, reserved: 0 }); // 5 − 3 theo sổ, không phải 1 − 3
    const synced = env.rt.sheet('LICH_SU').toObjects().find((x: any) => x.action === 'VPP_STOCK_SYNCED' && x.handover_id === pen.productId);
    expect(synced.message).toContain('khác sổ biến động');
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
  });

  it('sản phẩm chưa rõ tồn (cần kiểm kê) không bàn giao được; sản phẩm đã lưu trữ không chọn được', () => {
    const env = vppEnv({ initialStock: true });
    const toilet = productByName(env, 'Giấy toilet');
    const res = createSupplyHandover(env, [{ productId: toilet.productId, quantity: 1 }]);
    expect(res.res.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(res.res.error?.details.fieldErrors['supplies.0.quantity']).toMatch(/chưa xác định/);
    const archived = env.admin('vppSaveProduct', { ...productByName(env, 'Hột quẹt'), catalogStatus: 'ARCHIVED' });
    expect(archived.ok).toBe(true);
    expect(createSupplyHandover(env, [{ productId: archived.data.product.productId, quantity: 1 }]).res.error?.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('VPP – nhập kho thủ công & kiểm kê', () => {
  it('nhập kho (IN) idempotent theo clientRequestId; "Tồn đầu kỳ" ghi INITIAL; lý do bắt buộc', () => {
    const env = vppEnv();
    const a5 = productByName(env, 'Giấy A5 Excel 80 gsm');
    const clientRequestId = crypto.randomUUID();
    const payload = { productId: a5.productId, quantity: 4, reasonType: 'MUA_TRUC_TIEP', unitPrice: 27800, date: '2026-10-06', clientRequestId };
    expect(env.admin('vppStockIn', payload).ok).toBe(true);
    expect(env.admin('vppStockIn', payload).ok).toBe(true); // gửi lại → không nhập 2 lần
    expect(stockOf(env, a5.productName).onHand).toBe(4);
    expect(env.admin('vppStockIn', { productId: a5.productId, quantity: 2, reasonType: 'TON_DAU_KY', clientRequestId: crypto.randomUUID() }).ok).toBe(true);
    const moves = env.admin('vppListMovements', { productId: a5.productId }).data.items;
    expect(moves.map((m: any) => m.movementType)).toEqual(['INITIAL', 'IN']);
    expect(moves[1].reason).toMatch(/Mua trực tiếp · ngày 06\/10\/2026 · đơn giá 27800/);
    expect(env.admin('vppStockIn', { productId: a5.productId, quantity: 1, reasonType: 'KHAC', clientRequestId: crypto.randomUUID() }).error?.details.fieldErrors.note).toBeTruthy();
    expect(env.admin('vppStockIn', { productId: a5.productId, quantity: 0, reasonType: 'BO_SUNG', clientRequestId: crypto.randomUUID() }).error?.code).toBe('VALIDATION_ERROR');
  });

  it('kiểm kê: ghi ADJUSTMENT theo chênh lệch, bắt buộc lý do, không thấp hơn số đang giữ chỗ, xử lý tồn chưa rõ', () => {
    const env = vppEnv({ initialStock: true });
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    createSupplyHandover(env, [{ productId: pen.productId, quantity: 4 }]);
    expect(env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: 8, reason: '', clientRequestId: crypto.randomUUID() }).error?.details.fieldErrors.reason).toBeTruthy();
    const below = env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: 3, reason: 'Kiểm kê cuối tháng', clientRequestId: crypto.randomUUID() });
    expect(below.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(below.error?.message).toMatch(/nhỏ hơn số đang giữ chỗ/);
    const ok = env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: 8, reason: 'Kiểm kê cuối tháng', clientRequestId: crypto.randomUUID() });
    expect(ok.data.product.stock).toMatchObject({ onHand: 8, reserved: 4, available: 4 });
    const adj = env.admin('vppListMovements', { type: 'ADJUSTMENT', productId: pen.productId }).data.items[0];
    expect(adj).toMatchObject({ quantity: -2, onHandBefore: 10, onHandAfter: 8 });
    expect(adj.reason).toMatch(/hệ thống 10 → thực tế 8/);

    const toilet = productByName(env, 'Giấy toilet');
    const resolved = env.admin('vppStockAdjust', { productId: toilet.productId, countedQuantity: 5, reason: 'Đếm thực tế', clientRequestId: crypto.randomUUID() });
    expect(resolved.data.product.stock).toMatchObject({ onHand: 5, status: 'IN_STOCK', needsReview: true }); // vẫn thiếu ĐVT
    env.admin('vppSaveProduct', { ...productByName(env, 'Giấy toilet'), unit: 'Cuộn' });
    expect(stockOf(env, 'Giấy toilet').needsReview).toBe(false);
  });
});

describe('VPP – đề xuất mua', () => {
  function lookup(env: Env, employeeId = 'DEMO-103') {
    return env.call('vppEmployeeLookup', { employeeId, client: { ipHash: 'd'.repeat(32) } });
  }

  it('tra mã NV → định mức phòng ban; danh mục công khai không có tồn / giá', () => {
    const env = vppEnv();
    const res = lookup(env);
    expect(res.data.employee).toEqual({ employeeId: 'DEMO-103', fullName: 'Lê Hoàng Đức', department: 'Kinh doanh', position: 'Nhân viên kinh doanh' });
    expect(res.data.scope).toEqual({ scopeId: 'KINH_DOANH', scopeName: 'PHÒNG KINH DOANH' });
    expect(res.data.norms).toHaveLength(13);
    expect(res.data.norms.find((n: any) => n.productName === 'Giấy A4 Excel 80 gsm')).toMatchObject({ monthlyQuantity: 3, unit: 'Gream' });
    expect(JSON.stringify(res.data)).not.toMatch(/email|onHand|referencePrice/);
    expect(lookup(env, 'DEMO-107').error?.code).toBe('EMPLOYEE_NOT_FOUND'); // đã nghỉ
    const catalog = env.call('vppPublicCatalog').data.products;
    expect(catalog).toHaveLength(24);
    expect(Object.keys(catalog[0]).sort()).toEqual(['category', 'productId', 'productName', 'unit']);
  });

  it('trong định mức / vượt định mức (bắt lý do) / ngoài định mức (sản phẩm chờ duyệt); gửi lại không trùng', () => {
    const env = vppEnv();
    setSetting(env, 'NOTIFY_EMAILS', 'admin@example.com');
    const norms = lookup(env).data.norms;
    const a4 = norms.find((n: any) => n.productName === 'Giấy A4 Excel 80 gsm');
    const pen = norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const base = { employeeId: 'DEMO-103', client: { ipHash: 'd'.repeat(32) } };
    const over = env.call('vppSubmitProposal', { ...base, items: [{ productId: a4.productId, quantity: 5 }] });
    expect(over.error?.details.fieldErrors['items.0.reason']).toMatch(/Vượt định mức/);
    const outside = env.call('vppSubmitProposal', { ...base, items: [{ productName: 'Giấy note vàng 3x3', unit: 'Xấp', quantity: 5 }] });
    expect(outside.error?.details.fieldErrors['items.0.reason']).toMatch(/ngoài định mức/);

    const clientRequestId = crypto.randomUUID();
    const payload = {
      ...base, clientRequestId, reason: 'Bổ sung tháng 10',
      items: [
        { productId: pen.productId, quantity: 8 },
        { productId: a4.productId, quantity: 5, reason: 'Nhiều hợp đồng in' },
        { productName: 'Giấy note vàng 3x3', unit: 'Xấp', quantity: 5, reason: 'Ghi chú khách hàng', referenceUrl: 'https://example.com/note' },
      ],
    };
    const ok = env.call('vppSubmitProposal', payload);
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.data).toMatchObject({ status: 'SUBMITTED', itemCount: 3 });
    expect(ok.data.proposalCode).toMatch(/^DX-\d{8}-0001$/);
    expect(env.call('vppSubmitProposal', payload).data).toMatchObject({ duplicate: true, proposalCode: ok.data.proposalCode });
    // Email báo quản trị viên đúng 1 lần (gửi lại cùng clientRequestId không gửi thêm)
    const notices = env.rt.mail.filter((m: { subject: string }) => m.subject.startsWith('[DTA] Đề xuất mua'));
    expect(notices).toHaveLength(1);
    expect(notices[0].subject).toBe(`[DTA] Đề xuất mua văn phòng phẩm ${ok.data.proposalCode}`);
    expect(notices[0].body).toContain('Lê Hoàng Đức (DEMO-103, Kinh doanh) gửi đề xuất');
    expect(notices[0].body).toContain('Bút bi Thiên Long 027, xanh × 8');
    expect(notices[0].body).toContain('Giấy note vàng 3x3 × 5 Xấp (mới)');

    const list = env.admin('vppListProposals').data;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ requesterName: 'Lê Hoàng Đức', department: 'Kinh doanh', itemCount: 3, outsideNormCount: 1, pendingProductCount: 1 });
    expect(list.items[0].estimatedTotal).toBe(8 * 3100 + 5 * 55600); // giá dự kiến = SL đề xuất × đơn giá tham khảo (nếu có)
    const detail = env.admin('vppGetProposal', { id: list.items[0].proposalId }).data;
    const temp = detail.items.find((i: any) => i.temporaryProductName === 'Giấy note vàng 3x3');
    expect(temp).toMatchObject({ isOutsideNorm: true, productApprovalStatus: 'PENDING', referenceUrl: 'https://example.com/note' });
    expect(temp.product).toMatchObject({ catalogStatus: 'PENDING_APPROVAL' });
    // Không tự đưa vào danh mục công khai
    expect(env.call('vppPublicCatalog').data.products.map((p: any) => p.productName)).not.toContain('Giấy note vàng 3x3');
  });

  it('[BUG-13] cả văn phòng chung 1 IP (NAT) vẫn gửi được; giới hạn theo nhân viên (10/ngày) và số lần tra sai mã', () => {
    const env = vppEnv();
    const office = { ipHash: 'e'.repeat(32) };
    const pen = lookup(env).data.norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const submit = (employeeId: string) =>
      env.call('vppSubmitProposal', { employeeId, client: office, clientRequestId: crypto.randomUUID(), items: [{ productId: pen.productId, quantity: 1, reason: 'test' }] });
    // 6 nhân viên × 2 đề xuất = 12 đề xuất từ cùng 1 IP trong 1 giờ (trước đây chặn ở 10)
    for (const id of ['DEMO-519', 'DEMO-101', 'DEMO-102', 'DEMO-104', 'DEMO-105', 'DEMO-106']) {
      for (let i = 0; i < 2; i++) expect(submit(id).ok, id).toBe(true);
    }
    for (let i = 0; i < 10; i++) expect(submit('DEMO-103').ok).toBe(true);
    expect(submit('DEMO-103').error?.code).toBe('RATE_LIMITED'); // 11 đề xuất / ngày / nhân viên

    const scan = { ipHash: 'f'.repeat(32) };
    for (let i = 0; i < 20; i++) {
      expect(env.call('vppEmployeeLookup', { employeeId: `NV-SAI-${i}`, client: scan }).error?.code).toBe('EMPLOYEE_NOT_FOUND');
    }
    expect(env.call('vppEmployeeLookup', { employeeId: 'DEMO-103', client: scan }).error?.code).toBe('RATE_LIMITED'); // dò mã bị chặn
    expect(env.call('vppEmployeeLookup', { employeeId: 'DEMO-103', client: office }).ok).toBe(true); // IP khác không ảnh hưởng
  });

  it('duyệt một phần → đã mua → nhập kho (IN, idempotent) → đóng; sản phẩm ngoài danh mục phải được duyệt trước khi nhập kho', () => {
    const env = vppEnv();
    const norms = lookup(env).data.norms;
    const pen = norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const sub = env.call('vppSubmitProposal', {
      employeeId: 'DEMO-103', client: { ipHash: 'd'.repeat(32) },
      items: [{ productId: pen.productId, quantity: 8 }, { productName: 'Giấy note vàng 3x3', unit: 'Xấp', quantity: 5, reason: 'Ghi chú' }],
    });
    const id = env.admin('vppListProposals').data.items[0].proposalId;
    const detail = env.admin('vppGetProposal', { id }).data;
    const [penItem, noteItem] = detail.items;
    const review = env.admin('vppReviewProposal', {
      id, adminNote: 'Duyệt bớt bút',
      decisions: [{ proposalItemId: penItem.proposalItemId, approvedQuantity: 6 }, { proposalItemId: noteItem.proposalItemId, approvedQuantity: 5, approvedPrice: 12000 }],
    });
    expect(review.ok, JSON.stringify(review.error)).toBe(true);
    expect(review.data.proposal).toMatchObject({ status: 'PARTIALLY_APPROVED', reviewedBy: 'Phạm Danh Thái (thai)', estimatedTotal: 6 * 3100 + 5 * 12000 });
    expect(sub.ok).toBe(true);

    expect(env.admin('vppSetProposalStatus', { id, status: 'PURCHASED', note: 'Mua tại nhà sách' }).data.proposal.status).toBe('PURCHASED');
    const lines = [
      { proposalItemId: penItem.proposalItemId, receivedQuantity: 6, unitPrice: 3200 },
      { proposalItemId: noteItem.proposalItemId, receivedQuantity: 5 },
    ];
    const blocked = env.admin('vppReceiveProposal', { id, lines, receivedDate: '2026-10-07' });
    expect(blocked.error?.details.fieldErrors['lines.1.receivedQuantity']).toMatch(/chưa được duyệt vào danh mục/);
    expect(stockOf(env, 'Bút bi Thiên Long 027, xanh').onHand).toBe(0);

    // [BUG-21] định mức kèm theo thiếu phạm vi → lỗi, sản phẩm vẫn chờ duyệt (không ghi nửa vời)
    const badNorm = env.admin('vppProductDecision', {
      id, proposalItemId: noteItem.proposalItemId, decision: 'MASTER', productName: 'Giấy note vàng 3x3', unit: 'Xấp',
      norm: { scopeId: '', scopeName: '', monthlyQuantity: 3 },
    });
    expect(badNorm.error?.details.fieldErrors['norm.scopeId']).toBeTruthy();
    expect(env.admin('vppGetProposal', { id }).data.items[1]).toMatchObject({ productApprovalStatus: 'PENDING', product: { catalogStatus: 'PENDING_APPROVAL' } });

    // Admin: thêm "Giấy note vàng 3x3" vào danh mục (mã, nhóm, ĐVT, đơn giá, tồn tối thiểu, định mức)
    const decision = env.admin('vppProductDecision', {
      id, proposalItemId: noteItem.proposalItemId, decision: 'MASTER', productCode: 'NOTE-33', productName: 'Giấy note vàng 3x3',
      category: 'Giấy', unit: 'Xấp', referencePrice: 12000, minimumStock: 2, norm: { scopeId: 'KINH_DOANH', monthlyQuantity: 3 },
    });
    expect(decision.ok, JSON.stringify(decision.error)).toBe(true);
    expect(decision.data.items[1]).toMatchObject({ productApprovalStatus: 'APPROVED_MASTER', product: { catalogStatus: 'MASTER', productCode: 'NOTE-33' } });

    const received = env.admin('vppReceiveProposal', { id, lines, receivedDate: '2026-10-07', note: 'Đủ hàng' });
    expect(received.ok, JSON.stringify(received.error)).toBe(true);
    expect(received.data.proposal.status).toBe('RECEIVED');
    // [REVIEW-8] ước tính tính lại theo đơn giá thực mua (bút 3.200 thay vì 3.100)
    expect(received.data.proposal.estimatedTotal).toBe(6 * 3200 + 5 * 12000);
    expect(stockOf(env, 'Bút bi Thiên Long 027, xanh')).toMatchObject({ onHand: 6, status: 'IN_STOCK' });
    expect(stockOf(env, 'Giấy note vàng 3x3')).toMatchObject({ onHand: 5, minimumStock: 2 });
    const ins = env.admin('vppListMovements', { type: 'IN' }).data.items;
    expect(ins).toHaveLength(2);
    expect(ins.every((m: any) => m.proposalCode && m.operationId.startsWith(`PROPOSAL_RECEIVE:${id}:`))).toBe(true);
    // Nhập lại (gửi lại request) → đề xuất đã RECEIVED nên bị chặn, không nhập 2 lần
    expect(env.admin('vppReceiveProposal', { id, lines }).error?.code).toBe('INVALID_STATUS_TRANSITION');
    expect(env.admin('vppListMovements', { type: 'IN' }).data.items).toHaveLength(2);
    expect(env.admin('vppSetProposalStatus', { id, status: 'CLOSED' }).data.proposal.status).toBe('CLOSED');
    expect(env.admin('vppGetProposal', { id }).data.history.map((h: any) => h.action)).toEqual([
      'VPP_PROPOSAL_SUBMITTED', 'VPP_PROPOSAL_REVIEWED', 'VPP_PROPOSAL_PURCHASED', 'VPP_PROPOSAL_PRODUCT_DECISION', 'VPP_PROPOSAL_RECEIVED', 'VPP_PROPOSAL_CLOSED',
    ]);
  });

  it('từ chối đề xuất (bắt buộc lý do); từ chối / giữ tạm / ghép sản phẩm ngoài danh mục', () => {
    const env = vppEnv();
    const base = { employeeId: 'DEMO-103', client: { ipHash: 'd'.repeat(32) } };
    env.call('vppSubmitProposal', { ...base, items: [{ productName: 'Máy hủy giấy mini', quantity: 1, reason: 'Hủy hồ sơ' }] });
    env.call('vppSubmitProposal', { ...base, items: [{ productName: 'Bút dạ quang', unit: 'Cây', quantity: 4, reason: 'Đánh dấu' }] });
    env.call('vppSubmitProposal', { ...base, items: [{ productName: 'Khăn giấy ướt loại lớn', unit: 'Bịch', quantity: 2, reason: 'Showroom' }] });
    const [p3, p2, p1] = env.admin('vppListProposals').data.items;

    expect(env.admin('vppRejectProposal', { id: p1.proposalId, reason: '' }).error?.code).toBe('VALIDATION_ERROR');
    const rejected = env.admin('vppRejectProposal', { id: p1.proposalId, reason: 'Chưa cần thiết' });
    expect(rejected.data.proposal).toMatchObject({ status: 'REJECTED', adminNote: 'Chưa cần thiết' });
    expect(env.admin('vppReviewProposal', { id: p1.proposalId, decisions: [] }).error?.code).toBe('INVALID_STATUS_TRANSITION');

    const d2 = env.admin('vppGetProposal', { id: p2.proposalId }).data.items[0];
    const kept = env.admin('vppProductDecision', { id: p2.proposalId, proposalItemId: d2.proposalItemId, decision: 'TEMP', productName: 'Bút dạ quang', unit: 'Cây' });
    expect(kept.data.items[0]).toMatchObject({ productApprovalStatus: 'KEPT_TEMP', product: { catalogStatus: 'TEMP' } });

    const d3 = env.admin('vppGetProposal', { id: p3.proposalId }).data.items[0];
    const target = productByName(env, 'Khăn giấy ướt'); // cùng ĐVT "Bịch" → ghép thẳng, giữ số lượng
    const mapped = env.admin('vppProductDecision', { id: p3.proposalId, proposalItemId: d3.proposalItemId, decision: 'MAP', targetProductId: target.productId });
    expect(mapped.ok, JSON.stringify(mapped.error)).toBe(true);
    expect(mapped.data.items[0]).toMatchObject({ productApprovalStatus: 'MAPPED', productId: target.productId, requestedQuantity: 2, unit: 'Bịch' });

    const reject = env.admin('vppProductDecision', {
      id: p2.proposalId, proposalItemId: d2.proposalItemId, decision: 'REJECT',
    });
    expect(reject.error?.code).toBe('INVALID_STATE'); // đã xử lý rồi
  });
});

describe('VPP – phân quyền & lịch sử', () => {
  it('scope public không gọi được thao tác quản trị VPP; biến động kho chỉ thêm, không xóa', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    for (const action of ['vppStockIn', 'vppStockAdjust', 'vppListProducts', 'vppReviewProposal', 'vppReceiveProposal', 'vppSaveNorm', 'vppSaveProduct', 'vppDashboard', 'vppMergeProduct']) {
      expect(env.call(action, { productId: pen.productId, quantity: 5, reasonType: 'BO_SUNG', clientRequestId: crypto.randomUUID() }).error?.code, action).toBe('FORBIDDEN');
    }
    expect(stockOf(env, pen.productName).onHand).toBe(0);
    stockIn(env, pen.productId, 3);
    const before = env.rt.sheet('VPP_BIEN_DONG_KHO').toObjects().length;
    const h = createSupplyHandover(env, [{ productId: pen.productId, quantity: 1 }]);
    env.admin('adminCancelHandover', { id: h.id });
    const rows = env.rt.sheet('VPP_BIEN_DONG_KHO').toObjects();
    expect(rows.length).toBe(before + 2);
    expect(rows.every((r: any) => r.actor_name)).toBe(true);
  });

  it('định mức: thêm / sửa có kiểm tra trùng, ghi lịch sử người sửa', () => {
    const env = vppEnv();
    const nuoc = productByName(env, 'Thùng nước Vĩnh Hảo');
    const dup = env.admin('vppSaveNorm', { productId: nuoc.productId, scopeId: 'KINH_DOANH', monthlyQuantity: 5 });
    expect(dup.error?.details.fieldErrors.productId).toMatch(/đã có định mức/);
    const norm = env.admin('vppListNorms').data.norms.find((n: any) => n.productId === nuoc.productId);
    const saved = env.admin('vppSaveNorm', { normId: norm.normId, productId: nuoc.productId, scopeId: 'KINH_DOANH', monthlyQuantity: 4, note: 'Tăng do hè' });
    expect(saved.data.norm).toMatchObject({ monthlyQuantity: 4, note: 'Tăng do hè' });
    const log = env.rt.sheet('LICH_SU').toObjects().find((l: any) => l.action === 'VPP_NORM_UPDATED');
    expect(log).toMatchObject({ actor: 'Phạm Danh Thái (thai)', entity_type: 'VPP_NORM' });
    expect(log.message).toMatch(/3 → 4\/tháng/);
  });

  it('gắn phòng ban → phạm vi: phân biệt tự khớp / gắn thủ công / không áp dụng; phạm vi không tồn tại bị từ chối', () => {
    const env = vppEnv();
    const dept = (name: string) => env.admin('vppListNorms').data.departments.find((d: any) => d.department === name);
    expect(dept('Kinh doanh')).toMatchObject({ mapping: '', scope: { scopeId: 'KINH_DOANH', source: 'AUTO' } });
    expect(dept('IT')).toMatchObject({ mapping: '', scope: null });

    expect(env.admin('vppSetScopeMapping', { department: 'IT', scopeId: 'VAN_PHONG' }).ok).toBe(true);
    expect(dept('IT')).toMatchObject({ mapping: 'VAN_PHONG', scope: { scopeId: 'VAN_PHONG', source: 'MAPPING' } });

    expect(env.admin('vppSetScopeMapping', { department: 'Kinh doanh', scopeId: 'NONE' }).ok).toBe(true);
    expect(dept('Kinh doanh')).toMatchObject({ mapping: 'NONE', scope: null });
    expect(env.admin('vppHandoverContext', { receiverEmployeeId: 'DEMO-103' }).data.scope).toBeNull();

    expect(env.admin('vppSetScopeMapping', { department: 'Kinh doanh', scopeId: '' }).ok).toBe(true); // bỏ gắn → tự khớp lại
    expect(dept('Kinh doanh')).toMatchObject({ mapping: '', scope: { scopeId: 'KINH_DOANH', source: 'AUTO' } });
    expect(env.admin('vppSetScopeMapping', { department: 'IT', scopeId: 'KHONG_CO' }).error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('VPP – lỗi phát hiện khi rà soát độc lập (REVIEW-1…8)', () => {
  const staff = { employeeId: 'DEMO-103', client: { ipHash: '9'.repeat(32) } };
  const submit = (env: Env, items: unknown[]) => {
    const res = env.call('vppSubmitProposal', { ...staff, clientRequestId: crypto.randomUUID(), items });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    const id = env.admin('vppListProposals').data.items.find((p: any) => p.proposalCode === res.data.proposalCode).proposalId;
    return { id, detail: () => env.admin('vppGetProposal', { id }).data };
  };
  const decide = (env: Env, id: string, proposalItemId: string, body: Record<string, unknown>) =>
    env.admin('vppProductDecision', { id, proposalItemId, ...body });

  it('[REVIEW-1] tên tự gõ chỉ gắn vào sản phẩm DANH MỤC trùng tên có dấu — "Kẹo" / "Keo" không bị gắn vào "Kéo"', () => {
    const env = vppEnv({ initialStock: true }); // có sản phẩm tạm "Kéo" (cái kéo) từ tồn đầu kỳ
    const scissors = productByName(env, 'Kéo');
    const p = submit(env, [
      { productName: 'Kẹo', unit: 'Gói', quantity: 2, reason: 'Tiếp khách' },
      { productName: 'Keo', unit: 'Chai', quantity: 1, reason: 'Dán hồ sơ' },
      { productName: '  bút bi thiên long 027,   xanh ', quantity: 2 }, // trùng tên danh mục (khác hoa / thường, khoảng trắng)
    ]);
    const [candy, glue, pen] = p.detail().items;
    expect(candy).toMatchObject({ temporaryProductName: 'Kẹo', productApprovalStatus: 'PENDING', product: { catalogStatus: 'PENDING_APPROVAL' } });
    expect(glue).toMatchObject({ temporaryProductName: 'Keo', productApprovalStatus: 'PENDING', product: { catalogStatus: 'PENDING_APPROVAL' } });
    expect([candy.productId, glue.productId]).not.toContain(scissors.productId);
    expect(candy.productId).not.toBe(glue.productId);
    expect(pen).toMatchObject({ productApprovalStatus: 'NOT_REQUIRED', isOutsideNorm: false, product: { productName: 'Bút bi Thiên Long 027, xanh', catalogStatus: 'MASTER' } });
    expect(productByName(env, 'Kéo')).toMatchObject({ catalogStatus: 'TEMP', active: true });
  });

  it('[REVIEW-2] sản phẩm chờ duyệt chỉ xử lý trong đề xuất; đã quyết định thì không quyết định lại / lưu trữ được từ đề xuất khác', () => {
    const env = vppEnv();
    const a = submit(env, [{ productName: 'Bút dạ quang vàng', unit: 'Cây', quantity: 3, reason: 'Đánh dấu hợp đồng' }]);
    const b = submit(env, [{ productName: 'Bút dạ quang vàng', unit: 'Cây', quantity: 2, reason: 'Đánh dấu' }]);
    const itemA = a.detail().items[0];
    const itemB = b.detail().items[0];
    expect(itemA.productId).not.toBe(itemB.productId); // mỗi dòng có sản phẩm chờ duyệt riêng

    // Mọi "đường vòng" đổi trạng thái / tồn của sản phẩm chờ duyệt đều bị chặn
    const pending = itemA.productId;
    expect(env.admin('vppSaveProduct', { productId: pending, productName: 'Bút dạ quang vàng', unit: 'Cây', catalogStatus: 'MASTER' }).error?.details.fieldErrors.catalogStatus).toMatch(/đề xuất/);
    expect(env.admin('vppSaveProduct', { productName: 'Sản phẩm mới', unit: 'Cái', catalogStatus: 'PENDING_APPROVAL' }).error?.details.fieldErrors.catalogStatus).toBeTruthy();
    expect(env.admin('vppStockAdjust', { productId: pending, countedQuantity: 5, reason: 'Kiểm kê', clientRequestId: crypto.randomUUID() }).error?.code).toBe('INVALID_STATE');
    expect(env.admin('vppStockIn', { productId: pending, quantity: 5, reasonType: 'BO_SUNG', clientRequestId: crypto.randomUUID() }).error?.code).toBe('INVALID_STATE');
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    expect(env.admin('vppMergeProduct', { sourceProductId: pending, targetProductId: pen.productId, quantity: 0 }).error?.message).toMatch(/đề xuất/);
    expect(env.admin('vppPromoteProduct', { productId: pending, productName: 'X', unit: 'Cây' }).error?.code).toBe('INVALID_STATE');
    expect(env.admin('vppSkipReview', { productId: pending }).error?.code).toBe('INVALID_STATE');
    // Sửa thông tin (giữ trạng thái chờ duyệt) vẫn được
    expect(env.admin('vppSaveProduct', { productId: pending, productName: 'Bút dạ quang vàng', unit: 'Cây', catalogStatus: 'PENDING_APPROVAL' }).ok).toBe(true);

    // A: thêm vào danh mục → quyết định lại bị chặn
    expect(decide(env, a.id, itemA.proposalItemId, { decision: 'MASTER', productName: 'Bút dạ quang vàng', unit: 'Cây', referencePrice: 8000 }).ok).toBe(true);
    expect(decide(env, a.id, itemA.proposalItemId, { decision: 'REJECT' }).error?.code).toBe('INVALID_STATE');
    // Có tồn + đang giữ chỗ cho phiếu chờ ký
    stockIn(env, pending, 10);
    const reserved = createSupplyHandover(env, [{ productId: pending, quantity: 4 }], 'DEMO-105');
    expect(reserved.res.ok, JSON.stringify(reserved.res.error)).toBe(true);
    // B (dòng riêng) vẫn quyết định bình thường: GHÉP vào sản phẩm vừa vào danh mục
    expect(decide(env, b.id, itemB.proposalItemId, { decision: 'MAP', targetProductId: pending }).ok).toBe(true);
    expect(stockOf(env, 'Bút dạ quang vàng')).toMatchObject({ onHand: 10, reserved: 4, available: 6 });
    expect(products(env).filter((x) => x.productName === 'Bút dạ quang vàng' && x.catalogStatus === 'MASTER')).toHaveLength(1);
  });

  it('[REVIEW-2/8] dữ liệu cũ: 2 đề xuất cùng trỏ 1 sản phẩm chờ duyệt → quyết định 1 lần áp cho cả 2 (kể cả ước tính), không lưu trữ được sản phẩm đang dùng', () => {
    const env = vppEnv();
    const a = submit(env, [{ productName: 'Băng keo 2 mặt', unit: 'Cuộn', quantity: 3, reason: 'Dán bảng' }]);
    const b = submit(env, [{ productName: 'Băng keo 2 mặt', unit: 'Cuộn', quantity: 2, reason: 'Dán poster' }]);
    const itemA = a.detail().items[0];
    const itemB = b.detail().items[0];
    // Mô phỏng dữ liệu tạo trước bản sửa: dòng của B trỏ vào chính sản phẩm chờ duyệt của A
    setCell(env, 'VPP_DE_XUAT_CHI_TIET', 'proposal_item_id', itemB.proposalItemId, 'product_id', itemA.productId);
    expect(decide(env, a.id, itemA.proposalItemId, { decision: 'MASTER', productName: 'Băng keo 2 mặt', unit: 'Cuộn', referencePrice: 15000 }).ok).toBe(true);
    const lineB = b.detail().items[0];
    expect(lineB).toMatchObject({ productApprovalStatus: 'APPROVED_MASTER', referencePrice: 15000, product: { catalogStatus: 'MASTER' } });
    expect(b.detail().proposal.estimatedTotal).toBe(2 * 15000);
    stockIn(env, itemA.productId, 10);
    expect(createSupplyHandover(env, [{ productId: itemA.productId, quantity: 4 }], 'DEMO-105').res.ok).toBe(true);
    // Đề xuất B không còn "Xử lý sản phẩm mới" → TỪ CHỐI / GHÉP không thể lưu trữ sản phẩm đang có tồn + giữ chỗ
    expect(decide(env, b.id, itemB.proposalItemId, { decision: 'REJECT' }).error?.code).toBe('INVALID_STATE');
    expect(decide(env, b.id, itemB.proposalItemId, { decision: 'MAP', targetProductId: productByName(env, 'Bút bi Thiên Long 027, xanh').productId }).error?.code).toBe('INVALID_STATE');
    expect(productByName(env, 'Băng keo 2 mặt')).toMatchObject({ catalogStatus: 'MASTER', active: true, stock: { onHand: 10, reserved: 4 } });
  });

  it('[REVIEW-3] Sheets lỗi khi ghi SỔ biến động lúc tạo phiếu → tạo lại không giữ chỗ 2 lần', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    failNextAppend(env, 'VPP_BIEN_DONG_KHO');
    const clientRequestId = crypto.randomUUID();
    const first = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    expect(first.res.ok).toBe(false);
    const retry = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    expect(retry.res.ok, JSON.stringify(retry.res.error)).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(env.admin('vppDataReview').data).toMatchObject({ stockMismatches: [], stockDrifts: [] });
    expect(env.admin('adminCancelHandover', { id: retry.res.data.id, reason: 'Thử' }).ok).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
  });

  it('[REVIEW-3] Sheets lỗi khi cập nhật SỐ TỒN sau khi đã ghi sổ → lần ghi kho sau tự đồng bộ theo sổ, không lệch', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    failNextUpdate(env, 'VPP_TON_KHO');
    const clientRequestId = crypto.randomUUID();
    const first = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    expect(first.res.ok).toBe(false);
    expect(env.rt.properties.VPP_STOCK_DIRTY).toContain(pen.productId); // dấu "ghi dở" còn lại
    // Trang đọc tự đồng bộ trước khi hiển thị; lần tạo lại (cùng clientRequestId) không giữ chỗ thêm
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 3 });
    const retry = createSupplyHandover(env, [{ productId: pen.productId, quantity: 3 }], 'DEMO-103', { clientRequestId });
    expect(retry.res.ok, JSON.stringify(retry.res.error)).toBe(true);
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(env.rt.properties.VPP_STOCK_DIRTY).toBeUndefined();
    expect(env.rt.sheet('LICH_SU').toObjects().some((l: any) => l.action === 'VPP_STOCK_SYNCED' && l.handover_id === pen.productId)).toBe(true);
    expect(env.admin('vppDataReview').data).toMatchObject({ stockMismatches: [], stockDrifts: [] });
  });

  it('[REVIEW-3] ai đó sửa tay số tồn trên sheet → "Dữ liệu cần kiểm tra" báo lệch sổ; ĐỒNG BỘ THEO SỔ sửa lại có ghi lịch sử', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 8);
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', 50);
    const drift = env.admin('vppDataReview').data.stockDrifts;
    expect(drift).toEqual([expect.objectContaining({ productId: pen.productId, sheet: { onHand: 50, reserved: 0 }, ledger: { onHand: 8, reserved: 0, movements: 1 } })]);
    const synced = env.admin('vppSyncStock', { productId: pen.productId });
    expect(synced.data).toMatchObject({ synced: true, product: { stock: { onHand: 8, reserved: 0 } } });
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
    expect(env.rt.sheet('LICH_SU').toObjects().find((l: any) => l.action === 'VPP_STOCK_SYNCED')).toMatchObject({ actor: 'Phạm Danh Thái (thai)', entity_type: 'VPP_PRODUCT' });
    expect(env.call('vppSyncStock', { productId: pen.productId }).error?.code).toBe('FORBIDDEN');
  });

  it('[REVIEW-7] khởi tạo định mức chạy lại sau khi admin sửa ĐVT / đổi tên sản phẩm → không tạo sản phẩm / định mức trùng', () => {
    const env = vppEnv();
    const before = { products: products(env).length, norms: env.admin('vppListNorms').data.norms.length };
    const a4 = productByName(env, 'Giấy A4 Excel 80 gsm');
    expect(env.admin('vppSaveProduct', { ...a4, productId: a4.productId, unit: 'Ream' }).ok).toBe(true);
    const lighter = productByName(env, 'Hột quẹt');
    expect(env.admin('vppSaveProduct', { ...lighter, productId: lighter.productId, productName: 'Bật lửa gas' }).ok).toBe(true);
    expect(env.rt.run('seedOfficeSupplyNorms')).toMatch(/tạo 0 sản phẩm, 0 định mức/);
    expect(products(env)).toHaveLength(before.products);
    expect(env.admin('vppListNorms').data.norms).toHaveLength(before.norms);
    expect(env.call('vppEmployeeLookup', { employeeId: 'DEMO-103', client: { ipHash: '8'.repeat(32) } }).data.norms).toHaveLength(13);
  });

  it('[REVIEW-8] số liệu Tổng quan kho khớp danh sách khi bấm vào', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 5);
    const pending = createSupplyHandover(env, [{ productId: pen.productId, quantity: 1 }]);
    const revised = createSupplyHandover(env, [{ productId: pen.productId, quantity: 1 }]);
    env.call('requestRevision', { tokenHash: revised.token.hash, contentHash: contentHashOf(env, revised.token.hash), reason: 'Thêm bút' });
    submit(env, [{ productName: 'Máy hủy giấy', unit: 'Cái', quantity: 1, reason: 'Hủy hồ sơ' }]); // sản phẩm chờ duyệt, tồn 0
    const dash = env.admin('vppDashboard').data;
    expect(dash.counts).toMatchObject({ pendingHandovers: 1, revisionHandovers: 1 });
    expect(pending.res.ok).toBe(true);
    const outList = env.admin('vppListProducts', { stockStatus: 'OUT_OF_STOCK' }).data.products;
    expect(outList).toHaveLength(dash.counts.outOfStock);
    expect(outList.map((p: any) => p.productName)).not.toContain('Máy hủy giấy');
    expect(env.admin('vppListProducts', { catalogStatus: 'MASTER' }).data.products).toHaveLength(dash.counts.products);
  });
});

