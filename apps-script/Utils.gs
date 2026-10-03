/**
 * Utils.gs — tiện ích dùng chung: lỗi, thời gian, chuỗi, khóa, cache, đọc/ghi Sheet theo lô.
 */

// ============================================================================
// Lỗi ứng dụng (được chuyển thành { ok:false, error:{ code, message } } trong doPost)
// ============================================================================

function appError_(code, message, details) {
  var err = new Error(message);
  err.appCode = code;
  if (details !== undefined) err.details = details;
  return err;
}

function validationError_(fieldErrors) {
  var keys = Object.keys(fieldErrors);
  var first = keys.length ? fieldErrors[keys[0]] : 'Dữ liệu không hợp lệ.';
  return appError_('VALIDATION_ERROR', first, { fieldErrors: fieldErrors });
}

function logError_(context, err) {
  console.error(JSON.stringify({
    context: context,
    code: err && err.appCode ? err.appCode : '',
    message: err && err.message ? String(err.message) : String(err),
    stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join(' | ') : ''
  }));
}

function logInfo_(context, fields) {
  console.log(JSON.stringify(Object.assign({ context: context }, fields || {})));
}

// ============================================================================
// Thời gian — luôn theo Asia/Ho_Chi_Minh, lưu ISO 8601 có offset +07:00
// ============================================================================

function formatIso_(date) {
  return Utilities.formatDate(date, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") + APP.TZ_OFFSET;
}

function nowIso_() {
  return formatIso_(new Date());
}

function todayKey_() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyyMMdd');
}

/** ISO → "DD/MM/YYYY HH:mm" theo giờ Việt Nam. */
function formatDisplayDateTime_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, APP.TIMEZONE, 'dd/MM/yyyy HH:mm');
}

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
function formatDisplayDate_(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(value || '');
}

// ============================================================================
// Chuỗi
// ============================================================================

/** Giá trị ô Sheet → chuỗi (Date → ISO VN, số → chuỗi). */
function cellToString_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : formatIso_(value);
  }
  if (typeof value === 'number') return isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  var s = String(value);
  // Bỏ dấu ' bảo vệ công thức (xem toCell_) nếu Sheets trả lại nguyên văn.
  if (s.length > 1 && s.charAt(0) === "'" && /[=+\-@]/.test(s.charAt(1))) s = s.slice(1);
  return s;
}

/**
 * Giá trị → ô Sheet. Chống chèn công thức (formula injection): chuỗi bắt đầu bằng = + - @
 * được thêm tiền tố ' để Google Sheets luôn coi là văn bản.
 */
function toCell_(value) {
  if (value === null || value === undefined) return '';
  var s = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function stripControl_(value) {
  // eslint-disable-next-line no-control-regex
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Một dòng: bỏ ký tự điều khiển, gộp khoảng trắng, trim. Không cắt độ dài. */
function cleanLine_(value) {
  return stripControl_(value).replace(/\s+/g, ' ').trim();
}

/** Nhiều dòng: chuẩn hóa xuống dòng, trim. Không cắt độ dài. */
function cleanText_(value) {
  return stripControl_(value).replace(/\r\n?/g, '\n').trim();
}

function truncate_(value, max) {
  var s = String(value === null || value === undefined ? '' : value);
  return s.length > max ? s.slice(0, max) : s;
}

/** Bỏ dấu tiếng Việt, chữ thường — dùng cho tìm kiếm / lọc. */
function normalizeText_(value) {
  var s = String(value === null || value === undefined ? '' : value).toLowerCase();
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // Dự phòng khi runtime không hỗ trợ Unicode normalization.
  s = s
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
    .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
    .replace(/[ìíịỉĩ]/g, 'i')
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
    .replace(/[ùúụủũưừứựửữ]/g, 'u')
    .replace(/[ỳýỵỷỹ]/g, 'y')
    .replace(/đ/g, 'd');
  return s.replace(/\s+/g, ' ').trim();
}

function compareVi_(a, b) {
  var x = normalizeText_(a);
  var y = normalizeText_(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

var PASSWORD_MESSAGE_ =
  'Không được ghi mật khẩu vào biên bản. Hãy bàn giao mật khẩu trực tiếp hoặc yêu cầu người nhận tự đặt lại.';

/** Phát hiện chuỗi dạng "password: abc", "mật khẩu = 123", "MK: x". */
function containsPasswordLike_(value) {
  if (!value) return false;
  return /(?:^|[^a-z0-9])(?:password|passwd|passcode|pass|pwd|pw|mat khau|matkhau|mk)\s*[:=]\s*\S/.test(normalizeText_(value));
}

function isValidDateOnly_(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function isHttpUrl_(value) {
  return /^https?:\/\/[^\s<>"']+$/i.test(String(value || ''));
}

function isUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function isHex64_(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ''));
}

function uuid_() {
  return Utilities.getUuid().toLowerCase();
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function clampInt_(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function safeJson_(value, maxLength) {
  var s = '';
  try {
    s = JSON.stringify(value);
  } catch (e) {
    s = '';
  }
  return maxLength && s.length > maxLength ? s.slice(0, maxLength) : s;
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Script Properties
// ============================================================================

function getProp_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v ? String(v).trim() : '';
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

// ============================================================================
// LockService — tuần tự hóa các thao tác ghi quan trọng (sinh mã, tạo, xác nhận, đổi trạng thái)
// ============================================================================

var LOCK_DEPTH_ = 0;

function withScriptLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn(); // đã giữ khóa trong cùng execution
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) {
    throw appError_('LOCK_TIMEOUT', 'Hệ thống đang bận, vui lòng thử lại sau ít giây.');
  }
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    try {
      SpreadsheetApp.flush(); // ghi xong trước khi nhả khóa cho request khác
    } catch (e) {
      logError_('withScriptLock_.flush', e);
    }
    lock.releaseLock();
  }
}

// ============================================================================
// CacheService — JSON lớn được chia nhiều phần (giới hạn 100KB / giá trị)
// ============================================================================

function cacheGetJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + ':n');
    if (!meta) return null;
    var count = parseInt(meta, 10);
    if (!(count > 0) || count > 200) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push(key + ':' + i);
    var parts = cache.getAll(keys);
    var text = '';
    for (var j = 0; j < keys.length; j++) {
      if (parts[keys[j]] === undefined || parts[keys[j]] === null) return null;
      text += parts[keys[j]];
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function cachePutJson_(key, value, ttlSeconds) {
  try {
    var text = JSON.stringify(value);
    var size = APP.CACHE_CHUNK_CHARS;
    var count = Math.max(1, Math.ceil(text.length / size));
    if (count > 200) return;
    var entries = {};
    for (var i = 0; i < count; i++) entries[key + ':' + i] = text.substr(i * size, size);
    entries[key + ':n'] = String(count);
    CacheService.getScriptCache().putAll(entries, ttlSeconds);
  } catch (e) {
    logError_('cachePutJson_', e);
  }
}

function cacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key + ':n');
  } catch (e) {
    logError_('cacheRemove_', e);
  }
}

// ============================================================================
// Google Sheet — đọc/ghi theo lô (getValues / setValues), tra cứu bằng TextFinder
// ============================================================================

var SPREADSHEET_ = null;
var HEADER_CACHE_ = {};

function getSpreadsheet_() {
  if (SPREADSHEET_) return SPREADSHEET_;
  var id = getProp_(PROP.SPREADSHEET_ID);
  if (id) {
    try {
      SPREADSHEET_ = SpreadsheetApp.openById(id);
    } catch (e) {
      throw appError_('NOT_CONFIGURED', 'Không mở được Google Sheet (SPREADSHEET_ID sai hoặc không có quyền).');
    }
  } else {
    SPREADSHEET_ = SpreadsheetApp.getActiveSpreadsheet();
    if (!SPREADSHEET_) {
      throw appError_('NOT_CONFIGURED', 'Chưa cấu hình SPREADSHEET_ID. Hãy chạy setupDatabase().');
    }
  }
  return SPREADSHEET_;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw appError_('NOT_CONFIGURED', 'Thiếu sheet "' + name + '". Hãy chạy setupDatabase().');
  return sheet;
}

function getHeaders_(sheet) {
  var name = sheet.getName();
  if (HEADER_CACHE_[name]) return HEADER_CACHE_[name];
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  HEADER_CACHE_[name] = headers;
  return headers;
}

function resetHeaderCache_() {
  HEADER_CACHE_ = {};
}

function columnIndex_(sheet, column) {
  var idx = getHeaders_(sheet).indexOf(column);
  if (idx < 0) {
    throw appError_('NOT_CONFIGURED', 'Sheet "' + sheet.getName() + '" thiếu cột "' + column + '". Hãy chạy setupDatabase().');
  }
  return idx + 1;
}

function rowToObject_(headers, values) {
  var obj = {};
  for (var j = 0; j < headers.length; j++) {
    if (headers[j]) obj[headers[j]] = cellToString_(values[j]);
  }
  return obj;
}

function isEmptyRow_(values) {
  for (var j = 0; j < values.length; j++) {
    if (values[j] !== '' && values[j] !== null && values[j] !== undefined) return false;
  }
  return true;
}

/** Đọc toàn bộ sheet thành mảng object (1 lần getValues). */
function readTable_(name) {
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  var rows = [];
  if (lastRow >= 2 && headers.length) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (isEmptyRow_(values[i])) continue;
      var obj = rowToObject_(headers, values[i]);
      obj._row = i + 2;
      rows.push(obj);
    }
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

/** Đọc một cột (không gồm header) → mảng giá trị chuỗi. */
function readColumn_(sheet, column) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, columnIndex_(sheet, column), lastRow - 1, 1).getValues().map(function (r) {
    return cellToString_(r[0]);
  });
}

/**
 * Tìm các dòng có column === value (khớp toàn bộ ô) bằng TextFinder, rồi đọc theo lô.
 * Trả về [{ rowIndex, record }] theo thứ tự dòng.
 */
function findRows_(name, column, value) {
  if (!value) return [];
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var col = columnIndex_(sheet, column);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var cells = sheet.getRange(2, col, lastRow - 1, 1)
    .createTextFinder(String(value))
    .matchCase(true)
    .matchEntireCell(true)
    .findAll();
  if (!cells || !cells.length) return [];
  var rowNumbers = cells.map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; });
  var first = rowNumbers[0];
  var last = rowNumbers[rowNumbers.length - 1];
  var results = [];
  var pushIfMatch = function (rowIndex, values) {
    var record = rowToObject_(headers, values);
    if (record[column] === String(value)) results.push({ rowIndex: rowIndex, record: record });
  };
  if ((last - first + 1) * headers.length <= 60000) {
    var block = sheet.getRange(first, 1, last - first + 1, headers.length).getValues();
    rowNumbers.forEach(function (r) { pushIfMatch(r, block[r - first]); });
  } else {
    rowNumbers.forEach(function (r) { pushIfMatch(r, sheet.getRange(r, 1, 1, headers.length).getValues()[0]); });
  }
  return results;
}

function findRow_(name, column, value) {
  var rows = findRows_(name, column, value);
  return rows.length ? rows[0] : null;
}

function ensureCapacity_(sheet, lastNeededRow) {
  var maxRows = sheet.getMaxRows();
  if (lastNeededRow > maxRows) {
    sheet.insertRowsAfter(maxRows, lastNeededRow - maxRows + 200);
  }
}

/** Ghi thêm nhiều dòng (1 lần setValues). Định dạng văn bản để Sheets không tự đổi kiểu dữ liệu. */
function appendObjects_(name, objects) {
  if (!objects || !objects.length) return;
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var rows = objects.map(function (o) {
    return headers.map(function (h) { return toCell_(o[h]); });
  });
  var start = sheet.getLastRow() + 1;
  ensureCapacity_(sheet, start + rows.length - 1);
  var range = sheet.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

/**
 * Cập nhật các cột thay đổi của một dòng. Chỉ ghi cột thuộc schema hệ thống, gộp các cột liền kề
 * thành ít lần setValues nhất; không đụng tới cột do quản trị viên tự thêm.
 */
function updateRowFields_(name, rowIndex, record, changes) {
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var known = {};
  (HEADERS[name] || []).forEach(function (h) { known[h] = true; });
  var changedCols = [];
  Object.keys(changes).forEach(function (key) {
    var idx = headers.indexOf(key);
    if (idx >= 0 && known[key]) changedCols.push(idx);
  });
  if (!changedCols.length) return;
  changedCols.sort(function (a, b) { return a - b; });
  var merged = Object.assign({}, record, changes);
  var i = 0;
  while (i < changedCols.length) {
    var start = changedCols[i];
    var end = start;
    // Mở rộng đoạn qua các cột schema liền kề (giữ nguyên giá trị cũ) để giảm số lần ghi.
    while (i + 1 < changedCols.length) {
      var next = changedCols[i + 1];
      var bridgeable = true;
      for (var c = end + 1; c < next; c++) {
        if (!known[headers[c]]) { bridgeable = false; break; }
      }
      if (!bridgeable) break;
      end = next;
      i++;
    }
    var values = [];
    for (var col = start; col <= end; col++) values.push(toCell_(merged[headers[col]]));
    var range = sheet.getRange(rowIndex, start + 1, 1, values.length);
    range.setNumberFormat('@');
    range.setValues([values]);
    i++;
  }
}

/** Xóa các dòng theo số thứ tự (từ dưới lên, gộp đoạn liên tiếp). */
function deleteRowNumbers_(name, rowNumbers) {
  if (!rowNumbers || !rowNumbers.length) return;
  var sheet = getSheet_(name);
  var sorted = rowNumbers.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < sorted.length) {
    var end = sorted[i];
    var start = end;
    while (i + 1 < sorted.length && sorted[i + 1] === start - 1) {
      start = sorted[i + 1];
      i++;
    }
    sheet.deleteRows(start, end - start + 1);
    i++;
  }
}
