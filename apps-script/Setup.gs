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
 *
 * Secret BACKEND_SHARED_SECRET lưu trong Script Properties (nhập qua menu hoặc
 * Project Settings → Script properties) — KHÔNG viết vào code. Xem apps-script/README.md.
 */

/** Giao diện Google Sheet — chỉ có khi chạy từ menu; chạy trong trình soạn thảo thì trả về null. */
function getUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
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

  // 2) Sheets + cột
  Object.keys(HEADERS).forEach(function (name) {
    report.push(ensureSheet_(ss, name, HEADERS[name]));
  });
  removeDefaultEmptySheet_(ss, report);
  resetHeaderCache_();

  // 3) Dữ liệu danh mục mặc định (chỉ thêm khi chưa có)
  report.push(seedDefaultCategories_());
  report.push(seedDefaultSettings_());

  // 4) Drive
  report.push(ensureDriveStructure_());

  // 5) Secret
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
      updated_at: now
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
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  var rows = [];
  readColumn_(sheet, 'employee_id').forEach(function (id, i) {
    if (String(id).toUpperCase().indexOf(APP.SAMPLE_EMPLOYEE_PREFIX) === 0) rows.push(i + 2);
  });
  withScriptLock_(function () { deleteRowNumbers_(SHEETS.EMPLOYEES, rows); });
  invalidateCaches_();
  var msg = 'Đã xóa ' + rows.length + ' nhân viên mẫu.';
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

function installWeeklyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNow').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
  var msg = 'Đã cài lịch sao lưu tự động: 2h sáng Chủ nhật hằng tuần.';
  console.log(msg);
  return msg;
}

/** Menu trong Google Sheet (chỉ khi script được tạo từ Extensions → Apps Script của Sheet). */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('DTA Handover')
      .addItem('Thiết lập / cập nhật database', 'setupDatabase')
      .addItem('Kiểm tra cấu hình', 'checkSetup')
      .addItem('Nhập / đổi khóa kết nối (BACKEND_SHARED_SECRET)', 'setSharedSecret')
      .addSeparator()
      .addItem('Làm mới cache (sau khi sửa nhân viên)', 'refreshCaches')
      .addItem('Thêm nhân viên mẫu (DEMO-)', 'seedSampleEmployees')
      .addItem('Xóa nhân viên mẫu (DEMO-)', 'removeSampleEmployees')
      .addSeparator()
      .addItem('Sao lưu ngay', 'backupNow')
      .addToUi();
  } catch (e) {
    // Script độc lập (không gắn Sheet) — bỏ qua.
  }
}

/** Sửa trực tiếp NHAN_VIEN / LOAI_BAN_GIAO / CAU_HINH → xóa cache để Web App thấy dữ liệu mới ngay. */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === SHEETS.EMPLOYEES || name === SHEETS.CATEGORIES || name === SHEETS.SETTINGS) invalidateCaches_();
  } catch (err) {
    // Simple trigger không được phép ném lỗi ra giao diện.
  }
}

function notifyUser_(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'DTA Handover', 6);
  } catch (e) {
    // Không chạy trong giao diện Sheet.
  }
}
