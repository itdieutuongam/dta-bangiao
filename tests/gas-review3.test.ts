import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGasRuntime, signGasRequest } from '../scripts/gas-emulator/runtime.mjs';
import { APP_VERSION, HANDOVER_TYPE_LABELS, STATUS_LABELS } from '../shared/constants';
import { CATALOG_STATUS_LABELS, MOVEMENT_TYPE_LABELS, PROPOSAL_STATUS_LABELS, STOCK_STATUS_LABELS } from '../shared/vpp';
import {
  confirmAs,
  contentHashOf,
  createHandover,
  failNextAppend,
  failNextUpdate,
  failNextUpdateAtColumn,
  itemInput,
  makePng,
  newToken,
  RECEIVER_CLIENT,
  ROOT,
  setCell,
  setSetting,
  setupGas,
  signatureBase64,
} from './helpers';

/**
 * Rà soát 3 (08/10/2026): toàn vẹn biên bản đã ký (niêm phong), sửa phiếu trọn vẹn khi lỗi giữa chừng, gửi lại cùng mã thao tác
 * với nội dung khác, hiển thị đủ trường đã ký. Mỗi ca dựng lại đúng kịch bản lỗi trước khi sửa.
 */

const SEAL_KEY = 'a1'.repeat(32); // khóa niêm phong Worker gửi kèm (HMAC từ RECORD_SEAL_SECRET)

type Env = ReturnType<typeof setupGas>;

function rowOf(env: Env, id: string) {
  return env.rt.sheet('BAN_GIAO').toObjects().find((r: { handover_id: string }) => r.handover_id === id);
}

function adminDetail(env: Env, id: string, sealKey?: string) {
  const res = env.admin('adminGetHandover', sealKey ? { id, sealKey } : { id });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data.handover;
}

/** Tạo + ký một phiếu (có niêm phong). */
function signedHandover(env: Env, overrides: Record<string, unknown> = {}) {
  const created = createHandover(env, overrides);
  const signed = confirmAs(env, created.token.hash, { sealKey: SEAL_KEY, comment: 'Máy trầy góc, CHƯA nhận sạc 65W' });
  if (!signed.ok) throw new Error(JSON.stringify(signed.error));
  return created;
}

/** Sửa phiếu như trang sửa: expectedContentHash = mã nội dung lúc mở trang. */
function editAs(env: Env, id: string, overrides: Record<string, unknown>, expectedContentHash: string) {
  const t = newToken();
  return env.admin('adminUpdateHandover', {
    id,
    handoverType: 'OTHER',
    sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
    receiverEmployeeId: 'DEMO-519',
    note: 'Bàn giao thiết bị',
    items: [itemInput()],
    candidateTokenHash: t.hash,
    candidateTokenNonce: t.nonce,
    client: { ipHash: 'c'.repeat(32), userAgent: 'vitest' },
    expectedContentHash,
    ...overrides,
  });
}

function publicView(env: Env, tokenHash: string) {
  const view = env.call('getHandoverByToken', { tokenHash });
  if (!view.ok) throw new Error(JSON.stringify(view.error));
  return view.data.handover;
}

describe('[RÀ SOÁT 3] Toàn vẹn biên bản đã ký — niêm phong cả ý kiến, thời điểm, chữ ký', () => {
  it('ký kèm khóa → niêm phong; kiểm tra có khóa = OK, không có khóa = chưa kiểm được niêm phong (không báo sai)', () => {
    const env = setupGas();
    const { id } = signedHandover(env);
    const row = rowOf(env, id);
    expect(row.record_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.record_seal).toMatch(/^[0-9a-f]{64}$/);
    expect(adminDetail(env, id, SEAL_KEY).integrity).toMatchObject({ status: 'OK', checks: { content: true, record: true, seal: 'OK' } });
    expect(adminDetail(env, id).integrity).toMatchObject({ status: 'OK', checks: { seal: 'UNVERIFIED' } });
  });

  it('sửa tay ý kiến người nhận / ngày ký trên Sheet → MISMATCH, không tạo lại PDF từ dữ liệu đã sửa; PDF gốc vẫn tải được', () => {
    const env = setupGas();
    const { id, token } = signedHandover(env);
    expect(env.call('generatePdf', { id, sealKey: SEAL_KEY }, 'system').ok).toBe(true);
    const originalPdf = rowOf(env, id).pdf_file_id;

    setCell(env, 'BAN_GIAO', 'handover_id', id, 'receiver_comment', '');
    setCell(env, 'BAN_GIAO', 'handover_id', id, 'confirmed_at', '2026-01-02T09:00:00+07:00');
    const detail = adminDetail(env, id, SEAL_KEY);
    expect(detail.integrity).toMatchObject({ status: 'MISMATCH', checks: { content: true, record: false } });

    const regen = env.admin('adminGeneratePdf', { id, force: true, sealKey: SEAL_KEY });
    expect(regen.error?.code).toBe('INTEGRITY_ERROR');
    expect(regen.error?.message).toMatch(/ý kiến người nhận/);
    // Người nhận vẫn tải được bản PDF gốc (lúc ký), không bị thay bằng bản dựng từ dữ liệu đã sửa.
    const pdf = env.call('getPdfByToken', { tokenHash: token.hash, sealKey: SEAL_KEY });
    expect(pdf.ok).toBe(true);
    expect(rowOf(env, id).pdf_file_id).toBe(originalPdf);
  });

  it('sửa nội dung rồi TỰ TÍNH LẠI content_hash + record_hash (như người biết thuật toán) → niêm phong phát hiện', () => {
    const env = setupGas();
    const { id } = signedHandover(env);
    const itemRow = env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects().find((r: { handover_id: string }) => r.handover_id === id);
    setCell(env, 'CHI_TIET_BAN_GIAO', 'item_id', itemRow.item_id, 'condition', 'Hỏng màn hình');
    // Tính lại đúng như code: content_hash từ dữ liệu mới, rồi record_hash từ content_hash mới.
    const rec = env.rt.run('findHandoverById_', id).record;
    const items = env.rt.run('loadItems_', id, rec);
    const contentHash = env.rt.run('computeContentHash_', rec, items);
    setCell(env, 'BAN_GIAO', 'handover_id', id, 'content_hash', contentHash);
    const rec2 = env.rt.run('findHandoverById_', id).record;
    setCell(env, 'BAN_GIAO', 'handover_id', id, 'record_hash', env.rt.run('computeRecordHash_', rec2));

    expect(adminDetail(env, id, SEAL_KEY).integrity).toMatchObject({
      status: 'MISMATCH',
      checks: { content: true, record: true, seal: 'MISMATCH' },
    });
    expect(env.admin('adminGeneratePdf', { id, force: true, sealKey: SEAL_KEY }).error?.code).toBe('INTEGRITY_ERROR');
  });

  it('chép cột chữ ký của phiếu khác sang (tráo chữ ký) → MISMATCH; ảnh chữ ký trên Drive bị thay → không hiện như chữ ký thật', () => {
    const env = setupGas();
    const a = signedHandover(env);
    const b = signedHandover(env, { receiverEmployeeId: 'DEMO-102' });
    const rowB = rowOf(env, b.id);
    for (const col of ['signature_file_id', 'signature_file_url', 'signature_sha256']) {
      setCell(env, 'BAN_GIAO', 'handover_id', a.id, col, rowB[col]);
    }
    expect(adminDetail(env, a.id, SEAL_KEY).integrity).toMatchObject({ status: 'MISMATCH', checks: { record: false } });
    // "Xem chữ ký" của A không hiện ảnh của B như thể là chữ ký của A.
    expect(env.admin('adminGetSignature', { id: a.id, sealKey: SEAL_KEY }).error?.code).toBe('INTEGRITY_ERROR');

    // Thay nội dung file chữ ký của B trên Drive.
    env.rt.drive.items.get(rowB.signature_file_id).bytes = makePng(300, 120);
    const sig = env.admin('adminGetSignature', { id: b.id });
    expect(sig.error?.code).toBe('INTEGRITY_ERROR');
  });

  it('ký khi Worker chưa có khóa: vẫn có mã băm toàn biên bản (phát hiện sửa tay thông thường), niêm phong = NONE', () => {
    const env = setupGas();
    const created = createHandover(env);
    expect(confirmAs(env, created.token.hash).ok).toBe(true);
    expect(rowOf(env, created.id).record_seal).toBe('');
    expect(adminDetail(env, created.id, SEAL_KEY).integrity).toMatchObject({ status: 'OK', checks: { record: true, seal: 'NONE' } });
    setCell(env, 'BAN_GIAO', 'handover_id', created.id, 'receiver_comment', 'Đã nhận đủ');
    expect(adminDetail(env, created.id).integrity.status).toBe('MISMATCH');
  });
});

describe('[RÀ SOÁT 3] Sửa phiếu trọn vẹn — lỗi giữa chừng không để lộ nội dung lẫn cũ / mới', () => {
  const newItems = [
    itemInput({ itemName: 'Laptop A', serialNumber: 'SN-MOI' }),
    itemInput({ itemName: 'Sạc laptop Dell 65W', assetCode: '', serialNumber: '', model: '' }),
  ];

  it('lỗi khi ghi các cột phiếu → người nhận KHÔNG ký được (đang cập nhật), nội dung vẫn là bản cũ; lưu lại → hoàn tất', () => {
    const env = setupGas();
    const { id, token } = createHandover(env, { items: [itemInput({ itemName: 'Laptop A' }), itemInput({ itemName: 'Chuột' })] });
    const base = contentHashOf(env, token.hash);
    failNextUpdateAtColumn(env, 'BAN_GIAO', 'note');
    const failed = editAs(env, id, { items: newItems, note: 'Đã sửa' }, base);
    expect(failed.ok).toBe(false);

    const view = publicView(env, token.hash);
    expect(view.updating).toBe(true);
    expect(view.items.map((i: { itemName: string }) => i.itemName)).toEqual(['Laptop A', 'Chuột']); // bản cũ trọn vẹn
    const otp = env.call('requestConfirmOtp', { tokenHash: token.hash, client: { ipHash: 'b'.repeat(32), userAgent: 'x' } });
    expect(otp.error?.code).toBe('INVALID_STATE'); // không gửi mã cho phiếu chưa ký được
    const blocked = confirmAs(env, token.hash, { otp: '' });
    expect(blocked.error?.code).toBe('INVALID_STATE');
    expect(blocked.error?.message).toMatch(/đang được quản trị viên cập nhật/);
    expect(env.call('requestRevision', { tokenHash: token.hash, contentHash: view.contentHash, reason: 'Sai serial máy' }).error?.code).toBe(
      'INVALID_STATE',
    );
    expect(adminDetail(env, id).editPendingSince).not.toBe('');

    // Lưu lại từ đúng trang sửa cũ (cùng expectedContentHash) → không báo xung đột oan, hoàn tất.
    const retry = editAs(env, id, { items: newItems, note: 'Đã sửa' }, base);
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    const after = publicView(env, token.hash);
    expect(after.updating).toBe(false);
    expect(after.note).toBe('Đã sửa');
    expect(after.items.map((i: { itemName: string }) => i.itemName)).toEqual(['Laptop A', 'Sạc laptop Dell 65W']);
    expect(confirmAs(env, token.hash).ok).toBe(true);
    // Danh sách quản trị đếm đúng số nội dung (không cộng dòng của lần sửa lỗi).
    const list = env.admin('adminListHandovers', {}).data.items.find((h: { id: string }) => h.id === id);
    expect(list.itemCount).toBe(2);
  });

  it('lỗi khi ghi dòng nội dung mới / dấu "đang sửa" → người nhận vẫn thấy & ký được bản cũ trọn vẹn (không lẫn dòng mới)', () => {
    for (const fail of ['append-items', 'marker'] as const) {
      const env = setupGas();
      const { id, token } = createHandover(env, { items: [itemInput({ itemName: 'Laptop A' })] });
      const base = contentHashOf(env, token.hash);
      if (fail === 'append-items') failNextAppend(env, 'CHI_TIET_BAN_GIAO');
      else failNextUpdateAtColumn(env, 'BAN_GIAO', 'edit_pending');
      expect(editAs(env, id, { items: newItems }, base).ok).toBe(false);
      const view = publicView(env, token.hash);
      expect(view.updating, fail).toBe(false);
      expect(view.items.map((i: { itemName: string }) => i.itemName), fail).toEqual(['Laptop A']);
      expect(confirmAs(env, token.hash).ok, fail).toBe(true);
    }
  });

  it('đổi người nhận + lỗi giữa chừng → người nhận CŨ không ký được nội dung mới; lưu lại → link mới dùng được, link cũ hết hiệu lực', () => {
    const env = setupGas();
    const { id, token } = createHandover(env, { items: [itemInput({ itemName: 'Laptop A' })] });
    const base = contentHashOf(env, token.hash);
    failNextUpdateAtColumn(env, 'BAN_GIAO', 'items_revision'); // lỗi đúng ở bước chốt (sau khi các cột phiếu đã ghi)
    const failed = editAs(env, id, { receiverEmployeeId: 'DEMO-102', items: newItems }, base);
    expect(failed.ok).toBe(false);
    // Link cũ (của người nhận cũ) không còn dẫn tới nội dung mới để ký: mã băm link (cột chốt hạng 1) đã đổi TRƯỚC bước lỗi
    // (items_revision, hạng 3) — link cũ không mở được, không ký được.
    expect(env.call('getHandoverByToken', { tokenHash: token.hash }).error?.code).toBe('NOT_FOUND');
    const signOld = env.call('confirmHandover', {
      tokenHash: token.hash, agreed: true, contentHash: base, signatureBase64: signatureBase64(), comment: '', otp: '', client: RECEIVER_CLIENT,
    });
    expect(signOld.error?.code).toBe('NOT_FOUND');

    const t = newToken();
    const retry = env.admin('adminUpdateHandover', {
      id, handoverType: 'OTHER', sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' }, receiverEmployeeId: 'DEMO-102',
      note: 'Bàn giao thiết bị', items: newItems, candidateTokenHash: t.hash, candidateTokenNonce: t.nonce,
      client: { ipHash: 'c'.repeat(32), userAgent: 'vitest' }, expectedContentHash: base,
    });
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(retry.data.linkRotated).toBe(true); // trang báo "đã cấp link mới — hãy gửi lại link" (không bảo dùng link cũ)
    expect(env.call('getHandoverByToken', { tokenHash: token.hash }).error?.code).toBe('NOT_FOUND');
    const fresh = publicView(env, t.hash);
    expect(fresh.receiver.employeeId).toBe('DEMO-102');
    expect(fresh.items).toHaveLength(2);
    expect(confirmAs(env, t.hash).ok).toBe(true);
  });

  it('hủy phiếu đang sửa dở → hủy được, không còn dấu "đang sửa"', () => {
    const env = setupGas();
    const { id, token } = createHandover(env);
    failNextUpdateAtColumn(env, 'BAN_GIAO', 'note');
    expect(editAs(env, id, { items: newItems, note: 'x' }, contentHashOf(env, token.hash)).ok).toBe(false);
    expect(env.admin('adminCancelHandover', { id, reason: 'Lập lại phiếu' }).ok).toBe(true);
    expect(rowOf(env, id).edit_pending).toBe('');
    expect(rowOf(env, id).status).toBe('CANCELLED');
  });
});

describe('[RÀ SOÁT 3] Gửi lại cùng mã thao tác (clientRequestId) với nội dung KHÁC', () => {
  it('tạo phiếu: lần đầu đã lưu (mất phản hồi), sửa form rồi gửi lại → REQUEST_REUSED nêu phiếu đã lưu, không trả "gửi trùng"', () => {
    const env = setupGas();
    const requestId = crypto.randomUUID();
    const first = createHandover(env, { clientRequestId: requestId, items: [itemInput({ serialNumber: 'SN-SAI-111' })] });
    expect(first.res.ok).toBe(true);

    const changed = createHandover(env, {
      clientRequestId: requestId,
      receiverEmployeeId: 'DEMO-102',
      items: [itemInput({ serialNumber: 'SN-DUNG-222' }), itemInput({ itemName: 'Sạc laptop Dell 65W', serialNumber: '' })],
    });
    expect(changed.res.ok).toBe(false);
    expect(changed.res.error?.code).toBe('REQUEST_REUSED');
    expect(changed.res.error?.message).toMatch(new RegExp(first.code));
    expect(changed.res.error?.details).toMatchObject({ existing: { id: first.id, code: first.code } });
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(1); // không tạo thêm, không ghi đè

    // Gửi lại ĐÚNG nội dung đã lưu → vẫn là "gửi trùng" bình thường.
    const same = createHandover(env, { clientRequestId: requestId, items: [itemInput({ serialNumber: 'SN-SAI-111' })] });
    expect(same.res.ok).toBe(true);
    expect(same.res.data.duplicate).toBe(true);
    expect(same.res.data.code).toBe(first.code);
  });
});

describe('[RÀ SOÁT 3] Trường đã có dữ liệu vẫn hiện khi cấu hình loại nội dung đổi sau đó', () => {
  it('bỏ ô Serial khỏi loại THIET_BI_CNTT sau khi ký → PDF vẫn in Serial', () => {
    const env = setupGas();
    const { id } = signedHandover(env, { handoverType: 'ASSET', items: [itemInput({ serialNumber: 'SN123456' })] });
    const cat = env.rt.sheet('LOAI_BAN_GIAO').toObjects().find((c: { code: string }) => c.code === 'THIET_BI_CNTT');
    setCell(env, 'LOAI_BAN_GIAO', 'code', 'THIET_BI_CNTT', 'form_fields', cat.form_fields.replace('|serial_number:Serial', ''));
    env.rt.run('invalidateCaches_');
    expect(env.admin('adminGeneratePdf', { id, force: true, sealKey: SEAL_KEY }).ok).toBe(true);
    expect(env.rt.lastPdfHtml).toContain('SN123456');
  });
});

// ============================================================================
// Văn phòng phẩm
// ============================================================================

function vppEnv() {
  return setupGas({ vpp: true });
}

function products(env: Env) {
  return env.admin('vppListProducts', { includeArchived: true }).data.products as any[];
}

function productByName(env: Env, name: string) {
  const p = products(env).find((x) => x.productName === name);
  if (!p) throw new Error(`Không thấy sản phẩm ${name}`);
  return p;
}

function stockIn(env: Env, productId: string, quantity: number, clientRequestId: string = crypto.randomUUID()) {
  return env.admin('vppStockIn', { productId, quantity, reasonType: 'BO_SUNG', note: 'test', clientRequestId });
}

function saveProduct(env: Env, fields: Record<string, unknown>) {
  const res = env.admin('vppSaveProduct', { catalogStatus: 'MASTER', minimumStock: 0, clientRequestId: crypto.randomUUID(), ...fields });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.data.product;
}

function supplyHandover(env: Env, lines: Array<{ productId: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  const token = newToken();
  const res = env.admin('adminCreateHandover', {
    handoverType: 'OFFICE_SUPPLY',
    sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' },
    receiverEmployeeId: 'DEMO-103',
    note: '',
    supplies: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, note: '', overNormReason: 'Cần thêm' })),
    tokenHash: token.hash,
    tokenNonce: token.nonce,
    client: { ipHash: 'a'.repeat(32), userAgent: 'vitest-admin' },
    clientRequestId: crypto.randomUUID(),
    ...extra,
  });
  return { res, token, id: res.data?.id as string };
}

const STAFF = { employeeId: 'DEMO-103', client: { ipHash: 'd'.repeat(32) } };

function submitProposal(env: Env, items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return env.call('vppSubmitProposal', { ...STAFF, items, ...extra });
}

function latestProposal(env: Env) {
  const id = env.admin('vppListProposals').data.items[0].proposalId as string;
  return env.admin('vppGetProposal', { id }).data;
}

describe('[RÀ SOÁT 3] VPP — kiểm tra tồn khi tạo / sửa phiếu dùng đúng số của bước giữ chỗ (sổ biến động)', () => {
  it('số trên sheet bị sửa tay (50, sổ: 8) → tạo phiếu 9 bị từ chối TRƯỚC khi ghi; không có phiếu "lỗi nhưng đã lưu"', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    expect(stockIn(env, pen.productId, 8).ok).toBe(true);
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', '50');
    const res = supplyHandover(env, [{ productId: pen.productId, quantity: 9 }]).res;
    expect(res.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(res.error?.message).toMatch(/khả dụng 8, yêu cầu 9/);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
    expect(env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()).toHaveLength(0);
    // Form tạo phiếu hiện khả dụng theo sổ (8), không theo số sửa tay (50).
    const ctx = env.admin('vppHandoverContext', { receiverEmployeeId: 'DEMO-103' }).data.products.find((p: any) => p.productId === pen.productId);
    expect(ctx.stock.available).toBe(8);
  });

  it('lần ghi kho trước lỗi giữa chừng (còn dấu ghi dở) → sửa phiếu vượt tồn bị từ chối, nội dung phiếu KHÔNG đổi', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    expect(stockIn(env, pen.productId, 10).ok).toBe(true);
    const h1 = supplyHandover(env, [{ productId: pen.productId, quantity: 2 }]);
    expect(h1.res.ok, JSON.stringify(h1.res.error)).toBe(true);
    // Phiếu 2: lỗi ghi số tồn tổng hợp sau khi sổ đã ghi giữ chỗ 3 → còn dấu "đang ghi"; gửi lại = trùng (không giữ thêm).
    const requestId = crypto.randomUUID();
    failNextUpdate(env, 'VPP_TON_KHO');
    expect(supplyHandover(env, [{ productId: pen.productId, quantity: 3 }], { clientRequestId: requestId }).res.ok).toBe(false);
    expect(supplyHandover(env, [{ productId: pen.productId, quantity: 3 }], { clientRequestId: requestId }).res.data.duplicate).toBe(true);
    // Sửa phiếu 1 lên 8: thực tế khả dụng cho phiếu 1 = 10 − 5 + 2 = 7 → phải bị từ chối, phiếu 1 vẫn là 2.
    const t = newToken();
    const edit = env.admin('adminUpdateHandover', {
      id: h1.id, handoverType: 'OFFICE_SUPPLY', sender: { name: 'Đỗ Thị Hương', employeeId: 'DEMO-104' }, receiverEmployeeId: 'DEMO-103',
      note: '', supplies: [{ productId: pen.productId, quantity: 8, note: '', overNormReason: 'Cần thêm' }],
      candidateTokenHash: t.hash, candidateTokenNonce: t.nonce, client: { ipHash: 'a'.repeat(32), userAgent: 'x' },
    });
    expect(edit.error?.code).toBe('INSUFFICIENT_STOCK');
    expect(edit.error?.message).toMatch(/khả dụng 7, yêu cầu 8/);
    expect(publicView(env, h1.token.hash).items[0].quantity).toBe(2);
    expect(productByName(env, 'Bút bi Thiên Long 027, xanh').stock).toMatchObject({ onHand: 10, reserved: 5 });
  });

  it('không lưu trữ được sản phẩm đang giữ chỗ dù số giữ chỗ trên sheet bị sửa về 0', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    stockIn(env, pen.productId, 5);
    expect(supplyHandover(env, [{ productId: pen.productId, quantity: 2 }]).res.ok).toBe(true);
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'reserved', '0');
    const archived = env.admin('vppSaveProduct', {
      productId: pen.productId, productName: pen.productName, unit: pen.unit, category: pen.category, catalogStatus: 'ARCHIVED',
      minimumStock: 0, active: true,
    });
    expect(archived.error?.code).toBe('INVALID_STATE');
    expect(archived.error?.message).toMatch(/giữ chỗ/);
  });
});

describe('[RÀ SOÁT 3] VPP — gửi lại cùng mã thao tác với số / nội dung khác', () => {
  it('nhập kho / kiểm kê: số khác → REQUEST_REUSED (không âm thầm bỏ qua); đúng số → "đã ghi", không ghi 2 lần', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    const inId = crypto.randomUUID();
    expect(stockIn(env, pen.productId, 10, inId).data.duplicate).toBe(false);
    const changed = stockIn(env, pen.productId, 4, inId);
    expect(changed.error?.code).toBe('REQUEST_REUSED');
    expect(changed.error?.message).toMatch(/ĐÃ ghi \+10 Cây/);
    expect(stockIn(env, pen.productId, 10, inId).data).toMatchObject({ duplicate: true, product: { stock: { onHand: 10 } } });

    const adjustId = crypto.randomUUID();
    const adjust = (counted: number) =>
      env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: counted, reason: 'Kiểm kê cuối tháng', clientRequestId: adjustId });
    expect(adjust(45).ok).toBe(true);
    expect(adjust(54).error?.code).toBe('REQUEST_REUSED');
    expect(adjust(45).data).toMatchObject({ duplicate: true, product: { stock: { onHand: 45 } } });
  });

  it('thêm sản phẩm: lần trước đã tạo (mất phản hồi), sửa giá / ĐVT rồi bấm lại → REQUEST_REUSED, không trả sản phẩm cũ như "đã thêm"', () => {
    const env = vppEnv();
    const clientRequestId = crypto.randomUUID();
    const body = { productName: 'Bìa lá A4', unit: 'Cái', referencePrice: 2000, minimumStock: 5, clientRequestId };
    const first = env.admin('vppSaveProduct', body);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const code = first.data.product.productCode;
    for (const changed of [{ referencePrice: 2500 }, { unit: 'Xấp' }, { minimumStock: 10 }, { note: 'Loại dày' }, { productName: 'Bìa lá a4' }]) {
      const res = env.admin('vppSaveProduct', { ...body, ...changed });
      expect(res.error?.code, JSON.stringify(changed)).toBe('REQUEST_REUSED');
      expect(res.error?.message).toMatch(new RegExp(`ĐÃ tạo sản phẩm ${code} – Bìa lá A4`));
      expect(res.error?.details).toMatchObject({ existing: { productId: first.data.product.productId, code } });
    }
    // Gửi lại ĐÚNG thông tin → trả sản phẩm đã tạo; không có sản phẩm thứ hai, thông tin không bị ghi đè.
    expect(env.admin('vppSaveProduct', body).data).toMatchObject({ duplicate: true, product: { productCode: code, referencePrice: 2000, unit: 'Cái' } });
    expect(products(env).filter((p) => p.productName.toLowerCase() === 'bìa lá a4')).toHaveLength(1);
  });

  it('đề xuất: gửi lại cùng mã với nội dung khác → REQUEST_REUSED nêu mã đề xuất đã gửi; đúng nội dung → gửi trùng', () => {
    const env = vppEnv();
    const pen = env.call('vppEmployeeLookup', STAFF).data.norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const clientRequestId = crypto.randomUUID();
    const first = submitProposal(env, [{ productId: pen.productId, quantity: 6 }], { clientRequestId });
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const changed = submitProposal(env, [{ productId: pen.productId, quantity: 3 }], { clientRequestId });
    expect(changed.error?.code).toBe('REQUEST_REUSED');
    expect(changed.error?.message).toMatch(new RegExp(first.data.proposalCode));
    expect(submitProposal(env, [{ productId: pen.productId, quantity: 6 }], { clientRequestId }).data.duplicate).toBe(true);
    expect(latestProposal(env).items.map((i: any) => i.requestedQuantity)).toEqual([6]);
  });

  it('đề xuất: lần trước lỗi giữa chừng (chưa gửi xong), sửa nội dung rồi gửi lại → chỉ có nội dung MỚI, sản phẩm chờ duyệt cũ được lưu trữ', () => {
    const env = vppEnv();
    const pen = env.call('vppEmployeeLookup', STAFF).data.norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const clientRequestId = crypto.randomUUID();
    failNextAppend(env, 'VPP_DE_XUAT');
    const failed = submitProposal(env, [
      { productId: pen.productId, quantity: 9, reason: 'Nhiều' },
      { productName: 'Máy đếm tiền', unit: 'Cái', quantity: 1, reason: 'Thu ngân' },
      { productName: 'Bìa còng', unit: 'Cái', quantity: 20, reason: 'Hồ sơ' },
    ], { clientRequestId });
    expect(failed.ok).toBe(false);
    const ok = submitProposal(env, [
      { productId: pen.productId, quantity: 2 },
      { productName: 'Bút dạ quang', unit: 'Cây', quantity: 3, reason: 'Đánh dấu' },
    ], { clientRequestId });
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    const detail = latestProposal(env);
    expect(detail.items.map((i: any) => [i.displayName, i.requestedQuantity])).toEqual([
      ['Bút bi Thiên Long 027, xanh', 2],
      ['Bút dạ quang', 3],
    ]);
    const stale = products(env).filter((p) => ['Máy đếm tiền', 'Bìa còng'].includes(p.productName));
    expect(stale).toHaveLength(2);
    expect(stale.every((p) => p.catalogStatus === 'ARCHIVED')).toBe(true);
    expect(env.admin('vppDataReview').data.pendingApproval.map((p: any) => p.productName)).toEqual(['Bút dạ quang']);
  });

  it('nhận hàng: lần trước đã nhập kho 6 rồi lỗi; gửi lại số khác → báo số đã nhập, không lệch kho; gửi đúng số → hoàn tất', () => {
    const env = vppEnv();
    const pen = env.call('vppEmployeeLookup', STAFF).data.norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    expect(submitProposal(env, [{ productId: pen.productId, quantity: 8 }]).ok).toBe(true);
    const detail = latestProposal(env);
    const id = detail.proposal.proposalId;
    const itemId = detail.items[0].proposalItemId;
    expect(env.admin('vppReviewProposal', { id, decisions: [{ proposalItemId: itemId, approvedQuantity: 8 }] }).ok).toBe(true);
    failNextUpdate(env, 'VPP_DE_XUAT_CHI_TIET'); // IN đã ghi, cập nhật dòng đề xuất lỗi
    expect(env.admin('vppReceiveProposal', { id, lines: [{ proposalItemId: itemId, receivedQuantity: 6 }] }).ok).toBe(false);
    const changed = env.admin('vppReceiveProposal', { id, lines: [{ proposalItemId: itemId, receivedQuantity: 5 }] });
    expect(changed.error?.details.fieldErrors['lines.0.receivedQuantity']).toMatch(/ĐÃ nhập kho 6/);
    expect(productByName(env, pen.productName).stock.onHand).toBe(6);
    const done = env.admin('vppReceiveProposal', { id, lines: [{ proposalItemId: itemId, receivedQuantity: 6 }] });
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
    expect(done.data.items[0].receivedQuantity).toBe(6);
    expect(productByName(env, pen.productName).stock.onHand).toBe(6);
  });

  it('nhận hàng toàn số 0 → không chuyển "Đã nhập kho"; dòng duyệt 0 không nhập kho qua đề xuất', () => {
    const env = vppEnv();
    const norms = env.call('vppEmployeeLookup', STAFF).data.norms;
    const pen = norms.find((n: any) => n.productName === 'Bút bi Thiên Long 027, xanh');
    const a4 = norms.find((n: any) => n.productName === 'Giấy A4 Excel 80 gsm');
    expect(submitProposal(env, [{ productId: pen.productId, quantity: 4 }, { productId: a4.productId, quantity: 1 }]).ok).toBe(true);
    const detail = latestProposal(env);
    const id = detail.proposal.proposalId;
    const [penItem, a4Item] = detail.items;
    env.admin('vppReviewProposal', { id, decisions: [{ proposalItemId: penItem.proposalItemId, approvedQuantity: 4 }, { proposalItemId: a4Item.proposalItemId, approvedQuantity: 0 }] });
    const zero = env.admin('vppReceiveProposal', { id, lines: [{ proposalItemId: penItem.proposalItemId, receivedQuantity: 0 }] });
    expect(zero.error?.details.fieldErrors.lines).toMatch(/đều bằng 0/);
    const notApproved = env.admin('vppReceiveProposal', {
      id, lines: [{ proposalItemId: penItem.proposalItemId, receivedQuantity: 4 }, { proposalItemId: a4Item.proposalItemId, receivedQuantity: 2 }],
    });
    expect(notApproved.error?.details.fieldErrors['lines.1.receivedQuantity']).toMatch(/duyệt số lượng 0/);
    expect(env.admin('vppGetProposal', { id }).data.proposal.status).toBe('PARTIALLY_APPROVED');
  });
});

describe('[RÀ SOÁT 3] VPP — quyết định sản phẩm / GHÉP: lỗi giữa chừng không kẹt, ĐVT, định mức', () => {
  it('quyết định THÊM VÀO DANH MỤC lỗi khi ghi dòng đề xuất → làm lại được (trước đây kẹt "đã xử lý trước đó")', () => {
    const env = vppEnv();
    expect(submitProposal(env, [{ productName: 'Bút dạ quang', unit: 'Cây', quantity: 4, reason: 'Đánh dấu' }]).ok).toBe(true);
    const detail = latestProposal(env);
    const decide = () =>
      env.admin('vppProductDecision', {
        id: detail.proposal.proposalId, proposalItemId: detail.items[0].proposalItemId, decision: 'MASTER', productName: 'Bút dạ quang', unit: 'Cây',
      });
    failNextUpdate(env, 'VPP_DE_XUAT_CHI_TIET');
    expect(decide().ok).toBe(false);
    const retry = decide();
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(retry.data.items[0]).toMatchObject({ productApprovalStatus: 'APPROVED_MASTER', product: { catalogStatus: 'MASTER' } });
    expect(env.admin('vppListProposals').data.items[0].pendingProductCount).toBe(0);
  });

  it('THÊM VÀO DANH MỤC với ĐVT khác dòng đề xuất ("2 Hộp" → Cây) → bắt quy đổi, dòng đổi theo số đã quy đổi', () => {
    const env = vppEnv();
    expect(submitProposal(env, [{ productName: 'Ruột bút bi xanh', unit: 'Hộp', quantity: 2, reason: 'Hết ruột' }]).ok).toBe(true);
    const detail = latestProposal(env);
    const base = { id: detail.proposal.proposalId, proposalItemId: detail.items[0].proposalItemId, decision: 'MASTER', productName: 'Ruột bút bi xanh', unit: 'Cây' };
    expect(env.admin('vppProductDecision', base).error?.details.fieldErrors.convertedQuantity).toMatch(/Hộp → Cây/);
    const ok = env.admin('vppProductDecision', { ...base, convertedQuantity: 20, unitConverted: true });
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.data.items[0]).toMatchObject({ requestedQuantity: 20, unit: 'Cây', productApprovalStatus: 'APPROVED_MASTER' });
  });

  it('nhân viên gõ đúng tên sản phẩm danh mục nhưng ĐVT khác → dòng chờ quyết định (không thành "2 Cuộn", không mất ĐVT gõ)', () => {
    const env = vppEnv();
    const toilet = productByName(env, 'Giấy Toilet VP và Showroom');
    expect(submitProposal(env, [{ productName: 'Giấy Toilet VP và Showroom', unit: 'Thùng', quantity: 2, reason: 'Showroom' }]).ok).toBe(true);
    expect(latestProposal(env).items[0]).toMatchObject({ temporaryProductName: 'Giấy Toilet VP và Showroom', unit: 'Thùng', productApprovalStatus: 'PENDING' });
    expect(submitProposal(env, [{ productName: 'Giấy Toilet VP và Showroom', unit: 'Cuộn', quantity: 2, reason: 'Showroom' }]).ok).toBe(true);
    expect(latestProposal(env).items[0]).toMatchObject({ productId: toilet.productId, temporaryProductName: '', unit: 'Cuộn' });
  });

  it('GHÉP "Cuốn" vào sản phẩm tính theo "Cuộn": ĐVT chỉ khác dấu vẫn là KHÁC ĐVT → bắt quy đổi', () => {
    const env = vppEnv();
    const src = saveProduct(env, { productName: 'Sổ tay nhỏ', unit: 'Cuốn', catalogStatus: 'TEMP' });
    const tgt = saveProduct(env, { productName: 'Giấy cuộn máy in nhiệt', unit: 'Cuộn' });
    stockIn(env, src.productId, 5);
    stockIn(env, tgt.productId, 10);
    const merge = (extra: Record<string, unknown> = {}) => env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: tgt.productId, ...extra });
    expect(merge().error?.details.fieldErrors.quantity).toMatch(/ĐVT khác nhau \(Cuốn → Cuộn\)/);
    expect(merge({ quantity: 5 }).error?.details.fieldErrors.unitConverted).toBeTruthy();
    expect(env.rt.run('sameUnit_', 'Bó', 'Bộ')).toBe(false);
    expect(env.rt.run('sameUnit_', 'cái', 'Cái')).toBe(true);
  });

  it('GHÉP bị lỗi giữa chừng (đã chuyển tồn, ghi trạng thái nguồn lỗi) → làm lại hoàn tất, không chuyển tồn lần 2', () => {
    const env = vppEnv();
    const src = saveProduct(env, { productName: 'Giấy ướt tạm', unit: 'Bịch', catalogStatus: 'TEMP' });
    const tgt = productByName(env, 'Khăn giấy ướt');
    stockIn(env, src.productId, 3);
    stockIn(env, tgt.productId, 4);
    failNextUpdateAtColumn(env, 'VPP_SAN_PHAM', 'catalog_status');
    const merge = () => env.admin('vppMergeProduct', { sourceProductId: src.productId, targetProductId: tgt.productId });
    expect(merge().ok).toBe(false);
    const retry = merge();
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(productByName(env, 'Khăn giấy ướt').stock.onHand).toBe(7);
    expect(productByName(env, 'Giấy ướt tạm')).toMatchObject({ catalogStatus: 'ARCHIVED', mergedIntoProductId: tgt.productId });
  });

  it('GHÉP sản phẩm có định mức: định mức chuyển sang sản phẩm đích (cùng ĐVT) — nhân viên vẫn thấy; trang Định mức không tính định mức của sản phẩm đã lưu trữ', () => {
    const env = vppEnv();
    const original = productByName(env, 'Khăn giấy ướt');
    const replacement = saveProduct(env, { productName: 'Khăn giấy ướt loại mới', unit: 'Bịch' });
    const merged = env.admin('vppMergeProduct', { sourceProductId: original.productId, targetProductId: replacement.productId, quantity: 0 });
    expect(merged.ok, JSON.stringify(merged.error)).toBe(true);
    expect(merged.data.norms.moved.length).toBeGreaterThan(0);
    const staffNorms = env.call('vppEmployeeLookup', STAFF).data.norms.map((n: any) => n.productName);
    expect(staffNorms).toContain('Khăn giấy ướt loại mới');
    const norms = env.admin('vppListNorms').data.norms;
    expect(norms.filter((n: any) => n.productId === original.productId && n.effective)).toHaveLength(0);
  });
});

describe('[RÀ SOÁT 3] VPP — trạng thái đề xuất & dữ liệu sửa tay', () => {
  it('đề xuất đã duyệt mà sản phẩm duy nhất bị từ chối → đề xuất thành "Từ chối" (không còn "đã duyệt" với 0 sản phẩm)', () => {
    const env = vppEnv();
    expect(submitProposal(env, [{ productName: 'Máy hủy giấy mini', unit: 'Cái', quantity: 1, reason: 'Hủy hồ sơ' }]).ok).toBe(true);
    const detail = latestProposal(env);
    const id = detail.proposal.proposalId;
    const itemId = detail.items[0].proposalItemId;
    expect(env.admin('vppReviewProposal', { id, decisions: [{ proposalItemId: itemId, approvedQuantity: 1 }] }).data.proposal.status).toBe('APPROVED');
    const rejected = env.admin('vppProductDecision', { id, proposalItemId: itemId, decision: 'REJECT' });
    expect(rejected.ok, JSON.stringify(rejected.error)).toBe(true);
    expect(rejected.data.proposal.status).toBe('REJECTED');
    expect(env.admin('vppSetProposalStatus', { id, status: 'PURCHASED' }).error?.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('từ chối / đóng đề xuất còn sản phẩm mới chưa quyết định → sản phẩm đó không còn "chờ duyệt" mồ côi', () => {
    const env = vppEnv();
    expect(submitProposal(env, [{ productName: 'Máy đếm tiền', unit: 'Cái', quantity: 1, reason: 'Thu ngân' }]).ok).toBe(true);
    const p1 = latestProposal(env);
    expect(env.admin('vppRejectProposal', { id: p1.proposal.proposalId, reason: 'Chưa cần' }).ok).toBe(true);
    expect(submitProposal(env, [{ productName: 'Bìa còng', unit: 'Cái', quantity: 5, reason: 'Hồ sơ' }]).ok).toBe(true);
    const p2 = latestProposal(env);
    env.admin('vppReviewProposal', { id: p2.proposal.proposalId, decisions: [{ proposalItemId: p2.items[0].proposalItemId, approvedQuantity: 5 }] });
    expect(env.admin('vppSetProposalStatus', { id: p2.proposal.proposalId, status: 'CLOSED' }).ok).toBe(true);
    const review = env.admin('vppDataReview').data;
    expect(review.pendingApproval).toHaveLength(0);
    for (const p of [p1, p2]) {
      expect(env.admin('vppGetProposal', { id: p.proposal.proposalId }).data.items[0]).toMatchObject({ productApprovalStatus: 'REJECTED', approvedQuantity: 0 });
    }
  });

  it('số tồn gõ tay âm / có phần lẻ (chưa có biến động) → "chưa rõ", kiểm kê ghi đúng số thực tế (không +8 từ gốc −5)', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', '-5');
    expect(productByName(env, pen.productName).stock).toMatchObject({ onHand: null, rawInitialValue: '-5', status: 'UNKNOWN' });
    const drift = env.admin('vppDataReview').data.stockDrifts.find((d: any) => d.productId === pen.productId);
    expect(drift.sheet).toMatchObject({ onHand: null, invalidValue: '-5' });
    const counted = env.admin('vppStockAdjust', { productId: pen.productId, countedQuantity: 3, reason: 'Kiểm kê thực tế', clientRequestId: crypto.randomUUID() });
    expect(counted.ok, JSON.stringify(counted.error)).toBe(true);
    expect(counted.data.product.stock.onHand).toBe(3);
    const ledger = env.admin('vppListMovements', { productId: pen.productId }).data.items.reduce((s: number, m: any) => s + m.quantity, 0);
    expect(ledger).toBe(3);

    const a4 = productByName(env, 'Giấy A4 Excel 80 gsm');
    setCell(env, 'VPP_TON_KHO', 'product_id', a4.productId, 'on_hand', '2.5');
    expect(productByName(env, a4.productName).stock).toMatchObject({ onHand: null, status: 'UNKNOWN' }); // không hiện "0 – hết hàng"
  });

  it('số gõ tay kiểu Việt Nam trên Sheet: "55.600" = 55600, "1.000" = 1000, "1,500" (hai nghĩa) không đoán', () => {
    const env = vppEnv();
    const pen = productByName(env, 'Bút bi Thiên Long 027, xanh');
    setCell(env, 'VPP_SAN_PHAM', 'product_id', pen.productId, 'reference_price', '55.600');
    setCell(env, 'VPP_TON_KHO', 'product_id', pen.productId, 'on_hand', '1.000');
    expect(productByName(env, pen.productName)).toMatchObject({ referencePrice: 55600, stock: { onHand: 1000 } });
    const parse = (v: string) => env.rt.run('parseSheetNumber_', v);
    expect(parse('1500')).toBe(1500);
    expect(parse('12.5')).toBe(12.5);
    expect(parse('1.500.000')).toBe(1_500_000);
    expect(parse('12,5')).toBe(12.5);
    expect(parse('1.500,5')).toBe(1500.5);
    expect(parse('1,500,000')).toBe(1_500_000);
    expect(Number.isNaN(parse('1,500'))).toBe(true);
    expect(Number.isNaN(parse('abc'))).toBe(true);
    expect(parse('')).toBeNull();
    expect(env.rt.run('toIntOrNull_', '1,5')).toBeNull();
    expect(env.rt.run('roundPrice_', 12.3456)).toBe(12.35); // hệ thống không ghi đơn giá dạng "12.345" (3 chữ số lẻ)
  });

  it('phòng ban chọn "Không áp dụng định mức" không còn bị liệt kê là "chưa gắn"', () => {
    const env = vppEnv();
    expect(env.admin('vppDataReview').data.unmappedDepartments.map((d: any) => d.department)).toContain('IT');
    expect(env.admin('vppSetScopeMapping', { department: 'IT', scopeId: 'NONE' }).ok).toBe(true);
    env.rt.run('invalidateCaches_');
    expect(env.admin('vppDataReview').data.unmappedDepartments.map((d: any) => d.department)).not.toContain('IT');
  });
});

// ============================================================================
// Xuất CSV, mã nguồn Apps Script, ký tự vô hình, email tổng hợp
// ============================================================================

describe('[RÀ SOÁT 3] Xuất CSV dựng tại Apps Script (Worker không lặp từng dòng — giới hạn CPU Workers Free)', () => {
  const env = setupGas();
  const run = (name: string, ...args: unknown[]) => env.rt.run(name, ...args);

  it('chống CSV / formula injection (OWASP): ô chữ bắt đầu bằng = + - @ Tab CR (kể cả full-width, sau khoảng trắng)', () => {
    for (const payload of ['=1+2', '+SUM(A1)', "-2+3+cmd|' /C calc'!A0", '@SUM(1)', '\t=1', '\r=1', '  =1+1', '\n@x', '＝1+1', '＋1', '－1', '＠x']) {
      expect(run('csvLooksLikeFormula_', payload), JSON.stringify(payload)).toBe(true);
      expect(String(run('csvCell_', payload)).startsWith(`"'`), JSON.stringify(payload)).toBe(true);
    }
    for (const safe of ['Bút bi', 'BG-20261006-0001', 'a=b', '', '   ', 'email@example.com']) {
      expect(run('csvLooksLikeFormula_', safe), JSON.stringify(safe)).toBe(false);
    }
    expect(run('csvCell_', -3)).toBe('"-3"');
    expect(run('csvCell_', 1.5)).toBe('"1.5"');
    expect(run('csvCell_', Number.NaN)).toBe('""');
    expect(run('csvCell_', null)).toBe('""');
    expect(run('csvCell_', true)).toBe('"Có"');
    expect(run('csvCell_', 'Nói "xin chào", rồi\nxuống dòng')).toBe('"Nói ""xin chào"", rồi\nxuống dòng"');
    expect(run('toCsv_', ['Mã', 'Tên'], [['BG-1', 'Laptop, sạc'], ['BG-2', '=cmd']])).toBe('"Mã","Tên"\r\n"BG-1","Laptop, sạc"\r\n"BG-2","\'=cmd"\r\n');
  });

  it('ngày giờ: ISO có múi giờ → giờ Việt Nam; chuỗi khác (gõ tay vào Sheet) giữ nguyên, không đảo ngày / tháng', () => {
    expect(run('csvDateTime_', '2026-10-06T01:02:03Z')).toBe('2026-10-06 08:02:03');
    expect(run('csvDateTime_', '2026-10-06T23:30:00+07:00')).toBe('2026-10-06 23:30:00');
    expect(run('csvDateTime_', '2026-10-06T22:15:30.123-05:00')).toBe('2026-10-07 10:15:30');
    expect(run('csvDateTime_', '')).toBe('');
    expect(run('csvDateTime_', '06/10/2026 10:00')).toBe('06/10/2026 10:00');
    expect(run('csvDateTime_', '2026-10-06T10:00:00')).toBe('2026-10-06T10:00:00');
    expect(run('signedMovementQuantity_', 'OUT', 3)).toBe(-3);
    expect(run('signedMovementQuantity_', 'ADJUSTMENT', -4)).toBe(-4);
  });

  it('nhãn trạng thái trong CSV khớp giao diện (shared/)', () => {
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    const labels = plain(env.rt.context.EXPORT_LABELS_);
    expect(labels.catalog).toEqual(CATALOG_STATUS_LABELS);
    expect(labels.stock).toEqual(STOCK_STATUS_LABELS);
    expect(labels.movement).toEqual(MOVEMENT_TYPE_LABELS);
    expect(labels.proposal).toEqual(PROPOSAL_STATUS_LABELS);
    expect(plain(env.rt.context.STATUS_LABELS)).toEqual(STATUS_LABELS);
    expect(plain(env.rt.context.HANDOVER_TYPES)).toEqual(HANDOVER_TYPE_LABELS);
  });
});

/** Runtime Apps Script nạp từ bản sao thư mục apps-script (bỏ / thêm file) — mô phỏng dự án thiếu file hoặc còn file cũ. */
function runtimeFrom(transform: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dta-gas-'));
  for (const file of fs.readdirSync(path.join(ROOT, 'apps-script'))) {
    if (file.endsWith('.gs') || file === 'appsscript.json') fs.copyFileSync(path.join(ROOT, 'apps-script', file), path.join(dir, file));
  }
  transform(dir);
  const secret = crypto.randomBytes(32).toString('hex');
  const rt = createGasRuntime({ scriptDir: dir, properties: { BACKEND_SHARED_SECRET: secret }, quiet: true });
  const call = (action: string, payload: unknown = {}, scope = 'public') => JSON.parse(rt.doPost(signGasRequest(secret, action, payload, scope)));
  return { rt, call, dir };
}

describe('[RÀ SOÁT 3] Mã nguồn Apps Script thiếu file / còn file cũ → báo rõ, không chạy với code trộn lẫn', () => {
  it('phiên bản code thống nhất: Code.gs = Config.gs = package.json = Worker', () => {
    const env = setupGas();
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(env.rt.context.CODE_VERSION_).toBe(env.rt.context.APP.VERSION);
    expect(env.rt.context.APP.VERSION).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('thiếu Notify.gs (cài nhiều file theo README cũ) → NOT_CONFIGURED nêu rõ thiếu code, không phải lỗi INTERNAL', () => {
    const { rt, call } = runtimeFrom((dir) => fs.rmSync(path.join(dir, 'Notify.gs')));
    rt.run('setupDatabase');
    const res = call('health');
    expect(res.error?.code).toBe('NOT_CONFIGURED');
    expect(res.error?.message).toMatch(/thiếu code \(.*is not defined\)/);
    expect(rt.run('checkSetup')).toMatch(/✗ Code Apps Script/);
  });

  it('nạp file theo thứ tự bất kỳ (Apps Script nạp theo thứ tự trong editor, không theo tên) → vẫn chạy đủ', () => {
    // Trước đây VppProposals.gs dựng mảng từ PROPOSAL_STATUS (Config.gs) ngay khi nạp: nạp trước Config.gs → mọi request lỗi.
    for (const order of ['đảo ngược', 'xen kẽ'] as const) {
      const { rt, call } = runtimeFrom((dir) => {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
        const ordered = order === 'đảo ngược' ? [...files].reverse() : [...files.filter((_, i) => i % 2), ...files.filter((_, i) => !(i % 2))];
        ordered.forEach((file, i) => fs.renameSync(path.join(dir, file), path.join(dir, `${String(i).padStart(2, '0')}_${file}`)));
      });
      rt.run('setupDatabase');
      rt.run('seedOfficeSupplyNorms');
      const admin = (action: string) => call(action, { actor: { id: 'thai', name: 'Phạm Danh Thái' } }, 'admin');
      expect(call('health').ok, order).toBe(true);
      expect(admin('adminListEmployees').ok, order).toBe(true);
      expect(admin('vppListProposals').ok, order).toBe(true);
    }
  });

  it('còn file .gs cũ (v1) nạp sau bản mới → từ chối mọi thao tác ("trộn code nhiều phiên bản")', () => {
    const { call } = runtimeFrom((dir) => fs.writeFileSync(path.join(dir, 'ZZ_Config_v1.gs'), "var APP = { NAME: 'dta-handover', VERSION: '1.0.0' };\n"));
    const res = call('health');
    expect(res.error?.code).toBe('NOT_CONFIGURED');
    expect(res.error?.message).toMatch(/trộn code nhiều phiên bản \(Config 1\.0\.0, Code 2\.0\.0\)/);
  });
});

describe('[RÀ SOÁT 3] Ký tự vô hình còn lọt; email tổng hợp gửi trùng', () => {
  it('bỏ Arabic Letter Mark, soft hyphen, ký tự đệm Hangul, ký tự tag (Apps Script khớp Worker)', () => {
    const env = setupGas();
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    expect(env.rt.run('cleanLine_', `SN ${c(0x61c)}12-34`)).toBe('SN 12-34');
    expect(env.rt.run('cleanLine_', `Bút${c(0xad)} bi${c(0x34f)}`)).toBe('Bút bi');
    expect(env.rt.run('cleanLine_', `${c(0x3164)}Tên${c(0xffa0)}`)).toBe('Tên');
    expect(env.rt.run('cleanLine_', `A${c(0xdb40, 0xdc41)}B`)).toBe('AB');
  });

  it('nhiều trigger email tổng hợp (mỗi người cài một cái) → mỗi ngày chỉ gửi MỘT email', () => {
    const env = setupGas();
    setSetting(env, 'NOTIFY_EMAILS', 'admin@example.com');
    const { token } = createHandover(env);
    const view = env.call('getHandoverByToken', { tokenHash: token.hash }).data.handover;
    expect(env.call('requestRevision', { tokenHash: token.hash, contentHash: view.contentHash, reason: 'Sai serial máy' }).ok).toBe(true);
    const digests = () => env.rt.mail.filter((m: { subject: string }) => m.subject.includes('Tổng hợp ngày')).length;
    expect(env.rt.run('sendDailyDigest')).toBe('Đã gửi email tổng hợp.');
    expect(env.rt.run('sendDailyDigest')).toMatch(/đã gửi email tổng hợp \(trigger khác/i);
    expect(digests()).toBe(1);
  });

  it('nhiều trigger sao lưu tự động → mỗi tuần chỉ MỘT bản; lần sao lưu lỗi không chặn lần sau', () => {
    const env = setupGas();
    const backups = () => [...env.rt.drive.items.values()].filter((f: any) => /backup \d{4}-\d{2}-\d{2}/.test(f.name ?? '')).length;
    expect(env.rt.run('scheduledBackup')).toContain('Đã sao lưu');
    expect(env.rt.run('scheduledBackup')).toMatch(/đã sao lưu tự động \(trigger khác/i);
    expect(backups()).toBe(1);
    // Sao lưu lỗi (Drive lỗi) → xóa mốc đã nhận → trigger kế tiếp sao lưu lại được.
    env.rt.run('setProp_', 'LAST_SCHEDULED_BACKUP_AT', '');
    env.rt.faults.set('drive', 1);
    expect(() => env.rt.run('scheduledBackup')).toThrow(/Service Drive failed/);
    expect(env.rt.run('getProp_', 'LAST_SCHEDULED_BACKUP_AT')).toBe('');
    expect(env.rt.run('scheduledBackup')).toContain('Đã sao lưu');
    expect(backups()).toBe(2);
  });
});
