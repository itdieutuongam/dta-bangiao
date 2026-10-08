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

/** "YYYY-MM" (giờ Việt Nam) của một mốc ISO; trống → tháng hiện tại. */
function monthKey_(iso) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (m) return m[1] + '-' + m[2];
  return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM');
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

/**
 * Bỏ ký tự điều khiển (giữ xuống dòng / tab), ký tự điều khiển C1, ký tự định hướng chữ (bidi: override / isolate / mark, kể cả
 * Arabic Letter Mark U+061C) và ký tự vô hình (zero-width, soft hyphen, combining grapheme joiner, ký tự đệm Hangul, ký tự "tag"
 * U+E0000–E007F) — các ký tự này có thể dùng để giả mạo cách hiển thị tên / nội dung. Khớp stripControlChars (shared/text.ts).
 */
function stripControl_(value) {
  // eslint-disable-next-line no-control-regex
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g, '')
    .replace(/\uDB40[\uDC00-\uDC7F]/g, '');
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
    s = s.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
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

/** Khóa so khớp: bỏ dấu, chỉ giữ chữ + số, phân tách bằng 1 khoảng trắng ("Bút bi 027, xanh" → "but bi 027 xanh"). */
function matchKey_(value) {
  return normalizeText_(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Khóa so khớp tên GIỮ DẤU tiếng Việt — chỉ bỏ khác biệt hoa / thường, khoảng trắng và dạng Unicode (NFC / NFD):
 * "Kéo" ≠ "Kẹo" ≠ "Keo". Dùng khi tự gắn tên do người dùng gõ vào sản phẩm có sẵn (không được gắn nhầm).
 */
function exactNameKey_(value) {
  var s = String(value === null || value === undefined ? '' : value);
  if (typeof s.normalize === 'function') s = s.normalize('NFC');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Mã định danh dạng A-Z0-9_ từ một tên ("Phòng Kinh doanh" → "PHONG_KINH_DOANH"). */
function slugKey_(value, max) {
  return matchKey_(value).toUpperCase().replace(/ /g, '_').slice(0, max || 60);
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

/**
 * ID dạng UUID suy ra cố định từ một chuỗi (SHA-256, đặt bit phiên bản 5 / variant RFC 4122): cùng chuỗi → cùng ID.
 * Dùng cho thao tác nhiều bước có mã thao tác của trình duyệt — gửi lại sau lỗi giữa chừng thì nhận ra dòng đã ghi, không tạo trùng.
 */
function uuidFrom_(seed) {
  var h = sha256Hex_('dta-id:' + seed);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-' +
    ((parseInt(h.charAt(16), 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
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

/**
 * Số trong ô Sheet. Cột dữ liệu định dạng văn bản ('@') nên Sheets KHÔNG tự đọc cách gõ kiểu Việt Nam — đọc ở đây:
 *   số hệ thống ghi: "1500", "12.5", "-3" · gõ tay kiểu Việt: "1.500", "1.500.000", "12,5", "1.500,5" · kiểu Anh nhiều nhóm: "1,500,000".
 * Một dấu chấm + đúng 3 chữ số ("55.600") là hàng nghìn kiểu Việt (hệ thống không bao giờ ghi đơn giá 3 chữ số lẻ — roundPrice_).
 * Cách viết hiểu được hai nghĩa ("1,500") hoặc không phải số → NaN. Trống → null.
 * Trước đây "55.600" đọc thành 55,6, "1.000" thành 1, "1,5" thành 15.
 */
function parseSheetNumber_(value) {
  var s = String(value === null || value === undefined ? '' : value).replace(/\s/g, '');
  if (s === '') return null;
  var m;
  if (/^-?\d{1,3}\.\d{3}$/.test(s)) return Number(s.replace('.', ''));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((m = /^(-?\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(s))) return Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
  if ((m = /^(-?\d+),(\d+)$/.exec(s))) return m[2].length === 3 ? NaN : Number(m[1] + '.' + m[2]);
  if (/^-?\d{1,3}(?:,\d{3}){2,}$/.test(s)) return Number(s.replace(/,/g, ''));
  return NaN;
}

/** Số nguyên từ ô Sheet; ô trống / không phải số nguyên ("1,5", "abc") → null. */
function toIntOrNull_(value) {
  var n = parseSheetNumber_(value);
  return n === null || !isFinite(n) || Math.floor(n) !== n ? null : n;
}

/** Số (có thể thập phân) từ ô Sheet; trống / không hợp lệ → null. */
function toNumberOrNull_(value) {
  var n = parseSheetNumber_(value);
  return n === null || !isFinite(n) ? null : n;
}

/** Đơn giá trước khi ghi: tối đa 2 chữ số lẻ — ô Sheet không bao giờ có dạng "12.345" (đọc lại thành 12345, xem parseSheetNumber_). */
function roundPrice_(value) {
  return value === null || value === undefined ? value : Math.round(Number(value) * 100) / 100;
}

function toBool_(value) {
  var s = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'X';
}

function boolCell_(flag) {
  return flag ? 'TRUE' : 'FALSE';
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
// LockService — tuần tự hóa các thao tác ghi quan trọng (sinh mã, tạo, xác nhận, đổi trạng thái, kho)
// ============================================================================

var LOCK_DEPTH_ = 0;

function withScriptLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn(); // đã giữ khóa trong cùng execution
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) {
    throw appError_('LOCK_TIMEOUT', 'Hệ thống đang bận, vui lòng thử lại sau ít giây.');
  }
  LOCK_DEPTH_++;
  var result;
  try {
    result = fn();
  } catch (e) {
    LOCK_DEPTH_--;
    // Thao tác đã lỗi: vẫn đẩy phần đã ghi rồi nhả khóa. Lỗi flush lúc này chỉ ghi log — lỗi gốc mới là lỗi cần báo.
    try {
      SpreadsheetApp.flush();
    } catch (flushError) {
      logError_('withScriptLock_.flush_after_error', flushError);
    }
    lock.releaseLock();
    throw e;
  }
  LOCK_DEPTH_--;
  try {
    // Ghi xong trước khi nhả khóa cho request khác. Lỗi ở bước này = dữ liệu có thể chưa được lưu → báo lỗi cho người gọi,
    // không trả "thành công".
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return result;
}

function requireLock_(context) {
  if (LOCK_DEPTH_ < 1) throw appError_('INTERNAL', context + ' phải chạy trong khóa.');
}

// ============================================================================
// Bước phụ sau khi thao tác chính đã ghi xong (ghi lịch sử…)
// ============================================================================

var POST_COMMIT_ERROR_DAYS_ = 7;

/**
 * Chạy bước phụ SAU KHI thao tác chính đã lưu (trạng thái đã ghi). Lỗi ở đây KHÔNG biến thao tác đã lưu thành "lỗi"
 * (người dùng bấm lại sẽ gặp lỗi trạng thái và tưởng chưa lưu) — nhưng luôn được ghi log + lưu vào Script Property
 * POST_COMMIT_ERRORS và hiện trên trang Cài đặt của quản trị viên (không im lặng). Trả về true nếu bước phụ chạy xong.
 */
function afterCommit_(context, ref, fn) {
  try {
    fn();
    return true;
  } catch (e) {
    recordPostCommitError_(context, ref, e);
    return false;
  }
}

function readPostCommitErrors_() {
  var raw = getProp_(PROP.POST_COMMIT_ERRORS);
  if (!raw) return [];
  var list;
  try {
    list = JSON.parse(raw);
  } catch (e) {
    logError_('post_commit.corrupt', e); // ghi đè bằng danh sách mới ở lần lỗi tiếp theo
    return [];
  }
  var since = Date.now() - POST_COMMIT_ERROR_DAYS_ * 24 * 3600 * 1000;
  return (Array.isArray(list) ? list : []).filter(function (x) {
    return x && x.at && new Date(x.at).getTime() >= since;
  });
}

function recordPostCommitError_(context, ref, err) {
  logError_('after_commit.' + context, err);
  try {
    var list = readPostCommitErrors_();
    list.unshift({
      at: nowIso_(), context: context, ref: String(ref || ''),
      message: truncate_(String(err && err.message ? err.message : err), 300)
    });
    setProp_(PROP.POST_COMMIT_ERRORS, JSON.stringify(list.slice(0, 20)));
  } catch (e2) {
    logError_('post_commit.record_failed', e2); // đã có log của lỗi gốc ở trên
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

/** Số cột (1-based) → ký hiệu A1 ("A", "Z", "AA"…). */
function columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
 * Đọc một số cột của sheet (mỗi cột 1 lần getValues) → mảng object { cột: giá trị, _row }.
 * Dùng cho sheet lớn khi chỉ cần vài cột (tránh đọc cả bảng). Cột chưa có trong sheet → ''.
 */
function readColumns_(name, columns) {
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = {};
  columns.forEach(function (c) {
    var idx = headers.indexOf(c);
    data[c] = idx < 0
      ? null
      : sheet.getRange(2, idx + 1, lastRow - 1, 1).getValues().map(function (r) { return cellToString_(r[0]); });
  });
  var out = [];
  for (var i = 0; i < lastRow - 1; i++) {
    var obj = { _row: i + 2 };
    var empty = true;
    columns.forEach(function (c) {
      var v = data[c] ? data[c][i] : '';
      obj[c] = v;
      if (v !== '') empty = false;
    });
    if (!empty) out.push(obj);
  }
  return out;
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
  return readRowsAt_(sheet, headers, (cells || []).map(function (c) { return c.getRow(); }), function (record) {
    return record[column] === String(value);
  });
}

/** Tìm các dòng có column BẮT ĐẦU bằng prefix (TextFinder không khớp toàn ô). */
function findRowsByPrefix_(name, column, prefix) {
  if (!prefix) return [];
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  if (headers.indexOf(column) < 0) return [];
  var col = columnIndex_(sheet, column);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var cells = sheet.getRange(2, col, lastRow - 1, 1)
    .createTextFinder(String(prefix))
    .matchCase(true)
    .findAll();
  return readRowsAt_(sheet, headers, (cells || []).map(function (c) { return c.getRow(); }), function (record) {
    return String(record[column]).indexOf(String(prefix)) === 0;
  });
}

function readRowsAt_(sheet, headers, rowNumbers, predicate) {
  if (!rowNumbers.length) return [];
  rowNumbers = rowNumbers.slice().sort(function (a, b) { return a - b; });
  var first = rowNumbers[0];
  var last = rowNumbers[rowNumbers.length - 1];
  var results = [];
  var pushIfMatch = function (rowIndex, values) {
    var record = rowToObject_(headers, values);
    if (predicate(record)) results.push({ rowIndex: rowIndex, record: record });
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

/** Cột thuộc schema hệ thống (HEADERS) nhưng sheet chưa có → lỗi rõ ràng, không âm thầm bỏ giá trị. */
function missingSchemaColumnError_(name, column) {
  return appError_('NOT_CONFIGURED', 'Sheet "' + name + '" thiếu cột "' + column + '". Chủ sở hữu Google Sheet hãy chạy menu ' +
    '"DTA Handover → Thiết lập / cập nhật database".');
}

/** Ghi thêm nhiều dòng (1 lần setValues). Định dạng văn bản để Sheets không tự đổi kiểu dữ liệu. */
function appendObjects_(name, objects) {
  if (!objects || !objects.length) return;
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  (HEADERS[name] || []).forEach(function (h) {
    if (headers.indexOf(h) >= 0) return;
    var hasValue = objects.some(function (o) { return o[h] !== undefined && o[h] !== null && o[h] !== ''; });
    if (hasValue) throw missingSchemaColumnError_(name, h);
  });
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
 * Xác định lại số dòng ngay trước khi ghi: nếu ô định danh ở rowIndex không còn khớp (có người sắp xếp / chèn /
 * xóa dòng trong lúc đang xử lý) → tìm lại theo ID. Không tìm thấy → CONFLICT (không ghi nhầm dòng khác).
 */
function verifiedRowIndex_(name, sheet, rowIndex, record) {
  var idColumn = ROW_ID_COLUMNS[name];
  if (!idColumn || !record || !record[idColumn]) return rowIndex;
  var current = cellToString_(sheet.getRange(rowIndex, columnIndex_(sheet, idColumn)).getValue());
  if (current === String(record[idColumn])) return rowIndex;
  var found = findRow_(name, idColumn, record[idColumn]);
  if (!found) {
    throw appError_('CONFLICT', 'Dữ liệu vừa bị thay đổi trên Google Sheet (không tìm thấy dòng cần cập nhật). Vui lòng thử lại.');
  }
  logInfo_('row.relocated', { sheet: name, from: rowIndex, to: found.rowIndex });
  return found.rowIndex;
}

/**
 * Cập nhật các cột thay đổi của một dòng:
 *   • chỉ ghi cột thuộc schema hệ thống, không đụng cột do quản trị viên tự thêm;
 *   • chỉ ghi các ô thực sự thay đổi (gộp các cột thay đổi liền kề) — không ghi đè ô khác bằng giá trị cũ;
 *   • xác minh ô định danh trước khi ghi (verifiedRowIndex_) để không ghi nhầm dòng khi sheet bị sắp xếp;
 *   • cột "chốt" ghi SAU CÙNG (COMMIT_COLUMN_RANK_): lỗi giữa chừng không để lại trạng thái mới đi kèm dữ liệu cũ
 *     (ví dụ CONFIRMED mà chưa có chữ ký; hash link mới khi nonce chưa ghi → link không khôi phục được); khi sửa phiếu, phiên
 *     bản nội dung (items_revision) + xóa dấu "đang sửa" (edit_pending, cột liền kề → cùng một lần ghi) là bước sau cùng.
 * Trả về số dòng thực tế đã ghi.
 */
var COMMIT_COLUMN_RANK_ = { public_token_hash: 1, status: 2, catalog_status: 2, items_revision: 3, edit_pending: 4 };

function updateRowFields_(name, rowIndex, record, changes) {
  var sheet = getSheet_(name);
  var headers = getHeaders_(sheet);
  var known = {};
  (HEADERS[name] || []).forEach(function (h) { known[h] = true; });
  var changedCols = [];
  Object.keys(changes).forEach(function (key) {
    if (!known[key]) return; // không phải cột hệ thống (ví dụ trường tạm _row) — không ghi
    var idx = headers.indexOf(key);
    if (idx < 0) throw missingSchemaColumnError_(name, key);
    changedCols.push(idx);
  });
  if (!changedCols.length) return rowIndex;
  changedCols.sort(function (a, b) { return a - b; });
  var targetRow = verifiedRowIndex_(name, sheet, rowIndex, record);
  var blocks = [];
  var i = 0;
  while (i < changedCols.length) {
    var start = changedCols[i];
    var end = start;
    while (i + 1 < changedCols.length && changedCols[i + 1] === end + 1) {
      end = changedCols[i + 1];
      i++;
    }
    var rank = 0;
    for (var c = start; c <= end; c++) rank = Math.max(rank, COMMIT_COLUMN_RANK_[headers[c]] || 0);
    blocks.push({ start: start, end: end, rank: rank });
    i++;
  }
  blocks.sort(function (a, b) { return a.rank - b.rank || a.start - b.start; });
  blocks.forEach(function (b) {
    var values = [];
    for (var col = b.start; col <= b.end; col++) values.push(toCell_(changes[headers[col]]));
    var range = sheet.getRange(targetRow, b.start + 1, 1, values.length);
    range.setNumberFormat('@');
    range.setValues([values]);
  });
  return targetRow;
}

/**
 * Ghi cùng một giá trị vào cột `column` cho các dòng có ID trong `ids` (ví dụ đánh dấu superseded_at).
 * Tìm lại dòng theo ID ngay trước khi ghi (không dùng số dòng cũ); ghi bằng 1 lần RangeList.
 * Trả về số dòng đã ghi.
 */
function setColumnForIds_(name, column, ids, value) {
  if (!ids || !ids.length) return 0;
  var sheet = getSheet_(name);
  var idColumn = ROW_ID_COLUMNS[name];
  var idCol = columnIndex_(sheet, idColumn);
  var targetCol = columnIndex_(sheet, column);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var wanted = {};
  ids.forEach(function (id) { wanted[String(id)] = true; });
  var idValues = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var notations = [];
  for (var i = 0; i < idValues.length; i++) {
    if (wanted[cellToString_(idValues[i][0])]) notations.push(columnLetter_(targetCol) + (i + 2));
  }
  if (!notations.length) return 0;
  var list = sheet.getRangeList(notations);
  list.setNumberFormat('@');
  list.setValue(toCell_(value));
  return notations.length;
}

/**
 * Xóa các dòng thỏa điều kiện theo GIÁ TRỊ (không theo số dòng đã lưu trước đó): đọc lại cột rồi xóa từ dưới lên.
 * Chỉ dùng cho dữ liệu phụ (ví dụ nhân viên mẫu DEMO-) — dữ liệu nghiệp vụ không bao giờ bị xóa.
 */
function deleteRowsWhere_(name, column, predicate) {
  var sheet = getSheet_(name);
  var values = readColumn_(sheet, column);
  var rows = [];
  values.forEach(function (v, i) { if (predicate(v)) rows.push(i + 2); });
  rows.sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i];
    var start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) {
      start = rows[i + 1];
      i++;
    }
    sheet.deleteRows(start, end - start + 1);
    i++;
  }
  return rows.length;
}
