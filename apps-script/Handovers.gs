/**
 * Handovers.gs — nghiệp vụ biên bản bàn giao.
 *
 * Quy tắc an toàn dữ liệu:
 *   • Mọi thao tác ghi quan trọng chạy trong withScriptLock_ (LockService) và đọc lại dữ liệu
 *     mới nhất SAU khi giữ khóa → không trùng mã, không xác nhận 2 lần.
 *   • Token link xác nhận không bao giờ tới đây — chỉ nhận SHA-256(token).
 *   • Dữ liệu đầu vào được kiểm tra lại (không tin Worker / trình duyệt).
 */

// ============================================================================
// Kiểm tra dữ liệu đầu vào
// ============================================================================

function validateItem_(raw, index, errors) {
  raw = raw && typeof raw === 'object' ? raw : {};
  var prefix = 'items.' + index + '.';
  var item = { category: String(raw.category || '').trim().toUpperCase() };
  if (!/^[A-Z0-9_]{1,40}$/.test(item.category)) errors[prefix + 'category'] = 'Loại bàn giao không hợp lệ';

  ITEM_FIELDS.forEach(function (f) {
    var value = raw[f.key];
    if (f.kind === 'number') {
      if (value === null || value === undefined || value === '') {
        item[f.key] = null;
        return;
      }
      var n = Number(value);
      if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > LIMITS.MAX_QUANTITY) {
        errors[prefix + f.key] = 'Số lượng phải là số nguyên từ 1 đến ' + LIMITS.MAX_QUANTITY;
        item[f.key] = null;
        return;
      }
      item[f.key] = n;
      return;
    }
    var s = f.kind === 'textarea' ? cleanText_(value) : cleanLine_(value);
    if (s.length > f.max) errors[prefix + f.key] = 'Tối đa ' + f.max + ' ký tự';
    else if (f.kind === 'date' && s && !isValidDateOnly_(s)) errors[prefix + f.key] = 'Ngày không hợp lệ';
    else if (f.kind === 'url' && s && !isHttpUrl_(s)) errors[prefix + f.key] = 'Link phải bắt đầu bằng http:// hoặc https://';
    else if (f.kind !== 'date' && f.kind !== 'url' && containsPasswordLike_(s)) errors[prefix + f.key] = PASSWORD_MESSAGE_;
    item[f.key] = truncate_(s, f.max);
  });

  if (!item.itemName && !item.description) {
    // Gắn lỗi vào ô thực sự hiển thị: loại không có ô "Tên" (ví dụ "Khác") → ô nội dung.
    var category = getCategoryMap_()[item.category];
    var hasNameField = !category || category.fields.some(function (f) { return f.key === 'itemName'; });
    var key = prefix + (hasNameField ? 'itemName' : 'description');
    if (!errors[key]) errors[key] = 'Nhập tên hoặc nội dung bàn giao';
  }
  return item;
}

function validateHandoverInput_(data) {
  var errors = {};
  var sender = data.sender && typeof data.sender === 'object' ? data.sender : {};
  var senderName = cleanLine_(sender.name);
  var senderId = cleanLine_(sender.employeeId);
  var receiverId = cleanLine_(data.receiverEmployeeId);
  var note = cleanText_(data.note);

  if (!senderName) errors['sender.name'] = 'Nhập hoặc chọn người bàn giao';
  else if (senderName.length > LIMITS.PERSON_NAME) errors['sender.name'] = 'Tối đa ' + LIMITS.PERSON_NAME + ' ký tự';
  if (senderId.length > LIMITS.EMPLOYEE_ID) errors['sender.employeeId'] = 'Mã nhân viên không hợp lệ';
  if (!receiverId) errors.receiverEmployeeId = 'Chọn người nhận từ danh sách nhân viên';
  else if (receiverId.length > LIMITS.EMPLOYEE_ID) errors.receiverEmployeeId = 'Mã nhân viên không hợp lệ';
  if (note.length > LIMITS.HANDOVER_NOTE) errors.note = 'Tối đa ' + LIMITS.HANDOVER_NOTE + ' ký tự';
  else if (containsPasswordLike_(note)) errors.note = PASSWORD_MESSAGE_;

  var rawItems = Array.isArray(data.items) ? data.items : [];
  if (!rawItems.length) errors.items = 'Cần ít nhất 1 nội dung bàn giao';
  else if (rawItems.length > APP.MAX_ITEMS) errors.items = 'Tối đa ' + APP.MAX_ITEMS + ' nội dung trong một biên bản';
  var items = rawItems.slice(0, APP.MAX_ITEMS).map(function (raw, i) { return validateItem_(raw, i, errors); });

  if (Object.keys(errors).length) throw validationError_(errors);
  return { sender: { name: senderName, employeeId: senderId }, receiverEmployeeId: receiverId, note: note, items: items };
}

/** Áp dụng cấu hình LOAI_BAN_GIAO: trường bắt buộc + bỏ trường không thuộc loại. */
function applyCategoryRules_(items) {
  var categories = getCategoryMap_();
  var errors = {};
  items.forEach(function (item, i) {
    var cat = categories[item.category];
    if (!cat) {
      errors['items.' + i + '.category'] = 'Loại bàn giao "' + item.category + '" không tồn tại';
      return;
    }
    var allowed = {};
    cat.fields.forEach(function (f) {
      allowed[f.key] = true;
      var v = item[f.key];
      if (f.required && (v === null || v === undefined || String(v).trim() === '')) {
        errors['items.' + i + '.' + f.key] = f.label + ' là bắt buộc';
      }
    });
    ITEM_FIELDS.forEach(function (f) {
      if (!allowed[f.key]) item[f.key] = f.kind === 'number' ? null : '';
    });
    if (!item.itemName && !item.description) {
      var key = 'items.' + i + '.' + (allowed.itemName ? 'itemName' : 'description');
      if (!errors[key]) errors[key] = 'Nhập tên hoặc nội dung bàn giao';
    }
  });
  if (Object.keys(errors).length) throw validationError_(errors);
  return items;
}

/** Người nhận phải có trong NHAN_VIEN và đang ACTIVE. Người giao: chọn từ danh sách hoặc nhập tên. */
function resolveParticipants_(input) {
  var receiver = findEmployeeById_(input.receiverEmployeeId);
  if (!receiver || receiver.status !== 'ACTIVE') {
    throw appError_('EMPLOYEE_NOT_FOUND', 'Người nhận không tồn tại hoặc đã ngừng hoạt động.', {
      fieldErrors: { receiverEmployeeId: 'Người nhận không tồn tại hoặc đã ngừng hoạt động.' }
    });
  }
  var sender = { name: input.sender.name, employeeId: '' };
  if (input.sender.employeeId) {
    var emp = findEmployeeById_(input.sender.employeeId);
    if (!emp) {
      throw appError_('EMPLOYEE_NOT_FOUND', 'Người bàn giao không có trong danh sách nhân viên.', {
        fieldErrors: { 'sender.name': 'Người bàn giao không có trong danh sách nhân viên.' }
      });
    }
    sender = { name: emp.fullName, employeeId: emp.employeeId };
  }
  if (sender.employeeId && sender.employeeId.toUpperCase() === receiver.employeeId.toUpperCase()) {
    throw validationError_({ receiverEmployeeId: 'Người nhận phải khác người bàn giao' });
  }
  return { sender: sender, receiver: receiver };
}

function requireTokenHash_(value) {
  var hash = String(value || '').toLowerCase();
  if (!isHex64_(hash)) throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã hết hiệu lực.');
  return hash;
}

function requireNonce_(value) {
  var nonce = String(value || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(nonce)) throw appError_('BAD_REQUEST', 'Thiếu dữ liệu sinh link.');
  return nonce;
}

function requireHandoverId_(value) {
  var id = String(value || '').toLowerCase();
  if (!isUuid_(id)) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  return id;
}

// ============================================================================
// Ánh xạ dữ liệu Sheet ↔ API
// ============================================================================

function itemToRow_(handoverId, item, order, now) {
  return {
    item_id: uuid_(),
    handover_id: handoverId,
    item_order: order,
    category: item.category,
    item_name: item.itemName,
    asset_code: item.assetCode,
    serial_number: item.serialNumber,
    model: item.model,
    quantity: item.quantity === null || item.quantity === undefined ? '' : item.quantity,
    condition: item.condition,
    description: item.description,
    work_status: item.workStatus,
    deadline: item.deadline,
    document_url: item.documentUrl,
    note: item.note,
    created_at: now
  };
}

function normalizeDateOnly_(value) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return m ? m[1] : '';
}

function itemFromRow_(r) {
  var qty = String(r.quantity || '').trim();
  return {
    itemId: r.item_id,
    itemOrder: parseInt(r.item_order, 10) || 0,
    category: String(r.category || '').trim().toUpperCase(),
    itemName: r.item_name || '',
    assetCode: r.asset_code || '',
    serialNumber: r.serial_number || '',
    model: r.model || '',
    quantity: qty === '' || !isFinite(Number(qty)) ? null : Number(qty),
    condition: r.condition || '',
    description: r.description || '',
    workStatus: r.work_status || '',
    deadline: normalizeDateOnly_(r.deadline),
    documentUrl: r.document_url || '',
    note: r.note || ''
  };
}

function loadItems_(handoverId) {
  return findRows_(SHEETS.ITEMS, 'handover_id', handoverId)
    .map(function (m) { return itemFromRow_(m.record); })
    .sort(function (a, b) { return a.itemOrder - b.itemOrder; });
}

function loadHistory_(handoverId) {
  return findRows_(SHEETS.HISTORY, 'handover_id', handoverId)
    .map(function (m, index) {
      var r = m.record;
      return {
        logId: r.log_id,
        action: r.action,
        actor: r.actor,
        oldStatus: r.old_status,
        newStatus: r.new_status,
        message: r.message,
        createdAt: r.created_at,
        _order: index
      };
    })
    .sort(function (a, b) {
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a._order - b._order;
    })
    .map(function (h) {
      delete h._order;
      return h;
    });
}

function toPublicHandover_(rec, items) {
  return {
    code: rec.handover_code,
    status: rec.status,
    createdAt: rec.created_at,
    updatedAt: rec.updated_at,
    confirmedAt: rec.confirmed_at || '',
    revisionRequestedAt: rec.revision_requested_at || '',
    cancelledAt: rec.cancelled_at || '',
    cancelReason: rec.cancel_reason || '',
    receiverComment: rec.receiver_comment || '',
    note: rec.note || '',
    sender: { name: rec.sender_name, employeeId: rec.sender_employee_id || '' },
    receiver: {
      employeeId: rec.receiver_employee_id,
      name: rec.receiver_name,
      department: rec.receiver_department || '',
      position: rec.receiver_position || '',
      email: rec.receiver_email || ''
    },
    items: items,
    hasPdf: Boolean(rec.pdf_file_id)
  };
}

function toAdminHandover_(rec, items, history) {
  var view = toPublicHandover_(rec, items);
  view.id = rec.handover_id;
  view.signatureAvailable = Boolean(rec.signature_file_id);
  view.pdfAvailable = Boolean(rec.pdf_file_id);
  view.confirmedUserAgent = rec.user_agent || '';
  view.history = history;
  // Worker dùng hash + nonce để dựng lại link rồi loại bỏ trước khi trả về trình duyệt.
  view.tokenHash = rec.public_token_hash || '';
  view.tokenNonce = rec.public_token_nonce || '';
  return view;
}

function findHandoverByTokenHash_(tokenHash) {
  return findRow_(SHEETS.HANDOVERS, 'public_token_hash', tokenHash);
}

function findHandoverById_(id) {
  return findRow_(SHEETS.HANDOVERS, 'handover_id', id);
}

function appendHistory_(handoverId, action, actor, oldStatus, newStatus, message, metadata) {
  appendObjects_(SHEETS.HISTORY, [{
    log_id: uuid_(),
    handover_id: handoverId,
    action: action,
    actor: truncate_(actor || '', 150),
    old_status: oldStatus || '',
    new_status: newStatus || '',
    message: truncate_(message || '', 2000),
    created_at: nowIso_(),
    metadata: metadata ? safeJson_(metadata, 45000) : ''
  }]);
}

// ============================================================================
// Sinh mã biên bản BG-YYYYMMDD-XXXX (gọi bên trong khóa)
// ============================================================================

function maxSequenceForPrefix_(prefix) {
  var sheet = getSheet_(SHEETS.HANDOVERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var cells = sheet.getRange(2, columnIndex_(sheet, 'handover_code'), lastRow - 1, 1)
    .createTextFinder(prefix)
    .matchCase(true)
    .findAll();
  var max = 0;
  (cells || []).forEach(function (cell) {
    var value = cellToString_(cell.getValue());
    if (value.indexOf(prefix) === 0) {
      var n = parseInt(value.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  });
  return max;
}

function nextHandoverCode_() {
  if (LOCK_DEPTH_ < 1) throw appError_('INTERNAL', 'nextHandoverCode_ phải chạy trong khóa.');
  var day = todayKey_();
  var prefix = APP.CODE_PREFIX + '-' + day + '-';
  var stored = getProp_(PROP.HANDOVER_SEQ).split(':');
  var fromProp = stored[0] === day ? parseInt(stored[1], 10) || 0 : 0;
  // Đối chiếu với dữ liệu thật trong Sheet (phòng khi property bị xóa) → không bao giờ trùng mã.
  var seq = Math.max(fromProp, maxSequenceForPrefix_(prefix)) + 1;
  setProp_(PROP.HANDOVER_SEQ, day + ':' + seq);
  return prefix + pad_(seq, 4);
}

// ============================================================================
// Public API
// ============================================================================

function apiCreateHandover_(data) {
  var input = validateHandoverInput_(data);
  var tokenHash = requireTokenHash_(data.tokenHash);
  var tokenNonce = requireNonce_(data.tokenNonce);
  var client = sanitizeClient_(data.client);
  enforceRateLimit_('create', client.ipHash, 60, 3600);

  var people = resolveParticipants_(input);
  var items = applyCategoryRules_(input.items);

  var created = withScriptLock_(function () {
    var now = nowIso_();
    var id = uuid_();
    var code = nextHandoverCode_();
    var receiver = people.receiver;
    appendObjects_(SHEETS.HANDOVERS, [{
      handover_id: id,
      handover_code: code,
      sender_name: people.sender.name,
      sender_employee_id: people.sender.employeeId,
      receiver_employee_id: receiver.employeeId,
      receiver_name: receiver.fullName,
      receiver_department: receiver.department,
      receiver_position: receiver.position,
      receiver_email: receiver.email,
      status: STATUS.PENDING,
      public_token_hash: tokenHash,
      created_at: now,
      updated_at: now,
      created_ip_hash: client.ipHash,
      note: input.note,
      public_token_nonce: tokenNonce
    }]);
    appendObjects_(SHEETS.ITEMS, items.map(function (item, i) { return itemToRow_(id, item, i + 1, now); }));
    appendHistory_(id, 'CREATED', people.sender.name, '', STATUS.PENDING,
      'Tạo biên bản ' + code + ' gồm ' + items.length + ' nội dung.',
      { ipHash: client.ipHash, userAgent: client.userAgent, itemCount: items.length });
    return { id: id, code: code, createdAt: now };
  });

  logInfo_('handover.created', { code: created.code, items: items.length });
  return {
    id: created.id,
    code: created.code,
    status: STATUS.PENDING,
    createdAt: created.createdAt,
    receiver: {
      employeeId: people.receiver.employeeId,
      name: people.receiver.fullName,
      department: people.receiver.department,
      position: people.receiver.position,
      email: people.receiver.email
    }
  };
}

function apiGetHandoverByToken_(data) {
  var client = sanitizeClient_(data.client);
  if (isLookupBlocked_(client.ipHash)) {
    throw appError_('RATE_LIMITED', 'Bạn đã mở quá nhiều link không hợp lệ. Vui lòng thử lại sau ít phút.');
  }
  var tokenHash = requireTokenHash_(data.tokenHash);
  var found = findHandoverByTokenHash_(tokenHash);
  if (!found) {
    registerLookupMiss_(client.ipHash);
    throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
  }
  return {
    handover: toPublicHandover_(found.record, loadItems_(found.record.handover_id)),
    categories: getCategories_()
  };
}

/** Trạng thái không cho phép thao tác → lỗi thân thiện. */
function assertPending_(rec) {
  if (rec.status === STATUS.PENDING) return;
  if (rec.status === STATUS.CONFIRMED) {
    throw appError_('ALREADY_CONFIRMED', 'Biên bản đã được xác nhận lúc ' + formatDisplayDateTime_(rec.confirmed_at) + '.', {
      confirmedAt: rec.confirmed_at
    });
  }
  if (rec.status === STATUS.CANCELLED) throw appError_('INVALID_STATE', 'Biên bản đã bị hủy.');
  if (rec.status === STATUS.REVISION_REQUESTED) {
    throw appError_('INVALID_STATE', 'Bạn đã gửi yêu cầu chỉnh sửa. Vui lòng chờ người bàn giao cập nhật biên bản.');
  }
  throw appError_('INVALID_STATE', 'Trạng thái biên bản không hợp lệ.');
}

function apiConfirmHandover_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  if (data.agreed !== true) {
    throw validationError_({ agreed: 'Bạn cần tích xác nhận đã kiểm tra và nhận đủ các nội dung bàn giao' });
  }
  var comment = cleanText_(data.comment);
  if (comment.length > LIMITS.RECEIVER_COMMENT) throw validationError_({ comment: 'Tối đa ' + LIMITS.RECEIVER_COMMENT + ' ký tự' });
  var signatureBytes = decodeSignaturePng_(data.signatureBase64);
  var client = sanitizeClient_(data.client);
  enforceRateLimit_('confirm', tokenHash.slice(0, 32), 10, 600);

  var result = withScriptLock_(function () {
    var found = findHandoverByTokenHash_(tokenHash);
    if (!found) throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
    var rec = found.record;
    assertPending_(rec);

    var now = nowIso_();
    var file = saveSignatureFile_(rec.handover_code, signatureBytes, now);
    var changes = {
      status: STATUS.CONFIRMED,
      confirmed_at: now,
      updated_at: now,
      signature_file_id: file.id,
      signature_file_url: file.url,
      confirmed_ip_hash: client.ipHash,
      user_agent: client.userAgent,
      receiver_comment: comment
    };
    try {
      updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
      appendHistory_(rec.handover_id, 'CONFIRMED', rec.receiver_name, rec.status, STATUS.CONFIRMED,
        comment ? 'Người nhận ký xác nhận. Ghi chú: ' + comment : 'Người nhận ký xác nhận.',
        { ipHash: client.ipHash, userAgent: client.userAgent, signatureFileId: file.id });
    } catch (e) {
      trashFileQuietly_(file.id); // không để lại file chữ ký mồ côi
      throw e;
    }
    return Object.assign({}, rec, changes);
  });

  logInfo_('handover.confirmed', { code: result.handover_code });
  return { id: result.handover_id, handover: toPublicHandover_(result, loadItems_(result.handover_id)) };
}

function apiRequestRevision_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  var reason = cleanText_(data.reason);
  if (reason.length < LIMITS.REVISION_MIN) {
    throw validationError_({ reason: 'Vui lòng nhập lý do / nội dung cần sửa (ít nhất ' + LIMITS.REVISION_MIN + ' ký tự)' });
  }
  if (reason.length > LIMITS.RECEIVER_COMMENT) throw validationError_({ reason: 'Tối đa ' + LIMITS.RECEIVER_COMMENT + ' ký tự' });
  var client = sanitizeClient_(data.client);
  enforceRateLimit_('revision', tokenHash.slice(0, 32), 10, 600);

  var result = withScriptLock_(function () {
    var found = findHandoverByTokenHash_(tokenHash);
    if (!found) throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
    var rec = found.record;
    assertPending_(rec);
    var now = nowIso_();
    var changes = {
      status: STATUS.REVISION_REQUESTED,
      revision_requested_at: now,
      updated_at: now,
      receiver_comment: reason
    };
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    appendHistory_(rec.handover_id, 'REVISION_REQUESTED', rec.receiver_name, rec.status, STATUS.REVISION_REQUESTED, reason,
      { ipHash: client.ipHash, userAgent: client.userAgent });
    return Object.assign({}, rec, changes);
  });

  return { id: result.handover_id, handover: toPublicHandover_(result, loadItems_(result.handover_id)) };
}

function apiGetPdfByToken_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  var client = sanitizeClient_(data.client);
  enforceRateLimit_('pdf', tokenHash.slice(0, 32), 20, 600);
  var found = findHandoverByTokenHash_(tokenHash);
  if (!found) {
    registerLookupMiss_(client.ipHash);
    throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
  }
  if (found.record.status !== STATUS.CONFIRMED) {
    throw appError_('INVALID_STATE', 'Chỉ tải được PDF sau khi biên bản đã được xác nhận.');
  }
  return readDriveFile_(ensurePdf_(found.record.handover_id, false), found.record.handover_code + '.pdf');
}

/** Gọi nền từ Worker (ctx.waitUntil) ngay sau khi xác nhận. */
function apiGeneratePdf_(data) {
  var id = requireHandoverId_(data.id);
  ensurePdf_(id, false);
  return { pdfAvailable: true };
}

// ============================================================================
// Admin API
// ============================================================================

function summarizeItems_() {
  var sheet = getSheet_(SHEETS.ITEMS);
  var handoverIds = readColumn_(sheet, 'handover_id');
  var categories = readColumn_(sheet, 'category');
  var out = {};
  for (var i = 0; i < handoverIds.length; i++) {
    var hid = handoverIds[i];
    if (!hid) continue;
    var info = out[hid] || (out[hid] = { count: 0, categories: {} });
    info.count++;
    var cat = String(categories[i] || '').trim().toUpperCase();
    if (cat) info.categories[cat] = true;
  }
  return out;
}

function containsNormalized_(values, needle) {
  for (var i = 0; i < values.length; i++) {
    if (normalizeText_(values[i]).indexOf(needle) >= 0) return true;
  }
  return false;
}

function matchesFilters_(h, info, f) {
  if (f.status && h.status !== f.status) return false;
  var createdDay = String(h.created_at || '').slice(0, 10);
  if (f.from && createdDay < f.from) return false;
  if (f.to && createdDay > f.to) return false;
  if (f.code && normalizeText_(h.handover_code).indexOf(f.code) < 0) return false;
  if (f.department && normalizeText_(h.receiver_department) !== f.department) return false;
  if (f.category && !(info && info.categories[f.category])) return false;
  if (f.sender && !containsNormalized_([h.sender_name, h.sender_employee_id], f.sender)) return false;
  if (f.receiver && !containsNormalized_([h.receiver_name, h.receiver_employee_id], f.receiver)) return false;
  if (f.employeeName && !containsNormalized_([h.sender_name, h.receiver_name], f.employeeName)) return false;
  if (f.employeeId && !containsNormalized_([h.sender_employee_id, h.receiver_employee_id], f.employeeId)) return false;
  return true;
}

function apiAdminListHandovers_(q) {
  var filters = {
    page: clampInt_(q.page, 1, 100000, 1),
    pageSize: clampInt_(q.pageSize, 5, 100, 20),
    code: normalizeText_(q.code),
    employeeName: normalizeText_(q.employeeName),
    employeeId: normalizeText_(q.employeeId),
    sender: normalizeText_(q.sender),
    receiver: normalizeText_(q.receiver),
    department: normalizeText_(q.department),
    category: String(q.category || '').trim().toUpperCase(),
    status: STATUS[q.status] ? q.status : '',
    from: isValidDateOnly_(q.from) ? q.from : '',
    to: isValidDateOnly_(q.to) ? q.to : ''
  };

  var handovers = readTable_(SHEETS.HANDOVERS).rows;
  var itemInfo = summarizeItems_();
  var stats = { total: 0, PENDING: 0, CONFIRMED: 0, REVISION_REQUESTED: 0, CANCELLED: 0 };
  var departments = {};
  var matched = [];
  handovers.forEach(function (h) {
    if (!h.handover_id) return;
    stats.total++;
    if (stats[h.status] !== undefined) stats[h.status]++;
    if (h.receiver_department) departments[h.receiver_department] = true;
    if (matchesFilters_(h, itemInfo[h.handover_id], filters)) matched.push(h);
  });
  matched.sort(function (a, b) {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.handover_code < b.handover_code ? 1 : -1;
  });

  var start = (filters.page - 1) * filters.pageSize;
  return {
    items: matched.slice(start, start + filters.pageSize).map(function (h) {
      var info = itemInfo[h.handover_id] || { count: 0, categories: {} };
      return {
        id: h.handover_id,
        code: h.handover_code,
        status: h.status,
        createdAt: h.created_at,
        updatedAt: h.updated_at,
        confirmedAt: h.confirmed_at || '',
        senderName: h.sender_name,
        senderEmployeeId: h.sender_employee_id || '',
        receiverEmployeeId: h.receiver_employee_id,
        receiverName: h.receiver_name,
        receiverDepartment: h.receiver_department || '',
        itemCount: info.count,
        categories: Object.keys(info.categories)
      };
    }),
    total: matched.length,
    page: filters.page,
    pageSize: filters.pageSize,
    stats: stats,
    departments: Object.keys(departments).sort(compareVi_)
  };
}

function buildAdminDetail_(rec) {
  return {
    handover: toAdminHandover_(rec, loadItems_(rec.handover_id), loadHistory_(rec.handover_id)),
    categories: getCategories_()
  };
}

function apiAdminGetHandover_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  return buildAdminDetail_(found.record);
}

/** Thay toàn bộ nội dung bàn giao: ghi bản mới trước rồi mới xóa bản cũ. */
function replaceItems_(handoverId, items, now) {
  var oldRows = findRows_(SHEETS.ITEMS, 'handover_id', handoverId).map(function (m) { return m.rowIndex; });
  appendObjects_(SHEETS.ITEMS, items.map(function (item, i) { return itemToRow_(handoverId, item, i + 1, now); }));
  deleteRowNumbers_(SHEETS.ITEMS, oldRows);
}

function apiAdminUpdateHandover_(data) {
  var id = requireHandoverId_(data.id);
  var input = validateHandoverInput_(data);
  var candidateHash = requireTokenHash_(data.candidateTokenHash);
  var candidateNonce = requireNonce_(data.candidateTokenNonce);
  var client = sanitizeClient_(data.client);
  var people = resolveParticipants_(input);
  var items = applyCategoryRules_(input.items);

  var outcome = withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    if (rec.status !== STATUS.PENDING && rec.status !== STATUS.REVISION_REQUESTED) {
      throw appError_('INVALID_STATE', 'Chỉ sửa được biên bản đang "Chờ xác nhận" hoặc "Yêu cầu chỉnh sửa".');
    }
    var previousItems = loadItems_(id);
    var now = nowIso_();
    var receiver = people.receiver;
    var receiverChanged = String(rec.receiver_employee_id).toUpperCase() !== receiver.employeeId.toUpperCase();
    var changes = {
      sender_name: people.sender.name,
      sender_employee_id: people.sender.employeeId,
      receiver_employee_id: receiver.employeeId,
      receiver_name: receiver.fullName,
      receiver_department: receiver.department,
      receiver_position: receiver.position,
      receiver_email: receiver.email,
      note: input.note,
      status: STATUS.PENDING,
      updated_at: now
    };
    if (receiverChanged) {
      // Đổi người nhận → vô hiệu link cũ (đã gửi cho người nhận trước).
      changes.public_token_hash = candidateHash;
      changes.public_token_nonce = candidateNonce;
    }
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    replaceItems_(id, items, now);
    appendHistory_(id, 'UPDATED', 'Quản trị viên', rec.status, STATUS.PENDING,
      'Cập nhật biên bản (' + previousItems.length + ' → ' + items.length + ' nội dung)' +
        (receiverChanged ? '. Đổi người nhận: ' + rec.receiver_name + ' → ' + receiver.fullName + ', đã cấp link mới.' : '.'),
      { ipHash: client.ipHash, receiverChanged: receiverChanged, previousNote: rec.note, previousItems: previousItems });
    return { record: Object.assign({}, rec, changes), linkRotated: receiverChanged };
  });

  var detail = buildAdminDetail_(outcome.record);
  detail.linkRotated = outcome.linkRotated;
  return detail;
}

function apiAdminCancelHandover_(data) {
  var id = requireHandoverId_(data.id);
  var reason = cleanText_(data.reason);
  if (reason.length > LIMITS.CANCEL_REASON) throw validationError_({ reason: 'Tối đa ' + LIMITS.CANCEL_REASON + ' ký tự' });
  var client = sanitizeClient_(data.client);

  var record = withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    if (rec.status === STATUS.CONFIRMED) {
      throw appError_('INVALID_STATE', 'Biên bản đã xác nhận không thể hủy. Hãy lập biên bản mới để ghi nhận thay đổi.');
    }
    if (rec.status === STATUS.CANCELLED) throw appError_('INVALID_STATE', 'Biên bản đã bị hủy trước đó.');
    var now = nowIso_();
    var changes = { status: STATUS.CANCELLED, cancelled_at: now, cancel_reason: reason, updated_at: now };
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    appendHistory_(id, 'CANCELLED', 'Quản trị viên', rec.status, STATUS.CANCELLED, reason || 'Hủy biên bản.', { ipHash: client.ipHash });
    return Object.assign({}, rec, changes);
  });
  return buildAdminDetail_(record);
}

function apiAdminRegenerateLink_(data) {
  var id = requireHandoverId_(data.id);
  var tokenHash = requireTokenHash_(data.tokenHash);
  var tokenNonce = requireNonce_(data.tokenNonce);
  var client = sanitizeClient_(data.client);
  return withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    if (rec.status === STATUS.CANCELLED) throw appError_('INVALID_STATE', 'Biên bản đã bị hủy.');
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, {
      public_token_hash: tokenHash,
      public_token_nonce: tokenNonce,
      updated_at: nowIso_()
    });
    appendHistory_(id, 'LINK_REGENERATED', 'Quản trị viên', rec.status, rec.status, 'Cấp link xác nhận mới; link cũ hết hiệu lực.',
      { ipHash: client.ipHash });
    return { code: rec.handover_code };
  });
}

function apiAdminGetSignature_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  if (!found.record.signature_file_id) throw appError_('NOT_FOUND', 'Biên bản chưa có chữ ký.');
  return readDriveFile_(found.record.signature_file_id, found.record.handover_code + '-signature.png');
}

function apiAdminGetPdf_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  return readDriveFile_(ensurePdf_(found.record.handover_id, false), found.record.handover_code + '.pdf');
}

function apiAdminGeneratePdf_(data) {
  ensurePdf_(requireHandoverId_(data.id), data.force === true);
  return { pdfAvailable: true };
}
