/**
 * VppVouchers.gs — phiếu NHẬP KHO / XUẤT KHO văn phòng phẩm nhiều mặt hàng (v2.1).
 *
 *   • Phiếu nhập (NK-YYYYMMDD-NNNN): mua mới, bổ sung, chuyển kho, tồn đầu kỳ — số lượng, đơn giá, nhà cung cấp, số hóa đơn.
 *   • Phiếu xuất (XK-YYYYMMDD-NNNN): xuất trực tiếp cho phòng ban / người nhận (không qua phiếu bàn giao ký nhận) — chỉ xuất được
 *     phần KHẢ DỤNG (tồn − đang giữ chỗ cho phiếu bàn giao chờ ký), không bao giờ âm tồn.
 * Mỗi dòng hàng = một dòng VPP_BIEN_DONG_KHO (IN / INITIAL / ISSUE) có voucher_id; phiếu = một dòng VPP_PHIEU_KHO.
 *
 * Hội tụ theo clientRequestId (mất phản hồi, bấm lại): voucher_id = uuidFrom_('vpp-voucher|' + mã thao tác), operation_id mỗi dòng
 * VPP_VOUCHER:<mã thao tác>:<productId>. Ghi SỔ (biến động) trước, dòng PHIẾU sau — lỗi giữa chừng → gửi lại bổ sung phần còn thiếu,
 * không ghi kho hai lần. Gửi lại cùng mã với nội dung KHÁC → REQUEST_REUSED (không ghi).
 */

var VOUCHER_TYPES_ = { IN: 'IN', OUT: 'OUT' };

function voucherOperationId_(requestId, productId) {
  return 'VPP_VOUCHER:' + requestId + ':' + productId;
}

/** Dòng hàng của phiếu (kiểm tra + gộp): [{ productId, quantity, unitPrice, note }] — mặt hàng trùng → lỗi (gộp số lượng ở form). */
function validateVoucherLines_(raw, withPrice, errors) {
  var lines = Array.isArray(raw) ? raw : [];
  if (!lines.length) errors.lines = 'Chọn ít nhất 1 mặt hàng';
  if (lines.length > LIMITS.VOUCHER_MAX_LINES) errors.lines = 'Tối đa ' + LIMITS.VOUCHER_MAX_LINES + ' mặt hàng mỗi phiếu';
  var seen = {};
  return lines.slice(0, LIMITS.VOUCHER_MAX_LINES).map(function (l, i) {
    l = l && typeof l === 'object' ? l : {};
    var prefix = 'lines.' + i + '.';
    var productId = String(l.productId || '').trim().toLowerCase();
    var qty = Number(l.quantity);
    var price = withPrice && l.unitPrice !== null && l.unitPrice !== undefined && l.unitPrice !== '' ? roundPrice_(Number(l.unitPrice)) : null;
    var note = cleanText_(l.note);
    if (!isUuid_(productId)) errors[prefix + 'productId'] = 'Chọn mặt hàng';
    else if (seen[productId]) errors[prefix + 'productId'] = 'Mặt hàng bị trùng — gộp số lượng vào một dòng';
    seen[productId] = true;
    if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) {
      errors[prefix + 'quantity'] = 'Số lượng phải là số nguyên từ 1 đến ' + LIMITS.MAX_QUANTITY;
    }
    if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) errors[prefix + 'unitPrice'] = 'Đơn giá không hợp lệ';
    if (note.length > LIMITS.STOCK_REASON) errors[prefix + 'note'] = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
    else if (containsPasswordLike_(note)) errors[prefix + 'note'] = PASSWORD_MESSAGE_;
    return { index: i, productId: productId, quantity: qty, unitPrice: price, note: note };
  });
}

function voucherText_(value, key, errors, max) {
  var s = cleanLine_(value);
  if (s.length > (max || LIMITS.VOUCHER_TEXT)) errors[key] = 'Tối đa ' + (max || LIMITS.VOUCHER_TEXT) + ' ký tự';
  return s;
}

function voucherFromRow_(r) {
  return {
    voucherId: String(r.voucher_id || '').toLowerCase(),
    voucherCode: r.voucher_code || '',
    voucherType: r.voucher_type === VOUCHER_TYPES_.OUT ? VOUCHER_TYPES_.OUT : VOUCHER_TYPES_.IN,
    voucherDate: String(r.voucher_date || '').slice(0, 10),
    reasonType: r.reason_type || '',
    department: r.department || '',
    receiverEmployeeId: r.receiver_employee_id || '',
    receiverName: r.receiver_name || '',
    supplier: r.supplier || '',
    invoiceNo: r.invoice_no || '',
    note: r.note || '',
    lineCount: toIntOrNull_(r.line_count) || 0,
    totalQuantity: toIntOrNull_(r.total_quantity) || 0,
    totalAmount: toNumberOrNull_(r.total_amount),
    actorId: r.actor_id || '',
    actorName: r.actor_name || '',
    createdAt: r.created_at || ''
  };
}

/** Dòng hàng của một phiếu (theo sổ biến động). */
function voucherLines_(voucherId, products) {
  products = products || loadProductMap_();
  return findRows_(SHEETS.VPP_MOVEMENTS, 'voucher_id', voucherId).map(function (m) {
    var r = m.record;
    var pid = String(r.product_id || '').toLowerCase();
    var p = products[pid];
    var qty = Math.abs(toIntOrNull_(r.quantity) || 0);
    var price = toNumberOrNull_(r.unit_price);
    return {
      productId: pid,
      productCode: p ? p.productCode : '',
      productName: p ? p.productName : '(không rõ)',
      unit: p ? p.unit : '',
      movementType: r.movement_type,
      quantity: qty,
      unitPrice: price,
      amount: price === null ? null : roundPrice_(price * qty),
      onHandBefore: toIntOrNull_(r.on_hand_before),
      onHandAfter: toIntOrNull_(r.on_hand_after),
      reason: r.reason || ''
    };
  });
}

function voucherView_(rec, products) {
  var v = voucherFromRow_(rec);
  v.lines = voucherLines_(v.voucherId, products);
  return v;
}

/** Gửi lại cùng mã thao tác: phiếu đã ghi khớp đúng nội dung? (so loại, mặt hàng, số lượng). */
function sameVoucher_(prev, type, lines) {
  if (prev.voucherType !== type || prev.lines.length !== lines.length) return false;
  var byId = {};
  prev.lines.forEach(function (l) { byId[l.productId] = l.quantity; });
  return lines.every(function (l) { return byId[l.productId] === l.quantity; });
}

function reusedVoucherError_(prev) {
  return appError_('REQUEST_REUSED', 'Lần lưu trước (mất kết nối trước khi nhận được phản hồi) ĐÃ ghi phiếu ' + prev.voucherCode + ' lúc ' +
    formatDisplayDateTime_(prev.createdAt) + ' với nội dung khác. Nội dung vừa nhập CHƯA được ghi — tải lại trang để xem tồn hiện tại.',
    { existing: { voucherId: prev.voucherId, code: prev.voucherCode } });
}

/**
 * Ghi phiếu (trong khóa): sổ biến động trước (bỏ qua dòng đã ghi ở lần gửi trước), dòng phiếu sau. moves: phần tử applyStockMovements_.
 */
function writeVoucher_(voucherId, requestId, type, header, lines, moves, actor) {
  requireLock_('writeVoucher_');
  var now = nowIso_();
  var pending = moves.filter(function (m) { return !operationExists_(m.operationId); });
  if (pending.length) applyStockMovements_(pending, actor, now);
  var totalQty = lines.reduce(function (s, l) { return s + l.quantity; }, 0);
  var priced = lines.filter(function (l) { return l.unitPrice !== null; });
  var code = type === VOUCHER_TYPES_.OUT
    ? nextDailyCode_(APP.VPP_ISSUE_CODE_PREFIX, PROP.VPP_ISSUE_SEQ, SHEETS.VPP_VOUCHERS, 'voucher_code')
    : nextDailyCode_(APP.VPP_RECEIPT_CODE_PREFIX, PROP.VPP_RECEIPT_SEQ, SHEETS.VPP_VOUCHERS, 'voucher_code');
  appendObjects_(SHEETS.VPP_VOUCHERS, [{
    voucher_id: voucherId,
    voucher_code: code,
    voucher_type: type,
    voucher_date: header.date,
    reason_type: header.reasonType || '',
    department: header.department || '',
    receiver_employee_id: header.receiverEmployeeId || '',
    receiver_name: header.receiverName || '',
    supplier: header.supplier || '',
    invoice_no: header.invoiceNo || '',
    note: header.note || '',
    line_count: lines.length,
    total_quantity: totalQty,
    total_amount: priced.length ? roundPrice_(priced.reduce(function (s, l) { return s + l.unitPrice * l.quantity; }, 0)) : '',
    actor_id: actor.id,
    actor_name: actor.name,
    client_request_id: requestId,
    created_at: now
  }]);
  return code;
}

/** Kiểm tra mặt hàng dùng được + đủ khả dụng (xuất) / tồn đã rõ (nhập không phải tồn đầu kỳ) — báo MỌI dòng lỗi một lần. */
function precheckVoucherLines_(lines, type, initial, products) {
  var errors = {};
  var ids = lines.map(function (l) { return l.productId; });
  ensureStockRows_(ids, { id: 'system', name: 'Hệ thống' }, nowIso_());
  var stock = allocationStockMap_(ids);
  var shortages = [];
  lines.forEach(function (l) {
    var p = products[l.productId];
    var key = 'lines.' + l.index + '.';
    if (!p) {
      errors[key + 'productId'] = 'Không tìm thấy sản phẩm';
      return;
    }
    if (!isUsableProduct_(p)) {
      errors[key + 'productId'] = '"' + p.productName + '" đã ngừng sử dụng hoặc đang chờ duyệt';
      return;
    }
    var s = stock[l.productId];
    if (s && s.invalid) {
      errors[key + 'productId'] = 'Sổ kho của "' + p.productName + '" đang lệch — hãy kiểm kê trước';
      return;
    }
    if (type === VOUCHER_TYPES_.OUT) {
      var available = !s || s.onHand === null ? null : s.onHand - s.reserved;
      if (available === null) {
        errors[key + 'quantity'] = 'Tồn của "' + p.productName + '" chưa rõ — hãy kiểm kê trước khi xuất';
        shortages.push({ productId: l.productId, productName: p.productName, available: 0, requested: l.quantity, shortage: l.quantity });
      } else if (available < l.quantity) {
        errors[key + 'quantity'] = 'Chỉ còn ' + Math.max(0, available) + (p.unit ? ' ' + p.unit : '') + ' khả dụng';
        shortages.push({
          productId: l.productId, productName: p.productName, available: Math.max(0, available), requested: l.quantity,
          shortage: l.quantity - Math.max(0, available)
        });
      }
    } else if (!initial && (!s || s.onHand === null)) {
      errors[key + 'productId'] = 'Tồn của "' + p.productName + '" chưa rõ — chọn lý do "Tồn đầu kỳ" hoặc kiểm kê trước';
    }
  });
  if (shortages.length) {
    throw appError_('INSUFFICIENT_STOCK', 'Không đủ hàng khả dụng để xuất: ' + shortages.map(function (x) {
      return x.productName + ' (còn ' + x.available + ', cần ' + x.requested + ')';
    }).join('; ') + '.', { shortages: shortages, fieldErrors: errors });
  }
  if (Object.keys(errors).length) throw validationError_(errors);
}

// ============================================================================
// Admin — phiếu nhập kho
// ============================================================================

function apiVppStockReceipt_(data) {
  var actor = sanitizeActor_(data.actor);
  var errors = {};
  var reasonType = String(data.reasonType || '').toUpperCase();
  if (!STOCK_IN_REASONS[reasonType]) errors.reasonType = 'Chọn lý do nhập kho';
  var date = String(data.date || '').trim() || todayIsoDate_();
  if (!isValidDateOnly_(date)) errors.date = 'Ngày không hợp lệ';
  var supplier = voucherText_(data.supplier, 'supplier', errors);
  var invoiceNo = voucherText_(data.invoiceNo, 'invoiceNo', errors, 60);
  var note = cleanText_(data.note);
  if (note.length > LIMITS.VOUCHER_NOTE) errors.note = 'Tối đa ' + LIMITS.VOUCHER_NOTE + ' ký tự';
  else if (containsPasswordLike_(note)) errors.note = PASSWORD_MESSAGE_;
  if (reasonType === 'KHAC' && !note) errors.note = 'Nhập ghi chú cho lý do "Khác"';
  var lines = validateVoucherLines_(data.lines, true, errors);
  var updatePrice = data.updatePrice === true;
  if (Object.keys(errors).length) throw validationError_(errors);
  var requestId = optionalRequestId_(data.clientRequestId);
  if (!requestId) throw appError_('BAD_REQUEST', 'Thiếu mã thao tác (clientRequestId).');
  var voucherId = uuidFrom_('vpp-voucher|' + requestId);
  var initial = reasonType === 'TON_DAU_KY';

  return withScriptLock_(function () {
    var existing = findRow_(SHEETS.VPP_VOUCHERS, 'voucher_id', voucherId);
    var products = loadProductMap_();
    if (existing) {
      var prev = voucherView_(existing.record, products);
      if (!sameVoucher_(prev, VOUCHER_TYPES_.IN, lines)) throw reusedVoucherError_(prev);
      return { voucher: prev, duplicate: true };
    }
    var resumed = lines.some(function (l) { return operationExists_(voucherOperationId_(requestId, l.productId)); });
    if (!resumed) precheckVoucherLines_(lines, VOUCHER_TYPES_.IN, initial, products);
    var type = initial ? MOVEMENT_TYPES.INITIAL : MOVEMENT_TYPES.IN;
    var label = STOCK_IN_REASONS[reasonType];
    var moves = lines.map(function (l) {
      return {
        productId: l.productId, type: type, quantity: l.quantity, operationId: voucherOperationId_(requestId, l.productId),
        voucherId: voucherId, unitPrice: l.unitPrice,
        reason: truncate_(label + ' · phiếu nhập ngày ' + formatDisplayDate_(date) + (supplier ? ' · NCC ' + supplier : '') +
          (invoiceNo ? ' · HĐ ' + invoiceNo : '') + (l.note ? ' · ' + l.note : '') + (note ? ' · ' + note : ''), 1000)
      };
    });
    var code = writeVoucher_(voucherId, requestId, VOUCHER_TYPES_.IN, {
      date: date, reasonType: reasonType, supplier: supplier, invoiceNo: invoiceNo, note: note
    }, lines, moves, actor);
    // Cập nhật đơn giá tham khảo theo giá nhập (tùy chọn).
    if (updatePrice) {
      lines.forEach(function (l) {
        var p = products[l.productId];
        if (l.unitPrice === null || !p || p.referencePrice === l.unitPrice) return;
        var found = findProductRow_(l.productId);
        if (found) updateRowFields_(SHEETS.VPP_PRODUCTS, found.rowIndex, found.record, { reference_price: l.unitPrice, updated_at: nowIso_() });
      });
    }
    afterCommit_('vpp_receipt_history', code, function () {
      appendHistory_(voucherId, 'VPP_RECEIPT_CREATED', actorLabel_(actor), '', '', 'Phiếu nhập kho ' + code + ': ' + lines.length +
        ' mặt hàng' + (supplier ? ' · ' + supplier : ''), { lines: lines.length }, 'VPP_VOUCHER');
    });
    invalidateCaches_();
    return { voucher: voucherView_(findRow_(SHEETS.VPP_VOUCHERS, 'voucher_id', voucherId).record, loadProductMap_()), duplicate: false };
  });
}

// ============================================================================
// Admin — phiếu xuất kho (xuất trực tiếp)
// ============================================================================

function apiVppStockIssue_(data) {
  var actor = sanitizeActor_(data.actor);
  var errors = {};
  var date = String(data.date || '').trim() || todayIsoDate_();
  if (!isValidDateOnly_(date)) errors.date = 'Ngày không hợp lệ';
  var department = voucherText_(data.department, 'department', errors);
  var receiverId = cleanLine_(data.receiverEmployeeId);
  var receiverName = voucherText_(data.receiverName, 'receiverName', errors, LIMITS.PERSON_NAME);
  var note = cleanText_(data.note);
  if (note.length > LIMITS.VOUCHER_NOTE) errors.note = 'Tối đa ' + LIMITS.VOUCHER_NOTE + ' ký tự';
  else if (containsPasswordLike_(note)) errors.note = PASSWORD_MESSAGE_;
  var lines = validateVoucherLines_(data.lines, false, errors);
  var receiver = null;
  if (receiverId) {
    receiver = findEmployeeById_(receiverId);
    if (!receiver) errors.receiverEmployeeId = 'Không tìm thấy nhân viên ' + receiverId;
  }
  if (receiver) {
    receiverName = receiver.fullName;
    if (!department) department = receiver.department || '';
  }
  if (!department && !receiverName) errors.department = 'Chọn phòng ban hoặc người nhận';
  if (Object.keys(errors).length) throw validationError_(errors);
  var requestId = optionalRequestId_(data.clientRequestId);
  if (!requestId) throw appError_('BAD_REQUEST', 'Thiếu mã thao tác (clientRequestId).');
  var voucherId = uuidFrom_('vpp-voucher|' + requestId);

  return withScriptLock_(function () {
    var existing = findRow_(SHEETS.VPP_VOUCHERS, 'voucher_id', voucherId);
    var products = loadProductMap_();
    if (existing) {
      var prev = voucherView_(existing.record, products);
      if (!sameVoucher_(prev, VOUCHER_TYPES_.OUT, lines)) throw reusedVoucherError_(prev);
      return { voucher: prev, duplicate: true };
    }
    var resumed = lines.some(function (l) { return operationExists_(voucherOperationId_(requestId, l.productId)); });
    if (!resumed) precheckVoucherLines_(lines, VOUCHER_TYPES_.OUT, false, products);
    var who = [department, receiverName].filter(function (x) { return x; }).join(' · ');
    var moves = lines.map(function (l) {
      return {
        productId: l.productId, type: MOVEMENT_TYPES.ISSUE, quantity: l.quantity, operationId: voucherOperationId_(requestId, l.productId),
        voucherId: voucherId, department: department,
        reason: truncate_('Xuất kho ngày ' + formatDisplayDate_(date) + (who ? ' · ' + who : '') + (l.note ? ' · ' + l.note : '') +
          (note ? ' · ' + note : ''), 1000)
      };
    });
    var code = writeVoucher_(voucherId, requestId, VOUCHER_TYPES_.OUT, {
      date: date, department: department, receiverEmployeeId: receiver ? receiver.employeeId : '', receiverName: receiverName, note: note
    }, lines, moves, actor);
    afterCommit_('vpp_issue_history', code, function () {
      appendHistory_(voucherId, 'VPP_ISSUE_CREATED', actorLabel_(actor), '', '', 'Phiếu xuất kho ' + code + ': ' + lines.length +
        ' mặt hàng' + (who ? ' → ' + who : ''), { lines: lines.length }, 'VPP_VOUCHER');
    });
    invalidateCaches_();
    var view = voucherView_(findRow_(SHEETS.VPP_VOUCHERS, 'voucher_id', voucherId).record, loadProductMap_());
    var after = loadStockMap_();
    return { voucher: view, duplicate: false, warnings: stockWarnings_(lines.map(function (l) { return l.productId; }).reduce(function (o, pid) {
      var s = after[pid];
      if (s) o[pid] = { onHand: s.onHand, reserved: s.reserved, available: s.onHand === null ? null : s.onHand - s.reserved, minimumStock: s.minimumStock || 0 };
      return o;
    }, {}), products) };
  });
}

// ============================================================================
// Admin — danh sách / chi tiết phiếu, tổng xuất theo phòng ban
// ============================================================================

function apiVppListVouchers_(q) {
  q = q || {};
  var exportAll = q.exportAll === true;
  var page = exportAll ? 1 : clampInt_(q.page, 1, 100000, 1);
  var pageSize = exportAll ? APP.EXPORT_MAX_ROWS : clampInt_(q.pageSize, 10, 200, 50);
  var type = q.type === VOUCHER_TYPES_.OUT || q.type === VOUCHER_TYPES_.IN ? q.type : '';
  var from = isValidDateOnly_(q.from) ? q.from : '';
  var to = isValidDateOnly_(q.to) ? q.to : '';
  var department = cleanLine_(q.department);
  var deptKey = department ? normalizeText_(department) : '';
  var needle = normalizeText_(q.q);
  var vouchers = readTable_(SHEETS.VPP_VOUCHERS).rows.filter(function (r) { return isUuid_(r.voucher_id); }).map(voucherFromRow_);
  var filtered = vouchers.filter(function (v) {
    if (type && v.voucherType !== type) return false;
    if (from && v.voucherDate < from) return false;
    if (to && v.voucherDate > to) return false;
    if (deptKey && normalizeText_(v.department) !== deptKey) return false;
    if (needle && normalizeText_([v.voucherCode, v.department, v.receiverName, v.supplier, v.invoiceNo, v.note, v.actorName].join(' '))
      .indexOf(needle) < 0) return false;
    return true;
  });
  filtered.sort(function (a, b) {
    if (a.voucherDate !== b.voucherDate) return a.voucherDate < b.voucherDate ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });

  // Tổng XUẤT theo phòng ban × mặt hàng (như sheet "Xuat VPP" của file Excel cũ) — theo đúng bộ lọc, mọi trang.
  var outIds = {};
  filtered.forEach(function (v) { if (v.voucherType === VOUCHER_TYPES_.OUT) outIds[v.voucherId] = v; });
  var summary = { departments: [], rows: [], totals: {}, total: 0 };
  if (Object.keys(outIds).length) {
    var products = loadProductMap_();
    var byProduct = {};
    var depts = {};
    readColumns_(SHEETS.VPP_MOVEMENTS, ['voucher_id', 'product_id', 'movement_type', 'quantity', 'department']).forEach(function (m) {
      var v = outIds[String(m.voucher_id || '').toLowerCase()];
      if (!v || m.movement_type !== MOVEMENT_TYPES.ISSUE) return;
      var pid = String(m.product_id || '').toLowerCase();
      var dept = cleanLine_(m.department) || v.department || '(không ghi phòng ban)';
      var qty = Math.abs(toIntOrNull_(m.quantity) || 0);
      var p = products[pid];
      var row = byProduct[pid] || (byProduct[pid] = {
        productId: pid, productCode: p ? p.productCode : '', productName: p ? p.productName : '(không rõ)', unit: p ? p.unit : '',
        byDepartment: {}, total: 0
      });
      row.byDepartment[dept] = (row.byDepartment[dept] || 0) + qty;
      row.total += qty;
      depts[dept] = (depts[dept] || 0) + qty;
      summary.total += qty;
    });
    summary.departments = Object.keys(depts).sort(compareVi_);
    summary.totals = depts;
    summary.rows = Object.keys(byProduct).map(function (k) { return byProduct[k]; })
      .sort(function (a, b) { return b.total - a.total || compareVi_(a.productName, b.productName); });
  }

  var start = (page - 1) * pageSize;
  var departments = {};
  vouchers.forEach(function (v) { if (v.department) departments[v.department] = true; });
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page: page,
    pageSize: pageSize,
    issueSummary: summary,
    // Phòng ban đã từng xuất (gợi ý ô lọc / ô phòng ban của phiếu xuất), cộng phòng ban của nhân viên.
    departments: Object.keys(departments).concat(getEmployees_().map(function (e) { return e.department; }))
      .filter(function (d, i, arr) { return d && arr.indexOf(d) === i; }).sort(compareVi_)
  };
}

function apiVppGetVoucher_(data) {
  var id = String(data.id || '').toLowerCase();
  if (!isUuid_(id)) throw appError_('NOT_FOUND', 'Không tìm thấy phiếu.');
  var found = findRow_(SHEETS.VPP_VOUCHERS, 'voucher_id', id);
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy phiếu.');
  return { voucher: voucherView_(found.record) };
}
