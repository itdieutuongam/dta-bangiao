/**
 * Notify.gs — email qua MailApp:
 *   • Mã OTP khi người nhận ký (chống "người cầm link ký thay"): mã 6 số gửi tới email người nhận, lưu dạng băm trong
 *     CacheService, hết hạn sau 10 phút, sai tối đa 5 lần, gửi lại tối đa 3 lần / 15 phút. Chế độ: CAU_HINH.CONFIRM_OTP.
 *   • Thông báo cho quản trị viên (CAU_HINH.NOTIFY_EMAILS): người nhận yêu cầu chỉnh sửa, đề xuất mua mới, phiếu VPP đã ký
 *     nhưng chưa xuất kho được (cần đối soát), email tổng hợp hằng ngày.
 *
 * Gửi mail là tác vụ phụ: lỗi gửi (hết hạn mức, địa chỉ sai…) KHÔNG làm hỏng thao tác chính đã ghi xong, nhưng luôn được
 * ghi log + lưu vào Script Property NOTIFY_STATUS và hiện trên trang quản trị (không im lặng).
 * Riêng mã OTP: gửi lỗi → báo lỗi cho người nhận (MAIL_ERROR) vì không có mã thì không ký được.
 *
 * Lần đầu dùng MailApp, chủ sở hữu script phải cấp quyền "Gửi email thay bạn" (chạy một hàm bất kỳ từ menu / editor).
 * Hạn mức: ~100 người nhận/ngày (Gmail thường), ~1.500 (Google Workspace).
 */

var EMAIL_PATTERN_ = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]+$/;

function isEmail_(value) {
  var text = String(value || '').trim();
  return text.length <= 200 && EMAIL_PATTERN_.test(text);
}

/** "duc.le@example.com" → "d***@example.com" (không lộ địa chỉ đầy đủ cho người cầm link). */
function maskEmail_(email) {
  var text = String(email || '');
  var at = text.indexOf('@');
  if (at < 1) return '';
  return text.charAt(0) + '***' + text.slice(at);
}

function appUrl_() {
  var url = String(getSettings_().APP_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/.test(url) ? url : '';
}

/**
 * Gửi một email. Trả { ok: true } hoặc { ok: false, message } — người gọi bắt buộc xử lý kết quả
 * (OTP: báo lỗi cho người dùng; thông báo: ghi NOTIFY_STATUS để hiện trên trang quản trị).
 * reserve > 0 (email thông báo): không gửi khi hạn mức còn lại trong ngày sẽ xuống dưới reserve — để dành cho mã OTP.
 */
function sendMail_(to, subject, textBody, htmlBody, reserve) {
  try {
    if (reserve > 0) {
      var quota = MailApp.getRemainingDailyQuota();
      var count = String(to).split(',').length;
      if (quota - count < reserve) {
        return {
          ok: false,
          message: 'Hạn mức gửi email hôm nay chỉ còn ' + quota + ' — tạm dừng email thông báo để dành cho mã xác nhận (OTP).'
        };
      }
    }
    MailApp.sendEmail({ to: to, subject: subject, body: textBody, htmlBody: htmlBody, name: APP.MAIL_SENDER_NAME });
    return { ok: true };
  } catch (e) {
    logError_('mail.send_failed', e);
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}

function mailHtml_(title, lines, link, linkLabel) {
  var body = lines.map(function (l) { return '<p style="margin:0 0 8px">' + escapeHtml_(l) + '</p>'; }).join('');
  var button = link
    ? '<p style="margin:16px 0"><a href="' + escapeHtml_(link) + '" style="background:#7a4a1e;color:#fff;padding:10px 16px;' +
      'border-radius:8px;text-decoration:none;font-weight:bold">' + escapeHtml_(linkLabel || 'Mở trang quản trị') + '</a></p>'
    : '';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#292524;line-height:1.5">' +
    '<h2 style="font-size:16px;color:#5b3714;margin:0 0 12px">' + escapeHtml_(title) + '</h2>' + body + button +
    '<p style="margin:16px 0 0;font-size:12px;color:#78716c">Email tự động từ Hệ thống bàn giao nội bộ – Diệu Tướng Am.</p></div>';
}

// ============================================================================
// Mã OTP khi ký xác nhận
// ============================================================================

function otpMode_() {
  var mode = String(getSettings_().CONFIRM_OTP || 'EMAIL').trim().toUpperCase();
  return mode === 'OFF' || mode === 'REQUIRED' ? mode : 'EMAIL';
}

/** Email nhận mã: email hiện tại trong NHAN_VIEN (nếu nhân viên đổi email), không có thì email chụp trên phiếu. */
function receiverEmailFor_(rec) {
  var employee = rec.receiver_employee_id ? findEmployeeById_(rec.receiver_employee_id) : null;
  var email = employee && isEmail_(employee.email) ? employee.email : rec.receiver_email;
  return isEmail_(email) ? String(email).trim() : '';
}

/**
 * Chính sách OTP cho một phiếu:
 *   required — phải nhập mã khi ký; blocked — bắt buộc nhưng người nhận chưa có email (không ký được);
 *   method — giá trị ghi vào BAN_GIAO.confirm_method khi ký; emailMasked — hiển thị cho người nhận.
 */
function otpPolicy_(rec) {
  var mode = otpMode_();
  if (mode === 'OFF') return { mode: mode, required: false, blocked: false, email: '', emailMasked: '', method: CONFIRM_METHODS.OTP_OFF };
  var email = receiverEmailFor_(rec);
  if (email) return { mode: mode, required: true, blocked: false, email: email, emailMasked: maskEmail_(email), method: CONFIRM_METHODS.OTP_EMAIL };
  return { mode: mode, required: mode === 'REQUIRED', blocked: mode === 'REQUIRED', email: '', emailMasked: '', method: CONFIRM_METHODS.NO_EMAIL };
}

/** Phần công khai của chính sách (không có email đầy đủ). */
function publicOtpInfo_(rec) {
  if (rec.status !== STATUS.PENDING) return { required: false, blocked: false, emailMasked: '' };
  var p = otpPolicy_(rec);
  return { required: p.required, blocked: p.blocked, emailMasked: p.emailMasked };
}

/** Mã 6 số ngẫu nhiên (SHA-256 của 2 UUID ngẫu nhiên — Apps Script không có crypto.getRandomValues). */
function generateOtpCode_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Utilities.getUuid());
  var n = (((bytes[0] & 0xff) << 24) | ((bytes[1] & 0xff) << 16) | ((bytes[2] & 0xff) << 8) | (bytes[3] & 0xff)) >>> 0;
  return ('000000' + (n % 1000000)).slice(-6);
}

/** Dấu vân tay của email nhận mã (cache không lưu email): đổi người nhận / email → mã và bộ đếm cũ không còn dùng được. */
function otpEmailKey_(email) {
  return sha256Hex_('otp-email:' + String(email || '').trim().toLowerCase()).slice(0, 32);
}

/** Băm mã gắn với phiếu + email nhận mã + khóa bí mật → bản lưu trong cache không dùng lại được cho phiếu / email khác. */
function otpHash_(handoverId, email, code) {
  return hmacHex_('confirm-otp:v2:' + handoverId + ':' + String(email || '').trim().toLowerCase() + ':' + code, getSharedSecret_());
}

/** Mã còn hiệu lực trong state (tối đa OTP_KEEP_CODES mã gần nhất, bỏ mã hết hạn). */
function liveOtpCodes_(state, nowMs) {
  return (state && Array.isArray(state.codes) ? state.codes : []).filter(function (c) {
    return c && c.h && Number(c.exp) > nowMs;
  });
}

function putOtpState_(cache, handoverId, state, nowMs) {
  var codes = liveOtpCodes_(state, nowMs);
  if (!codes.length) {
    cache.remove(otpCacheKey_(handoverId));
    return;
  }
  var maxExp = Math.max.apply(null, codes.map(function (c) { return Number(c.exp); }));
  cache.put(otpCacheKey_(handoverId), JSON.stringify({ codes: codes, tries: state.tries || 0, e: state.e }),
    Math.max(1, Math.ceil((maxExp - nowMs) / 1000)));
}

function otpCacheKey_(handoverId) {
  return 'otp:' + handoverId;
}

function otpSendKey_(handoverId) {
  return 'otp-send:' + handoverId;
}

function readCacheJson_(key) {
  var raw = CacheService.getScriptCache().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    logError_('otp.cache_corrupt', e);
    return null;
  }
}

/** POST /api/handover/:token/otp — gửi mã OTP tới email người nhận (scope public). */
function apiRequestConfirmOtp_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  var client = sanitizeClient_(data.client);
  if (isLookupBlocked_(client.ipHash)) {
    throw appError_('RATE_LIMITED', 'Bạn đã mở quá nhiều link không hợp lệ. Vui lòng thử lại sau ít phút.');
  }
  var found = findHandoverByTokenHash_(tokenHash);
  if (!found) {
    registerLookupMiss_(client.ipHash);
    throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
  }
  var rec = found.record;
  assertPending_(rec);
  var policy = otpPolicy_(rec);
  if (policy.blocked) {
    throw appError_('INVALID_STATE', 'Người nhận chưa có email trong hệ thống nên không gửi được mã xác nhận. Vui lòng liên hệ quản trị viên.');
  }
  if (!policy.required) throw appError_('INVALID_STATE', 'Biên bản này không cần mã xác nhận.');

  var emailKey = otpEmailKey_(policy.email);
  var sendKey = otpSendKey_(rec.handover_id);
  var reserved = withScriptLock_(function () {
    var nowMs = Date.now();
    var cache = CacheService.getScriptCache();
    // Bộ đếm gửi: last = lần GỬI THỬ gần nhất; w / nw = đầu cửa sổ 15 phút và số lần trong cửa sổ; n = tổng số lần;
    // e = email nhận mã — đổi người nhận / email thì giới hạn tính lại từ đầu.
    var s = readCacheJson_(sendKey) || {};
    if (s.e !== emailKey) s = {};
    var last = Number(s.last) || 0;
    var windowOpen = nowMs - (Number(s.w) || 0) < APP.OTP_SEND_WINDOW_SECONDS * 1000;
    var windowStart = windowOpen ? Number(s.w) : nowMs;
    var inWindow = windowOpen ? Number(s.nw) || 0 : 0;
    var total = Number(s.n) || 0;
    var waitSeconds = Math.ceil((last + APP.OTP_RESEND_SECONDS * 1000 - nowMs) / 1000);
    if (waitSeconds > 0) {
      throw appError_('RATE_LIMITED', 'Vui lòng chờ ' + waitSeconds + ' giây rồi gửi lại mã.', { retryAfterSeconds: waitSeconds });
    }
    if (total >= APP.OTP_MAX_SENDS_TOTAL) {
      throw appError_('RATE_LIMITED', 'Đã gửi mã quá nhiều lần cho biên bản này. Vui lòng liên hệ quản trị viên để được cấp link mới.');
    }
    if (inWindow >= APP.OTP_MAX_SENDS) {
      var waitMinutes = Math.max(1, Math.ceil((windowStart + APP.OTP_SEND_WINDOW_SECONDS * 1000 - nowMs) / 60000));
      throw appError_('RATE_LIMITED', 'Đã gửi mã ' + APP.OTP_MAX_SENDS + ' lần. Vui lòng thử lại sau ' + waitMinutes + ' phút.', {
        retryAfterSeconds: waitMinutes * 60
      });
    }
    var otp = generateOtpCode_();
    // Mã mới được thêm vào danh sách, mã đã gửi trước đó vẫn dùng được tới khi hết hạn: lần gửi lại bị lỗi không làm mất
    // mã người nhận đã có trong hộp thư (mã mới chưa ai biết thì vô hại).
    var state = readCacheJson_(otpCacheKey_(rec.handover_id)) || {};
    var codes = state.e === emailKey ? liveOtpCodes_(state, nowMs) : [];
    codes.push({ h: otpHash_(rec.handover_id, policy.email, otp), exp: nowMs + APP.OTP_TTL_SECONDS * 1000 });
    putOtpState_(cache, rec.handover_id, {
      codes: codes.slice(-APP.OTP_KEEP_CODES), tries: state.e === emailKey ? state.tries || 0 : 0, e: emailKey
    }, nowMs);
    var previous = { last: last, w: Number(s.w) || 0, nw: Number(s.nw) || 0, n: total, e: emailKey };
    cache.put(sendKey, JSON.stringify({ last: nowMs, w: windowStart, nw: inWindow + 1, n: total + 1, e: emailKey }),
      APP.OTP_SEND_STATE_SECONDS);
    return { otp: otp, previous: previous, attemptAt: nowMs };
  });

  var code = reserved.otp;
  var minutes = Math.round(APP.OTP_TTL_SECONDS / 60);
  var subject = 'Mã xác nhận biên bản ' + rec.handover_code + ': ' + code;
  var lines = [
    'Chào ' + rec.receiver_name + ',',
    'Mã xác nhận để ký biên bản bàn giao ' + rec.handover_code + ' (người giao: ' + rec.sender_name + ') là: ' + code,
    'Mã có hiệu lực ' + minutes + ' phút. Không chia sẻ mã này cho người khác — kể cả người bàn giao.',
    'Nếu bạn không yêu cầu mã, hãy bỏ qua email này và báo cho bộ phận IT.'
  ];
  var sent = sendMail_(policy.email, subject, lines.join('\n'), mailHtml_('Mã xác nhận: ' + code, lines, '', ''), 0);
  recordNotifyResult_('OTP', sent);
  if (!sent.ok) {
    // Gửi lỗi không tính vào giới hạn số lần gửi (chỉ giữ thời gian chờ 60 giây để không gửi dồn dập). Không cần khóa:
    // thời gian chờ đó bảo đảm không có lần gửi nào khác của phiếu này chạy song song.
    var previous = reserved.previous;
    previous.last = reserved.attemptAt;
    CacheService.getScriptCache().put(sendKey, JSON.stringify(previous), APP.OTP_SEND_STATE_SECONDS);
    throw appError_('MAIL_ERROR', 'Không gửi được email mã xác nhận. Vui lòng thử lại sau ít phút hoặc liên hệ quản trị viên.' +
      ' Mã đã nhận trước đó (nếu có) vẫn dùng được.', { retryAfterSeconds: APP.OTP_RESEND_SECONDS });
  }
  logInfo_('otp.sent', { code: rec.handover_code });
  return {
    sent: true,
    emailMasked: policy.emailMasked,
    expiresInSeconds: APP.OTP_TTL_SECONDS,
    resendAfterSeconds: APP.OTP_RESEND_SECONDS
  };
}

/**
 * Kiểm tra mã khi ký (gọi trong khóa, TRƯỚC khi ghi). Sai → tăng số lần sai; quá giới hạn → hủy mã.
 * Đúng → giữ nguyên mã: chỉ hủy (consumeConfirmOtp_) sau khi đã ghi chữ ký thành công, để lỗi ghi Sheet/Drive tạm thời
 * không bắt người nhận chờ mã mới.
 */
function verifyConfirmOtp_(handoverId, email, code) {
  requireLock_('verifyConfirmOtp_');
  var text = String(code || '').trim();
  if (!/^\d{6}$/.test(text)) {
    // Trang đang mở có thể chưa hiện ô nhập mã (chính sách đổi sau khi mở trang) → thông báo nói rõ cách nhận mã.
    throw appError_('OTP_REQUIRED', 'Biên bản này cần mã xác nhận gửi tới email người nhận. Bấm "Gửi mã xác nhận" rồi nhập mã gồm 6 chữ số.', {
      fieldErrors: { otp: 'Nhập mã xác nhận gồm 6 chữ số' }
    });
  }
  var cache = CacheService.getScriptCache();
  var key = otpCacheKey_(handoverId);
  var state = readCacheJson_(key);
  var nowMs = Date.now();
  var codes = liveOtpCodes_(state, nowMs);
  if (!codes.length) {
    throw appError_('OTP_EXPIRED', 'Mã xác nhận đã hết hạn hoặc chưa được gửi. Bấm "Gửi mã" để nhận mã mới.', {
      fieldErrors: { otp: 'Mã đã hết hạn — gửi lại mã mới' }
    });
  }
  if (state.e !== otpEmailKey_(email)) {
    // Mã đã gửi tới email cũ (quản trị viên đổi người nhận / email trong NHAN_VIEN) → không còn hiệu lực.
    cache.remove(key);
    throw appError_('OTP_EXPIRED', 'Email nhận mã của biên bản đã thay đổi — mã cũ không còn hiệu lực. Bấm "Gửi mã" để nhận mã mới.', {
      fieldErrors: { otp: 'Mã cũ không còn hiệu lực — gửi lại mã mới' }
    });
  }
  var expected = otpHash_(handoverId, email, text);
  var matched = codes.some(function (c) { return timingSafeEqual_(c.h, expected); });
  if (!matched) {
    var tries = (state.tries || 0) + 1;
    var left = APP.OTP_MAX_ATTEMPTS - tries;
    if (left <= 0) {
      cache.remove(key);
      throw appError_('OTP_LOCKED', 'Nhập sai mã quá ' + APP.OTP_MAX_ATTEMPTS + ' lần. Vui lòng gửi lại mã mới.', {
        fieldErrors: { otp: 'Nhập sai quá nhiều lần — gửi lại mã mới' }
      });
    }
    putOtpState_(cache, handoverId, { codes: codes, tries: tries, e: state.e }, nowMs);
    throw appError_('OTP_INVALID', 'Mã xác nhận không đúng (còn ' + left + ' lần thử).', {
      fieldErrors: { otp: 'Mã không đúng — còn ' + left + ' lần thử' }
    });
  }
}

/** Mã chỉ dùng một lần: hủy ngay sau khi biên bản đã ghi trạng thái CONFIRMED. */
function consumeConfirmOtp_(handoverId) {
  requireLock_('consumeConfirmOtp_');
  clearConfirmOtp_(handoverId);
}

/**
 * Hủy mã đã gửi + bộ đếm gửi của một phiếu: khi ký xong, khi quản trị viên sửa / hủy phiếu hoặc cấp link mới
 * (cấp link mới cũng là cách "mở khóa" khi người cầm link cũ đã gửi mã hết số lần cho phép).
 */
function clearConfirmOtp_(handoverId) {
  var cache = CacheService.getScriptCache();
  cache.remove(otpCacheKey_(handoverId));
  cache.remove(otpSendKey_(handoverId));
}

// ============================================================================
// Thông báo cho quản trị viên
// ============================================================================

function notifyRecipients_() {
  var seen = {};
  return String(getSettings_().NOTIFY_EMAILS || '')
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) {
      if (!isEmail_(s) || seen[s]) return false;
      seen[s] = true;
      return true;
    })
    .slice(0, 20);
}

/** Loại email: mã OTP gửi người nhận / thông báo cho quản trị viên — trạng thái lưu riêng từng loại. */
function notifyChannel_(event) {
  return event === 'OTP' ? 'otp' : 'notify';
}

/**
 * NOTIFY_STATUS = { otp: { lastOkAt, lastError }, notify: { lastOkAt, lastError } }.
 * Bản cũ (một trạng thái chung { lastOkAt, lastOkEvent, lastError }) được tách theo loại email khi đọc.
 */
function readNotifyStatus_() {
  var raw = getProp_(PROP.NOTIFY_STATUS);
  var status = {};
  if (raw) {
    try {
      status = JSON.parse(raw) || {};
    } catch (e) {
      logError_('notify.status_corrupt', e); // ghi đè bằng trạng thái mới ở lần gửi tiếp theo
      status = {};
    }
  }
  var out = { otp: status.otp || {}, notify: status.notify || {} };
  if (status.lastOkAt && status.lastOkEvent) out[notifyChannel_(status.lastOkEvent)].lastOkAt = status.lastOkAt;
  if (status.lastError && status.lastError.event) out[notifyChannel_(status.lastError.event)].lastError = status.lastError;
  return out;
}

/**
 * Lưu kết quả gửi gần nhất của từng loại email (Script Property NOTIFY_STATUS) — trang quản trị hiện lỗi gửi mail nếu có.
 * Gửi thành công chỉ xóa lỗi cũ CÙNG LOẠI: mã OTP gửi được không có nghĩa email thông báo đã hoạt động lại (có thể vẫn đang
 * tạm dừng vì để dành hạn mức cho OTP) và ngược lại.
 */
function recordNotifyResult_(event, result) {
  var status = readNotifyStatus_();
  var channel = status[notifyChannel_(event)];
  if (result.ok) {
    channel.lastOkAt = nowIso_();
    delete channel.lastError;
  } else {
    channel.lastError = { at: nowIso_(), event: event, message: truncate_(result.message || '', 300) };
  }
  setProp_(PROP.NOTIFY_STATUS, JSON.stringify(status));
}

function channelView_(channel) {
  return { lastOkAt: channel.lastOkAt || '', lastError: channel.lastError || null };
}

/** Trạng thái email cho trang Cài đặt / Tổng quan. */
function notifyStatus_() {
  var status = readNotifyStatus_();
  return {
    recipients: notifyRecipients_().length,
    otpMode: otpMode_(),
    notify: channelView_(status.notify),
    otp: channelView_(status.otp)
  };
}

/**
 * Như notifyStatus_ nhưng không đọc CAU_HINH (dùng khi đọc cấu hình lỗi — trang Cài đặt vẫn hiện được lỗi gửi mail).
 * otpMode = giá trị mặc định khi CAU_HINH không có CONFIRM_OTP (xem otpMode_).
 */
function notifyStatusWithoutSettings_() {
  var status = readNotifyStatus_();
  return { recipients: 0, otpMode: 'EMAIL', notify: channelView_(status.notify), otp: channelView_(status.otp) };
}

/** Gửi thông báo tới NOTIFY_EMAILS. Chưa cấu hình → bỏ qua (không phải lỗi). Kết quả luôn được ghi lại. */
function notifyAdmins_(event, subject, lines, link, linkLabel) {
  var to = notifyRecipients_();
  if (!to.length) return { ok: false, skipped: true };
  var result = sendMail_(to.join(','), '[DTA] ' + subject, lines.concat(link ? ['Mở: ' + link] : []).join('\n'),
    mailHtml_(subject, lines, link, linkLabel), APP.MAIL_RESERVE_FOR_OTP);
  recordNotifyResult_(event, result);
  return result;
}

/**
 * Gửi thông báo SAU KHI thao tác chính đã ghi xong. Lỗi bất ngờ (đọc cấu hình, ghi trạng thái…) được ghi log + lưu vào
 * NOTIFY_STATUS để hiện trên trang quản trị — không biến thao tác đã lưu thành "lỗi" khiến người dùng bấm lại.
 */
function notifyAfterCommit_(event, send) {
  try {
    return send();
  } catch (e) {
    logError_('notify.' + event, e);
    var failure = { ok: false, message: String(e && e.message ? e.message : e) };
    try {
      recordNotifyResult_(event, failure);
    } catch (e2) {
      logError_('notify.record_failed', e2);
    }
    return failure;
  }
}

function notifyRevisionRequested_(rec, reason) {
  var base = appUrl_();
  return notifyAdmins_('REVISION_REQUESTED', 'Yêu cầu chỉnh sửa biên bản ' + rec.handover_code, [
    'Người nhận ' + rec.receiver_name + ' (' + rec.receiver_employee_id + ') yêu cầu chỉnh sửa biên bản ' + rec.handover_code + '.',
    'Lý do: ' + reason,
    'Vui lòng sửa biên bản để người nhận ký lại bằng link cũ.'
  ], base ? base + '/admin/ban-giao/' + rec.handover_id : '', 'Mở biên bản');
}

function notifyProposalSubmitted_(proposal, itemNames) {
  var base = appUrl_();
  return notifyAdmins_('PROPOSAL_SUBMITTED', 'Đề xuất mua văn phòng phẩm ' + proposal.proposalCode, [
    proposal.requesterName + ' (' + proposal.requesterEmployeeId + ', ' + (proposal.department || 'chưa có phòng ban') +
      ') gửi đề xuất ' + proposal.proposalCode + ' gồm ' + itemNames.length + ' sản phẩm:',
    itemNames.slice(0, 15).join(' · ') + (itemNames.length > 15 ? ' …' : ''),
    proposal.reason ? 'Ghi chú: ' + proposal.reason : ''
  ].filter(Boolean), base ? base + '/admin/vpp/de-xuat/' + proposal.proposalId : '', 'Mở đề xuất');
}

function notifyStockSyncFailed_(rec, message) {
  var base = appUrl_();
  return notifyAdmins_('STOCK_SYNC_FAILED', 'Cần đối soát kho — phiếu ' + rec.handover_code, [
    'Người nhận đã ký phiếu văn phòng phẩm ' + rec.handover_code + ' nhưng hệ thống chưa xuất kho được.',
    'Chi tiết: ' + message,
    'Mở phiếu và bấm "Đối soát kho" (an toàn khi bấm nhiều lần).'
  ], base ? base + '/admin/ban-giao/' + rec.handover_id : '', 'Mở phiếu');
}

/** Số liệu cho email tổng hợp hằng ngày. */
function dailyDigestData_() {
  var handovers = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'handover_code', 'status', 'receiver_name']);
  var revisions = handovers.filter(function (h) { return h.status === STATUS.REVISION_REQUESTED; });
  var pending = handovers.filter(function (h) { return h.status === STATUS.PENDING; }).length;
  var proposals = readColumns_(SHEETS.VPP_PROPOSALS, ['proposal_id', 'proposal_code', 'status', 'requester_name'])
    .filter(function (p) { return p.status === PROPOSAL_STATUS.SUBMITTED; });
  var alerts = vppStockAlerts_();
  return { revisions: revisions, pending: pending, proposals: proposals, outOfStock: alerts.outOfStock, lowStock: alerts.lowStock };
}

/**
 * Email tổng hợp (chạy theo lịch 8h sáng — installDailyDigestTrigger). Không có gì cần xử lý → không gửi. Mỗi ngày gửi TỐI ĐA một
 * lần: trigger thuộc về người bấm cài đặt (Apps Script chỉ thấy / xóa được trigger của chính mình) nên hai người cùng bấm sẽ có hai
 * trigger — dấu "đã gửi hôm nay" dùng chung (Script Property, đặt trong khóa trước khi gửi) chặn email thứ hai.
 */
function sendDailyDigest() {
  if (!notifyRecipients_().length) return 'Chưa cấu hình NOTIFY_EMAILS trong CAU_HINH — không gửi.';
  var d = dailyDigestData_();
  if (!d.revisions.length && !d.proposals.length && !d.outOfStock.length && !d.lowStock.length) return 'Không có việc cần xử lý — không gửi.';
  var today = todayIsoDate_();
  var claimed = withScriptLock_(function () {
    if (getProp_(PROP.DIGEST_SENT_DAY) === today) return false;
    setProp_(PROP.DIGEST_SENT_DAY, today);
    return true;
  });
  if (!claimed) return 'Hôm nay đã gửi email tổng hợp (trigger khác đã chạy) — bỏ qua.';
  var names = function (list, key) { return list.slice(0, 15).map(function (x) { return x[key]; }).join(', ') + (list.length > 15 ? ' …' : ''); };
  var lines = [
    'Yêu cầu chỉnh sửa chờ xử lý: ' + d.revisions.length + (d.revisions.length ? ' (' + names(d.revisions, 'handover_code') + ')' : ''),
    'Phiếu đang chờ người nhận ký: ' + d.pending,
    'Đề xuất mua chờ duyệt: ' + d.proposals.length + (d.proposals.length ? ' (' + names(d.proposals, 'proposal_code') + ')' : ''),
    '🔴 Hết hàng: ' + d.outOfStock.length + (d.outOfStock.length ? ' (' + names(d.outOfStock, 'productName') + ')' : ''),
    '🟠 Sắp hết: ' + d.lowStock.length + (d.lowStock.length ? ' (' + names(d.lowStock, 'productName') + ')' : '')
  ];
  var base = appUrl_();
  var result = notifyAdmins_('DAILY_DIGEST', 'Tổng hợp ngày ' + formatDisplayDate_(today), lines, base ? base + '/admin' : '', 'Mở trang Tổng quan');
  // Gửi lỗi → bỏ dấu để trigger khác (nếu có) / lần chạy tay sau trong ngày gửi lại được.
  if (!result.ok) withScriptLock_(function () { if (getProp_(PROP.DIGEST_SENT_DAY) === today) setProp_(PROP.DIGEST_SENT_DAY, ''); });
  return result.ok ? 'Đã gửi email tổng hợp.' : 'Gửi email tổng hợp lỗi: ' + (result.message || '');
}

/**
 * Bật email tổng hợp lúc ~8h sáng mỗi ngày (giờ của script: Asia/Ho_Chi_Minh). Chạy lại không tạo trigger trùng CỦA CHÍNH NGƯỜI
 * BẤM (Apps Script không thấy trigger của người khác) — trigger của người khác vẫn chạy nhưng cả ngày chỉ gửi một email.
 */
function installDailyDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(8).create();
  return showResult_('Email tổng hợp hằng ngày', 'Đã bật: mỗi ngày khoảng 8h sáng gửi tới NOTIFY_EMAILS (CAU_HINH), gửi từ tài khoản ' +
    'Google của bạn. Nếu người khác cũng đã bật, mỗi ngày vẫn chỉ gửi một email (người nào chạy trước thì gửi).');
}

/** Gửi thử một email tới NOTIFY_EMAILS (kiểm tra cấu hình + quyền gửi mail). */
function sendTestNotification() {
  var to = notifyRecipients_();
  if (!to.length) return showResult_('Gửi thử email', 'Chưa có email hợp lệ trong CAU_HINH → NOTIFY_EMAILS.');
  var result = notifyAdmins_('TEST', 'Email thử từ DTA Handover', [
    'Cấu hình gửi thông báo hoạt động. Người nhận: ' + to.join(', ') + '.',
    'Hạn mức gửi còn lại hôm nay: ' + MailApp.getRemainingDailyQuota() + ' người nhận.'
  ], appUrl_() ? appUrl_() + '/admin/cai-dat' : '', 'Mở trang Cài đặt');
  return showResult_('Gửi thử email', result.ok ? 'Đã gửi tới ' + to.join(', ') + '.' : 'Gửi lỗi: ' + result.message);
}
