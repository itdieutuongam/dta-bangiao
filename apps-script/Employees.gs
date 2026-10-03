/**
 * Employees.gs — danh sách nhân viên (sheet NHAN_VIEN) + loại bàn giao (sheet LOAI_BAN_GIAO)
 * + cấu hình hiển thị (sheet CAU_HINH). Có cache (CacheService) — làm mới bằng:
 *   • sửa trực tiếp Sheet (onEdit tự xóa cache nếu script gắn với Sheet),
 *   • menu "DTA Handover → Làm mới cache", hàm refreshCaches(),
 *   • nút "Làm mới dữ liệu" trên trang quản trị,
 *   • hoặc tự hết hạn sau 10 phút.
 */

var CACHE_KEYS = {
  EMPLOYEES: 'employees:v1',
  CATEGORIES: 'categories:v1',
  SETTINGS: 'settings:v1'
};

function invalidateCaches_() {
  cacheRemove_(CACHE_KEYS.EMPLOYEES);
  cacheRemove_(CACHE_KEYS.CATEGORIES);
  cacheRemove_(CACHE_KEYS.SETTINGS);
}

// ============================================================================
// Nhân viên
// ============================================================================

function apiListEmployees_() {
  return {
    employees: getEmployees_()
      .filter(function (e) { return e.status === 'ACTIVE'; })
      .map(function (e) {
        return { employeeId: e.employeeId, fullName: e.fullName, department: e.department, position: e.position, email: e.email };
      })
  };
}

/** status: để trống hoặc ACTIVE = đang làm việc; giá trị khác (INACTIVE…) = ngừng hoạt động. */
function normalizeEmployeeStatus_(value) {
  var v = String(value || '').trim().toUpperCase();
  return v === '' || v === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
}

function loadEmployeesFromSheet_() {
  var rows = readTable_(SHEETS.EMPLOYEES).rows;
  var seen = {};
  var list = [];
  rows.forEach(function (r) {
    var id = truncate_(cleanLine_(r.employee_id), LIMITS.EMPLOYEE_ID);
    var name = truncate_(cleanLine_(r.full_name), LIMITS.PERSON_NAME);
    if (!id || !name) return;
    var key = id.toUpperCase();
    if (seen[key]) return; // trùng mã: lấy dòng đầu tiên
    seen[key] = true;
    list.push({
      employeeId: id,
      fullName: name,
      department: truncate_(cleanLine_(r.department), 120),
      position: truncate_(cleanLine_(r.position), 120),
      email: truncate_(cleanLine_(r.email), 200).toLowerCase(),
      status: normalizeEmployeeStatus_(r.status)
    });
  });
  list.sort(function (a, b) { return compareVi_(a.fullName, b.fullName); });
  return list;
}

function getEmployees_() {
  var cached = cacheGetJson_(CACHE_KEYS.EMPLOYEES);
  if (cached) return cached;
  var list = loadEmployeesFromSheet_();
  cachePutJson_(CACHE_KEYS.EMPLOYEES, list, APP.CACHE_TTL_SECONDS);
  return list;
}

function findEmployeeInList_(list, id) {
  var key = String(id || '').trim().toUpperCase();
  if (!key) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].employeeId.toUpperCase() === key) return list[i];
  }
  return null;
}

/** Tìm nhân viên theo mã; nếu không có trong cache thì đọc lại Sheet (nhân viên vừa thêm). */
function findEmployeeById_(id) {
  var found = findEmployeeInList_(getEmployees_(), id);
  if (found) return found;
  var fresh = loadEmployeesFromSheet_();
  cachePutJson_(CACHE_KEYS.EMPLOYEES, fresh, APP.CACHE_TTL_SECONDS);
  return findEmployeeInList_(fresh, id);
}

// ============================================================================
// Loại bàn giao
// ============================================================================

function apiListCategories_() {
  return { categories: getCategories_().filter(function (c) { return c.active; }) };
}

var ITEM_FIELD_LOOKUP_ = null;

function itemFieldLookup_() {
  if (ITEM_FIELD_LOOKUP_) return ITEM_FIELD_LOOKUP_;
  var map = {};
  ITEM_FIELDS.forEach(function (f) {
    map[f.column.toLowerCase()] = f;
    map[f.key.toLowerCase()] = f;
  });
  ITEM_FIELD_LOOKUP_ = map;
  return map;
}

/**
 * "item_name*:Tên thiết bị|serial_number:Serial" →
 * [{ key:'itemName', label:'Tên thiết bị', required:true }, { key:'serialNumber', ... }]
 */
function parseFormFields_(spec) {
  var lookup = itemFieldLookup_();
  var out = [];
  var seen = {};
  String(spec || '').split('|').forEach(function (part) {
    var p = part.trim();
    if (!p) return;
    var idx = p.indexOf(':');
    var keyPart = (idx >= 0 ? p.slice(0, idx) : p).trim();
    var label = idx >= 0 ? cleanLine_(p.slice(idx + 1)) : '';
    var required = /\*$/.test(keyPart);
    keyPart = keyPart.replace(/\*$/, '').trim().toLowerCase();
    var field = lookup[keyPart];
    if (!field || seen[field.key]) return;
    seen[field.key] = true;
    out.push({ key: field.key, label: truncate_(label || field.label, 80), required: required });
  });
  if (!out.length) {
    out = [
      { key: 'itemName', label: 'Tên', required: true },
      { key: 'description', label: 'Mô tả', required: false },
      { key: 'note', label: 'Ghi chú', required: false }
    ];
  }
  return out;
}

function categoryFromRow_(r) {
  var status = String(r.status || '').trim().toUpperCase();
  return {
    code: String(r.code || '').trim().toUpperCase(),
    name: truncate_(cleanLine_(r.name), 80),
    fields: parseFormFields_(r.form_fields),
    hint: truncate_(cleanText_(r.hint), 500),
    sortOrder: parseInt(r.sort_order, 10) || 999,
    active: status === '' || status === 'ACTIVE'
  };
}

function loadCategoriesFromSheet_() {
  var rows = readTable_(SHEETS.CATEGORIES).rows;
  var seen = {};
  var list = [];
  rows.forEach(function (r) {
    var c = categoryFromRow_(r);
    if (!/^[A-Z0-9_]{1,40}$/.test(c.code) || !c.name || seen[c.code]) return;
    seen[c.code] = true;
    list.push(c);
  });
  if (!list.length) list = DEFAULT_CATEGORIES.map(categoryFromRow_);
  list.sort(function (a, b) { return a.sortOrder - b.sortOrder || compareVi_(a.name, b.name); });
  return list;
}

/** Tất cả loại (kể cả ngừng dùng) — để hiển thị đúng nhãn cho biên bản cũ. */
function getCategories_() {
  var cached = cacheGetJson_(CACHE_KEYS.CATEGORIES);
  if (cached) return cached;
  var list = loadCategoriesFromSheet_();
  cachePutJson_(CACHE_KEYS.CATEGORIES, list, APP.CACHE_TTL_SECONDS);
  return list;
}

function getCategoryMap_() {
  var map = {};
  getCategories_().forEach(function (c) { map[c.code] = c; });
  return map;
}

// ============================================================================
// Cấu hình hiển thị (sheet CAU_HINH)
// ============================================================================

function getSettings_() {
  var cached = cacheGetJson_(CACHE_KEYS.SETTINGS);
  if (cached) return cached;
  var settings = {};
  DEFAULT_SETTINGS.forEach(function (s) { settings[s.key] = s.value; });
  try {
    readTable_(SHEETS.SETTINGS).rows.forEach(function (r) {
      var key = cleanLine_(r.key).toUpperCase();
      if (key) settings[key] = cleanText_(r.value);
    });
  } catch (e) {
    if (!e.appCode) throw e;
  }
  cachePutJson_(CACHE_KEYS.SETTINGS, settings, APP.CACHE_TTL_SECONDS);
  return settings;
}
