import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { confirmAs, createHandover, newToken, setupGas, sha256 } from './helpers';

/**
 * Module Đồng phục (Uniform.gs) — chạy mã Apps Script thật trong bộ giả lập: danh mục mẫu, kho dùng chung bộ máy sổ biến động,
 * phiếu UNIFORM (giữ chỗ / xuất kho / hủy), tiêu chuẩn năm, cho mượn / trả, tương thích ngược mã băm, sửa cột định danh bị đổi tên.
 */

type Env = ReturnType<typeof setupGas>;

const rid = () => crypto.randomUUID();

function yesterday(): string {
  const d = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}

function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}

function setupUniform(): Env {
  const env = setupGas();
  env.rt.run('seedUniformCatalog');
  return env;
}

function stockModels(env: Env) {
  const res = env.admin('dpListStock', {});
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return res.data.models as Array<{
    modelId: string;
    modelCode: string;
    modelName: string;
    sizes: string[];
    countsTowardQuota: boolean;
    skus: Array<{ productId: string; size: string; condition: string; stock: { onHand: number | null; reserved: number; available: number | null } }>;
  }>;
}

function model(env: Env, name: string) {
  const m = stockModels(env).find((x) => x.modelName === name);
  if (!m) throw new Error(`Không thấy mẫu ${name}`);
  return m;
}

function sku(env: Env, name: string, size: string, condition = 'NEW') {
  const s = model(env, name).skus.find((x) => x.size === size && x.condition === condition);
  if (!s) throw new Error(`Không thấy mặt hàng ${name} ${size} ${condition}`);
  return s;
}

function stockIn(env: Env, name: string, size: string, quantity: number, extra: Record<string, unknown> = {}) {
  return env.admin('dpStockIn', {
    modelId: model(env, name).modelId,
    size,
    condition: 'NEW',
    quantity,
    reasonType: 'TON_DAU_KY',
    clientRequestId: rid(),
    ...extra,
  });
}

function uniformHandover(env: Env, uniforms: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  return createHandover(env, {
    handoverType: 'UNIFORM',
    items: [],
    uniforms,
    note: 'Cấp đồng phục',
    ...overrides,
  });
}

function line(productId: string, quantity: number, extra: Record<string, unknown> = {}) {
  return { productId, quantity, issueKind: 'CAP_PHAT', dueDate: '', note: '', overQuotaReason: '', ...extra };
}

function employeeRow(env: Env, employeeId: string) {
  const res = env.admin('dpListEmployees', { includeInactive: true });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  return res.data.employees.find((e: { employeeId: string }) => e.employeeId === employeeId);
}

describe('Đồng phục — danh mục & cấu trúc', () => {
  it('setupDatabase đưa cấu trúc lên v3: sheet DP_*, cột mới, loại "Đồng phục"', () => {
    const env = setupGas();
    expect(env.rt.properties.SCHEMA_VERSION).toBe('3');
    for (const name of ['DP_MAU', 'DP_BIEN_THE', 'DP_TON_KHO', 'DP_BIEN_DONG_KHO', 'DP_DINH_MUC', 'DP_THU_HOI']) {
      expect(env.rt.sheet(name), name).toBeTruthy();
    }
    const items = env.rt.sheet('CHI_TIET_BAN_GIAO');
    const headers = items.getRange(1, 1, 1, items.getLastColumn()).getValues()[0];
    expect(headers).toEqual(expect.arrayContaining(['size', 'issue_kind']));
    const emp = env.rt.sheet('NHAN_VIEN');
    expect(emp.getRange(1, 1, 1, emp.getLastColumn()).getValues()[0]).toEqual(expect.arrayContaining(['gender', 'uniform_size']));
    const cats = env.admin('adminListCategories').data.categories as Array<{ code: string; handoverType: string }>;
    expect(cats.find((c) => c.code === 'DONG_PHUC')?.handoverType).toBe('UNIFORM');
  });

  it('khởi tạo danh mục: 7 mẫu (6 đồng phục + áo bảo hộ), size S–XXL, chạy lại không tạo trùng', () => {
    const env = setupUniform();
    env.rt.run('seedUniformCatalog');
    const models = stockModels(env);
    expect(models).toHaveLength(7);
    expect(models.map((m) => m.modelCode)).toEqual(['DP-001', 'DP-002', 'DP-003', 'DP-004', 'DP-005', 'DP-006', 'DP-007']);
    expect(models.every((m) => m.sizes.join(',') === 'S,M,L,XL,XXL')).toBe(true);
    expect(models.every((m) => m.skus.length === 5 && m.skus.every((s) => s.condition === 'NEW' && s.stock.onHand === 0))).toBe(true);
    expect(models.find((m) => m.modelName === 'Áo bảo hộ')?.countsTowardQuota).toBe(false);
    // Mẫu tạo thêm từ trang quản trị nhận mã kế tiếp (bộ đếm đi sau mã khởi tạo).
    const created = env.admin('dpSaveModel', { modelName: 'Áo khoác gió', gender: 'UNISEX', sizes: ['M', 'L'], unit: 'Cái', clientRequestId: rid() });
    expect(created.ok, JSON.stringify(created.error)).toBe(true);
    expect(created.data.model.modelCode).toBe('DP-008');
  });

  it('tạo mẫu gửi lại cùng mã thao tác → không tạo trùng; bỏ size còn tồn → từ chối', () => {
    const env = setupUniform();
    const request = { modelName: 'Áo polo xám', gender: 'UNISEX', sizes: ['M', 'L', 'XL'], unit: 'Cái', clientRequestId: rid() };
    const first = env.admin('dpSaveModel', request);
    const again = env.admin('dpSaveModel', request);
    expect(first.ok && again.ok).toBe(true);
    expect(again.data.duplicate).toBe(true);
    expect(stockModels(env).filter((m) => m.modelName === 'Áo polo xám')).toHaveLength(1);
    const id = first.data.model.modelId;
    expect(stockIn(env, 'Áo polo xám', 'XL', 3).ok).toBe(true);
    const drop = env.admin('dpSaveModel', { ...request, modelId: id, sizes: ['M', 'L'], clientRequestId: undefined });
    expect(drop.ok).toBe(false);
    expect(drop.error?.code).toBe('INVALID_STATE');
    expect(drop.error?.message).toContain('size XL còn tồn 3');
  });
});

describe('Đồng phục — kho', () => {
  let env: Env;
  beforeEach(() => {
    env = setupUniform();
  });

  it('nhập tồn đầu kỳ: gửi lại cùng mã không cộng 2 lần; cùng mã khác số → REQUEST_REUSED', () => {
    const op = rid();
    expect(stockIn(env, 'Áo sơmi đỏ', 'L', 10, { clientRequestId: op }).ok).toBe(true);
    const dup = stockIn(env, 'Áo sơmi đỏ', 'L', 10, { clientRequestId: op });
    expect(dup.ok && dup.data.duplicate).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock.onHand).toBe(10);
    const reused = stockIn(env, 'Áo sơmi đỏ', 'L', 12, { clientRequestId: op });
    expect(reused.error?.code).toBe('REQUEST_REUSED');
    // Sổ biến động là nguồn sự thật: đúng 1 dòng INITIAL.
    const moves = env.admin('dpListMovements', { productId: sku(env, 'Áo sơmi đỏ', 'L').productId }).data.items;
    expect(moves).toHaveLength(1);
    expect(moves[0].movementType).toBe('INITIAL');
  });

  it('size không thuộc mẫu → lỗi; kiểm kê & thanh lý ghi đúng sổ, không thấp hơn số đang giữ chỗ', () => {
    const wrongSize = stockIn(env, 'Áo sơmi đỏ', '3XL', 1);
    expect(wrongSize.error?.code).toBe('VALIDATION_ERROR');
    expect(wrongSize.error?.details?.fieldErrors?.size).toContain('không thuộc mẫu');
    stockIn(env, 'Áo sơmi đỏ', 'M', 5);
    const m = sku(env, 'Áo sơmi đỏ', 'M');
    const adjust = env.admin('dpStockAdjust', { productId: m.productId, countedQuantity: 4, reason: 'Kiểm kê cuối tháng', clientRequestId: rid() });
    expect(adjust.ok, JSON.stringify(adjust.error)).toBe(true);
    expect(adjust.data.sku.stock.onHand).toBe(4);
    const dispose = env.admin('dpStockDispose', { productId: m.productId, quantity: 1, reason: 'Rách đường may', clientRequestId: rid() });
    expect(dispose.ok, JSON.stringify(dispose.error)).toBe(true);
    expect(dispose.data.sku.stock.onHand).toBe(3);
    const created = uniformHandover(env, [line(m.productId, 3)]);
    expect(created.res.ok, JSON.stringify(created.res.error)).toBe(true);
    const tooMuch = env.admin('dpStockDispose', { productId: m.productId, quantity: 1, reason: 'Thử thanh lý hàng đang giữ', clientRequestId: rid() });
    expect(tooMuch.error?.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('Đồng phục — phiếu bàn giao', () => {
  let env: Env;
  let redL: string;
  beforeEach(() => {
    env = setupUniform();
    stockIn(env, 'Áo sơmi đỏ', 'L', 10);
    redL = sku(env, 'Áo sơmi đỏ', 'L').productId;
    env.admin('dpSaveEmployeeProfile', { employeeId: 'DEMO-519', gender: 'NAM', uniformSize: 'L' });
  });

  it('tạo phiếu → giữ chỗ; ký → xuất kho; dòng có size + hình thức; hủy phiếu khác → trả giữ chỗ', () => {
    const a = uniformHandover(env, [line(redL, 2)]);
    expect(a.res.ok, JSON.stringify(a.res.error)).toBe(true);
    expect(a.res.data.handoverType).toBe('UNIFORM');
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
    const view = env.call('getHandoverByToken', { tokenHash: a.token.hash }).data.handover;
    expect(view.items[0]).toMatchObject({ category: 'DONG_PHUC', itemName: 'Áo sơmi đỏ', size: 'L', issueKind: 'CAP_PHAT', condition: 'Mới', quantity: 2 });
    const signed = confirmAs(env, a.token.hash);
    expect(signed.ok, JSON.stringify(signed.error)).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock).toMatchObject({ onHand: 8, reserved: 0, available: 8 });
    // Ký lần 2 không xuất kho lần 2.
    expect(confirmAs(env, a.token.hash).error?.code).toBe('ALREADY_CONFIRMED');
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock.onHand).toBe(8);

    const b = uniformHandover(env, [line(redL, 1, { overQuotaReason: 'Đổi ca' })], { receiverEmployeeId: 'DEMO-103' });
    expect(b.res.ok, JSON.stringify(b.res.error)).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock.reserved).toBe(1);
    const cancelled = env.admin('adminCancelHandover', { id: b.id, reason: 'Nhầm người nhận', client: {} });
    expect(cancelled.ok, JSON.stringify(cancelled.error)).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('không đủ tồn → INSUFFICIENT_STOCK, không ghi phiếu', () => {
    const before = env.rt.sheet('BAN_GIAO').getLastRow();
    const res = uniformHandover(env, [line(redL, 11)]).res;
    expect(res.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(res.error?.details?.fieldErrors?.['uniforms.0.quantity']).toContain('Khả dụng: 10');
    expect(env.rt.sheet('BAN_GIAO').getLastRow()).toBe(before);
  });

  it('tiêu chuẩn năm mặc định 3: vượt → bắt buộc lý do; cho mượn không tính tiêu chuẩn', () => {
    expect(uniformHandover(env, [line(redL, 2)]).res.ok).toBe(true);
    const over = uniformHandover(env, [line(redL, 2)]).res;
    expect(over.error?.code).toBe('NORM_EXCEEDED');
    expect(over.error?.details?.fieldErrors?.['uniforms.0.overQuotaReason']).toContain('tiêu chuẩn 3/năm');
    const loan = uniformHandover(env, [line(redL, 2, { issueKind: 'CHO_MUON', dueDate: inDays(7) })]).res;
    expect(loan.ok, JSON.stringify(loan.error)).toBe(true);
    const withReason = uniformHandover(env, [line(redL, 2, { overQuotaReason: 'Nhân viên mới chuyển showroom' })]).res;
    expect(withReason.ok, JSON.stringify(withReason.error)).toBe(true);
    const row = employeeRow(env, 'DEMO-519');
    expect(row.usage).toMatchObject({ yearlyQuota: 3, source: 'DEFAULT', issued: 0, pending: 4 });
    expect(row.usage.remaining).toBe(-1);
  });

  it('tổng quan: "Đã cấp năm" chỉ đếm cấp phát đã ký — đồ cho mượn đếm ở "Đang cho mượn"', () => {
    const mixed = uniformHandover(env, [line(redL, 1), line(sku(env, 'Áo sơmi đỏ', 'L').productId, 2, { issueKind: 'CHO_MUON', dueDate: inDays(7) })]);
    expect(mixed.res.ok, JSON.stringify(mixed.res.error)).toBe(true);
    expect(env.admin('dpDashboard', {}).data.counts).toMatchObject({ issuedThisYear: 0, pendingHandovers: 1 });
    expect(confirmAs(env, mixed.token.hash).ok).toBe(true);
    const counts = env.admin('dpDashboard', {}).data.counts;
    expect(counts.issuedThisYear).toBe(1);
    expect(counts.pendingHandovers).toBe(0);
  });

  it('cho mượn bắt buộc hạn trả; dòng đồng phục nhập tay ở phiếu loại khác bị từ chối', () => {
    const noDue = uniformHandover(env, [line(redL, 1, { issueKind: 'CHO_MUON', dueDate: '' })]).res;
    expect(noDue.error?.code).toBe('VALIDATION_ERROR');
    const manual = createHandover(env, {
      handoverType: 'ASSET',
      items: [{ category: 'DONG_PHUC', itemName: 'Áo sơmi đỏ', quantity: 1 }],
    }).res;
    expect(manual.ok).toBe(false);
    expect(JSON.stringify(manual.error)).toContain('phiếu \\"Đồng phục\\"');
  });

  it('cho mượn quá hạn → trang Mượn / Trả + huy hiệu; ghi nhận trả (nhập lại kho hàng cũ) hội tụ theo mã thao tác', () => {
    const loan = uniformHandover(env, [line(redL, 2, { issueKind: 'CHO_MUON', dueDate: yesterday() })]);
    expect(loan.res.ok, JSON.stringify(loan.res.error)).toBe(true);
    expect(confirmAs(env, loan.token.hash).ok).toBe(true);
    const holdings = env.admin('dpListHoldings', { status: 'overdue' }).data;
    expect(holdings.items).toHaveLength(1);
    expect(holdings.items[0]).toMatchObject({ issueKind: 'CHO_MUON', outstanding: 2, overdue: true, size: 'L' });
    expect(env.admin('adminBadges').data.overdueUniformLoans).toBe(1);

    const itemId = holdings.items[0].itemId;
    const request = {
      handoverId: loan.id, itemId, quantity: 1, result: 'RESTOCK', restockCondition: 'USED', reason: 'TRA_MUON', note: '',
      clientRequestId: rid(),
    };
    const first = env.admin('dpRecordReturn', request);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.data.holding).toMatchObject({ returned: 1, outstanding: 1 });
    const again = env.admin('dpRecordReturn', request);
    expect(again.ok && again.data.duplicate).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L', 'USED').stock.onHand).toBe(1);
    expect(env.admin('dpRecordReturn', { ...request, quantity: 2 }).error?.code).toBe('REQUEST_REUSED');
    // Còn 1 cái → báo mất (ghi chú bắt buộc), không nhập kho.
    const lost = env.admin('dpRecordReturn', { ...request, result: 'LOST', restockCondition: '', note: 'Nhân viên làm mất', clientRequestId: rid() });
    expect(lost.ok, JSON.stringify(lost.error)).toBe(true);
    expect(lost.data.holding).toMatchObject({ returned: 2, outstanding: 0, overdue: false });
    expect(env.admin('dpRecordReturn', { ...request, clientRequestId: rid() }).error?.code).toBe('VALIDATION_ERROR');
    expect(env.admin('adminBadges').data.overdueUniformLoans).toBe(0);
    const detail = env.admin('dpEmployeeDetail', { employeeId: 'DEMO-519' }).data;
    expect(detail.returns).toHaveLength(2);
    expect(detail.issues[0].lines[0]).toMatchObject({ issueKind: 'CHO_MUON', size: 'L', quantity: 2 });
  });

  it('đồng phục ghi tay ở phiếu cũ (trước khi có module) được tính vào tiêu chuẩn năm', () => {
    const legacy = createHandover(env, {
      handoverType: 'ASSET',
      items: [{ category: 'TAI_SAN', itemName: 'ÁO ĐỒNG PHỤC', quantity: 2, description: 'ÁO ĐỒNG PHỤC size L' }],
    });
    expect(legacy.res.ok, JSON.stringify(legacy.res.error)).toBe(true);
    expect(confirmAs(env, legacy.token.hash).ok).toBe(true);
    const row = employeeRow(env, 'DEMO-519');
    expect(row.usage).toMatchObject({ legacy: 2, remaining: 1 });
    expect(env.admin('dpEmployeeDetail', { employeeId: 'DEMO-519' }).data.legacyItems).toHaveLength(1);
  });

  it('tiêu chuẩn riêng của nhóm (gắn phòng ban) thay cho mặc định', () => {
    const norm = env.admin('dpSaveNorm', { scopeName: 'HỖ TRỢ GIAO NHẬN', modelId: '', gender: '', yearlyQuantity: 6 });
    expect(norm.ok, JSON.stringify(norm.error)).toBe(true);
    const mapped = env.admin('dpSetScopeMapping', { department: 'KHTH', scopeId: norm.data.norm.scopeId });
    expect(mapped.ok, JSON.stringify(mapped.error)).toBe(true);
    const row = employeeRow(env, 'DEMO-519'); // DEMO-519 thuộc phòng KHTH
    expect(row.scope.scopeId).toBe(norm.data.norm.scopeId);
    expect(row.usage).toMatchObject({ yearlyQuota: 6, source: 'RULE' });
    expect(uniformHandover(env, [line(redL, 5)]).res.ok).toBe(true);
    // "Không áp dụng" → không có tiêu chuẩn.
    env.admin('dpSetScopeMapping', { department: 'KHTH', scopeId: 'NONE' });
    expect(employeeRow(env, 'DEMO-519').usage).toMatchObject({ yearlyQuota: null, source: 'NONE' });
  });

  it('ngữ cảnh form: người nhận (giới tính, size), tiêu chuẩn, tồn khả dụng cộng phần đang giữ cho chính phiếu đang sửa', () => {
    const a = uniformHandover(env, [line(redL, 3)]);
    const ctx = env.admin('dpHandoverContext', { receiverEmployeeId: 'DEMO-519', handoverId: a.id }).data;
    expect(ctx.receiver).toMatchObject({ employeeId: 'DEMO-519', gender: 'NAM', uniformSize: 'L' });
    expect(ctx.usage).toMatchObject({ yearlyQuota: 3, pending: 0 });
    const s = ctx.models.find((m: { modelName: string }) => m.modelName === 'Áo sơmi đỏ').skus.find((x: { size: string }) => x.size === 'L');
    expect(s.reservedByThisHandover).toBe(3);
    expect(s.stock.available).toBe(10);
    // Mẫu nữ (áo dài) xếp sau mẫu nam / unisex khi người nhận là nam.
    const names = ctx.models.map((m: { modelName: string }) => m.modelName);
    expect(names.indexOf('Áo dài vàng')).toBeGreaterThan(names.indexOf('Áo sơmi đỏ'));
  });

  it('sửa phiếu đồng phục: điều chỉnh giữ chỗ theo chênh lệch; không đổi được sang loại khác', () => {
    const a = uniformHandover(env, [line(redL, 3)]);
    const t = newToken();
    const updated = env.admin('adminUpdateHandover', {
      id: a.id, handoverType: 'UNIFORM', sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' }, receiverEmployeeId: 'DEMO-519',
      note: '', items: [], uniforms: [line(redL, 1)], candidateTokenHash: t.hash, candidateTokenNonce: t.nonce, client: {},
    });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    expect(sku(env, 'Áo sơmi đỏ', 'L').stock.reserved).toBe(1);
    const toAsset = env.admin('adminUpdateHandover', {
      id: a.id, handoverType: 'ASSET', sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' }, receiverEmployeeId: 'DEMO-519',
      note: '', items: [{ category: 'THIET_BI_CNTT', itemName: 'Laptop' }], candidateTokenHash: t.hash, candidateTokenNonce: t.nonce, client: {},
    });
    expect(toAsset.error?.code).toBe('INVALID_STATE');
  });
});

describe('Đồng phục — Tồn đầu kỳ / Đã bàn giao / Khả dụng (yêu cầu 17/11/2026)', () => {
  type Totals = { received: number; handedOver: number; returned: number; disposed: number; adjusted: number };
  const view = (env: Env, size: string, condition = 'NEW') => {
    const s = sku(env, 'Áo sơmi đỏ', size, condition) as unknown as { totals: Totals; stock: { onHand: number; reserved: number; available: number } };
    return { ...s.totals, onHand: s.stock.onHand, reserved: s.stock.reserved, available: s.stock.available };
  };
  /** khả dụng = tồn đầu kỳ − đã bàn giao + trả về − thanh lý ± kiểm kê − đang giữ chỗ (mọi mặt hàng của mọi mẫu) */
  const identityHolds = (env: Env) => {
    for (const m of stockModels(env)) {
      for (const s of m.skus as unknown as Array<{ totals: Totals; stock: { onHand: number | null; reserved: number; available: number | null } }>) {
        if (s.stock.available === null) continue;
        const t = s.totals;
        expect(s.stock.available).toBe(t.received - t.handedOver + t.returned - t.disposed + t.adjusted - s.stock.reserved);
      }
    }
  };

  it('tồn đầu kỳ 30, bàn giao 2 → khả dụng 28; nhập bổ sung 10 → tồn đầu kỳ 40, khả dụng 38; số liệu luôn khớp', () => {
    const env = setupUniform();
    env.admin('dpSaveEmployeeProfile', { employeeId: 'DEMO-519', gender: 'NAM', uniformSize: 'L' });
    expect(stockIn(env, 'Áo sơmi đỏ', 'L', 30).ok).toBe(true); // lý do "Tồn đầu kỳ"
    expect(view(env, 'L')).toMatchObject({ received: 30, handedOver: 0, available: 30 });

    const issued = uniformHandover(env, [line(sku(env, 'Áo sơmi đỏ', 'L').productId, 2)]);
    expect(issued.res.ok, JSON.stringify(issued.res.error)).toBe(true);
    // Chờ ký: giữ chỗ 2 → khả dụng 28, chưa tính "đã bàn giao"
    expect(view(env, 'L')).toMatchObject({ received: 30, handedOver: 0, reserved: 2, available: 28 });
    expect(confirmAs(env, issued.token.hash).ok).toBe(true);
    expect(view(env, 'L')).toMatchObject({ received: 30, handedOver: 2, reserved: 0, onHand: 28, available: 28 });

    // Nhập bổ sung: tồn đầu kỳ và khả dụng cùng tăng đúng số nhập
    expect(stockIn(env, 'Áo sơmi đỏ', 'L', 10, { reasonType: 'MUA_MOI' }).ok).toBe(true);
    expect(view(env, 'L')).toMatchObject({ received: 40, handedOver: 2, available: 38 });
    const dashboard = env.admin('dpDashboard', {}).data.counts;
    expect(dashboard).toMatchObject({ received: 40, handedOver: 2, available: 38 });

    // Cho mượn → ký → trả (nhập lại hàng đã qua sử dụng), kiểm kê, thanh lý: phép cộng vẫn khớp
    const loan = uniformHandover(env, [line(sku(env, 'Áo sơmi đỏ', 'L').productId, 1, { issueKind: 'CHO_MUON', dueDate: inDays(5) })]);
    expect(loan.res.ok, JSON.stringify(loan.res.error)).toBe(true);
    expect(confirmAs(env, loan.token.hash).ok).toBe(true);
    const holding = env.admin('dpListHoldings', { status: 'loans' }).data.items[0];
    const back = env.admin('dpRecordReturn', {
      handoverId: loan.id, itemId: holding.itemId, quantity: 1, result: 'RESTOCK', restockCondition: 'USED', reason: 'TRA_MUON', note: '', clientRequestId: rid(),
    });
    expect(back.ok, JSON.stringify(back.error)).toBe(true);
    expect(view(env, 'L')).toMatchObject({ received: 40, handedOver: 3, available: 37 });
    expect(view(env, 'L', 'USED')).toMatchObject({ received: 0, returned: 1, available: 1 });
    const adjust = env.admin('dpStockAdjust', { productId: sku(env, 'Áo sơmi đỏ', 'L').productId, countedQuantity: 36, reason: 'Kiểm kê cuối tháng', clientRequestId: rid() });
    expect(adjust.ok, JSON.stringify(adjust.error)).toBe(true);
    const dispose = env.admin('dpStockDispose', { productId: sku(env, 'Áo sơmi đỏ', 'L').productId, quantity: 2, reason: 'Áo lỗi đường may', clientRequestId: rid() });
    expect(dispose.ok, JSON.stringify(dispose.error)).toBe(true);
    expect(view(env, 'L')).toMatchObject({ received: 40, handedOver: 3, adjusted: -1, disposed: 2, available: 34 });
    identityHolds(env);
  });

  it('cảnh báo hết hàng chỉ với mẫu từng có hàng mới — mẫu chỉ có hàng đã qua sử dụng (vd "Áo tái sử dụng") không báo', () => {
    const env = setupUniform();
    // Chưa nhập gì: không mẫu nào bị báo hết hàng
    expect(env.admin('dpDashboard', {}).data.counts.outOfStockSkus).toBe(0);
    // Áo thun cá sấu: chỉ có hàng đã qua sử dụng
    expect(stockIn(env, 'Áo thun cá sấu', 'L', 35, { condition: 'USED' }).ok).toBe(true);
    // Áo sơmi đỏ: có hàng mới size L → các size mới khác = 0 là hết hàng thật
    expect(stockIn(env, 'Áo sơmi đỏ', 'L', 5).ok).toBe(true);
    const dash = env.admin('dpDashboard', {}).data;
    const alerted = new Set(dash.alerts.map((a: { modelName: string }) => a.modelName));
    expect([...alerted]).toEqual(['Áo sơmi đỏ']);
    expect(dash.counts.outOfStockSkus).toBe(4); // S, M, XL, XXL
    const polo = model(env, 'Áo thun cá sấu') as unknown as { stock: { outOfStockSkus: number } };
    expect(polo.stock.outOfStockSkus).toBe(0);
  });
});

describe('Tương thích ngược & sửa dữ liệu', () => {
  it('mã băm nội dung của dòng KHÔNG có size / hình thức giữ nguyên như v2.0.0 (biên bản cũ không bị MISMATCH)', () => {
    const env = setupGas();
    const rec = {
      handover_code: 'BG-20261009-0001', handover_type: 'ASSET', sender_name: 'Trần Công Khánh', sender_employee_id: '478',
      receiver_employee_id: '0521', receiver_name: 'Phan Thị Mỹ Tiên', receiver_department: 'SHOWROOM HCM',
      receiver_position: 'Nv bán hàng Showroom', receiver_email: '', note: '',
    };
    const item = {
      category: 'TAI_SAN', productId: '', itemName: 'Đồng phục', assetCode: '', serialNumber: '', model: '', quantity: 3, unit: '',
      condition: 'Mới', description: 'Đồng phục size XL', workStatus: '', deadline: '', documentUrl: '', note: '', size: '', issueKind: '',
    };
    // Dạng chuẩn v2.0.0 (14 trường) — sao chép nguyên văn để phát hiện mọi thay đổi vô ý.
    const v200 = JSON.stringify({
      v: 1,
      code: rec.handover_code,
      type: rec.handover_type,
      sender: [rec.sender_name, rec.sender_employee_id],
      receiver: [rec.receiver_employee_id, rec.receiver_name, rec.receiver_department, rec.receiver_position, rec.receiver_email],
      note: rec.note,
      items: [[item.category, '', item.itemName, '', '', '', '3', '', item.condition, item.description, '', '', '', '']],
    });
    expect(env.rt.run('computeContentHash_', rec, [item])).toBe(sha256(v200));
    // Dòng đồng phục có size → dạng chuẩn có thêm size + hình thức (đổi size là đổi nội dung đã ký).
    const withSize = { ...item, category: 'DONG_PHUC', size: 'XL', issueKind: 'CAP_PHAT' };
    const changed = { ...withSize, size: 'L' };
    expect(env.rt.run('computeContentHash_', rec, [withSize])).not.toBe(env.rt.run('computeContentHash_', rec, [changed]));
  });

  it('sự cố VPP_DINH_MUC: tiêu đề "norm_id" bị gõ đè thành "m" → thiết lập lại KHÔNG thêm cột trống mà khôi phục tên cột', () => {
    const env = setupGas({ vpp: true });
    const norms = () => env.admin('vppListNorms', {}).data.norms.length;
    const total = norms();
    expect(total).toBe(30);
    const sheet = env.rt.sheet('VPP_DINH_MUC');
    sheet.getRange(1, 1).setValue('m');
    env.rt.run('resetHeaderCache_');
    env.rt.run('setupDatabase');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    expect(headers.filter((h: string) => h === 'norm_id')).toHaveLength(1);
    expect(headers).not.toContain('m');
    expect(norms()).toBe(total);
  });

  it('trạng thái production (cột "m" giữ mã + cột norm_id mới TRỐNG ở cuối) → sửa cột định danh chép lại mã, định mức hiện lại', () => {
    const env = setupGas({ vpp: true });
    const sheet = env.rt.sheet('VPP_DINH_MUC');
    // Tái hiện đúng như Sheet thật: A1 = "m", thêm cột "norm_id" trống ở cuối (do lần chạy thiết lập bản cũ).
    sheet.getRange(1, 1).setValue('m');
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue('norm_id');
    env.rt.run('resetHeaderCache_');
    env.rt.run('invalidateCaches_');
    expect(env.admin('vppListNorms', {}).data.norms).toHaveLength(0);
    const problems = env.rt.run('idColumnProblems_', env.rt.run('getSpreadsheet_')) as string[];
    expect(problems.join(' ')).toContain('VPP_DINH_MUC');
    const report = env.rt.run('repairIdColumns') as string;
    expect(report).toContain('chép mã định danh từ cột "m" sang cột "norm_id"');
    env.rt.run('resetHeaderCache_');
    expect(env.admin('vppListNorms', {}).data.norms).toHaveLength(30);
    expect(env.rt.run('idColumnProblems_', env.rt.run('getSpreadsheet_'))).toEqual([]);
  });
});

describe('Đồng phục — PDF & xuất CSV', () => {
  function signedLoanAndIssue(env: Env) {
    expect(stockIn(env, 'Áo sơmi đỏ', 'L', 5).ok).toBe(true);
    expect(stockIn(env, 'Áo thun cá sấu', 'M', 3).ok).toBe(true);
    const due = inDays(10);
    const h = uniformHandover(env, [
      line(sku(env, 'Áo sơmi đỏ', 'L').productId, 2),
      line(sku(env, 'Áo thun cá sấu', 'M').productId, 1, { issueKind: 'CHO_MUON', dueDate: due, note: 'Mượn dự sự kiện' }),
    ]);
    expect(h.res.ok, JSON.stringify(h.res.error)).toBe(true);
    expect(confirmAs(env, h.token.hash).ok).toBe(true);
    return { ...h, due };
  }

  it('PDF phiếu đồng phục: tiêu đề riêng, bảng mẫu / size / hình thức + hạn trả, tổng SL, cách xác thực khi ký', () => {
    const env = setupUniform();
    const h = signedLoanAndIssue(env);
    expect(env.call('generatePdf', { id: h.id }, 'system').ok).toBe(true);
    const html = env.rt.lastPdfHtml as string;
    const [y, m, d] = h.due.split('-');
    for (const text of [
      'BIÊN BẢN BÀN GIAO ĐỒNG PHỤC',
      'Danh sách đồng phục (2)',
      'Áo sơmi đỏ',
      'Áo thun cá sấu',
      '<b>L</b>',
      'Cấp phát',
      'Cho mượn',
      `Hạn trả: ${d}/${m}/${y}`,
      'Mượn dự sự kiện',
      'Tổng số lượng',
      'Xác thực khi ký',
    ]) {
      expect(html, text).toContain(text);
    }
    // Phiếu loại khác giữ nguyên tiêu đề / bảng cũ.
    const other = createHandover(env);
    expect(confirmAs(env, other.token.hash).ok).toBe(true);
    expect(env.call('generatePdf', { id: other.id }, 'system').ok).toBe(true);
    expect(env.rt.lastPdfHtml).not.toContain('ĐỒNG PHỤC');
    expect(env.rt.lastPdfHtml).toContain('Nội dung bàn giao');
  });

  it('xuất CSV tồn kho / lịch sử / sổ cấp phát / mượn trả đồng phục', () => {
    const env = setupUniform();
    signedLoanAndIssue(env);
    const csv = (dataset: string, filters: Record<string, unknown> = {}) =>
      env.rt.run('apiAdminExportCsv_', { dataset, filters }) as { header: { fileBase: string; rows: number; total: number }; body: string };

    const stock = csv('uniform-stock.csv');
    expect(stock.header).toMatchObject({ fileBase: 'ton-kho-dong-phuc', rows: 35, total: 35 });
    expect(stock.body).toContain('"Mã mẫu","Mẫu","Loại","Giới tính","Size"');
    // Áo sơmi đỏ L: nhập 5, xuất 2 khi ký → Tồn đầu kỳ 5 · Đã bàn giao 2 · (trả 0 · kiểm kê 0 · thanh lý 0) · tồn 3 · giữ 0 · khả dụng 3.
    expect(stock.body).toContain('"Tồn đầu kỳ (gồm nhập bổ sung)","Đã bàn giao","Trả về kho","Kiểm kê (±)","Thanh lý","Tồn thực tế"');
    expect(stock.body).toMatch(/"DP-001","Áo sơmi đỏ","Đồng phục","Nam","L","Mới","DP-001-L","5","2","0","0","0","3","0","3"/);

    const moves = csv('uniform-movements.csv', { type: 'OUT' });
    expect(moves.header.rows).toBe(2);
    expect(moves.body).toContain('"Xuất kho (bàn giao)","-2"');

    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date()));
    const register = csv('uniform-employees.csv', { year, q: 'DEMO-519' });
    expect(register.header).toMatchObject({ fileBase: `cap-phat-dong-phuc-${year}`, rows: 1 });
    // Tiêu chuẩn 3, đã cấp 2 (đồ mượn không tính), còn 1, đang mượn 1.
    expect(register.body).toMatch(/"DEMO-519","Phạm Danh Thái",.*"3","2","0","0","1","1","0","3"/);

    const holdings = csv('uniform-holdings.csv', { status: 'loans' });
    expect(holdings.header.rows).toBe(1);
    expect(holdings.body).toContain('"Cho mượn","Áo thun cá sấu","M","Mới"');
    expect(() => csv('khac.csv')).toThrow(/Không có dữ liệu xuất này/);
  });

  it('nhãn đồng phục trong CSV khớp giao diện (shared/uniform.ts)', async () => {
    const env = setupUniform();
    const shared = await import('../shared/uniform');
    const labels = JSON.parse(JSON.stringify(env.rt.context.EXPORT_LABELS_));
    expect(labels.uniformMovement).toEqual(shared.UNIFORM_MOVEMENT_LABELS);
    expect(labels.uniformCondition).toEqual(shared.UNIFORM_CONDITION_LABELS);
    expect(labels.uniformGender).toEqual({ ...shared.UNIFORM_GENDER_LABELS, ...shared.EMPLOYEE_GENDER_LABELS, UNISEX: shared.UNIFORM_GENDER_LABELS.UNISEX });
    expect(labels.uniformKind).toEqual(shared.UNIFORM_KIND_LABELS);
    expect(labels.issueKind).toEqual(shared.ISSUE_KIND_LABELS);
  });
});
