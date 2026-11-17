/**
 * VppImport.gs — cập nhật DANH MỤC + TỒN KHO văn phòng phẩm từ file Excel (sheet "Danh muc" + "Ton kho", v2.1).
 *
 * Trình duyệt đọc file, chuẩn hóa từng dòng (shared/vppImport.ts) rồi gửi { line, code, name, unit, price, stock, minimumStock,
 * matchProductId? }. Ở đây:
 *   1. So khớp với danh mục hiện có: chọn tay (matchProductId) → theo MÃ → theo TÊN (giữ dấu, bỏ hoa / thường / dấu câu). Không tự
 *      ghép theo tên gần giống — chỉ GỢI Ý để quản trị viên chọn ở bước xem trước (tránh ghép nhầm "Kéo" với "Kẹo").
 *   2. Lập kế hoạch (vppImportPlan_, không ghi): thêm mới / cập nhật mã, tên, ĐVT, đơn giá, tồn tối thiểu / đặt tồn theo cột "Tồn hiện
 *      tại" (kiểm kê) / (tùy chọn) ngừng dùng sản phẩm không có trong file.
 *   3. Áp dụng (apiVppImportApply_, trong khóa, ghi theo lô): sản phẩm mới ghi một lượt; tồn ghi qua sổ biến động (INITIAL cho sản
 *      phẩm mới, ADJUSTMENT cho sản phẩm có sẵn) — không bao giờ âm tồn / thấp hơn số đang giữ chỗ.
 * Hội tụ theo clientRequestId: sản phẩm mới có product_id = uuidFrom_('vpp-import|' + mã + '|' + dòng), biến động kho có operation_id
 * VPP_IMPORT:<mã>:<productId>, lịch sử VPP_IMPORT ghi sau cùng → gửi lại không tạo trùng, không điều chỉnh tồn hai lần.
 */

var IMPORT_CODE_PATTERN_ = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;

function importOperationId_(requestId, productId) {
  return 'VPP_IMPORT:' + requestId + ':' + productId;
}

/** Kiểm tra + chuẩn hóa các dòng gửi lên (Worker đã kiểm tra bằng Zod; đây là lớp kiểm tra thứ hai). */
function validateImportRows_(raw) {
  var rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) throw validationError_({ rows: 'File không có dòng sản phẩm nào' });
  if (rows.length > LIMITS.IMPORT_MAX_ROWS) throw validationError_({ rows: 'Tối đa ' + LIMITS.IMPORT_MAX_ROWS + ' dòng mỗi lần' });
  var errors = {};
  var out = rows.map(function (r, i) {
    r = r && typeof r === 'object' ? r : {};
    var key = 'rows.' + i + '.';
    var code = String(r.code || '').replace(/\s+/g, '').toUpperCase();
    var name = cleanLine_(r.name);
    var unit = cleanLine_(r.unit);
    var price = r.price === null || r.price === undefined || r.price === '' ? null : roundPrice_(Number(r.price));
    var stock = r.stock === null || r.stock === undefined || r.stock === '' ? null : Number(r.stock);
    var minimum = r.minimumStock === null || r.minimumStock === undefined || r.minimumStock === '' ? null : Number(r.minimumStock);
    var match = String(r.matchProductId || '').trim().toLowerCase();
    if (code && !IMPORT_CODE_PATTERN_.test(code)) errors[key + 'code'] = 'Mã không hợp lệ';
    if (!name) errors[key + 'name'] = 'Thiếu tên sản phẩm';
    else if (name.length > LIMITS.PRODUCT_NAME) errors[key + 'name'] = 'Tên tối đa ' + LIMITS.PRODUCT_NAME + ' ký tự';
    if (unit.length > LIMITS.UNIT) errors[key + 'unit'] = 'ĐVT tối đa ' + LIMITS.UNIT + ' ký tự';
    if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors[key + 'price'] = 'Đơn giá không hợp lệ';
    if (stock !== null && (!isFinite(stock) || Math.floor(stock) !== stock || stock < 0 || stock > LIMITS.MAX_QUANTITY)) {
      errors[key + 'stock'] = 'Tồn phải là số nguyên ≥ 0';
    }
    if (minimum !== null && (!isFinite(minimum) || Math.floor(minimum) !== minimum || minimum < 0 || minimum > LIMITS.MAX_QUANTITY)) {
      errors[key + 'minimumStock'] = 'Tồn tối thiểu phải là số nguyên ≥ 0';
    }
    if (match && !isUuid_(match)) errors[key + 'matchProductId'] = 'Sản phẩm chọn ghép không hợp lệ';
    return {
      index: i, line: clampInt_(r.line, 0, 1000000, i + 1), code: code, name: name, unit: unit, price: price, stock: stock,
      minimumStock: minimum, matchProductId: match
    };
  });
  if (Object.keys(errors).length) throw validationError_(errors);
  return out;
}

/**
 * Kế hoạch cập nhật (không ghi). options: { setStock, archiveMissing }; requestId (áp dụng) → ID định trước cho sản phẩm mới.
 * Trả về { creates, updates, stockChanges, archives, kept, skipped, warnings, suggestions, unchanged, summary } + _apply (nội bộ).
 */
function vppImportPlan_(rows, options, requestId, withSuggestions) {
  var products = loadProducts_();
  var byId = {};
  var byCode = {};
  var byName = {};
  products.forEach(function (p) {
    byId[p.productId] = p;
    var code = String(p.productCode || '').toUpperCase();
    if (code && !byCode[code]) byCode[code] = p;
    if (p.catalogStatus !== CATALOG_STATUS.ARCHIVED) {
      var key = accentNameKey_(p.productName);
      (byName[key] = byName[key] || []).push(p);
    }
  });
  var normCount = {};
  var day = todayIsoDate_();
  loadNorms_().forEach(function (n) { if (n.active && isNormEffective_(n, day)) normCount[n.productId] = (normCount[n.productId] || 0) + 1; });
  var stockMap = loadStockMap_();
  // Tồn / giữ chỗ theo SỔ biến động (đúng số mà bước ghi sẽ dùng) — đọc sổ MỘT lần cho mọi sản phẩm.
  var ledgerAll = stockFromLedger_(null);
  var effOf = function (pid) { return stockBaseFromLedger_(stockMap[pid] || { onHand: 0, reserved: 0 }, ledgerAll[pid]); };

  var plan = {
    creates: [], updates: [], stockChanges: [], archives: [], kept: [], skipped: [], warnings: [], suggestions: [], unchanged: 0,
    _apply: { creates: [], updates: [], moves: [], archives: [] }
  };
  var matchedBy = {};    // productId → dòng đã khớp
  var matchedName = {};  // productId → tên trong file của dòng đã khớp
  var usedCodes = {};    // mã đã dùng (sản phẩm có sẵn + dòng mới)
  Object.keys(byCode).forEach(function (c) { usedCodes[c] = byCode[c].productId; });
  var deterministic = function (row) { return requestId ? uuidFrom_('vpp-import|' + requestId + '|' + row.line + '|' + row.name) : ''; };

  rows.forEach(function (row) {
    var product = null;
    var how = '';
    // Lần áp dụng trước (cùng mã thao tác) đã tạo sản phẩm cho dòng này → coi như đã khớp.
    var preset = deterministic(row);
    if (preset && byId[preset]) {
      product = byId[preset];
      how = 'RESUMED';
    } else if (row.matchProductId) {
      product = byId[row.matchProductId] || null;
      if (!product) {
        plan.skipped.push({ line: row.line, name: row.name, reason: 'Sản phẩm chọn để cập nhật không còn tồn tại — xem trước lại' });
        return;
      }
      how = 'MANUAL';
    } else if (row.code && byCode[row.code]) {
      product = byCode[row.code];
      how = 'CODE';
      if (product.catalogStatus === CATALOG_STATUS.ARCHIVED && product.mergedIntoProductId) {
        // Mã thuộc sản phẩm đã ghép vào sản phẩm khác → không hồi sinh; dòng này là sản phẩm mới, cấp mã khác.
        plan.warnings.push({ line: row.line, message: 'Mã ' + row.code + ' thuộc sản phẩm đã ghép (' + product.productName + ') — tạo sản phẩm mới với mã tự cấp' });
        product = null;
        how = '';
        row = Object.assign({}, row, { code: '' });
      }
    }
    if (!product && !how) {
      var same = byName[accentNameKey_(row.name)] || [];
      var candidates = same.filter(function (p) { return !matchedBy[p.productId]; });
      if (candidates.length === 1) {
        product = candidates[0];
        how = 'NAME';
      } else if (candidates.length > 1) {
        plan.warnings.push({ line: row.line, message: 'Có ' + candidates.length + ' sản phẩm cùng tên "' + row.name + '" — chọn sản phẩm cần cập nhật ở cột “Ghép với”' });
      }
    }
    if (product && matchedBy[product.productId]) {
      if (how === 'CODE' && accentNameKey_(row.name) !== accentNameKey_(matchedName[product.productId])) {
        // Cùng mã nhưng KHÁC tên với dòng đã khớp (file dùng một mã cho hai mặt hàng) → mặt hàng mới, cấp mã khác.
        plan.warnings.push({ line: row.line, message: 'Mã ' + row.code + ' đã dùng cho "' + matchedName[product.productId] + '" (dòng ' +
          matchedBy[product.productId] + ') — "' + row.name + '" được thêm mới với mã tự cấp' });
        product = null;
        how = '';
        row = Object.assign({}, row, { code: '' });
      } else {
        plan.skipped.push({ line: row.line, name: row.name, reason: 'Trùng sản phẩm đã khớp ở dòng ' + matchedBy[product.productId] + ' (' + product.productName + ')' });
        return;
      }
    }
    if (product && product.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) {
      plan.skipped.push({ line: row.line, name: row.name, reason: '"' + product.productName + '" đang chờ duyệt trong đề xuất mua — xử lý trong đề xuất trước' });
      return;
    }

    if (!product) {
      // ---------------------------------------------------------------- Thêm mới
      var code = row.code;
      if (code && usedCodes[code]) {
        plan.warnings.push({ line: row.line, message: 'Mã ' + code + ' đã dùng cho sản phẩm khác — sản phẩm này được cấp mã tự động' });
        code = '';
      }
      if (code) usedCodes[code] = 'new:' + row.line;
      var created = {
        line: row.line, productId: preset || '', code: code, name: row.name, unit: row.unit, price: row.price,
        minimumStock: row.minimumStock || 0, stock: options.setStock ? row.stock : null
      };
      plan.creates.push({ line: row.line, code: code, codeAuto: !code, name: row.name, unit: row.unit, price: row.price, stock: created.stock });
      plan._apply.creates.push(created);
      if (created.stock !== null && created.stock > 0) {
        plan.stockChanges.push({ line: row.line, productId: '', productCode: code, productName: row.name, unit: row.unit, before: null, after: created.stock, isNew: true });
      }
      return;
    }

    // ---------------------------------------------------------------- Cập nhật sản phẩm có sẵn
    matchedBy[product.productId] = row.line;
    matchedName[product.productId] = row.name;
    var eff = effOf(product.productId);
    var hasStock = (eff.onHand !== null && eff.onHand > 0) || eff.reserved > 0;
    var changes = [];
    var fields = {};
    if (row.code && row.code !== String(product.productCode || '').toUpperCase()) {
      if (usedCodes[row.code] && usedCodes[row.code] !== product.productId) {
        plan.warnings.push({ line: row.line, message: 'Mã ' + row.code + ' đã dùng cho sản phẩm khác — giữ mã cũ ' + product.productCode });
      } else {
        changes.push({ field: 'productCode', label: 'Mã', before: product.productCode, after: row.code });
        fields.product_code = row.code;
        delete usedCodes[String(product.productCode || '').toUpperCase()];
        usedCodes[row.code] = product.productId;
      }
    }
    if (row.name !== product.productName) {
      changes.push({ field: 'productName', label: 'Tên', before: product.productName, after: row.name });
      fields.product_name = row.name;
      fields.normalized_name = matchKey_(row.name);
    }
    if (row.unit && row.unit !== product.unit) {
      if (product.unit && !sameUnit_(row.unit, product.unit) && (hasStock || normCount[product.productId])) {
        plan.warnings.push({ line: row.line, message: '"' + product.productName + '": ĐVT trong file "' + row.unit + '" khác ĐVT hệ thống "' + product.unit +
          '" — giữ ĐVT cũ vì đang có tồn / định mức (đổi ĐVT phải quy đổi số lượng)' });
      } else {
        changes.push({ field: 'unit', label: 'ĐVT', before: product.unit, after: row.unit });
        fields.unit = row.unit;
      }
    }
    if (row.price !== null && row.price !== product.referencePrice) {
      changes.push({ field: 'referencePrice', label: 'Đơn giá', before: product.referencePrice, after: row.price });
      fields.reference_price = row.price;
    }
    if (row.minimumStock !== null && row.minimumStock !== product.minimumStock) {
      changes.push({ field: 'minimumStock', label: 'Tồn tối thiểu', before: product.minimumStock, after: row.minimumStock });
      fields.minimum_stock = row.minimumStock;
    }
    if (product.catalogStatus !== CATALOG_STATUS.MASTER || !product.active) {
      changes.push({ field: 'catalogStatus', label: 'Danh mục', before: product.catalogStatus + (product.active ? '' : ' (tắt)'), after: CATALOG_STATUS.MASTER });
      fields.catalog_status = CATALOG_STATUS.MASTER;
      fields.active = 'TRUE';
      if (product.reviewStatus === REVIEW_STATUS.PENDING) fields.review_status = REVIEW_STATUS.RESOLVED;
    }
    if (changes.length) {
      plan.updates.push({
        line: row.line, productId: product.productId, productCode: product.productCode, productName: product.productName,
        matchedBy: how, changes: changes
      });
      plan._apply.updates.push({ productId: product.productId, fields: fields });
    }
    var stockChanged = false;
    if (options.setStock && row.stock !== null) {
      var current = eff.onHand;
      if (row.stock < eff.reserved) {
        plan.warnings.push({ line: row.line, message: '"' + product.productName + '": tồn trong file (' + row.stock + ') nhỏ hơn số đang giữ chỗ cho phiếu ' +
          'bàn giao chờ ký (' + eff.reserved + ') — không đổi tồn sản phẩm này' });
      } else if (current !== row.stock) {
        stockChanged = true;
        plan.stockChanges.push({
          line: row.line, productId: product.productId, productCode: fields.product_code || product.productCode, productName: product.productName,
          unit: fields.unit || product.unit, before: current, after: row.stock, isNew: false
        });
        plan._apply.moves.push({ productId: product.productId, setTo: row.stock, before: current });
      }
    }
    if (!changes.length && !stockChanged) plan.unchanged++;
  });

  // ---------------------------------------------------------------- Gợi ý ghép cho dòng thêm mới
  if (withSuggestions && plan.creates.length) {
    var pool = products.filter(function (p) {
      return !matchedBy[p.productId] && p.catalogStatus !== CATALOG_STATUS.ARCHIVED && p.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL;
    }).map(function (p) {
      return { p: p, tone: toneTokens_(p.productName), loose: nameTokens_(p.productName), onHand: effOf(p.productId).onHand };
    });
    if (pool.length) {
      plan.creates.forEach(function (c) {
        var tone = toneTokens_(c.name);
        var loose = nameTokens_(c.name);
        var candidates = pool.map(function (x) {
          var score = Math.max(tokenSimilarity_(tone, x.tone), Math.round(tokenSimilarity_(loose, x.loose) * 0.6));
          return { x: x, score: score };
        }).filter(function (s) { return s.score >= 60; })
          .sort(function (a, b) { return b.score - a.score || compareVi_(a.x.p.productName, b.x.p.productName); })
          .slice(0, 3)
          .map(function (s) {
            return {
              productId: s.x.p.productId, productCode: s.x.p.productCode, productName: s.x.p.productName, unit: s.x.p.unit, score: s.score,
              onHand: s.x.onHand, normCount: normCount[s.x.p.productId] || 0
            };
          });
        if (candidates.length) plan.suggestions.push({ line: c.line, name: c.name, candidates: candidates });
      });
    }
  }

  // ---------------------------------------------------------------- Sản phẩm không có trong file
  products.forEach(function (p) {
    if (matchedBy[p.productId] || p.catalogStatus === CATALOG_STATUS.ARCHIVED || p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) return;
    if (plan._apply.creates.some(function (c) { return c.productId === p.productId; })) return;
    var e = effOf(p.productId);
    var reason = '';
    if (e.reserved > 0) reason = 'đang giữ chỗ ' + e.reserved + ' cho phiếu chờ ký';
    else if (e.onHand !== null && e.onHand > 0) reason = 'còn tồn ' + e.onHand + (p.unit ? ' ' + p.unit : '');
    else if (normCount[p.productId]) reason = 'đang có ' + normCount[p.productId] + ' định mức — ghép vào sản phẩm mới ở “Dữ liệu cần kiểm tra” để chuyển định mức';
    var item = { productId: p.productId, productCode: p.productCode, productName: p.productName, unit: p.unit };
    if (!options.archiveMissing) {
      plan.kept.push(Object.assign({ reason: reason || 'không có trong file' }, item));
    } else if (reason) {
      plan.kept.push(Object.assign({ reason: reason }, item));
    } else {
      plan.archives.push(item);
      plan._apply.archives.push(p.productId);
    }
  });

  plan.summary = {
    rows: rows.length,
    create: plan.creates.length,
    update: plan.updates.length,
    unchanged: plan.unchanged,
    stockChanges: plan.stockChanges.length,
    archive: plan.archives.length,
    kept: plan.kept.length,
    skipped: plan.skipped.length,
    warnings: plan.warnings.length
  };
  return plan;
}

function importOptions_(data) {
  var o = data.options && typeof data.options === 'object' ? data.options : {};
  return { setStock: o.setStock !== false, archiveMissing: o.archiveMissing === true };
}

function publicPlan_(plan) {
  var out = Object.assign({}, plan);
  delete out._apply;
  return out;
}

/** Admin: xem trước (không ghi). */
function apiVppImportPlan_(data) {
  var rows = validateImportRows_(data.rows);
  healDirtyStockIfNeeded_();
  return { plan: publicPlan_(vppImportPlan_(rows, importOptions_(data), '', true)) };
}

/** Lô mã tự cấp VPP-0001… cho sản phẩm mới (trong khóa): đọc số lớn nhất MỘT lần, tăng trong bộ nhớ. */
function productCodeAllocator_() {
  requireLock_('productCodeAllocator_');
  var prefix = APP.VPP_PRODUCT_CODE_PREFIX;
  var seq = Math.max(parseInt(getProp_(PROP.PRODUCT_SEQ), 10) || 0, maxSequenceForPrefix_(SHEETS.VPP_PRODUCTS, 'product_code', prefix));
  var taken = {};
  readColumn_(getSheet_(SHEETS.VPP_PRODUCTS), 'product_code').forEach(function (c) { if (c) taken[String(c).toUpperCase()] = true; });
  return {
    next: function () {
      var code;
      do {
        seq++;
        code = prefix + pad_(seq, 4);
      } while (taken[code]);
      taken[code] = true;
      return code;
    },
    finish: function () { setProp_(PROP.PRODUCT_SEQ, String(seq)); }
  };
}

/** Admin: áp dụng (trong khóa). */
function apiVppImportApply_(data) {
  var actor = sanitizeActor_(data.actor);
  var rows = validateImportRows_(data.rows);
  var options = importOptions_(data);
  var fileName = truncate_(cleanLine_(data.fileName), 120);
  var requestId = optionalRequestId_(data.clientRequestId);
  if (!requestId) throw appError_('BAD_REQUEST', 'Thiếu mã thao tác (clientRequestId).');

  return withScriptLock_(function () {
    // Đã áp dụng xong ở lần gửi trước (mất phản hồi) → trả kết quả đã ghi, không làm lại.
    var done = findRows_(SHEETS.HISTORY, 'handover_id', requestId).filter(function (m) { return m.record.action === 'VPP_IMPORT'; })[0];
    if (done) {
      var meta = {};
      try { meta = JSON.parse(done.record.metadata || '{}'); } catch (e) { meta = {}; }
      return { result: meta.result || null, duplicate: true };
    }
    healDirtyStock_();
    var plan = vppImportPlan_(rows, options, requestId, false);
    var now = nowIso_();
    var source = 'Cập nhật từ Excel' + (fileName ? ' "' + fileName + '"' : '');

    // 1. Sản phẩm mới — một lượt ghi.
    var newIds = [];
    if (plan._apply.creates.length) {
      var codes = productCodeAllocator_();
      var productRows = plan._apply.creates.map(function (c) {
        var id = c.productId || uuidFrom_('vpp-import|' + requestId + '|' + c.line + '|' + c.name);
        c.productId = id;
        newIds.push(id);
        return {
          product_id: id,
          product_code: c.code || codes.next(),
          product_name: c.name,
          normalized_name: matchKey_(c.name),
          category: '',
          unit: c.unit || '',
          reference_price: c.price === null ? '' : c.price,
          minimum_stock: c.minimumStock || 0,
          catalog_status: CATALOG_STATUS.MASTER,
          active: 'TRUE',
          source: 'EXCEL',
          created_at: now,
          updated_at: now,
          review_status: '',
          merged_into_product_id: '',
          note: source
        };
      });
      appendObjects_(SHEETS.VPP_PRODUCTS, productRows);
      codes.finish();
      ensureStockRows_(newIds, actor, now);
    }

    // 2. Cập nhật sản phẩm có sẵn (chỉ ô thay đổi).
    var stockRows = plan._apply.updates.some(function (u) { return u.fields.minimum_stock !== undefined; }) ? loadStockMap_() : {};
    plan._apply.updates.forEach(function (u) {
      var found = findProductRow_(u.productId);
      if (!found) return;
      updateRowFields_(SHEETS.VPP_PRODUCTS, found.rowIndex, found.record, Object.assign({ updated_at: now }, u.fields));
      var s = stockRows[u.productId];
      if (u.fields.minimum_stock !== undefined && s) {
        updateRowFields_(SHEETS.VPP_STOCK, s._row, s._record, { minimum_stock: u.fields.minimum_stock, updated_at: now, updated_by: actorLabel_(actor) });
      }
    });

    // 3. Tồn kho qua sổ biến động (bỏ qua dòng đã ghi ở lần gửi trước).
    var moves = [];
    plan._apply.creates.forEach(function (c) {
      if (c.stock === null || !(c.stock > 0)) return;
      var op = importOperationId_(requestId, c.productId);
      if (operationExists_(op)) return;
      moves.push({ productId: c.productId, type: MOVEMENT_TYPES.INITIAL, quantity: c.stock, operationId: op, reason: 'Tồn đầu kỳ · ' + source });
    });
    plan._apply.moves.forEach(function (m) {
      var op = importOperationId_(requestId, m.productId);
      if (operationExists_(op)) return;
      moves.push({
        productId: m.productId, type: MOVEMENT_TYPES.ADJUSTMENT, setTo: m.setTo, quantity: 0, operationId: op, resolveReview: true,
        reason: function (systemQty) { return 'Kiểm kê: hệ thống ' + (systemQty === null ? 'chưa rõ' : systemQty) + ' → thực tế ' + m.setTo + ' · ' + source; }
      });
    });
    if (moves.length) applyStockMovements_(moves, actor, now);

    // 4. Ngừng dùng sản phẩm không có trong file (tùy chọn; chỉ sản phẩm không còn tồn / giữ chỗ / định mức).
    plan._apply.archives.forEach(function (pid) {
      var found = findProductRow_(pid);
      if (found) updateRowFields_(SHEETS.VPP_PRODUCTS, found.rowIndex, found.record, { catalog_status: CATALOG_STATUS.ARCHIVED, updated_at: now });
    });

    var result = Object.assign({}, plan.summary, { fileName: fileName, at: now });
    // 5. Lịch sử — ghi SAU CÙNG: có dòng này = lần áp dụng đã hoàn tất (lần gửi lại trả kết quả, không làm lại).
    appendHistory_(requestId, 'VPP_IMPORT', actorLabel_(actor), '', '',
      source + ': thêm ' + result.create + ', cập nhật ' + result.update + ', đổi tồn ' + result.stockChanges + ', ngừng dùng ' + result.archive +
        ' sản phẩm', {
        result: result,
        created: plan.creates.slice(0, 300).map(function (c) { return c.code ? c.code + ' ' + c.name : c.name; }),
        updated: plan.updates.slice(0, 300).map(function (u) { return u.productCode + ' ' + u.productName; }),
        archived: plan.archives.map(function (a) { return a.productCode + ' ' + a.productName; })
      }, 'VPP_IMPORT');
    invalidateCaches_();
    return { result: result, duplicate: false };
  });
}
