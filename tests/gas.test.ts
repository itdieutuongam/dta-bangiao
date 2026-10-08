import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleAppsScript } from '../scripts/build-gas-bundle.mjs';
import { createGasRuntime, signGasRequest } from '../scripts/gas-emulator/runtime.mjs';
import {
  ADMIN_ACTOR,
  confirmAs,
  contentHashOf,
  createHandover,
  createPayload,
  itemInput,
  makePng,
  newToken,
  otpFromMail,
  RECEIVER_CLIENT,
  requestOtp,
  setupGas,
  sha256,
  signatureBase64,
  todayKey,
} from './helpers';

const signature = () => makePng(400, 160).toString('base64');

function createConfirmed(env: ReturnType<typeof setupGas>) {
  const created = createHandover(env);
  expect(created.res.ok).toBe(true);
  const confirmed = confirmAs(env, created.token.hash, { comment: 'Đã nhận đủ' });
  expect(confirmed.ok).toBe(true);
  return { id: created.id, code: created.code, token: created.token };
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
    expect(env.call('khongTonTai', {}).error?.code).toBe('UNKNOWN_ACTION');
    expect(JSON.parse(env.rt.doPost('not json')).error.code).toBe('BAD_REQUEST');
  });

  it('chỉ admin tạo / sửa / hủy phiếu và xem danh bạ — scope public bị từ chối', () => {
    const env = setupGas();
    const { payload } = createPayload();
    for (const action of ['adminCreateHandover', 'adminListEmployees', 'adminListCategories', 'adminUpdateHandover', 'adminCancelHandover']) {
      expect(env.call(action, payload, 'public').error?.code, action).toBe('FORBIDDEN');
      expect(env.call(action, payload, 'system').error?.code, action).toBe('FORBIDDEN');
    }
    // Action public cũ đã bị gỡ
    expect(env.call('createHandover', payload).error?.code).toBe('UNKNOWN_ACTION');
    expect(env.call('listEmployees').error?.code).toBe('UNKNOWN_ACTION');
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('báo NOT_CONFIGURED khi chưa có BACKEND_SHARED_SECRET; doGet không lộ dữ liệu', () => {
    const env = setupGas();
    delete env.rt.properties.BACKEND_SHARED_SECRET;
    expect(env.call('health').error?.code).toBe('NOT_CONFIGURED');
    const get = JSON.parse(env.rt.doGet());
    expect(get.ok).toBe(true);
    expect(JSON.stringify(get)).not.toContain('employee');
  });

  it('cơ sở dữ liệu chưa nâng cấp v2 → mọi thao tác (trừ health) báo NOT_CONFIGURED, không ghi dữ liệu', () => {
    const env = setupGas();
    delete env.rt.properties.SCHEMA_VERSION;
    expect(env.call('health').data).toMatchObject({ database: 'error', schemaReady: false });
    const { payload } = createPayload();
    const res = env.admin('adminCreateHandover', payload);
    expect(res.error?.code).toBe('NOT_CONFIGURED');
    expect(res.error?.message).toMatch(/Nâng cấp module Văn phòng phẩm/);
    expect(env.admin('adminSystemInfo').data).toMatchObject({ schemaReady: false, requiredSchemaVersion: 2 });
  });
});

describe('Apps Script – setupDatabase / upgradeOfficeSupplyModule', () => {
  it('chạy lại nhiều lần không trùng dữ liệu, không xóa dữ liệu cũ, bổ sung cột thiếu, sao lưu trước khi đổi cấu trúc', () => {
    const env = setupGas();
    expect(createHandover(env).res.ok).toBe(true);

    // Giả lập sheet cũ thiếu cột cuối (xóa tiêu đề cột) → nâng cấp phải bổ sung.
    const sheet = env.rt.sheet('BAN_GIAO');
    const lastCol = sheet.getLastColumn();
    const lastHeader = (env.rt.context.HEADERS.BAN_GIAO as string[]).at(-1);
    expect(sheet.getRange(1, lastCol).getValue()).toBe(lastHeader);
    sheet.getRange(1, lastCol).setValue('');

    env.rt.run('setupDatabase');
    env.rt.run('setupDatabase');
    for (let i = 0; i < 10; i++) env.rt.run('upgradeOfficeSupplyModule');
    expect(env.rt.sheet('LOAI_BAN_GIAO').toObjects()).toHaveLength(8);
    // 11 khóa mặc định: 8 hiển thị / định mức + CONFIRM_OTP, NOTIFY_EMAILS, APP_URL (email)
    expect(env.rt.sheet('CAU_HINH').toObjects()).toHaveLength(11);
    expect(env.rt.sheet('CAU_HINH').toObjects().map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(['CONFIRM_OTP', 'NOTIFY_EMAILS', 'APP_URL']),
    );
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(1);
    const headers = env.rt.sheet('BAN_GIAO').getRange(1, 1, 1, env.rt.sheet('BAN_GIAO').getLastColumn()).getValues()[0];
    expect(headers).toContain(lastHeader);
    expect(headers.filter((h: string) => h === lastHeader)).toHaveLength(1);
    // Đúng 1 bản sao lưu: chỉ khi có thay đổi cấu trúc trên dữ liệu thật
    const backups = [...env.rt.drive.items.values()].filter((f: any) => /backup trước nâng cấp/.test(f.name ?? ''));
    expect(backups).toHaveLength(1);
    expect(env.call('health').data).toMatchObject({ database: 'ok', drive: 'ok', schemaReady: true });
  });

  it('[REVIEW] đúng SCHEMA_VERSION nhưng sheet thiếu cột code mới cần → chặn thao tác, báo rõ; chạy setupDatabase là dùng lại được', () => {
    const env = setupGas();
    const sheet = env.rt.sheet('BAN_GIAO');
    // Như sheet đã nâng cấp v2 trước khi có các cột của rà soát 3 (phiên bản nội dung, niêm phong) — xóa tiêu đề 4 cột cuối.
    const added = ['items_revision', 'edit_pending', 'record_hash', 'record_seal'];
    const lastCol = sheet.getLastColumn();
    expect(sheet.getRange(1, lastCol - 3, 1, 4).getValues()[0]).toEqual(added);
    sheet.getRange(1, lastCol - 3, 1, 4).setValues([['', '', '', '']]);
    env.rt.cache.map.clear(); // bỏ kết quả kiểm tra cấu trúc đã nhớ
    const blocked = createHandover(env);
    expect(blocked.res.error?.code).toBe('NOT_CONFIGURED');
    expect(blocked.res.error?.message).toMatch(/BAN_GIAO: thêm cột items_revision, edit_pending, record_hash, record_seal/);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0); // không ghi gì
    env.rt.run('setupDatabase');
    const created = createHandover(env);
    expect(created.res.ok).toBe(true);
    expect(confirmAs(env, created.token.hash).ok).toBe(true);
    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    expect(row.confirm_method).toBe('OTP_EMAIL');
    expect(row.items_revision).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.record_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[HỒI QUY] phiếu tạo từ v1 (trước nâng cấp): vẫn mở link, ký xác nhận, tạo PDF; phiếu v1 đã ký → toàn vẹn LEGACY', () => {
    const env = setupGas();
    const pending = createHandover(env);
    const signed = createHandover(env);
    expect(pending.res.ok && signed.res.ok).toBe(true);
    expect(confirmAs(env, signed.token.hash).ok).toBe(true);

    // Xóa các cột chỉ có từ v2 → dữ liệu giống hệt dòng do bản v1 ghi.
    const blank = (sheetName: string, idColumn: string, id: string, columns: string[]) => {
      const sheet = env.rt.sheet(sheetName);
      const lastCol = sheet.getLastColumn();
      const values = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
      const headers = values[0] as string[];
      values.forEach((row: unknown[], r: number) => {
        if (r === 0 || row[headers.indexOf(idColumn)] !== id) return;
        for (const col of columns) sheet.getRange(r + 1, headers.indexOf(col) + 1).setValue('');
      });
    };
    for (const h of [pending, signed]) {
      blank('BAN_GIAO', 'handover_id', h.id, ['handover_type', 'created_user_agent', 'client_request_id', 'vpp_scope_id', 'created_by', 'confirm_method']);
      blank('CHI_TIET_BAN_GIAO', 'handover_id', h.id, ['unit', 'product_id', 'affects_inventory', 'over_norm_reason', 'superseded_at']);
    }
    blank('BAN_GIAO', 'handover_id', signed.id, ['content_hash', 'signature_sha256']);

    // Phiếu v1 chưa ký: link cũ vẫn mở được, loại phiếu suy ra từ loại nội dung, ký được bằng mã nội dung hiện tại.
    const view = env.call('getHandoverByToken', { tokenHash: pending.token.hash });
    expect(view.ok).toBe(true);
    expect(view.data.handover).toMatchObject({ code: pending.code, status: 'PENDING', handoverType: 'ASSET' });
    expect(confirmAs(env, pending.token.hash).ok).toBe(true);
    const pendingDetail = env.admin('adminGetHandover', { id: pending.id }).data.handover;
    expect(pendingDetail).toMatchObject({ status: 'CONFIRMED', handoverType: 'ASSET' });
    expect(pendingDetail.integrity.status).toBe('OK');
    expect(env.call('generatePdf', { id: pending.id }, 'system').ok).toBe(true);

    // Phiếu v1 đã ký (không có mã toàn vẹn): xem được, đánh dấu LEGACY, vẫn tạo PDF, không ký lại được.
    const legacy = env.admin('adminGetHandover', { id: signed.id }).data.handover;
    expect(legacy.integrity.status).toBe('LEGACY');
    expect(env.call('generatePdf', { id: signed.id }, 'system').ok).toBe(true);
    expect(confirmAs(env, signed.token.hash).error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.admin('adminListHandovers', {}).data.total).toBe(2);
  });
});

describe('Apps Script – nhân viên & loại bàn giao (chỉ admin)', () => {
  it('danh sách nhân viên ACTIVE, không trả số điện thoại / trạng thái', () => {
    const env = setupGas();
    const res = env.admin('adminListEmployees');
    expect(res.ok).toBe(true);
    const ids = res.data.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).toContain('DEMO-519');
    expect(ids).not.toContain('DEMO-107'); // INACTIVE
    expect(Object.keys(res.data.employees[0]).sort()).toEqual(['department', 'email', 'employeeId', 'fullName', 'position']);
    const all = env.admin('adminListEmployees', { includeInactive: true }).data.employees;
    expect(all.find((e: { employeeId: string }) => e.employeeId === 'DEMO-107')).toMatchObject({ status: 'INACTIVE' });
  });

  it('cache nhân viên được làm mới qua refreshCache / onEdit; xóa được dữ liệu mẫu', () => {
    const env = setupGas();
    expect(env.admin('adminListEmployees').data.employees).toHaveLength(7);
    const sheet = env.rt.sheet('NHAN_VIEN');
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, 7).setNumberFormat('@').setValues([['0519', 'Ngô Bảo Châu', 'R&D', 'Kỹ sư', 'chau@example.com', '0901234567', '']]);
    expect(env.admin('adminListEmployees').data.employees).toHaveLength(7); // còn cache
    env.rt.run('onEdit', { range: { getSheet: () => ({ getName: () => 'NHAN_VIEN' }) } });
    const fresh = env.admin('adminListEmployees').data.employees;
    expect(fresh).toHaveLength(8);
    expect(fresh.find((e: { fullName: string }) => e.fullName === 'Ngô Bảo Châu').employeeId).toBe('0519');

    env.rt.run('removeSampleEmployees');
    expect(env.admin('refreshCache').data.employees).toBe(1);
    expect(env.rt.sheet('NHAN_VIEN').toObjects().map((r: any) => r.employee_id)).toEqual(['0519']);
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
    env.admin('refreshCache');
    expect(env.admin('adminListEmployees').data.employees).toHaveLength(1500);
    expect(env.rt.cache.get('employees:v1:n')).not.toBeNull();
    expect(Number(env.rt.cache.get('employees:v1:n'))).toBeGreaterThan(1);
    expect(env.admin('adminListEmployees').data.employees).toHaveLength(1500); // đọc từ cache
  });

  it('loại bàn giao đọc từ sheet LOAI_BAN_GIAO, có loại phiếu (handover_type), cấu hình trường linh hoạt', () => {
    const env = setupGas();
    const sheet = env.rt.sheet('LOAI_BAN_GIAO');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([['XE', 'Phương tiện', 'item_name*:Tên xe|asset_code*:Biển số|note:Ghi chú', '', '9', 'ACTIVE']]);
    env.admin('refreshCache');
    const categories = env.admin('adminListCategories').data.categories;
    const xe = categories.find((c: { code: string }) => c.code === 'XE');
    expect(xe.fields).toEqual([
      { key: 'itemName', label: 'Tên xe', required: true },
      { key: 'assetCode', label: 'Biển số', required: true },
      { key: 'note', label: 'Ghi chú', required: false },
    ]);
    expect(xe.handoverType).toBe('OTHER'); // chưa khai báo → Khác
    expect(categories.find((c: { code: string }) => c.code === 'THE').handoverType).toBe('ASSET');
    expect(categories.find((c: { code: string }) => c.code === 'VAN_PHONG_PHAM').handoverType).toBe('OFFICE_SUPPLY');
  });
});

describe('Apps Script – tạo biên bản (admin)', () => {
  it('tạo biên bản 1 nội dung: mã BG-YYYYMMDD-0001, ghi BAN_GIAO + CHI_TIET + LICH_SU (kèm người lập), chỉ lưu hash token', () => {
    const env = setupGas();
    const { res, token } = createHandover(env, { handoverType: 'ASSET' });
    expect(res.ok).toBe(true);
    expect(res.data.code).toBe(`BG-${todayKey()}-0001`);
    expect(res.data).toMatchObject({ handoverType: 'ASSET', receiver: { employeeId: 'DEMO-519', name: 'Phạm Danh Thái', department: 'KHTH' } });

    const [row] = env.rt.sheet('BAN_GIAO').toObjects();
    expect(row.public_token_hash).toBe(token.hash);
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toContain(token.token);
    expect(row).toMatchObject({ status: 'PENDING', handover_type: 'ASSET', created_by: 'Phạm Danh Thái (thai)', created_user_agent: 'vitest' });
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    expect(env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()).toHaveLength(1);
    expect(env.rt.sheet('LICH_SU').toObjects()[0]).toMatchObject({ action: 'CREATED', new_status: 'PENDING', actor: 'Phạm Danh Thái (thai)' });
  });

  it('tạo biên bản nhiều nội dung (loại "Khác" cho phép nhiều loại), giữ thứ tự, mã tăng dần không trùng', () => {
    const env = setupGas();
    const items = [
      itemInput(),
      itemInput({ itemName: 'Adapter Dell 65W', assetCode: '', serialNumber: '' }),
      itemInput({ category: 'THE', itemName: 'Thẻ thang máy', assetCode: 'TM-09', serialNumber: 'BỎ QUA' }),
      itemInput({ category: 'TAI_KHOAN', itemName: 'Email công ty', assetCode: 'thai.pham', quantity: null }),
      itemInput({ category: 'CONG_VIEC', itemName: 'Website', workStatus: 'Đang làm', deadline: '2026-10-15', documentUrl: 'https://example.com/a' }),
      itemInput({ category: 'KHAC', itemName: '', description: 'Chìa khóa tủ hồ sơ số 3' }),
    ];
    expect(createHandover(env, { items }).res.ok).toBe(true);
    expect(createHandover(env).res.data.code).toBe(`BG-${todayKey()}-0002`);

    const third = createHandover(env, { items });
    const view = env.call('getHandoverByToken', { tokenHash: third.token.hash }).data.handover;
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
    expect(view.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('loại phiếu giới hạn loại nội dung; văn phòng phẩm không nhập tay; loại đã tắt không dùng được cho phiếu mới', () => {
    const env = setupGas();
    const wrongType = createHandover(env, { handoverType: 'ACCOUNT', items: [itemInput()] });
    expect(wrongType.res.error?.details.fieldErrors['items.0.category']).toMatch(/không thuộc phiếu Tài khoản/);
    const manualVpp = createHandover(env, { items: [itemInput({ category: 'VAN_PHONG_PHAM', itemName: 'Bút', unit: 'Cây' })] });
    expect(manualVpp.res.error?.details.fieldErrors['items.0.category']).toMatch(/phiếu "Văn phòng phẩm"/);

    // Tắt loại THE trong Sheet → không tạo phiếu mới với loại này
    const sheet = env.rt.sheet('LOAI_BAN_GIAO');
    const rows = sheet.toObjects();
    const theRow = rows.findIndex((r: { code: string }) => r.code === 'THE') + 2;
    const statusCol = Object.keys(rows[0]).indexOf('status') + 1;
    sheet.getRange(theRow, statusCol).setValue('INACTIVE');
    env.admin('refreshCache');
    const inactive = createHandover(env, { items: [itemInput({ category: 'THE', itemName: 'Thẻ ra vào' })] });
    expect(inactive.res.error?.details.fieldErrors['items.0.category']).toMatch(/đã ngừng sử dụng/);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('gửi lại cùng clientRequestId (bấm 2 lần / mạng chập chờn) → không tạo phiếu thứ hai', () => {
    const env = setupGas();
    const clientRequestId = crypto.randomUUID();
    const first = createHandover(env, { clientRequestId });
    const second = createHandover(env, { clientRequestId });
    expect(second.res.ok).toBe(true);
    expect(second.res.data).toMatchObject({ duplicate: true, code: first.code, tokenHash: first.token.hash, tokenNonce: first.token.nonce });
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(1);
  });

  it('mã không trùng kể cả khi property đếm bị xóa', () => {
    const env = setupGas();
    createHandover(env);
    delete env.rt.properties.HANDOVER_SEQ;
    expect(createHandover(env).res.data.code).toBe(`BG-${todayKey()}-0002`);
  });

  it('người nhận không tồn tại / ngừng hoạt động / trùng người giao → lỗi', () => {
    const env = setupGas();
    const missing = createHandover(env, { receiverEmployeeId: 'KHONG-CO' }).res;
    expect(missing.error).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
    expect(missing.error?.details.fieldErrors.receiverEmployeeId).toBeTruthy();
    expect(createHandover(env, { receiverEmployeeId: 'DEMO-107' }).res.error?.code).toBe('EMPLOYEE_NOT_FOUND');
    const same = createHandover(env, { sender: { name: 'X', employeeId: 'DEMO-519' } }).res;
    expect(same.error?.details.fieldErrors.receiverEmployeeId).toMatch(/khác người bàn giao/);
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('form thiếu trường / dữ liệu sai → VALIDATION_ERROR kèm fieldErrors', () => {
    const env = setupGas();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ sender: { name: '', employeeId: '' } }, 'sender.name'],
      [{ items: [] }, 'items'],
      [{ handoverType: 'XYZ' }, 'handoverType'],
      [{ items: [itemInput({ category: 'KHONG_CO' })] }, 'items.0.category'],
      [{ items: [itemInput({ category: 'THE', itemName: '' })] }, 'items.0.itemName'],
      [{ items: [itemInput({ category: 'KHAC', itemName: '', description: '' })] }, 'items.0.description'],
      [{ items: [itemInput({ quantity: 0 })] }, 'items.0.quantity'],
      [{ items: [itemInput({ category: 'CONG_VIEC', deadline: '2026-02-30' })] }, 'items.0.deadline'],
      [{ items: [itemInput({ category: 'CONG_VIEC', documentUrl: 'javascript:alert(1)' })] }, 'items.0.documentUrl'],
      [{ items: [itemInput({ category: 'TAI_KHOAN', note: 'Mật khẩu: Abc@123' })] }, 'items.0.note'],
      [{ note: 'password = 123456' }, 'note'],
      [{ note: 'x'.repeat(2001) }, 'note'],
      [{ supplies: [{ productId: crypto.randomUUID(), quantity: 1 }] }, 'supplies'],
    ];
    for (const [override, field] of cases) {
      const res = createHandover(env, override).res;
      expect(res.error?.code, field).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.error?.details.fieldErrors), field).toContain(field);
    }
    expect(env.rt.sheet('BAN_GIAO').toObjects()).toHaveLength(0);
  });

  it('chống formula injection, giữ nguyên số 0 đầu, loại ký tự định hướng chữ (bidi) / vô hình', () => {
    const env = setupGas();
    const created = createHandover(env, {
      note: '=IMPORTXML("http://evil","//a")',
      items: [itemInput({ assetCode: '00123', serialNumber: '+84901', itemName: '@SUM(1)', model: 'A‮gpj.exe​' })],
    });
    const raw = env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects()[0];
    expect(raw.asset_code).toBe('00123');
    expect(typeof raw.item_name).toBe('string');
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toContain('__formula');
    const view = env.call('getHandoverByToken', { tokenHash: created.token.hash }).data.handover;
    expect(view.note).toBe('=IMPORTXML("http://evil","//a")');
    expect(view.items[0]).toMatchObject({ assetCode: '00123', serialNumber: '+84901', itemName: '@SUM(1)', model: 'Agpj.exe' });
  });
});

describe('Apps Script – link xác nhận', () => {
  it('token hợp lệ → dữ liệu công khai (không lộ hash/nonce/IP); token sai → NOT_FOUND; dò nhiều lần → RATE_LIMITED', () => {
    const env = setupGas();
    const { payload, token } = createPayload();
    env.admin('adminCreateHandover', payload);
    const ok = env.call('getHandoverByToken', { tokenHash: token.hash });
    expect(ok.ok).toBe(true);
    const text = JSON.stringify(ok.data);
    expect(text).not.toContain(token.hash);
    expect(text).not.toContain(payload.tokenNonce);
    expect(text).not.toContain('ipHash');
    expect(text).not.toContain('overNormReason');
    expect(ok.data.categories.length).toBeGreaterThan(0);

    const ipHash = 'c'.repeat(32);
    for (let i = 0; i < 30; i++) {
      expect(env.call('getHandoverByToken', { tokenHash: sha256(`sai-${i}`), client: { ipHash } }).error?.code).toBe('NOT_FOUND');
    }
    expect(env.call('getHandoverByToken', { tokenHash: token.hash, client: { ipHash } }).error?.code).toBe('RATE_LIMITED');
    expect(env.call('getPdfByToken', { tokenHash: token.hash, client: { ipHash } }).error?.code).toBe('RATE_LIMITED');
  });
});

describe('Apps Script – xác nhận & chữ ký', () => {
  it('xác nhận lưu chữ ký vào Drive signatures/YYYY/MM, lưu mã toàn vẹn, chặn xác nhận lần 2', () => {
    const env = setupGas();
    const created = createHandover(env);
    const hash = contentHashOf(env, created.token.hash);

    expect(env.call('confirmHandover', { tokenHash: created.token.hash, agreed: false, contentHash: hash, signatureBase64: signature() }).error?.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      env.call('confirmHandover', { tokenHash: created.token.hash, agreed: true, contentHash: hash, signatureBase64: 'aGVsbG8=' }).error?.details
        .fieldErrors.signature,
    ).toBeTruthy();

    const sig = signature();
    const res = env.call('confirmHandover', {
      tokenHash: created.token.hash,
      agreed: true,
      contentHash: hash,
      signatureBase64: sig,
      comment: '',
      otp: requestOtp(env, created.token.hash, created.code),
      client: { ipHash: 'd'.repeat(32), userAgent: 'Mozilla/5.0 (Android)' },
    });
    expect(res.ok).toBe(true);
    expect(res.data.id).toBe(created.id);
    expect(res.data.handover.status).toBe('CONFIRMED');
    expect(res.data.handover.otp).toEqual({ required: false, blocked: false, emailMasked: '' }); // đã ký → không còn cần mã

    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    expect(row).toMatchObject({
      status: 'CONFIRMED', confirmed_ip_hash: 'd'.repeat(32), user_agent: 'Mozilla/5.0 (Android)', content_hash: hash, confirm_method: 'OTP_EMAIL',
    });
    expect(row.signature_sha256).toBe(crypto.createHash('sha256').update(Buffer.from(sig, 'base64')).digest('hex'));
    expect(row.signature_file_id).toBeTruthy();
    const file = env.rt.drive.getFileById(row.signature_file_id);
    const [y, m] = [row.confirmed_at.slice(0, 4), row.confirmed_at.slice(5, 7)];
    expect(env.rt.drive.pathOf(file)).toBe(`DTA_HANDOVER/signatures/${y}/${m}/${created.code}-signature.png`);
    expect(file.bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(JSON.stringify(env.rt.sheet('BAN_GIAO').toObjects())).not.toMatch(/iVBORw0KGgo/); // không lưu base64 vào Sheet

    const again = env.call('confirmHandover', { tokenHash: created.token.hash, agreed: true, contentHash: hash, signatureBase64: signature() });
    expect(again.error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.call('requestRevision', { tokenHash: created.token.hash, contentHash: hash, reason: 'Sửa lại giúp' }).error?.code).toBe('ALREADY_CONFIRMED');
    expect(env.rt.sheet('LICH_SU').toObjects().map((l: { action: string }) => l.action)).toEqual(['CREATED', 'CONFIRMED']);
    const detail = env.admin('adminGetHandover', { id: created.id }).data.handover;
    expect(detail.integrity).toMatchObject({ status: 'OK', contentHash: hash });
  });

  it('[BUG-01] admin sửa nội dung trong lúc người nhận đang mở trang → ký bản cũ bị chặn (CONFLICT), ký bản mới được', () => {
    const env = setupGas();
    const created = createHandover(env);
    const seen = contentHashOf(env, created.token.hash); // người nhận mở link
    const candidate = newToken();
    const update = env.admin('adminUpdateHandover', {
      id: created.id,
      handoverType: 'OTHER',
      sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
      receiverEmployeeId: 'DEMO-519',
      note: 'Đã sửa',
      items: [itemInput({ condition: 'Hư hỏng nặng' }), itemInput({ itemName: 'Máy chiếu Epson' })],
      candidateTokenHash: candidate.hash,
      candidateTokenNonce: candidate.nonce,
    });
    expect(update.data.linkRotated).toBe(false); // cùng người nhận → link giữ nguyên

    const stale = env.call('confirmHandover', { tokenHash: created.token.hash, agreed: true, contentHash: seen, signatureBase64: signature() });
    expect(stale.error).toMatchObject({ code: 'CONFLICT', details: { contentChanged: true } });
    const staleRevision = env.call('requestRevision', { tokenHash: created.token.hash, contentHash: seen, reason: 'Thiếu sạc laptop' });
    expect(staleRevision.error?.code).toBe('CONFLICT');
    expect(env.call('confirmHandover', { tokenHash: created.token.hash, agreed: true, signatureBase64: signature() }).error?.code).toBe('CONFLICT');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].status).toBe('PENDING');
    expect([...env.rt.drive.items.values()].filter((f: any) => String(f.name ?? '').endsWith('signature.png'))).toHaveLength(0);

    const fresh = confirmAs(env, created.token.hash);
    expect(fresh.ok).toBe(true);
    expect(fresh.data.handover.items.map((i: { itemName: string }) => i.itemName)).toEqual(['Laptop Dell Latitude 5440', 'Máy chiếu Epson']);
  });

  it('[BUG-03] sheet BAN_GIAO bị sắp xếp đúng lúc đang lưu chữ ký → vẫn ghi đúng biên bản, không làm hỏng dòng khác', () => {
    const env = setupGas();
    const first = createHandover(env); // dòng 2
    const second = createHandover(env, { receiverEmployeeId: 'DEMO-102' }); // dòng 3
    const hash = contentHashOf(env, first.token.hash);
    const utils = env.rt.context.Utilities;
    const original = utils.newBlob.bind(utils);
    utils.newBlob = (data: unknown, type: string, name: string) => {
      if (String(name).endsWith('-signature.png')) {
        const sheet = env.rt.sheet('BAN_GIAO');
        const width = sheet.getLastColumn();
        const rows = sheet.getRange(2, 1, 2, width).getValues();
        sheet.getRange(2, 1, 2, width).setValues([rows[1], rows[0]]); // "người dùng" đảo thứ tự dòng
      }
      return original(data, type, name);
    };
    const otp = requestOtp(env, first.token.hash, first.code);
    const res = env.call('confirmHandover', { tokenHash: first.token.hash, agreed: true, contentHash: hash, signatureBase64: signature(), otp });
    utils.newBlob = original;
    expect(res.ok).toBe(true);
    const rows = env.rt.sheet('BAN_GIAO').toObjects();
    const byCode = Object.fromEntries(rows.map((r: any) => [r.handover_code, r]));
    expect(byCode[first.code]).toMatchObject({ status: 'CONFIRMED', public_token_hash: first.token.hash });
    expect(byCode[second.code]).toMatchObject({ status: 'PENDING', public_token_hash: second.token.hash, signature_file_id: '' });
    expect(env.call('getHandoverByToken', { tokenHash: second.token.hash }).data.handover).toMatchObject({ code: second.code, status: 'PENDING' });
  });

  it('Drive lỗi khi lưu chữ ký → DRIVE_ERROR, trạng thái giữ nguyên, thử lại thành công', () => {
    const env = setupGas();
    const created = createHandover(env);
    env.rt.faults.set('drive', 1);
    const fail = confirmAs(env, created.token.hash);
    expect(fail.error?.code).toBe('DRIVE_ERROR');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].status).toBe('PENDING');
    expect(confirmAs(env, created.token.hash).ok).toBe(true);
  });

  it('Google Sheet lỗi → trả lỗi có cấu trúc, không crash', () => {
    const env = setupGas();
    env.rt.faults.set('sheets', 1);
    const res = env.admin('adminListCategories');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INTERNAL');
    expect(env.admin('adminListCategories').ok).toBe(true);
  });

  it('[BUG-02] người nhận ký trên cùng thiết bị + mạng với lúc tạo phiếu → admin thấy cảnh báo', () => {
    const env = setupGas();
    const created = createHandover(env, { client: { ipHash: 'e'.repeat(32), userAgent: 'Chrome admin' } });
    expect(confirmAs(env, created.token.hash, { client: { ipHash: 'e'.repeat(32), userAgent: 'Chrome admin' } }).ok).toBe(true);
    const detail = env.admin('adminGetHandover', { id: created.id }).data.handover;
    expect(detail.confirmedFromCreatorDevice).toBe(true);
    expect(detail.history.at(-1).message).toMatch(/cùng thiết bị/);
    const other = createHandover(env, { client: { ipHash: 'e'.repeat(32), userAgent: 'Chrome admin' } });
    confirmAs(env, other.token.hash, { client: { ipHash: 'f'.repeat(32), userAgent: 'Safari iPhone' } });
    expect(env.admin('adminGetHandover', { id: other.id }).data.handover.confirmedFromCreatorDevice).toBe(false);
  });
});

describe('Apps Script – yêu cầu chỉnh sửa & admin', () => {
  it('revision → sửa (không xóa dòng cũ, đánh dấu superseded) → link cũ dùng lại để xác nhận; đổi người nhận → cấp link mới', () => {
    const env = setupGas();
    const created = createHandover(env);
    const id = created.id;
    const hash = contentHashOf(env, created.token.hash);

    expect(env.call('requestRevision', { tokenHash: created.token.hash, contentHash: hash, reason: 'abc' }).error?.code).toBe('VALIDATION_ERROR');
    const rev = env.call('requestRevision', { tokenHash: created.token.hash, contentHash: hash, reason: 'Laptop có vết xước ở góc trái màn hình.' });
    expect(rev.data.handover).toMatchObject({ status: 'REVISION_REQUESTED', receiverComment: 'Laptop có vết xước ở góc trái màn hình.' });
    expect(confirmAs(env, created.token.hash).error?.code).toBe('INVALID_STATE');

    const candidate = newToken();
    const updated = env.admin('adminUpdateHandover', {
      id,
      handoverType: 'OTHER',
      sender: { name: 'Nguyễn Văn An', employeeId: 'DEMO-101' },
      receiverEmployeeId: 'DEMO-519',
      note: 'Đã ghi nhận vết xước',
      items: [itemInput({ condition: 'Trầy xước góc trái' }), itemInput({ itemName: 'Chuột Logitech' })],
      candidateTokenHash: candidate.hash,
      candidateTokenNonce: candidate.nonce,
    });
    expect(updated.ok).toBe(true);
    expect(updated.data.linkRotated).toBe(false);
    expect(updated.data.handover.status).toBe('PENDING');
    expect(updated.data.handover.items).toHaveLength(2);
    const itemRows = env.rt.sheet('CHI_TIET_BAN_GIAO').toObjects();
    expect(itemRows).toHaveLength(3); // bản cũ vẫn còn (không xóa dòng)…
    expect(itemRows.filter((r: any) => r.superseded_at)).toHaveLength(1); // …nhưng đã đánh dấu thay thế
    const log = env.rt.sheet('LICH_SU').toObjects().find((l: { action: string }) => l.action === 'UPDATED');
    expect(JSON.parse(log.metadata).previousItems).toHaveLength(1);
    expect(log.actor).toBe('Phạm Danh Thái (thai)');

    expect(confirmAs(env, created.token.hash).ok).toBe(true);
    expect(
      env.admin('adminUpdateHandover', { ...createPayload().payload, id, candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce }).error
        ?.code,
    ).toBe('INVALID_STATE');

    // Đổi người nhận → link mới, link cũ hết hiệu lực.
    const second = createHandover(env);
    const rotated = env.admin('adminUpdateHandover', {
      ...second.payload,
      id: second.id,
      receiverEmployeeId: 'DEMO-102',
      candidateTokenHash: candidate.hash,
      candidateTokenNonce: candidate.nonce,
    });
    expect(rotated.data.linkRotated).toBe(true);
    expect(rotated.data.handover.tokenHash).toBe(candidate.hash);
    expect(env.call('getHandoverByToken', { tokenHash: second.token.hash }).error?.code).toBe('NOT_FOUND');
    expect(env.call('getHandoverByToken', { tokenHash: candidate.hash }).data.handover.receiver.name).toBe('Trần Thị Bích Ngọc');
    // Không đổi được loại phiếu khi sửa
    const typeChange = env.admin('adminUpdateHandover', { ...second.payload, id: second.id, handoverType: 'ACCOUNT', candidateTokenHash: candidate.hash, candidateTokenNonce: candidate.nonce });
    expect(typeChange.error?.code).toBe('INVALID_STATE');
  });

  it('hủy biên bản: chỉ khi chưa xác nhận; biên bản đã hủy không xác nhận được', () => {
    const env = setupGas();
    const created = createHandover(env);
    const cancelled = env.admin('adminCancelHandover', { id: created.id, reason: 'Tạo nhầm' });
    expect(cancelled.data.handover).toMatchObject({ status: 'CANCELLED', cancelReason: 'Tạo nhầm' });
    expect(env.admin('adminCancelHandover', { id: created.id }).error?.code).toBe('INVALID_STATE');
    expect(confirmAs(env, created.token.hash).error?.code).toBe('INVALID_STATE');
    const confirmed = createConfirmed(env);
    expect(env.admin('adminCancelHandover', { id: confirmed.id }).error?.code).toBe('INVALID_STATE');
  });

  it('tạo link mới: link cũ hết hiệu lực; trang người nhận mở bằng link mới vẫn ký được (nội dung không đổi)', () => {
    const env = setupGas();
    const created = createHandover(env);
    const hashBefore = contentHashOf(env, created.token.hash);
    const next = newToken();
    expect(env.admin('adminRegenerateLink', { id: created.id, tokenHash: next.hash, tokenNonce: next.nonce }).ok).toBe(true);
    expect(env.call('getHandoverByToken', { tokenHash: created.token.hash }).error?.code).toBe('NOT_FOUND');
    expect(contentHashOf(env, next.hash)).toBe(hashBefore);
    expect(confirmAs(env, next.hash).ok).toBe(true);
  });

  it('danh sách admin: thống kê, lọc theo trạng thái / mã / tên không dấu / phòng ban / loại / loại phiếu / ngày, phân trang', () => {
    const env = setupGas();
    createConfirmed(env);
    createHandover(env, { handoverType: 'ASSET', receiverEmployeeId: 'DEMO-102', items: [itemInput({ category: 'THE', itemName: 'Thẻ ra vào' })] });
    const third = createHandover(env, { receiverEmployeeId: 'DEMO-103' });
    env.call('requestRevision', { tokenHash: third.token.hash, contentHash: contentHashOf(env, third.token.hash), reason: 'Thiếu sạc laptop' });

    const all = env.admin('adminListHandovers').data;
    expect(all.stats).toEqual({ total: 3, PENDING: 1, CONFIRMED: 1, REVISION_REQUESTED: 1, CANCELLED: 0 });
    expect(all.items[0].code > all.items[2].code).toBe(true); // mới nhất trước
    expect(all.departments).toEqual(expect.arrayContaining(['KHTH', 'Kế toán', 'Kinh doanh']));

    const q = (filters: Record<string, unknown>) => env.admin('adminListHandovers', filters).data;
    expect(q({ status: 'CONFIRMED' }).items.map((i: { receiverName: string }) => i.receiverName)).toEqual(['Phạm Danh Thái']);
    expect(q({ receiver: 'pham danh thai' }).total).toBe(1);
    expect(q({ employeeName: 'NGUYEN VAN AN' }).total).toBe(3);
    expect(q({ employeeId: 'demo-102' }).total).toBe(1);
    expect(q({ department: 'ke toan' }).total).toBe(1);
    expect(q({ category: 'THE' }).total).toBe(1);
    expect(q({ handoverType: 'ASSET' }).total).toBe(1);
    expect(q({ code: `BG-${todayKey()}-0002` }).total).toBe(1);
    const today = `${todayKey().slice(0, 4)}-${todayKey().slice(4, 6)}-${todayKey().slice(6)}`;
    expect(q({ from: today, to: today }).total).toBe(3);
    expect(q({ to: '2000-01-01' }).total).toBe(0);
    const page2 = q({ page: 2, pageSize: 5 });
    expect(page2).toMatchObject({ page: 2, pageSize: 5, total: 3 });
    expect(page2.items).toHaveLength(0);
    expect(all.items[0]).toMatchObject({ itemCount: expect.any(Number), categories: expect.any(Array), handoverType: expect.any(String) });

    const overview = env.admin('adminOverview').data;
    expect(overview.stats.total).toBe(3);
    expect(overview.revisionRequested.map((r: { code: string }) => r.code)).toEqual([third.code]);
  });

  it('chi tiết admin: đầy đủ lịch sử, hash + nonce để Worker dựng link', () => {
    const env = setupGas();
    const { id } = createConfirmed(env);
    const detail = env.admin('adminGetHandover', { id }).data.handover;
    expect(detail).toMatchObject({ id, status: 'CONFIRMED', signatureAvailable: true, confirmedUserAgent: 'Mozilla/5.0 (iPhone)' });
    expect(detail.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.tokenNonce).toBeTruthy();
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['CREATED', 'CONFIRMED']);
    expect(env.admin('adminGetHandover', { id: crypto.randomUUID() }).error?.code).toBe('NOT_FOUND');
    const sig = env.admin('adminGetSignature', { id }).data;
    expect(sig.mimeType).toBe('image/png');
    expect(Buffer.from(sig.base64, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('[BUG-07] ID file trong Sheet bị sửa trỏ tới file ngoài hệ thống / sai định dạng → không trả về', () => {
    const env = setupGas();
    const { id } = createConfirmed(env);
    const outside = env.rt.drive.getRootFolder().createFile(env.rt.context.Utilities.newBlob('<script>alert(1)</script>', 'text/html', 'evil.html'));
    const sheet = env.rt.sheet('BAN_GIAO');
    const col = Object.keys(sheet.toObjects()[0]).indexOf('signature_file_id') + 1;
    sheet.getRange(2, col).setValue(outside.getId());
    expect(env.admin('adminGetSignature', { id }).error?.code).toBe('DRIVE_ERROR');
    // File nằm trong thư mục hệ thống nhưng sai định dạng cũng bị từ chối
    const pdfFolder = env.rt.drive.getFolderById(env.rt.properties.DRIVE_FOLDER_ID);
    const inside = pdfFolder.createFile(env.rt.context.Utilities.newBlob('<html></html>', 'text/html', 'x.html'));
    sheet.getRange(2, col).setValue(inside.getId());
    expect(env.admin('adminGetSignature', { id }).error?.code).toBe('DRIVE_ERROR');
  });
});

describe('Apps Script – PDF', () => {
  it('sinh PDF vào Drive pdf/YYYY/MM, nội dung đủ thông tin + mã toàn vẹn, không tạo trùng, tạo lại giữ bản cũ trong pdf-archive', () => {
    const env = setupGas();
    const { id, code, token } = createConfirmed(env);
    expect(env.call('generatePdf', { id }, 'system').ok).toBe(true);
    const html = env.rt.lastPdfHtml;
    const row = env.rt.sheet('BAN_GIAO').toObjects()[0];
    for (const text of [code, 'Phạm Danh Thái', 'DEMO-519', 'KHTH', 'Laptop Dell Latitude 5440', 'Nguyễn Văn An', 'data:image/png;base64,', 'DIỆU TƯỚNG AM', 'Mã toàn vẹn nội dung', row.content_hash]) {
      expect(html).toContain(text);
    }
    const pdfFile = env.rt.drive.getFileById(row.pdf_file_id);
    expect(env.rt.drive.pathOf(pdfFile)).toMatch(new RegExp(`^DTA_HANDOVER/pdf/\\d{4}/\\d{2}/${code}\\.pdf$`));

    const download = env.admin('adminGetPdf', { id }).data;
    expect(download.fileName).toBe(`${code}.pdf`);
    expect(Buffer.from(download.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].pdf_file_id).toBe(row.pdf_file_id); // không tạo trùng

    expect(env.call('getPdfByToken', { tokenHash: token.hash }).data.fileName).toBe(`${code}.pdf`);
    expect(env.admin('adminGeneratePdf', { id, force: true }).ok).toBe(true);
    const newId = env.rt.sheet('BAN_GIAO').toObjects()[0].pdf_file_id;
    expect(newId).not.toBe(row.pdf_file_id);
    const old = env.rt.drive.getFileById(row.pdf_file_id);
    expect(old.isTrashed()).toBe(false);
    expect(env.rt.drive.pathOf(old)).toMatch(/^DTA_HANDOVER\/pdf-archive\/\d{4}\/\d{2}\//);
  });

  it('[BUG-04] dữ liệu biên bản đã ký bị sửa trực tiếp trên Sheet → admin thấy MISMATCH, không tạo PDF từ dữ liệu sai', () => {
    const env = setupGas();
    const { id } = createConfirmed(env);
    const sheet = env.rt.sheet('CHI_TIET_BAN_GIAO');
    const col = Object.keys(sheet.toObjects()[0]).indexOf('condition') + 1;
    sheet.getRange(2, col).setValue('Hư hỏng'); // sửa tay sau khi đã ký
    expect(env.admin('adminGetHandover', { id }).data.handover.integrity.status).toBe('MISMATCH');
    expect(env.admin('adminGeneratePdf', { id, force: true }).error?.code).toBe('INTEGRITY_ERROR');
  });

  it('chưa xác nhận thì không tải được PDF', () => {
    const env = setupGas();
    const created = createHandover(env);
    expect(env.call('getPdfByToken', { tokenHash: created.token.hash }).error?.code).toBe('INVALID_STATE');
    expect(env.admin('adminGetPdf', { id: created.id }).error?.code).toBe('INVALID_STATE');
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

  it('Khóa sheet hệ thống: chỉ chủ sở hữu script sửa được BAN_GIAO / CHI_TIET / LICH_SU / kho', () => {
    const env = setupGas();
    expect(env.rt.run('protectSystemSheets')).toMatch(/Đã khóa 7 sheet/);
    const protection = env.rt.sheet('BAN_GIAO').getProtections()[0];
    expect(protection.getEditors().map((e: any) => e.getEmail())).toEqual(['owner@example.com']);
    expect(protection.canDomainEdit()).toBe(false);
    expect(env.rt.sheet('NHAN_VIEN').getProtections()).toHaveLength(0);
    env.rt.run('protectSystemSheets'); // chạy lại không tạo thêm protection
    expect(env.rt.sheet('BAN_GIAO').getProtections()).toHaveLength(1);
  });
});

describe('Apps Script – bản gộp 1 file (npm run gas:bundle)', () => {
  it('dán 1 file duy nhất vẫn chạy đúng: setupDatabase, tạo, ký xác nhận, PDF, VPP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dta-gas-bundle-'));
    try {
      fs.writeFileSync(path.join(dir, 'Mã.gs'), bundleAppsScript(), 'utf8');
      expect(fs.readdirSync(dir)).toEqual(['Mã.gs']);
      const secret = crypto.randomBytes(32).toString('hex');
      const rt = createGasRuntime({ scriptDir: dir, properties: { BACKEND_SHARED_SECRET: secret }, quiet: true });
      expect(rt.run('setupDatabase')).toContain('BACKEND_SHARED_SECRET: đã cấu hình');
      rt.run('seedSampleEmployees');
      expect(rt.run('seedOfficeSupplyNorms')).toMatch(/tạo 24 sản phẩm, 30 định mức/);
      const call = (action: string, payload: unknown = {}, scope = 'public') =>
        JSON.parse(rt.doPost(signGasRequest(secret, action, payload, scope)));
      expect(call('health').data).toMatchObject({ database: 'ok', drive: 'ok' });
      const { payload, token } = createPayload();
      const created = call('adminCreateHandover', { ...payload, actor: ADMIN_ACTOR }, 'admin');
      expect(created.data.code).toBe(`BG-${todayKey()}-0001`);
      const shown = call('getHandoverByToken', { tokenHash: token.hash }).data.handover;
      expect(shown.otp).toEqual({ required: true, blocked: false, emailMasked: 't***@example.com' });
      expect(call('requestConfirmOtp', { tokenHash: token.hash, client: RECEIVER_CLIENT }).ok).toBe(true);
      const otp = otpFromMail(rt.mail, created.data.code);
      const confirmed = call('confirmHandover', {
        tokenHash: token.hash, agreed: true, contentHash: shown.contentHash, signatureBase64: signatureBase64(), otp,
      });
      expect(confirmed.data.handover.status).toBe('CONFIRMED');
      expect(call('generatePdf', { id: created.data.id }, 'system').ok).toBe(true);
      expect(call('vppDashboard', {}, 'admin').ok).toBe(true);
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
