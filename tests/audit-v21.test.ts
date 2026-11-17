import { describe, expect, it } from 'vitest';
import { confirmSchema, handoverInputSchema, revisionSchema, toFieldErrors } from '../shared/schemas';
import { containsCredentialPair, containsPasswordLike } from '../shared/text';
import { confirmAs, contentHashOf, createHandover, itemInput, setupGas } from './helpers';

/**
 * Sửa lỗi theo đợt rà soát v2.1 (docs/AUDIT_V2.1.md):
 *   GAS-3 bộ lọc mật khẩu (Worker + Apps Script giống nhau) · GAS-5 mã định danh trống · GAS-6 tiêu đề cột trùng tên.
 */

// Câu ghi mật khẩu — phải bị chặn ở CẢ Worker (shared/text.ts) lẫn Apps Script (Utils.gs).
const PASSWORD_TEXTS = [
  'password: abc123',
  'Mật khẩu: 123456',
  'mat khau = x',
  'MK: Abc@1',
  'pass:1',
  'pwd=hello',
  'Mật khẩu là 12345678',
  'mật khẩu mới là Abc@2026',
  'Mật khẩu wifi：DTA@2026', // dấu hai chấm full-width
  'Password is Zz-998877',
  'MK 123456',
  'Tài khoản Zalo, mật khẩu Abc@1234',
  'mật khẩu\nQwe12345',
  'Link quản trị https://admin:S3cret@router.local/setup',
  'https://drive.example/x?pwd=abc',
];

// Câu bình thường trong biên bản — KHÔNG được chặn.
const NORMAL_TEXTS = [
  'Đã đổi mật khẩu',
  'Người nhận tự đặt lại mật khẩu',
  'Compass: hướng bắc',
  'bypass',
  'Pass lại laptop cho phòng kế toán',
  'Mật khẩu 8 ký tự, người nhận tự đổi',
  'Đã đổi mật khẩu 20/11/2026',
  'Mật khẩu Wi-Fi tầng 3 hỏi IT',
  'Máy MKT-01 đã cài phần mềm',
  'Sạc 65W, pin 4000mAh',
  'https://drive.google.com/file/d/abc/view',
];

describe('[GAS-3] Bộ lọc mật khẩu', () => {
  const env = setupGas({ seed: false });
  const gas = (fn: string, text: string) => env.rt.run(fn, text) as boolean;

  it('chặn các dạng ghi mật khẩu phổ biến — Worker và Apps Script cho cùng kết quả', () => {
    for (const text of PASSWORD_TEXTS) {
      expect(containsPasswordLike(text), `Worker: ${text}`).toBe(true);
      expect(gas('containsPasswordLike_', text), `Apps Script: ${text}`).toBe(true);
    }
  });

  it('không chặn câu thông thường', () => {
    for (const text of NORMAL_TEXTS) {
      expect(containsPasswordLike(text), `Worker: ${text}`).toBe(false);
      expect(gas('containsPasswordLike_', text), `Apps Script: ${text}`).toBe(false);
    }
  });

  it('mục Tài khoản: cặp "email / mật khẩu" bị chặn; email / số điện thoại thì không', () => {
    const pairs = ['nv.a@dieutuongam.vn / Abc@123', 'nv.a@dieutuongam.vn | 12345678', 'Email nv.a@dta.vn; Zx98765'];
    const fine = ['nv.a@dieutuongam.vn / 0901234567', 'nv.a@dta.vn, nv.b@dta.vn', 'Email công ty: nv.a@dta.vn', 'nv.a@dta.vn - IT'];
    for (const text of pairs) {
      expect(containsCredentialPair(text), `Worker: ${text}`).toBe(true);
      expect(gas('containsCredentialPair_', text), `Apps Script: ${text}`).toBe(true);
    }
    for (const text of fine) {
      expect(containsCredentialPair(text), `Worker: ${text}`).toBe(false);
      expect(gas('containsCredentialPair_', text), `Apps Script: ${text}`).toBe(false);
    }
  });

  it('Worker: chặn ở mô tả tài khoản, link tài liệu, ghi chú khi ký, lý do yêu cầu sửa', () => {
    const base = {
      handoverType: 'ACCOUNT',
      sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
      receiverEmployeeId: 'DEMO-519',
      note: '',
      supplies: [],
    };
    const errorsOf = (items: unknown[]) => {
      const parsed = handoverInputSchema.safeParse({ ...base, items });
      return parsed.success ? {} : toFieldErrors(parsed.error);
    };
    expect(errorsOf([itemInput({ category: 'TAI_KHOAN', itemName: 'Email công ty', description: 'nv.a@dta.vn / Abc@123' })])).toHaveProperty([
      'items.0.description',
    ]);
    // Cặp email / số điện thoại ở mục khác loại Tài khoản: không áp dụng quy tắc cặp.
    expect(errorsOf([itemInput({ description: 'Liên hệ nv.a@dta.vn / Abc@123' })])).not.toHaveProperty(['items.0.description']);
    expect(errorsOf([itemInput({ documentUrl: 'https://u:p4ss@files.example/doc' })])).toHaveProperty(['items.0.documentUrl']);

    const hash = 'a'.repeat(64);
    const sig = 'data:image/png;base64,AAAA';
    expect(confirmSchema.safeParse({ agreed: true, contentHash: hash, signature: sig, comment: 'MK 123456' }).success).toBe(false);
    expect(confirmSchema.safeParse({ agreed: true, contentHash: hash, signature: sig, comment: 'Đã nhận đủ' }).success).toBe(true);
    expect(revisionSchema.safeParse({ contentHash: hash, reason: 'Sai mật khẩu là Abc@2026, sửa giúp' }).success).toBe(false);
  });

  it('Apps Script: mô tả tài khoản kèm mật khẩu bị từ chối; ghi chú khi ký / lý do yêu cầu sửa có mật khẩu bị từ chối', () => {
    const app = setupGas();
    const account = createHandover(app, {
      handoverType: 'ACCOUNT',
      items: [itemInput({ category: 'TAI_KHOAN', itemName: 'Email', assetCode: '', serialNumber: '', model: '', description: 'nv.a@dta.vn / Abc@123' })],
    });
    expect(account.res.ok).toBe(false);
    expect(account.res.error?.details?.fieldErrors).toHaveProperty(['items.0.description']);

    const created = createHandover(app);
    expect(created.res.ok, JSON.stringify(created.res.error)).toBe(true);
    const signed = confirmAs(app, created.token.hash, { comment: 'Đã nhận, mật khẩu là Abc@2026' });
    expect(signed.ok).toBe(false);
    expect(signed.error?.details?.fieldErrors).toHaveProperty('comment');
    const revision = app.call('requestRevision', {
      tokenHash: created.token.hash,
      contentHash: contentHashOf(app, created.token.hash),
      reason: 'Sai, MK 99887766 mới đúng',
      client: { ipHash: 'b'.repeat(32), userAgent: 'vitest' },
    });
    expect(revision.ok).toBe(false);
    expect(revision.error?.details?.fieldErrors).toHaveProperty('reason');
    expect(confirmAs(app, created.token.hash, { comment: 'Đã nhận đủ' }).ok).toBe(true);
  });
});

describe('[SEC-4] Ký / yêu cầu sửa bằng link bịa', () => {
  it('tra link TRƯỚC khi giữ khóa; link sai bị đếm vào giới hạn dò link theo IP (30 lần → chặn cả link đúng từ IP đó)', () => {
    const env = setupGas();
    const real = createHandover(env);
    const attacker = { ipHash: 'e'.repeat(32), userAgent: 'bot' };
    const bogus = (i: number) => (i.toString(16).padStart(2, '0') + 'f'.repeat(62)).slice(0, 64);
    for (let i = 0; i < 30; i++) {
      const res = i % 2
        ? env.call('confirmHandover', { tokenHash: bogus(i), agreed: true, contentHash: 'a'.repeat(64), signatureBase64: 'AAAA', comment: '', client: attacker })
        : env.call('requestRevision', { tokenHash: bogus(i), contentHash: 'a'.repeat(64), reason: 'Sai nội dung', client: attacker });
      expect(res.error?.code, `lần ${i}`).toBe('NOT_FOUND');
    }
    const blocked = env.call('requestRevision', { tokenHash: real.token.hash, contentHash: 'a'.repeat(64), reason: 'Sai nội dung', client: attacker });
    expect(blocked.error?.code).toBe('RATE_LIMITED');
    // Người nhận thật (IP khác) không bị ảnh hưởng.
    expect(confirmAs(env, real.token.hash).ok).toBe(true);
  });
});

describe('[GAS-5] Mã định danh trống không bao giờ khớp', () => {
  it('ghi theo danh sách mã: mã trống bị bỏ qua, không ghi vào các dòng có ô mã trống', () => {
    const env = setupGas();
    const a = createHandover(env);
    const b = createHandover(env, { receiverEmployeeId: 'DEMO-102' });
    expect(a.res.ok && b.res.ok).toBe(true);
    const sheet = env.rt.sheet('CHI_TIET_BAN_GIAO');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];
    const idCol = headers.indexOf('item_id') + 1;
    const supCol = headers.indexOf('superseded_at') + 1;
    // Dòng nội dung thêm tay / cột item_id bị xóa trống: mọi dòng của phiếu A mất mã.
    const rows = sheet.toObjects() as Array<{ handover_id: string }>;
    rows.forEach((r, i) => {
      if (r.handover_id === a.id) sheet.getRange(i + 2, idCol).setValue('');
    });
    env.rt.run('resetHeaderCache_');
    expect(env.rt.run('setColumnForIds_', 'CHI_TIET_BAN_GIAO', 'superseded_at', ['', '  '], '2026-11-16T10:00:00+07:00')).toBe(0);
    const after = sheet.getRange(2, supCol, sheet.getLastRow() - 1, 1).getValues().flat();
    expect(after.every((v: unknown) => v === '')).toBe(true);
    // Phiếu A vẫn hiện đủ nội dung cho người nhận.
    const view = env.call('getHandoverByToken', { tokenHash: a.token.hash });
    expect(view.data.handover.items.length).toBeGreaterThan(0);
  });

  it('cập nhật dòng đọc lúc trước không có mã: dòng đó đã bị thay bằng dòng khác (có mã) → CONFLICT, không ghi nhầm', () => {
    const env = setupGas();
    const a = createHandover(env);
    expect(a.res.ok).toBe(true);
    const sheet = env.rt.sheet('CHI_TIET_BAN_GIAO');
    expect(() => env.rt.run('verifiedRowIndex_', 'CHI_TIET_BAN_GIAO', sheet, 2, { item_id: '' })).toThrow(/thay đổi/);
  });
});

describe('[GAS-7] Sửa dòng tiêu đề trực tiếp trên Sheet', () => {
  it('gõ đè MỘT ô tiêu đề hệ thống → tự đặt lại tên cũ; dán đè nhiều ô → Web App dừng ghi (NOT_CONFIGURED) thay vì bỏ qua cột', () => {
    const env = setupGas({ vpp: true });
    const sheet = env.rt.sheet('VPP_DINH_MUC');
    const cell = sheet.getRange(1, 1);
    expect(cell.getValue()).toBe('norm_id');
    expect(env.admin('vppListNorms', {}).data.norms.length).toBeGreaterThan(0); // nhớ "cấu trúc đủ"
    // Đúng sự cố 10/2026: "norm_id" bị gõ đè thành "m".
    cell.setValue('m');
    env.rt.run('onEdit', { range: cell, oldValue: 'norm_id', value: 'm' });
    expect(sheet.getRange(1, 1).getValue()).toBe('norm_id');
    expect(env.admin('vppListNorms', {}).data.norms.length).toBeGreaterThan(0);

    // Dán đè 2 ô (không có giá trị cũ) → không tự sửa được: báo + bỏ cache "cấu trúc đủ" → thao tác bị chặn rõ ràng.
    const two = sheet.getRange(1, 1, 1, 2);
    two.setValues([['x', 'y']]);
    env.rt.run('onEdit', { range: two });
    const blocked = env.admin('vppListNorms', {});
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('NOT_CONFIGURED');
    // Ô ngoài dòng tiêu đề: không đụng tới.
    const data = sheet.getRange(2, 3);
    const before = data.getValue();
    env.rt.run('onEdit', { range: data, oldValue: 'abc' });
    expect(sheet.getRange(2, 3).getValue()).toBe(before);
  });
});

describe('[GAS-6] Tiêu đề cột trùng tên', () => {
  it('cột tự thêm trùng tên "status": đọc / ghi cùng cột đầu — ký xong không ký lại được; Kiểm tra cấu hình báo trùng', () => {
    const env = setupGas();
    const sheet = env.rt.sheet('BAN_GIAO');
    const last = sheet.getLastColumn();
    if (last >= sheet.getMaxColumns()) sheet.insertColumnsAfter(last, 1);
    sheet.getRange(1, last + 1).setValue('status ');
    env.rt.run('resetHeaderCache_');
    const created = createHandover(env);
    expect(created.res.ok, JSON.stringify(created.res.error)).toBe(true);
    expect(confirmAs(env, created.token.hash).ok).toBe(true);
    const again = confirmAs(env, created.token.hash);
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe('ALREADY_CONFIRMED');
    const problems = env.rt.run('idColumnProblems_', env.rt.run('getSpreadsheet_')) as string[];
    expect(problems.join(' ')).toMatch(/BAN_GIAO: tiêu đề cột bị trùng tên — "status"/);
  });

  it('dòng có nhiều cột cùng tên: lấy giá trị cột ĐẦU TIÊN', () => {
    const env = setupGas({ seed: false });
    expect(env.rt.run('rowToObject_', ['a', 'b', 'a'], ['1', '2', '3'])).toEqual({ a: '1', b: '2' });
  });
});
