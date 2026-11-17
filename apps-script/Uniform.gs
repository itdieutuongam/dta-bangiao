/**
 * Uniform.gs — module Đồng phục (DP): danh mục mẫu, mặt hàng (mẫu × size × tình trạng), tồn kho, tiêu chuẩn cấp phát năm,
 * sổ cấp phát theo nhân viên, cho mượn / trả / thu hồi, phiếu bàn giao đồng phục.
 *
 * Kho dùng CHUNG bộ máy sổ biến động của Vpp.gs (stockStore_('UNIFORM')): sổ DP_BIEN_DONG_KHO là nguồn sự thật, ghi sổ trước,
 * dấu "đang ghi dở" DP_STOCK_DIRTY, đồng bộ hội tụ theo operation_id, không âm tồn. Phiếu đồng phục là phiếu BAN_GIAO với
 * handover_type = UNIFORM: tạo → giữ chỗ (RESERVE), người nhận ký → xuất kho (OUT), hủy → trả giữ chỗ (RELEASE).
 *
 * Tiêu chuẩn năm (Chính sách người lao động 19/08/2025, mục VII.2 — "Số lượng đồng phục được cấp phát/1 năm: 03"):
 *   • phòng ban → nhóm (CAU_HINH "DP_SCOPE:<PHÒNG BAN>" hoặc tự khớp tên nhóm; "NONE" = không áp dụng);
 *   • nhóm có quy tắc tổng (DP_DINH_MUC, model_id trống) → dùng quy tắc; chỉ có quy tắc theo mẫu → tổng = cộng các quy tắc mẫu;
 *     nhóm không có quy tắc → CAU_HINH.DP_TIEU_CHUAN_NAM (mặc định 3; 0 = không áp dụng);
 *   • đã dùng = dòng "Cấp phát" của mẫu tính tiêu chuẩn: phiếu đã ký trong năm + phiếu đang chờ ký + đồng phục ghi tay ở phiếu
 *     loại khác đã ký trong năm (dữ liệu trước khi có module);
 *   • vượt → không chặn, nhưng bắt buộc "Lý do vượt tiêu chuẩn" (NORM_EXCEEDED) — giống định mức văn phòng phẩm.
 * Cho mượn (CHO_MUON) không tính tiêu chuẩn; có hạn trả (cột deadline); quá hạn hiện ở trang Mượn / Trả và huy hiệu menu.
 */

function dpStore_() {
  return stockStore_('UNIFORM');
}

// ============================================================================
// Chuẩn hóa giá trị
// ============================================================================

function dpModelGender_(value) {
  var v = normalizeText_(value).toUpperCase();
  if (v === 'NAM' || v === 'MALE' || v === 'M') return 'NAM';
  if (v === 'NU' || v === 'FEMALE' || v === 'F') return 'NU';
  return 'UNISEX';
}

/** Giới tính nhân viên trên NHAN_VIEN: "NAM" / "Nam" / "NỮ" / "Nữ" / "M" / "F"… → NAM / NU; khác → ''. */
function dpEmployeeGender_(value) {
  var v = normalizeText_(value).toUpperCase().replace(/\s+/g, ' ');
  if (v === 'NAM' || v === 'MALE' || v === 'M' || v === 'NAM GIOI') return 'NAM';
  if (v === 'NU' || v === 'FEMALE' || v === 'F' || v === 'NU GIOI') return 'NU';
  return '';
}

/** Giá trị ghi vào ô NHAN_VIEN.gender (dễ đọc, khớp "DS đồng phục" của HCNS). */
function dpGenderCell_(gender) {
  return gender === 'NAM' ? 'NAM' : gender === 'NU' ? 'NỮ' : '';
}

function dpNormalizeSize_(value) {
  var s = cleanLine_(value).toUpperCase().replace(/\s+/g, '');
  return UNIFORM_SIZE_PATTERN_.test(s) ? s : '';
}

/** "S, M,L / XL" → ['S','M','L','XL'] (giữ thứ tự, bỏ trùng / không hợp lệ). */
function dpParseSizes_(value) {
  var parts = Array.isArray(value) ? value : String(value || '').split(/[,;|/\n]+/);
  var out = [];
  parts.forEach(function (p) {
    var s = dpNormalizeSize_(p);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function dpCondition_(value) {
  return String(value || '').trim().toUpperCase() === 'USED' ? 'USED' : 'NEW';
}

function dpKind_(value) {
  var v = String(value || '').trim().toUpperCase();
  return UNIFORM_KINDS[v] ? v : 'UNIFORM';
}

function dpSkuLabel_(modelName, size, condition) {
  return [modelName, size, UNIFORM_CONDITIONS[condition] || condition].filter(function (x) { return x; }).join(' · ');
}

function dpYearOf_(iso) {
  var m = /^(\d{4})-/.exec(String(iso || ''));
  return m ? parseInt(m[1], 10) : 0;
}

function dpCurrentYear_() {
  return parseInt(Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy'), 10);
}

/** Đồng phục ghi tay ở phiếu loại khác (trước khi có module): tên / mô tả có "đồng phục". */
function dpIsLegacyUniformText_(name, description) {
  var text = normalizeText_(String(name || '') + ' ' + String(description || ''));
  return text.indexOf('dong phuc') >= 0 || text.indexOf('dongphuc') >= 0;
}

// ============================================================================
// Mẫu (DP_MAU)
// ============================================================================

function dpModelFromRow_(r) {
  return {
    modelId: String(r.model_id || '').trim().toLowerCase(),
    modelCode: cleanLine_(r.model_code).toUpperCase(),
    modelName: cleanLine_(r.model_name),
    kind: dpKind_(r.kind),
    gender: dpModelGender_(r.gender),
    sizes: dpParseSizes_(r.sizes),
    unit: cleanLine_(r.unit) || 'Cái',
    referencePrice: toNumberOrNull_(r.reference_price),
    countsTowardQuota: String(r.counts_toward_quota || '').trim() === '' ? true : toBool_(r.counts_toward_quota),
    minimumStock: Math.max(0, toIntOrNull_(r.minimum_stock) || 0),
    appliesTo: cleanLine_(r.applies_to),
    active: String(r.active || '').trim() === '' ? true : toBool_(r.active),
    note: cleanText_(r.note),
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || ''
  };
}

function dpLoadModels_() {
  return readTable_(SHEETS.DP_MODELS).rows
    .filter(function (r) { return isUuid_(r.model_id); })
    .map(dpModelFromRow_);
}

function dpModelMap_(models) {
  var map = {};
  (models || dpLoadModels_()).forEach(function (m) { if (!map[m.modelId]) map[m.modelId] = m; });
  return map;
}

function dpFindModelRow_(modelId) {
  var id = String(modelId || '').toLowerCase();
  return isUuid_(id) ? findRow_(SHEETS.DP_MODELS, 'model_id', id) : null;
}

/** Mã mẫu DP-001… tăng dần (trong khóa): max(bộ đếm, số lớn nhất đã có) + 1. */
function dpNextModelCode_() {
  requireLock_('dpNextModelCode_');
  var prefix = APP.DP_MODEL_CODE_PREFIX;
  var fromProp = parseInt(getProp_(PROP.DP_MODEL_SEQ), 10) || 0;
  var seq = Math.max(fromProp, maxSequenceForPrefix_(SHEETS.DP_MODELS, 'model_code', prefix)) + 1;
  setProp_(PROP.DP_MODEL_SEQ, String(seq));
  return prefix + pad_(seq, 3);
}

function dpModelCodeTaken_(code, exceptModelId) {
  if (!code) return false;
  return findRows_(SHEETS.DP_MODELS, 'model_code', code).some(function (m) {
    return String(m.record.model_id).toLowerCase() !== exceptModelId;
  });
}

// ============================================================================
// Mặt hàng (DP_BIEN_THE) = mẫu × size × tình trạng
// ============================================================================

function dpSkuFromRow_(r) {
  return {
    productId: String(r.product_id || '').trim().toLowerCase(),
    skuCode: cleanLine_(r.sku_code).toUpperCase(),
    modelId: String(r.model_id || '').trim().toLowerCase(),
    size: dpNormalizeSize_(r.size) || cleanLine_(r.size).toUpperCase(),
    condition: dpCondition_(r.condition),
    active: String(r.active || '').trim() === '' ? true : toBool_(r.active),
    _row: r._row,
    _record: r
  };
}

function dpLoadSkus_() {
  return readTable_(SHEETS.DP_SKUS).rows
    .filter(function (r) { return isUuid_(r.product_id) && isUuid_(r.model_id); })
    .map(dpSkuFromRow_);
}

function dpSkuCode_(modelCode, size, condition) {
  return (modelCode || 'DP') + '-' + size + (condition === 'USED' ? '-CU' : '');
}

/** ID cố định của mặt hàng: cùng mẫu + size + tình trạng → cùng ID (tạo lại sau lỗi giữa chừng không sinh mặt hàng thứ hai). */
function dpSkuId_(modelId, size, condition) {
  return uuidFrom_('dp-sku|' + modelId + '|' + size + '|' + condition);
}

/** Thông tin mặt hàng cho bộ máy kho (stockStore_('UNIFORM').loadProductMap): tên hiển thị, mã, ĐVT, tồn tối thiểu. */
function dpSkuInfoMap_() {
  var models = dpModelMap_();
  var map = {};
  dpLoadSkus_().forEach(function (s) {
    if (map[s.productId]) return;
    var m = models[s.modelId];
    map[s.productId] = {
      productId: s.productId,
      productCode: s.skuCode,
      productName: dpSkuLabel_(m ? m.modelName : '(mẫu đã xóa)', s.size, s.condition),
      unit: m ? m.unit : 'Cái',
      minimumStock: m && s.condition === 'NEW' ? m.minimumStock : 0,
      modelId: s.modelId,
      modelName: m ? m.modelName : '',
      size: s.size,
      condition: s.condition,
      active: s.active && Boolean(m && m.active)
    };
  });
  return map;
}

/**
 * Đảm bảo có mặt hàng (mẫu × size × tình trạng) — gọi trong khóa. specs: [{ size, condition }]. Mặt hàng đã có nhưng đang tắt →
 * bật lại. Trả về map "size|condition" → mặt hàng.
 */
function dpEnsureSkus_(model, specs, now) {
  requireLock_('dpEnsureSkus_');
  var existing = {};
  dpLoadSkus_().forEach(function (s) {
    if (s.modelId === model.modelId) existing[s.size + '|' + s.condition] = s;
  });
  var toAdd = [];
  var out = {};
  specs.forEach(function (spec) {
    var size = dpNormalizeSize_(spec.size);
    var condition = dpCondition_(spec.condition);
    if (!size) return;
    var key = size + '|' + condition;
    if (out[key]) return;
    var s = existing[key];
    if (s) {
      if (!s.active) {
        updateRowFields_(SHEETS.DP_SKUS, s._row, s._record, { active: 'TRUE', updated_at: now });
        s.active = true;
      }
      out[key] = s;
      return;
    }
    var row = {
      product_id: dpSkuId_(model.modelId, size, condition),
      sku_code: dpSkuCode_(model.modelCode, size, condition),
      model_id: model.modelId,
      size: size,
      condition: condition,
      active: 'TRUE',
      created_at: now,
      updated_at: now
    };
    toAdd.push(row);
    out[key] = dpSkuFromRow_(row);
  });
  appendObjects_(SHEETS.DP_SKUS, toAdd);
  return out;
}

// ============================================================================
// Hiển thị mẫu / mặt hàng / tồn
// ============================================================================

function dpSkuView_(sku, stock, model) {
  var view = stockView_(stock, { minimumStock: model && sku.condition === 'NEW' ? model.minimumStock : 0 });
  // Tồn tối thiểu theo MẪU (mỗi size, hàng mới) — dòng tồn có thể còn số cũ trước khi đổi mẫu.
  view.minimumStock = model && sku.condition === 'NEW' ? model.minimumStock : 0;
  view.status = computeStockStatus_(view.available === null ? 0 : view.available, view.minimumStock, view.onHand === null);
  return {
    productId: sku.productId,
    skuCode: sku.skuCode,
    modelId: sku.modelId,
    size: sku.size,
    condition: sku.condition,
    active: sku.active,
    stock: view
  };
}

function dpModelStockSummary_(skuViews) {
  var out = { onHand: 0, reserved: 0, available: 0, newAvailable: 0, usedAvailable: 0, outOfStockSkus: 0, lowStockSkus: 0 };
  var unknown = false;
  skuViews.forEach(function (v) {
    if (!v.active) return;
    if (v.stock.onHand === null) {
      unknown = true;
    } else {
      out.onHand += v.stock.onHand;
      out.available += v.stock.available;
      if (v.condition === 'NEW') out.newAvailable += Math.max(0, v.stock.available);
      else out.usedAvailable += Math.max(0, v.stock.available);
    }
    out.reserved += v.stock.reserved;
    // Hàng đã qua sử dụng hết là bình thường — chỉ cảnh báo hết / sắp hết với hàng mới.
    if (v.condition === 'NEW' && v.stock.status === 'OUT_OF_STOCK') out.outOfStockSkus++;
    if (v.condition === 'NEW' && v.stock.status === 'LOW_STOCK') out.lowStockSkus++;
  });
  if (unknown) {
    out.onHand = null;
    out.available = null;
  }
  return out;
}

function dpModelView_(model, skuViews) {
  return {
    modelId: model.modelId,
    modelCode: model.modelCode,
    modelName: model.modelName,
    kind: model.kind,
    gender: model.gender,
    sizes: model.sizes.slice(),
    unit: model.unit,
    referencePrice: model.referencePrice,
    countsTowardQuota: model.countsTowardQuota,
    minimumStock: model.minimumStock,
    appliesTo: model.appliesTo,
    active: model.active,
    note: model.note,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    stock: dpModelStockSummary_(skuViews || [])
  };
}

function dpSortSkuViews_(views, model) {
  var order = {};
  (model ? model.sizes : []).forEach(function (s, i) { order[s] = i; });
  return views.sort(function (a, b) {
    var ia = order[a.size] === undefined ? 99 : order[a.size];
    var ib = order[b.size] === undefined ? 99 : order[b.size];
    if (ia !== ib) return ia - ib;
    if (a.size !== b.size) return a.size < b.size ? -1 : 1;
    return a.condition === b.condition ? 0 : a.condition === 'NEW' ? -1 : 1;
  });
}

/**
 * Danh mục kèm tồn THEO SỔ (đúng số mà thao tác ghi sẽ dùng). options.includeInactive: cả mẫu / mặt hàng đã tắt;
 * options.own: { productId: số đang giữ chỗ cho phiếu đang sửa } — được cộng vào khả dụng.
 * Trả về { models: [view + skus], modelMap, skuMap }.
 */
function dpStockCatalog_(options) {
  options = options || {};
  var store = dpStore_();
  var models = dpLoadModels_();
  var modelMap = dpModelMap_(models);
  var skus = dpLoadSkus_();
  var stockMap = ledgerStockMap_(loadStockMap_(store), skus.map(function (s) { return s.productId; }), store);
  var bySku = {};
  var byModel = {};
  skus.forEach(function (s) {
    if (bySku[s.productId]) return;
    bySku[s.productId] = s;
    var model = modelMap[s.modelId];
    var view = dpSkuView_(s, stockMap[s.productId], model);
    var own = options.own && options.own[s.productId] ? Math.max(0, options.own[s.productId].reserved) : 0;
    if (options.own) {
      view.reservedByThisHandover = own;
      if (view.stock.available !== null) view.stock.available += own;
    }
    var hasStock = view.stock.onHand !== 0 || view.stock.reserved !== 0;
    if (!options.includeInactive && !s.active && !hasStock) return;
    (byModel[s.modelId] || (byModel[s.modelId] = [])).push(view);
  });
  var list = models
    .filter(function (m) { return options.includeInactive || m.active; })
    .map(function (m) {
      var views = dpSortSkuViews_(byModel[m.modelId] || [], m);
      var view = dpModelView_(m, views);
      view.skus = views;
      return view;
    })
    .sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.modelCode < b.modelCode ? -1 : a.modelCode > b.modelCode ? 1 : compareVi_(a.modelName, b.modelName);
    });
  return { models: list, modelMap: modelMap, skuMap: bySku };
}

// ============================================================================
// Tiêu chuẩn cấp phát năm (DP_DINH_MUC)
// ============================================================================

function dpNormFromRow_(r) {
  return {
    normId: String(r.norm_id || '').trim().toLowerCase(),
    scopeId: String(r.scope_id || '').trim().toUpperCase(),
    scopeName: cleanLine_(r.scope_name),
    modelId: isUuid_(r.model_id) ? String(r.model_id).trim().toLowerCase() : '',
    gender: dpEmployeeGender_(r.gender),
    yearlyQuantity: Math.max(0, toIntOrNull_(r.yearly_quantity) || 0),
    note: cleanText_(r.note),
    effectiveFrom: normalizeDateOnly_(r.effective_from),
    effectiveTo: normalizeDateOnly_(r.effective_to),
    active: String(r.active || '').trim() === '' ? true : toBool_(r.active),
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || ''
  };
}

function dpLoadNorms_() {
  return readTable_(SHEETS.DP_NORMS).rows
    .filter(function (r) { return isUuid_(r.norm_id) && String(r.scope_id || '').trim(); })
    .map(dpNormFromRow_);
}

function dpListScopes_(norms) {
  var map = {};
  (norms || dpLoadNorms_()).forEach(function (n) {
    if (!n.scopeId || map[n.scopeId]) return;
    map[n.scopeId] = { scopeId: n.scopeId, scopeName: n.scopeName || n.scopeId };
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

function dpScopeSettingKey_(department) {
  return DP_SCOPE_SETTING_PREFIX + slugKey_(department, 80);
}

/**
 * Phòng ban → nhóm tiêu chuẩn. Trả về { scope: {scopeId, scopeName, source} | null, excluded: bool }.
 * So khớp theo tên đã chuẩn hóa (bỏ dấu, hoa / thường, khoảng trắng): "Kế toán - HCNS" = "KẾ TOÁN - HCNS".
 */
function dpResolveScope_(department, scopes, settings) {
  var dept = cleanLine_(department);
  if (!dept) return { scope: null, excluded: false };
  scopes = scopes || dpListScopes_();
  settings = settings || getSettings_();
  var mapped = String(settings[dpScopeSettingKey_(dept)] || '').trim().toUpperCase();
  if (mapped === 'NONE') return { scope: null, excluded: true };
  var byId = {};
  scopes.forEach(function (s) { byId[s.scopeId] = s; });
  if (mapped && byId[mapped]) return { scope: { scopeId: mapped, scopeName: byId[mapped].scopeName, source: 'MAPPING' }, excluded: false };
  var key = scopeMatchKey_(dept);
  for (var i = 0; i < scopes.length; i++) {
    var s = scopes[i];
    if (key && (key === scopeMatchKey_(s.scopeName) || key === scopeMatchKey_(s.scopeId.replace(/_/g, ' ')))) {
      return { scope: { scopeId: s.scopeId, scopeName: s.scopeName, source: 'AUTO' }, excluded: false };
    }
  }
  return { scope: null, excluded: false };
}

function dpDefaultYearlyQuota_(settings) {
  var raw = (settings || getSettings_()).DP_TIEU_CHUAN_NAM;
  var n = toIntOrNull_(raw);
  if (n === null) return String(raw || '').trim() === '' ? 3 : 0;
  return Math.max(0, Math.min(LIMITS.MAX_YEARLY_QUOTA, n));
}

function dpIsNormEffective_(n, day, modelMap) {
  if (!isNormEffective_(n, day)) return false;
  if (n.modelId) {
    var m = modelMap ? modelMap[n.modelId] : null;
    if (!m || !m.active) return false;
  }
  return true;
}

/** Ngữ cảnh tính tiêu chuẩn (đọc một lần cho cả danh sách nhân viên). */
function dpQuotaContext_(modelMap) {
  var norms = dpLoadNorms_();
  modelMap = modelMap || dpModelMap_();
  var day = todayIsoDate_();
  var settings = getSettings_();
  return {
    norms: norms.filter(function (n) { return dpIsNormEffective_(n, day, modelMap); }),
    scopes: dpListScopes_(norms),
    settings: settings,
    defaultQuota: dpDefaultYearlyQuota_(settings),
    modelMap: modelMap
  };
}

/** Quy tắc cụ thể hơn thắng: có giới tính > không giới tính; rồi hiệu lực từ ngày muộn hơn. */
function dpPickRule_(current, candidate) {
  if (!current) return candidate;
  if (Boolean(candidate.gender) !== Boolean(current.gender)) return candidate.gender ? candidate : current;
  return (candidate.effectiveFrom || '') > (current.effectiveFrom || '') ? candidate : current;
}

/**
 * Chỉ số đã dùng tiêu chuẩn trong năm của MỌI nhân viên (một lượt đọc sheet):
 *   { EMPLOYEE_ID_UPPER: { issued, pending, legacy, byModel: { modelId: { issued, pending } }, lastIssuedAt } }
 * excludeHandoverId: phiếu đang sửa (không tính chính nó).
 */
function dpUsageIndex_(year, excludeHandoverId, skuMap, modelMap) {
  var currentYear = dpCurrentYear_();
  var heads = readColumns_(SHEETS.HANDOVERS, [
    'handover_id', 'status', 'handover_type', 'receiver_employee_id', 'confirmed_at', 'items_revision'
  ]);
  var wanted = {};
  var revisions = {};
  var index = {};
  heads.forEach(function (h) {
    if (!h.handover_id || h.handover_id === excludeHandoverId) return;
    var emp = String(h.receiver_employee_id || '').trim().toUpperCase();
    if (!emp) return;
    var type = String(h.handover_type || '').trim().toUpperCase();
    var confirmedInYear = h.status === STATUS.CONFIRMED && dpYearOf_(h.confirmed_at) === year;
    var kind = '';
    if (type === 'UNIFORM') {
      if (confirmedInYear) kind = 'issued';
      else if (year === currentYear && (h.status === STATUS.PENDING || h.status === STATUS.REVISION_REQUESTED)) kind = 'pending';
      if (h.status === STATUS.CONFIRMED) {
        var e = index[emp] || (index[emp] = { issued: 0, pending: 0, legacy: 0, byModel: {}, lastIssuedAt: '' });
        if (h.confirmed_at > e.lastIssuedAt) e.lastIssuedAt = h.confirmed_at;
      }
    } else if (confirmedInYear) {
      kind = 'legacy';
    }
    if (!kind) return;
    wanted[h.handover_id] = { kind: kind, emp: emp };
    revisions[h.handover_id] = h.items_revision || '';
  });
  if (!Object.keys(wanted).length) return index;
  skuMap = skuMap || dpSkuMapById_();
  modelMap = modelMap || dpModelMap_();
  readColumns_(SHEETS.ITEMS, [
    'handover_id', 'category', 'product_id', 'quantity', 'issue_kind', 'superseded_at', 'revision_id', 'item_name', 'description'
  ]).forEach(function (it) {
    var w = wanted[it.handover_id];
    if (!w || !isCommittedItemRow_(it, revisions[it.handover_id])) return;
    var e = index[w.emp] || (index[w.emp] = { issued: 0, pending: 0, legacy: 0, byModel: {}, lastIssuedAt: '' });
    var qty = toIntOrNull_(it.quantity);
    var category = String(it.category || '').trim().toUpperCase();
    if (w.kind === 'legacy') {
      if (category !== UNIFORM_CATEGORY_CODE && dpIsLegacyUniformText_(it.item_name, it.description)) e.legacy += qty && qty > 0 ? qty : 1;
      return;
    }
    if (category !== UNIFORM_CATEGORY_CODE || String(it.issue_kind || 'CAP_PHAT').toUpperCase() !== 'CAP_PHAT') return;
    var sku = skuMap[String(it.product_id || '').toLowerCase()];
    var model = sku ? modelMap[sku.modelId] : null;
    if (!model || !model.countsTowardQuota || !(qty > 0)) return;
    e[w.kind] += qty;
    var bm = e.byModel[model.modelId] || (e.byModel[model.modelId] = { issued: 0, pending: 0 });
    bm[w.kind] += qty;
  });
  return index;
}

function dpSkuMapById_() {
  var map = {};
  dpLoadSkus_().forEach(function (s) { if (!map[s.productId]) map[s.productId] = s; });
  return map;
}

/**
 * Tiêu chuẩn + mức đã dùng của một nhân viên. employee: { department, gender }; usage: phần tử của dpUsageIndex_ (có thể null).
 * Trả về { scope, usage: UniformQuotaUsage, modelQuotas, suggestedModelIds, rules: { general, models } }.
 */
function dpQuotaFor_(employee, usage, ctx) {
  var resolved = dpResolveScope_(employee.department, ctx.scopes, ctx.settings);
  var gender = employee.gender || '';
  var general = null;
  var modelRules = {};
  if (resolved.scope) {
    ctx.norms.forEach(function (n) {
      if (n.scopeId !== resolved.scope.scopeId) return;
      if (n.gender && n.gender !== gender) return;
      if (!n.modelId) general = dpPickRule_(general, n);
      else modelRules[n.modelId] = dpPickRule_(modelRules[n.modelId], n);
    });
  }
  var u = usage || { issued: 0, pending: 0, legacy: 0, byModel: {}, lastIssuedAt: '' };
  var modelIds = Object.keys(modelRules);
  var yearlyQuota = null;
  var source = 'NONE';
  if (resolved.excluded) {
    source = 'NONE';
  } else if (general) {
    yearlyQuota = general.yearlyQuantity;
    source = 'RULE';
  } else if (modelIds.length) {
    yearlyQuota = modelIds.reduce(function (sum, id) { return sum + modelRules[id].yearlyQuantity; }, 0);
    source = 'RULE';
  } else if (ctx.defaultQuota > 0) {
    yearlyQuota = ctx.defaultQuota;
    source = 'DEFAULT';
  }
  var used = u.issued + u.pending + u.legacy;
  return {
    scope: resolved.scope,
    excluded: resolved.excluded,
    usage: {
      yearlyQuota: yearlyQuota,
      source: source,
      issued: u.issued,
      pending: u.pending,
      legacy: u.legacy,
      remaining: yearlyQuota === null ? null : yearlyQuota - used
    },
    modelQuotas: modelIds.map(function (id) {
      var rule = modelRules[id];
      var mu = u.byModel[id] || { issued: 0, pending: 0 };
      var m = ctx.modelMap[id];
      return {
        modelId: id,
        modelName: m ? m.modelName : '',
        yearlyQuota: rule.yearlyQuantity,
        issued: mu.issued,
        pending: mu.pending,
        remaining: rule.yearlyQuantity - mu.issued - mu.pending
      };
    }).sort(function (a, b) { return compareVi_(a.modelName, b.modelName); }),
    suggestedModelIds: modelIds,
    lastIssuedAt: u.lastIssuedAt || ''
  };
}

// ============================================================================
// Đang giữ / mượn / trả (DP_THU_HOI)
// ============================================================================

function dpReturnFromRow_(r) {
  return {
    returnId: String(r.return_id || '').toLowerCase(),
    handoverId: String(r.handover_id || '').toLowerCase(),
    itemId: String(r.item_id || '').toLowerCase(),
    employeeId: cleanLine_(r.employee_id),
    employeeName: cleanLine_(r.employee_name),
    department: cleanLine_(r.department),
    productId: String(r.product_id || '').toLowerCase(),
    modelId: String(r.model_id || '').toLowerCase(),
    size: cleanLine_(r.size),
    quantity: Math.max(0, toIntOrNull_(r.quantity) || 0),
    result: RETURN_RESULTS[String(r.result || '').toUpperCase()] ? String(r.result).toUpperCase() : 'RESTOCK',
    restockProductId: String(r.restock_product_id || '').toLowerCase(),
    restockCondition: r.restock_condition ? dpCondition_(r.restock_condition) : '',
    reason: RETURN_REASONS[String(r.reason || '').toUpperCase()] ? String(r.reason).toUpperCase() : 'KHAC',
    note: cleanText_(r.note),
    actorName: cleanLine_(r.actor_name),
    clientRequestId: String(r.client_request_id || '').toLowerCase(),
    createdAt: r.created_at || ''
  };
}

function dpLoadReturns_() {
  return readTable_(SHEETS.DP_RETURNS).rows
    .filter(function (r) { return isUuid_(r.return_id) && isUuid_(r.item_id); })
    .map(dpReturnFromRow_);
}

/**
 * Mọi dòng đồng phục ĐÃ KÝ NHẬN (phiếu UNIFORM đã xác nhận) kèm số đã trả / còn giữ. filter.employeeId: chỉ một nhân viên.
 * returns: danh sách DP_THU_HOI (tùy chọn, tránh đọc lại).
 */
function dpHoldings_(filter, returns, codes) {
  filter = filter || {};
  var empFilter = String(filter.employeeId || '').trim().toUpperCase();
  var today = todayIsoDate_();
  var heads = {};
  readColumns_(SHEETS.HANDOVERS, [
    'handover_id', 'handover_code', 'status', 'handover_type', 'receiver_employee_id', 'receiver_name', 'receiver_department',
    'confirmed_at', 'items_revision'
  ]).forEach(function (h) {
    if (!h.handover_id || h.status !== STATUS.CONFIRMED || String(h.handover_type || '').toUpperCase() !== 'UNIFORM') return;
    if (empFilter && String(h.receiver_employee_id || '').trim().toUpperCase() !== empFilter) return;
    heads[h.handover_id] = h;
  });
  if (codes) Object.keys(heads).forEach(function (id) { codes[id] = heads[id].handover_code; });
  if (!Object.keys(heads).length) return [];
  var returned = {};
  (returns || dpLoadReturns_()).forEach(function (r) { returned[r.itemId] = (returned[r.itemId] || 0) + r.quantity; });
  var skuMap = dpSkuMapById_();
  var out = [];
  readColumns_(SHEETS.ITEMS, [
    'item_id', 'handover_id', 'category', 'product_id', 'quantity', 'issue_kind', 'deadline', 'size', 'condition', 'item_name',
    'asset_code', 'superseded_at', 'revision_id'
  ]).forEach(function (it) {
    var h = heads[it.handover_id];
    if (!h || !isCommittedItemRow_(it, h.items_revision || '')) return;
    if (String(it.category || '').trim().toUpperCase() !== UNIFORM_CATEGORY_CODE) return;
    var qty = Math.max(0, toIntOrNull_(it.quantity) || 0);
    var itemId = String(it.item_id || '').toLowerCase();
    var back = Math.min(qty, returned[itemId] || 0);
    var issueKind = String(it.issue_kind || '').toUpperCase() === 'CHO_MUON' ? 'CHO_MUON' : 'CAP_PHAT';
    var dueDate = issueKind === 'CHO_MUON' ? normalizeDateOnly_(it.deadline) : '';
    var outstanding = qty - back;
    var sku = skuMap[String(it.product_id || '').toLowerCase()];
    out.push({
      handoverId: h.handover_id,
      handoverCode: h.handover_code,
      itemId: itemId,
      employeeId: cleanLine_(h.receiver_employee_id),
      employeeName: cleanLine_(h.receiver_name),
      department: cleanLine_(h.receiver_department),
      issueKind: issueKind,
      modelId: sku ? sku.modelId : '',
      modelName: cleanLine_(it.item_name),
      productId: String(it.product_id || '').toLowerCase(),
      skuCode: cleanLine_(it.asset_code),
      size: cleanLine_(it.size) || (sku ? sku.size : ''),
      condition: sku ? sku.condition : '',
      quantity: qty,
      returned: back,
      outstanding: outstanding,
      dueDate: dueDate,
      overdue: issueKind === 'CHO_MUON' && outstanding > 0 && Boolean(dueDate) && dueDate < today,
      confirmedAt: h.confirmed_at || ''
    });
  });
  return out;
}

function dpHoldingSummaryByEmployee_(holdings) {
  var out = {};
  holdings.forEach(function (x) {
    if (x.outstanding <= 0) return;
    var key = x.employeeId.toUpperCase();
    var s = out[key] || (out[key] = { loaned: 0, overdue: 0, holding: 0 });
    s.holding += x.outstanding;
    if (x.issueKind === 'CHO_MUON') {
      s.loaned += x.outstanding;
      if (x.overdue) s.overdue += x.outstanding;
    }
  });
  return out;
}

function dpDaysBetween_(fromDay, toDay) {
  var a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  var b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// ============================================================================
// Phiếu bàn giao đồng phục (handover_type = UNIFORM)
// ============================================================================

/** Một dòng đồng phục từ Worker: mặt hàng + SL + hình thức (+ hạn trả khi cho mượn). Lỗi ghi vào errors['uniforms.i.*']. */
function validateUniformLine_(raw, index, errors) {
  raw = raw && typeof raw === 'object' ? raw : {};
  var prefix = 'uniforms.' + index + '.';
  var productId = String(raw.productId || '').trim().toLowerCase();
  if (!isUuid_(productId)) errors[prefix + 'productId'] = 'Chọn mẫu và size đồng phục';
  var q = Number(raw.quantity);
  if (!isFinite(q) || Math.floor(q) !== q || q < 1 || q > LIMITS.MAX_QUANTITY) {
    errors[prefix + 'quantity'] = 'Số lượng phải là số nguyên từ 1 đến ' + LIMITS.MAX_QUANTITY;
    q = 0;
  }
  var issueKind = String(raw.issueKind || 'CAP_PHAT').trim().toUpperCase();
  if (!ISSUE_KINDS[issueKind]) {
    errors[prefix + 'issueKind'] = 'Chọn hình thức: Cấp phát hoặc Cho mượn';
    issueKind = 'CAP_PHAT';
  }
  var dueDate = issueKind === 'CHO_MUON' ? String(raw.dueDate || '').trim() : '';
  if (issueKind === 'CHO_MUON') {
    if (!dueDate) errors[prefix + 'dueDate'] = 'Cho mượn phải có hạn trả';
    else if (!isValidDateOnly_(dueDate)) errors[prefix + 'dueDate'] = 'Ngày không hợp lệ';
  }
  var note = cleanText_(raw.note);
  if (note.length > 1000) errors[prefix + 'note'] = 'Tối đa 1000 ký tự';
  else if (containsPasswordLike_(note)) errors[prefix + 'note'] = PASSWORD_MESSAGE_;
  var reason = cleanText_(raw.overQuotaReason);
  if (reason.length > LIMITS.OVER_NORM_REASON) errors[prefix + 'overQuotaReason'] = 'Tối đa ' + LIMITS.OVER_NORM_REASON + ' ký tự';
  return {
    productId: productId,
    quantity: q,
    issueKind: issueKind,
    dueDate: dueDate,
    note: truncate_(note, 1000),
    overQuotaReason: truncate_(reason, LIMITS.OVER_NORM_REASON)
  };
}

/**
 * Kiểm tra mặt hàng & dựng các dòng nội dung (tên mẫu, size, tình trạng, ĐVT, mã lấy từ danh mục — không tin trình duyệt).
 * Trả về { lines, items } (giống vppPrepareSupplyItems_).
 */
function dpPrepareUniformItems_(uniforms) {
  var skuMap = dpSkuMapById_();
  var modelMap = dpModelMap_();
  var errors = {};
  var lines = [];
  uniforms.forEach(function (u, i) {
    var sku = skuMap[u.productId];
    var model = sku ? modelMap[sku.modelId] : null;
    if (!sku || !sku.active || !model || !model.active) {
      errors['uniforms.' + i + '.productId'] = 'Mẫu / size đồng phục không tồn tại hoặc đã ngừng sử dụng';
      return;
    }
    lines.push({
      index: i, productId: sku.productId, sku: sku, model: model, quantity: u.quantity, issueKind: u.issueKind,
      dueDate: u.dueDate, note: u.note, overQuotaReason: u.overQuotaReason,
      product: { productName: dpSkuLabel_(model.modelName, sku.size, sku.condition), unit: model.unit }
    });
  });
  if (Object.keys(errors).length) {
    var keys = Object.keys(errors);
    throw appError_('PRODUCT_NOT_FOUND', errors[keys[0]], { fieldErrors: errors });
  }
  var items = lines.map(function (l) {
    return {
      category: UNIFORM_CATEGORY_CODE,
      itemName: l.model.modelName,
      assetCode: l.sku.skuCode,
      serialNumber: '',
      model: '',
      quantity: l.quantity,
      unit: l.model.unit,
      condition: UNIFORM_CONDITIONS[l.sku.condition],
      description: '',
      workStatus: '',
      deadline: l.issueKind === 'CHO_MUON' ? l.dueDate : '',
      documentUrl: '',
      note: l.note,
      productId: l.productId,
      affectsInventory: true,
      overNormReason: l.overQuotaReason,
      size: l.sku.size,
      issueKind: l.issueKind
    };
  });
  return { lines: lines, items: items };
}

/**
 * Kiểm tra trước khi ghi phiếu đồng phục (trong khóa, đọc tồn mới nhất theo SỔ):
 *   • không đủ tồn → INSUFFICIENT_STOCK (từng dòng: khả dụng / yêu cầu / thiếu) — không cho tạo phiếu;
 *   • vượt tiêu chuẩn năm (tổng hoặc theo mẫu) mà dòng "Cấp phát" chưa có lý do → NORM_EXCEEDED.
 * receiver: nhân viên (findEmployeeById_). handoverId: phiếu đang sửa (số đang giữ chỗ cho chính phiếu được tính là khả dụng).
 */
function dpValidateAllocation_(plan, receiver, handoverId) {
  requireLock_('dpValidateAllocation_');
  var store = dpStore_();
  var ids = [];
  plan.lines.forEach(function (l) { if (ids.indexOf(l.productId) < 0) ids.push(l.productId); });
  var stock = allocationStockMap_(ids, store);
  var own = handoverId ? handoverStockNet_(handoverId, store) : {};
  var fieldErrors = {};
  var inconsistent = plan.lines.filter(function (l) { return stock[l.productId].invalid; });
  if (inconsistent.length) {
    inconsistent.forEach(function (l) {
      fieldErrors['uniforms.' + l.index + '.quantity'] = 'Sổ biến động kho của mặt hàng này cho ra số không hợp lệ — cần kiểm kê trước khi bàn giao.';
    });
    throw appError_('STOCK_INCONSISTENT', 'Sổ biến động kho của ' + inconsistent.map(function (l) { return '"' + l.product.productName + '"'; })
      .join(', ') + ' cho ra số không hợp lệ — hãy kiểm kê trước khi bàn giao.', { fieldErrors: fieldErrors });
  }
  // Cùng mặt hàng có thể ở 2 dòng (cấp phát + cho mượn) — cộng lại rồi so với khả dụng.
  var requested = {};
  plan.lines.forEach(function (l) { requested[l.productId] = (requested[l.productId] || 0) + l.quantity; });
  var shortages = [];
  Object.keys(requested).forEach(function (pid) {
    var s = stock[pid];
    var ownReserved = own[pid] ? Math.max(0, own[pid].reserved) : 0;
    var available = s.onHand === null ? 0 : s.onHand - s.reserved + ownReserved;
    if (requested[pid] <= available) return;
    var avail = Math.max(0, available);
    plan.lines.filter(function (l) { return l.productId === pid; }).forEach(function (l, k) {
      if (k === 0) {
        shortages.push({
          index: l.index, productId: pid, productName: l.product.productName, unit: l.product.unit, available: avail,
          requested: requested[pid], shortage: requested[pid] - avail, unknown: s.onHand === null
        });
      }
      fieldErrors['uniforms.' + l.index + '.quantity'] = s.onHand === null
        ? 'Tồn kho chưa xác định — cần kiểm kê trước khi bàn giao.'
        : 'Không đủ tồn kho. Khả dụng: ' + avail + ', yêu cầu: ' + requested[pid] + ', thiếu: ' + (requested[pid] - avail) + '.';
    });
  });
  if (shortages.length) {
    throw appError_('INSUFFICIENT_STOCK', 'Không đủ tồn kho đồng phục: ' + shortages.map(function (x) {
      return x.productName + ' (khả dụng ' + x.available + ', yêu cầu ' + x.requested + ', thiếu ' + x.shortage + ')';
    }).join('; ') + '.', { shortages: shortages, fieldErrors: fieldErrors });
  }

  // Tiêu chuẩn năm — chỉ dòng "Cấp phát" của mẫu tính tiêu chuẩn.
  var quotaLines = plan.lines.filter(function (l) { return l.issueKind === 'CAP_PHAT' && l.model.countsTowardQuota; });
  if (!quotaLines.length || !receiver) return;
  var year = dpCurrentYear_();
  var modelMap = dpModelMap_();
  var usage = dpUsageIndex_(year, handoverId || '', dpSkuMapById_(), modelMap)[String(receiver.employeeId).toUpperCase()] || null;
  var quota = dpQuotaFor_({ department: receiver.department, gender: dpEmployeeGender_(receiver.gender) }, usage, dpQuotaContext_(modelMap));
  var exceeded = {};
  var u = quota.usage;
  var newTotal = quotaLines.reduce(function (sum, l) { return sum + l.quantity; }, 0);
  if (u.yearlyQuota !== null) {
    var over = u.issued + u.pending + u.legacy + newTotal - u.yearlyQuota;
    if (over > 0) {
      quotaLines.forEach(function (l) {
        if (l.overQuotaReason) return;
        exceeded['uniforms.' + l.index + '.overQuotaReason'] = 'Vượt tiêu chuẩn năm ' + over + ' ' + (l.model.unit || 'cái').toLowerCase() +
          ' (tiêu chuẩn ' + u.yearlyQuota + '/năm, đã cấp ' + (u.issued + u.legacy) + (u.pending ? ', đang chờ ký ' + u.pending : '') +
          ') — nhập lý do vượt tiêu chuẩn.';
      });
    }
  }
  quota.modelQuotas.forEach(function (mq) {
    var lines = quotaLines.filter(function (l) { return l.model.modelId === mq.modelId; });
    if (!lines.length) return;
    var add = lines.reduce(function (sum, l) { return sum + l.quantity; }, 0);
    var overModel = mq.issued + mq.pending + add - mq.yearlyQuota;
    if (overModel <= 0) return;
    lines.forEach(function (l) {
      if (l.overQuotaReason || exceeded['uniforms.' + l.index + '.overQuotaReason']) return;
      exceeded['uniforms.' + l.index + '.overQuotaReason'] = 'Vượt tiêu chuẩn mẫu "' + mq.modelName + '" ' + overModel +
        ' (tiêu chuẩn ' + mq.yearlyQuota + '/năm, đã cấp ' + mq.issued + (mq.pending ? ', đang chờ ký ' + mq.pending : '') +
        ') — nhập lý do vượt tiêu chuẩn.';
    });
  });
  if (Object.keys(exceeded).length) {
    throw appError_('NORM_EXCEEDED', 'Vượt tiêu chuẩn cấp phát đồng phục năm ' + year + ' của ' + receiver.fullName +
      ' — bắt buộc nhập lý do vượt tiêu chuẩn.', { fieldErrors: exceeded });
  }
}

// ============================================================================
// Admin — danh mục mẫu
// ============================================================================

function apiDpListStock_(q) {
  q = q || {};
  healDirtyStockIfNeeded_(dpStore_());
  var catalog = dpStockCatalog_({ includeInactive: q.includeInactive === true });
  var needle = normalizeText_(q.q);
  var models = catalog.models.filter(function (m) {
    if (!needle) return true;
    return normalizeText_([m.modelName, m.modelCode, m.appliesTo, m.sizes.join(' ')].join(' ')).indexOf(needle) >= 0;
  });
  return { models: models };
}

function validateDpModelFields_(data) {
  var errors = {};
  var name = cleanLine_(data.modelName);
  if (!name) errors.modelName = 'Nhập tên mẫu đồng phục';
  else if (name.length > LIMITS.UNIFORM_MODEL_NAME) errors.modelName = 'Tối đa ' + LIMITS.UNIFORM_MODEL_NAME + ' ký tự';
  var code = cleanLine_(data.modelCode).toUpperCase();
  if (code && !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) errors.modelCode = 'Mã chỉ gồm chữ, số, . _ - (tối đa 40 ký tự)';
  var kind = String(data.kind || 'UNIFORM').toUpperCase();
  if (!UNIFORM_KINDS[kind]) errors.kind = 'Chọn loại';
  var gender = String(data.gender || 'UNISEX').toUpperCase();
  if (!UNIFORM_GENDERS[gender]) errors.gender = 'Chọn giới tính áp dụng';
  var rawSizes = Array.isArray(data.sizes) ? data.sizes : String(data.sizes || '').split(/[,;|/\n]+/);
  var sizes = [];
  rawSizes.forEach(function (s) {
    var raw = cleanLine_(s);
    if (!raw) return;
    var size = dpNormalizeSize_(raw);
    if (!size) errors.sizes = 'Size "' + raw + '" không hợp lệ (chữ in hoa / số / dấu gạch, tối đa 10 ký tự)';
    else if (sizes.indexOf(size) >= 0) errors.sizes = 'Size "' + size + '" bị trùng';
    else sizes.push(size);
  });
  if (!sizes.length && !errors.sizes) errors.sizes = 'Nhập ít nhất 1 size';
  if (sizes.length > LIMITS.UNIFORM_MAX_SIZES) errors.sizes = 'Tối đa ' + LIMITS.UNIFORM_MAX_SIZES + ' size';
  var unit = cleanLine_(data.unit) || 'Cái';
  if (unit.length > LIMITS.UNIT) errors.unit = 'Tối đa ' + LIMITS.UNIT + ' ký tự';
  var price = data.referencePrice === null || data.referencePrice === undefined || data.referencePrice === '' ? null : roundPrice_(data.referencePrice);
  if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors.referencePrice = 'Đơn giá không hợp lệ';
  var minimum = data.minimumStock === undefined || data.minimumStock === null || data.minimumStock === '' ? 0 : Number(data.minimumStock);
  if (!isFinite(minimum) || Math.floor(minimum) !== minimum || minimum < 0 || minimum > LIMITS.MAX_QUANTITY) {
    errors.minimumStock = 'Tồn tối thiểu phải là số nguyên ≥ 0';
  }
  var appliesTo = cleanLine_(data.appliesTo);
  if (appliesTo.length > LIMITS.UNIFORM_APPLIES_TO) errors.appliesTo = 'Tối đa ' + LIMITS.UNIFORM_APPLIES_TO + ' ký tự';
  var note = cleanText_(data.note);
  if (note.length > 1000) errors.note = 'Tối đa 1000 ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  return {
    modelName: name, modelCode: code, kind: kind, gender: gender, sizes: sizes, unit: unit, referencePrice: price,
    countsTowardQuota: data.countsTowardQuota === undefined ? kind !== 'PPE' : data.countsTowardQuota === true,
    minimumStock: minimum, appliesTo: appliesTo, note: note, active: data.active === undefined ? true : data.active === true
  };
}

/** Tạo / sửa mẫu. Thêm size → tạo mặt hàng mới; bỏ size → tắt mặt hàng (chỉ khi size đó hết tồn và không giữ chỗ). */
function apiDpSaveModel_(data) {
  var actor = sanitizeActor_(data.actor);
  var modelId = String(data.modelId || '').toLowerCase();
  if (modelId && !isUuid_(modelId)) throw appError_('NOT_FOUND', 'Không tìm thấy mẫu đồng phục.');
  var fields = validateDpModelFields_(data);
  var requestId = optionalRequestId_(data.clientRequestId);
  var store = dpStore_();

  return withScriptLock_(function () {
    var now = nowIso_();
    var models = dpLoadModels_();
    var targetId = modelId || (requestId ? uuidFrom_('dp-model|' + requestId) : uuid_());
    var existingRow = findRow_(SHEETS.DP_MODELS, 'model_id', targetId);
    if (modelId && !existingRow) throw appError_('NOT_FOUND', 'Không tìm thấy mẫu đồng phục.');
    if (!modelId && existingRow) {
      // Gửi lại lần tạo đã lưu (mạng chập chờn) → trả mẫu đã tạo, không tạo trùng.
      var prevModel = dpModelFromRow_(existingRow.record);
      dpEnsureSkus_(prevModel, prevModel.sizes.map(function (s) { return { size: s, condition: 'NEW' }; }), now);
      return { model: dpModelView_(prevModel, []), duplicate: true };
    }
    var nameKey = matchKey_(fields.modelName);
    var clash = models.filter(function (m) {
      return m.modelId !== targetId && m.active && matchKey_(m.modelName) === nameKey && m.gender === fields.gender;
    })[0];
    if (clash && fields.active) {
      throw validationError_({ modelName: 'Đã có mẫu "' + clash.modelName + '" (' + clash.modelCode + ') cùng tên và giới tính.' });
    }
    var prev = existingRow ? dpModelFromRow_(existingRow.record) : null;
    var code = fields.modelCode || (prev ? prev.modelCode : '') || dpNextModelCode_();
    if (dpModelCodeTaken_(code, targetId)) throw validationError_({ modelCode: 'Mã mẫu "' + code + '" đã tồn tại' });

    var skus = dpLoadSkus_().filter(function (s) { return s.modelId === targetId; });
    var skuIds = skus.map(function (s) { return s.productId; });
    var stock = skuIds.length ? effectiveStockMap_(skuIds, loadStockMap_(store), store) : {};
    // Bỏ size / tắt mẫu: không được còn giữ chỗ cho phiếu chờ ký; bỏ size còn tồn → phải kiểm kê / thanh lý trước.
    var problems = [];
    skus.forEach(function (s) {
      var st = stock[s.productId] || { onHand: 0, reserved: 0 };
      var sizeRemoved = fields.sizes.indexOf(s.size) < 0;
      if ((sizeRemoved || !fields.active) && st.reserved > 0) {
        problems.push(dpSkuLabel_(fields.modelName, s.size, s.condition) + ' đang giữ chỗ ' + st.reserved + ' cho phiếu chờ ký');
      } else if (sizeRemoved && s.condition === 'NEW' && st.onHand > 0) {
        problems.push('size ' + s.size + ' còn tồn ' + st.onHand);
      }
    });
    if (problems.length) {
      throw appError_('INVALID_STATE', 'Chưa thể lưu: ' + problems.join('; ') + '. Hãy ký / hủy phiếu chờ, hoặc kiểm kê / thanh lý trước khi bỏ size.');
    }

    var row = {
      model_id: targetId,
      model_code: code,
      model_name: fields.modelName,
      kind: fields.kind,
      gender: fields.gender,
      sizes: fields.sizes.join(','),
      unit: fields.unit,
      reference_price: fields.referencePrice === null ? '' : fields.referencePrice,
      counts_toward_quota: boolCell_(fields.countsTowardQuota),
      minimum_stock: fields.minimumStock,
      applies_to: fields.appliesTo,
      active: boolCell_(fields.active),
      note: fields.note,
      updated_at: now
    };
    var model;
    if (existingRow) {
      updateRowFields_(SHEETS.DP_MODELS, existingRow.rowIndex, existingRow.record, row);
      model = dpModelFromRow_(Object.assign({}, existingRow.record, row));
    } else {
      row.created_at = now;
      appendObjects_(SHEETS.DP_MODELS, [row]);
      model = dpModelFromRow_(row);
    }
    // Mặt hàng mới cho size mới (hàng mới); size bị bỏ → tắt mặt hàng (giữ dòng, giữ lịch sử).
    dpEnsureSkus_(model, model.sizes.map(function (s) { return { size: s, condition: 'NEW' }; }), now);
    skus.forEach(function (s) {
      var changes = {};
      if (model.sizes.indexOf(s.size) < 0 && s.active) changes.active = 'FALSE';
      var wantCode = dpSkuCode_(model.modelCode, s.size, s.condition);
      if (s.skuCode !== wantCode) changes.sku_code = wantCode;
      if (Object.keys(changes).length) {
        changes.updated_at = now;
        updateRowFields_(SHEETS.DP_SKUS, s._row, s._record, changes);
      }
    });
    // Tồn tối thiểu theo mẫu → đồng bộ cột minimum_stock của các dòng tồn hàng mới (cảnh báo sắp hết khi giữ chỗ).
    if (!prev || prev.minimumStock !== model.minimumStock) {
      setColumnForIds_(SHEETS.DP_STOCK, 'minimum_stock', skus.filter(function (s) { return s.condition === 'NEW'; })
        .map(function (s) { return s.productId; }), model.minimumStock);
    }
    afterCommit_('dp_model_history', model.modelCode, function () {
      appendHistory_(model.modelId, prev ? 'DP_MODEL_UPDATED' : 'DP_MODEL_CREATED', actorLabel_(actor), '', '',
        (prev ? 'Sửa' : 'Thêm') + ' mẫu đồng phục ' + model.modelCode + ' – ' + model.modelName + ' (size ' + model.sizes.join(', ') + ')',
        { before: prev, after: row }, 'DP_MODEL');
    });
    var catalog = dpStockCatalog_({ includeInactive: true });
    var view = catalog.models.filter(function (m) { return m.modelId === model.modelId; })[0] || dpModelView_(model, []);
    return { model: view, duplicate: false };
  });
}

// ============================================================================
// Admin — kho (nhập / kiểm kê / thanh lý / lịch sử)
// ============================================================================

function dpRequireSku_(productId) {
  var id = String(productId || '').toLowerCase();
  if (!isUuid_(id)) throw validationError_({ productId: 'Chọn mặt hàng' });
  var found = findRow_(SHEETS.DP_SKUS, 'product_id', id);
  if (!found) throw appError_('PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng đồng phục.');
  var sku = dpSkuFromRow_(Object.assign({ _row: found.rowIndex }, found.record));
  var model = dpModelMap_()[sku.modelId];
  if (!model) throw appError_('PRODUCT_NOT_FOUND', 'Không tìm thấy mẫu của mặt hàng.');
  return { sku: sku, model: model };
}

function dpSkuResult_(sku, model) {
  var store = dpStore_();
  var stock = ledgerStockMap_(loadStockMap_(store), [sku.productId], store)[sku.productId];
  return dpSkuView_(sku, stock, model);
}

function dpReusedError_(prior, label, what) {
  var q = toIntOrNull_(prior.quantity) || 0;
  var recorded = prior.movement_type === MOVEMENT_TYPES.ADJUSTMENT
    ? 'kiểm kê tồn thực tế ' + (toIntOrNull_(prior.on_hand_after) === null ? '?' : toIntOrNull_(prior.on_hand_after))
    : (prior.movement_type === MOVEMENT_TYPES.DISPOSE ? '−' : '+') + Math.abs(q);
  return appError_('REQUEST_REUSED', what + ' (mất kết nối trước khi nhận được phản hồi) ĐÃ ghi ' + recorded + ' cho "' + label + '" lúc ' +
    formatDisplayDateTime_(prior.created_at) + '. Số vừa nhập CHƯA được ghi — tải lại trang để xem tồn hiện tại.',
    { existing: { operationId: prior.operation_id } });
}

function apiDpStockIn_(data) {
  var actor = sanitizeActor_(data.actor);
  var modelId = String(data.modelId || '').toLowerCase();
  var size = dpNormalizeSize_(data.size);
  var condition = dpCondition_(data.condition);
  var reasonType = String(data.reasonType || '').toUpperCase();
  var qty = Number(data.quantity);
  var price = data.unitPrice === null || data.unitPrice === undefined || data.unitPrice === '' ? null : roundPrice_(data.unitPrice);
  var note = cleanText_(data.note);
  var date = String(data.date || '').trim();
  var errors = {};
  if (!isUuid_(modelId)) errors.modelId = 'Chọn mẫu đồng phục';
  if (!size) errors.size = 'Chọn size';
  if (!UNIFORM_STOCK_IN_REASONS[reasonType]) errors.reasonType = 'Chọn lý do nhập kho';
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) errors.quantity = 'Số lượng phải là số nguyên ≥ 1';
  if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors.unitPrice = 'Đơn giá không hợp lệ';
  if (date && !isValidDateOnly_(date)) errors.date = 'Ngày không hợp lệ';
  if (note.length > LIMITS.STOCK_REASON) errors.note = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (reasonType === 'KHAC' && !note) errors.note = 'Nhập ghi chú cho lý do "Khác"';
  if (Object.keys(errors).length) throw validationError_(errors);
  var operationId = requireOperationId_('DP_STOCK_IN', data.clientRequestId);
  var store = dpStore_();

  return withScriptLock_(function () {
    var found = dpFindModelRow_(modelId);
    if (!found) throw appError_('PRODUCT_NOT_FOUND', 'Không tìm thấy mẫu đồng phục.');
    var model = dpModelFromRow_(found.record);
    if (!model.active) throw appError_('INVALID_STATE', 'Mẫu đồng phục đã ngừng sử dụng.');
    if (model.sizes.indexOf(size) < 0) {
      throw validationError_({ size: 'Size ' + size + ' không thuộc mẫu "' + model.modelName + '" (' + model.sizes.join(', ') + ') — thêm size vào mẫu trước.' });
    }
    var now = nowIso_();
    var sku = dpEnsureSkus_(model, [{ size: size, condition: condition }], now)[size + '|' + condition];
    var type = reasonType === 'TON_DAU_KY' ? MOVEMENT_TYPES.INITIAL : MOVEMENT_TYPES.IN;
    var reason = truncate_(UNIFORM_STOCK_IN_REASONS[reasonType] + (date ? ' · ngày ' + formatDisplayDate_(date) : '') +
      (price !== null ? ' · đơn giá ' + price : '') + (note ? ' · ' + note : ''), 1000);
    var prior = priorOperation_(operationId, store);
    if (prior) {
      var same = String(prior.product_id).toLowerCase() === sku.productId && prior.movement_type === type &&
        toIntOrNull_(prior.quantity) === qty && String(prior.reason) === reason;
      if (!same) throw dpReusedError_(prior, dpSkuLabel_(model.modelName, size, condition), 'Lần nhập kho trước');
    } else {
      applyStockMovements_([{ productId: sku.productId, type: type, quantity: qty, operationId: operationId, reason: reason }], actor, now, store);
    }
    return { sku: dpSkuResult_(sku, model), duplicate: Boolean(prior) };
  });
}

function apiDpStockAdjust_(data) {
  var actor = sanitizeActor_(data.actor);
  var counted = Number(data.countedQuantity);
  var reason = cleanText_(data.reason);
  var errors = {};
  if (!isFinite(counted) || Math.floor(counted) !== counted || counted < 0 || counted > LIMITS.MAX_QUANTITY) {
    errors.countedQuantity = 'Tồn kiểm kê phải là số nguyên ≥ 0';
  }
  if (reason.length < 3) errors.reason = 'Nhập lý do điều chỉnh / kiểm kê';
  else if (reason.length > LIMITS.STOCK_REASON) errors.reason = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (!isUuid_(String(data.productId || ''))) errors.productId = 'Chọn mặt hàng';
  if (Object.keys(errors).length) throw validationError_(errors);
  var operationId = requireOperationId_('DP_ADJUST', data.clientRequestId);
  var store = dpStore_();

  return withScriptLock_(function () {
    var ref = dpRequireSku_(data.productId);
    var label = dpSkuLabel_(ref.model.modelName, ref.sku.size, ref.sku.condition);
    var prior = priorOperation_(operationId, store);
    if (prior) {
      var same = String(prior.product_id).toLowerCase() === ref.sku.productId && prior.movement_type === MOVEMENT_TYPES.ADJUSTMENT &&
        toIntOrNull_(prior.on_hand_after) === counted && String(prior.reason).slice(-(reason.length + 3)) === ' · ' + reason;
      if (!same) throw dpReusedError_(prior, label, 'Lần kiểm kê trước');
    } else {
      applyStockMovements_([{
        productId: ref.sku.productId,
        type: MOVEMENT_TYPES.ADJUSTMENT,
        setTo: counted,
        quantity: 0,
        operationId: operationId,
        reason: function (systemQty) {
          return 'Kiểm kê: hệ thống ' + (systemQty === null ? 'chưa rõ' : systemQty) + ' → thực tế ' + counted + ' · ' + reason;
        },
        resolveReview: true
      }], actor, nowIso_(), store);
    }
    return { sku: dpSkuResult_(ref.sku, ref.model), duplicate: Boolean(prior) };
  });
}

function apiDpStockDispose_(data) {
  var actor = sanitizeActor_(data.actor);
  var qty = Number(data.quantity);
  var reason = cleanText_(data.reason);
  var errors = {};
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) errors.quantity = 'Số lượng phải là số nguyên ≥ 1';
  if (reason.length < 3) errors.reason = 'Nhập lý do thanh lý / hủy';
  else if (reason.length > LIMITS.STOCK_REASON) errors.reason = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (!isUuid_(String(data.productId || ''))) errors.productId = 'Chọn mặt hàng';
  if (Object.keys(errors).length) throw validationError_(errors);
  var operationId = requireOperationId_('DP_DISPOSE', data.clientRequestId);
  var store = dpStore_();

  return withScriptLock_(function () {
    var ref = dpRequireSku_(data.productId);
    var label = dpSkuLabel_(ref.model.modelName, ref.sku.size, ref.sku.condition);
    var text = truncate_('Thanh lý / hủy · ' + reason, 1000);
    var prior = priorOperation_(operationId, store);
    if (prior) {
      var same = String(prior.product_id).toLowerCase() === ref.sku.productId && prior.movement_type === MOVEMENT_TYPES.DISPOSE &&
        toIntOrNull_(prior.quantity) === qty && String(prior.reason) === text;
      if (!same) throw dpReusedError_(prior, label, 'Lần thanh lý trước');
    } else {
      applyStockMovements_([{ productId: ref.sku.productId, type: MOVEMENT_TYPES.DISPOSE, quantity: qty, operationId: operationId, reason: text }],
        actor, nowIso_(), store);
    }
    return { sku: dpSkuResult_(ref.sku, ref.model), duplicate: Boolean(prior) };
  });
}

function apiDpListMovements_(q) {
  q = q || {};
  var exportAll = q.exportAll === true;
  var page = exportAll ? 1 : clampInt_(q.page, 1, 100000, 1);
  var pageSize = exportAll ? APP.EXPORT_MAX_ROWS : clampInt_(q.pageSize, 10, 200, 50);
  var productId = isUuid_(q.productId) ? String(q.productId).toLowerCase() : '';
  var modelId = isUuid_(q.modelId) ? String(q.modelId).toLowerCase() : '';
  var type = MOVEMENT_TYPES[String(q.type || '').toUpperCase()] || '';
  var from = isValidDateOnly_(q.from) ? q.from : '';
  var to = isValidDateOnly_(q.to) ? q.to : '';
  var needle = normalizeText_(q.q);
  var info = dpSkuInfoMap_();
  var rows = readTable_(SHEETS.DP_MOVEMENTS).rows.filter(function (r) {
    if (!r.movement_id) return false;
    var pid = String(r.product_id).toLowerCase();
    if (productId && pid !== productId) return false;
    if (modelId && (!info[pid] || info[pid].modelId !== modelId)) return false;
    if (type && r.movement_type !== type) return false;
    var day = String(r.created_at || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (needle) {
      var p = info[pid];
      var hay = normalizeText_([p ? p.productName : '', p ? p.productCode : '', r.reason, r.actor_name, r.employee_id, r.operation_id].join(' '));
      if (hay.indexOf(needle) < 0) return false;
    }
    return true;
  });
  rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b._row - a._row; });
  var codes = {};
  if (rows.some(function (r) { return r.handover_id; })) {
    readColumns_(SHEETS.HANDOVERS, ['handover_id', 'handover_code']).forEach(function (h) { codes[h.handover_id] = h.handover_code; });
  }
  var start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize).map(function (r) {
      var pid = String(r.product_id).toLowerCase();
      var p = info[pid];
      return {
        movementId: r.movement_id,
        productId: pid,
        modelId: p ? p.modelId : '',
        modelName: p ? p.modelName : '(không rõ)',
        skuCode: p ? p.productCode : '',
        size: p ? p.size : '',
        condition: p ? p.condition : '',
        movementType: r.movement_type,
        quantity: toIntOrNull_(r.quantity) || 0,
        onHandBefore: toIntOrNull_(r.on_hand_before),
        onHandAfter: toIntOrNull_(r.on_hand_after),
        reservedBefore: toIntOrNull_(r.reserved_before) || 0,
        reservedAfter: toIntOrNull_(r.reserved_after) || 0,
        handoverId: r.handover_id || '',
        handoverCode: codes[r.handover_id] || '',
        employeeId: r.employee_id || '',
        operationId: r.operation_id || '',
        actorId: r.actor_id || '',
        actorName: r.actor_name || '',
        reason: r.reason || '',
        createdAt: r.created_at
      };
    }),
    total: rows.length,
    page: page,
    pageSize: pageSize
  };
}

// ============================================================================
// Admin — tiêu chuẩn cấp phát năm
// ============================================================================

function apiDpListNorms_() {
  var modelMap = dpModelMap_();
  var day = todayIsoDate_();
  var all = dpLoadNorms_();
  var norms = all.map(function (n) {
    var out = Object.assign({}, n);
    var m = n.modelId ? modelMap[n.modelId] : null;
    out.modelName = n.modelId ? (m ? m.modelName : '(mẫu đã xóa)') : '';
    out.effective = dpIsNormEffective_(n, day, modelMap);
    return out;
  }).sort(function (a, b) {
    if (a.scopeId !== b.scopeId) return a.scopeId < b.scopeId ? -1 : 1;
    if (Boolean(a.modelId) !== Boolean(b.modelId)) return a.modelId ? 1 : -1;
    return compareVi_(a.modelName, b.modelName);
  });
  var scopes = dpListScopes_(all);
  var settings = getSettings_();
  var depts = {};
  getEmployees_().forEach(function (e) {
    if (e.status !== 'ACTIVE' || !e.department) return;
    // Gộp phòng ban chỉ khác hoa / thường / dấu / khoảng trắng ("Kế toán - HCNS" = "KẾ TOÁN - HCNS").
    var key = slugKey_(e.department, 80);
    var d = depts[key] || (depts[key] = { department: e.department, employeeCount: 0 });
    d.employeeCount++;
  });
  var departments = Object.keys(depts).map(function (k) { return depts[k]; })
    .sort(function (a, b) { return compareVi_(a.department, b.department); })
    .map(function (d) {
      var resolved = dpResolveScope_(d.department, scopes, settings);
      return {
        department: d.department,
        employeeCount: d.employeeCount,
        scope: resolved.scope,
        mapping: String(settings[dpScopeSettingKey_(d.department)] || '').trim().toUpperCase()
      };
    });
  return { norms: norms, scopes: scopes, departments: departments, defaultYearlyQuota: dpDefaultYearlyQuota_(settings) };
}

function apiDpSaveNorm_(data) {
  var actor = sanitizeActor_(data.actor);
  var normId = String(data.normId || '').toLowerCase();
  if (normId && !isUuid_(normId)) throw appError_('NOT_FOUND', 'Không tìm thấy tiêu chuẩn.');
  var scopeName = cleanLine_(data.scopeName);
  var scopeId = String(data.scopeId || '').trim().toUpperCase() || slugKey_(scopeName, 40);
  var modelId = String(data.modelId || '').trim().toLowerCase();
  var gender = data.gender ? dpEmployeeGender_(data.gender) : '';
  var qty = Number(data.yearlyQuantity);
  var from = String(data.effectiveFrom || '').trim();
  var to = String(data.effectiveTo || '').trim();
  var note = cleanText_(data.note);
  var errors = {};
  if (!/^[A-Z0-9_]{1,40}$/.test(scopeId)) errors.scopeId = 'Chọn nhóm áp dụng hoặc nhập tên nhóm mới (ví dụ: SHOWROOM)';
  if (modelId && !isUuid_(modelId)) errors.modelId = 'Mẫu không hợp lệ';
  if (data.gender && !gender) errors.gender = 'Giới tính không hợp lệ';
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_YEARLY_QUOTA) {
    errors.yearlyQuantity = 'Tiêu chuẩn phải là số nguyên từ 0 đến ' + LIMITS.MAX_YEARLY_QUOTA;
  }
  if (from && !isValidDateOnly_(from)) errors.effectiveFrom = 'Ngày không hợp lệ';
  if (to && !isValidDateOnly_(to)) errors.effectiveTo = 'Ngày không hợp lệ';
  if (from && to && to < from) errors.effectiveTo = 'Ngày kết thúc phải sau ngày bắt đầu';
  if (note.length > 1000) errors.note = 'Tối đa 1000 ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  var active = data.active === undefined ? true : data.active === true;

  return withScriptLock_(function () {
    var modelMap = dpModelMap_();
    if (modelId && !modelMap[modelId]) throw validationError_({ modelId: 'Không tìm thấy mẫu đồng phục' });
    var norms = dpLoadNorms_();
    var day = todayIsoDate_();
    var clash = norms.filter(function (n) {
      return n.normId !== normId && n.scopeId === scopeId && n.modelId === modelId && n.gender === gender && n.active && active &&
        isNormEffective_(n, day) && (!from || from <= day) && (!to || to >= day);
    })[0];
    if (clash) {
      throw validationError_({ scopeId: 'Nhóm ' + scopeId + ' đã có tiêu chuẩn đang hiệu lực cho ' +
        (modelId ? 'mẫu "' + modelMap[modelId].modelName + '"' : 'tổng các mẫu') + (gender ? ' (' + EMPLOYEE_GENDERS[gender] + ')' : '') +
        ' — hãy sửa tiêu chuẩn cũ.' });
    }
    if (!scopeName) {
      var existing = norms.filter(function (n) { return n.scopeId === scopeId; })[0];
      if (!existing) throw validationError_({ scopeName: 'Nhóm "' + scopeId + '" chưa có — nhập tên nhóm mới' });
      scopeName = existing.scopeName;
    }
    var now = nowIso_();
    var fields = {
      scope_id: scopeId,
      scope_name: scopeName,
      model_id: modelId,
      gender: dpGenderCell_(gender),
      yearly_quantity: qty,
      note: note,
      effective_from: from,
      effective_to: to,
      active: boolCell_(active),
      updated_at: now
    };
    var saved;
    var label = scopeName + (modelId ? ' · ' + modelMap[modelId].modelName : ' · tổng') + (gender ? ' · ' + EMPLOYEE_GENDERS[gender] : '');
    if (normId) {
      var found = findRow_(SHEETS.DP_NORMS, 'norm_id', normId);
      if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy tiêu chuẩn.');
      updateRowFields_(SHEETS.DP_NORMS, found.rowIndex, found.record, fields);
      saved = dpNormFromRow_(Object.assign({}, found.record, fields));
      appendHistory_(normId, 'DP_NORM_UPDATED', actorLabel_(actor), '', '',
        'Sửa tiêu chuẩn đồng phục ' + label + ': ' + found.record.yearly_quantity + ' → ' + qty + '/năm',
        { before: dpNormFromRow_(found.record), after: fields }, 'DP_NORM');
    } else {
      var row = Object.assign({ norm_id: uuid_(), created_at: now }, fields);
      appendObjects_(SHEETS.DP_NORMS, [row]);
      saved = dpNormFromRow_(row);
      appendHistory_(row.norm_id, 'DP_NORM_CREATED', actorLabel_(actor), '', '',
        'Thêm tiêu chuẩn đồng phục ' + label + ': ' + qty + '/năm', { after: fields }, 'DP_NORM');
    }
    var out = Object.assign({}, saved);
    out.modelName = modelId ? modelMap[modelId].modelName : '';
    out.effective = dpIsNormEffective_(saved, day, modelMap);
    return { norm: out };
  });
}

/** Gắn phòng ban → nhóm tiêu chuẩn đồng phục ('' = tự khớp theo tên / mặc định, "NONE" = không áp dụng tiêu chuẩn). */
function apiDpSetScopeMapping_(data) {
  var actor = sanitizeActor_(data.actor);
  var department = cleanLine_(data.department);
  var scopeId = String(data.scopeId || '').trim().toUpperCase();
  if (!department) throw validationError_({ department: 'Thiếu phòng ban' });
  if (scopeId && scopeId !== 'NONE' && !/^[A-Z0-9_]{1,40}$/.test(scopeId)) throw validationError_({ scopeId: 'Nhóm không hợp lệ' });
  if (scopeId && scopeId !== 'NONE' && !dpListScopes_().some(function (s) { return s.scopeId === scopeId; })) {
    throw validationError_({ scopeId: 'Nhóm tiêu chuẩn không tồn tại' });
  }
  return withScriptLock_(function () {
    upsertSetting_(dpScopeSettingKey_(department), scopeId, 'Nhóm tiêu chuẩn đồng phục của phòng ban: ' + department);
    appendHistory_(dpScopeSettingKey_(department), 'DP_SCOPE_MAPPED', actorLabel_(actor), '', scopeId,
      'Gắn phòng ban "' + department + '" → ' + (scopeId === 'NONE' ? 'không áp dụng tiêu chuẩn' : scopeId || '(tự khớp / mặc định)'),
      null, 'DP_NORM');
    var resolved = dpResolveScope_(department);
    return { department: department, scope: resolved.scope, mapping: scopeId };
  });
}

// ============================================================================
// Admin — sổ cấp phát theo nhân viên
// ============================================================================

function dpEmployeeRow_(e, quota, holdingSummary) {
  return {
    employeeId: e.employeeId,
    fullName: e.fullName,
    department: e.department,
    position: e.position,
    status: e.status,
    gender: dpEmployeeGender_(e.gender),
    uniformSize: dpNormalizeSize_(e.uniformSize) || cleanLine_(e.uniformSize).toUpperCase(),
    scope: quota.scope,
    usage: quota.usage,
    modelQuotas: quota.modelQuotas,
    holdings: holdingSummary || { loaned: 0, overdue: 0, holding: 0 },
    suggestedModelIds: quota.suggestedModelIds,
    lastIssuedAt: quota.lastIssuedAt
  };
}

/** Danh sách nhân viên kèm tiêu chuẩn năm (dùng chung cho trang Nhân viên, dashboard, xuất CSV). */
function dpEmployeeRegister_(year, options) {
  options = options || {};
  var modelMap = dpModelMap_();
  var usage = dpUsageIndex_(year, '', dpSkuMapById_(), modelMap);
  var ctx = dpQuotaContext_(modelMap);
  var holdings = dpHoldingSummaryByEmployee_(dpHoldings_({}));
  var needle = normalizeText_(options.q);
  var deptKey = options.department ? slugKey_(options.department, 80) : '';
  return getEmployees_()
    .filter(function (e) {
      if (!options.includeInactive && e.status !== 'ACTIVE') return false;
      if (deptKey && slugKey_(e.department, 80) !== deptKey) return false;
      if (needle && normalizeText_([e.fullName, e.employeeId, e.department, e.position].join(' ')).indexOf(needle) < 0) return false;
      return true;
    })
    .map(function (e) {
      var key = e.employeeId.toUpperCase();
      var quota = dpQuotaFor_({ department: e.department, gender: dpEmployeeGender_(e.gender) }, usage[key] || null, ctx);
      return dpEmployeeRow_(e, quota, holdings[key]);
    });
}

function apiDpListEmployees_(q) {
  q = q || {};
  var year = clampInt_(q.year, 2020, 2100, dpCurrentYear_());
  var rows = dpEmployeeRegister_(year, { q: q.q, department: q.department, includeInactive: q.includeInactive === true });
  var stats = { total: rows.length, missingSize: 0, missingGender: 0, overQuota: 0, withLoans: 0, overdueLoans: 0 };
  rows.forEach(function (r) {
    if (r.status !== 'ACTIVE') return;
    if (!r.uniformSize) stats.missingSize++;
    if (!r.gender) stats.missingGender++;
    if (r.usage.remaining !== null && r.usage.remaining < 0) stats.overQuota++;
    if (r.holdings.loaned > 0) stats.withLoans++;
    if (r.holdings.overdue > 0) stats.overdueLoans++;
  });
  return { year: year, employees: rows, scopes: dpListScopes_(), stats: stats };
}

/** Ghi giới tính / size vào NHAN_VIEN (đúng dòng theo mã nhân viên, không theo số dòng). */
function apiDpSaveEmployeeProfile_(data) {
  var actor = sanitizeActor_(data.actor);
  var employeeId = cleanLine_(data.employeeId);
  var gender = data.gender ? dpEmployeeGender_(data.gender) : '';
  var rawSize = cleanLine_(data.uniformSize);
  var size = rawSize ? dpNormalizeSize_(rawSize) : '';
  var errors = {};
  if (!employeeId) errors.employeeId = 'Thiếu mã nhân viên';
  if (data.gender && !gender) errors.gender = 'Giới tính không hợp lệ';
  if (rawSize && !size) errors.uniformSize = 'Size không hợp lệ (S, M, L, XL, XXL, 3XL…)';
  if (Object.keys(errors).length) throw validationError_(errors);

  var updated = withScriptLock_(function () {
    var key = employeeId.toUpperCase();
    var row = readTable_(SHEETS.EMPLOYEES).rows.filter(function (r) { return cleanLine_(r.employee_id).toUpperCase() === key; })[0];
    if (!row) throw appError_('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên ' + employeeId + '.');
    var before = { gender: dpEmployeeGender_(row.gender), uniformSize: cleanLine_(row.uniform_size) };
    var changes = { gender: dpGenderCell_(gender), uniform_size: size, updated_at: nowIso_() };
    updateRowFields_(SHEETS.EMPLOYEES, row._row, row, changes);
    cacheRemove_(CACHE_KEYS.EMPLOYEES);
    afterCommit_('dp_profile_history', employeeId, function () {
      appendHistory_(employeeId, 'DP_PROFILE_UPDATED', actorLabel_(actor), '', '',
        'Hồ sơ đồng phục ' + cleanLine_(row.full_name) + ': giới tính ' + (EMPLOYEE_GENDERS[before.gender] || 'chưa rõ') + ' → ' +
          (EMPLOYEE_GENDERS[gender] || 'chưa rõ') + ', size ' + (before.uniformSize || 'chưa rõ') + ' → ' + (size || 'chưa rõ'),
        { before: before, after: { gender: gender, uniformSize: size } }, 'EMPLOYEE');
    });
    return cleanLine_(row.employee_id);
  });
  var year = dpCurrentYear_();
  var row = dpEmployeeRegister_(year, { includeInactive: true }).filter(function (r) {
    return r.employeeId.toUpperCase() === updated.toUpperCase();
  })[0];
  return { employee: row || null };
}

function apiDpEmployeeDetail_(data) {
  var employee = findEmployeeById_(cleanLine_(data.employeeId));
  if (!employee) throw appError_('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.');
  var year = clampInt_(data.year, 2020, 2100, dpCurrentYear_());
  var key = employee.employeeId.toUpperCase();
  var returns = dpLoadReturns_();
  var codes = {};
  var holdings = dpHoldings_({ employeeId: employee.employeeId }, returns, codes);
  var modelMap = dpModelMap_();
  var usage = dpUsageIndex_(year, '', dpSkuMapById_(), modelMap)[key] || null;
  var quota = dpQuotaFor_({ department: employee.department, gender: dpEmployeeGender_(employee.gender) }, usage, dpQuotaContext_(modelMap));
  var row = dpEmployeeRow_(employee, quota, dpHoldingSummaryByEmployee_(holdings)[key]);

  // Lịch sử phiếu đồng phục (mọi trạng thái) + đồng phục ghi tay ở phiếu loại khác.
  var heads = readColumns_(SHEETS.HANDOVERS, [
    'handover_id', 'handover_code', 'status', 'handover_type', 'receiver_employee_id', 'created_at', 'confirmed_at', 'items_revision'
  ]).filter(function (h) { return h.handover_id && String(h.receiver_employee_id || '').trim().toUpperCase() === key; });
  var byId = {};
  heads.forEach(function (h) { byId[h.handover_id] = h; codes[h.handover_id] = h.handover_code; });
  var issues = {};
  var legacy = [];
  if (heads.length) {
    readColumns_(SHEETS.ITEMS, [
      'handover_id', 'category', 'item_name', 'quantity', 'size', 'condition', 'issue_kind', 'deadline', 'description', 'superseded_at',
      'revision_id', 'item_order'
    ]).forEach(function (it) {
      var h = byId[it.handover_id];
      if (!h || !isCommittedItemRow_(it, h.items_revision || '')) return;
      var category = String(it.category || '').trim().toUpperCase();
      var type = String(h.handover_type || '').trim().toUpperCase();
      if (type === 'UNIFORM' && category === UNIFORM_CATEGORY_CODE) {
        var entry = issues[h.handover_id] || (issues[h.handover_id] = {
          handoverId: h.handover_id, handoverCode: h.handover_code, status: h.status, createdAt: h.created_at,
          confirmedAt: h.confirmed_at || '', lines: []
        });
        var kind = String(it.issue_kind || '').toUpperCase() === 'CHO_MUON' ? 'CHO_MUON' : 'CAP_PHAT';
        entry.lines.push({
          modelName: cleanLine_(it.item_name), size: cleanLine_(it.size),
          condition: it.condition === UNIFORM_CONDITIONS.USED ? 'USED' : it.condition ? 'NEW' : '',
          quantity: toIntOrNull_(it.quantity) || 0, issueKind: kind, dueDate: kind === 'CHO_MUON' ? normalizeDateOnly_(it.deadline) : ''
        });
      } else if (type !== 'UNIFORM' && h.status === STATUS.CONFIRMED && dpIsLegacyUniformText_(it.item_name, it.description)) {
        legacy.push({
          handoverId: h.handover_id, handoverCode: h.handover_code, category: category, itemName: cleanLine_(it.item_name),
          quantity: toIntOrNull_(it.quantity), description: cleanText_(it.description), confirmedAt: h.confirmed_at || ''
        });
      }
    });
  }
  var skuInfo = dpSkuInfoMap_();
  return {
    year: year,
    employee: row,
    holdings: holdings.sort(function (a, b) { return a.confirmedAt < b.confirmedAt ? 1 : -1; }),
    returns: returns.filter(function (r) { return r.employeeId.toUpperCase() === key; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .map(function (r) { return dpReturnView_(r, codes, skuInfo); }),
    issues: Object.keys(issues).map(function (id) { return issues[id]; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }),
    legacyItems: legacy.sort(function (a, b) { return a.confirmedAt < b.confirmedAt ? 1 : -1; })
  };
}

function dpReturnView_(r, codes, skuInfo) {
  var p = skuInfo[r.productId];
  return {
    returnId: r.returnId,
    handoverId: r.handoverId,
    handoverCode: codes[r.handoverId] || '',
    itemId: r.itemId,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    productId: r.productId,
    modelName: p ? p.modelName : '',
    size: r.size,
    quantity: r.quantity,
    result: r.result,
    restockProductId: r.restockProductId,
    restockCondition: r.restockCondition,
    reason: r.reason,
    note: r.note,
    actorName: r.actorName,
    createdAt: r.createdAt
  };
}

// ============================================================================
// Admin — ngữ cảnh form tạo / sửa phiếu đồng phục
// ============================================================================

function apiDpHandoverContext_(data) {
  var receiver = data.receiverEmployeeId ? findEmployeeById_(cleanLine_(data.receiverEmployeeId)) : null;
  var handoverId = isUuid_(data.handoverId) ? String(data.handoverId).toLowerCase() : '';
  var store = dpStore_();
  healDirtyStockIfNeeded_(store);
  var own = handoverId ? handoverStockNet_(handoverId, store) : {};
  var catalog = dpStockCatalog_({ own: own });
  var year = dpCurrentYear_();
  var quota = null;
  var gender = receiver ? dpEmployeeGender_(receiver.gender) : '';
  if (receiver) {
    var usage = dpUsageIndex_(year, handoverId, dpSkuMapById_(), catalog.modelMap)[receiver.employeeId.toUpperCase()] || null;
    quota = dpQuotaFor_({ department: receiver.department, gender: gender }, usage, dpQuotaContext_(catalog.modelMap));
  }
  var suggested = {};
  (quota ? quota.suggestedModelIds : []).forEach(function (id) { suggested[id] = true; });
  var models = catalog.models.map(function (m) {
    m.suggested = Boolean(suggested[m.modelId]);
    m.skus = m.skus.filter(function (s) { return s.active || s.reservedByThisHandover > 0; });
    return m;
  }).sort(function (a, b) {
    if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
    var ga = gender && (a.gender === gender || a.gender === 'UNISEX') ? 0 : 1;
    var gb = gender && (b.gender === gender || b.gender === 'UNISEX') ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return compareVi_(a.modelName, b.modelName);
  });
  return {
    receiver: receiver ? {
      employeeId: receiver.employeeId, fullName: receiver.fullName, department: receiver.department, position: receiver.position,
      gender: gender, uniformSize: dpNormalizeSize_(receiver.uniformSize)
    } : null,
    scope: quota ? quota.scope : null,
    year: year,
    usage: quota ? quota.usage : null,
    modelQuotas: quota ? quota.modelQuotas : [],
    models: models
  };
}

// ============================================================================
// Admin — mượn / trả / thu hồi
// ============================================================================

function apiDpListHoldings_(q) {
  q = q || {};
  var status = String(q.status || 'loans');
  var today = todayIsoDate_();
  var soon = APP.DP_DUE_SOON_DAYS;
  var all = dpHoldings_({ employeeId: q.employeeId });
  var stats = { loans: 0, overdue: 0, dueSoon: 0, issued: 0 };
  all.forEach(function (x) {
    if (x.outstanding <= 0) return;
    if (x.issueKind === 'CHO_MUON') {
      stats.loans++;
      if (x.overdue) stats.overdue++;
      else if (x.dueDate && dpDaysBetween_(today, x.dueDate) <= soon) stats.dueSoon++;
    } else {
      stats.issued++;
    }
  });
  var needle = normalizeText_(q.q);
  var items = all.filter(function (x) {
    if (status === 'loans' && !(x.issueKind === 'CHO_MUON' && x.outstanding > 0)) return false;
    if (status === 'overdue' && !x.overdue) return false;
    if (status === 'outstanding' && !(x.outstanding > 0)) return false;
    if (needle && normalizeText_([x.employeeName, x.employeeId, x.department, x.handoverCode, x.modelName, x.size].join(' ')).indexOf(needle) < 0) {
      return false;
    }
    return true;
  }).sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueDate !== b.dueDate) return !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate < b.dueDate ? -1 : 1;
    return a.confirmedAt < b.confirmedAt ? 1 : -1;
  });
  return { items: items, total: items.length, stats: stats };
}

/**
 * Ghi nhận nhân viên trả / thu hồi đồng phục của một dòng phiếu đã ký. Hội tụ theo clientRequestId: gửi lại (mất phản hồi)
 * không ghi 2 lần — dòng DP_THU_HOI ghi trước, nhập lại kho (RETURN, operation_id DP_RETURN:<mã>) ghi sau; lần gửi lại bổ sung bước
 * còn thiếu. Gửi lại cùng mã với nội dung khác → REQUEST_REUSED.
 */
function apiDpRecordReturn_(data) {
  var actor = sanitizeActor_(data.actor);
  var handoverId = String(data.handoverId || '').toLowerCase();
  var itemId = String(data.itemId || '').toLowerCase();
  var qty = Number(data.quantity);
  var result = String(data.result || '').toUpperCase();
  var restockCondition = result === 'RESTOCK' ? String(data.restockCondition || '').toUpperCase() : '';
  var reason = String(data.reason || '').toUpperCase();
  var note = cleanText_(data.note);
  var errors = {};
  if (!isUuid_(handoverId)) errors.handoverId = 'Thiếu phiếu bàn giao';
  if (!isUuid_(itemId)) errors.itemId = 'Thiếu dòng đồng phục';
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) errors.quantity = 'Số lượng phải là số nguyên ≥ 1';
  if (!RETURN_RESULTS[result]) errors.result = 'Chọn kết quả';
  if (result === 'RESTOCK' && !UNIFORM_CONDITIONS[restockCondition]) errors.restockCondition = 'Chọn tình trạng hàng nhập lại kho';
  if (!RETURN_REASONS[reason]) errors.reason = 'Chọn lý do';
  if (note.length > LIMITS.STOCK_REASON) errors.note = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  else if ((reason === 'KHAC' || (result && result !== 'RESTOCK')) && !note) errors.note = 'Nhập ghi chú (mô tả hư hỏng / mất / lý do khác)';
  if (Object.keys(errors).length) throw validationError_(errors);
  var requestId = optionalRequestId_(data.clientRequestId);
  if (!requestId) throw appError_('BAD_REQUEST', 'Thiếu mã thao tác (clientRequestId).');
  var operationId = 'DP_RETURN:' + requestId;
  var store = dpStore_();

  var outcome = withScriptLock_(function () {
    var found = findHandoverById_(handoverId);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    var items = loadItems_(handoverId, rec);
    if (rec.status !== STATUS.CONFIRMED || effectiveHandoverType_(rec, items) !== 'UNIFORM') {
      throw appError_('INVALID_STATE', 'Chỉ ghi nhận trả cho phiếu đồng phục đã được người nhận ký xác nhận.');
    }
    var item = items.filter(function (i) { return String(i.itemId).toLowerCase() === itemId; })[0];
    if (!item || item.category !== UNIFORM_CATEGORY_CODE) throw appError_('NOT_FOUND', 'Không tìm thấy dòng đồng phục trong biên bản.');
    var sku = dpSkuMapById_()[item.productId];
    var model = sku ? dpModelMap_()[sku.modelId] : null;
    if (!sku || !model) throw appError_('PRODUCT_NOT_FOUND', 'Không tìm thấy mẫu / size của dòng đồng phục.');
    var label = dpSkuLabel_(model.modelName, sku.size, sku.condition);
    var now = nowIso_();
    var returns = dpLoadReturns_();
    var prior = returns.filter(function (r) { return r.clientRequestId === requestId; })[0];
    var record;
    if (prior) {
      var same = prior.itemId === itemId && prior.quantity === qty && prior.result === result &&
        (prior.restockCondition || '') === (restockCondition || '');
      if (!same) {
        throw appError_('REQUEST_REUSED', 'Lần ghi nhận trước (mất kết nối trước khi nhận được phản hồi) ĐÃ ghi ' + prior.quantity + ' ' +
          label + ' — ' + RETURN_RESULTS[prior.result] + ' lúc ' + formatDisplayDateTime_(prior.createdAt) +
          '. Nội dung vừa nhập CHƯA được ghi — tải lại trang để xem số còn giữ.', { existing: { returnId: prior.returnId } });
      }
      record = prior;
    } else {
      var already = returns.filter(function (r) { return r.itemId === itemId; }).reduce(function (s, r) { return s + r.quantity; }, 0);
      var outstanding = (item.quantity || 0) - already;
      if (qty > outstanding) {
        throw validationError_({ quantity: outstanding > 0
          ? 'Chỉ còn ' + outstanding + ' chưa trả (đã ghi nhận ' + already + '/' + item.quantity + ').'
          : 'Dòng này đã được ghi nhận trả / thu hồi đủ ' + item.quantity + '.' });
      }
      var restockSku = null;
      if (result === 'RESTOCK') {
        // Nhận lại vào kho đúng mẫu + size, theo tình trạng thực tế (thường là "đã qua sử dụng").
        restockSku = dpEnsureSkus_(model, [{ size: sku.size, condition: restockCondition }], now)[sku.size + '|' + restockCondition];
      }
      var row = {
        return_id: uuidFrom_('dp-return|' + requestId),
        handover_id: handoverId,
        item_id: itemId,
        employee_id: rec.receiver_employee_id,
        employee_name: rec.receiver_name,
        department: rec.receiver_department || '',
        product_id: sku.productId,
        model_id: model.modelId,
        size: sku.size,
        quantity: qty,
        result: result,
        restock_product_id: restockSku ? restockSku.productId : '',
        restock_condition: restockSku ? restockCondition : '',
        reason: reason,
        note: note,
        actor_id: actor.id,
        actor_name: actorLabel_(actor),
        client_request_id: requestId,
        created_at: now
      };
      appendObjects_(SHEETS.DP_RETURNS, [row]);
      record = dpReturnFromRow_(row);
      afterCommit_('dp_return_history', rec.handover_code, function () {
        appendHistory_(handoverId, 'DP_RETURNED', actorLabel_(actor), rec.status, rec.status,
          'Ghi nhận ' + RETURN_REASONS[reason].toLowerCase() + ': ' + qty + ' ' + label + ' — ' + RETURN_RESULTS[result] +
            (restockSku ? ' (' + UNIFORM_CONDITIONS[restockCondition] + ')' : '') + (note ? '. ' + note : '.'),
          { itemId: itemId, quantity: qty, result: result, reason: reason, returnId: row.return_id });
      });
    }
    // Nhập lại kho (hội tụ): bước này có thể đã lỗi ở lần gửi trước — bổ sung nếu sổ chưa có.
    if (record.result === 'RESTOCK' && record.restockProductId && !operationExists_(operationId, store)) {
      applyStockMovements_([{
        productId: record.restockProductId,
        type: MOVEMENT_TYPES.RETURN,
        quantity: record.quantity,
        operationId: operationId,
        handoverId: handoverId,
        employeeId: rec.receiver_employee_id,
        returnId: record.returnId,
        reason: truncate_('Nhận lại từ ' + rec.receiver_name + ' (' + rec.handover_code + ') · ' + RETURN_REASONS[record.reason] +
          (record.note ? ' · ' + record.note : ''), 1000)
      }], actor, now, store);
    }
    return { record: record, duplicate: Boolean(prior), code: rec.handover_code };
  });

  var codes = {};
  codes[handoverId] = outcome.code;
  var holding = dpHoldings_({ employeeId: outcome.record.employeeId }).filter(function (x) { return x.itemId === itemId; })[0] || null;
  return { record: dpReturnView_(outcome.record, codes, dpSkuInfoMap_()), duplicate: outcome.duplicate, holding: holding };
}

// ============================================================================
// Dashboard, cảnh báo, huy hiệu
// ============================================================================

function dpStockAlerts_(catalog) {
  var alerts = [];
  catalog.models.forEach(function (m) {
    if (!m.active) return;
    m.skus.forEach(function (s) {
      if (!s.active || s.condition !== 'NEW') return;
      if (s.stock.status === 'IN_STOCK') return;
      alerts.push({
        productId: s.productId, modelId: m.modelId, modelName: m.modelName, size: s.size, condition: s.condition,
        available: s.stock.available, minimumStock: s.stock.minimumStock, status: s.stock.status
      });
    });
  });
  var rank = { OUT_OF_STOCK: 0, UNKNOWN: 1, LOW_STOCK: 2 };
  return alerts.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || compareVi_(a.modelName, b.modelName); });
}

function apiDpDashboard_() {
  var store = dpStore_();
  healDirtyStockIfNeeded_(store);
  var year = dpCurrentYear_();
  var catalog = dpStockCatalog_({});
  var counts = {
    models: catalog.models.length, onHand: 0, reserved: 0, available: 0, outOfStockSkus: 0, lowStockSkus: 0, unknownStockSkus: 0,
    pendingHandovers: 0, loansOutstanding: 0, loansOverdue: 0, employeesMissingSize: 0, employeesMissingGender: 0,
    issuedThisYear: 0, overQuotaEmployees: 0
  };
  catalog.models.forEach(function (m) {
    m.skus.forEach(function (s) {
      if (!s.active) return;
      if (s.stock.onHand === null) counts.unknownStockSkus++;
      else {
        counts.onHand += s.stock.onHand;
        counts.available += Math.max(0, s.stock.available);
      }
      counts.reserved += s.stock.reserved;
      if (s.condition === 'NEW' && s.stock.status === 'OUT_OF_STOCK') counts.outOfStockSkus++;
      if (s.condition === 'NEW' && s.stock.status === 'LOW_STOCK') counts.lowStockSkus++;
    });
  });
  var heads = readColumns_(SHEETS.HANDOVERS, [
    'handover_id', 'handover_code', 'status', 'handover_type', 'receiver_name', 'receiver_department', 'created_at', 'confirmed_at',
    'items_revision'
  ]).filter(function (h) { return h.handover_id && String(h.handover_type || '').toUpperCase() === 'UNIFORM'; });
  heads.forEach(function (h) {
    if (h.status === STATUS.PENDING || h.status === STATUS.REVISION_REQUESTED) counts.pendingHandovers++;
  });
  var qtyByHandover = {};
  if (heads.length) {
    var revisions = {};
    heads.forEach(function (h) { revisions[h.handover_id] = h.items_revision || ''; });
    readColumns_(SHEETS.ITEMS, ['handover_id', 'category', 'quantity', 'issue_kind', 'superseded_at', 'revision_id']).forEach(function (it) {
      if (revisions[it.handover_id] === undefined || !isCommittedItemRow_(it, revisions[it.handover_id])) return;
      if (String(it.category || '').toUpperCase() !== UNIFORM_CATEGORY_CODE) return;
      qtyByHandover[it.handover_id] = (qtyByHandover[it.handover_id] || 0) + (toIntOrNull_(it.quantity) || 0);
    });
    heads.forEach(function (h) {
      if (h.status === STATUS.CONFIRMED && dpYearOf_(h.confirmed_at) === year) counts.issuedThisYear += qtyByHandover[h.handover_id] || 0;
    });
  }
  var holdings = dpHoldings_({});
  holdings.forEach(function (x) {
    if (x.issueKind !== 'CHO_MUON' || x.outstanding <= 0) return;
    counts.loansOutstanding += x.outstanding;
    if (x.overdue) counts.loansOverdue += x.outstanding;
  });
  dpEmployeeRegister_(year, {}).forEach(function (r) {
    if (!r.uniformSize) counts.employeesMissingSize++;
    if (!r.gender) counts.employeesMissingGender++;
    if (r.usage.remaining !== null && r.usage.remaining < 0) counts.overQuotaEmployees++;
  });
  return {
    year: year,
    counts: counts,
    alerts: dpStockAlerts_(catalog).slice(0, 30),
    overdueLoans: holdings.filter(function (x) { return x.overdue; })
      .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; }).slice(0, 10),
    recentIssues: heads.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 8).map(function (h) {
      return {
        handoverId: h.handover_id, handoverCode: h.handover_code, receiverName: h.receiver_name, department: h.receiver_department || '',
        quantity: qtyByHandover[h.handover_id] || 0, status: h.status, createdAt: h.created_at
      };
    })
  };
}

/** Cảnh báo đồng phục cho trang Tổng quan (null: chưa nâng cấp / lỗi đọc — không làm hỏng trang). */
function dpAlertsSummary_() {
  try {
    var catalog = dpStockCatalog_({});
    var out = { outOfStockSkus: 0, lowStockSkus: 0, loansOverdue: 0, pendingHandovers: 0, employeesMissingSize: 0 };
    dpStockAlerts_(catalog).forEach(function (a) {
      if (a.status === 'OUT_OF_STOCK') out.outOfStockSkus++;
      else if (a.status === 'LOW_STOCK') out.lowStockSkus++;
    });
    out.loansOverdue = dpHoldings_({}).filter(function (x) { return x.overdue; }).length;
    out.pendingHandovers = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'status', 'handover_type']).filter(function (h) {
      return String(h.handover_type || '').toUpperCase() === 'UNIFORM' && (h.status === STATUS.PENDING || h.status === STATUS.REVISION_REQUESTED);
    }).length;
    out.employeesMissingSize = getEmployees_().filter(function (e) { return e.status === 'ACTIVE' && !cleanLine_(e.uniformSize); }).length;
    return out;
  } catch (e) {
    logError_('dp.alerts_summary', e);
    return null;
  }
}

/** Số dòng mượn đồng phục quá hạn (huy hiệu menu quản trị) — 0 nếu module chưa sẵn sàng. */
function dpOverdueLoanCount_() {
  try {
    return dpHoldings_({}).filter(function (x) { return x.overdue; }).length;
  } catch (e) {
    logError_('dp.overdue_count', e);
    return 0;
  }
}
