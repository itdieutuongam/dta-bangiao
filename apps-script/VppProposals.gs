/**
 * VppProposals.gs — đề xuất mua văn phòng phẩm.
 *
 *   Nhân viên (trang công khai /de-xuat-vpp): tra mã NV → thấy định mức phòng ban → chọn số lượng
 *     • vượt định mức → bắt buộc lý do (không tự từ chối)
 *     • sản phẩm ngoài danh sách → "Thêm sản phẩm ngoài định mức" (lưu sản phẩm chờ duyệt, KHÔNG tự đưa vào danh mục)
 *   Quản trị: SUBMITTED → APPROVED / PARTIALLY_APPROVED / REJECTED → PURCHASED → RECEIVED (nhập kho: IN) → CLOSED
 */

function proposalFromRow_(r) {
  return {
    proposalId: String(r.proposal_id || '').toLowerCase(),
    proposalCode: r.proposal_code || '',
    requesterEmployeeId: r.requester_employee_id || '',
    requesterName: r.requester_name || '',
    requesterPosition: r.requester_position || '',
    department: r.department || '',
    scopeId: r.scope_id || '',
    status: PROPOSAL_STATUS[r.status] ? r.status : PROPOSAL_STATUS.SUBMITTED,
    reason: r.reason || '',
    estimatedTotal: toNumberOrNull_(r.estimated_total),
    adminNote: r.admin_note || '',
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    reviewedAt: r.reviewed_at || '',
    reviewedBy: r.reviewed_by || '',
    receivedAt: r.received_at || '',
    closedAt: r.closed_at || ''
  };
}

function proposalItemFromRow_(r) {
  return {
    proposalItemId: String(r.proposal_item_id || '').toLowerCase(),
    proposalId: String(r.proposal_id || '').toLowerCase(),
    productId: String(r.product_id || '').toLowerCase(),
    temporaryProductName: r.temporary_product_name || '',
    isOutsideNorm: toBool_(r.is_outside_norm),
    unit: r.unit || '',
    requestedQuantity: toIntOrNull_(r.requested_quantity) || 0,
    normQuantity: toIntOrNull_(r.norm_quantity),
    approvedQuantity: toIntOrNull_(r.approved_quantity),
    referencePrice: toNumberOrNull_(r.reference_price),
    approvedPrice: toNumberOrNull_(r.approved_price),
    reason: r.reason || '',
    note: r.note || '',
    productApprovalStatus: r.product_approval_status || PRODUCT_APPROVAL.NOT_REQUIRED,
    referenceUrl: r.reference_url || '',
    receivedQuantity: toIntOrNull_(r.received_quantity),
    itemOrder: toIntOrNull_(r.item_order) || 0
  };
}

function nextProposalCode_() {
  return nextDailyCode_(APP.PROPOSAL_CODE_PREFIX, PROP.PROPOSAL_SEQ, SHEETS.VPP_PROPOSALS, 'proposal_code');
}

function loadProposalItems_(proposalId) {
  return findRows_(SHEETS.VPP_PROPOSAL_ITEMS, 'proposal_id', proposalId)
    .map(function (m) {
      var item = proposalItemFromRow_(m.record);
      item._row = m.rowIndex;
      item._record = m.record;
      return item;
    })
    .sort(function (a, b) { return a.itemOrder - b.itemOrder; });
}

function requireProposal_(proposalId) {
  var id = String(proposalId || '').toLowerCase();
  if (!isUuid_(id)) throw appError_('NOT_FOUND', 'Không tìm thấy đề xuất.');
  var found = findRow_(SHEETS.VPP_PROPOSALS, 'proposal_id', id);
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy đề xuất.');
  return found;
}

function itemPrice_(item) {
  if (item.approvedPrice !== null && item.approvedPrice !== undefined) return item.approvedPrice;
  return item.referencePrice;
}

function estimateTotal_(items, useApproved) {
  var total = 0;
  var known = false;
  items.forEach(function (i) {
    var qty = useApproved ? (i.approvedQuantity || 0) : i.requestedQuantity;
    var price = itemPrice_(i);
    if (price !== null && price !== undefined && qty) {
      total += qty * price;
      known = true;
    }
  });
  return known ? Math.round(total) : null;
}

function proposalHistory_(proposalId, action, actor, oldStatus, newStatus, message, metadata) {
  appendHistory_(proposalId, action, actor, oldStatus, newStatus, message, metadata, 'VPP_PROPOSAL');
}

/**
 * Giá trị "ước tính" của đề xuất theo các dòng hiện tại: chưa duyệt → SL đề xuất × đơn giá, đã duyệt → SL duyệt × đơn giá
 * (đơn giá duyệt / thực mua nếu có, không thì giá tham khảo). Đề xuất bị từ chối cả phiếu không còn ước tính.
 */
function proposalEstimateCell_(status, items) {
  if (status === PROPOSAL_STATUS.REJECTED) return '';
  var estimate = estimateTotal_(items, status !== PROPOSAL_STATUS.SUBMITTED);
  return estimate === null ? '' : estimate;
}

/**
 * Đề xuất ĐÃ DUYỆT (APPROVED / PARTIALLY_APPROVED): tính lại trạng thái theo SL duyệt hiện tại của các dòng — cùng quy tắc với lúc
 * duyệt (mọi dòng 0 → REJECTED, đủ hết → APPROVED, còn lại → PARTIALLY_APPROVED). Gọi trong khóa, sau khi dòng đổi SL duyệt.
 */
function refreshReviewedStatus_(proposalId, now, actorText) {
  var found = requireProposal_(proposalId);
  var proposal = proposalFromRow_(found.record);
  if (proposal.status !== PROPOSAL_STATUS.APPROVED && proposal.status !== PROPOSAL_STATUS.PARTIALLY_APPROVED) return;
  var items = loadProposalItems_(proposalId);
  var allZero = items.every(function (i) { return !(i.approvedQuantity > 0); });
  var allFull = items.every(function (i) { return (i.approvedQuantity || 0) >= i.requestedQuantity; });
  var status = allZero ? PROPOSAL_STATUS.REJECTED : allFull ? PROPOSAL_STATUS.APPROVED : PROPOSAL_STATUS.PARTIALLY_APPROVED;
  if (status === proposal.status) return;
  updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, {
    status: status, estimated_total: proposalEstimateCell_(status, items), updated_at: now
  });
  proposalHistory_(proposalId, 'VPP_PROPOSAL_REVIEWED', actorText, proposal.status, status,
    'Trạng thái tính lại theo số lượng duyệt sau quyết định sản phẩm' + (allZero ? ' — không còn sản phẩm nào được duyệt.' : '.'), null);
}

/**
 * Đề xuất bị từ chối / đóng mà còn sản phẩm mới CHƯA quyết định: dòng → "từ chối sản phẩm", sản phẩm chờ duyệt → lưu trữ (nếu
 * không còn dòng chờ ở đề xuất khác) — không để sản phẩm "chờ duyệt" mồ côi mãi trong "Dữ liệu cần kiểm tra". Gọi trong khóa.
 */
function closePendingProducts_(items, now, why) {
  var products = loadProductMap_();
  var closing = {};
  items.forEach(function (i) { closing[i.proposalItemId] = true; });
  var closed = 0;
  items.forEach(function (item) {
    if (item.productApprovalStatus !== PRODUCT_APPROVAL.PENDING) return;
    updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, item._row, item._record, {
      product_approval_status: PRODUCT_APPROVAL.REJECTED, approved_quantity: 0
    });
    closed++;
    var p = products[item.productId];
    if (!p || p.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL) return;
    var stillPending = findRows_(SHEETS.VPP_PROPOSAL_ITEMS, 'product_id', p.productId).some(function (m) {
      var other = proposalItemFromRow_(m.record);
      return !closing[other.proposalItemId] && other.productApprovalStatus === PRODUCT_APPROVAL.PENDING;
    });
    if (stillPending) return;
    var row = findProductRow_(p.productId);
    if (row) {
      updateRowFields_(SHEETS.VPP_PRODUCTS, row.rowIndex, row.record, {
        catalog_status: CATALOG_STATUS.ARCHIVED, active: 'FALSE', updated_at: now, note: (p.note ? p.note + ' · ' : '') + why
      });
    }
  });
  return closed;
}

/** Tính lại ước tính sau khi giá / số lượng của dòng thay đổi (quyết định sản phẩm, nhập kho theo giá thực tế). Gọi trong khóa. */
function refreshProposalEstimate_(proposalId, now) {
  var found = requireProposal_(proposalId);
  var value = proposalEstimateCell_(proposalFromRow_(found.record).status, loadProposalItems_(proposalId));
  if (String(found.record.estimated_total) === String(value)) return found.record;
  var changes = { estimated_total: value, updated_at: now };
  updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, changes);
  return Object.assign({}, found.record, changes);
}

// ============================================================================
// Công khai — nhân viên gửi đề xuất
// ============================================================================

/**
 * Dấu vân tay NỘI DUNG các dòng đề xuất (sản phẩm / tên tự gõ, ĐVT, số lượng, lý do, ghi chú, link) — nhận ra gửi lại cùng mã thao
 * tác với nội dung khác. lines: dòng đã kiểm tra (chưa ghi); storedProposalFingerprint_: cùng dấu vân tay từ các dòng đã lưu.
 */
function proposalLinesFingerprint_(lines) {
  return sha256Hex_(JSON.stringify(lines.map(function (l) {
    return [l.product ? l.product.productId : '', l.temporaryName || '', l.unit || '', l.quantity, l.reason || '', l.note || '', l.referenceUrl || ''];
  })));
}

function storedProposalFingerprint_(items) {
  return sha256Hex_(JSON.stringify(items.map(function (i) {
    return [i.temporaryProductName ? '' : i.productId, i.temporaryProductName || '', i.unit || '', i.requestedQuantity, i.reason || '',
      i.note || '', i.referenceUrl || ''];
  })));
}

/**
 * Lần gửi trước lỗi giữa chừng (CHƯA có dòng đề xuất tổng — đề xuất chưa được gửi) và nhân viên sửa nội dung rồi gửi lại: tách các
 * dòng ghi dở không thuộc nội dung mới khỏi đề xuất (proposal_id trống) và lưu trữ sản phẩm chờ duyệt tạo cho chúng — không để
 * dòng cũ lẫn vào đề xuất, không để sản phẩm chờ duyệt mồ côi trong "Dữ liệu cần kiểm tra". Gọi trong khóa.
 */
function detachUnsubmittedProposalItems_(items, now) {
  var products = loadProductMap_();
  items.forEach(function (item) {
    updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, item._row, item._record, { proposal_id: '' });
    var p = products[item.productId];
    if (item.temporaryProductName && p && p.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL && p.source === 'PROPOSAL') {
      var row = findProductRow_(p.productId);
      if (row) {
        updateRowFields_(SHEETS.VPP_PRODUCTS, row.rowIndex, row.record, {
          catalog_status: CATALOG_STATUS.ARCHIVED, active: 'FALSE', updated_at: now,
          note: (p.note ? p.note + ' · ' : '') + 'Lần gửi đề xuất lỗi giữa chừng; đã gửi lại với nội dung khác'
        });
      }
    }
  });
  if (items.length) logInfo_('vpp.proposal_resubmitted_changed', { detached: items.length });
}

/** Số đề xuất nhân viên đã gửi hôm nay (giờ Việt Nam) — đếm từ sheet: bền, không phụ thuộc CacheService (tối đa 6 giờ). */
function proposalsSubmittedToday_(employeeId) {
  var id = String(employeeId || '').toUpperCase();
  var today = todayIsoDate_();
  return readColumns_(SHEETS.VPP_PROPOSALS, ['requester_employee_id', 'created_at']).filter(function (r) {
    return String(r.requester_employee_id || '').toUpperCase() === id && String(r.created_at || '').slice(0, 10) === today;
  }).length;
}

function apiVppSubmitProposal_(data) {
  var client = sanitizeClient_(data.client);
  // Cả văn phòng thường đi ra Internet qua MỘT IP (NAT) → giới hạn theo IP để rộng; giới hạn chính là theo nhân viên (bên dưới).
  enforceRateLimit_('vpp-proposal', client.ipHash, 60, 3600);
  var employeeId = cleanLine_(data.employeeId);
  var employee = employeeId ? findEmployeeById_(employeeId) : null;
  if (!employee || employee.status !== 'ACTIVE') {
    throw appError_('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên đang làm việc với mã này.', {
      fieldErrors: { employeeId: 'Không tìm thấy nhân viên đang làm việc với mã này.' }
    });
  }
  // Giới hạn theo nhân viên (đề xuất / ngày) kiểm tra SAU khi dữ liệu hợp lệ và đếm từ sheet — xem bên dưới.
  var requestId = optionalRequestId_(data.clientRequestId);
  var generalReason = cleanText_(data.reason);
  var errors = {};
  if (generalReason.length > LIMITS.PROPOSAL_REASON) errors.reason = 'Tối đa ' + LIMITS.PROPOSAL_REASON + ' ký tự';

  var rawItems = Array.isArray(data.items) ? data.items : [];
  if (!rawItems.length) errors.items = 'Chọn ít nhất 1 sản phẩm cần đề xuất';
  else if (rawItems.length > LIMITS.PROPOSAL_ITEMS) errors.items = 'Tối đa ' + LIMITS.PROPOSAL_ITEMS + ' sản phẩm trong một đề xuất';

  var scope = resolveDepartmentScope_(employee.department);
  var norms = scope ? normsForScope_(scope.scopeId) : {};
  var products = loadProductMap_();
  // Tên tự gõ CHỈ được gắn vào sản phẩm DANH MỤC đang dùng có tên trùng khớp hoàn toàn (giữ dấu): "Kẹo" / "Keo" không bị
  // gắn nhầm vào "Kéo". Còn lại luôn tạo sản phẩm chờ duyệt riêng cho dòng đó → quản trị viên quyết định (thêm / ghép / từ chối).
  var byExactName = {};
  Object.keys(products).forEach(function (pid) {
    var p = products[pid];
    if (p.catalogStatus !== CATALOG_STATUS.MASTER || !p.active) return;
    var key = exactNameKey_(p.productName);
    if (key && !byExactName[key]) byExactName[key] = p;
  });

  var seenProducts = {};
  var seenNames = {};
  var lines = rawItems.slice(0, LIMITS.PROPOSAL_ITEMS).map(function (raw, i) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var prefix = 'items.' + i + '.';
    var productId = String(raw.productId || '').trim().toLowerCase();
    var name = cleanLine_(raw.productName);
    var unit = cleanLine_(raw.unit);
    var reason = cleanText_(raw.reason);
    var note = cleanText_(raw.note);
    var url = cleanLine_(raw.referenceUrl);
    var qty = Number(raw.quantity);
    if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > LIMITS.MAX_QUANTITY) {
      errors[prefix + 'quantity'] = 'Số lượng phải là số nguyên ≥ 1';
    }
    if (reason.length > 500) errors[prefix + 'reason'] = 'Tối đa 500 ký tự';
    if (note.length > 500) errors[prefix + 'note'] = 'Tối đa 500 ký tự';
    if (unit.length > LIMITS.UNIT) errors[prefix + 'unit'] = 'Tối đa ' + LIMITS.UNIT + ' ký tự';
    if (url && (url.length > LIMITS.URL || !isHttpUrl_(url))) errors[prefix + 'referenceUrl'] = 'Link phải bắt đầu bằng http:// hoặc https://';
    if (containsPasswordLike_(note) || containsPasswordLike_(reason)) errors[prefix + 'note'] = PASSWORD_MESSAGE_;

    var product = null;
    if (productId) {
      product = products[productId];
      if (!product || product.catalogStatus !== CATALOG_STATUS.MASTER || !product.active) {
        errors[prefix + 'productId'] = 'Sản phẩm không có trong danh mục';
        product = null;
      }
    } else {
      if (!name) errors[prefix + 'productName'] = 'Nhập tên sản phẩm';
      else if (name.length > LIMITS.PRODUCT_NAME) errors[prefix + 'productName'] = 'Tối đa ' + LIMITS.PRODUCT_NAME + ' ký tự';
      else {
        // Tên trùng sản phẩm danh mục nhưng ĐVT gõ KHÁC ("Giấy toilet: 2 Thùng" — danh mục tính theo "Cuộn") → không tự gắn (sẽ
        // thành "2 Cuộn" và ĐVT gõ bị bỏ mất): để dòng chờ quyết định, quản trị viên quy đổi khi GHÉP.
        var named = byExactName[exactNameKey_(name)] || null;
        product = named && (!unit || sameUnit_(unit, named.unit)) ? named : null;
      }
    }
    var line = {
      index: i, product: product, temporaryName: product ? '' : name, unit: product ? (product.unit || unit) : unit,
      quantity: qty, reason: reason, note: note, referenceUrl: url
    };
    var norm = product ? norms[product.productId] : null;
    line.normQuantity = norm ? norm.monthlyQuantity : null;
    line.isOutsideNorm = !norm;
    if (norm && qty > norm.monthlyQuantity && !reason) {
      errors[prefix + 'reason'] = 'Vượt định mức (' + norm.monthlyQuantity + ' ' + (line.unit || '') + '/tháng) — nhập lý do';
    } else if (!norm && !reason) {
      errors[prefix + 'reason'] = 'Sản phẩm ngoài định mức — nhập lý do';
    }
    var key = product ? product.productId : exactNameKey_(name);
    if (key) {
      if (product ? seenProducts[key] : seenNames[key]) errors[prefix + (product ? 'productId' : 'productName')] = 'Sản phẩm bị trùng trong đề xuất';
      if (product) seenProducts[key] = true;
      else seenNames[key] = true;
    }
    return line;
  });
  if (Object.keys(errors).length) throw validationError_(errors);
  var fingerprint = proposalLinesFingerprint_(lines);

  var result = withScriptLock_(function () {
    if (requestId) {
      var existing = findRow_(SHEETS.VPP_PROPOSALS, 'client_request_id', requestId);
      if (existing) {
        var prev = proposalFromRow_(existing.record);
        // Cùng mã thao tác nhưng KHÁC nội dung (lần trước mất phản hồi nhưng đã gửi, nhân viên sửa rồi gửi lại): không báo "đã gửi"
        // với nội dung cũ như thể đã nhận bản mới — báo rõ để nhân viên gửi thành đề xuất mới / báo quản trị viên.
        var same = String(prev.requesterEmployeeId).toUpperCase() === employee.employeeId.toUpperCase() && prev.reason === generalReason &&
          storedProposalFingerprint_(loadProposalItems_(prev.proposalId)) === fingerprint;
        if (!same) {
          throw appError_('REQUEST_REUSED', 'Lần gửi trước (mất kết nối trước khi nhận được phản hồi) ĐÃ gửi đề xuất ' + prev.proposalCode +
            ' lúc ' + formatDisplayDateTime_(prev.createdAt) + ' với nội dung trước khi bạn sửa. Nội dung vừa sửa CHƯA được gửi.',
            { existing: { code: prev.proposalCode } });
        }
        return { duplicate: true, proposal: prev };
      }
    }
    if (proposalsSubmittedToday_(employee.employeeId) >= APP.PROPOSALS_PER_EMPLOYEE_PER_DAY) {
      throw appError_('RATE_LIMITED', 'Mỗi nhân viên gửi tối đa ' + APP.PROPOSALS_PER_EMPLOYEE_PER_DAY + ' đề xuất mỗi ngày. ' +
        'Vui lòng gộp vào đề xuất đã gửi hoặc liên hệ quản trị viên.');
    }
    var now = nowIso_();
    // ID cố định theo mã thao tác của trình duyệt + NỘI DUNG: lần gửi trước lỗi giữa chừng → gửi lại đúng nội dung đó nhận ra sản
    // phẩm / dòng đã ghi và ghi tiếp phần còn thiếu (không tạo sản phẩm chờ duyệt mồ côi, không có đề xuất 0 dòng); gửi lại với
    // nội dung KHÁC → ID khác, dòng ghi dở của nội dung cũ được tách khỏi đề xuất (không lẫn số lượng cũ vào đề xuất mới).
    var idFor = function (kind, i) { return requestId ? uuidFrom_('proposal:' + requestId + ':' + fingerprint + ':' + kind + ':' + i) : uuid_(); };
    var proposalId = requestId ? uuidFrom_('proposal:' + requestId) : uuid_();
    if (requestId) {
      var wantedIds = {};
      lines.forEach(function (line, i) { wantedIds[idFor('item', i)] = true; });
      detachUnsubmittedProposalItems_(loadProposalItems_(proposalId).filter(function (it) { return !wantedIds[it.proposalItemId]; }), now);
    }
    var code = nextProposalCode_();
    var actor = { id: 'nv:' + employee.employeeId, name: employee.fullName };
    var knownProducts = loadProductMap_();
    var knownItems = {};
    readColumn_(getSheet_(SHEETS.VPP_PROPOSAL_ITEMS), 'proposal_item_id').forEach(function (id) { knownItems[String(id).toLowerCase()] = true; });
    var itemRows = lines.map(function (line, i) {
      var approval = PRODUCT_APPROVAL.NOT_REQUIRED;
      var product = line.product; // chỉ có thể là sản phẩm danh mục đang dùng (kiểm tra ở trên)
      if (!product) {
        // Mỗi dòng ngoài danh mục có sản phẩm chờ duyệt RIÊNG — quyết định ở đề xuất này không ảnh hưởng đề xuất khác.
        var pendingId = idFor('product', i);
        product = knownProducts[pendingId] || createProduct_({
          productId: pendingId, productName: line.temporaryName, unit: line.unit, catalogStatus: CATALOG_STATUS.PENDING_APPROVAL,
          source: 'PROPOSAL', active: true, note: 'Đề xuất ' + code + ' của ' + employee.fullName
        }, actor, now);
        approval = PRODUCT_APPROVAL.PENDING;
      }
      return {
        proposal_item_id: idFor('item', i),
        proposal_id: proposalId,
        product_id: product.productId,
        temporary_product_name: line.temporaryName,
        is_outside_norm: boolCell_(line.isOutsideNorm),
        unit: line.unit,
        requested_quantity: line.quantity,
        norm_quantity: line.normQuantity === null ? '' : line.normQuantity,
        approved_quantity: '',
        reference_price: product.referencePrice === null || product.referencePrice === undefined ? '' : product.referencePrice,
        approved_price: '',
        reason: line.reason,
        note: line.note,
        product_approval_status: approval,
        reference_url: line.referenceUrl,
        received_quantity: '',
        item_order: i + 1
      };
    });
    var row = {
      proposal_id: proposalId,
      proposal_code: code,
      requester_employee_id: employee.employeeId,
      requester_name: employee.fullName,
      department: employee.department,
      status: PROPOSAL_STATUS.SUBMITTED,
      reason: generalReason,
      estimated_total: proposalEstimateCell_(PROPOSAL_STATUS.SUBMITTED, itemRows.map(proposalItemFromRow_)),
      created_at: now,
      updated_at: now,
      requester_position: employee.position,
      scope_id: scope ? scope.scopeId : '',
      client_request_id: requestId
    };
    // Dòng đề xuất ghi TRƯỚC, dòng đề xuất tổng ghi SAU CÙNG (mốc "đã gửi"): không bao giờ có đề xuất 0 dòng.
    appendObjects_(SHEETS.VPP_PROPOSAL_ITEMS, itemRows.filter(function (r) { return !knownItems[r.proposal_item_id]; }));
    appendObjects_(SHEETS.VPP_PROPOSALS, [row]);
    afterCommit_('proposal_submitted_history', code, function () {
      proposalHistory_(proposalId, 'VPP_PROPOSAL_SUBMITTED', employee.fullName + ' (' + employee.employeeId + ')', '',
        PROPOSAL_STATUS.SUBMITTED, 'Gửi đề xuất ' + code + ' gồm ' + itemRows.length + ' sản phẩm.',
        { ipHash: client.ipHash, userAgent: client.userAgent });
    });
    return { duplicate: false, proposal: proposalFromRow_(row) };
  });
  if (!result.duplicate) {
    // Báo quản trị viên (email, nếu đã cấu hình NOTIFY_EMAILS); lỗi gửi được ghi lại, đề xuất vẫn đã lưu.
    notifyAfterCommit_('PROPOSAL_SUBMITTED', function () {
      return notifyProposalSubmitted_(result.proposal, lines.map(function (line) {
        var name = line.product ? line.product.productName : line.temporaryName;
        return name + ' × ' + line.quantity + (line.unit ? ' ' + line.unit : '') + (line.product ? '' : ' (mới)');
      }));
    });
  }
  return {
    proposalCode: result.proposal.proposalCode,
    status: result.proposal.status,
    itemCount: lines.length,
    duplicate: result.duplicate
  };
}

// ============================================================================
// Quản trị
// ============================================================================

/** Tóm tắt danh sách đề xuất (số món, số món ngoài định mức, giá dự kiến). */
function vppProposalSummaries_(proposalRows) {
  var counts = {};
  if (proposalRows.length) {
    readColumns_(SHEETS.VPP_PROPOSAL_ITEMS, ['proposal_id', 'is_outside_norm', 'product_approval_status']).forEach(function (it) {
      var c = counts[it.proposal_id] || (counts[it.proposal_id] = { items: 0, outside: 0, pendingProducts: 0 });
      c.items++;
      if (toBool_(it.is_outside_norm)) c.outside++;
      if (it.product_approval_status === PRODUCT_APPROVAL.PENDING) c.pendingProducts++;
    });
  }
  return proposalRows
    .filter(function (r) { return isUuid_(r.proposal_id); })
    .map(function (r) {
      var p = proposalFromRow_(r);
      var c = counts[r.proposal_id] || { items: 0, outside: 0, pendingProducts: 0 };
      p.itemCount = c.items;
      p.outsideNormCount = c.outside;
      p.pendingProductCount = c.pendingProducts;
      return p;
    })
    // Mới nhất trước; cùng giây (gửi liên tiếp) thì theo mã đề xuất (tăng dần theo thứ tự gửi) — không phụ thuộc thứ tự dòng.
    .sort(function (a, b) {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.proposalCode < b.proposalCode ? 1 : a.proposalCode > b.proposalCode ? -1 : 0;
    });
}

function apiVppListProposals_(q) {
  q = q || {};
  var exportAll = q.exportAll === true; // xuất CSV: một trang tối đa APP.EXPORT_MAX_ROWS dòng
  var page = exportAll ? 1 : clampInt_(q.page, 1, 100000, 1);
  var pageSize = exportAll ? APP.EXPORT_MAX_ROWS : clampInt_(q.pageSize, 5, 100, 20);
  var status = PROPOSAL_STATUS[String(q.status || '').toUpperCase()] || '';
  var needle = normalizeText_(q.q);
  var all = vppProposalSummaries_(readTable_(SHEETS.VPP_PROPOSALS).rows);
  var stats = {};
  Object.keys(PROPOSAL_STATUS).forEach(function (s) { stats[s] = 0; });
  all.forEach(function (p) { stats[p.status] = (stats[p.status] || 0) + 1; });
  var filtered = all.filter(function (p) {
    if (status && p.status !== status) return false;
    if (needle && normalizeText_([p.proposalCode, p.requesterName, p.requesterEmployeeId, p.department].join(' ')).indexOf(needle) < 0) return false;
    return true;
  });
  var start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), total: filtered.length, page: page, pageSize: pageSize, stats: stats };
}

function proposalDetail_(proposalRecord) {
  var proposal = proposalFromRow_(proposalRecord);
  var products = loadProductMap_();
  var stock = loadStockMap_();
  var items = loadProposalItems_(proposal.proposalId).map(function (i) {
    var p = products[i.productId];
    var view = Object.assign({}, i);
    delete view._row;
    delete view._record;
    view.product = p ? {
      productId: p.productId, productCode: p.productCode, productName: p.productName, unit: p.unit, category: p.category,
      catalogStatus: p.catalogStatus, active: p.active, referencePrice: p.referencePrice
    } : null;
    view.displayName = p ? p.productName : i.temporaryProductName;
    view.stock = p ? stockView_(stock[p.productId], p) : null;
    return view;
  });
  var history = findRows_(SHEETS.HISTORY, 'handover_id', proposal.proposalId)
    .filter(function (m) { return m.record.entity_type === 'VPP_PROPOSAL'; })
    .map(function (m) {
      var r = m.record;
      return { logId: r.log_id, action: r.action, actor: r.actor, oldStatus: r.old_status, newStatus: r.new_status, message: r.message, createdAt: r.created_at };
    })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
  return { proposal: proposal, items: items, history: history, scopes: listNormScopes_() };
}

function apiVppGetProposal_(data) {
  return proposalDetail_(requireProposal_(data.id).record);
}

// Literal (không tham chiếu PROPOSAL_STATUS của Config.gs): code top-level chạy theo thứ tự file trong dự án Apps Script — file này
// nạp trước Config.gs (thứ tự trong trình soạn thảo) thì tham chiếu sẽ lỗi "PROPOSAL_STATUS is not defined" cho MỌI request.
var REVIEWABLE_PROPOSAL_STATUSES_ = ['SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED'];

/** Duyệt từng dòng: SL duyệt (0 = không duyệt), đơn giá duyệt. Trạng thái tính từ kết quả các dòng. */
function apiVppReviewProposal_(data) {
  var actor = sanitizeActor_(data.actor);
  var decisions = Array.isArray(data.decisions) ? data.decisions : [];
  var adminNote = cleanText_(data.adminNote);
  if (adminNote.length > LIMITS.PROPOSAL_REASON) throw validationError_({ adminNote: 'Tối đa ' + LIMITS.PROPOSAL_REASON + ' ký tự' });
  return withScriptLock_(function () {
    var found = requireProposal_(data.id);
    var proposal = proposalFromRow_(found.record);
    if (REVIEWABLE_PROPOSAL_STATUSES_.indexOf(proposal.status) < 0) {
      throw appError_('INVALID_STATUS_TRANSITION', 'Đề xuất ở trạng thái ' + proposal.status + ' không thể duyệt lại.');
    }
    var items = loadProposalItems_(proposal.proposalId);
    var byId = {};
    decisions.forEach(function (d) { if (d && d.proposalItemId) byId[String(d.proposalItemId).toLowerCase()] = d; });
    var errors = {};
    items.forEach(function (item, i) {
      var d = byId[item.proposalItemId];
      if (!d) {
        errors['decisions.' + i + '.approvedQuantity'] = 'Thiếu số lượng duyệt';
        return;
      }
      var qty = Number(d.approvedQuantity);
      if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_QUANTITY) {
        errors['decisions.' + i + '.approvedQuantity'] = 'Số lượng duyệt phải là số nguyên ≥ 0';
      }
      if (item.productApprovalStatus === PRODUCT_APPROVAL.REJECTED && qty > 0) {
        errors['decisions.' + i + '.approvedQuantity'] = 'Sản phẩm đã bị từ chối — số lượng duyệt phải là 0';
      }
      if (d.approvedPrice !== undefined && d.approvedPrice !== null && d.approvedPrice !== '') {
        var price = Number(d.approvedPrice);
        if (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE) errors['decisions.' + i + '.approvedPrice'] = 'Đơn giá không hợp lệ';
      }
    });
    if (Object.keys(errors).length) throw validationError_(errors);
    var now = nowIso_();
    var allZero = true;
    var allFull = true;
    items.forEach(function (item) {
      var d = byId[item.proposalItemId];
      var qty = Number(d.approvedQuantity);
      var price = d.approvedPrice === undefined || d.approvedPrice === null || d.approvedPrice === '' ? '' : roundPrice_(d.approvedPrice);
      if (qty > 0) allZero = false;
      if (qty < item.requestedQuantity) allFull = false;
      updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, item._row, item._record, { approved_quantity: qty, approved_price: price });
      item.approvedQuantity = qty;
      item.approvedPrice = price === '' ? null : price;
    });
    var status = allZero ? PROPOSAL_STATUS.REJECTED : allFull ? PROPOSAL_STATUS.APPROVED : PROPOSAL_STATUS.PARTIALLY_APPROVED;
    var changes = {
      status: status,
      estimated_total: proposalEstimateCell_(status, items),
      reviewed_at: now,
      reviewed_by: actorLabel_(actor),
      admin_note: adminNote,
      updated_at: now
    };
    updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, changes);
    var products = loadProductMap_();
    proposalHistory_(proposal.proposalId, 'VPP_PROPOSAL_REVIEWED', actorLabel_(actor), proposal.status, status,
      'Duyệt đề xuất ' + proposal.proposalCode + ': ' + items.map(function (i) {
        var p = products[i.productId];
        return (p ? p.productName : i.temporaryProductName) + ' ' + i.approvedQuantity + '/' + i.requestedQuantity;
      }).join(', ') + (adminNote ? ' · ' + adminNote : ''), { actor: actor });
    return proposalDetail_(Object.assign({}, found.record, changes));
  });
}

function apiVppRejectProposal_(data) {
  var actor = sanitizeActor_(data.actor);
  var reason = cleanText_(data.reason);
  if (reason.length < 3) throw validationError_({ reason: 'Nhập lý do từ chối' });
  if (reason.length > LIMITS.PROPOSAL_REASON) throw validationError_({ reason: 'Tối đa ' + LIMITS.PROPOSAL_REASON + ' ký tự' });
  return withScriptLock_(function () {
    var found = requireProposal_(data.id);
    var proposal = proposalFromRow_(found.record);
    if (REVIEWABLE_PROPOSAL_STATUSES_.indexOf(proposal.status) < 0) {
      throw appError_('INVALID_STATUS_TRANSITION', 'Đề xuất ở trạng thái ' + proposal.status + ' không thể từ chối.');
    }
    var now = nowIso_();
    var items = loadProposalItems_(proposal.proposalId);
    // Sản phẩm mới chưa quyết định của đề xuất bị từ chối → từ chối luôn (không để "chờ duyệt" mồ côi).
    var closedProducts = closePendingProducts_(items, now, 'Đề xuất ' + proposal.proposalCode + ' bị từ chối');
    items.forEach(function (item) {
      if (item.productApprovalStatus === PRODUCT_APPROVAL.PENDING) return; // đã ghi SL 0 ở bước trên
      updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, item._row, item._record, { approved_quantity: 0 });
    });
    var changes = {
      status: PROPOSAL_STATUS.REJECTED, admin_note: reason, reviewed_at: now, reviewed_by: actorLabel_(actor),
      estimated_total: '', updated_at: now
    };
    updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, changes);
    proposalHistory_(proposal.proposalId, 'VPP_PROPOSAL_REJECTED', actorLabel_(actor), proposal.status, PROPOSAL_STATUS.REJECTED,
      'Từ chối đề xuất ' + proposal.proposalCode + ': ' + reason +
        (closedProducts ? ' (' + closedProducts + ' sản phẩm mới chưa quyết định: từ chối theo đề xuất)' : ''), { actor: actor });
    return proposalDetail_(Object.assign({}, found.record, changes));
  });
}

/** Đánh dấu đã mua (APPROVED / PARTIALLY_APPROVED → PURCHASED) hoặc đóng đề xuất (→ CLOSED). */
function apiVppSetProposalStatus_(data) {
  var actor = sanitizeActor_(data.actor);
  var target = String(data.status || '').toUpperCase();
  var allowed = {
    PURCHASED: [PROPOSAL_STATUS.APPROVED, PROPOSAL_STATUS.PARTIALLY_APPROVED],
    CLOSED: [PROPOSAL_STATUS.APPROVED, PROPOSAL_STATUS.PARTIALLY_APPROVED, PROPOSAL_STATUS.PURCHASED, PROPOSAL_STATUS.RECEIVED, PROPOSAL_STATUS.REJECTED]
  };
  if (!allowed[target]) throw validationError_({ status: 'Trạng thái không hợp lệ' });
  var note = cleanText_(data.note);
  if (note.length > LIMITS.PROPOSAL_REASON) throw validationError_({ note: 'Tối đa ' + LIMITS.PROPOSAL_REASON + ' ký tự' });
  return withScriptLock_(function () {
    var found = requireProposal_(data.id);
    var proposal = proposalFromRow_(found.record);
    if (allowed[target].indexOf(proposal.status) < 0) {
      throw appError_('INVALID_STATUS_TRANSITION', 'Không thể chuyển đề xuất từ ' + proposal.status + ' sang ' + target + '.');
    }
    var now = nowIso_();
    var changes = { status: target, updated_at: now };
    var closedProducts = 0;
    if (target === PROPOSAL_STATUS.CLOSED) {
      changes.closed_at = now;
      // Đóng đề xuất mà còn sản phẩm mới chưa quyết định → từ chối các sản phẩm đó (không còn đường nhận hàng qua đề xuất này).
      closedProducts = closePendingProducts_(loadProposalItems_(proposal.proposalId), now, 'Đề xuất ' + proposal.proposalCode + ' đã đóng');
    }
    updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, changes);
    proposalHistory_(proposal.proposalId, 'VPP_PROPOSAL_' + target, actorLabel_(actor), proposal.status, target,
      (target === 'PURCHASED' ? 'Đã mua hàng' : 'Đóng đề xuất') + (note ? ': ' + note : '') +
        (closedProducts ? ' (' + closedProducts + ' sản phẩm mới chưa quyết định: từ chối theo đề xuất)' : ''), { actor: actor });
    return proposalDetail_(Object.assign({}, found.record, changes));
  });
}

/**
 * Sản phẩm nhận tồn cho một dòng đề xuất: chính sản phẩm của dòng, hoặc — nếu sản phẩm đó đã được GHÉP ở trang Rà soát dữ liệu
 * (lưu trữ + merged_into_product_id) — sản phẩm đích cuối cùng, khi CÙNG ĐVT (khác ĐVT thì số lượng dòng không quy đổi được).
 * Trả về { product } hoặc { error } (thông báo đúng nguyên nhân).
 */
function receivingProduct_(products, item) {
  var original = products[item.productId];
  var label = '"' + (item.temporaryProductName || (original && original.productName) || 'Sản phẩm') + '"';
  if (!original) return { error: label + ' không còn trong danh mục sản phẩm — chưa nhập kho được.' };
  if (original.catalogStatus === CATALOG_STATUS.PENDING_APPROVAL) {
    return { error: label + ' chưa được duyệt vào danh mục (thêm vào danh mục / giữ tạm / ghép) — chưa nhập kho được.' };
  }
  var p = original;
  for (var hop = 0; hop < 5 && !isUsableProduct_(p) && p.mergedIntoProductId; hop++) {
    var next = products[p.mergedIntoProductId];
    if (!next) break;
    p = next;
  }
  if (!isUsableProduct_(p)) {
    return { error: label + ' đã ngừng dùng / lưu trữ' + (p !== original ? ' (đã ghép vào "' + p.productName + '", sản phẩm này cũng ngừng dùng)' : '') +
      ' — bật lại sản phẩm ở trang Tồn kho hoặc nhập 0 cho dòng này.' };
  }
  if (p !== original && !sameUnit_(item.unit, p.unit) && (item.unit || p.unit)) {
    return { error: label + ' đã được ghép vào "' + p.productName + '" khác ĐVT (' + (item.unit || 'chưa có') + ' → ' + (p.unit || 'chưa có') +
      ') — số lượng dòng này không tự quy đổi được. Nhập 0 cho dòng này rồi nhập kho "' + p.productName + '" ở trang Tồn kho theo số đã quy đổi.' };
  }
  return { product: p };
}

/** Nhập kho từ đề xuất: SL thực nhận từng dòng → IN (on_hand += SL), idempotent theo PROPOSAL_RECEIVE:{id}:{dòng}. */
function apiVppReceiveProposal_(data) {
  var actor = sanitizeActor_(data.actor);
  var lines = Array.isArray(data.lines) ? data.lines : [];
  var date = String(data.receivedDate || '').trim();
  var note = cleanText_(data.note);
  var errors = {};
  if (date && !isValidDateOnly_(date)) errors.receivedDate = 'Ngày không hợp lệ';
  if (note.length > LIMITS.STOCK_REASON) errors.note = 'Tối đa ' + LIMITS.STOCK_REASON + ' ký tự';
  if (Object.keys(errors).length) throw validationError_(errors);
  return withScriptLock_(function () {
    var found = requireProposal_(data.id);
    var proposal = proposalFromRow_(found.record);
    if ([PROPOSAL_STATUS.APPROVED, PROPOSAL_STATUS.PARTIALLY_APPROVED, PROPOSAL_STATUS.PURCHASED].indexOf(proposal.status) < 0) {
      throw appError_('INVALID_STATUS_TRANSITION', 'Chỉ nhập kho cho đề xuất đã duyệt / đã mua (hiện tại: ' + proposal.status + ').');
    }
    var items = loadProposalItems_(proposal.proposalId);
    var products = loadProductMap_();
    var byId = {};
    lines.forEach(function (l) { if (l && l.proposalItemId) byId[String(l.proposalItemId).toLowerCase()] = l; });
    var moves = [];
    var updates = [];
    items.forEach(function (item, i) {
      var l = byId[item.proposalItemId];
      if (!l) return;
      var qty = Number(l.receivedQuantity);
      if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 0 || qty > LIMITS.MAX_QUANTITY) {
        errors['lines.' + i + '.receivedQuantity'] = 'Số lượng thực nhận phải là số nguyên ≥ 0';
        return;
      }
      var price = l.unitPrice === undefined || l.unitPrice === null || l.unitPrice === '' ? null : roundPrice_(l.unitPrice);
      if (price !== null && (!isFinite(price) || price < 0 || price > LIMITS.MAX_PRICE)) {
        errors['lines.' + i + '.unitPrice'] = 'Đơn giá không hợp lệ';
        return;
      }
      if (qty > 0 && !(item.approvedQuantity > 0)) {
        // Dòng duyệt số lượng 0 (không mua / sản phẩm bị từ chối) — trang không cho nhập; không nhận kho qua API cho dòng này.
        errors['lines.' + i + '.receivedQuantity'] = 'Dòng này được duyệt số lượng 0 — không nhập kho theo đề xuất. Dùng Nhập kho ở trang Tồn kho nếu thực tế có nhận hàng.';
        return;
      }
      var p = products[item.productId];
      var stockProduct = p;
      if (qty > 0) {
        var resolved = receivingProduct_(products, item);
        if (resolved.error) {
          errors['lines.' + i + '.receivedQuantity'] = resolved.error;
          return;
        }
        stockProduct = resolved.product;
      }
      var operationId = 'PROPOSAL_RECEIVE:' + proposal.proposalId + ':' + item.proposalItemId;
      // Lần nhận hàng trước lỗi giữa chừng đã ghi nhập kho cho dòng này → gửi lại phải đúng số đó (không âm thầm giữ số cũ khi
      // người dùng sửa số, không nhập thêm lần 2).
      var prior = priorOperation_(operationId);
      if (prior && (toIntOrNull_(prior.quantity) !== qty || String(prior.product_id).toLowerCase() !== (stockProduct ? stockProduct.productId : ''))) {
        var priorQty = toIntOrNull_(prior.quantity) || 0;
        errors['lines.' + i + '.receivedQuantity'] = 'Lần nhận hàng trước (lỗi / mất kết nối giữa chừng) ĐÃ nhập kho ' + priorQty + ' cho dòng này lúc ' +
          formatDisplayDateTime_(prior.created_at) + ' — nhập đúng ' + priorQty + ' để hoàn tất; nếu số thực nhận khác, điều chỉnh bằng Kiểm kê ở trang Tồn kho.';
        return;
      }
      updates.push({ item: item, qty: qty, price: price });
      if (qty > 0) {
        moves.push({
          productId: stockProduct.productId,
          type: MOVEMENT_TYPES.IN,
          quantity: qty,
          proposalId: proposal.proposalId,
          operationId: operationId,
          reason: 'Nhập kho theo đề xuất ' + proposal.proposalCode + (date ? ' · ngày ' + formatDisplayDate_(date) : '') +
            (stockProduct !== p ? ' · "' + (p ? p.productName : item.temporaryProductName) + '" đã ghép vào "' + stockProduct.productName + '"' : '') +
            (price !== null ? ' · đơn giá ' + price : '') + (note ? ' · ' + note : '')
        });
      }
    });
    if (!updates.length) errors.lines = 'Nhập số lượng thực nhận cho ít nhất 1 dòng';
    else if (!errors.lines && !Object.keys(errors).length && updates.every(function (u) { return u.qty === 0; })) {
      // Nhận 0 cho mọi dòng = không nhận được gì: không chuyển đề xuất sang "Đã nhận hàng".
      errors.lines = 'Số lượng thực nhận đều bằng 0 — chưa có gì để nhập kho. Nếu không mua / không nhận được hàng, hãy Đóng đề xuất.';
    }
    if (Object.keys(errors).length) throw validationError_(errors);
    var pending = moves.filter(function (m) { return !operationExists_(m.operationId); });
    var now = nowIso_();
    if (pending.length) applyStockMovements_(pending, actor, now);
    updates.forEach(function (u) {
      var changes = { received_quantity: u.qty };
      if (u.price !== null) {
        changes.approved_price = u.price;
        u.item.approvedPrice = u.price; // ước tính tính lại theo đơn giá thực mua
      }
      updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, u.item._row, u.item._record, changes);
    });
    var changes = {
      status: PROPOSAL_STATUS.RECEIVED, received_at: now, updated_at: now,
      estimated_total: proposalEstimateCell_(PROPOSAL_STATUS.RECEIVED, items)
    };
    updateRowFields_(SHEETS.VPP_PROPOSALS, found.rowIndex, found.record, changes);
    proposalHistory_(proposal.proposalId, 'VPP_PROPOSAL_RECEIVED', actorLabel_(actor), proposal.status, PROPOSAL_STATUS.RECEIVED,
      'Nhập kho theo đề xuất ' + proposal.proposalCode + ': ' + updates.map(function (u) {
        var p = products[u.item.productId];
        return (p ? p.productName : u.item.temporaryProductName) + ' +' + u.qty;
      }).join(', ') + (note ? ' · ' + note : ''), { actor: actor, date: date });
    return proposalDetail_(Object.assign({}, found.record, changes));
  });
}

/**
 * Áp kết quả quyết định cho các dòng KHÁC đang chờ quyết định cùng sản phẩm (gọi trong khóa). Trả về danh sách proposalId
 * có dòng được cập nhật. Dòng đã có số lượng duyệt mà sản phẩm bị từ chối → số lượng duyệt về 0 (không mua sản phẩm bị từ chối).
 */
function syncPendingProposalLines_(productId, exceptItemId, itemChanges, now) {
  var touched = [];
  findRows_(SHEETS.VPP_PROPOSAL_ITEMS, 'product_id', productId).forEach(function (m) {
    var line = proposalItemFromRow_(m.record);
    if (line.proposalItemId === exceptItemId || line.productApprovalStatus !== PRODUCT_APPROVAL.PENDING) return;
    updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, m.rowIndex, m.record, itemChanges);
    if (touched.indexOf(line.proposalId) < 0) touched.push(line.proposalId);
  });
  if (touched.length) logInfo_('vpp.decision_synced', { productId: productId, proposals: touched.length, at: now });
  return touched;
}

/** Quyết định đã được ghi lên sản phẩm (lần trước lỗi giữa chừng trước khi ghi dòng đề xuất)? */
function decisionAlreadyApplied_(decision, product, targetId) {
  if (decision === 'MASTER') return product.catalogStatus === CATALOG_STATUS.MASTER;
  if (decision === 'TEMP') return product.catalogStatus === CATALOG_STATUS.TEMP;
  if (decision === 'REJECT') return product.catalogStatus === CATALOG_STATUS.ARCHIVED && !product.mergedIntoProductId;
  if (decision === 'MAP') return product.catalogStatus === CATALOG_STATUS.ARCHIVED && product.mergedIntoProductId === targetId;
  return false;
}

/** Số lượng của dòng phải quy đổi khi đổi sang ĐVT mới: khác ĐVT (giữ dấu), hoặc dòng chưa có ĐVT mà ĐVT mới có. */
function unitNeedsConversion_(lineUnit, newUnit) {
  return Boolean(lineUnit || newUnit) && !sameUnit_(lineUnit, newUnit);
}

/**
 * Đổi ĐVT của dòng đề xuất (GHÉP / thêm vào danh mục / giữ tạm): bắt buộc số lượng đã quy đổi + xác nhận; không cho khi dòng đã
 * duyệt một phần theo ĐVT cũ, hoặc sản phẩm chờ duyệt còn ở dòng đề xuất khác (mỗi dòng phải quy đổi riêng).
 */
function requireLineConversion_(item, product, newUnit, convertedQty, unitConverted) {
  var hint = (item.unit ? 'ĐVT khác nhau (' + item.unit + ' → ' + (newUnit || 'chưa có') + ')' : 'Dòng đề xuất chưa có ĐVT') +
    ' — số lượng đề xuất ' + item.requestedQuantity + (item.unit ? ' ' + item.unit : '');
  if (convertedQty === null) {
    throw validationError_({ convertedQuantity: hint + ': nhập số lượng đã quy đổi sang ĐVT "' + (newUnit || '') + '".' });
  }
  if (!unitConverted) {
    throw validationError_({ unitConverted: hint + ': xác nhận đã quy đổi sang ĐVT "' + (newUnit || '') + '".' });
  }
  if (item.approvedQuantity !== null && item.approvedQuantity > 0 && item.approvedQuantity !== item.requestedQuantity) {
    throw appError_('INVALID_STATE', 'Dòng này đã được duyệt một phần (' + item.approvedQuantity + '/' + item.requestedQuantity +
      ') theo ĐVT cũ. Hãy duyệt lại dòng này với số lượng bằng số đề xuất (hoặc 0) rồi đổi ĐVT.');
  }
  var others = findRows_(SHEETS.VPP_PROPOSAL_ITEMS, 'product_id', product.productId).filter(function (m) {
    var other = proposalItemFromRow_(m.record);
    return other.proposalItemId !== item.proposalItemId && other.productApprovalStatus === PRODUCT_APPROVAL.PENDING;
  });
  if (others.length) {
    throw appError_('INVALID_STATE', 'Sản phẩm "' + product.productName + '" còn ở ' + others.length + ' dòng đề xuất khác — đổi ĐVT ' +
      'phải quy đổi từng dòng. Hãy giữ ĐVT của dòng đề xuất, hoặc dùng GHÉP ở trang Rà soát dữ liệu.');
  }
}

/**
 * Quyết định với sản phẩm ngoài danh mục trong đề xuất:
 *   MASTER → thêm vào danh mục (mã, nhóm, ĐVT, đơn giá, tồn tối thiểu, có thể kèm định mức theo phạm vi)
 *   TEMP   → giữ tạm (dùng được cho nhập / xuất kho nhưng không hiện trong danh mục công khai)
 *   REJECT → từ chối (sản phẩm lưu trữ, SL duyệt = 0)
 *   MAP    → ghép vào sản phẩm có sẵn (targetProductId)
 */
function apiVppProductDecision_(data) {
  var actor = sanitizeActor_(data.actor);
  var decision = String(data.decision || '').toUpperCase();
  if (['MASTER', 'TEMP', 'REJECT', 'MAP'].indexOf(decision) < 0) throw validationError_({ decision: 'Chọn cách xử lý sản phẩm' });
  var itemId = String(data.proposalItemId || '').toLowerCase();
  var fields = decision === 'MASTER' || decision === 'TEMP' ? validateProductFields_(data, true) : null;
  if (decision === 'MASTER' && !fields.unit) throw validationError_({ unit: 'Nhập ĐVT cho sản phẩm danh mục' });
  var norm = decision === 'MASTER' && data.norm && typeof data.norm === 'object' ? data.norm : null;
  var targetId = String(data.targetProductId || '').toLowerCase();
  if (decision === 'MAP' && !isUuid_(targetId)) throw validationError_({ targetProductId: 'Chọn sản phẩm có sẵn để ghép' });
  // MAP khác ĐVT: số lượng đề xuất đã quy đổi sang ĐVT sản phẩm đích + xác nhận đã quy đổi (kiểm tra trong khóa).
  var convertedQty = data.convertedQuantity === null || data.convertedQuantity === undefined || data.convertedQuantity === ''
    ? null : Number(data.convertedQuantity);
  if (convertedQty !== null &&
      (!isFinite(convertedQty) || Math.floor(convertedQty) !== convertedQty || convertedQty < 1 || convertedQty > LIMITS.MAX_QUANTITY)) {
    throw validationError_({ convertedQuantity: 'Số lượng quy đổi phải là số nguyên ≥ 1' });
  }
  var unitConverted = data.unitConverted === true;

  var outcome = withScriptLock_(function () {
    var found = requireProposal_(data.id);
    var proposal = proposalFromRow_(found.record);
    var item = loadProposalItems_(proposal.proposalId).filter(function (i) { return i.proposalItemId === itemId; })[0];
    if (!item) throw appError_('NOT_FOUND', 'Không tìm thấy dòng đề xuất.');
    var productRow = requireProduct_(item.productId);
    var product = productFromRow_(productRow.record);
    // Chỉ quyết định khi CẢ dòng đề xuất lẫn sản phẩm còn chờ duyệt: sản phẩm đã được xử lý (đã vào danh mục, có tồn,
    // đang được giữ chỗ…) không bao giờ bị lưu trữ / đổi mã ngoài ý muốn từ một đề xuất khác. Ngoại lệ duy nhất: lần quyết định
    // trước lỗi giữa chừng (sản phẩm đã ghi xong, dòng đề xuất chưa) và sản phẩm đang ĐÚNG trạng thái của chính quyết định này →
    // chỉ ghi tiếp phần dòng đề xuất (không đụng sản phẩm) — trước đây dòng kẹt "chờ quyết định" vĩnh viễn.
    var resumed = item.productApprovalStatus === PRODUCT_APPROVAL.PENDING && product.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL &&
      product.source === 'PROPOSAL' && decisionAlreadyApplied_(decision, product, targetId);
    if (item.productApprovalStatus !== PRODUCT_APPROVAL.PENDING ||
        (product.catalogStatus !== CATALOG_STATUS.PENDING_APPROVAL && !resumed)) {
      throw appError_('INVALID_STATE', 'Sản phẩm "' + (item.temporaryProductName || product.productName) +
        '" đã được xử lý trước đó (không còn chờ duyệt). Tải lại trang để xem kết quả.');
    }
    var now = nowIso_();
    var itemChanges = {};
    var lineOnly = {}; // thay đổi chỉ áp cho CHÍNH dòng này (số lượng đã quy đổi), không áp cho dòng khác cùng sản phẩm
    var label = '';
    if (decision === 'MASTER' || decision === 'TEMP') {
      if (norm) precheckAttachedNorm_(product.productId, norm); // lỗi định mức → chưa ghi gì
      // ĐVT quyết định khác ĐVT của dòng ("Ruột bút bi: 2 Hộp" → sản phẩm tính theo "Cây"): số lượng phải quy đổi như GHÉP —
      // trước đây dòng thành "2 Cây" rồi duyệt / nhập kho theo 2 cây.
      var decidedUnit = fields.unit || item.unit;
      var masterUnitChanges = unitNeedsConversion_(item.unit, decidedUnit);
      if (masterUnitChanges) requireLineConversion_(item, product, decidedUnit, convertedQty, unitConverted);
      if (!resumed) {
        var code = fields.productCode || (decision === 'MASTER' ? nextProductCode_() : product.productCode);
        if (productCodeTaken_(code, product.productId)) throw validationError_({ productCode: 'Mã sản phẩm "' + code + '" đã tồn tại' });
        updateRowFields_(SHEETS.VPP_PRODUCTS, productRow.rowIndex, productRow.record, {
          product_code: code, product_name: fields.productName, normalized_name: matchKey_(fields.productName),
          category: fields.category, unit: fields.unit, reference_price: fields.referencePrice === null ? '' : fields.referencePrice,
          minimum_stock: fields.minimumStock, catalog_status: decision === 'MASTER' ? CATALOG_STATUS.MASTER : CATALOG_STATUS.TEMP,
          active: 'TRUE', note: fields.note || product.note, updated_at: now
        });
      }
      ensureStockRows_([product.productId], actor, now);
      itemChanges.product_approval_status = decision === 'MASTER' ? PRODUCT_APPROVAL.APPROVED_MASTER : PRODUCT_APPROVAL.KEPT_TEMP;
      itemChanges.unit = decidedUnit;
      if (fields.referencePrice !== null) itemChanges.reference_price = fields.referencePrice;
      label = decision === 'MASTER' ? 'Thêm vào danh mục' : 'Giữ tạm';
      if (masterUnitChanges) {
        lineOnly.requested_quantity = convertedQty;
        if (item.approvedQuantity !== null && item.approvedQuantity > 0) lineOnly.approved_quantity = convertedQty;
        label += ' (quy đổi ' + item.requestedQuantity + ' ' + (item.unit || '?') + ' → ' + convertedQty + ' ' + decidedUnit + ')';
      }
    } else if (decision === 'REJECT') {
      if (!resumed) {
        updateRowFields_(SHEETS.VPP_PRODUCTS, productRow.rowIndex, productRow.record, {
          catalog_status: CATALOG_STATUS.ARCHIVED, active: 'FALSE', updated_at: now
        });
      }
      itemChanges.product_approval_status = PRODUCT_APPROVAL.REJECTED;
      itemChanges.approved_quantity = 0;
      label = 'Từ chối sản phẩm';
    } else {
      var target = productFromRow_(requireProduct_(targetId).record);
      if (!isUsableProduct_(target)) throw appError_('INVALID_STATE', 'Sản phẩm đích không dùng được.');
      // ĐVT khác nhau (hoặc dòng chưa có ĐVT): số lượng đề xuất phải QUY ĐỔI sang ĐVT của sản phẩm đích — "2 hộp" không
      // bao giờ tự thành "2 cây" (giống GHÉP ở trang Rà soát dữ liệu).
      var unitChanges = unitNeedsConversion_(item.unit, target.unit);
      if (unitChanges) requireLineConversion_(item, product, target.unit, convertedQty, unitConverted);
      if (!resumed) {
        updateRowFields_(SHEETS.VPP_PRODUCTS, productRow.rowIndex, productRow.record, {
          catalog_status: CATALOG_STATUS.ARCHIVED, active: 'FALSE', merged_into_product_id: targetId, updated_at: now
        });
      }
      itemChanges.product_id = targetId;
      itemChanges.product_approval_status = PRODUCT_APPROVAL.MAPPED;
      itemChanges.unit = target.unit || item.unit;
      if (target.referencePrice !== null) itemChanges.reference_price = target.referencePrice;
      label = 'Ghép vào "' + target.productName + '"';
      if (unitChanges) {
        lineOnly.requested_quantity = convertedQty;
        if (item.approvedQuantity !== null && item.approvedQuantity > 0) lineOnly.approved_quantity = convertedQty;
        label += ' (quy đổi ' + item.requestedQuantity + ' ' + (item.unit || '?') + ' → ' + convertedQty + ' ' + (target.unit || '') + ')';
      }
    }
    updateRowFields_(SHEETS.VPP_PROPOSAL_ITEMS, item._row, item._record, Object.assign({}, itemChanges, lineOnly));
    // Dữ liệu cũ có thể có nhiều dòng (kể cả ở đề xuất khác) cùng trỏ vào sản phẩm chờ duyệt này → áp cùng kết quả,
    // để không còn dòng nào hiện nút "Xử lý sản phẩm mới" cho sản phẩm đã xử lý.
    var synced = syncPendingProposalLines_(product.productId, item.proposalItemId, itemChanges, now);
    var touched = [proposal.proposalId].concat(synced.filter(function (pid) { return pid !== proposal.proposalId; }));
    touched.forEach(function (pid) {
      refreshProposalEstimate_(pid, now); // giá / SL duyệt của dòng có thể đã đổi
      // Đề xuất đã duyệt mà dòng vừa bị từ chối sản phẩm (SL duyệt về 0) → trạng thái theo SL duyệt hiện tại (không còn "Đã duyệt"
      // với 0 sản phẩm, đánh dấu "đã mua" được, đếm vào "đã duyệt" trên tổng quan).
      refreshReviewedStatus_(pid, now, actorLabel_(actor));
    });
    proposalHistory_(proposal.proposalId, 'VPP_PROPOSAL_PRODUCT_DECISION', actorLabel_(actor), proposal.status, proposal.status,
      label + ': ' + (item.temporaryProductName || product.productName), { decision: decision, productId: product.productId, actor: actor });
    appendHistory_(product.productId, 'VPP_PRODUCT_DECISION', actorLabel_(actor), product.catalogStatus, decision,
      label + ' (đề xuất ' + proposal.proposalCode + ')' + (synced.length ? ' · áp dụng cho ' + synced.length + ' dòng đề xuất khác' : ''),
      null, 'VPP_PRODUCT');
    if (norm) {
      // Định mức kèm theo lưu TRONG CÙNG khóa với quyết định (không có khoảng hở cho thao tác khác chen vào).
      apiVppSaveNorm_({
        productId: product.productId, scopeId: norm.scopeId, scopeName: norm.scopeName, monthlyQuantity: norm.monthlyQuantity,
        unit: fields.unit, referencePrice: fields.referencePrice, note: norm.note || '', actor: data.actor
      });
    }
    invalidateCaches_();
    return { proposalRecord: found.record, productId: product.productId };
  });
  return proposalDetail_(requireProposal_(data.id).record);
}
