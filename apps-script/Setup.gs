/**
 * Setup.gs — các hàm chạy THỦ CÔNG: từ menu "DTA Handover" trong Google Sheet (khuyến nghị)
 * hoặc trong trình soạn thảo Apps Script (chọn hàm → Run).
 *
 *   setupDatabase()            Tạo / bổ sung các sheet, cột, loại bàn giao mặc định, cấu hình,
 *                              thư mục Drive. Chạy lại bao nhiêu lần cũng được — KHÔNG xóa dữ liệu.
 *                              Chạy từ menu: hỏi khóa kết nối nếu chưa có và hiện kết quả.
 *   setSharedSecret()          Nhập / đổi khóa kết nối BACKEND_SHARED_SECRET (từ menu).
 *   checkSetup()               Kiểm tra cấu hình, hiện báo cáo (không hiện secret).
 *   seedSampleEmployees()      Thêm nhân viên MẪU (mã DEMO-...) để thử hệ thống.
 *   removeSampleEmployees()    Xóa toàn bộ nhân viên mẫu DEMO-...
 *   refreshCaches()            Xóa cache sau khi sửa trực tiếp NHAN_VIEN / LOAI_BAN_GIAO / CAU_HINH.
 *   backupNow()                Tạo bản sao Spreadsheet vào DTA_HANDOVER/backups.
 *   installWeeklyBackupTrigger()  Tự động sao lưu 2h sáng Chủ nhật hằng tuần.
 *   upgradeOfficeSupplyModule()   Nâng cấp lên v2 (module Văn phòng phẩm) — xem VppSetup.gs.
 *   seedOfficeSupplyNorms() / seedInitialOfficeSupplyStock()   Định mức / tồn đầu kỳ VPP (chạy thủ công).
 *   protectSystemSheets()      Khóa các sheet do hệ thống ghi (chỉ chủ sở hữu script sửa được).
 *
 * Secret BACKEND_SHARED_SECRET lưu trong Script Properties (nhập qua menu hoặc
 * Project Settings → Script properties) — KHÔNG viết vào code. Xem apps-script/README.md.
 */

/** Giao diện Google Sheet — chỉ có khi chạy từ menu; chạy trong trình soạn thảo thì trả về null. */
function getUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null; // chạy trong editor / trigger: không có giao diện Sheet — người gọi tự ghi log kết quả
  }
}

/** Ghi log + hiện hộp thoại (nếu chạy từ menu Sheet). Trả về thông điệp để chạy từ editor cũng thấy kết quả. */
function showResult_(title, message) {
  console.log(title + ': ' + message);
  var ui = getUi_();
  if (ui) ui.alert(title, message, ui.ButtonSet.OK);
  return message;
}

/** Hộp thoại nhập khóa kết nối. Trả về true nếu đã lưu. */
function promptSharedSecret_(ui, intro) {
  var res = ui.prompt(
    'DTA Handover – Khóa kết nối',
    intro + '\n\nDán khóa GAS_SHARED_SECRET (trong file .dev.vars khi chạy local, hoặc giá trị đã đặt bên Cloudflare) rồi bấm OK.' +
      '\nKhóa phải dài ít nhất 32 ký tự, không có khoảng trắng.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() != ui.Button.OK) return false;
  var value = String(res.getResponseText() || '').trim();
  if (value.length < 32 || /\s/.test(value)) {
    ui.alert('DTA Handover', 'Khóa không hợp lệ: cần ít nhất 32 ký tự và không có khoảng trắng. Chưa lưu.', ui.ButtonSet.OK);
    return false;
  }
  setProp_(PROP.SHARED_SECRET, value);
  return true;
}

/** Menu: nhập / đổi BACKEND_SHARED_SECRET mà không cần vào Project Settings. */
function setSharedSecret() {
  var ui = getUi_();
  if (!ui) {
    throw new Error('Hãy chạy từ menu DTA Handover trong Google Sheet, hoặc đặt Script Property BACKEND_SHARED_SECRET trong Cài đặt dự án.');
  }
  var existing = getProp_(PROP.SHARED_SECRET);
  if (promptSharedSecret_(ui, existing ? 'Đổi khóa kết nối hiện tại (' + existing.length + ' ký tự).' : 'Chưa có khóa kết nối.')) {
    ui.alert('DTA Handover', 'Đã lưu khóa kết nối (BACKEND_SHARED_SECRET).\n' +
      'Giá trị này phải GIỐNG HỆT GAS_SHARED_SECRET bên Cloudflare / file .dev.vars.', ui.ButtonSet.OK);
  }
}

function setupDatabase() {
  var report = [];
  var props = PropertiesService.getScriptProperties();
  var ui = getUi_();

  // 0) Khóa kết nối — chạy từ menu thì hỏi luôn nếu chưa có.
  if (ui && getProp_(PROP.SHARED_SECRET).length < 32) {
    promptSharedSecret_(ui, 'Chưa có khóa kết nối giữa Cloudflare Worker và Apps Script.');
  }

  // 1) Spreadsheet
  if (!getProp_(PROP.SPREADSHEET_ID)) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) {
      throw new Error('Chưa có SPREADSHEET_ID. Hãy mở Apps Script từ Google Sheet (Extensions → Apps Script) ' +
        'hoặc đặt Script Property SPREADSHEET_ID = ID của Google Sheet rồi chạy lại.');
    }
    props.setProperty(PROP.SPREADSHEET_ID, active.getId());
    report.push('Đã lưu SPREADSHEET_ID = ' + active.getId());
  }
  SPREADSHEET_ = null;
  resetHeaderCache_();
  var ss = getSpreadsheet_();
  try {
    if (ss.getSpreadsheetTimeZone() !== APP.TIMEZONE) {
      ss.setSpreadsheetTimeZone(APP.TIMEZONE);
      report.push('Đặt múi giờ Spreadsheet = ' + APP.TIMEZONE);
    }
  } catch (e) {
    report.push('Không đặt được múi giờ Spreadsheet: ' + e.message);
  }

  // 2) Drive (trước để có thư mục backups khi cần sao lưu trước nâng cấp)
  report.push(ensureDriveStructure_());

  // 3) Sheets + cột + danh mục mặc định + loại "Văn phòng phẩm" + cấu hình (chỉ thêm phần thiếu, không xóa dữ liệu)
  withScriptLock_(function () { ensureSchemaV2_(ss, report); });
  removeDefaultEmptySheet_(ss, report);
  resetHeaderCache_();

  // 4) Secret
  var secret = getProp_(PROP.SHARED_SECRET);
  report.push(secret && secret.length >= 32
    ? 'BACKEND_SHARED_SECRET: đã cấu hình (' + secret.length + ' ký tự).'
    : 'CẢNH BÁO: BACKEND_SHARED_SECRET chưa cấu hình hoặc ngắn hơn 32 ký tự (menu DTA Handover → Nhập / đổi khóa kết nối).');

  invalidateCaches_();
  var text = 'DTA Handover – setupDatabase()\n- ' + report.join('\n- ');
  console.log(text);
  if (ui) ui.alert('DTA Handover – Thiết lập hoàn tất', text, ui.ButtonSet.OK);
  else notifyUser_('Thiết lập hoàn tất. Xem chi tiết trong Execution log.');
  return text;
}

/** Tạo sheet nếu chưa có; thêm cột thiếu vào cuối; định dạng văn bản; cố định dòng tiêu đề. */
function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    created = true;
  }
  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  var hasHeader = existing.some(function (h) { return h !== ''; });
  var added = [];
  if (!hasHeader) {
    ensureColumns_(sheet, headers.length); // sheet mới chỉ có 26 cột (A–Z)
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    added = headers.slice();
  } else {
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      var start = existing.length + 1;
      ensureColumns_(sheet, start + missing.length - 1);
      sheet.getRange(1, start, 1, missing.length).setValues([missing]);
      added = missing;
    }
  }
  var width = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f3eadb').setFontColor('#3f2a17');
  sheet.setFrozenRows(1);
  // Văn bản thuần: tránh Sheets tự đổi "0901..." thành số, "2026-10-15" thành ngày, "519" thành số.
  sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), width).setNumberFormat('@');
  return name + ': ' + (created ? 'tạo mới' : 'đã có') + (added.length ? ', thêm cột [' + added.join(', ') + ']' : '');
}

function ensureColumns_(sheet, needed) {
  var max = sheet.getMaxColumns();
  if (max < needed) sheet.insertColumnsAfter(max, needed - max);
}

function removeDefaultEmptySheet_(ss, report) {
  var ours = Object.keys(HEADERS);
  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (ours.indexOf(name) >= 0) return;
    if (!/^(Sheet|Trang tính|Trang tinh)\s?\d+$/i.test(name)) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
      report.push('Xóa sheet trống mặc định "' + name + '"');
    }
  });
}

function seedDefaultCategories_() {
  var sheet = getSheet_(SHEETS.CATEGORIES);
  if (sheet.getLastRow() >= 2) return 'LOAI_BAN_GIAO: đã có dữ liệu, giữ nguyên.';
  var now = nowIso_();
  appendObjects_(SHEETS.CATEGORIES, DEFAULT_CATEGORIES.map(function (c) {
    return {
      code: c.code,
      name: c.name,
      form_fields: c.form_fields,
      hint: c.hint,
      sort_order: c.sort_order,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
      handover_type: c.handover_type
    };
  }));
  return 'LOAI_BAN_GIAO: thêm ' + DEFAULT_CATEGORIES.length + ' loại mặc định.';
}

function seedDefaultSettings_() {
  var existing = {};
  readTable_(SHEETS.SETTINGS).rows.forEach(function (r) { existing[String(r.key).trim().toUpperCase()] = true; });
  var now = nowIso_();
  var toAdd = DEFAULT_SETTINGS.filter(function (s) { return !existing[s.key]; }).map(function (s) {
    return { key: s.key, value: s.value, description: s.description, updated_at: now };
  });
  appendObjects_(SHEETS.SETTINGS, toAdd);
  return 'CAU_HINH: thêm ' + toAdd.length + ' khóa cấu hình.';
}

function ensureDriveStructure_() {
  var id = getProp_(PROP.DRIVE_FOLDER_ID);
  var root;
  var created = false;
  if (id) {
    root = DriveApp.getFolderById(id);
  } else {
    root = DriveApp.createFolder(APP.DRIVE_ROOT_NAME);
    setProp_(PROP.DRIVE_FOLDER_ID, root.getId());
    created = true;
  }
  ['signatures', 'pdf', 'backups'].forEach(function (name) { getOrCreateChildFolder_(root, name); });
  return 'Drive: ' + (created ? 'tạo mới' : 'dùng') + ' thư mục "' + root.getName() + '" (DRIVE_FOLDER_ID = ' + root.getId() + ')';
}

/** Kiểm tra cấu hình hiện tại. Không in giá trị secret. */
function checkSetup() {
  var lines = [];
  var ok = true;
  // Code đủ file và cùng một phiên bản (thiếu Notify.gs, còn file .gs cũ ghi đè…) — kiểm tra đầu tiên vì mọi thứ khác dựa vào đó.
  try {
    assertCodeConsistent_();
    var routes = loadRoutes_();
    var missingHandlers = Object.keys(routes).filter(function (name) { return typeof routes[name].handler !== 'function'; });
    if (missingHandlers.length) throw new Error('thiếu xử lý cho ' + missingHandlers.join(', '));
    lines.push('✓ Code Apps Script đầy đủ, một phiên bản (v' + CODE_VERSION_ + ')');
  } catch (e) {
    ok = false;
    lines.push('✗ Code Apps Script: ' + e.message);
  }
  var schema = parseInt(getProp_(PROP.SCHEMA_VERSION), 10) || 0;
  if (schema < APP.SCHEMA_VERSION) {
    ok = false;
    lines.push('✗ Cấu trúc dữ liệu v' + schema + ' — cần chạy "Nâng cấp module Văn phòng phẩm" (upgradeOfficeSupplyModule).');
  } else {
    lines.push('✓ Cấu trúc dữ liệu v' + schema + ' (code v' + APP.VERSION + ')');
  }
  var secret = getProp_(PROP.SHARED_SECRET);
  if (!secret) {
    ok = false;
    lines.push('✗ BACKEND_SHARED_SECRET chưa cấu hình.');
  } else {
    lines.push((secret.length >= 32 ? '✓' : '⚠') + ' BACKEND_SHARED_SECRET: ' + secret.length + ' ký tự' +
      (secret.length >= 32 ? '' : ' (nên >= 32 ký tự ngẫu nhiên)'));
  }
  try {
    var ss = getSpreadsheet_();
    lines.push('✓ Spreadsheet: ' + ss.getName());
    Object.keys(HEADERS).forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        ok = false;
        lines.push('✗ Thiếu sheet ' + name);
        return;
      }
      resetHeaderCache_();
      var headers = getHeaders_(sheet);
      var missing = HEADERS[name].filter(function (h) { return headers.indexOf(h) < 0; });
      if (missing.length) ok = false;
      lines.push((missing.length ? '✗ ' : '✓ ') + name + ': ' + Math.max(0, sheet.getLastRow() - 1) + ' dòng' +
        (missing.length ? ', thiếu cột ' + missing.join(', ') : ''));
    });
    var employees = loadEmployeesFromSheet_();
    var active = employees.filter(function (e) { return e.status === 'ACTIVE'; }).length;
    lines.push('• Nhân viên: ' + employees.length + ' (ACTIVE: ' + active + ')');
    var invalidStatus = readTable_(SHEETS.EMPLOYEES).rows.filter(function (r) {
      var s = String(r.status || '').trim().toUpperCase();
      return s !== '' && s !== 'ACTIVE' && s !== 'INACTIVE';
    }).length;
    if (invalidStatus) lines.push('⚠ ' + invalidStatus + ' nhân viên có status khác ACTIVE/INACTIVE (được coi là INACTIVE).');
    lines.push('• Loại bàn giao: ' + loadCategoriesFromSheet_().map(function (c) { return c.name + (c.active ? '' : ' (tắt)'); }).join(', '));
    if (ss.getSheetByName(SHEETS.VPP_PRODUCTS) && ss.getSheetByName(SHEETS.VPP_NORMS)) {
      var vppProducts = loadProducts_();
      lines.push('• Văn phòng phẩm: ' + vppProducts.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.MASTER; }).length +
        ' sản phẩm danh mục, ' + loadNorms_().length + ' định mức, ' + vppReviewCounts_().total + ' mục cần kiểm tra');
    }
  } catch (e) {
    ok = false;
    lines.push('✗ Spreadsheet: ' + e.message);
  }
  try {
    lines.push('✓ Drive: ' + getRootFolder_().getName());
  } catch (e) {
    ok = false;
    lines.push('✗ Drive: ' + e.message);
  }
  // Email: mã OTP khi ký cần MailApp (chủ sở hữu phải cấp quyền "Gửi email thay bạn" một lần).
  // CAU_HINH đọc lỗi → báo ✗ riêng, vẫn kiểm tra MailApp với chế độ mặc định (EMAIL) thay vì dừng cả bản kiểm tra.
  var otpMode = 'EMAIL';
  var recipients = 0;
  try {
    otpMode = otpMode_();
    recipients = notifyRecipients_().length;
  } catch (e) {
    ok = false;
    lines.push('✗ Đọc cấu hình email (CAU_HINH: CONFIRM_OTP, NOTIFY_EMAILS): ' + e.message);
  }
  try {
    var quota = MailApp.getRemainingDailyQuota();
    lines.push('✓ Gửi email (MailApp): còn ' + quota + ' lượt hôm nay · Mã OTP khi ký: ' + otpMode +
      ' · Người nhận thông báo: ' + recipients);
  } catch (e) {
    if (otpMode !== 'OFF') ok = false;
    lines.push((otpMode !== 'OFF' ? '✗' : '⚠') + ' Gửi email (MailApp): ' + e.message +
      ' — chạy menu "Gửi thử email thông báo" để cấp quyền gửi email' +
      (otpMode !== 'OFF' ? ' (CONFIRM_OTP = ' + otpMode + ': người nhận có email sẽ KHÔNG ký được khi chưa gửi được mã).' : '.'));
  }
  lines.push(ok ? 'KẾT QUẢ: Cấu hình hợp lệ.' : 'KẾT QUẢ: Còn mục cần xử lý (✗).');
  var text = lines.join('\n');
  console.log(text);
  var ui = getUi_();
  if (ui) ui.alert('DTA Handover – Kiểm tra cấu hình', text, ui.ButtonSet.OK);
  return text;
}

function seedSampleEmployees() {
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  var existing = {};
  readColumn_(sheet, 'employee_id').forEach(function (id) { existing[String(id).toUpperCase()] = true; });
  var now = nowIso_();
  var rows = SAMPLE_EMPLOYEES.filter(function (e) { return !existing[e[0].toUpperCase()]; }).map(function (e) {
    return {
      employee_id: e[0],
      full_name: e[1],
      department: e[2],
      position: e[3],
      email: e[4],
      phone: e[5],
      status: e[6],
      created_at: now,
      updated_at: now
    };
  });
  withScriptLock_(function () { appendObjects_(SHEETS.EMPLOYEES, rows); });
  invalidateCaches_();
  var msg = 'Đã thêm ' + rows.length + ' nhân viên mẫu (mã bắt đầu "' + APP.SAMPLE_EMPLOYEE_PREFIX + '").';
  console.log(msg);
  notifyUser_(msg);
  return msg;
}

function removeSampleEmployees() {
  var count = withScriptLock_(function () {
    // Đọc lại cột và xóa theo GIÁ TRỊ ngay trong khóa (không dùng số dòng đã lưu từ trước).
    return deleteRowsWhere_(SHEETS.EMPLOYEES, 'employee_id', function (id) {
      return String(id).toUpperCase().indexOf(APP.SAMPLE_EMPLOYEE_PREFIX) === 0;
    });
  });
  invalidateCaches_();
  var msg = 'Đã xóa ' + count + ' nhân viên mẫu.';
  console.log(msg);
  notifyUser_(msg);
  return msg;
}

function refreshCaches() {
  invalidateCaches_();
  var msg = 'Đã làm mới cache nhân viên / loại bàn giao / cấu hình.';
  console.log(msg);
  notifyUser_(msg);
  return msg;
}

/** Sao lưu: tạo bản sao toàn bộ Spreadsheet vào DTA_HANDOVER/backups. */
function backupNow() {
  var ss = getSpreadsheet_();
  var folder = getOrCreateChildFolder_(getRootFolder_(), 'backups');
  var name = ss.getName() + ' – backup ' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd HHmm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  var msg = 'Đã sao lưu: ' + copy.getName();
  console.log(msg);
  return msg;
}

/**
 * Sao lưu theo lịch (trigger hằng tuần). Trigger thuộc về người cài (Apps Script chỉ thấy trigger của chính mình) nên nhiều người
 * cùng cài sẽ có nhiều trigger — dấu "lần sao lưu tự động gần nhất" dùng chung giữ mỗi tuần tối đa một bản. "Sao lưu ngay" (chạy
 * tay) luôn sao lưu.
 */
function scheduledBackup() {
  var claimed = withScriptLock_(function () {
    var last = getProp_(PROP.LAST_SCHEDULED_BACKUP);
    if (last && Date.now() - new Date(last).getTime() < 6 * 24 * 3600 * 1000) return false;
    setProp_(PROP.LAST_SCHEDULED_BACKUP, nowIso_());
    return true;
  });
  if (!claimed) return 'Tuần này đã sao lưu tự động (trigger khác đã chạy) — bỏ qua.';
  try {
    return backupNow();
  } catch (e) {
    setProp_(PROP.LAST_SCHEDULED_BACKUP, ''); // lỗi → lần chạy sau (hoặc trigger khác) thử lại
    throw e;
  }
}

function installWeeklyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var handler = t.getHandlerFunction();
    if (handler === 'backupNow' || handler === 'scheduledBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
  var msg = 'Đã cài lịch sao lưu tự động: 2h sáng Chủ nhật hằng tuần (nếu người khác cũng đã cài, mỗi tuần vẫn chỉ một bản).';
  console.log(msg);
  return msg;
}

/**
 * Khóa các sheet do hệ thống ghi (BAN_GIAO, CHI_TIET_BAN_GIAO, LICH_SU, tồn kho, biến động kho, đề xuất):
 * chỉ tài khoản chạy script (chủ sở hữu) sửa được — người khác có quyền Editor không thể sửa tay / sắp xếp làm lệch
 * dữ liệu. NHAN_VIEN, LOAI_BAN_GIAO, CAU_HINH, VPP_SAN_PHAM, VPP_DINH_MUC vẫn sửa trực tiếp được.
 */
function protectSystemSheets() {
  var ss = getSpreadsheet_();
  var me = Session.getEffectiveUser();
  var names = [
    SHEETS.HANDOVERS, SHEETS.ITEMS, SHEETS.HISTORY, SHEETS.VPP_STOCK, SHEETS.VPP_MOVEMENTS, SHEETS.VPP_PROPOSALS,
    SHEETS.VPP_PROPOSAL_ITEMS
  ];
  var done = [];
  names.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var protection = existing.length ? existing[0] : sheet.protect();
    protection.setDescription('DTA Handover – chỉ hệ thống ghi (không sửa tay)');
    protection.addEditor(me);
    var others = protection.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); });
    if (others.length) protection.removeEditors(others);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
    done.push(name);
  });
  var msg = 'Đã khóa ' + done.length + ' sheet hệ thống (chỉ ' + me.getEmail() + ' sửa được): ' + done.join(', ');
  console.log(msg);
  var ui = getUi_();
  if (ui) ui.alert('DTA Handover', msg, ui.ButtonSet.OK);
  return msg;
}

/** Menu trong Google Sheet (chỉ khi script được tạo từ Extensions → Apps Script của Sheet). */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('DTA Handover')
      .addItem('Thiết lập / cập nhật database', 'setupDatabase')
      .addItem('Nâng cấp module Văn phòng phẩm (v2)', 'upgradeOfficeSupplyModule')
      .addItem('Kiểm tra cấu hình', 'checkSetup')
      .addItem('Nhập / đổi khóa kết nối (BACKEND_SHARED_SECRET)', 'setSharedSecret')
      .addSeparator()
      .addItem('Khởi tạo định mức VPP (từ bản định mức)', 'seedOfficeSupplyNorms')
      .addItem('Nhập tồn đầu kỳ VPP (chạy 1 lần)', 'seedInitialOfficeSupplyStock')
      .addSeparator()
      .addItem('Làm mới cache (sau khi sửa nhân viên)', 'refreshCaches')
      .addItem('Thêm nhân viên mẫu (DEMO-)', 'seedSampleEmployees')
      .addItem('Xóa nhân viên mẫu (DEMO-)', 'removeSampleEmployees')
      .addSeparator()
      .addItem('Khóa sheet hệ thống (chỉ hệ thống ghi)', 'protectSystemSheets')
      .addItem('Sao lưu ngay', 'backupNow')
      .addSeparator()
      .addItem('Gửi thử email thông báo (NOTIFY_EMAILS)', 'sendTestNotification')
      .addItem('Bật email tổng hợp hằng ngày (8h sáng)', 'installDailyDigestTrigger')
      .addToUi();
  } catch (e) {
    // Script độc lập (không gắn Sheet) không có menu — chỉ ghi log để biết.
    logInfo_('onOpen.no_ui', { message: String(e && e.message ? e.message : e) });
  }
}

/** Sửa trực tiếp NHAN_VIEN / LOAI_BAN_GIAO / CAU_HINH / danh mục VPP → xóa cache để Web App thấy dữ liệu mới ngay. */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === SHEETS.EMPLOYEES || name === SHEETS.CATEGORIES || name === SHEETS.SETTINGS || name === SHEETS.VPP_PRODUCTS ||
        name === SHEETS.VPP_NORMS) {
      invalidateCaches_();
    }
  } catch (err) {
    // Simple trigger không được ném lỗi ra giao diện người đang sửa Sheet → ghi log (Executions) để theo dõi.
    logError_('onEdit.invalidate_cache', err);
  }
}

function notifyUser_(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'DTA Handover', 6);
  } catch (e) {
    // Không chạy trong giao diện Sheet (editor / trigger) → thông điệp vẫn có trong log.
    logInfo_('notifyUser.no_ui', { message: message });
  }
}
