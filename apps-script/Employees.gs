/**
 * Employees.gs — danh sách nhân viên (sheet NHAN_VIEN) + loại bàn giao (sheet LOAI_BAN_GIAO)
 * + cấu hình hiển thị (sheet CAU_HINH) + phạm vi định mức VPP của phòng ban. Có cache (CacheService) — làm mới bằng:
 *   • sửa trực tiếp Sheet (onEdit tự xóa cache nếu script gắn với Sheet),
 *   • menu "DTA Handover → Làm mới cache", hàm refreshCaches(),
 *   • nút "Làm mới dữ liệu" trên trang quản trị,
 *   • hoặc tự hết hạn sau 10 phút.
 */

var CACHE_KEYS = {
  EMPLOYEES: 'employees:v1',
  CATEGORIES: 'categories:v2',
  SETTINGS: 'settings:v1',
  VPP_CATALOG: 'vpp-catalog:v1'
};

function invalidateCaches_() {
  cacheRemove_(CACHE_KEYS.EMPLOYEES);
  cacheRemove_(CACHE_KEYS.CATEGORIES);
  cacheRemove_(CACHE_KEYS.SETTINGS);
  cacheRemove_(CACHE_KEYS.VPP_CATALOG);
}

// ============================================================================
// Nhân viên
// ============================================================================

/** Danh sách nhân viên cho trang quản trị (không công khai). includeInactive = cả nhân viên đã nghỉ. */
function apiAdminListEmployees_(data) {
  var includeInactive = data && data.includeInactive === true;
  var scopes = includeInactive ? listNormScopes_() : null;
  return {
    employees: getEmployees_()
      .filter(function (e) { return includeInactive || e.status === 'ACTIVE'; })
      .map(function (e) {
        var out = { employeeId: e.employeeId, fullName: e.fullName, department: e.department, position: e.position, email: e.email };
        if (includeInactive) {
          out.status = e.status;
          var scope = resolveDepartmentScope_(e.department, scopes);
          out.vppScope = scope ? { scopeId: scope.scopeId, scopeName: scope.scopeName, source: scope.source } : null;
        }
        return out;
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

/** Loại đang dùng (trang tạo / sửa phiếu của admin). */
function apiAdminListCategories_() {
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

/** Loại phiếu của một loại nội dung: cột handover_type → mặc định theo mã → OTHER. */
function categoryHandoverType_(code, value) {
  var v = String(value || '').trim().toUpperCase();
  if (HANDOVER_TYPES[v]) return v;
  return DEFAULT_CATEGORY_TYPES[code] || 'OTHER';
}

function categoryFromRow_(r) {
  var status = String(r.status || '').trim().toUpperCase();
  var code = String(r.code || '').trim().toUpperCase();
  return {
    code: code,
    name: truncate_(cleanLine_(r.name), 80),
    fields: parseFormFields_(r.form_fields),
    hint: truncate_(cleanText_(r.hint), 500),
    sortOrder: parseInt(r.sort_order, 10) || 999,
    active: status === '' || status === 'ACTIVE',
    handoverType: categoryHandoverType_(code, r.handover_type)
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

/** Ghi / cập nhật một khóa trong CAU_HINH (theo khóa, không theo số dòng). */
function upsertSetting_(key, value, description) {
  var now = nowIso_();
  var found = findRow_(SHEETS.SETTINGS, 'key', key);
  if (found) {
    updateRowFields_(SHEETS.SETTINGS, found.rowIndex, found.record, { value: value, description: description, updated_at: now });
  } else {
    appendObjects_(SHEETS.SETTINGS, [{ key: key, value: value, description: description, updated_at: now }]);
  }
  cacheRemove_(CACHE_KEYS.SETTINGS);
}

// ============================================================================
// Phạm vi định mức VPP của phòng ban
//   • Phạm vi (scope) = nhóm định mức trong VPP_DINH_MUC (ví dụ KINH_DOANH "PHÒNG KINH DOANH", VAN_PHONG "VĂN PHÒNG").
//   • Phòng ban của nhân viên → phạm vi:
//       1) khóa CAU_HINH "VPP_SCOPE:<PHONG_BAN>" = <scope_id> (admin gắn trên trang Định mức; "NONE" = không áp dụng);
//       2) nếu chưa gắn: tên phòng ban trùng khớp tên phạm vi (bỏ dấu, bỏ chữ "phòng" ở đầu).
//     Không tự đoán theo tên gần giống — phòng ban chưa khớp hiện trong "Dữ liệu cần kiểm tra".
// ============================================================================

var SCOPE_SETTING_PREFIX = 'VPP_SCOPE:';

function scopeSettingKey_(department) {
  return SCOPE_SETTING_PREFIX + slugKey_(department, 80);
}

/** Phòng ban đã được quản trị viên chọn "Không áp dụng định mức" (khác với "chưa gắn"). */
function isDepartmentExcludedFromNorms_(department, settings) {
  var dept = cleanLine_(department);
  if (!dept) return false;
  return String((settings || getSettings_())[scopeSettingKey_(dept)] || '').trim().toUpperCase() === 'NONE';
}

/** Bỏ chữ "phòng" ở đầu để "PHÒNG KINH DOANH" khớp "Kinh doanh". */
function scopeMatchKey_(value) {
  return matchKey_(value).replace(/^phong /, '');
}

/** Các phạm vi định mức đang có (từ VPP_DINH_MUC). Trả về [] nếu chưa có sheet. */
function listNormScopes_() {
  var map = {};
  try {
    readTable_(SHEETS.VPP_NORMS).rows.forEach(function (r) {
      var id = String(r.scope_id || '').trim().toUpperCase();
      if (!id || map[id]) return;
      map[id] = { scopeId: id, scopeName: cleanLine_(r.scope_name) || id };
    });
  } catch (e) {
    if (!e.appCode) throw e;
  }
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

function resolveDepartmentScope_(department, scopes) {
  var dept = cleanLine_(department);
  if (!dept) return null;
  scopes = scopes || listNormScopes_();
  var byId = {};
  scopes.forEach(function (s) { byId[s.scopeId] = s; });
  var mapped = String(getSettings_()[scopeSettingKey_(dept)] || '').trim().toUpperCase();
  if (mapped === 'NONE') return null;
  if (mapped && byId[mapped]) return { scopeId: mapped, scopeName: byId[mapped].scopeName, source: 'MAPPING' };
  var key = scopeMatchKey_(dept);
  for (var i = 0; i < scopes.length; i++) {
    var s = scopes[i];
    if (key && (key === scopeMatchKey_(s.scopeName) || key === scopeMatchKey_(s.scopeId.replace(/_/g, ' ')))) {
      return { scopeId: s.scopeId, scopeName: s.scopeName, source: 'AUTO' };
    }
  }
  return null;
}
