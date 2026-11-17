/**
 * UniformSetup.gs — nâng cấp cơ sở dữ liệu lên v3 (module Đồng phục) + dữ liệu khởi tạo + sửa cột định danh bị đổi tên.
 *
 *   upgradeUniformModule()   Idempotent: sao lưu (nếu có thay đổi cấu trúc và đã có dữ liệu) → thêm sheet DP_* / cột còn thiếu
 *                            (NHAN_VIEN.gender, uniform_size; CHI_TIET_BAN_GIAO.size, issue_kind) → thêm loại "Đồng phục" →
 *                            sửa cột định danh bị đổi tên → SCHEMA_VERSION = 3. Không xóa, không ghi đè dữ liệu.
 *   seedUniformCatalog()     Danh mục mẫu từ "DS đồng phục 2023 / 2024" của P.HCNS (7 mẫu, size S–XXL). Chạy lại không tạo trùng;
 *                            không có tồn kho — nhập "Tồn đầu kỳ" trên trang Tồn kho sau khi đếm thực tế.
 *   repairIdColumns()        Sửa sheet có cột định danh (UUID) bị đổi tên / bị thay bằng cột trống (sự cố VPP_DINH_MUC 10/2026).
 */

/** Thêm loại "Đồng phục" vào LOAI_BAN_GIAO nếu thiếu (không ghi đè dòng đã có). */
function ensureUniformCategory_() {
  var exists = readTable_(SHEETS.CATEGORIES).rows.some(function (r) {
    return String(r.code || '').trim().toUpperCase() === UNIFORM_CATEGORY_CODE;
  });
  if (exists) return 'LOAI_BAN_GIAO: đã có loại "Đồng phục"';
  var def = DEFAULT_CATEGORIES.filter(function (c) { return c.code === UNIFORM_CATEGORY_CODE; })[0];
  var now = nowIso_();
  appendObjects_(SHEETS.CATEGORIES, [{
    code: def.code, name: def.name, form_fields: def.form_fields, hint: def.hint, sort_order: def.sort_order, status: 'ACTIVE',
    created_at: now, updated_at: now, handover_type: def.handover_type
  }]);
  return 'LOAI_BAN_GIAO: thêm loại "Đồng phục"';
}

// ============================================================================
// Cột định danh (UUID) bị đổi tên / bị thay bằng cột trống
// ============================================================================

/** Giá trị các ô dữ liệu (không gồm tiêu đề) của một cột 1-based. */
function columnValues_(sheet, col) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, col, lastRow - 1, 1).getValues().map(function (r) { return cellToString_(r[0]); });
}

/** Chỉ số (0-based) các dòng dữ liệu không trống của sheet. */
function dataRowFlags_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues().map(function (row) { return !isEmptyRow_(row); });
}

/**
 * Cột KHÔNG thuộc schema mà mọi dòng dữ liệu đều có UUID (ứng viên cho cột định danh bị đổi tên). Trả về [{ index, header, values }].
 */
function uuidCandidateColumns_(sheet, schema, flags) {
  var headers = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  var out = [];
  headers.forEach(function (h, i) {
    if (schema.indexOf(h) >= 0) return;
    var values = columnValues_(sheet, i + 1);
    var ok = flags.length > 0 && flags.every(function (isData, r) { return !isData || isUuid_(values[r]); });
    if (ok) out.push({ index: i, header: h, values: values });
  });
  return out;
}

/**
 * Trước khi ensureSheet_ thêm cột: cột định danh (UUID) của sheet đang có dữ liệu mà KHÔNG thấy tiêu đề → nếu đúng MỘT cột lạ có
 * UUID ở mọi dòng dữ liệu (tiêu đề bị gõ đè, ví dụ "norm_id" → "m") thì đổi tiêu đề cột đó về lại tên đúng — không thêm cột định
 * danh mới trống (trước đây làm mọi dòng bị bỏ qua âm thầm). Trả về thông báo ('' = không làm gì).
 */
function restoreRenamedIdHeader_(sheet, name) {
  var idColumn = ROW_ID_COLUMNS[name];
  if (!idColumn || UUID_ID_SHEETS.indexOf(name) < 0 || sheet.getLastRow() < 2) return '';
  var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.indexOf(idColumn) >= 0) return '';
  var flags = dataRowFlags_(sheet);
  var candidates = uuidCandidateColumns_(sheet, HEADERS[name], flags);
  if (candidates.length !== 1) {
    return '⚠ ' + name + ': thiếu cột định danh "' + idColumn + '" trong khi sheet đã có dữ liệu' +
      (candidates.length ? ' (có ' + candidates.length + ' cột chứa mã — không tự chọn)' : '') + ' — hãy đổi lại tiêu đề cột đúng tên rồi chạy lại.';
  }
  sheet.getRange(1, candidates[0].index + 1).setValue(idColumn);
  resetHeaderCache_();
  return name + ': khôi phục tên cột định danh "' + candidates[0].header + '" → "' + idColumn + '" (tiêu đề bị gõ đè).';
}

/**
 * Các vấn đề cột định danh / tiêu đề (để hiện ở trang Cài đặt / Kiểm tra cấu hình): dòng dữ liệu có ID trống / không phải UUID,
 * tiêu đề cột hệ thống bị trùng tên.
 * Trả về mảng thông báo.
 */
function idColumnProblems_(ss) {
  var problems = [];
  UUID_ID_SHEETS.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var idColumn = ROW_ID_COLUMNS[name];
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = headers.indexOf(idColumn);
    if (col < 0) return; // thiếu cột → đã báo ở schemaChangesNeeded_
    var flags = dataRowFlags_(sheet);
    var values = columnValues_(sheet, col + 1);
    var bad = 0;
    flags.forEach(function (isData, r) { if (isData && !isUuid_(values[r])) bad++; });
    if (bad) {
      problems.push('Sheet ' + name + ': ' + bad + ' dòng có cột định danh "' + idColumn + '" trống / sai — các dòng này bị hệ thống bỏ qua. ' +
        'Chạy menu "DTA Handover → Sửa cột định danh bị đổi tên" (hoặc khôi phục từ lịch sử phiên bản của Sheet).');
    }
  });
  // Tiêu đề trùng tên với cột hệ thống (cột tự thêm "status", "email"…): hệ thống đọc / ghi cột ĐẦU TIÊN, cột sau bị bỏ qua.
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastColumn() < 1) return;
    var system = {};
    HEADERS[name].forEach(function (h) { system[h] = true; });
    var seen = {};
    var duplicated = [];
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function (raw) {
      var h = String(raw).trim();
      if (!h || !system[h]) return;
      if (seen[h] && duplicated.indexOf(h) < 0) duplicated.push(h);
      seen[h] = true;
    });
    if (duplicated.length) {
      problems.push('Sheet ' + name + ': tiêu đề cột bị trùng tên — "' + duplicated.join('", "') + '". Hệ thống chỉ dùng cột ĐẦU TIÊN; ' +
        'đổi tên hoặc xóa cột trùng (cột tự thêm) để tránh nhập nhầm dữ liệu vào cột bị bỏ qua.');
    }
  });
  return problems;
}

/**
 * Sửa trạng thái sau sự cố đổi tên tiêu đề: cột định danh có trên sheet nhưng TRỐNG ở mọi dòng dữ liệu, và đúng MỘT cột lạ (không thuộc
 * schema) có UUID ở mọi dòng → chép mã sang cột định danh (giữ nguyên cột lạ, không xóa gì). Trường hợp khác chỉ báo cáo.
 */
function repairIdColumns_(ss, report) {
  var fixed = 0;
  UUID_ID_SHEETS.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var idColumn = ROW_ID_COLUMNS[name];
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = headers.indexOf(idColumn);
    if (col < 0) return;
    var flags = dataRowFlags_(sheet);
    var values = columnValues_(sheet, col + 1);
    var allEmpty = flags.every(function (isData, r) { return !isData || values[r] === ''; });
    if (!allEmpty || !flags.some(function (x) { return x; })) return;
    var candidates = uuidCandidateColumns_(sheet, HEADERS[name], flags);
    if (candidates.length !== 1) {
      report.push('⚠ ' + name + ': cột "' + idColumn + '" trống ở mọi dòng nhưng không xác định được cột chứa mã (' + candidates.length +
        ' ứng viên) — sửa tay theo docs/DATABASE.md.');
      return;
    }
    var source = candidates[0];
    var rows = source.values.map(function (v, r) { return [flags[r] ? v : '']; });
    var range = sheet.getRange(2, col + 1, rows.length, 1);
    range.setNumberFormat('@');
    range.setValues(rows);
    fixed++;
    report.push(name + ': chép mã định danh từ cột "' + source.header + '" sang cột "' + idColumn + '" (' +
      flags.filter(function (x) { return x; }).length + ' dòng). Cột "' + source.header + '" giữ nguyên — có thể xóa sau khi kiểm tra.');
  });
  if (fixed) {
    resetHeaderCache_();
    invalidateCaches_();
  }
  return fixed;
}

/** Menu: sửa cột định danh bị đổi tên / bị thay bằng cột trống. */
function repairIdColumns() {
  var report = [];
  var ss = getSpreadsheet_();
  withScriptLock_(function () {
    ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (!HEADERS[name]) return;
      var msg = restoreRenamedIdHeader_(sheet, name);
      if (msg) report.push(msg);
    });
    repairIdColumns_(ss, report);
  });
  var remaining = idColumnProblems_(ss);
  var text = 'DTA Handover – Sửa cột định danh\n- ' + (report.length ? report.join('\n- ') : 'Không có cột nào cần sửa.') +
    (remaining.length ? '\n\nCòn lại:\n- ' + remaining.join('\n- ') : '');
  console.log(text);
  var ui = getUi_();
  if (ui) ui.alert('DTA Handover – Sửa cột định danh', text, ui.ButtonSet.OK);
  return text;
}

// ============================================================================
// Nâng cấp v3
// ============================================================================

function upgradeUniformModule() {
  var report = [];
  var ui = getUi_();
  if (!getProp_(PROP.SPREADSHEET_ID)) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('Chưa có SPREADSHEET_ID. Hãy chạy setupDatabase() trước.');
    setProp_(PROP.SPREADSHEET_ID, active.getId());
  }
  SPREADSHEET_ = null;
  resetHeaderCache_();
  var ss = getSpreadsheet_();
  withScriptLock_(function () { ensureSchemaV2_(ss, report); });
  var text = 'DTA Handover – upgradeUniformModule()\n- ' + report.join('\n- ') +
    '\n\nTiếp theo: menu "Khởi tạo danh mục đồng phục", rồi nhập tồn đầu kỳ trên trang Đồng phục → Tồn kho.';
  console.log(text);
  if (ui) ui.alert('DTA Handover – Nâng cấp module Đồng phục', text, ui.ButtonSet.OK);
  return text;
}

// ============================================================================
// Danh mục mẫu khởi tạo
// ============================================================================

/**
 * CHỈ DÙNG CHẠY THỬ (npm run local / bộ giả lập): tồn kho mẫu cho các mẫu khởi tạo + giới tính / size cho nhân viên mẫu DEMO-.
 * Không có trong menu; chạy lại không cộng tồn lần hai (operation_id cố định). Không đụng nhân viên thật (chỉ mã DEMO-).
 */
function seedUniformDemo_() {
  var actor = { id: 'system', name: 'Dữ liệu chạy thử' };
  var stockBySize = { S: 4, M: 8, L: 12, XL: 10, XXL: 2 };
  return withScriptLock_(function () {
    var now = nowIso_();
    var store = dpStore_();
    var moves = [];
    dpLoadModels_().forEach(function (model) {
      var skus = dpEnsureSkus_(model, model.sizes.map(function (s) { return { size: s, condition: 'NEW' }; }), now);
      model.sizes.forEach(function (size) {
        var sku = skus[size + '|NEW'];
        var qty = stockBySize[size] || 3;
        if (model.kind === 'PPE') qty = Math.ceil(qty / 2);
        var op = 'DP_DEMO:' + sku.productId;
        if (!operationExists_(op, store)) {
          moves.push({ productId: sku.productId, type: MOVEMENT_TYPES.INITIAL, quantity: qty, operationId: op, reason: 'Tồn đầu kỳ (dữ liệu chạy thử)' });
        }
      });
    });
    if (moves.length) applyStockMovements_(moves, actor, now, store);
    var profiles = { 'DEMO-519': ['NAM', 'L'], 'DEMO-101': ['NAM', 'XL'], 'DEMO-102': ['NU', 'M'], 'DEMO-103': ['NAM', 'L'],
      'DEMO-104': ['NU', 'S'], 'DEMO-105': ['NAM', 'M'], 'DEMO-106': ['NU', ''] };
    readTable_(SHEETS.EMPLOYEES).rows.forEach(function (r) {
      var p = profiles[cleanLine_(r.employee_id).toUpperCase()];
      if (!p || cleanLine_(r.gender)) return;
      updateRowFields_(SHEETS.EMPLOYEES, r._row, r, { gender: dpGenderCell_(p[0]), uniform_size: p[1], updated_at: now });
    });
    invalidateCaches_();
    return moves.length;
  });
}

function seedUniformCatalog() {
  requireSchemaReady_();
  var actor = { id: 'system', name: 'Khởi tạo danh mục đồng phục' };
  var result = withScriptLock_(function () {
    var now = nowIso_();
    var models = dpLoadModels_();
    var byCode = {};
    var byName = {};
    models.forEach(function (m) {
      byCode[m.modelCode] = m;
      byName[matchKey_(m.modelName) + '|' + m.gender] = m;
    });
    var created = [];
    var skipped = [];
    UNIFORM_SEED_MODELS.forEach(function (seed) {
      var gender = seed.gender || 'UNISEX';
      if (byCode[seed.code] || byName[matchKey_(seed.name) + '|' + gender]) {
        skipped.push(seed.name);
        return;
      }
      var row = {
        model_id: uuidFrom_('dp-seed|' + seed.code),
        model_code: seed.code,
        model_name: seed.name,
        kind: seed.kind || 'UNIFORM',
        gender: gender,
        sizes: DEFAULT_UNIFORM_SIZES.join(','),
        unit: 'Cái',
        reference_price: '',
        counts_toward_quota: boolCell_(seed.countsTowardQuota !== false),
        minimum_stock: 0,
        applies_to: seed.appliesTo || '',
        active: 'TRUE',
        note: 'Khởi tạo từ "DS đồng phục 2023 / 2024" (P.HCNS). Kiểm tra lại size / đối tượng sử dụng.',
        created_at: now,
        updated_at: now
      };
      appendObjects_(SHEETS.DP_MODELS, [row]);
      var model = dpModelFromRow_(row);
      dpEnsureSkus_(model, model.sizes.map(function (s) { return { size: s, condition: 'NEW' }; }), now);
      appendHistory_(model.modelId, 'DP_MODEL_CREATED', actorLabel_(actor), '', '',
        'Khởi tạo mẫu đồng phục ' + model.modelCode + ' – ' + model.modelName, { after: row }, 'DP_MODEL');
      created.push(seed.name);
    });
    // Mã DP-00n do khởi tạo đặt sẵn → bộ đếm phải đi sau số lớn nhất.
    var maxSeq = maxSequenceForPrefix_(SHEETS.DP_MODELS, 'model_code', APP.DP_MODEL_CODE_PREFIX);
    if ((parseInt(getProp_(PROP.DP_MODEL_SEQ), 10) || 0) < maxSeq) setProp_(PROP.DP_MODEL_SEQ, String(maxSeq));
    return { created: created, skipped: skipped };
  });
  var text = 'DTA Handover – seedUniformCatalog()\n- Thêm ' + result.created.length + ' mẫu: ' + (result.created.join(', ') || '(không)') +
    '\n- Đã có, bỏ qua: ' + (result.skipped.join(', ') || '(không)') +
    '\n\nTồn kho = 0: đếm thực tế rồi nhập "Tồn đầu kỳ" trên trang Đồng phục → Tồn kho. Tiêu chuẩn mặc định ' +
    dpDefaultYearlyQuota_() + ' áo/người/năm (CAU_HINH.DP_TIEU_CHUAN_NAM) — thêm tiêu chuẩn riêng cho từng nhóm ở trang Tiêu chuẩn.';
  console.log(text);
  var ui = getUi_();
  if (ui) ui.alert('DTA Handover – Khởi tạo danh mục đồng phục', text, ui.ButtonSet.OK);
  return text;
}
