/**
 * VppSetup.gs — nâng cấp cơ sở dữ liệu lên v2 (module Văn phòng phẩm) + dữ liệu khởi tạo.
 *
 *   upgradeOfficeSupplyModule()      Idempotent, chạy bao nhiêu lần cũng được: sao lưu Spreadsheet (nếu có thay đổi cấu trúc
 *                                    và đã có dữ liệu) → thêm sheet / cột còn thiếu (không xóa, không ghi đè) → thêm loại
 *                                    "Văn phòng phẩm" → điền handover_type còn trống → đánh dấu SCHEMA_VERSION.
 *   seedOfficeSupplyNorms()          Định mức từ bản "ĐỊNH MỨC VVP HÀNG THÁNG" (PHÒNG KINH DOANH, VĂN PHÒNG). Không tạo trùng
 *                                    (khóa: phạm vi + sản phẩm); không sửa định mức đã có.
 *   seedInitialOfficeSupplyStock()   Tồn đầu kỳ (INITIAL_STOCK). Chạy THỦ CÔNG một lần; không ghi đè tồn đã có. Tên tồn kho
 *                                    KHÔNG tự ghép với danh mục — tạo sản phẩm tạm để admin ghép / tạo mới / bỏ qua.
 */

/**
 * Nguồn: bản scan "CÔNG TY CỔ PHẦN DTA SPACE – ĐỊNH MỨC VVP HÀNG THÁNG" (người phê duyệt: Nguyễn Thị Hồng Tuyết).
 * Mỗi dòng: [STT trên bản nguồn, Tên sản phẩm, ĐVT, Đơn giá, SL xuất 1 tháng, Ghi chú] — giữ nguyên như bản nguồn.
 */
var VPP_NORM_SOURCE = [
  {
    scopeId: 'KINH_DOANH',
    scopeName: 'PHÒNG KINH DOANH',
    rows: [
      [1, 'Giấy A4 Excel 80 gsm', 'Gream', 55600, 3, ''],
      [2, 'Giấy A5 Excel 80 gsm', 'Gream', 27800, 2, ''],
      [3, 'Bút bi Thiên Long 027, xanh', 'Cây', 3100, 10, 'Showroom 5\nHỗ trợ 3\nKho 2'],
      [4, 'Bút lông dầu Thiên Long FO-PM09, xanh', 'Cây', 7900, 1, 'Hỗ trợ'],
      [5, 'Bút lông dầu Thiên Long FO-PM09, đen', 'Cây', 7900, 1, 'Hỗ trợ'],
      [6, 'Pin 2A Maxell', 'Viên', 3500, 4, 'Cho két sắt'],
      [7, 'Bao rác 3 cuộn (màu), tiểu', 'Bịch/kg', 31000, 1, 'Showroom'],
      [8, 'Bao rác 3 cuộn (màu), trung', 'Bịch/kg', 31000, 2, 'Hỗ trợ 1\nKho 1'],
      [9, 'Bao thư 12x22(không keo)', 'Xấp/100', 25000, 1, '2 tháng đặt 1 lần'],
      [10, 'Khăn giấy rút cho BOD, KH', 'Bịch', 20000, 6, 'Showroom 6'],
      [11, 'Khăn giấy ướt', 'Bịch', 21000, 9, 'Showroom 6\nHỗ trợ 3'],
      [12, 'Hột quẹt', 'Cái', 10000, 4, ''],
      [13, 'Thùng nước Vĩnh Hảo', 'Thùng', 80000, 3, '']
    ]
  },
  {
    scopeId: 'VAN_PHONG',
    scopeName: 'VĂN PHÒNG',
    rows: [
      [1, 'Giấy A4 Excel 80 gsm', 'Gream', 55600, 4, ''],
      [2, 'Giấy A5 Excel 80 gsm', 'Gream', 27800, 3, ''],
      [6, 'Bút bi Thiên Long 027, xanh', 'Cây', 3100, 5, ''],
      [7, 'Pin 3A Maxell', 'Viên', 3500, 6, ''],
      [8, 'Pin 2A Maxell', 'Viên', 3500, 6, ''],
      [35, 'Nước rửa chén 3.6kg', 'Bịch', 81000, 1, ''],
      [36, 'Nước lau sàn 3.6', 'Bịch', 86000, 1, ''],
      [37, 'Nước rửa tay 3.6kg', 'Bịch', 165000, 1, ''],
      [38, 'Khăn giấy rút cho BOD, KH', 'Bịch', 20000, 8, 'BOD, phòng họp'],
      [39, 'Khăn giấy rút cho nhân viên', 'Bịch', 20000, 6, 'Cho các phòng ban'],
      [40, 'Khăn giấy ướt', 'Bịch', 21000, 8, 'BOD, phòng họp: 5'],
      [42, 'Giấy Toilet VP và Showroom', 'Cuộn', 30000, 25, ''],
      [43, 'Bao rác', 'Bịch/kg', 31000, 6, ''],
      [44, 'Kẹo phòng họp', 'Bịch', 16000, 5, ''],
      [45, 'Xịt thơm phòng', 'Chai', 55300, 1, ''],
      [46, 'Nước tẩy', 'Chai', 33000, 1, ''],
      [50, 'Nước lau kiếng', 'Chai', 27200, 1, '']
    ]
  }
];

/** Tồn đầu kỳ (INITIAL_STOCK) — giữ nguyên văn bản nguồn "Tên: giá trị". */
var VPP_INITIAL_STOCK_SOURCE = [
  'Giấy ướt: 5',
  'Giấy khô: 9',
  'Nước lau sàn: 1 túi',
  'Lau kính: 1 chai',
  'Vim: 1 chai',
  'Giấy toilet: hết năm',
  'Xịt phòng: 2 chai',
  'Bút lông bảng: 10 cây',
  'Bút lông đỏ: 4 cây',
  'Bút lông xanh: 3 cây',
  'Bút lông đen: 4 cây',
  'Xóa kéo: 9',
  'Giấy note: 4 vuông nhỏ',
  'Bút đỏ: 7 cây',
  'Bút xanh: 24 cây',
  'Mực mộc: 1',
  'Dao rọc giấy: 2',
  'Thước 30 cm: 2 cây',
  'Kéo: 1',
  'Kẹp giấy lớn: 3 hộp',
  'Kẹp giấy nhỏ: 1 hộp',
  'Kim bấm: 11 hộp',
  'Paper clips: 5',
  'Bút chì: 4',
  'Bông bảng trắng: 1'
];

/** ĐVT nhận biết được khi đọc tồn đầu kỳ. Ngoài danh sách → coi là chưa rõ ĐVT (không tự đoán). */
var KNOWN_UNITS_ = [
  'cây', 'chai', 'túi', 'hộp', 'bịch', 'cuộn', 'viên', 'cái', 'thùng', 'xấp', 'gói', 'ream', 'gream', 'kg', 'lít',
  'bộ', 'tờ', 'quyển', 'cuốn', 'lọ', 'hũ', 'tuýp', 'vỉ', 'bình', 'can', 'đôi', 'chiếc', 'cặp'
];

/**
 * "Bút xanh: 24 cây" → { name, raw: "24 cây", quantity: 24, unit: "Cây", issues: [] }
 * "Giấy toilet: hết năm" → quantity null, issues [UNCLEAR_QUANTITY] — KHÔNG đổi thành 0.
 * "Paper clips: 5" → unit "", issues [MISSING_UNIT]; "Giấy note: 4 vuông nhỏ" → unit "", issues [UNCLEAR_UNIT].
 */
function parseInitialStockLine_(line) {
  var text = cleanLine_(line);
  var idx = text.indexOf(':');
  var name = idx >= 0 ? text.slice(0, idx).trim() : text;
  var raw = idx >= 0 ? text.slice(idx + 1).trim() : '';
  var m = /^(\d+)(?:\s+(.*))?$/.exec(raw);
  if (!m) return { name: name, raw: raw, quantity: null, unit: '', issues: ['UNCLEAR_QUANTITY'] };
  var qty = parseInt(m[1], 10);
  var unitText = cleanLine_(m[2] || '');
  if (!unitText) return { name: name, raw: raw, quantity: qty, unit: '', issues: ['MISSING_UNIT'] };
  if (KNOWN_UNITS_.indexOf(unitText.toLowerCase()) >= 0) {
    return { name: name, raw: raw, quantity: qty, unit: unitText.charAt(0).toUpperCase() + unitText.slice(1).toLowerCase(), issues: [] };
  }
  return { name: name, raw: raw, quantity: qty, unit: '', issues: ['UNCLEAR_UNIT'] };
}

// ============================================================================
// Nâng cấp cấu trúc
// ============================================================================

/** Các thay đổi cấu trúc còn thiếu (sheet / cột). */
function schemaChangesNeeded_(ss) {
  var changes = [];
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      changes.push('Tạo sheet ' + name);
      return;
    }
    var lastCol = sheet.getLastColumn();
    var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    var missing = HEADERS[name].filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) changes.push(name + ': thêm cột ' + missing.join(', '));
  });
  return changes;
}

function spreadsheetHasData_(ss) {
  return [SHEETS.HANDOVERS, SHEETS.EMPLOYEES].some(function (name) {
    var sheet = ss.getSheetByName(name);
    return sheet && sheet.getLastRow() > 1;
  });
}

/** Sao lưu toàn bộ Spreadsheet vào DTA_HANDOVER/backups (dùng trước khi đổi cấu trúc). */
function backupSpreadsheet_(label) {
  var ss = getSpreadsheet_();
  var folder = getOrCreateChildFolder_(getRootFolder_(), 'backups');
  var name = ss.getName() + ' – backup ' + (label ? label + ' ' : '') + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd HHmm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  return 'Đã sao lưu trước khi nâng cấp: ' + copy.getName();
}

/** Thêm loại "Văn phòng phẩm" nếu thiếu; điền handover_type cho các loại đang để trống (không ghi đè giá trị có sẵn). */
function ensureVppCategory_() {
  var table = readTable_(SHEETS.CATEGORIES);
  var now = nowIso_();
  var hasVpp = false;
  var filled = 0;
  table.rows.forEach(function (r) {
    var code = String(r.code || '').trim().toUpperCase();
    if (code === VPP_CATEGORY_CODE) hasVpp = true;
    if (code && !String(r.handover_type || '').trim()) {
      updateRowFields_(SHEETS.CATEGORIES, r._row, r, { handover_type: DEFAULT_CATEGORY_TYPES[code] || 'OTHER', updated_at: now });
      filled++;
    }
  });
  var parts = [];
  if (!hasVpp) {
    var def = DEFAULT_CATEGORIES.filter(function (c) { return c.code === VPP_CATEGORY_CODE; })[0];
    appendObjects_(SHEETS.CATEGORIES, [{
      code: def.code, name: def.name, form_fields: def.form_fields, hint: def.hint, sort_order: def.sort_order, status: 'ACTIVE',
      created_at: now, updated_at: now, handover_type: def.handover_type
    }]);
    parts.push('thêm loại "Văn phòng phẩm"');
  }
  if (filled) parts.push('điền loại phiếu cho ' + filled + ' loại nội dung');
  return 'LOAI_BAN_GIAO: ' + (parts.length ? parts.join(', ') : 'đã đủ');
}

/** Dùng chung cho setupDatabase() và upgradeOfficeSupplyModule(). Trả về các dòng báo cáo. */
function ensureSchemaV2_(ss, report) {
  // Code trộn nhiều phiên bản (còn file .gs cũ ghi đè) → không đổi cấu trúc Sheet theo hằng số của bản cũ.
  assertCodeConsistent_();
  var pending = schemaChangesNeeded_(ss);
  if (pending.length && spreadsheetHasData_(ss) && getProp_(PROP.DRIVE_FOLDER_ID)) {
    report.push(backupSpreadsheet_('trước nâng cấp v' + APP.SCHEMA_VERSION));
  }
  Object.keys(HEADERS).forEach(function (name) {
    report.push(ensureSheet_(ss, name, HEADERS[name]));
  });
  resetHeaderCache_();
  report.push(seedDefaultCategories_());
  report.push(ensureVppCategory_());
  report.push(seedDefaultSettings_());
  setProp_(PROP.SCHEMA_VERSION, String(APP.SCHEMA_VERSION));
  report.push('SCHEMA_VERSION = ' + APP.SCHEMA_VERSION);
  invalidateCaches_();
}

function upgradeOfficeSupplyModule() {
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
  var text = 'DTA Handover – upgradeOfficeSupplyModule()\n- ' + report.join('\n- ');
  console.log(text);
  if (ui) ui.alert('DTA Handover – Nâng cấp module Văn phòng phẩm', text, ui.ButtonSet.OK);
  return text;
}

var SCHEMA_FINGERPRINT_ = '';

/** Dấu vân tay của cấu trúc mà code cần (HEADERS) — đổi khi code thêm cột mới. */
function schemaFingerprint_() {
  if (!SCHEMA_FINGERPRINT_) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(HEADERS));
    SCHEMA_FINGERPRINT_ = digest.slice(0, 8).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }
  return SCHEMA_FINGERPRINT_;
}

/**
 * Chặn thao tác khi cơ sở dữ liệu chưa đúng cấu trúc code cần:
 *   • SCHEMA_VERSION thấp hơn → chưa nâng cấp v2;
 *   • đúng phiên bản nhưng thiếu sheet / cột (code mới thêm cột, ví dụ confirm_method) → kiểm tra tiêu đề sheet,
 *     kết quả "đủ" được nhớ 10 phút. Không chạy tiếp với sheet thiếu cột (giá trị sẽ bị bỏ mất).
 */
function requireSchemaReady_() {
  // APP.SCHEMA_VERSION không phải số (code cũ ghi đè Config) → coi là CHƯA sẵn sàng ("0 < undefined" là false — trước đây lọt qua).
  if (typeof APP.SCHEMA_VERSION !== 'number' || (parseInt(getProp_(PROP.SCHEMA_VERSION), 10) || 0) < APP.SCHEMA_VERSION) {
    throw appError_('NOT_CONFIGURED', 'Cơ sở dữ liệu chưa được nâng cấp lên phiên bản ' + APP.SCHEMA_VERSION +
      '. Chủ sở hữu Google Sheet hãy chạy menu "DTA Handover → Nâng cấp module Văn phòng phẩm" (upgradeOfficeSupplyModule).');
  }
  var cache = CacheService.getScriptCache();
  var key = 'schema-ok:' + schemaFingerprint_();
  if (cache.get(key)) return;
  var missing = schemaChangesNeeded_(getSpreadsheet_());
  if (missing.length) {
    throw appError_('NOT_CONFIGURED', 'Cơ sở dữ liệu thiếu cấu trúc mà phiên bản này cần (' + missing.slice(0, 3).join('; ') +
      (missing.length > 3 ? '; …' : '') + '). Chủ sở hữu Google Sheet hãy chạy menu "DTA Handover → Thiết lập / cập nhật database".');
  }
  cache.put(key, '1', APP.CACHE_TTL_SECONDS);
}

// ============================================================================
// Dữ liệu khởi tạo
// ============================================================================

function seedOfficeSupplyNorms() {
  requireSchemaReady_();
  var actor = { id: 'system', name: 'Khởi tạo định mức' };
  var report = withScriptLock_(function () {
    var now = nowIso_();
    var products = loadProducts_();
    // Tên so GIỮ DẤU (exactNameKey_): "Kéo" trong bản định mức không bao giờ gắn vào sản phẩm "Kẹo" / "Keo" đã có.
    // Bỏ qua sản phẩm lưu trữ và sản phẩm chờ duyệt từ đề xuất mua (chưa phải sản phẩm danh mục).
    var findProduct = function (name, unit) {
      var key = exactNameKey_(name);
      var u = matchKey_(unit);
      for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (p.catalogStatus === CATALOG_STATUS.ARCHIVED || p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) continue;
        if (exactNameKey_(p.productName) === key && matchKey_(p.unit) === u) return p;
      }
      return null;
    };
    var norms = loadNorms_();
    var hasNorm = {};
    // Khóa chống trùng chính: phạm vi + STT trong bản định mức (source_ref) — không phụ thuộc tên / ĐVT sản phẩm, vì quản
    // trị viên có thể đã sửa (ví dụ "Gream" → "Ream", đổi tên "Hột quẹt"). Chạy lại sau khi sửa không tạo sản phẩm trùng.
    var seededRef = {};
    norms.forEach(function (n) {
      hasNorm[n.scopeId + '|' + n.productId] = true;
      var stt = /· STT (\d+)$/.exec(n.sourceRef);
      if (stt) seededRef[n.scopeId + '|' + stt[1]] = true;
    });
    var createdProducts = 0;
    var createdNorms = 0;
    var skipped = 0;
    var normRows = [];
    VPP_NORM_SOURCE.forEach(function (scope) {
      scope.rows.forEach(function (row) {
        if (seededRef[scope.scopeId + '|' + row[0]]) {
          skipped++;
          return;
        }
        var name = row[1];
        var unit = row[2];
        var product = findProduct(name, unit);
        if (!product) {
          product = createProduct_({
            productName: name, unit: unit, referencePrice: row[3], minimumStock: 0, catalogStatus: CATALOG_STATUS.MASTER,
            active: true, source: 'NORM_SEED', note: 'Từ bản định mức VPP hằng tháng'
          }, actor, now);
          products.push(product);
          createdProducts++;
        }
        var key = scope.scopeId + '|' + product.productId;
        if (hasNorm[key]) {
          skipped++;
          return;
        }
        hasNorm[key] = true;
        seededRef[scope.scopeId + '|' + row[0]] = true;
        normRows.push({
          norm_id: uuid_(),
          product_id: product.productId,
          scope_type: 'DEPARTMENT',
          scope_id: scope.scopeId,
          scope_name: scope.scopeName,
          monthly_quantity: row[4],
          unit: unit,
          reference_price: row[3],
          note: row[5],
          effective_from: '',
          effective_to: '',
          active: 'TRUE',
          created_at: now,
          updated_at: now,
          source_ref: 'Bản định mức VVP hằng tháng · ' + scope.scopeName + ' · STT ' + row[0]
        });
        createdNorms++;
      });
    });
    appendObjects_(SHEETS.VPP_NORMS, normRows);
    ensureStockRows_(products.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.MASTER; }).map(function (p) {
      return p.productId;
    }), actor, now);
    invalidateCaches_();
    return 'Định mức VPP: tạo ' + createdProducts + ' sản phẩm, ' + createdNorms + ' định mức; bỏ qua ' + skipped +
      ' định mức đã có (không tạo trùng).';
  });
  console.log(report);
  notifyUser_(report);
  return report;
}

function seedInitialOfficeSupplyStock() {
  requireSchemaReady_();
  var actor = { id: 'system', name: 'Tồn đầu kỳ' };
  var report = withScriptLock_(function () {
    var now = nowIso_();
    var parsed = VPP_INITIAL_STOCK_SOURCE.map(parseInitialStockLine_);
    // ID sản phẩm cố định theo số thứ tự dòng tồn đầu kỳ: chạy lại sau lần lỗi giữa chừng chỉ ghi phần còn thiếu
    // (sản phẩm / dòng tồn / biến động INITIAL_STOCK:v1:n) — không tạo trùng, không ghi đè tồn kho đang có.
    var ids = parsed.map(function (line, i) { return uuidFrom_('INITIAL_STOCK:v1:' + (i + 1)); });
    var legacy = loadProducts_().filter(function (p) { return p.source === 'INITIAL_STOCK' && ids.indexOf(p.productId) < 0; });
    if (legacy.length) {
      return 'Tồn đầu kỳ: đã có ' + legacy.length + ' dòng từ lần chạy trước — bỏ qua (không ghi đè tồn kho đang có).';
    }
    var known = loadProductMap_();
    var createdCount = 0;
    var products = parsed.map(function (line, i) {
      if (known[ids[i]]) return known[ids[i]];
      createdCount++;
      return createProduct_({
        productId: ids[i], productName: line.name, unit: line.unit, minimumStock: 0, catalogStatus: CATALOG_STATUS.TEMP, active: true,
        source: 'INITIAL_STOCK', reviewStatus: REVIEW_STATUS.PENDING,
        note: 'Tồn đầu kỳ: "' + line.name + ': ' + line.raw + '"' + (line.issues.length ? ' · cần kiểm tra: ' + line.issues.join(', ') : '')
      }, actor, now);
    });
    var stock = loadStockMap_();
    var stockRows = [];
    products.forEach(function (p, i) {
      if (stock[p.productId]) return;
      stockRows.push({
        product_id: p.productId,
        on_hand: '',
        reserved: 0,
        minimum_stock: 0,
        raw_initial_value: parsed[i].raw,
        needs_review: 'TRUE',
        updated_at: now,
        updated_by: actor.name
      });
    });
    appendObjects_(SHEETS.VPP_STOCK, stockRows);
    var doneOps = {};
    readColumn_(getSheet_(SHEETS.VPP_MOVEMENTS), 'operation_id').forEach(function (op) { doneOps[op] = true; });
    var moves = [];
    parsed.forEach(function (line, i) {
      var op = 'INITIAL_STOCK:v1:' + (i + 1);
      if (line.quantity !== null && line.quantity > 0 && !doneOps[op]) {
        moves.push({
          productId: products[i].productId,
          type: MOVEMENT_TYPES.INITIAL,
          quantity: line.quantity,
          operationId: op,
          reason: 'Tồn đầu kỳ: "' + line.name + ': ' + line.raw + '"'
        });
      }
    });
    applyStockMovements_(moves, actor, now);
    invalidateCaches_();
    if (!createdCount && !stockRows.length && !moves.length) {
      return 'Tồn đầu kỳ: đã nạp đủ ' + parsed.length + ' dòng từ lần chạy trước — không ghi thêm.';
    }
    var unclear = parsed.filter(function (l) { return l.quantity === null; }).length;
    var noUnit = parsed.filter(function (l) { return l.quantity !== null && !l.unit; }).length;
    return 'Tồn đầu kỳ: tạo ' + createdCount + ' sản phẩm tạm (chờ ghép với danh mục), ' + moves.length + ' dòng tồn đầu kỳ' +
      (createdCount < parsed.length ? ' (hoàn tất phần còn thiếu của lần chạy trước)' : '') + '; ' +
      unclear + ' dòng chưa rõ số lượng, ' + noUnit + ' dòng chưa rõ ĐVT → xem "Dữ liệu cần kiểm tra".';
  });
  console.log(report);
  notifyUser_(report);
  return report;
}
