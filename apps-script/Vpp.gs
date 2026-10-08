/**
 * Vpp.gs — module Văn phòng phẩm (VPP): danh mục, định mức, tồn kho, biến động kho, rà soát dữ liệu, cảnh báo.
 *
 * Mô hình kho (không dùng 1 cột số lượng duy nhất):
 *   on_hand   — tồn thực tế trong kho
 *   reserved  — đang giữ chỗ cho phiếu bàn giao chờ ký (chưa trừ on_hand)
 *   available = on_hand − reserved (tính động, không lưu)
 * Mọi thay đổi tồn đi qua applyStockMovements_ (trong LockService): đọc tồn mới nhất → kiểm tra → ghi tồn →
 * ghi dòng VPP_BIEN_DONG_KHO (không bao giờ xóa / sửa dòng biến động).
 *
 * Phiếu bàn giao VPP (handover_type = OFFICE_SUPPLY) dùng chung BAN_GIAO / CHI_TIET_BAN_GIAO. Kho được ĐỒNG BỘ
 * theo trạng thái phiếu bằng syncHandoverStock_: tính lượng đã giữ chỗ / đã xuất của phiếu từ chính các dòng biến
 * động (handover_id) rồi chỉ ghi phần chênh lệch → gọi lại bao nhiêu lần cũng không giữ chỗ / xuất kho 2 lần.
 *   PENDING / REVISION_REQUESTED → giữ chỗ đúng số lượng trên phiếu (RESERVE / RELEASE theo chênh lệch)
 *   CONFIRMED                    → xuất kho (OUT: on_hand −= q, reserved −= q)
 *   CANCELLED                    → trả giữ chỗ (RELEASE)
 */

// ============================================================================
// Sản phẩm
// ============================================================================

function normalizeCatalogStatus_(value) {
  var v = String(value || '').trim().toUpperCase();
  return CATALOG_STATUS[v] ? v : CATALOG_STATUS.TEMP;
}

function productFromRow_(r) {
  return {
    productId: String(r.product_id || '').trim().toLowerCase(),
    productCode: cleanLine_(r.product_code),
    productName: cleanLine_(r.product_name),
    normalizedName: matchKey_(r.product_name),
    category: cleanLine_(r.category),
    unit: cleanLine_(r.unit),
    referencePrice: toNumberOrNull_(r.reference_price),
    minimumStock: Math.max(0, toIntOrNull_(r.minimum_stock) || 0),
    catalogStatus: normalizeCatalogStatus_(r.catalog_status),
    active: String(r.active || '').trim() === '' ? true : toBool_(r.active),
    source: cleanLine_(r.source),
    reviewStatus: String(r.review_status || '').trim().toUpperCase(),
    mergedIntoProductId: String(r.merged_into_product_id || '').trim().toLowerCase(),
    note: cleanText_(r.note),
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || ''
  };
}

function loadProductRows_() {
  return readTable_(SHEETS.VPP_PRODUCTS).rows.filter(function (r) { return isUuid_(r.product_id); });
}

function loadProducts_() {
  return loadProductRows_().map(productFromRow_);
}

function loadProductMap_() {
  var map = {};
  loadProducts_().forEach(function (p) { map[p.productId] = p; });
  return map;
}

function findProductRow_(productId) {
  var id = String(productId || '').toLowerCase();
  if (!isUuid_(id)) return null;
  return findRow_(SHEETS.VPP_PRODUCTS, 'product_id', id);
}

function requireProduct_(productId) {
  var found = findProductRow_(productId);
  if (!found) throw appError_('PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
  return found;
}

/** Sản phẩm dùng được cho xuất / nhập kho: còn hoạt động, không phải ARCHIVED / chờ duyệt. */
function isUsableProduct_(p) {
  return p && p.active && p.catalogStatus !== CATALOG_STATUS.ARCHIVED && p.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL;
}

/** Mã sản phẩm VPP-0001… tăng dần (trong khóa): max(bộ đếm, số lớn nhất đã có) + 1. */
function nextProductCode_() {
  requireLock_('nextProductCode_');
  var prefix = APP.VPP_PRODUCT_CODE_PREFIX;
  var fromProp = parseInt(getProp_(PROP.PRODUCT_SEQ), 10) || 0;
  var seq = Math.max(fromProp, maxSequenceForPrefix_(SHEETS.VPP_PRODUCTS, 'product_code', prefix)) + 1;
  setProp_(PROP.PRODUCT_SEQ, String(seq));
  return prefix + pad_(seq, 4);
}

function productCodeTaken_(code, exceptProductId) {
  if (!code) return false;
  return findRows_(SHEETS.VPP_PRODUCTS, 'product_code', code).some(function (m) {
    return String(m.record.product_id).toLowerCase() !== exceptProductId;
  });
}

/** Tạo dòng sản phẩm (trong khóa). fields.productId (tùy chọn) = ID định trước (chống tạo trùng). Trả về product đã chuẩn hóa. */
function createProduct_(fields, actor, now) {
  requireLock_('createProduct_');
  var id = fields.productId || uuid_();
  var code = fields.productCode || nextProductCode_();
  if (productCodeTaken_(code, id)) throw validationError_({ productCode: 'Mã sản phẩm "' + code + '" đã tồn tại' });
  var row = {
    product_id: id,
    product_code: code,
    product_name: fields.productName,
    normalized_name: matchKey_(fields.productName),
    category: fields.category || '',
    unit: fields.unit || '',
    reference_price: fields.referencePrice === null || fields.referencePrice === undefined ? '' : fields.referencePrice,
    minimum_stock: fields.minimumStock || 0,
    catalog_status: fields.catalogStatus || CATALOG_STATUS.MASTER,
    active: boolCell_(fields.active !== false),
    source: fields.source || 'ADMIN',
    created_at: now,
    updated_at: now,
    review_status: fields.reviewStatus || '',
    merged_into_product_id: '',
    note: fields.note || ''
  };
  appendObjects_(SHEETS.VPP_PRODUCTS, [row]);
  return productFromRow_(row);
}

// ============================================================================
// Tồn kho
// ============================================================================

function stockFromRow_(r) {
  var needsReview = toBool_(r.needs_review);
  var raw = String(r.on_hand === null || r.on_hand === undefined ? '' : r.on_hand).trim();
  var onHand = toIntOrNull_(raw);
  // Số tồn gõ tay không hợp lệ (âm, có phần lẻ, chữ…) → CHƯA RÕ (phải kiểm kê, chênh lệch tính từ 0), không coi là 0 (hiện "hết
  // hàng") hay lấy số âm làm gốc (kiểm kê 3 trên "-5" từng ghi +8 vào sổ). invalidValue giữ nguyên chữ đã gõ để hiện cho quản trị viên.
  var invalid = raw !== '' && (onHand === null || onHand < 0);
  if (invalid) onHand = null;
  else if (onHand === null && !needsReview) onHand = 0;
  return {
    productId: String(r.product_id || '').trim().toLowerCase(),
    onHand: onHand,
    invalidValue: invalid ? raw : '',
    reserved: Math.max(0, toIntOrNull_(r.reserved) || 0),
    minimumStock: toIntOrNull_(r.minimum_stock),
    rawInitialValue: r.raw_initial_value || (invalid ? raw : ''),
    needsReview: needsReview,
    updatedAt: r.updated_at || '',
    updatedBy: r.updated_by || '',
    _row: r._row,
    _record: r
  };
}

function loadStockMap_() {
  var map = {};
  readTable_(SHEETS.VPP_STOCK).rows.forEach(function (r) {
    var s = stockFromRow_(r);
    if (isUuid_(s.productId) && !map[s.productId]) map[s.productId] = s;
  });
  return map;
}

/** Trạng thái tồn: chưa rõ số lượng → UNKNOWN; available ≤ 0 → hết; ≤ tối thiểu → sắp hết; còn lại → còn hàng. */
function computeStockStatus_(available, minimum, unknown) {
  if (unknown) return 'UNKNOWN';
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= (minimum || 0)) return 'LOW_STOCK';
  return 'IN_STOCK';
}

function stockView_(stock, product) {
  var onHand = stock ? stock.onHand : 0;
  var reserved = stock ? stock.reserved : 0;
  var minimum = stock && stock.minimumStock !== null ? stock.minimumStock : (product ? product.minimumStock : 0);
  var available = onHand === null ? null : onHand - reserved;
  return {
    onHand: onHand,
    reserved: reserved,
    available: available,
    minimumStock: minimum || 0,
    needsReview: stock ? stock.needsReview : false,
    rawInitialValue: stock ? stock.rawInitialValue : '',
    status: computeStockStatus_(available === null ? 0 : available, minimum, onHand === null),
    updatedAt: stock ? stock.updatedAt : '',
    updatedBy: stock ? stock.updatedBy : ''
  };
}

function productView_(p, stock) {
  return {
    productId: p.productId,
    productCode: p.productCode,
    productName: p.productName,
    category: p.category,
    unit: p.unit,
    referencePrice: p.referencePrice,
    minimumStock: p.minimumStock,
    catalogStatus: p.catalogStatus,
    active: p.active,
    source: p.source,
    reviewStatus: p.reviewStatus,
    mergedIntoProductId: p.mergedIntoProductId,
    note: p.note,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    stock: stockView_(stock, p)
  };
}

/** Đảm bảo mỗi sản phẩm có 1 dòng VPP_TON_KHO (sản phẩm mới: tồn 0). Trả về map tồn mới nhất. Gọi trong khóa. */
function ensureStockRows_(productIds, actor, now) {
  var map = loadStockMap_();
  var products = null;
  var missing = [];
  productIds.forEach(function (pid) {
    if (!map[pid] && missing.indexOf(pid) < 0) missing.push(pid);
  });
  if (!missing.length) return map;
  products = loadProductMap_();
  appendObjects_(SHEETS.VPP_STOCK, missing.map(function (pid) {
    var p = products[pid];
    return {
      product_id: pid,
      on_hand: 0,
      reserved: 0,
      minimum_stock: p ? p.minimumStock : 0,
      raw_initial_value: '',
      needs_review: 'FALSE',
      updated_at: now,
      updated_by: actor ? actorLabel_(actor) : ''
    };
  }));
  return loadStockMap_();
}

function stockError_(code, message, details) {
  return appError_(code, message, details);
}

/** Một dòng VPP_BIEN_DONG_KHO. */
function movementRow_(pid, type, quantity, before, after, m, actor, now) {
  return {
    movement_id: uuid_(),
    product_id: pid,
    movement_type: type,
    quantity: quantity,
    on_hand_before: before.onHand === null ? '' : before.onHand,
    on_hand_after: after.onHand === null ? '' : after.onHand,
    reserved_before: before.reserved,
    reserved_after: after.reserved,
    handover_id: m.handoverId || '',
    proposal_id: m.proposalId || '',
    operation_id: m.operationId || '',
    actor_id: actor.id || '',
    actor_name: actor.name || '',
    reason: truncate_(m.reason || '', 1000),
    created_at: now
  };
}

/**
 * Số tồn dùng để tính cho một sản phẩm — theo sổ biến động (nguồn sự thật):
 *   • đã có biến động → tồn / giữ chỗ theo sổ; differs = dòng VPP_TON_KHO khác sổ; invalid = sổ cho ra số không hợp lệ;
 *   • chưa có biến động → tồn theo dòng VPP_TON_KHO (tồn đầu kỳ nhập tay: adopt = cần ghi vào sổ trước), giữ chỗ = 0
 *     (không phiếu nào giữ chỗ mà không có dòng RESERVE trong sổ).
 */
function stockBaseFromLedger_(current, ledgerEntry) {
  if (ledgerEntry) {
    return {
      onHand: ledgerEntry.onHand,
      reserved: ledgerEntry.reserved,
      adopt: false,
      differs: current.onHand !== ledgerEntry.onHand || current.reserved !== ledgerEntry.reserved,
      invalid: ledgerEntry.onHand < 0 || ledgerEntry.reserved < 0 || ledgerEntry.onHand < ledgerEntry.reserved
    };
  }
  return {
    onHand: current.onHand,
    reserved: 0,
    adopt: current.onHand !== null && current.onHand > 0,
    differs: current.reserved !== 0,
    invalid: false
  };
}

/**
 * Số tồn / giữ chỗ để KIỂM TRA trước khi ghi phiếu (gọi trong khóa) — đúng số applyStockMovements_ sẽ dùng khi giữ chỗ: sửa dấu
 * ghi dở trước (healDirtyStock_), lấy theo SỔ biến động; sản phẩm chưa có dòng tồn = tồn 0. invalid = sổ cho ra số không hợp lệ
 * (chỉ kiểm kê được). Trước đây phần kiểm tra đọc số trên sheet: sheet cũ / sửa tay → kiểm tra cho qua, rồi bước giữ chỗ (theo sổ)
 * báo "không đủ tồn" SAU KHI phiếu đã được ghi — phiếu lưu mà không giữ chỗ, người nhận vẫn ký được.
 */
function allocationStockMap_(productIds) {
  requireLock_('allocationStockMap_');
  healDirtyStock_();
  var stockMap = loadStockMap_();
  var ledger = stockFromLedger_(productIds);
  var out = {};
  productIds.forEach(function (pid) {
    var base = stockBaseFromLedger_(stockMap[pid] || { onHand: 0, reserved: 0 }, ledger[pid]);
    out[pid] = { onHand: base.onHand, reserved: base.reserved, invalid: base.invalid };
  });
  return out;
}

/**
 * Bản đọc (không khóa, không ghi) cho các trang xem: số tồn / giữ chỗ theo SỔ biến động thay cho số trên sheet — đúng số mà thao
 * tác ghi sẽ dùng (ví dụ form tạo phiếu không hiện "khả dụng 10" khi thực tế theo sổ chỉ còn 7). Trả về bản sao stockMap.
 */
function ledgerStockMap_(stockMap, productIds) {
  var ledger = stockFromLedger_(productIds);
  var out = {};
  Object.keys(stockMap).forEach(function (pid) {
    var s = stockMap[pid];
    if (productIds.indexOf(pid) < 0) {
      out[pid] = s;
      return;
    }
    var base = stockBaseFromLedger_(s, ledger[pid]);
    out[pid] = Object.assign({}, s, { onHand: base.onHand, reserved: base.reserved });
  });
  return out;
}

/** Số tồn theo sổ (đúng như applyStockMovements_ sẽ dùng) — để kiểm tra trước khi ghi (ghép, kiểm kê). */
function effectiveStockMap_(productIds, stockMap) {
  var ledger = stockFromLedger_(productIds);
  var out = {};
  productIds.forEach(function (pid) {
    if (!stockMap[pid]) return;
    var base = stockBaseFromLedger_(stockMap[pid], ledger[pid]);
    out[pid] = { onHand: base.onHand, reserved: base.reserved };
  });
  return out;
}

/**
 * Áp dụng danh sách biến động kho (trong khóa). Mỗi phần tử:
 *   { productId, type, quantity, setTo?, handoverId?, proposalId?, operationId, reason, resolveReview? }
 *   INITIAL / IN: on_hand += quantity (INITIAL được phép khi tồn chưa rõ: đặt tồn = quantity)
 *   RESERVE:      reserved += quantity (phải đủ available)
 *   RELEASE:      reserved −= quantity
 *   OUT:          on_hand −= quantity, reserved −= quantity
 *   ADJUSTMENT:   on_hand = setTo (hoặc on_hand += quantity); không thấp hơn reserved
 * reason có thể là hàm (tồn trước biến động) → chuỗi: kiểm kê ghi "hệ thống X → thực tế Y" theo đúng số đã khớp sổ.
 *
 * SỔ BIẾN ĐỘNG là nguồn sự thật, dòng VPP_TON_KHO chỉ là số tổng hợp — số tồn dùng để tính / kiểm tra lấy theo sổ:
 *   • sản phẩm đã có biến động mà dòng tồn khác sổ (sửa tay Sheet, ghi dở) → dùng số theo sổ, ghi lịch sử VPP_STOCK_SYNCED
 *     (kiểm kê vì thế luôn ghi đúng chênh lệch so với sổ — lần đồng bộ sau không "hoàn tác" kiểm kê);
 *   • sản phẩm chưa có biến động nào mà dòng tồn có số (tồn đầu kỳ nhập tay) → ghi số đó vào sổ (INITIAL) trước,
 *     để sổ và dòng tồn luôn khớp (đồng bộ / kiểm kê sau này không làm mất số đó).
 * Không bao giờ để tồn âm. Trả về { productId: { onHand, reserved, available, minimumStock } } sau khi ghi.
 */
function applyStockMovements_(moves, actor, now) {
  requireLock_('applyStockMovements_');
  if (!moves || !moves.length) return {};
  healDirtyStock_(); // lần ghi trước lỗi giữa chừng → sửa số tồn theo sổ trước khi tính tiếp
  now = now || nowIso_();
  actor = actor || { id: 'system', name: 'Hệ thống' };
  var ids = [];
  moves.forEach(function (m) { if (ids.indexOf(m.productId) < 0) ids.push(m.productId); });
  var stockMap = ensureStockRows_(ids, actor, now);
  var ledger = stockFromLedger_(ids);
  var products = loadProductMap_();
  // Sổ cho ra số không hợp lệ (tồn âm / tồn < giữ chỗ — sổ bị sửa tay): chỉ cho kiểm kê (ADJUSTMENT) để sửa lại.
  var adjustOnly = {};
  ids.forEach(function (pid) { adjustOnly[pid] = true; });
  moves.forEach(function (m) { if (m.type !== MOVEMENT_TYPES.ADJUSTMENT) adjustOnly[m.productId] = false; });
  var state = {};
  var rows = [];
  var resynced = [];

  var stateOf = function (pid) {
    if (state[pid]) return state[pid];
    var current = stockMap[pid];
    if (!current) throw stockError_('PRODUCT_NOT_FOUND', 'Không tìm thấy dòng tồn kho của sản phẩm.');
    var name = products[pid] ? products[pid].productName : pid;
    var base = stockBaseFromLedger_(current, ledger[pid]);
    if (base.invalid && (base.reserved < 0 || !adjustOnly[pid])) {
      throw stockError_('STOCK_INCONSISTENT', 'Sổ biến động của "' + name + '" cho ra số không hợp lệ (tồn ' + base.onHand + ', giữ chỗ ' +
        base.reserved + ') — hãy kiểm kê sản phẩm này trước.');
    }
    if (base.differs) {
      resynced.push({
        productId: pid, sheet: { onHand: current.onHand, reserved: current.reserved },
        ledger: { onHand: base.onHand, reserved: base.reserved }
      });
    }
    if (base.adopt) {
      rows.push(movementRow_(pid, MOVEMENT_TYPES.INITIAL, base.onHand, { onHand: 0, reserved: 0 },
        { onHand: base.onHand, reserved: 0 }, {
          operationId: 'ADOPT:' + pid,
          reason: 'Ghi vào sổ biến động số tồn đang có trên sheet VPP_TON_KHO (nhập tay, chưa có biến động nào)'
        }, actor, now));
    }
    state[pid] = {
      name: name, onHand: base.onHand, reserved: base.reserved, needsReview: current.needsReview,
      minimumStock: current.minimumStock !== null ? current.minimumStock : (products[pid] ? products[pid].minimumStock : 0),
      record: current, changed: false, reviewChanged: false
    };
    return state[pid];
  };

  moves.forEach(function (m) {
    var pid = m.productId;
    var s = stateOf(pid);
    var name = s.name;
    var q = Number(m.quantity);
    var before = { onHand: s.onHand, reserved: s.reserved };
    var recorded = q;
    switch (m.type) {
      case MOVEMENT_TYPES.INITIAL:
      case MOVEMENT_TYPES.IN:
        if (!(q > 0)) throw stockError_('VALIDATION_ERROR', 'Số lượng nhập phải lớn hơn 0.');
        if (s.onHand === null) {
          if (m.type === MOVEMENT_TYPES.IN) {
            throw stockError_('STOCK_UNKNOWN', 'Tồn kho của "' + name + '" chưa xác định — hãy kiểm kê (điều chỉnh) trước khi nhập.');
          }
          s.onHand = 0;
          s.needsReview = !products[pid] || !products[pid].unit;
          s.reviewChanged = true;
        }
        s.onHand += q;
        break;
      case MOVEMENT_TYPES.RESERVE:
        if (!(q > 0)) throw stockError_('VALIDATION_ERROR', 'Số lượng giữ chỗ phải lớn hơn 0.');
        if (s.onHand === null || s.onHand - s.reserved < q) {
          var available = s.onHand === null ? 0 : Math.max(0, s.onHand - s.reserved);
          throw stockError_('INSUFFICIENT_STOCK', 'Không đủ tồn kho "' + name + '". Khả dụng: ' + available + ', yêu cầu: ' + q +
            ', thiếu: ' + (q - available) + '.', { shortages: [{ productId: pid, productName: name, available: available, requested: q, shortage: q - available }] });
        }
        s.reserved += q;
        break;
      case MOVEMENT_TYPES.RELEASE:
        if (!(q > 0)) throw stockError_('VALIDATION_ERROR', 'Số lượng trả giữ chỗ phải lớn hơn 0.');
        if (s.reserved < q) throw stockError_('STOCK_INCONSISTENT', 'Số lượng đang giữ chỗ của "' + name + '" không khớp — hãy đối soát kho.');
        s.reserved -= q;
        break;
      case MOVEMENT_TYPES.OUT:
        if (!(q > 0)) throw stockError_('VALIDATION_ERROR', 'Số lượng xuất phải lớn hơn 0.');
        if (s.onHand === null || s.reserved < q || s.onHand < q) {
          throw stockError_('STOCK_INCONSISTENT', 'Tồn kho của "' + name + '" không đủ để xuất (dữ liệu kho lệch) — hãy đối soát kho.');
        }
        s.onHand -= q;
        s.reserved -= q;
        break;
      case MOVEMENT_TYPES.ADJUSTMENT:
        var base = s.onHand === null ? 0 : s.onHand;
        var target = m.setTo !== undefined && m.setTo !== null ? Number(m.setTo) : base + q;
        if (!isFinite(target) || Math.floor(target) !== target || target < 0) {
          throw stockError_('VALIDATION_ERROR', 'Tồn kho sau điều chỉnh không hợp lệ (không được âm).');
        }
        if (target < s.reserved) {
          throw stockError_('INSUFFICIENT_STOCK', 'Tồn kiểm kê của "' + name + '" (' + target + ') nhỏ hơn số đang giữ chỗ cho phiếu chờ ký (' +
            s.reserved + '). Hãy sửa / hủy phiếu chờ trước.', { reserved: s.reserved, counted: target });
        }
        recorded = target - base;
        s.onHand = target;
        if (m.resolveReview) {
          s.needsReview = !products[pid] || !products[pid].unit;
          s.reviewChanged = true;
        }
        break;
      default:
        throw stockError_('VALIDATION_ERROR', 'Loại biến động kho không hợp lệ: ' + m.type);
    }
    s.changed = true;
    rows.push(movementRow_(pid, m.type, recorded, before, { onHand: s.onHand, reserved: s.reserved }, {
      handoverId: m.handoverId, proposalId: m.proposalId, operationId: m.operationId,
      reason: typeof m.reason === 'function' ? m.reason(before.onHand) : m.reason
    }, actor, now));
  });

  // SỔ BIẾN ĐỘNG là nguồn sự thật → ghi sổ TRƯỚC (1 lần setValues), rồi mới cập nhật số tồn tổng hợp. Đánh dấu "đang ghi"
  // trước khi bắt đầu: lỗi ở bất kỳ bước nào → dấu còn lại → lần ghi kho sau tính lại tồn các sản phẩm này từ sổ.
  // (Ngược lại — tồn ghi trước, sổ lỗi — thì lần thử lại sẽ giữ chỗ / trừ kho 2 lần mà không phát hiện được.)
  var changedIds = Object.keys(state).filter(function (pid) { return state[pid].changed; });
  markStockDirty_(changedIds);
  appendObjects_(SHEETS.VPP_MOVEMENTS, rows);
  changedIds.forEach(function (pid) {
    var s = state[pid];
    var changes = { on_hand: s.onHand === null ? '' : s.onHand, reserved: s.reserved, updated_at: now, updated_by: actorLabel_(actor) };
    if (s.reviewChanged) changes.needs_review = boolCell_(s.needsReview);
    updateRowFields_(SHEETS.VPP_STOCK, s.record._row, s.record._record, changes);
  });
  SpreadsheetApp.flush(); // xóa dấu "đang ghi" chỉ khi số tồn đã thật sự được lưu
  clearStockDirty_();
  resynced.forEach(function (r) {
    afterCommit_('stock_resync_history', r.productId, function () {
      appendHistory_(r.productId, 'VPP_STOCK_SYNCED', actorLabel_(actor), '', '',
        'Số trên sheet VPP_TON_KHO (tồn ' + (r.sheet.onHand === null ? 'chưa rõ' : r.sheet.onHand) + ', giữ chỗ ' + r.sheet.reserved +
          ') khác sổ biến động (tồn ' + (r.ledger.onHand === null ? 'chưa rõ' : r.ledger.onHand) + ', giữ chỗ ' + r.ledger.reserved +
          ') — đã dùng số theo sổ khi ghi biến động kho.',
        { sheet: r.sheet, ledger: r.ledger }, 'VPP_PRODUCT');
    });
  });

  var out = {};
  Object.keys(state).forEach(function (pid) {
    var s = state[pid];
    out[pid] = {
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand === null ? null : s.onHand - s.reserved,
      minimumStock: s.minimumStock || 0
    };
  });
  return out;
}

/** Biến động đã có với operation_id này chưa (chống ghi 2 lần cho thao tác không gắn với phiếu). */
function operationExists_(operationId) {
  if (!operationId) return false;
  return findRows_(SHEETS.VPP_MOVEMENTS, 'operation_id', operationId).length > 0;
}

// ============================================================================
// Toàn vẹn kho: sổ biến động ↔ số tồn tổng hợp
// ============================================================================

function markStockDirty_(productIds) {
  if (productIds.length) setProp_(PROP.VPP_STOCK_DIRTY, JSON.stringify(productIds));
}

function clearStockDirty_() {
  PropertiesService.getScriptProperties().deleteProperty(PROP.VPP_STOCK_DIRTY);
}

/**
 * Tồn tính lại từ sổ biến động (cộng dồn quantity theo loại): { productId: { onHand, reserved, count } }.
 * Chỉ có sản phẩm đã có biến động (sản phẩm chưa có biến động: dòng tồn là gốc). productIds = null → mọi sản phẩm.
 */
function stockFromLedger_(productIds) {
  var wanted = null;
  if (productIds) {
    wanted = {};
    productIds.forEach(function (pid) { wanted[String(pid).toLowerCase()] = true; });
  }
  var out = {};
  readColumns_(SHEETS.VPP_MOVEMENTS, ['product_id', 'movement_type', 'quantity']).forEach(function (m) {
    var pid = String(m.product_id || '').toLowerCase();
    if (!isUuid_(pid) || (wanted && !wanted[pid])) return;
    var q = Number(m.quantity) || 0;
    var s = out[pid] || (out[pid] = { onHand: 0, reserved: 0, count: 0 });
    s.count++;
    if (m.movement_type === MOVEMENT_TYPES.INITIAL || m.movement_type === MOVEMENT_TYPES.IN || m.movement_type === MOVEMENT_TYPES.ADJUSTMENT) {
      s.onHand += q;
    } else if (m.movement_type === MOVEMENT_TYPES.RESERVE) {
      s.reserved += q;
    } else if (m.movement_type === MOVEMENT_TYPES.RELEASE) {
      s.reserved -= q;
    } else if (m.movement_type === MOVEMENT_TYPES.OUT) {
      s.onHand -= q;
      s.reserved -= q;
    }
  });
  return out;
}

/**
 * Sản phẩm có số tồn (VPP_TON_KHO) khác sổ biến động — do ghi dở hoặc ai đó sửa tay Sheet. Gồm cả sản phẩm CHƯA có biến động
 * nào mà dòng tồn có số (ledger.movements = 0: thường là tồn đầu kỳ nhập tay — chỉ kiểm kê, không đồng bộ theo sổ được).
 */
function stockLedgerDrifts_() {
  var ledger = stockFromLedger_(null);
  var stock = loadStockMap_();
  var products = loadProductMap_();
  var ids = Object.keys(ledger);
  Object.keys(stock).forEach(function (pid) {
    var s = stock[pid];
    if (!ledger[pid] && ((s.onHand !== null && s.onHand !== 0) || s.reserved !== 0 || s.invalidValue)) ids.push(pid);
  });
  return ids.filter(function (pid) {
    var s = stock[pid];
    var l = ledger[pid];
    return !l || !s || s.invalidValue || s.onHand !== l.onHand || s.reserved !== l.reserved;
  }).map(function (pid) {
    var p = products[pid];
    var s = stock[pid];
    var l = ledger[pid] || { onHand: 0, reserved: 0, count: 0 };
    return {
      productId: pid, productCode: p ? p.productCode : '', productName: p ? p.productName : pid, unit: p ? p.unit : '',
      // invalidValue (chỉ khi có): chữ gõ tay không đọc được thành số tồn hợp lệ (ví dụ "-5", "2,5") — chỉ kiểm kê được.
      sheet: Object.assign({ onHand: s ? s.onHand : null, reserved: s ? s.reserved : 0 }, s && s.invalidValue ? { invalidValue: s.invalidValue } : {}),
      ledger: { onHand: l.onHand, reserved: l.reserved, movements: l.count }
    };
  }).sort(function (a, b) { return compareVi_(a.productName, b.productName); });
}

/**
 * Đặt số tồn của các sản phẩm theo sổ biến động (gọi trong khóa). Ghi lịch sử từng sản phẩm được sửa.
 * Không tự đặt khi sổ cho ra số không hợp lệ (tồn âm / giữ chỗ âm / tồn < giữ chỗ — sổ bị sửa tay): bỏ qua, ghi log và
 * trả trong skipped để quản trị viên kiểm kê. Sản phẩm chưa có biến động nào không bao giờ bị đụng tới.
 * Trả về { healed: [productId], skipped: [{ productId, ledger }] }.
 */
function healStockFromLedger_(productIds, actor, why) {
  requireLock_('healStockFromLedger_');
  var out = { healed: [], skipped: [] };
  if (!productIds.length) return out;
  var ledger = stockFromLedger_(productIds);
  var stock = ensureStockRows_(Object.keys(ledger), actor, nowIso_());
  var now = nowIso_();
  Object.keys(ledger).forEach(function (pid) {
    var l = ledger[pid];
    var s = stock[pid];
    if (!s || (s.onHand === l.onHand && s.reserved === l.reserved)) return;
    if (l.onHand < 0 || l.reserved < 0 || l.onHand < l.reserved) {
      logError_('stock.ledger_invalid', new Error(pid + ': ' + JSON.stringify(l)));
      out.skipped.push({ productId: pid, ledger: { onHand: l.onHand, reserved: l.reserved } });
      return;
    }
    updateRowFields_(SHEETS.VPP_STOCK, s._row, s._record, { on_hand: l.onHand, reserved: l.reserved, updated_at: now, updated_by: actorLabel_(actor) });
    appendHistory_(pid, 'VPP_STOCK_SYNCED', actorLabel_(actor), '', '',
      why + ': tồn ' + (s.onHand === null ? 'chưa rõ' : s.onHand) + ' → ' + l.onHand + ', giữ chỗ ' + s.reserved + ' → ' + l.reserved + '.',
      { sheet: { onHand: s.onHand, reserved: s.reserved }, ledger: { onHand: l.onHand, reserved: l.reserved } }, 'VPP_PRODUCT');
    logInfo_('stock.synced', { productId: pid, why: why });
    out.healed.push(pid);
  });
  return out;
}

/** Lần ghi kho trước lỗi giữa chừng (còn dấu VPP_STOCK_DIRTY) → tính lại tồn các sản phẩm đó từ sổ. Gọi trong khóa. */
function healDirtyStock_() {
  var raw = getProp_(PROP.VPP_STOCK_DIRTY);
  if (!raw) return [];
  var ids;
  try {
    ids = JSON.parse(raw);
  } catch (e) {
    logError_('stock.dirty_corrupt', e);
    ids = null;
  }
  if (!Array.isArray(ids)) ids = Object.keys(loadStockMap_()); // dấu hỏng → kiểm tra mọi sản phẩm (an toàn hơn bỏ qua)
  var result = healStockFromLedger_(ids, { id: 'system', name: 'Hệ thống' }, 'Tự đồng bộ theo sổ biến động sau lần ghi kho bị lỗi giữa chừng');
  // Sản phẩm sổ không hợp lệ (skipped) vẫn hiện ở "Dữ liệu cần kiểm tra → Tồn kho lệch sổ" cho tới khi được kiểm kê.
  SpreadsheetApp.flush(); // xóa dấu chỉ khi số tồn đã sửa thật sự được lưu
  clearStockDirty_();
  return result.healed;
}

/** Dùng ở các trang đọc (tổng quan kho, dữ liệu cần kiểm tra): chỉ lấy khóa khi thật sự có dấu ghi dở. */
function healDirtyStockIfNeeded_() {
  if (!getProp_(PROP.VPP_STOCK_DIRTY)) return;
  withScriptLock_(healDirtyStock_);
}

/** Admin: đồng bộ số tồn của một sản phẩm theo sổ biến động (mục "Tồn kho lệch sổ" trong Dữ liệu cần kiểm tra). */
function apiVppSyncStock_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  if (!isUuid_(productId)) throw validationError_({ productId: 'Thiếu sản phẩm' });
  return withScriptLock_(function () {
    var p = productFromRow_(requireProduct_(productId).record);
    if (!stockFromLedger_([productId])[productId]) {
      // Chưa có biến động nào: số trên sheet chưa từng vào sổ (thường là tồn đầu kỳ nhập tay) — đồng bộ sẽ xóa mất số đó.
      throw appError_('INVALID_STATE', '"' + p.productName + '" chưa có biến động nào trong sổ — số trên sheet chưa từng được ghi vào sổ ' +
        '(thường là tồn đầu kỳ nhập tay). Nếu số đó đúng, hãy Kiểm kê với chính số đó để ghi vào sổ; nếu sai, Kiểm kê với số thực tế.');
    }
    var result = healStockFromLedger_([productId], actor, 'Quản trị viên đồng bộ tồn theo sổ biến động');
    if (result.skipped.length) {
      var l = result.skipped[0].ledger;
      throw appError_('INVALID_STATE', 'Sổ biến động của "' + p.productName + '" cho ra số không hợp lệ (tồn ' + l.onHand + ', giữ chỗ ' +
        l.reserved + ') nên không tự đồng bộ — hãy Kiểm kê sản phẩm này với số thực tế.');
    }
    invalidateCaches_();
    return { synced: result.healed.length > 0, product: productView_(p, loadStockMap_()[productId]) };
  });
}

// ============================================================================
// Định mức
// ============================================================================

function normFromRow_(r) {
  return {
    normId: String(r.norm_id || '').trim().toLowerCase(),
    productId: String(r.product_id || '').trim().toLowerCase(),
    scopeType: String(r.scope_type || 'DEPARTMENT').trim().toUpperCase(),
    scopeId: String(r.scope_id || '').trim().toUpperCase(),
    scopeName: cleanLine_(r.scope_name),
    monthlyQuantity: Math.max(0, toIntOrNull_(r.monthly_quantity) || 0),
    unit: cleanLine_(r.unit),
    referencePrice: toNumberOrNull_(r.reference_price),
    note: cleanText_(r.note),
    effectiveFrom: normalizeDateOnly_(r.effective_from),
    effectiveTo: normalizeDateOnly_(r.effective_to),
    active: String(r.active || '').trim() === '' ? true : toBool_(r.active),
    sourceRef: cleanLine_(r.source_ref),
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || ''
  };
}

function loadNorms_() {
  return readTable_(SHEETS.VPP_NORMS).rows
    .filter(function (r) { return isUuid_(r.norm_id) && isUuid_(r.product_id); })
    .map(normFromRow_);
}

function todayIsoDate_() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
}

function isNormEffective_(n, day) {
  if (!n.active) return false;
  if (n.effectiveFrom && n.effectiveFrom > day) return false;
  if (n.effectiveTo && n.effectiveTo < day) return false;
  return true;
}

/** Định mức đang hiệu lực của một phạm vi: productId → norm. */
function normsForScope_(scopeId, norms) {
  var day = todayIsoDate_();
  var map = {};
  (norms || loadNorms_()).forEach(function (n) {
    if (n.scopeId !== scopeId || !isNormEffective_(n, day)) return;
    var cur = map[n.productId];
    if (!cur || (n.effectiveFrom || '') > (cur.effectiveFrom || '')) map[n.productId] = n;
  });
  return map;
}

/**
 * Đã cấp trong tháng cho một phạm vi: confirmed = phiếu VPP đã ký trong tháng (theo giờ VN);
 * pending = phiếu VPP đang chờ ký / yêu cầu sửa (đang giữ chỗ). excludeHandoverId: bỏ phiếu đang sửa.
 */
function scopeUsage_(scopeId, monthKey, excludeHandoverId) {
  var heads = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'status', 'handover_type', 'vpp_scope_id', 'confirmed_at']);
  var wanted = {};
  heads.forEach(function (h) {
    if (h.handover_type !== 'OFFICE_SUPPLY' || h.vpp_scope_id !== scopeId || h.handover_id === excludeHandoverId) return;
    if (h.status === STATUS.CONFIRMED && monthKey_(h.confirmed_at) === monthKey) wanted[h.handover_id] = 'confirmed';
    else if (h.status === STATUS.PENDING || h.status === STATUS.REVISION_REQUESTED) wanted[h.handover_id] = 'pending';
  });
  if (!Object.keys(wanted).length) return {};
  var usage = {};
  var revisions = committedRevisionMap_();
  readColumns_(SHEETS.ITEMS, ['handover_id', 'product_id', 'quantity', 'superseded_at', 'affects_inventory', 'revision_id']).forEach(function (it) {
    var kind = wanted[it.handover_id];
    if (!kind || !isCommittedItemRow_(it, revisions[it.handover_id]) || !toBool_(it.affects_inventory)) return;
    var pid = String(it.product_id || '').toLowerCase();
    var u = usage[pid] || (usage[pid] = { confirmed: 0, pending: 0 });
    u[kind] += toIntOrNull_(it.quantity) || 0;
  });
  return usage;
}

// ============================================================================
// Phiếu bàn giao văn phòng phẩm
// ============================================================================

/** Kiểm tra sản phẩm & dựng các dòng nội dung (tên, ĐVT lấy từ danh mục). */
function vppPrepareSupplyItems_(supplies) {
  var products = loadProductMap_();
  var errors = {};
  var lines = [];
  supplies.forEach(function (s, i) {
    var p = products[s.productId];
    if (!isUsableProduct_(p)) {
      errors['supplies.' + i + '.productId'] = 'Sản phẩm không tồn tại hoặc đã ngừng sử dụng';
      return;
    }
    lines.push({ index: i, productId: p.productId, product: p, quantity: s.quantity, note: s.note, overNormReason: s.overNormReason });
  });
  if (Object.keys(errors).length) {
    var keys = Object.keys(errors);
    throw appError_('PRODUCT_NOT_FOUND', errors[keys[0]], { fieldErrors: errors });
  }
  var items = lines.map(function (l) {
    return {
      category: VPP_CATEGORY_CODE,
      itemName: l.product.productName,
      assetCode: l.product.productCode,
      serialNumber: '',
      model: '',
      quantity: l.quantity,
      unit: l.product.unit,
      condition: '',
      description: '',
      workStatus: '',
      deadline: '',
      documentUrl: '',
      note: l.note,
      productId: l.productId,
      affectsInventory: true,
      overNormReason: l.overNormReason
    };
  });
  return { lines: lines, items: items };
}

/** Lượng đang giữ chỗ / đã xuất của một phiếu, tính từ các dòng biến động gắn handover_id. */
function handoverStockNet_(handoverId) {
  var net = {};
  findRows_(SHEETS.VPP_MOVEMENTS, 'handover_id', handoverId).forEach(function (m) {
    var r = m.record;
    var pid = String(r.product_id || '').toLowerCase();
    var q = Math.abs(toIntOrNull_(r.quantity) || 0);
    var n = net[pid] || (net[pid] = { reserved: 0, consumed: 0 });
    if (r.movement_type === MOVEMENT_TYPES.RESERVE) n.reserved += q;
    else if (r.movement_type === MOVEMENT_TYPES.RELEASE) n.reserved -= q;
    else if (r.movement_type === MOVEMENT_TYPES.OUT) {
      n.reserved -= q;
      n.consumed += q;
    }
  });
  return net;
}

/**
 * Kiểm tra trước khi ghi (trong khóa, đọc tồn mới nhất):
 *   • không đủ tồn → INSUFFICIENT_STOCK (kèm khả dụng / yêu cầu / thiếu từng dòng) — không cho tạo phiếu;
 *   • vượt định mức tháng của phòng ban mà không nhập lý do → NORM_EXCEEDED (có lý do thì cho phép).
 * handoverId: phiếu đang sửa (số đang giữ chỗ cho chính phiếu này được tính là khả dụng).
 */
function vppValidateAllocation_(plan, scope, handoverId) {
  requireLock_('vppValidateAllocation_');
  var stock = allocationStockMap_(plan.lines.map(function (l) { return l.productId; }));
  var own = handoverId ? handoverStockNet_(handoverId) : {};
  var shortages = [];
  var fieldErrors = {};
  var inconsistent = plan.lines.filter(function (line) { return stock[line.productId].invalid; });
  if (inconsistent.length) {
    // Cùng lỗi bước giữ chỗ sẽ gặp — báo TRƯỚC khi ghi bất cứ thứ gì.
    inconsistent.forEach(function (line) {
      fieldErrors['supplies.' + line.index + '.quantity'] = 'Sổ biến động kho của sản phẩm này cho ra số không hợp lệ — cần kiểm kê trước khi bàn giao.';
    });
    throw appError_('STOCK_INCONSISTENT', 'Sổ biến động kho của ' + inconsistent.map(function (l) { return '"' + l.product.productName + '"'; })
      .join(', ') + ' cho ra số không hợp lệ — hãy kiểm kê sản phẩm trước khi bàn giao.', { fieldErrors: fieldErrors });
  }
  plan.lines.forEach(function (line) {
    var s = stock[line.productId];
    var onHand = s.onHand;
    var reserved = s.reserved;
    var ownReserved = own[line.productId] ? Math.max(0, own[line.productId].reserved) : 0;
    var available = onHand === null ? 0 : onHand - reserved + ownReserved;
    if (line.quantity > available) {
      var avail = Math.max(0, available);
      shortages.push({
        index: line.index, productId: line.productId, productName: line.product.productName, unit: line.product.unit,
        available: avail, requested: line.quantity, shortage: line.quantity - avail, unknown: onHand === null
      });
      fieldErrors['supplies.' + line.index + '.quantity'] = onHand === null
        ? 'Tồn kho chưa xác định — cần kiểm kê trước khi bàn giao.'
        : 'Không đủ tồn kho. Khả dụng: ' + avail + ', yêu cầu: ' + line.quantity + ', thiếu: ' + (line.quantity - avail) + '.';
    }
  });
  if (shortages.length) {
    throw appError_('INSUFFICIENT_STOCK', 'Không đủ tồn kho: ' + shortages.map(function (x) {
      return x.productName + ' (khả dụng ' + x.available + ', yêu cầu ' + x.requested + ', thiếu ' + x.shortage + ')';
    }).join('; ') + '.', { shortages: shortages, fieldErrors: fieldErrors });
  }
  if (!scope) return;
  var norms = normsForScope_(scope.scopeId);
  var usage = scopeUsage_(scope.scopeId, monthKey_(''), handoverId || '');
  var exceeded = {};
  plan.lines.forEach(function (line) {
    var norm = norms[line.productId];
    if (!norm) return;
    var u = usage[line.productId] || { confirmed: 0, pending: 0 };
    var over = u.confirmed + u.pending + line.quantity - norm.monthlyQuantity;
    if (over > 0 && !line.overNormReason) {
      exceeded['supplies.' + line.index + '.overNormReason'] = 'Vượt định mức ' + over + ' ' + (line.product.unit || '') +
        ' (định mức ' + norm.monthlyQuantity + '/tháng, đã cấp ' + (u.confirmed + u.pending) + ') — nhập lý do vượt định mức.';
    }
  });
  if (Object.keys(exceeded).length) {
    throw appError_('NORM_EXCEEDED', 'Vượt định mức tháng của ' + scope.scopeName + ' — bắt buộc nhập lý do vượt định mức.',
      { fieldErrors: exceeded });
  }
}

/** Cảnh báo sau khi giữ chỗ: sản phẩm sẽ hết sau phiếu này / chạm mức tối thiểu. */
function stockWarnings_(after, products) {
  var warnings = [];
  Object.keys(after).forEach(function (pid) {
    var a = after[pid];
    if (a.available === null) return;
    var name = products[pid] ? products[pid].productName : pid;
    if (a.available <= 0) warnings.push({ type: 'LAST_ITEM', productId: pid, productName: name, available: a.available });
    else if (a.available <= a.minimumStock) {
      warnings.push({ type: 'LOW_STOCK', productId: pid, productName: name, available: a.available, minimumStock: a.minimumStock });
    }
  });
  return warnings;
}

/**
 * Đồng bộ kho theo trạng thái + nội dung hiện tại của phiếu VPP (idempotent). Gọi trong khóa.
 * opLabel: HANDOVER_RESERVE / HANDOVER_UPDATE / HANDOVER_CANCEL / HANDOVER_CONFIRM / HANDOVER_RECONCILE.
 */
function syncHandoverStock_(rec, items, actor, opLabel) {
  requireLock_('syncHandoverStock_');
  var id = rec.handover_id;
  var desired = {};
  (items || []).forEach(function (i) {
    if (!i.affectsInventory || !i.productId || !(i.quantity > 0)) return;
    desired[i.productId] = (desired[i.productId] || 0) + i.quantity;
  });
  var status = rec.status;
  var net = handoverStockNet_(id);
  var pids = Object.keys(desired);
  Object.keys(net).forEach(function (pid) { if (pids.indexOf(pid) < 0) pids.push(pid); });
  var moves = [];
  var opId = opLabel + ':' + id;
  pids.forEach(function (pid) {
    var qty = desired[pid] || 0;
    var cur = net[pid] || { reserved: 0, consumed: 0 };
    var reserved = cur.reserved;
    var wantConsumed = status === STATUS.CONFIRMED ? qty : 0;
    var wantReserved = status === STATUS.PENDING || status === STATUS.REVISION_REQUESTED ? qty : 0;
    var dc = wantConsumed - cur.consumed;
    if (dc > 0) {
      var need = dc - Math.max(0, reserved);
      if (need > 0) {
        moves.push({ productId: pid, type: MOVEMENT_TYPES.RESERVE, quantity: need });
        reserved += need;
      }
      moves.push({ productId: pid, type: MOVEMENT_TYPES.OUT, quantity: dc });
      reserved -= dc;
    }
    // dc < 0: biên bản đã ký là bất biến — không tự hoàn tác xuất kho (xử lý bằng kiểm kê nếu cần).
    var dr = wantReserved - reserved;
    if (dr > 0) moves.push({ productId: pid, type: MOVEMENT_TYPES.RESERVE, quantity: dr });
    else if (dr < 0 && reserved > 0) moves.push({ productId: pid, type: MOVEMENT_TYPES.RELEASE, quantity: Math.min(-dr, reserved) });
  });
  if (!moves.length) return [];
  var reasons = {
    HANDOVER_RESERVE: 'Giữ chỗ cho phiếu ' + rec.handover_code,
    HANDOVER_UPDATE: 'Điều chỉnh giữ chỗ khi sửa phiếu ' + rec.handover_code,
    HANDOVER_CANCEL: 'Trả giữ chỗ do hủy phiếu ' + rec.handover_code,
    HANDOVER_CONFIRM: 'Xuất kho — người nhận ký xác nhận phiếu ' + rec.handover_code,
    HANDOVER_RECONCILE: 'Đối soát kho theo phiếu ' + rec.handover_code
  };
  var after = applyStockMovements_(moves.map(function (m) {
    m.handoverId = id;
    m.operationId = opId;
    m.reason = reasons[opLabel] || opLabel;
    return m;
  }), actor, nowIso_());
  var reservedIds = {};
  moves.forEach(function (m) { if (m.type === MOVEMENT_TYPES.RESERVE) reservedIds[m.productId] = true; });
  var relevant = {};
  Object.keys(after).forEach(function (pid) { if (reservedIds[pid]) relevant[pid] = after[pid]; });
  return stockWarnings_(relevant, loadProductMap_());
}

/** Admin: đối soát kho cho một phiếu VPP (sửa lệch sau sự cố ghi dở). */
function apiVppReconcileHandover_(data) {
  var id = requireHandoverId_(data.id);
  var actor = sanitizeActor_(data.actor);
  return withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var items = loadItems_(id, found.record);
    if (effectiveHandoverType_(found.record, items) !== 'OFFICE_SUPPLY') {
      throw appError_('INVALID_STATE', 'Chỉ đối soát kho cho phiếu văn phòng phẩm.');
    }
    var warnings = syncHandoverStock_(found.record, items, actor, 'HANDOVER_RECONCILE');
    return { reconciled: true, warnings: warnings };
  });
}

// ============================================================================
// Admin — danh mục sản phẩm
// ============================================================================

function apiVppListProducts_(q) {
  q = q || {};
  healDirtyStockIfNeeded_();
  var products = loadProducts_();
  var stock = loadStockMap_();
  var norms = loadNorms_();
  var normCount = {};
  var day = todayIsoDate_();
  norms.forEach(function (n) { if (isNormEffective_(n, day)) normCount[n.productId] = (normCount[n.productId] || 0) + 1; });
  var needle = normalizeText_(q.q);
  var statusFilter = String(q.stockStatus || '').toUpperCase();
  var includeArchived = q.includeArchived === true || q.includeArchived === 'true';
  var list = products
    .filter(function (p) {
      if (!includeArchived && p.catalogStatus === CATALOG_STATUS.ARCHIVED) return false;
      if (q.catalogStatus && p.catalogStatus !== String(q.catalogStatus).toUpperCase()) return false;
      if (needle) {
        var hay = normalizeText_([p.productName, p.productCode, p.unit, p.category].join(' '));
        if (needle.split(' ').some(function (t) { return hay.indexOf(t) < 0; })) return false;
      }
      return true;
    })
    .map(function (p) {
      var v = productView_(p, stock[p.productId]);
      v.normCount = normCount[p.productId] || 0;
      return v;
    })
    // Lọc theo tình trạng tồn khớp đúng số liệu cảnh báo ở Tổng quan kho (vppStockAlerts_): chỉ sản phẩm đang dùng,
    // không tính sản phẩm ngừng dùng / chờ duyệt (chưa có trong kho thật).
    .filter(function (v) { return !statusFilter || (isUsableProduct_(v) && v.stock.status === statusFilter); });
  list.sort(function (a, b) { return compareVi_(a.productName, b.productName); });
  return { products: list };
}

function validateProductFields_(data, requireName) {
  var errors = {};
  var name = cleanLine_(data.productName);
  var code = cleanLine_(data.productCode).toUpperCase();
  var category = cleanLine_(data.category);
  var unit = cleanLine_(data.unit);
  var note = cleanText_(data.note);
  var price = data.referencePrice === null || data.referencePrice === undefined || data.referencePrice === '' ? null : Number(data.referencePrice);
  var minimum = data.minimumStock === null || data.minimumStock === undefined || data.minimumStock === '' ? 0 : Number(data.minimumStock);
  if (requireName && !name) errors.productName = 'Nhập tên sản phẩm';
  if (name.length > LIMITS.PRODUCT_NAME) errors.productName = 'Tối đa ' + LIMITS.PRODUCT_NAME + ' ký tự';
  if (code && !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) errors.productCode = 'Mã chỉ gồm chữ, số, . _ - (tối đa 40 ký tự)';
  if (category.length > LIMITS.PRODUCT_CATEGORY) errors.category = 'Tối đa ' + LIMITS.PRODUCT_CATEGORY + ' ký tự';
  if (unit.length > LIMITS.UNIT) errors.unit = 'Tối đa ' + LIMITS.UNIT + ' ký tự';
  if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors.referencePrice = 'Đơn giá không hợp lệ';
  if (!isFinite(minimum) || Math.floor(minimum) !== minimum || minimum < 0 || minimum > LIMITS.MAX_QUANTITY) {
    errors.minimumStock = 'Tồn tối thiểu phải là số nguyên ≥ 0';
  }
  if (note.length > 1000) errors.note = 'Tối đa 1000 ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  return { productName: name, productCode: code, category: category, unit: unit, referencePrice: roundPrice_(price), minimumStock: minimum, note: note };
}

/** Sản phẩm đã tạo khớp đúng thông tin của lần gửi lại (mã SP để trống = hệ thống tự cấp, không so). */
function sameProductFields_(prev, fields, status, active) {
  return prev.productName === fields.productName && (!fields.productCode || prev.productCode === fields.productCode) &&
    prev.category === fields.category && prev.unit === fields.unit && prev.referencePrice === fields.referencePrice &&
    prev.minimumStock === fields.minimumStock && prev.note === fields.note && prev.catalogStatus === status && prev.active === active;
}

function apiVppSaveProduct_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  var isNew = !productId;
  var fields = validateProductFields_(data, true);
  var status = data.catalogStatus ? String(data.catalogStatus).toUpperCase() : '';
  if (status && !CATALOG_STATUS[status]) throw validationError_({ catalogStatus: 'Trạng thái danh mục không hợp lệ' });
  if (isNew && status === CATALOG_STATUS.PENDING_APPROVAL) {
    throw validationError_({ catalogStatus: '"Chờ duyệt" chỉ dành cho sản phẩm mới từ đề xuất mua.' });
  }
  var active = data.active === undefined ? true : data.active === true;
  // Tạo mới: mã thao tác của trình duyệt dùng làm product_id → gửi lại (mạng chập chờn, hết thời gian chờ, bấm lại) trả về
  // sản phẩm đã tạo thay vì tạo bản trùng.
  var requestId = isNew ? optionalRequestId_(data.clientRequestId) : '';

  return withScriptLock_(function () {
    var now = nowIso_();
    var product;
    if (isNew && requestId) {
      var existing = findProductRow_(requestId);
      if (existing) {
        var prev = productFromRow_(existing.record);
        if (exactNameKey_(prev.productName) !== exactNameKey_(fields.productName)) {
          throw appError_('CONFLICT', 'Mã thao tác này đã được dùng để tạo sản phẩm khác ("' + prev.productName + '"). Tải lại trang rồi thử lại.');
        }
        // Cùng sản phẩm nhưng thông tin KHÁC (lần trước mất phản hồi nhưng đã tạo, người dùng sửa giá / ĐVT… rồi bấm lại): không trả
        // sản phẩm cũ như "đã thêm" với thông tin chưa sửa — báo rõ, không ghi đè.
        if (!sameProductFields_(prev, fields, status || CATALOG_STATUS.MASTER, active)) {
          throw appError_('REQUEST_REUSED', 'Lần thêm trước (mất kết nối trước khi nhận được phản hồi) ĐÃ tạo sản phẩm ' + prev.productCode +
            ' – ' + prev.productName + ' lúc ' + formatDisplayDateTime_(prev.createdAt) + ' với thông tin trước khi bạn sửa. Thông tin vừa ' +
            'sửa CHƯA được lưu — tải lại trang rồi bấm "Sửa" ở sản phẩm đó.', { existing: { productId: prev.productId, code: prev.productCode } });
        }
        ensureStockRows_([prev.productId], actor, now); // lần trước có thể lỗi trước khi tạo dòng tồn
        return { product: productView_(prev, loadStockMap_()[prev.productId]), duplicate: true };
      }
    }
    if (isNew) {
      product = createProduct_({
        productId: requestId, productName: fields.productName, productCode: fields.productCode, category: fields.category,
        unit: fields.unit, referencePrice: fields.referencePrice, minimumStock: fields.minimumStock, note: fields.note,
        catalogStatus: status || CATALOG_STATUS.MASTER, active: active, source: 'ADMIN'
      }, actor, now);
      ensureStockRows_([product.productId], actor, now);
      appendHistory_(product.productId, 'VPP_PRODUCT_CREATED', actorLabel_(actor), '', product.catalogStatus,
        'Thêm sản phẩm ' + product.productCode + ' – ' + product.productName, { fields: fields }, 'VPP_PRODUCT');
    } else {
      var found = requireProduct_(productId);
      var current = productFromRow_(found.record);
      var stock = loadStockMap_()[productId];
      // Số đang giữ chỗ theo SỔ biến động (số trên sheet có thể cũ / bị sửa tay → lưu trữ nhầm sản phẩm đang được giữ chỗ).
      var held = allocationStockMap_([productId])[productId];
      var newStatus = status || current.catalogStatus;
      // Sản phẩm chờ duyệt (từ đề xuất mua) chỉ đổi trạng thái qua quyết định trong đề xuất — để dòng đề xuất luôn khớp.
      if (current.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL && newStatus !== CATALOG_STATUS.PENDING_APPROVAL) {
        throw validationError_({
          catalogStatus: 'Sản phẩm mới từ đề xuất mua — hãy xử lý trong trang đề xuất (Thêm vào danh mục / Giữ tạm / Ghép / Từ chối).'
        });
      }
      if (current.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL && newStatus === CATALOG_STATUS.PENDING_APPROVAL) {
        throw validationError_({ catalogStatus: '"Chờ duyệt" chỉ dành cho sản phẩm mới từ đề xuất mua.' });
      }
      if ((newStatus === CATALOG_STATUS.ARCHIVED || !active) && held.reserved > 0) {
        throw appError_('INVALID_STATE', 'Sản phẩm đang được giữ chỗ trong phiếu chờ ký (' + held.reserved + '). Hãy xử lý các phiếu đó trước.');
      }
      var code = fields.productCode || current.productCode;
      if (code !== current.productCode && productCodeTaken_(code, productId)) {
        throw validationError_({ productCode: 'Mã sản phẩm "' + code + '" đã tồn tại' });
      }
      var changes = {
        product_code: code,
        product_name: fields.productName,
        normalized_name: matchKey_(fields.productName),
        category: fields.category,
        unit: fields.unit,
        reference_price: fields.referencePrice === null ? '' : fields.referencePrice,
        minimum_stock: fields.minimumStock,
        catalog_status: newStatus,
        active: boolCell_(active),
        note: fields.note,
        updated_at: now
      };
      if (newStatus === CATALOG_STATUS.MASTER && current.reviewStatus === REVIEW_STATUS.PENDING) changes.review_status = REVIEW_STATUS.RESOLVED;
      updateRowFields_(SHEETS.VPP_PRODUCTS, found.rowIndex, found.record, changes);
      if (stock) {
        var stockChanges = { minimum_stock: fields.minimumStock, updated_at: now, updated_by: actorLabel_(actor) };
        if (fields.unit && stock.needsReview && stock.onHand !== null) stockChanges.needs_review = 'FALSE';
        updateRowFields_(SHEETS.VPP_STOCK, stock._row, stock._record, stockChanges);
      } else {
        ensureStockRows_([productId], actor, now);
      }
      appendHistory_(productId, 'VPP_PRODUCT_UPDATED', actorLabel_(actor), current.catalogStatus, newStatus,
        'Cập nhật sản phẩm ' + code + ' – ' + fields.productName, { before: current, after: fields }, 'VPP_PRODUCT');
      product = productFromRow_(Object.assign({}, found.record, changes));
    }
    invalidateCaches_();
    return { product: productView_(product, loadStockMap_()[product.productId]) };
  });
}

// ============================================================================
// Admin — định mức
// ============================================================================

function apiVppListNorms_() {
  var products = loadProductMap_();
  var norms = loadNorms_().map(function (n) {
    var p = products[n.productId];
    var out = Object.assign({}, n);
    out.productName = p ? p.productName : '(sản phẩm đã xóa)';
    out.productCode = p ? p.productCode : '';
    out.productUnit = p ? p.unit : '';
    // Sản phẩm đã lưu trữ / ngừng dùng (ví dụ đã GHÉP đi) → định mức không áp dụng được nữa: không tính vào "đang áp dụng" / tổng tiền.
    out.productInactive = !isUsableProduct_(p);
    out.effective = isNormEffective_(n, todayIsoDate_()) && !out.productInactive;
    return out;
  });
  norms.sort(function (a, b) {
    return a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : compareVi_(a.productName, b.productName);
  });
  var scopes = listNormScopes_();
  var deptCount = {};
  getEmployees_().forEach(function (e) {
    if (e.status !== 'ACTIVE' || !e.department) return;
    deptCount[e.department] = (deptCount[e.department] || 0) + 1;
  });
  var settings = getSettings_();
  var departments = Object.keys(deptCount).sort(compareVi_).map(function (d) {
    var s = resolveDepartmentScope_(d, scopes);
    // mapping: giá trị đã gắn thủ công ('' = tự khớp theo tên, 'NONE' = không áp dụng định mức, hoặc mã phạm vi).
    var mapping = String(settings[scopeSettingKey_(d)] || '').trim().toUpperCase();
    return { department: d, employeeCount: deptCount[d], scope: s, mapping: mapping };
  });
  return { norms: norms, scopes: scopes, departments: departments };
}

/**
 * Định mức đi kèm khi THÊM VÀO DANH MỤC / TẠO SẢN PHẨM MỚI: kiểm tra TRƯỚC khi ghi sản phẩm (gọi trong khóa), để không xảy ra
 * cảnh "sản phẩm đã lưu nhưng báo lỗi định mức". Có gửi định mức thì phải hợp lệ — không âm thầm bỏ qua.
 */
function precheckAttachedNorm_(productId, norm) {
  requireLock_('precheckAttachedNorm_');
  var scopeName = cleanLine_(norm.scopeName);
  var scopeId = String(norm.scopeId || '').trim().toUpperCase() || slugKey_(scopeName, 40);
  var qty = Number(norm.monthlyQuantity);
  var errors = {};
  if (!/^[A-Z0-9_]{1,40}$/.test(scopeId)) errors['norm.scopeId'] = 'Chọn phạm vi định mức hoặc nhập tên phạm vi mới';
  if (norm.monthlyQuantity === '' || norm.monthlyQuantity === null || norm.monthlyQuantity === undefined ||
      !isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_QUANTITY) {
    errors['norm.monthlyQuantity'] = 'Định mức phải là số nguyên ≥ 0';
  }
  if (Object.keys(errors).length) throw validationError_(errors);
  var norms = loadNorms_();
  if (!scopeName && !norms.some(function (n) { return n.scopeId === scopeId; })) {
    throw validationError_({ 'norm.scopeName': 'Phạm vi "' + scopeId + '" chưa có — nhập tên phạm vi mới' });
  }
  var day = todayIsoDate_();
  if (norms.some(function (n) { return n.productId === productId && n.scopeId === scopeId && n.active && isNormEffective_(n, day); })) {
    throw validationError_({ 'norm.scopeId': 'Sản phẩm đã có định mức đang hiệu lực trong phạm vi ' + scopeId + ' — sửa ở trang Định mức.' });
  }
}

function apiVppSaveNorm_(data) {
  var actor = sanitizeActor_(data.actor);
  var normId = String(data.normId || '').toLowerCase();
  var productId = String(data.productId || '').toLowerCase();
  var scopeName = cleanLine_(data.scopeName);
  var scopeId = String(data.scopeId || '').trim().toUpperCase() || slugKey_(scopeName, 40);
  var errors = {};
  if (!isUuid_(productId)) errors.productId = 'Chọn sản phẩm';
  if (!/^[A-Z0-9_]{1,40}$/.test(scopeId)) errors.scopeId = 'Chọn phạm vi định mức hoặc nhập tên phạm vi mới (ví dụ: PHÒNG KINH DOANH)';
  var qty = Number(data.monthlyQuantity);
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_QUANTITY) errors.monthlyQuantity = 'Định mức phải là số nguyên ≥ 0';
  var price = data.referencePrice === null || data.referencePrice === undefined || data.referencePrice === '' ? null : roundPrice_(data.referencePrice);
  if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors.referencePrice = 'Đơn giá không hợp lệ';
  var from = String(data.effectiveFrom || '').trim();
  var to = String(data.effectiveTo || '').trim();
  if (from && !isValidDateOnly_(from)) errors.effectiveFrom = 'Ngày không hợp lệ';
  if (to && !isValidDateOnly_(to)) errors.effectiveTo = 'Ngày không hợp lệ';
  if (from && to && to < from) errors.effectiveTo = 'Ngày kết thúc phải sau ngày bắt đầu';
  var note = cleanText_(data.note);
  if (note.length > 1000) errors.note = 'Tối đa 1000 ký tự';
  var unit = cleanLine_(data.unit);
  if (unit.length > LIMITS.UNIT) errors.unit = 'Tối đa ' + LIMITS.UNIT + ' ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  var active = data.active === undefined ? true : data.active === true;

  return withScriptLock_(function () {
    var product = requireProduct_(productId);
    var p = productFromRow_(product.record);
    var now = nowIso_();
    var norms = loadNorms_();
    var day = todayIsoDate_();
    var duplicate = norms.some(function (n) {
      return n.normId !== normId && n.productId === productId && n.scopeId === scopeId && n.active && active &&
        isNormEffective_(n, day) && (!from || from <= day) && (!to || to >= day);
    });
    if (duplicate) {
      throw validationError_({ productId: 'Sản phẩm này đã có định mức đang hiệu lực trong phạm vi ' + scopeId + ' — hãy sửa định mức cũ.' });
    }
    if (!scopeName) {
      var existing = norms.filter(function (n) { return n.scopeId === scopeId; })[0];
      if (!existing) throw validationError_({ scopeName: 'Phạm vi "' + scopeId + '" chưa có — nhập tên phạm vi mới (ví dụ: PHÒNG KINH DOANH)' });
      scopeName = existing.scopeName;
    }
    var fields = {
      product_id: productId,
      scope_type: 'DEPARTMENT',
      scope_id: scopeId,
      scope_name: scopeName,
      monthly_quantity: qty,
      unit: unit || p.unit,
      reference_price: price === null ? (p.referencePrice === null ? '' : p.referencePrice) : price,
      note: note,
      effective_from: from,
      effective_to: to,
      active: boolCell_(active),
      updated_at: now
    };
    var saved;
    if (normId) {
      var found = findRow_(SHEETS.VPP_NORMS, 'norm_id', normId);
      if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy định mức.');
      updateRowFields_(SHEETS.VPP_NORMS, found.rowIndex, found.record, fields);
      saved = normFromRow_(Object.assign({}, found.record, fields));
      appendHistory_(normId, 'VPP_NORM_UPDATED', actorLabel_(actor), '', '',
        'Sửa định mức ' + p.productName + ' – ' + scopeName + ': ' + found.record.monthly_quantity + ' → ' + qty + '/tháng',
        { before: normFromRow_(found.record), after: fields }, 'VPP_NORM');
    } else {
      var row = Object.assign({ norm_id: uuid_(), created_at: now, source_ref: 'ADMIN' }, fields);
      appendObjects_(SHEETS.VPP_NORMS, [row]);
      saved = normFromRow_(row);
      appendHistory_(row.norm_id, 'VPP_NORM_CREATED', actorLabel_(actor), '', '',
        'Thêm định mức ' + p.productName + ' – ' + scopeName + ': ' + qty + '/tháng', { after: fields }, 'VPP_NORM');
    }
    invalidateCaches_();
    return { norm: saved };
  });
}

/** Gắn phòng ban → phạm vi định mức (scopeId rỗng = bỏ gắn, dùng tự khớp theo tên; "NONE" = không áp dụng). */
function apiVppSetScopeMapping_(data) {
  var actor = sanitizeActor_(data.actor);
  var department = cleanLine_(data.department);
  var scopeId = String(data.scopeId || '').trim().toUpperCase();
  if (!department) throw validationError_({ department: 'Thiếu phòng ban' });
  if (scopeId && scopeId !== 'NONE' && !/^[A-Z0-9_]{1,40}$/.test(scopeId)) throw validationError_({ scopeId: 'Phạm vi không hợp lệ' });
  if (scopeId && scopeId !== 'NONE' && !listNormScopes_().some(function (s) { return s.scopeId === scopeId; })) {
    throw validationError_({ scopeId: 'Phạm vi định mức không tồn tại' });
  }
  return withScriptLock_(function () {
    upsertSetting_(scopeSettingKey_(department), scopeId, 'Phạm vi định mức VPP của phòng ban: ' + department);
    appendHistory_(scopeSettingKey_(department), 'VPP_SCOPE_MAPPED', actorLabel_(actor), '', scopeId,
      'Gắn phòng ban "' + department + '" → ' + (scopeId || '(tự khớp theo tên)'), null, 'VPP_NORM');
    return { department: department, scope: resolveDepartmentScope_(department) };
  });
}

// ============================================================================
// Admin — nhập kho / kiểm kê / lịch sử kho
// ============================================================================

function requireOperationId_(prefix, value) {
  var id = optionalRequestId_(value);
  if (!id) throw appError_('BAD_REQUEST', 'Thiếu mã thao tác (clientRequestId).');
  return prefix + ':' + id;
}

function apiVppStockIn_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  var reasonType = String(data.reasonType || '').toUpperCase();
  var qty = Number(data.quantity);
  var price = data.unitPrice === null || data.unitPrice === undefined || data.unitPrice === '' ? null : roundPrice_(data.unitPrice);
  var note = cleanText_(data.note);
  var date = String(data.date || '').trim();
  var errors = {};
  if (!isUuid_(productId)) errors.productId = 'Chọn sản phẩm';
  if (!STOCK_IN_REASONS[reasonType]) errors.reasonType = 'Chọn lý do nhập kho';
  if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) errors.quantity = 'Số lượng phải là số nguyên ≥ 1';
  if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors.unitPrice = 'Đơn giá không hợp lệ';
  if (date && !isValidDateOnly_(date)) errors.date = 'Ngày không hợp lệ';
  if (note.length > LIMITS.STOCK_REASON) errors.note = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (reasonType === 'KHAC' && !note) errors.note = 'Nhập ghi chú cho lý do "Khác"';
  if (Object.keys(errors).length) throw validationError_(errors);
  var operationId = requireOperationId_('STOCK_IN', data.clientRequestId);

  return withScriptLock_(function () {
    var p = productFromRow_(requireProduct_(productId).record);
    if (!isUsableProduct_(p)) throw appError_('INVALID_STATE', 'Sản phẩm đã ngừng sử dụng hoặc đang chờ duyệt.');
    var type = reasonType === 'TON_DAU_KY' ? MOVEMENT_TYPES.INITIAL : MOVEMENT_TYPES.IN;
    var reason = truncate_(STOCK_IN_REASONS[reasonType] + (date ? ' · ngày ' + formatDisplayDate_(date) : '') +
      (price !== null ? ' · đơn giá ' + price : '') + (note ? ' · ' + note : ''), 1000);
    var prior = priorOperation_(operationId);
    if (prior) {
      // Gửi lại (mất phản hồi) đúng thao tác đã ghi → không ghi lần 2. KHÁC số / lý do → không ghi, báo rõ số đã ghi.
      var same = String(prior.product_id).toLowerCase() === productId && prior.movement_type === type &&
        toIntOrNull_(prior.quantity) === qty && String(prior.reason) === reason;
      if (!same) throw requestReusedStockError_(prior, p, 'Lần nhập kho trước');
    } else {
      applyStockMovements_([{ productId: productId, type: type, quantity: qty, operationId: operationId, reason: reason }], actor, nowIso_());
    }
    return { product: productView_(p, loadStockMap_()[productId]), duplicate: Boolean(prior) };
  });
}

/** Dòng biến động kho đầu tiên của một mã thao tác (null: chưa ghi). */
function priorOperation_(operationId) {
  var rows = operationId ? findRows_(SHEETS.VPP_MOVEMENTS, 'operation_id', operationId) : [];
  return rows.length ? rows[0].record : null;
}

/**
 * Mã thao tác đã dùng cho lần gửi trước với số KHÁC (lần trước mất phản hồi nhưng đã ghi, người dùng mở lại / sửa số rồi gửi lại):
 * không ghi đè, không cộng thêm — báo đúng số đã ghi để người dùng tải lại và quyết định.
 */
function requestReusedStockError_(prior, product, what) {
  var q = toIntOrNull_(prior.quantity) || 0;
  var recorded = prior.movement_type === MOVEMENT_TYPES.ADJUSTMENT
    ? 'kiểm kê tồn thực tế ' + (toIntOrNull_(prior.on_hand_after) === null ? '?' : toIntOrNull_(prior.on_hand_after))
    : (q >= 0 ? '+' : '') + q;
  return appError_('REQUEST_REUSED', what + ' (mất kết nối trước khi nhận được phản hồi) ĐÃ ghi ' + recorded + (product.unit ? ' ' + product.unit : '') +
    ' cho "' + product.productName + '" lúc ' + formatDisplayDateTime_(prior.created_at) + '. Số vừa nhập CHƯA được ghi — tải lại trang để ' +
    'xem tồn hiện tại rồi thao tác tiếp nếu cần.', { existing: { operationId: prior.operation_id } });
}

function apiVppStockAdjust_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  var counted = Number(data.countedQuantity);
  var reason = cleanText_(data.reason);
  var errors = {};
  if (!isUuid_(productId)) errors.productId = 'Chọn sản phẩm';
  if (!isFinite(counted) || Math.floor(counted) !== counted || counted < 0 || counted > LIMITS.MAX_QUANTITY) {
    errors.countedQuantity = 'Tồn kiểm kê phải là số nguyên ≥ 0';
  }
  if (reason.length < 3) errors.reason = 'Nhập lý do điều chỉnh / kiểm kê';
  else if (reason.length > LIMITS.STOCK_REASON) errors.reason = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  var operationId = requireOperationId_('ADJUST', data.clientRequestId);

  return withScriptLock_(function () {
    var p = productFromRow_(requireProduct_(productId).record);
    if (p.catalogStatus === CATALOG_STATUS.ARCHIVED) throw appError_('INVALID_STATE', 'Sản phẩm đã lưu trữ.');
    if (p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) {
      throw appError_('INVALID_STATE', 'Sản phẩm đang chờ duyệt từ đề xuất mua — hãy quyết định trong đề xuất trước khi kiểm kê.');
    }
    var prior = priorOperation_(operationId);
    if (prior) {
      // Gửi lại (mất phản hồi) đúng lần kiểm kê đã ghi → không ghi lần 2; KHÁC số / lý do → báo rõ số đã ghi (không âm thầm bỏ qua).
      var same = String(prior.product_id).toLowerCase() === productId && prior.movement_type === MOVEMENT_TYPES.ADJUSTMENT &&
        toIntOrNull_(prior.on_hand_after) === counted && String(prior.reason).slice(-(reason.length + 3)) === ' · ' + reason;
      if (!same) throw requestReusedStockError_(prior, p, 'Lần kiểm kê trước');
    } else {
      // Chênh lệch kiểm kê tính so với số theo SỔ biến động (applyStockMovements_), không theo số trên sheet có thể đã bị
      // sửa tay — sau kiểm kê, sổ và dòng tồn cùng bằng số thực tế.
      applyStockMovements_([{
        productId: productId,
        type: MOVEMENT_TYPES.ADJUSTMENT,
        setTo: counted,
        quantity: 0,
        operationId: operationId,
        reason: function (systemQty) {
          return 'Kiểm kê: hệ thống ' + (systemQty === null ? 'chưa rõ' : systemQty) + ' → thực tế ' + counted + ' · ' + reason;
        },
        resolveReview: true
      }], actor, nowIso_());
    }
    return { product: productView_(p, loadStockMap_()[productId]), duplicate: Boolean(prior) };
  });
}

function apiVppListMovements_(q) {
  q = q || {};
  var exportAll = q.exportAll === true; // xuất CSV: một trang tối đa APP.EXPORT_MAX_ROWS dòng
  var page = exportAll ? 1 : clampInt_(q.page, 1, 100000, 1);
  var pageSize = exportAll ? APP.EXPORT_MAX_ROWS : clampInt_(q.pageSize, 10, 200, 50);
  var productId = String(q.productId || '').toLowerCase();
  var type = MOVEMENT_TYPES[String(q.type || '').toUpperCase()] || '';
  var from = isValidDateOnly_(q.from) ? q.from : '';
  var to = isValidDateOnly_(q.to) ? q.to : '';
  var needle = normalizeText_(q.q);
  var products = loadProductMap_();
  var rows = readTable_(SHEETS.VPP_MOVEMENTS).rows.filter(function (r) {
    if (!r.movement_id) return false;
    if (productId && String(r.product_id).toLowerCase() !== productId) return false;
    if (type && r.movement_type !== type) return false;
    var day = String(r.created_at || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (needle) {
      var p = products[String(r.product_id).toLowerCase()];
      var hay = normalizeText_([p ? p.productName : '', p ? p.productCode : '', r.reason, r.actor_name, r.operation_id].join(' '));
      if (hay.indexOf(needle) < 0) return false;
    }
    return true;
  });
  rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b._row - a._row; });
  var handoverCodes = {};
  if (rows.length) {
    readColumns_(SHEETS.HANDOVERS, ['handover_id', 'handover_code']).forEach(function (h) { handoverCodes[h.handover_id] = h.handover_code; });
  }
  var proposalCodes = {};
  if (rows.some(function (r) { return r.proposal_id; })) {
    readColumns_(SHEETS.VPP_PROPOSALS, ['proposal_id', 'proposal_code']).forEach(function (p) { proposalCodes[p.proposal_id] = p.proposal_code; });
  }
  var start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize).map(function (r) {
      var p = products[String(r.product_id).toLowerCase()];
      return {
        movementId: r.movement_id,
        productId: String(r.product_id).toLowerCase(),
        productName: p ? p.productName : '(không rõ)',
        productCode: p ? p.productCode : '',
        unit: p ? p.unit : '',
        movementType: r.movement_type,
        quantity: toIntOrNull_(r.quantity) || 0,
        onHandBefore: toIntOrNull_(r.on_hand_before),
        onHandAfter: toIntOrNull_(r.on_hand_after),
        reservedBefore: toIntOrNull_(r.reserved_before) || 0,
        reservedAfter: toIntOrNull_(r.reserved_after) || 0,
        handoverId: r.handover_id || '',
        handoverCode: handoverCodes[r.handover_id] || '',
        proposalId: r.proposal_id || '',
        proposalCode: proposalCodes[r.proposal_id] || '',
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
// Admin — ngữ cảnh form tạo / sửa phiếu VPP
// ============================================================================

/**
 * Danh mục + tồn (khả dụng) + định mức tháng của phòng ban người nhận.
 * handoverId (khi sửa): số đang giữ chỗ cho chính phiếu đó được cộng vào khả dụng.
 */
function apiVppHandoverContext_(data) {
  var receiver = data.receiverEmployeeId ? findEmployeeById_(cleanLine_(data.receiverEmployeeId)) : null;
  var handoverId = isUuid_(data.handoverId) ? String(data.handoverId).toLowerCase() : '';
  var scope = receiver ? resolveDepartmentScope_(receiver.department) : null;
  healDirtyStockIfNeeded_(); // lần ghi kho trước lỗi giữa chừng → sửa số theo sổ trước khi hiện
  var products = loadProducts_().filter(isUsableProduct_);
  // Khả dụng theo SỔ biến động — đúng số mà lúc lưu phiếu sẽ kiểm tra (sheet có thể đã bị sửa tay).
  var stock = ledgerStockMap_(loadStockMap_(), products.map(function (p) { return p.productId; }));
  var own = handoverId ? handoverStockNet_(handoverId) : {};
  var norms = scope ? normsForScope_(scope.scopeId) : {};
  var usage = scope ? scopeUsage_(scope.scopeId, monthKey_(''), handoverId) : {};
  var list = products.map(function (p) {
    var v = productView_(p, stock[p.productId]);
    var ownReserved = own[p.productId] ? Math.max(0, own[p.productId].reserved) : 0;
    v.reservedByThisHandover = ownReserved;
    if (v.stock.available !== null) v.stock.available += ownReserved;
    var norm = norms[p.productId];
    if (norm) {
      var u = usage[p.productId] || { confirmed: 0, pending: 0 };
      v.norm = {
        monthlyQuantity: norm.monthlyQuantity,
        issued: u.confirmed,
        pending: u.pending,
        remaining: norm.monthlyQuantity - u.confirmed - u.pending
      };
    } else {
      v.norm = null;
    }
    return v;
  });
  list.sort(function (a, b) {
    if (Boolean(a.norm) !== Boolean(b.norm)) return a.norm ? -1 : 1;
    return compareVi_(a.productName, b.productName);
  });
  return {
    receiver: receiver ? { employeeId: receiver.employeeId, fullName: receiver.fullName, department: receiver.department, position: receiver.position } : null,
    scope: scope,
    month: monthKey_(''),
    products: list
  };
}

// ============================================================================
// Dashboard & cảnh báo
// ============================================================================

function vppStockAlerts_() {
  var products = loadProducts_().filter(function (p) { return p.active && p.catalogStatus !== CATALOG_STATUS.ARCHIVED && p.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL; });
  var stock = loadStockMap_();
  var out = { outOfStock: [], lowStock: [], unknown: [] };
  products.forEach(function (p) {
    var v = productView_(p, stock[p.productId]);
    var brief = {
      productId: p.productId, productCode: p.productCode, productName: p.productName, unit: p.unit,
      onHand: v.stock.onHand, reserved: v.stock.reserved, available: v.stock.available, minimumStock: v.stock.minimumStock,
      rawInitialValue: v.stock.rawInitialValue, catalogStatus: p.catalogStatus
    };
    if (v.stock.status === 'OUT_OF_STOCK') out.outOfStock.push(brief);
    else if (v.stock.status === 'LOW_STOCK') out.lowStock.push(brief);
    else if (v.stock.status === 'UNKNOWN') out.unknown.push(brief);
  });
  ['outOfStock', 'lowStock', 'unknown'].forEach(function (k) {
    out[k].sort(function (a, b) { return compareVi_(a.productName, b.productName); });
  });
  return out;
}

/** Bản rút gọn cho trang Tổng quan admin. Không làm hỏng trang nếu module VPP chưa được nâng cấp. */
function vppAlertsSummary_() {
  try {
    var alerts = vppStockAlerts_();
    var review = vppReviewCounts_();
    var proposals = readColumns_(SHEETS.VPP_PROPOSALS, ['proposal_id', 'status']);
    return {
      ready: true,
      outOfStock: alerts.outOfStock.slice(0, 10),
      outOfStockCount: alerts.outOfStock.length,
      lowStock: alerts.lowStock.slice(0, 10),
      lowStockCount: alerts.lowStock.length,
      needsReviewCount: review.total,
      needsReviewProducts: review.products,
      submittedProposals: proposals.filter(function (p) { return p.status === PROPOSAL_STATUS.SUBMITTED; }).length
    };
  } catch (e) {
    if (!e.appCode) throw e;
    return {
      ready: false, outOfStock: [], outOfStockCount: 0, lowStock: [], lowStockCount: 0, needsReviewCount: 0,
      needsReviewProducts: 0, submittedProposals: 0
    };
  }
}

function apiVppDashboard_() {
  healDirtyStockIfNeeded_();
  var alerts = vppStockAlerts_();
  var products = loadProducts_();
  var proposals = readTable_(SHEETS.VPP_PROPOSALS).rows;
  var byStatus = {};
  proposals.forEach(function (p) { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
  // Phiếu VPP đang giữ chỗ: chờ ký (PENDING) và người nhận yêu cầu sửa (REVISION_REQUESTED) — đếm riêng để mỗi số
  // dẫn tới đúng danh sách đã lọc theo trạng thái đó.
  var supplyHandovers = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'handover_type', 'status']).filter(function (h) {
    return h.handover_type === 'OFFICE_SUPPLY';
  });
  var pendingHandovers = supplyHandovers.filter(function (h) { return h.status === STATUS.PENDING; }).length;
  var revisionHandovers = supplyHandovers.filter(function (h) { return h.status === STATUS.REVISION_REQUESTED; }).length;
  var stock = loadStockMap_();
  var reservedUnits = 0;
  Object.keys(stock).forEach(function (pid) { reservedUnits += stock[pid].reserved; });
  var review = vppReviewCounts_();
  return {
    counts: {
      // Khớp danh sách Tồn kho khi lọc theo "Danh mục" / "Tạm" (gồm cả sản phẩm tạm ngừng dùng, không gồm đã lưu trữ).
      products: products.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.MASTER; }).length,
      tempProducts: products.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.TEMP; }).length,
      outOfStock: alerts.outOfStock.length,
      lowStock: alerts.lowStock.length,
      unknownStock: alerts.unknown.length,
      needsReview: review.total,
      needsReviewProducts: review.products,
      submittedProposals: byStatus[PROPOSAL_STATUS.SUBMITTED] || 0,
      approvedProposals: (byStatus[PROPOSAL_STATUS.APPROVED] || 0) + (byStatus[PROPOSAL_STATUS.PARTIALLY_APPROVED] || 0) +
        (byStatus[PROPOSAL_STATUS.PURCHASED] || 0),
      pendingHandovers: pendingHandovers,
      revisionHandovers: revisionHandovers,
      reservedUnits: reservedUnits
    },
    outOfStock: alerts.outOfStock,
    lowStock: alerts.lowStock,
    unknown: alerts.unknown,
    recentProposals: vppProposalSummaries_(proposals).slice(0, 8)
  };
}

// ============================================================================
// Rà soát dữ liệu (Dữ liệu cần kiểm tra)
// ============================================================================

/** Từ đồng nghĩa khi gợi ý ghép tên (chỉ để GỢI Ý — không tự ghép). Bản có dấu và bản không dấu. */
var NAME_SYNONYMS_ = { kinh: 'kieng' };
var TONE_SYNONYMS_ = { 'kính': 'kiếng' };

function uniqueTokens_(tokens, synonyms) {
  var seen = {};
  var out = [];
  tokens.forEach(function (t) {
    if (!t) return;
    var v = synonyms[t] || t;
    if (!seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  });
  return out;
}

/** Từ khóa KHÔNG dấu ("Bút bi" → but, bi). */
function nameTokens_(name) {
  return uniqueTokens_(matchKey_(name).split(' '), NAME_SYNONYMS_);
}

/** Từ khóa GIỮ dấu ("Kéo" → kéo): tiếng Việt bỏ dấu dễ nhầm nghĩa — kéo / kẹo / keo là ba thứ khác nhau. */
function toneTokens_(name) {
  return uniqueTokens_(String(name || '').normalize('NFC').toLowerCase().split(/[^0-9a-zÀ-ɏḀ-ỿ]+/), TONE_SYNONYMS_);
}

/** Phần tên tồn kho nằm trong tên danh mục (70%) + độ trùng tổng thể (30%). */
function tokenSimilarity_(A, B) {
  if (!A.length || !B.length) return 0;
  var inter = A.filter(function (t) { return B.indexOf(t) >= 0; }).length;
  if (!inter) return 0;
  return Math.round(((inter / A.length) * 0.7 + (inter / (A.length + B.length - inter)) * 0.3) * 100);
}

/**
 * Điểm gợi ý 0–100. So khớp CÓ dấu là chính; so khớp không dấu chỉ là phương án phụ (×0.6, thường dưới ngưỡng 50)
 * — tránh gợi ý "Kéo" → "Kẹo phòng họp". Chỉ là gợi ý: admin luôn tự chọn khi GHÉP.
 */
function nameSimilarity_(a, b) {
  var exact = tokenSimilarity_(toneTokens_(a), toneTokens_(b));
  var loose = Math.round(tokenSimilarity_(nameTokens_(a), nameTokens_(b)) * 0.6);
  return Math.max(exact, loose);
}

function suggestMasterProducts_(name, masters, limit) {
  return masters
    .map(function (m) { return { productId: m.productId, productCode: m.productCode, productName: m.productName, unit: m.unit, score: nameSimilarity_(name, m.productName) }; })
    .filter(function (s) { return s.score >= 50; })
    .sort(function (x, y) { return y.score - x.score || compareVi_(x.productName, y.productName); })
    .slice(0, limit || 3);
}

/** Phiếu VPP có lượng giữ chỗ / xuất kho lệch với trạng thái + nội dung (cần "Đối soát kho"). */
function vppStockMismatches_() {
  var heads = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'handover_code', 'handover_type', 'status']).filter(function (h) {
    return h.handover_type === 'OFFICE_SUPPLY';
  });
  if (!heads.length) return [];
  var desired = {};
  var revisions = committedRevisionMap_();
  readColumns_(SHEETS.ITEMS, ['handover_id', 'product_id', 'quantity', 'superseded_at', 'affects_inventory', 'revision_id']).forEach(function (it) {
    if (!isCommittedItemRow_(it, revisions[it.handover_id]) || !toBool_(it.affects_inventory)) return;
    var d = desired[it.handover_id] || (desired[it.handover_id] = {});
    var pid = String(it.product_id).toLowerCase();
    d[pid] = (d[pid] || 0) + (toIntOrNull_(it.quantity) || 0);
  });
  var net = {};
  readColumns_(SHEETS.VPP_MOVEMENTS, ['handover_id', 'product_id', 'movement_type', 'quantity']).forEach(function (m) {
    if (!m.handover_id) return;
    var n = net[m.handover_id] || (net[m.handover_id] = {});
    var pid = String(m.product_id).toLowerCase();
    var x = n[pid] || (n[pid] = { reserved: 0, consumed: 0 });
    var q = Math.abs(toIntOrNull_(m.quantity) || 0);
    if (m.movement_type === MOVEMENT_TYPES.RESERVE) x.reserved += q;
    else if (m.movement_type === MOVEMENT_TYPES.RELEASE) x.reserved -= q;
    else if (m.movement_type === MOVEMENT_TYPES.OUT) {
      x.reserved -= q;
      x.consumed += q;
    }
  });
  var out = [];
  heads.forEach(function (h) {
    var want = desired[h.handover_id] || {};
    var have = net[h.handover_id] || {};
    var pids = Object.keys(want);
    Object.keys(have).forEach(function (pid) { if (pids.indexOf(pid) < 0) pids.push(pid); });
    var bad = pids.some(function (pid) {
      var q = want[pid] || 0;
      var x = have[pid] || { reserved: 0, consumed: 0 };
      var wantReserved = h.status === STATUS.PENDING || h.status === STATUS.REVISION_REQUESTED ? q : 0;
      var wantConsumed = h.status === STATUS.CONFIRMED ? q : 0;
      return x.reserved !== wantReserved || x.consumed !== wantConsumed;
    });
    if (bad) out.push({ handoverId: h.handover_id, handoverCode: h.handover_code, status: h.status });
  });
  return out;
}

/**
 * Số mục cần kiểm tra. total = số VẤN ĐỀ (một sản phẩm có thể vừa chưa ghép, vừa thiếu ĐVT, vừa chưa rõ số lượng);
 * products = số SẢN PHẨM khác nhau có ít nhất một vấn đề — giao diện hiện cả hai để không gây hiểu nhầm.
 */
function vppReviewCounts_() {
  var products = loadProducts_();
  var stock = loadStockMap_();
  var live = products.filter(function (p) { return p.catalogStatus !== CATALOG_STATUS.ARCHIVED; });
  var flagged = {};
  var count = function (list) {
    list.forEach(function (pid) { flagged[pid] = true; });
    return list.length;
  };
  var unmapped = count(live.filter(function (p) { return p.reviewStatus === REVIEW_STATUS.PENDING; }).map(function (p) { return p.productId; }));
  var pending = count(live.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL; }).map(function (p) { return p.productId; }));
  var unclear = count(live.filter(function (p) { return stock[p.productId] && stock[p.productId].onHand === null; }).map(function (p) { return p.productId; }));
  var missingUnit = count(live.filter(function (p) { return !p.unit; }).map(function (p) { return p.productId; }));
  return {
    unmapped: unmapped, pendingApproval: pending, unclearQuantity: unclear, missingUnit: missingUnit,
    total: unmapped + pending + unclear + missingUnit,
    products: Object.keys(flagged).length
  };
}

/** Khóa tên GIỮ DẤU, bỏ khác biệt dấu câu ("Bút bi, xanh" = "bút bi xanh"; "Kéo" ≠ "Kẹo"). */
function accentNameKey_(name) {
  return exactNameKey_(name).replace(/[\s.,;:\/\\()\[\]{}"'`+*&|_-]+/g, ' ').trim();
}

/**
 * Nhóm sản phẩm có thể bị trùng: cùng tên khi GIỮ DẤU (khác hoa / thường, khoảng trắng, dấu câu) — "Kéo" và "Kẹo" là hai
 * sản phẩm khác nhau, không bị báo trùng. Tên gõ KHÔNG DẤU ("Keo") có thể là bất kỳ tên có dấu nào cùng mặt chữ → được
 * đưa vào nhóm của từng tên có dấu đó (quản trị viên tự xem). Trả về [{ key, products }].
 */
function duplicateProductGroups_(products) {
  var byPlain = {};
  products.forEach(function (p) {
    var plain = p.normalizedName || matchKey_(p.productName);
    if (plain) (byPlain[plain] = byPlain[plain] || []).push(p);
  });
  var groups = [];
  Object.keys(byPlain).sort(compareVi_).forEach(function (plain) {
    var members = byPlain[plain];
    if (members.length < 2) return;
    var unaccented = [];
    var byAccent = {};
    members.forEach(function (p) {
      var key = accentNameKey_(p.productName);
      if (normalizeText_(p.productName) === exactNameKey_(p.productName)) unaccented.push(p); // tên gõ không dấu
      else (byAccent[key] = byAccent[key] || []).push(p);
    });
    var accentKeys = Object.keys(byAccent).sort(compareVi_);
    if (!accentKeys.length) {
      groups.push({ key: plain, products: unaccented });
      return;
    }
    accentKeys.forEach(function (key) {
      var cluster = byAccent[key].concat(unaccented);
      if (cluster.length > 1) groups.push({ key: key, products: cluster });
    });
  });
  return groups;
}

function apiVppDataReview_() {
  healDirtyStockIfNeeded_();
  var products = loadProducts_();
  var stock = loadStockMap_();
  var masters = products.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.MASTER && p.active; });
  var live = products.filter(function (p) { return p.catalogStatus !== CATALOG_STATUS.ARCHIVED; });
  var brief = function (p) {
    var v = productView_(p, stock[p.productId]);
    return {
      productId: p.productId, productCode: p.productCode, productName: p.productName, unit: p.unit, category: p.category,
      catalogStatus: p.catalogStatus, source: p.source, reviewStatus: p.reviewStatus, note: p.note,
      onHand: v.stock.onHand, reserved: v.stock.reserved, rawInitialValue: v.stock.rawInitialValue, needsReview: v.stock.needsReview
    };
  };

  var unmapped = live
    .filter(function (p) { return p.reviewStatus === REVIEW_STATUS.PENDING; })
    .map(function (p) {
      var b = brief(p);
      b.suggestions = suggestMasterProducts_(p.productName, masters.filter(function (m) { return m.productId !== p.productId; }), 3);
      return b;
    });

  var day = todayIsoDate_();
  var normed = {};
  loadNorms_().forEach(function (n) { if (isNormEffective_(n, day)) normed[n.productId] = true; });

  var duplicates = duplicateProductGroups_(live).map(function (g) { return { normalizedName: g.key, products: g.products.map(brief) }; });

  var scopes = listNormScopes_();
  var settings = getSettings_();
  var deptCount = {};
  getEmployees_().forEach(function (e) {
    if (e.status !== 'ACTIVE' || !e.department) return;
    // "Không áp dụng định mức" là lựa chọn của quản trị viên — không phải "chưa gắn", không liệt kê là cần xử lý.
    if (isDepartmentExcludedFromNorms_(e.department, settings)) return;
    if (!resolveDepartmentScope_(e.department, scopes)) deptCount[e.department] = (deptCount[e.department] || 0) + 1;
  });

  return {
    unmapped: unmapped,
    missingUnit: live.filter(function (p) { return !p.unit; }).map(brief),
    unclearQuantity: live.filter(function (p) { return stock[p.productId] && stock[p.productId].onHand === null; }).map(brief),
    missingNorm: masters.filter(function (p) { return !normed[p.productId]; }).map(brief),
    missingMinimumStock: masters.filter(function (p) { return !p.minimumStock; }).map(brief),
    duplicates: duplicates,
    pendingApproval: live.filter(function (p) { return p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL; }).map(brief),
    unmappedDepartments: Object.keys(deptCount).sort(compareVi_).map(function (d) { return { department: d, employeeCount: deptCount[d] }; }),
    stockMismatches: vppStockMismatches_(),
    stockDrifts: stockLedgerDrifts_(),
    scopes: scopes,
    masters: masters.map(function (m) { return { productId: m.productId, productCode: m.productCode, productName: m.productName, unit: m.unit }; })
  };
}

/** Thông báo chung: sản phẩm chờ duyệt (từ đề xuất mua) chỉ xử lý trong trang đề xuất. */
var PENDING_PRODUCT_MESSAGE_ = 'Sản phẩm mới từ đề xuất mua đang chờ duyệt — hãy xử lý trong trang chi tiết đề xuất ' +
  '(Thêm vào danh mục / Giữ tạm / Ghép / Từ chối).';

/**
 * ĐVT nguồn và đích chắc chắn giống nhau? So GIỮ DẤU ("Cuốn" ≠ "Cuộn", "Bó" ≠ "Bộ" — trước đây so bỏ dấu nên GHÉP / quyết định
 * sản phẩm không hỏi quy đổi), chỉ bỏ khác biệt hoa / thường, khoảng trắng, dấu câu. Một bên trống = chưa rõ → phải quy đổi thủ
 * công. Khớp sameUnit (shared/text.ts) ở giao diện.
 */
function sameUnit_(a, b) {
  return Boolean(a && b && accentNameKey_(a) === accentNameKey_(b));
}

/**
 * GHÉP: chuyển tồn của sản phẩm tạm (ví dụ "Giấy ướt" từ tồn đầu kỳ) sang sản phẩm danh mục ("Khăn giấy ướt").
 * quantity = số lượng tính theo ĐVT của sản phẩm đích. ĐVT khác nhau / nguồn chưa có ĐVT → bắt buộc nhập số lượng ĐÃ QUY ĐỔI
 * và xác nhận (unitConverted = true) — không bao giờ chuyển nguyên "11 hộp" thành "11 cái".
 * Idempotent theo MERGE:{nguồn}: lần trước đã chuyển tồn nhưng lỗi trước khi lưu trữ nguồn → chỉ hoàn tất, không chuyển lần 2.
 */
function apiVppMergeProduct_(data) {
  var actor = sanitizeActor_(data.actor);
  var sourceId = String(data.sourceProductId || '').toLowerCase();
  var targetId = String(data.targetProductId || '').toLowerCase();
  var reason = cleanText_(data.reason);
  var qtyRaw = data.quantity;
  var unitConverted = data.unitConverted === true;
  if (!isUuid_(sourceId) || !isUuid_(targetId) || sourceId === targetId) {
    throw validationError_({ targetProductId: 'Chọn sản phẩm đích khác sản phẩm nguồn' });
  }
  if (reason.length > LIMITS.STOCK_REASON) throw validationError_({ reason: 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự' });
  return withScriptLock_(function () {
    var now = nowIso_();
    var srcRow = requireProduct_(sourceId);
    var tgtRow = requireProduct_(targetId);
    var src = productFromRow_(srcRow.record);
    var tgt = productFromRow_(tgtRow.record);
    var op = 'MERGE:' + sourceId;
    var priorMoves = findRows_(SHEETS.VPP_MOVEMENTS, 'operation_id', op);
    var resumed = priorMoves.length > 0;
    // Lần ghép trước lỗi giữa chừng có thể đã lưu trữ nguồn mà chưa ghi merged_into / lịch sử: vẫn cho hoàn tất (kiểm tra "đã xử lý"
    // SAU khi biết có phải làm tiếp không). Dấu hiệu ghi dở khi không có biến động: lưu trữ nhưng chưa có merged_into và rà soát còn chờ.
    var halfArchived = src.catalogStatus === CATALOG_STATUS.ARCHIVED && !src.mergedIntoProductId && src.reviewStatus === REVIEW_STATUS.PENDING;
    if (src.catalogStatus === CATALOG_STATUS.ARCHIVED && !resumed && !halfArchived) {
      throw appError_('INVALID_STATE', 'Sản phẩm nguồn đã được xử lý trước đó.');
    }
    if (src.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) throw appError_('INVALID_STATE', PENDING_PRODUCT_MESSAGE_);
    if (!isUsableProduct_(tgt)) throw appError_('INVALID_STATE', 'Sản phẩm đích không dùng được.');
    if (resumed) {
      // Lần ghép trước đã chuyển tồn nhưng lỗi trước khi lưu trữ nguồn → chỉ được hoàn tất với ĐÚNG sản phẩm đích đã nhận tồn.
      var priorTarget = priorMoves.map(function (m) { return String(m.record.product_id || '').toLowerCase(); })
        .filter(function (pid) { return pid && pid !== sourceId; })[0];
      if (priorTarget && priorTarget !== targetId) {
        var prior = loadProductMap_()[priorTarget];
        throw appError_('CONFLICT', 'Lần ghép trước (bị lỗi giữa chừng) đã chuyển tồn của "' + src.productName + '" sang "' +
          (prior ? prior.productName : priorTarget) + '". Chọn lại đúng sản phẩm đó để hoàn tất.', { priorTargetProductId: priorTarget });
      }
    }
    var note = 'Ghép "' + src.productName + '" → "' + tgt.productName + '"' + (reason ? ' · ' + reason : '');
    var stockRows = ensureStockRows_([sourceId, targetId], actor, now);
    var effective = effectiveStockMap_([sourceId, targetId], stockRows); // số theo sổ — đúng số sẽ dùng khi ghi
    var s = effective[sourceId];
    var t = effective[targetId];
    var qty = null;
    if (!resumed) {
      if (s.reserved > 0) {
        throw appError_('INVALID_STATE', 'Sản phẩm "' + src.productName + '" đang được giữ chỗ trong phiếu chờ ký — xử lý phiếu trước khi ghép.');
      }
      var unitOk = sameUnit_(src.unit, tgt.unit);
      var unitHint = src.unit
        ? 'ĐVT khác nhau (' + src.unit + ' → ' + (tgt.unit || 'chưa có') + ')'
        : '"' + src.productName + '" chưa có ĐVT';
      if (qtyRaw === null || qtyRaw === undefined || qtyRaw === '') {
        if (s.onHand === null) throw validationError_({ quantity: 'Tồn của "' + src.productName + '" chưa rõ — nhập số lượng thực tế để ghép.' });
        if (!unitOk && s.onHand > 0) throw validationError_({ quantity: unitHint + ' — nhập số lượng quy đổi theo ĐVT "' + (tgt.unit || '') + '".' });
        qty = s.onHand;
      } else {
        qty = Number(qtyRaw);
        if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_QUANTITY) throw validationError_({ quantity: 'Số lượng phải là số nguyên ≥ 0' });
        if (!unitOk && !unitConverted && qty > 0) {
          throw validationError_({ unitConverted: unitHint + ' — xác nhận số lượng đã quy đổi sang ĐVT "' + (tgt.unit || '') + '".' });
        }
        // Nguồn đã kiểm (tồn 0) thì không có gì để chuyển: số nhập thêm sẽ thành tồn "từ không khí" ở sản phẩm đích.
        if (s.onHand === 0 && qty > 0) {
          throw validationError_({ quantity: '"' + src.productName + '" đang tồn 0 — không có gì để chuyển. Nhập 0, hoặc kiểm kê nguồn trước nếu số 0 sai.' });
        }
      }
      // Đích chưa rõ tồn (chưa kiểm kê): cộng thêm sẽ biến nó thành "đã rõ = số chuyển sang", bỏ qua hàng thật đang có.
      if (qty > 0 && t.onHand === null) {
        throw validationError_({ targetProductId: 'Tồn của "' + tgt.productName + '" chưa rõ — kiểm kê sản phẩm đích trước khi ghép tồn vào.' });
      }
      var moves = [];
      if (s.onHand !== null && s.onHand > 0) {
        moves.push({ productId: sourceId, type: MOVEMENT_TYPES.ADJUSTMENT, setTo: 0, quantity: 0, operationId: op, reason: note });
      } else if (s.onHand === null) {
        moves.push({ productId: sourceId, type: MOVEMENT_TYPES.ADJUSTMENT, setTo: 0, quantity: 0, operationId: op, reason: note, resolveReview: true });
      }
      if (qty > 0) moves.push({ productId: targetId, type: MOVEMENT_TYPES.ADJUSTMENT, quantity: qty, operationId: op, reason: note + ' (+' + qty + ')' });
      applyStockMovements_(moves, actor, now);
    } else {
      logInfo_('vpp.merge_resumed', { sourceId: sourceId, targetId: targetId });
    }
    // Định mức chuyển TRƯỚC khi lưu trữ nguồn: lỗi ở bước sau → làm lại vẫn qua (nguồn chưa lưu trữ / còn biến động MERGE).
    var norms = transferNormsOnMerge_(src, tgt, now);
    updateRowFields_(SHEETS.VPP_PRODUCTS, srcRow.rowIndex, srcRow.record, {
      catalog_status: CATALOG_STATUS.ARCHIVED,
      review_status: REVIEW_STATUS.MAPPED,
      merged_into_product_id: targetId,
      active: 'FALSE',
      updated_at: now
    });
    var fresh = ensureStockRows_([sourceId], actor, now)[sourceId];
    if (fresh && fresh.needsReview) updateRowFields_(SHEETS.VPP_STOCK, fresh._row, fresh._record, { needs_review: 'FALSE', updated_at: now });
    appendHistory_(sourceId, 'VPP_PRODUCT_MERGED', actorLabel_(actor), src.catalogStatus, CATALOG_STATUS.ARCHIVED,
      note + (resumed ? ' (hoàn tất lần ghép trước — tồn đã chuyển, không chuyển lần 2)' : '') + normTransferNote_(norms, tgt),
      { targetProductId: targetId, quantity: qty, sourceOnHand: s.onHand, unitConverted: unitConverted, resumed: resumed, norms: norms },
      'VPP_PRODUCT');
    invalidateCaches_();
    return { merged: true, target: productView_(tgt, loadStockMap_()[targetId]), norms: norms };
  });
}

/**
 * GHÉP: sản phẩm nguồn bị lưu trữ nên định mức của nó không còn hiện cho nhân viên / phiếu. Định mức đang bật của nguồn:
 *   • chuyển sang sản phẩm đích khi CÙNG ĐVT và đích chưa có định mức đang áp dụng trong phạm vi đó;
 *   • còn lại (khác ĐVT — số lượng định mức không tự quy đổi được; đích đã có định mức) → tắt, ghi chú lý do.
 * Không âm thầm làm mất định mức của phòng ban. Trả về { moved: [tên phạm vi], deactivated: [tên phạm vi] }. Gọi trong khóa.
 */
function transferNormsOnMerge_(src, tgt, now) {
  var day = todayIsoDate_();
  var norms = loadNorms_();
  var unitOk = sameUnit_(src.unit, tgt.unit);
  var covered = {};
  norms.forEach(function (n) { if (n.productId === tgt.productId && isNormEffective_(n, day)) covered[n.scopeId] = true; });
  var report = { moved: [], deactivated: [] };
  norms.forEach(function (n) {
    if (n.productId !== src.productId || !n.active) return;
    var found = findRow_(SHEETS.VPP_NORMS, 'norm_id', n.normId);
    if (!found) return;
    if (unitOk && !covered[n.scopeId]) {
      updateRowFields_(SHEETS.VPP_NORMS, found.rowIndex, found.record, {
        product_id: tgt.productId, unit: tgt.unit || n.unit, updated_at: now,
        note: (n.note ? n.note + ' · ' : '') + 'Chuyển từ "' + src.productName + '" khi ghép sản phẩm'
      });
      covered[n.scopeId] = true;
      report.moved.push(n.scopeName || n.scopeId);
    } else {
      updateRowFields_(SHEETS.VPP_NORMS, found.rowIndex, found.record, {
        active: 'FALSE', updated_at: now,
        note: (n.note ? n.note + ' · ' : '') + 'Ngừng áp dụng khi ghép vào "' + tgt.productName + '" (' +
          (unitOk ? 'sản phẩm đích đã có định mức phạm vi này' : 'khác ĐVT — đặt định mức cho sản phẩm đích theo ĐVT của nó') + ')'
      });
      report.deactivated.push(n.scopeName || n.scopeId);
    }
  });
  return report;
}

function normTransferNote_(norms, tgt) {
  var parts = [];
  if (norms.moved.length) parts.push('định mức ' + norms.moved.join(', ') + ' chuyển sang "' + tgt.productName + '"');
  if (norms.deactivated.length) parts.push('định mức ' + norms.deactivated.join(', ') + ' ngừng áp dụng — kiểm tra trang Định mức');
  return parts.length ? ' · ' + parts.join('; ') : '';
}

/** TẠO SẢN PHẨM MỚI: chuyển sản phẩm tạm thành sản phẩm danh mục (MASTER), có thể kèm định mức. */
function apiVppPromoteProduct_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  var fields = validateProductFields_(data, true);
  if (!fields.unit) throw validationError_({ unit: 'Nhập ĐVT cho sản phẩm danh mục' });
  var norm = data.norm && typeof data.norm === 'object' ? data.norm : null;
  var result = withScriptLock_(function () {
    var now = nowIso_();
    var row = requireProduct_(productId);
    var p = productFromRow_(row.record);
    if (p.catalogStatus === CATALOG_STATUS.ARCHIVED) throw appError_('INVALID_STATE', 'Sản phẩm đã được xử lý trước đó.');
    if (p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) throw appError_('INVALID_STATE', PENDING_PRODUCT_MESSAGE_);
    if (norm) precheckAttachedNorm_(productId, norm); // lỗi định mức → chưa ghi gì
    var code = fields.productCode || p.productCode || nextProductCode_();
    if (productCodeTaken_(code, productId)) throw validationError_({ productCode: 'Mã sản phẩm "' + code + '" đã tồn tại' });
    var changes = {
      product_code: code,
      product_name: fields.productName,
      normalized_name: matchKey_(fields.productName),
      category: fields.category,
      unit: fields.unit,
      reference_price: fields.referencePrice === null ? '' : fields.referencePrice,
      minimum_stock: fields.minimumStock,
      catalog_status: CATALOG_STATUS.MASTER,
      active: 'TRUE',
      review_status: p.reviewStatus ? REVIEW_STATUS.RESOLVED : '',
      note: fields.note || p.note,
      updated_at: now
    };
    updateRowFields_(SHEETS.VPP_PRODUCTS, row.rowIndex, row.record, changes);
    var stock = ensureStockRows_([productId], actor, now)[productId];
    var stockChanges = { minimum_stock: fields.minimumStock, updated_at: now, updated_by: actorLabel_(actor) };
    if (stock.onHand !== null && stock.needsReview) stockChanges.needs_review = 'FALSE';
    updateRowFields_(SHEETS.VPP_STOCK, stock._row, stock._record, stockChanges);
    appendHistory_(productId, 'VPP_PRODUCT_PROMOTED', actorLabel_(actor), p.catalogStatus, CATALOG_STATUS.MASTER,
      'Đưa "' + fields.productName + '" vào danh mục (' + code + ')', { before: p, after: fields }, 'VPP_PRODUCT');
    if (norm) {
      // Định mức kèm theo lưu TRONG CÙNG khóa: không có khoảng hở để thao tác khác chen giữa sản phẩm và định mức của nó.
      apiVppSaveNorm_({
        productId: productId, scopeId: norm.scopeId, scopeName: norm.scopeName, monthlyQuantity: norm.monthlyQuantity,
        unit: fields.unit, referencePrice: fields.referencePrice, note: norm.note || '', actor: data.actor
      });
    }
    invalidateCaches_();
    return productFromRow_(Object.assign({}, row.record, changes));
  });
  return { product: productView_(result, loadStockMap_()[productId]) };
}

/** BỎ QUA: giữ sản phẩm tạm như một sản phẩm riêng ngoài định mức (không ghép). */
function apiVppSkipReview_(data) {
  var actor = sanitizeActor_(data.actor);
  var productId = String(data.productId || '').toLowerCase();
  return withScriptLock_(function () {
    var row = requireProduct_(productId);
    var p = productFromRow_(row.record);
    if (p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) throw appError_('INVALID_STATE', PENDING_PRODUCT_MESSAGE_);
    updateRowFields_(SHEETS.VPP_PRODUCTS, row.rowIndex, row.record, { review_status: REVIEW_STATUS.SKIPPED, updated_at: nowIso_() });
    appendHistory_(productId, 'VPP_REVIEW_SKIPPED', actorLabel_(actor), p.reviewStatus, REVIEW_STATUS.SKIPPED,
      'Giữ "' + p.productName + '" là sản phẩm riêng ngoài định mức', null, 'VPP_PRODUCT');
    return { skipped: true };
  });
}

// ============================================================================
// Công khai — tra cứu nhân viên & danh mục cho trang đề xuất VPP
// ============================================================================

function apiVppEmployeeLookup_(data) {
  var client = sanitizeClient_(data.client);
  // Chống dò mã nhân viên: giới hạn số lần tra SAI theo IP. Văn phòng dùng chung IP (NAT) nên giới hạn tổng để rộng hơn.
  if (client.ipHash) {
    var misses = parseInt(CacheService.getScriptCache().get('rl:vpp-miss:' + client.ipHash) || '0', 10) || 0;
    if (misses >= 20) throw appError_('RATE_LIMITED', 'Bạn đã tra cứu sai quá nhiều lần. Vui lòng thử lại sau ít phút.');
  }
  enforceRateLimit_('vpp-lookup', client.ipHash, 150, 600);
  var id = cleanLine_(data.employeeId);
  if (!id || id.length > LIMITS.EMPLOYEE_ID) throw validationError_({ employeeId: 'Nhập mã nhân viên' });
  var employee = findEmployeeById_(id);
  if (!employee || employee.status !== 'ACTIVE') {
    if (client.ipHash) {
      var cache = CacheService.getScriptCache();
      var key = 'rl:vpp-miss:' + client.ipHash;
      cache.put(key, String((parseInt(cache.get(key) || '0', 10) || 0) + 1), 600);
    }
    throw appError_('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên đang làm việc với mã này.', {
      fieldErrors: { employeeId: 'Không tìm thấy nhân viên đang làm việc với mã này.' }
    });
  }
  var scope = resolveDepartmentScope_(employee.department);
  var norms = [];
  if (scope) {
    var products = loadProductMap_();
    var map = normsForScope_(scope.scopeId);
    Object.keys(map).forEach(function (pid) {
      var p = products[pid];
      if (!p || p.catalogStatus !== CATALOG_STATUS.MASTER || !p.active) return;
      norms.push({ productId: pid, productName: p.productName, unit: p.unit || map[pid].unit, category: p.category, monthlyQuantity: map[pid].monthlyQuantity });
    });
    norms.sort(function (a, b) { return compareVi_(a.productName, b.productName); });
  }
  return {
    employee: { employeeId: employee.employeeId, fullName: employee.fullName, department: employee.department, position: employee.position },
    scope: scope ? { scopeId: scope.scopeId, scopeName: scope.scopeName } : null,
    norms: norms
  };
}

/** Danh mục công khai: chỉ sản phẩm chính thức đang dùng — không có tồn, giá hay dữ liệu nội bộ. */
function apiVppPublicCatalog_() {
  var cached = cacheGetJson_(CACHE_KEYS.VPP_CATALOG);
  if (cached) return cached;
  var products = loadProducts_()
    .filter(function (p) { return p.catalogStatus === CATALOG_STATUS.MASTER && p.active; })
    .map(function (p) { return { productId: p.productId, productName: p.productName, unit: p.unit, category: p.category }; });
  products.sort(function (a, b) { return compareVi_(a.productName, b.productName); });
  var out = { products: products };
  cachePutJson_(CACHE_KEYS.VPP_CATALOG, out, APP.CACHE_TTL_SECONDS);
  return out;
}
