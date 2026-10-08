import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmAs,
  contentHashOf,
  createHandover,
  createPayload,
  failNextAppend,
  failNextUpdateAtColumn,
  newToken,
  setCell,
  setupGas,
} from './helpers';

/**
 * Lỗi có thể phát sinh khi Google Sheets lỗi giữa chừng / dữ liệu bị sửa tay / thao tác lặp lại (rà soát 2026-10-07):
 * thứ tự ghi, bước phụ sau khi đã lưu, kho theo sổ biến động, GHÉP, đề xuất mua, chống tạo trùng.
 */

type Env = ReturnType<typeof setupGas>;

const products = (env: Env) => env.admin('vppListProducts', { includeArchived: true }).data.products as any[];
const productByName = (env: Env, name: string) => {
  const p = products(env).find((x) => x.productName === name);
  if (!p) throw new Error(`Không thấy sản phẩm ${name}`);
  return p;
};
const stockOf = (env: Env, name: string) => productByName(env, name).stock;
const history = (env: Env) => env.rt.sheet('LICH_SU').toObjects() as any[];
const proposalIdOf = (env: Env, proposalCode: string) =>
  (env.admin('vppListProposals').data.items as any[]).find((p) => p.proposalCode === proposalCode).proposalId as string;
const movements = (env: Env, productId: string) =>
  (env.rt.sheet('VPP_BIEN_DONG_KHO').toObjects() as any[]).filter((m) => m.product_id === productId);

function stockIn(env: Env, productId: string, quantity: number) {
  const res = env.admin('vppStockIn', { productId, quantity, reasonType: 'BO_SUNG', note: 'test', clientRequestId: crypto.randomUUID() });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
}

function stockCount(env: Env, productId: string, countedQuantity: number) {
  return env.admin('vppStockAdjust', { productId, countedQuantity, reason: 'Kiểm kê thực tế', clientRequestId: crypto.randomUUID() });
}

function supplyHandover(env: Env, productId: string, quantity: number, clientRequestId = crypto.randomUUID()) {
  const token = newToken();
  const res = env.admin('adminCreateHandover', {
    handoverType: 'OFFICE_SUPPLY',
    sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' },
    receiverEmployeeId: 'DEMO-103',
    note: '',
    supplies: [{ productId, quantity, note: '', overNormReason: 'Cần thêm' }],
    tokenHash: token.hash,
    tokenNonce: token.nonce,
    client: { ipHash: 'a'.repeat(32), userAgent: 'vitest-admin' },
    clientRequestId,
  });
  return { res, token, id: res.data?.id as string, code: res.data?.code as string };
}

describe('Biên bản: thứ tự ghi & bước phụ sau khi đã lưu', () => {
  it('trang công khai chỉ thấy email người nhận đã che; quản trị viên thấy đầy đủ', () => {
    const env = setupGas();
    const h = createHandover(env); // DEMO-519 · thai.pham@example.com
    const pub = env.call('getHandoverByToken', { tokenHash: h.token.hash }).data.handover;
    expect(pub.receiver.email).toBe('t***@example.com');
    expect(JSON.stringify(pub)).not.toContain('thai.pham@example.com');
    expect(env.admin('adminGetHandover', { id: h.id }).data.handover.receiver.email).toBe('thai.pham@example.com');
    // Mã băm nội dung vẫn tính trên email đầy đủ phía máy chủ → ký bình thường
    expect(confirmAs(env, h.token.hash).ok).toBe(true);
  });

  it('tạo phiếu: ghi dòng phiếu lỗi sau khi đã ghi nội dung → không có phiếu rỗng; gửi lại cùng mã tạo đủ nội dung', () => {
    const env = setupGas();
    const clientRequestId = crypto.randomUUID();
    const { payload } = createPayload({ clientRequestId });
    failNextAppend(env, 'BAN_GIAO');
    expect(env.admin('adminCreateHandover', payload).ok).toBe(false);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);

    const retry = env.admin('adminCreateHandover', payload);
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(retry.data.duplicate).toBeUndefined();
    const detail = env.admin('adminGetHandover', { id: retry.data.id }).data.handover;
    expect(detail.items).toHaveLength(1);
    // Gửi lại lần nữa → trả đúng phiếu đã tạo (có nội dung), không tạo thêm
    const again = env.admin('adminCreateHandover', payload);
    expect(again.data).toMatchObject({ id: retry.data.id, duplicate: true });
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(1);
  });

  it('ký: lỗi ghi giữa chừng dòng phiếu → trạng thái KHÔNG thành "Đã xác nhận" khi chữ ký chưa ghi đủ; ký lại được', () => {
    const env = setupGas();
    const h = createHandover(env);
    failNextUpdateAtColumn(env, 'BAN_GIAO', 'updated_at'); // khối updated_at / confirmed_at lỗi
    expect(confirmAs(env, h.token.hash).ok).toBe(false);
    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    expect(row.status).toBe('PENDING');
    expect(row.confirmed_at).toBe('');
    // Ký lại (mã OTP vẫn còn hiệu lực — chỉ hủy sau khi đã ghi xong)
    const again = confirmAs(env, h.token.hash);
    expect(again.ok, JSON.stringify(again.error)).toBe(true);
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0]).toMatchObject({ status: 'CONFIRMED', confirm_method: 'OTP_EMAIL' });
  });

  it('ký xong nhưng ghi lịch sử lỗi → người nhận vẫn thấy "đã ký"; lỗi hiện ở trang Cài đặt', () => {
    const env = setupGas();
    const h = createHandover(env);
    const code = contentHashOf(env, h.token.hash) && h.code;
    failNextAppend(env, 'LICH_SU');
    const confirmed = confirmAs(env, h.token.hash);
    expect(confirmed.ok, JSON.stringify(confirmed.error)).toBe(true);
    expect(confirmed.data.handover.status).toBe('CONFIRMED');
    expect(history(env).filter((x) => x.action === 'CONFIRMED')).toHaveLength(0);
    const info = env.admin('adminSystemInfo').data;
    expect(info.pendingChanges.join('\n')).toMatch(new RegExp(`bước phụ "confirm_history" \\(${code}\\)`));
    expect(JSON.parse(env.rt.properties.POST_COMMIT_ERRORS)).toEqual([
      expect.objectContaining({ context: 'confirm_history', ref: code, message: expect.stringContaining('Service Spreadsheets failed') }),
    ]);
  });

  it('lỗi khi đẩy dữ liệu (flush) sau thao tác → báo lỗi, không trả "thành công"', () => {
    const env = setupGas();
    env.rt.faults.set('flush', 1);
    const res = createHandover(env).res;
    expect(res.ok).toBe(false);
    expect(createHandover(env).res.ok).toBe(true);
  });

  it('sửa phiếu: bản đang mở đã cũ (quản trị viên khác vừa lưu) → CONFLICT, không ghi đè; bản mới nhất → lưu được', () => {
    const env = setupGas();
    const h = createHandover(env);
    const opened = env.admin('adminGetHandover', { id: h.id }).data.handover.contentHash;
    const save = (note: string, expectedContentHash: string) => {
      const t = newToken();
      const { payload } = createPayload({ note });
      return env.admin('adminUpdateHandover', { ...payload, id: h.id, candidateTokenHash: t.hash, candidateTokenNonce: t.nonce, expectedContentHash });
    };
    expect(save('Bản của quản trị viên A', opened).ok).toBe(true);
    const stale = save('Bản của quản trị viên B', opened);
    expect(stale.error).toMatchObject({ code: 'CONFLICT', details: { contentChanged: true } });
    expect(env.admin('adminGetHandover', { id: h.id }).data.handover.note).toBe('Bản của quản trị viên A');
    const latest = env.admin('adminGetHandover', { id: h.id }).data.handover.contentHash;
    expect(save('Bản của quản trị viên B', latest).ok).toBe(true);
  });

  it('hủy phiếu VPP: trả giữ chỗ lỗi → phiếu CHƯA bị hủy (không có phiếu đã hủy mà kho vẫn giữ hàng); hủy lại được', () => {
    const env = setupGas({ vpp: true });
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 10);
    const h = supplyHandover(env, pen.productId, 3);
    expect(h.res.ok, JSON.stringify(h.res.error)).toBe(true);
    failNextAppend(env, 'VPP_BIEN_DONG_KHO');
    expect(env.admin('adminCancelHandover', { id: h.id, reason: 'Không cần nữa' }).ok).toBe(false);
    expect(env.admin('adminGetHandover', { id: h.id }).data.handover.status).toBe('PENDING');
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 3 });
    const cancelled = env.admin('adminCancelHandover', { id: h.id, reason: 'Không cần nữa' });
    expect(cancelled.ok, JSON.stringify(cancelled.error)).toBe(true);
    expect(cancelled.data.handover.status).toBe('CANCELLED');
    expect(stockOf(env, pen.productName)).toMatchObject({ onHand: 10, reserved: 0 });
  });
});

describe('Kho văn phòng phẩm: sổ biến động là nguồn sự thật', () => {
  it('kiểm kê sau khi số trên sheet bị sửa tay: chênh lệch tính theo sổ, đồng bộ sau đó không "hoàn tác" kiểm kê', () => {
    const env = setupGas({ vpp: true });
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 8);
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', 50); // sửa tay
    expect(stockCount(env, pen.productId, 10).ok).toBe(true);
    const adjust = movements(env, pen.productId).find((m) => m.movement_type === 'ADJUSTMENT');
    expect(adjust).toMatchObject({ quantity: '2', on_hand_before: '8', on_hand_after: '10' });
    expect(adjust.reason).toContain('hệ thống 8 → thực tế 10');
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
    expect(env.admin('vppSyncStock', { productId: pen.productId }).data).toMatchObject({ synced: false, product: { stock: { onHand: 10 } } });
  });

  it('tồn đầu kỳ nhập tay (chưa có biến động): báo lệch sổ, KHÔNG đồng bộ về 0; kiểm kê ghi số đó vào sổ', () => {
    const env = setupGas({ vpp: true });
    const wipes = productByName(env, 'Khăn giấy ướt');
    setCell(env, 'VPP_TON_KHO', 'product_id', wipes.productId, 'on_hand', 7);
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([
      expect.objectContaining({ productId: wipes.productId, sheet: { onHand: 7, reserved: 0 }, ledger: { onHand: 0, reserved: 0, movements: 0 } }),
    ]);
    expect(env.admin('vppSyncStock', { productId: wipes.productId }).error).toMatchObject({
      code: 'INVALID_STATE', message: expect.stringContaining('chưa có biến động nào'),
    });
    expect(stockOf(env, 'Khăn giấy ướt').onHand).toBe(7);

    expect(stockCount(env, wipes.productId, 7).ok).toBe(true);
    const rows = movements(env, wipes.productId);
    expect(rows.map((m) => [m.movement_type, m.quantity])).toEqual([['INITIAL', '7'], ['ADJUSTMENT', '0']]);
    expect(rows[0].operation_id).toBe(`ADOPT:${wipes.productId}`);
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
  });

  it('tồn nhập tay rồi bàn giao: số trên sheet được ghi vào sổ trước khi giữ chỗ → sổ và sheet luôn khớp', () => {
    const env = setupGas({ vpp: true });
    const wipes = productByName(env, 'Khăn giấy ướt');
    setCell(env, 'VPP_TON_KHO', 'product_id', wipes.productId, 'on_hand', 7);
    const h = supplyHandover(env, wipes.productId, 2);
    expect(h.res.ok, JSON.stringify(h.res.error)).toBe(true);
    expect(movements(env, wipes.productId).map((m) => m.movement_type)).toEqual(['INITIAL', 'RESERVE']);
    expect(stockOf(env, 'Khăn giấy ướt')).toMatchObject({ onHand: 7, reserved: 2, available: 5 });
    expect(confirmAs(env, h.token.hash).ok).toBe(true);
    expect(stockOf(env, 'Khăn giấy ướt')).toMatchObject({ onHand: 5, reserved: 0 });
    expect(env.admin('vppDataReview').data.stockDrifts).toEqual([]);
  });
});

describe('GHÉP sản phẩm (trang Rà soát dữ liệu)', () => {
  it('lần ghép trước lỗi giữa chừng → làm lại với sản phẩm đích KHÁC bị từ chối (không ghi sai đích)', () => {
    const env = setupGas({ vpp: true });
    env.rt.run('seedInitialOfficeSupplyStock');
    const src = productByName(env, 'Bút xanh'); // 24 cây
    const target = productByName(env, 'Bút bi Thiên Long 027, xanh');
    const other = products(env).find((p) => p.catalogStatus === 'MASTER' && p.unit === target.unit && p.productId !== target.productId);
    expect(other).toBeDefined();
    expect(env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: target.productId }).ok).toBe(true);
    // Mô phỏng: bước lưu trữ nguồn bị lỗi → nguồn vẫn còn "chưa ghép"
    setCell(env, 'VPP_SAN_PHAM', 'product_id', src.productId, 'catalog_status', 'TEMP');
    setCell(env, 'VPP_SAN_PHAM', 'product_id', src.productId, 'active', 'TRUE');
    const wrong = env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: other.productId });
    expect(wrong.error).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining(target.productName) });
    expect(productByName(env, 'Bút xanh').mergedIntoProductId).toBe(target.productId);
    expect(stockOf(env, other.productName).onHand).not.toBe(24);
    expect(env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: target.productId }).ok).toBe(true);
    expect(stockOf(env, target.productName).onHand).toBe(24);
  });

  it('không tạo tồn "từ không khí": nguồn đang tồn 0 mà nhập số lượng; đích chưa rõ tồn', () => {
    const env = setupGas({ vpp: true });
    env.rt.run('seedInitialOfficeSupplyStock');
    const target = productByName(env, 'Bút bi Thiên Long 027, xanh');
    const zero = productByName(env, 'Bút xanh');
    expect(stockCount(env, zero.productId, 0).ok).toBe(true); // kiểm kê: thực tế hết
    const fromZero = env.admin('vppMergeProduct', { sourceProductId: zero.productId, targetProductId: target.productId, quantity: 5, unitConverted: true });
    expect(fromZero.error?.details?.fieldErrors?.quantity).toMatch(/đang tồn 0/);
    expect(stockOf(env, target.productName).onHand).toBe(0);

    const toilet = productByName(env, 'Giấy toilet'); // tồn chưa rõ
    const nuoc = productByName(env, 'Nước lau sàn'); // 1 túi
    const intoUnknown = env.admin('vppMergeProduct', { sourceProductId: nuoc.productId, targetProductId: toilet.productId, quantity: 1, unitConverted: true });
    // Đích phải dùng được (sản phẩm danh mục / giữ tạm) và đã rõ tồn
    expect(intoUnknown.ok).toBe(false);
    expect(stockOf(env, 'Giấy toilet').onHand).toBeNull();
  });
});

describe('Rà soát dữ liệu: sản phẩm có thể trùng', () => {
  it('so tên giữ dấu: "Kéo" và "Kẹo" không bị báo trùng; tên gõ không dấu "Keo" nằm trong nhóm của từng tên có dấu', () => {
    const env = setupGas({ vpp: true });
    const create = (productName: string) => {
      const res = env.admin('vppSaveProduct', { productName, unit: 'Cái', catalogStatus: 'TEMP' });
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
    };
    create('Kéo');
    create('Kẹo');
    create('Bút lông, đỏ');
    create('bút  lông đỏ'); // lưu thành "bút lông đỏ" (gộp khoảng trắng)
    const groups = () => env.admin('vppDataReview').data.duplicates.map((g: any) => g.products.map((p: any) => p.productName).sort());
    expect(groups()).toEqual([['Bút lông, đỏ', 'bút lông đỏ'].sort()]);
    create('Keo');
    expect(groups()).toEqual(expect.arrayContaining([['Keo', 'Kéo'], ['Keo', 'Kẹo']]));
    expect(groups()).not.toContainEqual(['Kéo', 'Kẹo']);
  });
});

describe('Chống tạo trùng & đề xuất mua', () => {
  it('tạo sản phẩm gửi lại cùng mã thao tác → trả sản phẩm đã tạo; mã đã dùng cho tên khác → CONFLICT', () => {
    const env = setupGas({ vpp: true });
    const clientRequestId = crypto.randomUUID();
    const body = { productName: 'Bìa lá A4', unit: 'Cái', clientRequestId };
    const first = env.admin('vppSaveProduct', body);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const again = env.admin('vppSaveProduct', body);
    expect(again.data).toMatchObject({ duplicate: true, product: { productId: first.data.product.productId } });
    expect(products(env).filter((p) => p.productName === 'Bìa lá A4')).toHaveLength(1);
    expect(env.admin('vppSaveProduct', { ...body, productName: 'Bìa còng' }).error?.code).toBe('CONFLICT');
  });

  it('gửi đề xuất: lỗi ghi giữa chừng → gửi lại cùng mã ghi tiếp phần thiếu (không sản phẩm chờ duyệt mồ côi, không đề xuất 0 dòng)', () => {
    const env = setupGas({ vpp: true });
    const clientRequestId = crypto.randomUUID();
    const payload = {
      employeeId: 'DEMO-103', client: { ipHash: 'e'.repeat(32) }, clientRequestId,
      items: [
        { productName: 'Máy đếm tiền mini', unit: 'Cái', quantity: 1, reason: 'Thu ngân' },
        { productName: 'Bút xóa kéo', unit: 'Cây', quantity: 3, reason: 'Sửa chứng từ' },
      ],
    };
    const pendingCount = () => products(env).filter((p) => p.catalogStatus === 'PENDING_APPROVAL').length;
    failNextAppend(env, 'VPP_DE_XUAT'); // sản phẩm + dòng đã ghi, dòng đề xuất tổng lỗi
    expect(env.call('vppSubmitProposal', payload).ok).toBe(false);
    expect(env.rt.sheet('VPP_DE_XUAT').toObjects()).toHaveLength(0);
    expect(pendingCount()).toBe(2);

    const retry = env.call('vppSubmitProposal', payload);
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(pendingCount()).toBe(2); // không tạo thêm
    expect(env.rt.sheet('VPP_DE_XUAT_CHI_TIET').toObjects()).toHaveLength(2);
    const detail = env.admin('vppGetProposal', { id: proposalIdOf(env, retry.data.proposalCode) }).data;
    expect(detail.items).toHaveLength(2);
    expect(env.call('vppSubmitProposal', payload).data).toMatchObject({ duplicate: true });
  });

  it('giới hạn đề xuất / nhân viên / ngày đếm từ sheet; đề xuất bị lỗi dữ liệu không bị tính', () => {
    const env = setupGas({ vpp: true });
    const submit = (i: number, extra: Record<string, unknown> = {}) => env.call('vppSubmitProposal', {
      employeeId: 'DEMO-103', client: { ipHash: 'f'.repeat(32) }, clientRequestId: crypto.randomUUID(),
      items: [{ productName: `Sản phẩm thử ${i}`, unit: 'Cái', quantity: 1, reason: 'Thử' }], ...extra,
    });
    for (let i = 0; i < 3; i++) expect(submit(100 + i, { items: [] }).error?.code).toBe('VALIDATION_ERROR');
    for (let i = 0; i < 10; i++) expect(submit(i).ok).toBe(true);
    expect(submit(11).error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringContaining('10 đề xuất mỗi ngày') });
    // Nhân viên khác không bị ảnh hưởng
    expect(env.call('vppSubmitProposal', {
      employeeId: 'DEMO-105', client: { ipHash: 'f'.repeat(32) }, clientRequestId: crypto.randomUUID(),
      items: [{ productName: 'Sản phẩm thử khác', unit: 'Cái', quantity: 1, reason: 'Thử' }],
    }).ok).toBe(true);
  });

  it('GHÉP sản phẩm mới trong đề xuất sang sản phẩm khác ĐVT → bắt quy đổi số lượng', () => {
    const env = setupGas({ vpp: true });
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    expect(pen.unit).not.toBe('Hộp');
    const sent = env.call('vppSubmitProposal', {
      employeeId: 'DEMO-103', client: { ipHash: 'g'.repeat(32) }, clientRequestId: crypto.randomUUID(),
      items: [{ productName: 'Ruột bút bi xanh', unit: 'Hộp', quantity: 2, reason: 'Thay ruột' }],
    });
    expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
    const id = proposalIdOf(env, sent.data.proposalCode);
    const line = env.admin('vppGetProposal', { id }).data.items[0];
    const map = { id, proposalItemId: line.proposalItemId, decision: 'MAP', targetProductId: pen.productId };
    expect(env.admin('vppProductDecision', map).error?.details?.fieldErrors?.convertedQuantity).toContain('Hộp');
    expect(env.admin('vppProductDecision', { ...map, convertedQuantity: 20 }).error?.details?.fieldErrors?.unitConverted).toBeTruthy();
    const mapped = env.admin('vppProductDecision', { ...map, convertedQuantity: 20, unitConverted: true });
    expect(mapped.ok, JSON.stringify(mapped.error)).toBe(true);
    expect(mapped.data.items[0]).toMatchObject({ productApprovalStatus: 'MAPPED', productId: pen.productId, requestedQuantity: 20, unit: pen.unit });
    expect(history(env).at(-1).message).toContain(`quy đổi 2 Hộp → 20 ${pen.unit}`);
  });

  it('nhận hàng cho dòng có sản phẩm đã được GHÉP: cùng ĐVT → nhập vào sản phẩm đích; khác ĐVT → báo rõ, không nhập sai', () => {
    const env = setupGas({ vpp: true });
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    const sent = env.call('vppSubmitProposal', {
      employeeId: 'DEMO-103', client: { ipHash: 'h'.repeat(32) }, clientRequestId: crypto.randomUUID(),
      items: [
        { productName: 'Bút bi đỏ', unit: pen.unit, quantity: 3, reason: 'Ký nháy' },
        { productName: 'Hộp bút bi đen', unit: 'Hộp', quantity: 1, reason: 'Dự phòng' },
      ],
    });
    expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
    const id = proposalIdOf(env, sent.data.proposalCode);
    const [red, box] = env.admin('vppGetProposal', { id }).data.items;
    for (const [line, unit] of [[red, pen.unit], [box, 'Hộp']] as const) {
      const kept = env.admin('vppProductDecision', { id, proposalItemId: line.proposalItemId, decision: 'TEMP', productName: line.temporaryProductName, unit });
      expect(kept.ok, JSON.stringify(kept.error)).toBe(true);
    }
    const lines = env.admin('vppGetProposal', { id }).data.items;
    expect(env.admin('vppReviewProposal', {
      id, decisions: lines.map((l: any) => ({ proposalItemId: l.proposalItemId, approvedQuantity: l.requestedQuantity })),
    }).ok).toBe(true);
    // Sau đó cả hai sản phẩm giữ tạm được GHÉP vào bút bi Thiên Long ở trang Rà soát dữ liệu
    for (const l of lines) {
      const merged = env.admin('vppMergeProduct', { sourceProductId: l.productId, targetProductId: pen.productId, quantity: 0 });
      expect(merged.ok, JSON.stringify(merged.error)).toBe(true);
    }
    const receive = (redQty: number, boxQty: number) => env.admin('vppReceiveProposal', {
      id, lines: [{ proposalItemId: red.proposalItemId, receivedQuantity: redQty }, { proposalItemId: box.proposalItemId, receivedQuantity: boxQty }],
    });
    expect(receive(3, 1).error?.details?.fieldErrors?.['lines.1.receivedQuantity']).toMatch(/khác ĐVT/);
    const ok = receive(3, 0);
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(stockOf(env, pen.productName).onHand).toBe(3);
    expect(movements(env, pen.productId).find((m) => m.movement_type === 'IN').reason).toContain('đã ghép vào');
  });
});
