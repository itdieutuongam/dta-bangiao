import { describe, expect, it } from 'vitest';
import {
  contentHashOf,
  createHandover,
  newToken,
  otpFromMail,
  RECEIVER_CLIENT,
  requestOtp,
  setCell,
  setSetting,
  setupGas,
  signatureBase64,
} from './helpers';

/**
 * Email qua MailApp (giả lập — không gửi thật, thư nằm trong env.rt.mail):
 *   • mã OTP khi người nhận ký (CAU_HINH.CONFIRM_OTP = EMAIL | REQUIRED | OFF);
 *   • thông báo cho quản trị viên (CAU_HINH.NOTIFY_EMAILS), email tổng hợp, huy hiệu menu, xuất dữ liệu (exportAll).
 */

type Env = ReturnType<typeof setupGas>;

/** Ký với mã chỉ định (không tự xin mã). */
function confirmWith(env: Env, tokenHash: string, otp?: string) {
  return env.call('confirmHandover', {
    tokenHash,
    agreed: true,
    contentHash: contentHashOf(env, tokenHash),
    signatureBase64: signatureBase64(),
    comment: '',
    client: RECEIVER_CLIENT,
    ...(otp === undefined ? {} : { otp }),
  });
}

const sendOtp = (env: Env, tokenHash: string) => env.call('requestConfirmOtp', { tokenHash, client: RECEIVER_CLIENT });

function cacheJson(env: Env, key: string) {
  const raw = env.rt.cache.get(key);
  return raw ? JSON.parse(raw) : null;
}

/** Bỏ qua thời gian chờ gửi lại 60 giây (và cửa sổ 15 phút nếu cần) — thay cho việc chờ thật. */
function skipResendWait(env: Env, handoverId: string, alsoWindow = false) {
  const s = cacheJson(env, `otp-send:${handoverId}`);
  const next = { ...s, last: s.last - 61_000, ...(alsoWindow ? { w: s.w - 15 * 60_000 - 1000 } : {}) };
  env.rt.cache.put(`otp-send:${handoverId}`, JSON.stringify(next), 21600);
}

const lastHistory = (env: Env) => env.rt.sheet('LICH_SU').toObjects().at(-1);
const signatureFiles = (env: Env) => [...env.rt.drive.items.values()].filter((f: any) => String(f.name ?? '').endsWith('signature.png'));

function removeEmployeeEmail(env: Env, employeeId: string) {
  setCell(env, 'NHAN_VIEN', 'employee_id', employeeId, 'email', '');
  expect(env.admin('refreshCache').ok).toBe(true);
}

describe('Mã OTP khi người nhận ký (CAU_HINH.CONFIRM_OTP)', () => {
  it('EMAIL (mặc định): người nhận có email phải nhập mã; mã gửi đúng địa chỉ, chỉ lưu bản băm, dùng một lần', () => {
    const env = setupGas();
    const h = createHandover(env); // DEMO-519 · thai.pham@example.com
    expect(h.res.data.confirmOtp).toEqual({ required: true, blocked: false, email: 'thai.pham@example.com' });
    const shown = env.call('getHandoverByToken', { tokenHash: h.token.hash }).data.handover;
    expect(shown.otp).toEqual({ required: true, blocked: false, emailMasked: 't***@example.com' });

    // Không nhập mã → OTP_REQUIRED, không lưu chữ ký, trạng thái giữ nguyên
    const missing = confirmWith(env, h.token.hash);
    expect(missing.error).toMatchObject({ code: 'OTP_REQUIRED', details: { fieldErrors: { otp: expect.any(String) } } });
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].status).toBe('PENDING');
    expect(signatureFiles(env)).toHaveLength(0);

    const sent = sendOtp(env, h.token.hash);
    expect(sent.data).toEqual({ sent: true, emailMasked: 't***@example.com', expiresInSeconds: 600, resendAfterSeconds: 60 });
    expect(env.rt.mail).toHaveLength(1);
    expect(env.rt.mail[0].to).toBe('thai.pham@example.com');
    const otp = otpFromMail(env.rt.mail, h.code)!;
    expect(otp).toMatch(/^\d{6}$/);
    expect(env.rt.mail[0].body).toContain(otp);
    expect(env.rt.mail[0].body).not.toContain(h.token.token); // email không chứa link ký
    expect(JSON.stringify(cacheJson(env, `otp:${h.id}`))).not.toContain(otp); // chỉ lưu HMAC của mã

    // Gửi lại ngay → phải chờ 60 giây
    expect(sendOtp(env, h.token.hash).error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });

    const wrong = otp === '000000' ? '111111' : '000000';
    expect(confirmWith(env, h.token.hash, wrong).error).toMatchObject({ code: 'OTP_INVALID', message: expect.stringContaining('còn 4 lần') });
    expect(env.rt.sheet('LICH_SU').toObjects().map((l: { action: string }) => l.action)).toEqual(['CREATED']);

    const ok = confirmWith(env, h.token.hash, otp);
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0]).toMatchObject({ status: 'CONFIRMED', confirm_method: 'OTP_EMAIL' });
    expect(cacheJson(env, `otp:${h.id}`)).toBeNull(); // mã đã dùng bị hủy
    expect(lastHistory(env).message).toContain('Xác thực bằng mã OTP gửi tới t***@example.com');
    expect(JSON.parse(lastHistory(env).metadata)).toMatchObject({ confirmMethod: 'OTP_EMAIL', otpEmail: 't***@example.com' });
    expect(env.admin('adminGetHandover', { id: h.id }).data.handover.confirmMethod).toBe('OTP_EMAIL');
    expect(sendOtp(env, h.token.hash).error?.code).toBe('ALREADY_CONFIRMED');
  });

  it('nhập sai 5 lần → hủy mã; mã hết hạn sau 10 phút; mã của phiếu này không ký được phiếu khác', () => {
    const env = setupGas();
    const a = createHandover(env);
    const b = createHandover(env);
    const otpA = requestOtp(env, a.token.hash, a.code);
    expect(confirmWith(env, b.token.hash, otpA).error?.code).toBe('OTP_EXPIRED'); // B chưa gửi mã

    const wrong = otpA === '123456' ? '654321' : '123456';
    for (let left = 4; left >= 1; left--) {
      expect(confirmWith(env, a.token.hash, wrong).error?.message).toContain(`còn ${left} lần`);
    }
    expect(confirmWith(env, a.token.hash, wrong).error).toMatchObject({ code: 'OTP_LOCKED', details: { fieldErrors: { otp: expect.any(String) } } });
    expect(confirmWith(env, a.token.hash, otpA).error?.code).toBe('OTP_EXPIRED'); // mã đúng cũng hết dùng được

    skipResendWait(env, a.id);
    const fresh = requestOtp(env, a.token.hash, a.code);
    const state = cacheJson(env, `otp:${a.id}`);
    const expired = state.codes.map((c: { h: string; exp: number }) => ({ ...c, exp: Date.now() - 1000 }));
    env.rt.cache.put(`otp:${a.id}`, JSON.stringify({ ...state, codes: expired }), 600);
    expect(confirmWith(env, a.token.hash, fresh).error?.code).toBe('OTP_EXPIRED');
    expect(env.rt.sheet('BAN_GIAO').toObjects().every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    expect(signatureFiles(env)).toHaveLength(0);
  });

  it('gửi mã: tối đa 3 lần / 15 phút và 10 lần / phiếu; chỉ 2 mã gần nhất còn hiệu lực', () => {
    const env = setupGas();
    const h = createHandover(env);
    const codes: string[] = [];
    const sendAndRead = () => {
      expect(sendOtp(env, h.token.hash).ok).toBe(true);
      codes.push(otpFromMail(env.rt.mail, h.code)!);
    };
    sendAndRead();
    skipResendWait(env, h.id);
    sendAndRead();
    skipResendWait(env, h.id);
    sendAndRead();
    skipResendWait(env, h.id);
    expect(sendOtp(env, h.token.hash).error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/thử lại sau \d+ phút/) });

    while (codes.length < 10) {
      skipResendWait(env, h.id, true);
      sendAndRead();
    }
    skipResendWait(env, h.id, true);
    expect(sendOtp(env, h.token.hash).error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringContaining('liên hệ quản trị viên') });
    expect(env.rt.mail).toHaveLength(10);

    // Mã gần nhất và mã ngay trước đó (thư có thể đến chậm / lần gửi lại bị lỗi) còn dùng được; mã cũ hơn thì không.
    const recent = codes.slice(-2);
    const older = codes.slice(0, -2).find((c) => !recent.includes(c)); // mã ngẫu nhiên — xác suất trùng hết ~1e-48
    expect(older).toBeDefined();
    expect(confirmWith(env, h.token.hash, older!).error?.code).toBe('OTP_INVALID');
    expect(confirmWith(env, h.token.hash, recent[0]!).ok).toBe(true);
  });

  it('người nhận chưa có email: chế độ EMAIL vẫn ký được nhưng phiếu bị đánh dấu NO_EMAIL; email mới trong NHAN_VIEN được dùng ngay', () => {
    const env = setupGas();
    removeEmployeeEmail(env, 'DEMO-102');
    const h = createHandover(env, { receiverEmployeeId: 'DEMO-102' });
    expect(h.res.data.confirmOtp).toEqual({ required: false, blocked: false, email: '' });
    expect(env.call('getHandoverByToken', { tokenHash: h.token.hash }).data.handover.otp).toEqual({ required: false, blocked: false, emailMasked: '' });
    expect(sendOtp(env, h.token.hash).error?.code).toBe('INVALID_STATE');
    expect(confirmWith(env, h.token.hash).ok).toBe(true);
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].confirm_method).toBe('NO_EMAIL');
    expect(lastHistory(env).message).toContain('Ký không có mã OTP (người nhận chưa có email)');
    expect(env.admin('adminGetHandover', { id: h.id }).data.handover.confirmMethod).toBe('NO_EMAIL');
    expect(env.rt.mail).toHaveLength(0);

    // Nhân viên đổi email sau khi tạo phiếu → mã gửi tới email hiện tại trong NHAN_VIEN
    const d = createHandover(env, { receiverEmployeeId: 'DEMO-103' });
    setCell(env, 'NHAN_VIEN', 'employee_id', 'DEMO-103', 'email', 'duc.moi@example.com');
    env.admin('refreshCache');
    expect(env.call('getHandoverByToken', { tokenHash: d.token.hash }).data.handover.otp.emailMasked).toBe('d***@example.com');
    requestOtp(env, d.token.hash, d.code);
    expect(env.rt.mail.at(-1)!.to).toBe('duc.moi@example.com');
  });

  it('REQUIRED: người nhận chưa có email thì không ký được cho tới khi quản trị viên bổ sung email', () => {
    const env = setupGas();
    setSetting(env, 'CONFIRM_OTP', 'REQUIRED');
    removeEmployeeEmail(env, 'DEMO-102');
    const h = createHandover(env, { receiverEmployeeId: 'DEMO-102' });
    expect(h.res.data.confirmOtp).toEqual({ required: true, blocked: true, email: '' });
    expect(env.call('getHandoverByToken', { tokenHash: h.token.hash }).data.handover.otp).toEqual({ required: true, blocked: true, emailMasked: '' });
    expect(sendOtp(env, h.token.hash).error?.code).toBe('INVALID_STATE');
    expect(confirmWith(env, h.token.hash).error?.code).toBe('OTP_REQUIRED');
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].status).toBe('PENDING');

    setCell(env, 'NHAN_VIEN', 'employee_id', 'DEMO-102', 'email', 'ngoc.tran@example.com');
    env.admin('refreshCache');
    expect(env.call('getHandoverByToken', { tokenHash: h.token.hash }).data.handover.otp).toEqual({
      required: true, blocked: false, emailMasked: 'n***@example.com',
    });
    expect(confirmWith(env, h.token.hash, requestOtp(env, h.token.hash, h.code)).ok).toBe(true);
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].confirm_method).toBe('OTP_EMAIL');
  });

  it('OFF: không cần mã, không gửi email; giá trị lạ được hiểu là EMAIL', () => {
    const env = setupGas();
    setSetting(env, 'CONFIRM_OTP', 'off');
    const h = createHandover(env);
    expect(h.res.data.confirmOtp).toEqual({ required: false, blocked: false, email: '' });
    expect(sendOtp(env, h.token.hash).error?.code).toBe('INVALID_STATE');
    expect(confirmWith(env, h.token.hash).ok).toBe(true);
    expect(env.rt.sheet('BAN_GIAO').toObjects()[0].confirm_method).toBe('OTP_OFF');
    expect(env.rt.mail).toHaveLength(0);

    setSetting(env, 'CONFIRM_OTP', 'co le');
    const e = createHandover(env);
    expect(e.res.data.confirmOtp.required).toBe(true);
  });

  it('gửi mã lỗi (hết hạn mức / chưa cấp quyền) → MAIL_ERROR, quản trị viên thấy lỗi; gửi lại thành công thì hết cảnh báo', () => {
    const env = setupGas();
    const h = createHandover(env);
    env.rt.faults.set('mail', 1);
    expect(sendOtp(env, h.token.hash).error).toMatchObject({ code: 'MAIL_ERROR', details: { retryAfterSeconds: 60 } });
    expect(env.admin('adminOverview').data.notify).toMatchObject({
      otpMode: 'EMAIL', otp: { lastError: { event: 'OTP', message: expect.any(String) } }, notify: { lastError: null },
    });
    expect(env.admin('adminSystemInfo').data.notify).toMatchObject({ mailQuotaRemaining: 100, mailError: '', otp: { lastError: { event: 'OTP' } } });
    // Lần gửi lỗi không tính vào giới hạn số lần gửi (chỉ phải chờ 60 giây)
    expect(sendOtp(env, h.token.hash).error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
    expect(cacheJson(env, `otp-send:${h.id}`)).toMatchObject({ nw: 0, n: 0 });

    skipResendWait(env, h.id);
    expect(confirmWith(env, h.token.hash, requestOtp(env, h.token.hash, h.code)).ok).toBe(true);
    expect(env.admin('adminOverview').data.notify.otp).toEqual({ lastError: null, lastOkAt: expect.stringMatching(/^\d{4}-/) });
  });

  it('gửi lại mã bị lỗi → mã đã nằm trong hộp thư vẫn ký được', () => {
    const env = setupGas();
    const h = createHandover(env);
    const delivered = requestOtp(env, h.token.hash, h.code);
    skipResendWait(env, h.id);
    env.rt.faults.set('mail', 1);
    expect(sendOtp(env, h.token.hash).error?.code).toBe('MAIL_ERROR');
    expect(confirmWith(env, h.token.hash, delivered).ok).toBe(true);
  });

  it('mã gắn với email người nhận: đổi email trong NHAN_VIEN / đổi người nhận / cấp link mới → mã cũ hết hiệu lực, bộ đếm tính lại', () => {
    const env = setupGas();
    const h = createHandover(env); // DEMO-519 · thai.pham@example.com
    const oldCode = requestOtp(env, h.token.hash, h.code);
    setCell(env, 'NHAN_VIEN', 'employee_id', 'DEMO-519', 'email', 'thai.moi@example.com');
    expect(env.admin('refreshCache').ok).toBe(true);
    expect(confirmWith(env, h.token.hash, oldCode).error).toMatchObject({ code: 'OTP_EXPIRED', message: expect.stringContaining('Email nhận mã') });
    // Bộ đếm theo email: email mới gửi được ngay, không phải chờ 60 giây của lần gửi tới email cũ
    const newCode = requestOtp(env, h.token.hash, h.code);
    expect(env.rt.mail.at(-1)!.to).toBe('thai.moi@example.com');

    // Cấp link mới (link cũ có thể đã lộ) → mã đã gửi hết hiệu lực, giới hạn gửi tính lại
    const next = newToken();
    const relinked = env.admin('adminRegenerateLink', { id: h.id, tokenHash: next.hash, tokenNonce: next.nonce });
    expect(relinked.ok).toBe(true);
    expect(cacheJson(env, `otp:${h.id}`)).toBeNull();
    expect(cacheJson(env, `otp-send:${h.id}`)).toBeNull();
    expect(lastHistory(env).message).toContain('mã xác nhận đã gửi');
    expect(newCode).toMatch(/^\d{6}$/);
  });
});

describe('Email thông báo cho quản trị viên (CAU_HINH.NOTIFY_EMAILS)', () => {
  function requestRevision(env: Env, tokenHash: string, reason: string) {
    return env.call('requestRevision', { tokenHash, contentHash: contentHashOf(env, tokenHash), reason, client: RECEIVER_CLIENT });
  }

  it('chưa cấu hình → không gửi, không báo lỗi', () => {
    const env = setupGas();
    const h = createHandover(env);
    expect(requestRevision(env, h.token.hash, 'Sai số serial máy').ok).toBe(true);
    expect(env.rt.mail).toHaveLength(0);
    expect(env.admin('adminOverview').data.notify).toEqual({
      recipients: 0, otpMode: 'EMAIL', notify: { lastOkAt: '', lastError: null }, otp: { lastOkAt: '', lastError: null },
    });
  });

  it('yêu cầu chỉnh sửa → 1 email tới danh sách (lọc trùng / sai), link theo APP_URL, nội dung đã escape HTML', () => {
    const env = setupGas();
    setSetting(env, 'NOTIFY_EMAILS', 'Admin@Example.com, kho@example.com; admin@example.com khong-hop-le');
    setSetting(env, 'APP_URL', 'https://bangiao.example.org/');
    expect(env.admin('adminOverview').data.notify.recipients).toBe(2);
    const h = createHandover(env);
    expect(requestRevision(env, h.token.hash, 'Sai serial <img src=x onerror=alert(1)>').ok).toBe(true);

    expect(env.rt.mail).toHaveLength(1);
    const mail = env.rt.mail[0];
    expect(mail.to).toBe('admin@example.com, kho@example.com');
    expect(mail.subject).toBe(`[DTA] Yêu cầu chỉnh sửa biên bản ${h.code}`);
    expect(mail.body).toContain('Sai serial <img');
    expect(mail.body).toContain(`https://bangiao.example.org/admin/ban-giao/${h.id}`);
    expect(mail.body).not.toContain(h.token.token);
    expect(mail.htmlBody).toContain('&lt;img src=x');
    expect(mail.htmlBody).not.toContain('<img');
    expect(env.admin('adminOverview').data.notify).toMatchObject({
      recipients: 2, notify: { lastError: null, lastOkAt: expect.stringMatching(/^\d{4}-/) },
    });
  });

  it('gửi lỗi → yêu cầu vẫn được lưu, lỗi hiện ở Tổng quan; hạn mức thấp → tạm dừng thông báo nhưng vẫn gửi mã OTP', () => {
    const env = setupGas();
    setSetting(env, 'NOTIFY_EMAILS', 'admin@example.com');
    const a = createHandover(env);
    env.rt.faults.set('mail', 1);
    const rev = requestRevision(env, a.token.hash, 'Thiếu sạc laptop');
    expect(rev.ok).toBe(true);
    expect(rev.data.handover.status).toBe('REVISION_REQUESTED');
    expect(env.admin('adminOverview').data.notify.notify.lastError).toMatchObject({ event: 'REVISION_REQUESTED' });

    env.rt.mailState.quota = 15; // dưới mức để dành 20 cho mã OTP
    const b = createHandover(env);
    expect(requestRevision(env, b.token.hash, 'Sai tên thiết bị').ok).toBe(true);
    expect(env.rt.mail).toHaveLength(0);
    expect(env.admin('adminOverview').data.notify.notify.lastError.message).toContain('để dành cho mã xác nhận');

    const c = createHandover(env);
    expect(requestOtp(env, c.token.hash, c.code)).toMatch(/^\d{6}$/);
    expect(env.rt.mail).toHaveLength(1);
    // Mã OTP gửi được KHÔNG xóa cảnh báo email thông báo đang tạm dừng (hai loại email theo dõi riêng)
    const notify = env.admin('adminOverview').data.notify;
    expect(notify.notify.lastError.message).toContain('để dành cho mã xác nhận');
    expect(notify.otp).toEqual({ lastError: null, lastOkAt: expect.stringMatching(/^\d{4}-/) });
  });

  it('NOTIFY_STATUS bản cũ (một trạng thái chung) được tách theo loại email khi đọc', () => {
    const env = setupGas();
    env.rt.properties.NOTIFY_STATUS = JSON.stringify({
      lastOkAt: '2026-10-06T08:00:00+07:00', lastOkEvent: 'OTP',
      lastError: { at: '2026-10-06T09:00:00+07:00', event: 'DAILY_DIGEST', message: 'Quota' },
    });
    expect(env.admin('adminOverview').data.notify).toMatchObject({
      otp: { lastOkAt: '2026-10-06T08:00:00+07:00', lastError: null },
      notify: { lastOkAt: '', lastError: { event: 'DAILY_DIGEST', message: 'Quota' } },
    });
  });

  it('email tổng hợp hằng ngày: không có việc → không gửi; có việc → gửi; bật lịch nhiều lần không tạo trùng; gửi thử', () => {
    const env = setupGas();
    expect(env.rt.run('sendDailyDigest')).toMatch(/Chưa cấu hình NOTIFY_EMAILS/);
    setSetting(env, 'NOTIFY_EMAILS', 'admin@example.com');
    expect(env.rt.run('sendDailyDigest')).toMatch(/Không có việc cần xử lý/);
    const h = createHandover(env);
    expect(requestRevision(env, h.token.hash, 'Sai serial').ok).toBe(true);
    expect(env.rt.run('sendDailyDigest')).toBe('Đã gửi email tổng hợp.');
    const digest = env.rt.mail.at(-1)!;
    expect(digest.subject).toMatch(/^\[DTA\] Tổng hợp ngày \d{2}\/\d{2}\/\d{4}$/);
    expect(digest.body).toContain(`Yêu cầu chỉnh sửa chờ xử lý: 1 (${h.code})`);

    env.rt.run('installDailyDigestTrigger');
    env.rt.run('installDailyDigestTrigger');
    expect(env.rt.triggers.filter((t: { getHandlerFunction(): string }) => t.getHandlerFunction() === 'sendDailyDigest')).toHaveLength(1);
    expect(env.rt.run('sendTestNotification')).toBe('Đã gửi tới admin@example.com.');
  });
});

describe('Huy hiệu menu & xuất dữ liệu', () => {
  it('adminBadges: số yêu cầu chỉnh sửa + đề xuất chờ duyệt; chỉ scope admin', () => {
    const env = setupGas();
    const h = createHandover(env);
    createHandover(env);
    env.call('requestRevision', { tokenHash: h.token.hash, contentHash: contentHashOf(env, h.token.hash), reason: 'Sai serial' });
    expect(env.admin('adminBadges').data).toEqual({ revisionRequested: 1, submittedProposals: 0 });
    expect(env.call('adminBadges').error?.code).toBe('FORBIDDEN');
  });

  it('exportAll: trả toàn bộ dòng theo bộ lọc (không phân trang)', () => {
    const env = setupGas();
    for (let i = 0; i < 23; i++) expect(createHandover(env).res.ok).toBe(true);
    const page = env.admin('adminListHandovers', { pageSize: 5 }).data;
    expect(page).toMatchObject({ total: 23, pageSize: 5 });
    expect(page.items).toHaveLength(5);
    const all = env.admin('adminListHandovers', { pageSize: 5, page: 3, exportAll: true }).data;
    expect(all).toMatchObject({ total: 23, page: 1 });
    expect(all.items).toHaveLength(23);
    expect(env.admin('adminListHandovers', { exportAll: true, status: 'CANCELLED' }).data.items).toHaveLength(0);
    // exportAll phải đúng kiểu boolean (chuỗi "true" từ query không bật được)
    expect(env.admin('adminListHandovers', { pageSize: 5, exportAll: 'true' }).data.items).toHaveLength(5);
  });
});
