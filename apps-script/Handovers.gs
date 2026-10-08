/**
 * Handovers.gs — nghiệp vụ biên bản bàn giao.
 *
 * Quy tắc an toàn dữ liệu:
 *   • Mọi thao tác ghi quan trọng chạy trong withScriptLock_ (LockService) và đọc lại dữ liệu
 *     mới nhất SAU khi giữ khóa → không trùng mã, không xác nhận 2 lần, không bán vượt tồn.
 *   • Token link xác nhận không bao giờ tới đây — chỉ nhận SHA-256(token).
 *   • Dữ liệu đầu vào được kiểm tra lại (không tin Worker / trình duyệt).
 *   • Chữ ký gắn với đúng nội dung người nhận đã xem: content_hash (SHA-256 nội dung chuẩn hóa) phải khớp
 *     khi ký; được lưu lại lúc ký và in lên PDF để phát hiện dữ liệu bị sửa sau này. record_hash phủ TOÀN BỘ biên bản đã ký
 *     (nội dung + ý kiến người nhận + thời điểm lập / ký + chữ ký); record_seal = HMAC của record_hash bằng khóa do Worker gửi
 *     kèm (không lưu ở Apps Script / Sheet) — người sửa được Sheet cũng không tự tính lại được.
 *   • Không xóa dòng theo số dòng: sửa phiếu = thêm dòng nội dung mới (phiên bản mới, chưa hiện) → chốt phiên bản trên dòng
 *     phiếu (items_revision) → đánh dấu dòng cũ superseded_at. Lỗi giữa chừng không bao giờ để lộ nội dung lẫn cũ / mới.
 *   • Chỉ quản trị viên tạo / sửa / hủy phiếu (scope "admin" của Worker).
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

/** Một dòng văn phòng phẩm: sản phẩm trong kho + số lượng (tên / ĐVT lấy từ danh mục, không tin trình duyệt). */
function validateSupplyLine_(raw, index, errors) {
  raw = raw && typeof raw === 'object' ? raw : {};
  var prefix = 'supplies.' + index + '.';
  var productId = String(raw.productId || '').trim().toLowerCase();
  if (!isUuid_(productId)) errors[prefix + 'productId'] = 'Chọn văn phòng phẩm';
  var q = Number(raw.quantity);
  if (!isFinite(q) || Math.floor(q) !== q || q < 1 || q > LIMITS.MAX_QUANTITY) {
    errors[prefix + 'quantity'] = 'Số lượng phải là số nguyên từ 1 đến ' + LIMITS.MAX_QUANTITY;
    q = 0;
  }
  var note = cleanText_(raw.note);
  if (note.length > 1000) errors[prefix + 'note'] = 'Tối đa 1000 ký tự';
  else if (containsPasswordLike_(note)) errors[prefix + 'note'] = PASSWORD_MESSAGE_;
  var reason = cleanText_(raw.overNormReason);
  if (reason.length > LIMITS.OVER_NORM_REASON) errors[prefix + 'overNormReason'] = 'Tối đa ' + LIMITS.OVER_NORM_REASON + ' ký tự';
  return { productId: productId, quantity: q, note: truncate_(note, 1000), overNormReason: truncate_(reason, LIMITS.OVER_NORM_REASON) };
}

function validateHandoverInput_(data) {
  var errors = {};
  var type = String(data.handoverType || '').trim().toUpperCase();
  if (!HANDOVER_TYPES[type]) errors.handoverType = 'Chọn loại phiếu bàn giao';
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
  var rawSupplies = Array.isArray(data.supplies) ? data.supplies : [];
  var items = [];
  var supplies = [];
  if (type === 'OFFICE_SUPPLY') {
    if (rawItems.length) errors.items = 'Phiếu văn phòng phẩm chỉ gồm sản phẩm chọn từ kho.';
    if (!rawSupplies.length) errors.supplies = 'Chọn ít nhất 1 văn phòng phẩm';
    else if (rawSupplies.length > APP.MAX_ITEMS) errors.supplies = 'Tối đa ' + APP.MAX_ITEMS + ' sản phẩm trong một phiếu';
    var seen = {};
    supplies = rawSupplies.slice(0, APP.MAX_ITEMS).map(function (raw, i) {
      var line = validateSupplyLine_(raw, i, errors);
      if (line.productId && seen[line.productId]) {
        errors['supplies.' + i + '.productId'] = 'Sản phẩm bị trùng — hãy gộp số lượng vào một dòng';
      }
      seen[line.productId] = true;
      return line;
    });
  } else {
    if (rawSupplies.length) errors.supplies = 'Chỉ phiếu Văn phòng phẩm mới chọn sản phẩm trong kho.';
    if (!rawItems.length) errors.items = 'Cần ít nhất 1 nội dung bàn giao';
    else if (rawItems.length > APP.MAX_ITEMS) errors.items = 'Tối đa ' + APP.MAX_ITEMS + ' nội dung trong một biên bản';
    items = rawItems.slice(0, APP.MAX_ITEMS).map(function (raw, i) { return validateItem_(raw, i, errors); });
  }

  if (Object.keys(errors).length) throw validationError_(errors);
  return {
    handoverType: type,
    sender: { name: senderName, employeeId: senderId },
    receiverEmployeeId: receiverId,
    note: note,
    items: items,
    supplies: supplies
  };
}

/**
 * Áp dụng cấu hình LOAI_BAN_GIAO: loại phải đang dùng (trừ loại đã có sẵn trong phiếu khi sửa), thuộc đúng loại phiếu,
 * đủ trường bắt buộc; bỏ trường không thuộc loại. Văn phòng phẩm không được nhập tay (chỉ qua phiếu OFFICE_SUPPLY).
 */
function applyCategoryRules_(items, handoverType, allowInactive) {
  var categories = getCategoryMap_();
  var errors = {};
  items.forEach(function (item, i) {
    var cat = categories[item.category];
    var key = 'items.' + i + '.category';
    if (!cat) {
      errors[key] = 'Loại bàn giao "' + item.category + '" không tồn tại';
      return;
    }
    if (cat.handoverType === 'OFFICE_SUPPLY' || item.category === VPP_CATEGORY_CODE) {
      errors[key] = 'Văn phòng phẩm phải tạo bằng phiếu "Văn phòng phẩm" (chọn sản phẩm từ kho).';
      return;
    }
    if (!cat.active && !(allowInactive && allowInactive[item.category])) {
      errors[key] = 'Loại bàn giao "' + cat.name + '" đã ngừng sử dụng';
      return;
    }
    if (handoverType !== 'OTHER' && cat.handoverType !== handoverType) {
      errors[key] = 'Loại "' + cat.name + '" không thuộc phiếu ' + (HANDOVER_TYPES[handoverType] || handoverType);
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
      var k = 'items.' + i + '.' + (allowed.itemName ? 'itemName' : 'description');
      if (!errors[k]) errors[k] = 'Nhập tên hoặc nội dung bàn giao';
    }
    item.productId = '';
    item.affectsInventory = false;
    item.overNormReason = '';
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

/** Mã chống gửi trùng do trình duyệt sinh (UUID). Không có → ''. */
function optionalRequestId_(value) {
  var id = String(value || '').trim().toLowerCase();
  return isUuid_(id) ? id : '';
}

function requireContentHash_(value) {
  var hash = String(value || '').toLowerCase();
  if (!isHex64_(hash)) {
    throw appError_('CONFLICT', 'Trang biên bản đã cũ. Vui lòng tải lại trang để xem nội dung mới nhất trước khi thao tác.', {
      contentChanged: true
    });
  }
  return hash;
}

// ============================================================================
// Ánh xạ dữ liệu Sheet ↔ API
// ============================================================================

/** revision: phiên bản nội dung (BAN_GIAO.items_revision chốt phiên bản đang hiệu lực). */
function itemToRow_(handoverId, item, order, now, revision) {
  return {
    item_id: uuid_(),
    revision_id: revision || '',
    handover_id: handoverId,
    item_order: order,
    category: item.category,
    item_name: item.itemName,
    asset_code: item.assetCode,
    serial_number: item.serialNumber,
    model: item.model,
    quantity: item.quantity === null || item.quantity === undefined ? '' : item.quantity,
    unit: item.unit || '',
    condition: item.condition,
    description: item.description,
    work_status: item.workStatus,
    deadline: item.deadline,
    document_url: item.documentUrl,
    note: item.note,
    created_at: now,
    product_id: item.productId || '',
    affects_inventory: item.affectsInventory ? 'TRUE' : '',
    over_norm_reason: item.overNormReason || ''
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
    unit: r.unit || '',
    condition: r.condition || '',
    description: r.description || '',
    workStatus: r.work_status || '',
    deadline: normalizeDateOnly_(r.deadline),
    documentUrl: r.document_url || '',
    note: r.note || '',
    productId: String(r.product_id || '').toLowerCase(),
    affectsInventory: toBool_(r.affects_inventory),
    overNormReason: r.over_norm_reason || ''
  };
}

/**
 * Dòng nội dung thuộc phiên bản ĐÃ CHỐT của phiếu? Phiếu có phiên bản (items_revision) → chỉ dòng cùng phiên bản; phiếu tạo
 * trước khi có phiên bản → dòng không có phiên bản. Dòng của lần sửa chưa chốt (lỗi giữa chừng) không bao giờ được tính.
 */
function isCommittedItemRow_(row, itemsRevision) {
  if (row.superseded_at) return false;
  var revision = String(row.revision_id || '');
  return itemsRevision ? revision === String(itemsRevision) : revision === '';
}

/** handover_id → items_revision của mọi phiếu có phiên bản (cho các chỗ đọc cả sheet nội dung). */
function committedRevisionMap_() {
  var map = {};
  readColumns_(SHEETS.HANDOVERS, ['handover_id', 'items_revision']).forEach(function (h) {
    if (h.handover_id && h.items_revision) map[h.handover_id] = h.items_revision;
  });
  return map;
}

/** Nội dung hiện hành của phiếu: phiên bản đã chốt, theo thứ tự. rec: dòng BAN_GIAO của phiếu (không truyền → tự tìm). */
function loadItems_(handoverId, rec) {
  if (!rec) {
    var found = findHandoverById_(handoverId);
    rec = found ? found.record : {};
  }
  var revision = String(rec.items_revision || '');
  return findRows_(SHEETS.ITEMS, 'handover_id', handoverId)
    .filter(function (m) { return isCommittedItemRow_(m.record, revision); })
    .map(function (m) { return itemFromRow_(m.record); })
    .sort(function (a, b) { return a.itemOrder - b.itemOrder; });
}

function loadHistory_(handoverId) {
  return findRows_(SHEETS.HISTORY, 'handover_id', handoverId)
    .filter(function (m) { return !m.record.entity_type || m.record.entity_type === 'HANDOVER'; })
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

/** Loại phiếu: cột handover_type; phiếu cũ (v1) → suy ra từ loại nội dung (một loại duy nhất) hoặc OTHER. */
function effectiveHandoverType_(rec, items) {
  var stored = String(rec.handover_type || '').trim().toUpperCase();
  if (HANDOVER_TYPES[stored]) return stored;
  var categories = getCategoryMap_();
  var types = {};
  (items || []).forEach(function (i) {
    var c = categories[i.category];
    types[c ? c.handoverType : 'OTHER'] = true;
  });
  var keys = Object.keys(types);
  return keys.length === 1 ? keys[0] : 'OTHER';
}

/**
 * Nội dung chuẩn hóa dùng để băm: mọi thứ người nhận nhìn thấy và ký (mã, loại, hai bên, ghi chú, từng nội dung theo
 * thứ tự). Đổi bất kỳ giá trị nào → hash đổi.
 */
function canonicalHandover_(rec, items) {
  return {
    v: 1,
    code: rec.handover_code || '',
    type: String(rec.handover_type || ''),
    sender: [rec.sender_name || '', rec.sender_employee_id || ''],
    receiver: [
      rec.receiver_employee_id || '', rec.receiver_name || '', rec.receiver_department || '',
      rec.receiver_position || '', rec.receiver_email || ''
    ],
    note: rec.note || '',
    items: (items || []).map(canonicalItem_)
  };
}

/** Một dòng nội dung ở dạng chuẩn để băm — dùng chung cho mã băm nội dung và dấu vân tay yêu cầu tạo phiếu. */
function canonicalItem_(i) {
  return [
    i.category, i.productId || '', i.itemName, i.assetCode, i.serialNumber, i.model,
    i.quantity === null || i.quantity === undefined ? '' : String(i.quantity), i.unit || '', i.condition,
    i.description, i.workStatus, i.deadline, i.documentUrl, i.note
  ];
}

function computeContentHash_(rec, items) {
  return sha256Hex_(JSON.stringify(canonicalHandover_(rec, items)));
}

/**
 * Dấu vân tay NỘI DUNG của một yêu cầu tạo phiếu (loại, hai bên, ghi chú, từng dòng — không gồm mã phiếu / thời điểm): gửi lại
 * cùng clientRequestId phải đúng nội dung đó. items: dòng đã kiểm tra (chưa ghi) hoặc dòng đọc từ Sheet — cùng đi qua một
 * lượt ghi / đọc dòng để so được với nhau.
 */
function createRequestFingerprint_(type, sender, receiverEmployeeId, note, items) {
  var normalized = (items || []).map(function (item, i) { return itemFromRow_(itemToRow_('', item, i + 1, '', '')); });
  return sha256Hex_(JSON.stringify({
    t: String(type || ''),
    s: [sender.name || '', sender.employeeId || ''],
    r: String(receiverEmployeeId || '').toUpperCase(),
    n: note || '',
    i: normalized.map(canonicalItem_)
  }));
}

/**
 * TOÀN BỘ biên bản đã ký (đúng những gì PDF chứng nhận): nội dung (content_hash) + thời điểm lập / ký + ý kiến người nhận +
 * cách xác thực + chữ ký (mã băm ảnh + file). Sửa bất kỳ giá trị nào trên Sheet sau khi ký → record_hash đổi.
 */
function computeRecordHash_(rec) {
  return sha256Hex_(JSON.stringify({
    v: 1,
    id: rec.handover_id || '',
    code: rec.handover_code || '',
    createdAt: rec.created_at || '',
    contentHash: rec.content_hash || '',
    confirmedAt: rec.confirmed_at || '',
    comment: rec.receiver_comment || '',
    method: rec.confirm_method || '',
    signatureSha256: rec.signature_sha256 || '',
    signatureFileId: rec.signature_file_id || ''
  }));
}

/**
 * Khóa niêm phong do Worker gửi kèm (HMAC từ RECORD_SEAL_SECRET của Cloudflare): KHÔNG lưu ở Apps Script / Sheet nên người sửa được
 * Sheet (kể cả xem được Script Properties) không tự tính lại được niêm phong. '' = Worker không gửi (chưa cấu hình).
 */
function sealKeyOf_(data) {
  var key = String((data && data.sealKey) || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(key) ? key : '';
}

function recordSeal_(recordHash, sealKey) {
  return sealKey ? hmacHex_('dta-record-seal-v1:' + recordHash, sealKey) : '';
}

/**
 * Toàn vẹn của biên bản đã ký — so dữ liệu HIỆN TẠI với lúc ký:
 *   content: nội dung (content_hash) · record: toàn biên bản (record_hash; null = ký trước khi có mã này)
 *   seal: OK / MISMATCH / UNVERIFIED (có niêm phong nhưng request không kèm khóa) / NONE (ký khi chưa cấu hình khóa)
 * Niêm phong được tính lại từ dữ liệu hiện tại (không tin record_hash lưu trên Sheet).
 */
function integrityOf_(rec, items, sealKey) {
  if (rec.status !== STATUS.CONFIRMED) return { status: 'NOT_SIGNED', contentHash: '', signatureSha256: '', checks: null };
  if (!rec.content_hash) return { status: 'LEGACY', contentHash: '', signatureSha256: rec.signature_sha256 || '', checks: null };
  var content = computeContentHash_(rec, items) === rec.content_hash;
  var recordHash = computeRecordHash_(rec);
  var record = rec.record_hash ? recordHash === rec.record_hash : null;
  var seal = !rec.record_seal ? 'NONE'
    : !sealKey ? 'UNVERIFIED'
      : timingSafeEqual_(recordSeal_(recordHash, sealKey), String(rec.record_seal).toLowerCase()) ? 'OK' : 'MISMATCH';
  var ok = content && record !== false && seal !== 'MISMATCH';
  return {
    status: ok ? 'OK' : 'MISMATCH',
    contentHash: rec.content_hash,
    signatureSha256: rec.signature_sha256 || '',
    checks: { content: content, record: record, seal: seal }
  };
}

/** Mô tả ngắn phần không khớp (cho thông báo lỗi). */
function integrityProblem_(integrity) {
  var c = integrity.checks || {};
  if (c.content === false) return 'nội dung bàn giao đã bị sửa';
  if (c.record === false) return 'ý kiến người nhận / thời điểm lập, ký / chữ ký đã bị sửa';
  if (c.seal === 'MISMATCH') return 'niêm phong không khớp — dữ liệu đã bị sửa và tính lại mã';
  return 'mã toàn vẹn sai';
}

function toPublicItem_(item) {
  return {
    itemId: item.itemId,
    itemOrder: item.itemOrder,
    category: item.category,
    itemName: item.itemName,
    assetCode: item.assetCode,
    serialNumber: item.serialNumber,
    model: item.model,
    quantity: item.quantity,
    unit: item.unit,
    condition: item.condition,
    description: item.description,
    workStatus: item.workStatus,
    deadline: item.deadline,
    documentUrl: item.documentUrl,
    note: item.note,
    productId: item.productId,
    affectsInventory: item.affectsInventory
  };
}

function toPublicHandover_(rec, items) {
  return {
    code: rec.handover_code,
    handoverType: effectiveHandoverType_(rec, items),
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
      // Người cầm link chỉ thấy email đã che (giống email nhận mã OTP) — bản đầy đủ chỉ trả cho quản trị viên.
      email: maskEmail_(rec.receiver_email)
    },
    items: items.map(toPublicItem_),
    hasPdf: Boolean(rec.pdf_file_id),
    contentHash: computeContentHash_(rec, items),
    // Có phải nhập mã OTP gửi qua email khi ký không (chỉ có email đã che, không lộ địa chỉ đầy đủ).
    otp: publicOtpInfo_(rec),
    // Lần lưu sửa phiếu của quản trị viên chưa hoàn tất (lỗi giữa chừng): chưa ký / yêu cầu sửa được cho tới khi lưu lại xong.
    updating: Boolean(rec.edit_pending)
  };
}

function toAdminHandover_(rec, items, history, sealKey) {
  var view = toPublicHandover_(rec, items);
  view.items = items.map(function (i) {
    var out = toPublicItem_(i);
    out.overNormReason = i.overNormReason || '';
    return out;
  });
  view.id = rec.handover_id;
  view.receiver.email = rec.receiver_email || '';
  view.signatureAvailable = Boolean(rec.signature_file_id);
  view.pdfAvailable = Boolean(rec.pdf_file_id);
  view.confirmedUserAgent = rec.user_agent || '';
  view.createdBy = rec.created_by || '';
  view.confirmMethod = rec.confirm_method || '';
  view.vppScopeId = rec.vpp_scope_id || '';
  view.integrity = integrityOf_(rec, items, sealKey);
  var pendingEdit = parseEditPending_(rec.edit_pending);
  view.editPendingSince = pendingEdit ? pendingEdit.at : '';
  // Cảnh báo (không chặn): người nhận ký trên cùng thiết bị + mạng với lúc tạo phiếu.
  view.confirmedFromCreatorDevice = rec.status === STATUS.CONFIRMED && Boolean(rec.created_ip_hash) &&
    rec.created_ip_hash === rec.confirmed_ip_hash && Boolean(rec.created_user_agent) &&
    rec.created_user_agent === rec.user_agent;
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

function appendHistory_(handoverId, action, actor, oldStatus, newStatus, message, metadata, entityType) {
  appendObjects_(SHEETS.HISTORY, [{
    log_id: uuid_(),
    handover_id: handoverId,
    action: action,
    actor: truncate_(actor || '', 150),
    old_status: oldStatus || '',
    new_status: newStatus || '',
    message: truncate_(message || '', 2000),
    created_at: nowIso_(),
    metadata: metadata ? safeJson_(metadata, 45000) : '',
    entity_type: entityType || 'HANDOVER'
  }]);
}

/** Ghi các dòng nội dung của một phiên bản — chưa hiện ở đâu cho tới khi dòng phiếu chốt phiên bản đó (items_revision). */
function appendItemRows_(handoverId, items, now, revision) {
  appendObjects_(SHEETS.ITEMS, items.map(function (item, i) { return itemToRow_(handoverId, item, i + 1, now, revision); }));
}

/**
 * Dấu "đang sửa" (BAN_GIAO.edit_pending): "<phiên bản mới>|<mã nội dung trước khi sửa>|<thời điểm>|<người nhận trước khi sửa>";
 * trống → null. Người nhận gốc cần để lần lưu lại biết đã đổi người nhận (cột người nhận có thể đã ghi ở lần lỗi trước).
 */
function parseEditPending_(value) {
  var parts = String(value || '').split('|');
  if (parts.length < 2 || !parts[0]) return null;
  var receiver = '';
  try {
    receiver = decodeURIComponent(parts[3] || '');
  } catch (e) {
    receiver = parts[3] || '';
  }
  return { revision: parts[0], baseHash: parts[1], at: parts[2] || '', receiverId: receiver };
}

function editPendingMarker_(revision, baseHash, at, baseReceiverId) {
  return [revision, baseHash, at, encodeURIComponent(String(baseReceiverId || ''))].join('|');
}

/** Đánh dấu superseded_at (thông tin cho người đọc Sheet) các dòng nội dung của phiếu KHÔNG thuộc phiên bản đang chốt. */
function supersedeOtherRevisions_(handoverId, keepRevision, now) {
  var ids = findRows_(SHEETS.ITEMS, 'handover_id', handoverId)
    .filter(function (m) { return !m.record.superseded_at && String(m.record.revision_id || '') !== keepRevision; })
    .map(function (m) { return m.record.item_id; });
  setColumnForIds_(SHEETS.ITEMS, 'superseded_at', ids, now);
}

// ============================================================================
// Sinh mã biên bản BG-YYYYMMDD-XXXX (gọi bên trong khóa)
// ============================================================================

/** Số thứ tự lớn nhất của các mã bắt đầu bằng prefix — đọc cả cột MỘT lần (không đọc từng ô khi đang giữ khóa). */
function maxSequenceForPrefix_(sheetName, column, prefix) {
  var max = 0;
  readColumn_(getSheet_(sheetName), column).forEach(function (value) {
    if (value.indexOf(prefix) === 0) {
      var n = parseInt(value.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  });
  return max;
}

/** Mã tăng dần theo ngày (giờ VN): max(bộ đếm property, số lớn nhất trong Sheet) + 1 — không trùng. */
function nextDailyCode_(codePrefix, propKey, sheetName, column) {
  requireLock_('nextDailyCode_');
  var day = todayKey_();
  var prefix = codePrefix + '-' + day + '-';
  var stored = getProp_(propKey).split(':');
  var fromProp = stored[0] === day ? parseInt(stored[1], 10) || 0 : 0;
  var seq = Math.max(fromProp, maxSequenceForPrefix_(sheetName, column, prefix)) + 1;
  setProp_(propKey, day + ':' + seq);
  return prefix + pad_(seq, 4);
}

function nextHandoverCode_() {
  return nextDailyCode_(APP.CODE_PREFIX, PROP.HANDOVER_SEQ, SHEETS.HANDOVERS, 'handover_code');
}

// ============================================================================
// Admin — tạo phiếu (CHỈ quản trị viên)
// ============================================================================

function createdSummary_(rec, receiver, warnings) {
  var otp = otpPolicy_(rec);
  return {
    id: rec.handover_id,
    code: rec.handover_code,
    status: rec.status,
    handoverType: rec.handover_type || 'OTHER',
    createdAt: rec.created_at,
    receiver: {
      employeeId: receiver.employeeId,
      name: receiver.name,
      department: receiver.department,
      position: receiver.position,
      email: receiver.email
    },
    warnings: warnings || [],
    // Admin biết trước người nhận có phải nhập mã OTP qua email khi ký không.
    confirmOtp: { required: otp.required, blocked: otp.blocked, email: otp.email }
  };
}

function apiAdminCreateHandover_(data) {
  var input = validateHandoverInput_(data);
  var tokenHash = requireTokenHash_(data.tokenHash);
  var tokenNonce = requireNonce_(data.tokenNonce);
  var client = sanitizeClient_(data.client);
  var actor = sanitizeActor_(data.actor);
  var requestId = optionalRequestId_(data.clientRequestId);

  var people = resolveParticipants_(input);
  var plan = null;
  var items;
  var scope = null;
  if (input.handoverType === 'OFFICE_SUPPLY') {
    plan = vppPrepareSupplyItems_(input.supplies);
    items = plan.items;
    scope = resolveDepartmentScope_(people.receiver.department);
  } else {
    items = applyCategoryRules_(input.items, input.handoverType, null);
  }
  var fingerprint = createRequestFingerprint_(input.handoverType, people.sender, people.receiver.employeeId, input.note, items);

  var created = withScriptLock_(function () {
    if (requestId) {
      var existing = findRow_(SHEETS.HANDOVERS, 'client_request_id', requestId);
      if (existing) {
        var prev = existing.record;
        var existingItems = loadItems_(prev.handover_id, prev);
        if (!existingItems.length) {
          // Dòng phiếu không có nội dung nào (dữ liệu ghi dở từ bản cũ ghi phiếu trước nội dung) — không trả như phiếu hợp lệ.
          throw appError_('INTEGRITY_ERROR', 'Phiếu ' + prev.handover_code + ' của yêu cầu này không có nội dung (lần tạo trước ' +
            'bị lỗi giữa chừng). Hãy hủy phiếu đó trong trang quản trị rồi tạo phiếu mới.');
        }
        // Cùng mã thao tác nhưng KHÁC nội dung: lần gửi trước mất phản hồi nhưng đã lưu, người dùng sửa form rồi gửi lại.
        // Không trả phiếu cũ như "đã tạo" (người nhận sẽ ký nội dung chưa sửa), không ghi đè — báo rõ phiếu đã lưu.
        var prevFingerprint = createRequestFingerprint_(prev.handover_type,
          { name: prev.sender_name, employeeId: prev.sender_employee_id }, prev.receiver_employee_id, prev.note, existingItems);
        if (prevFingerprint !== fingerprint) {
          throw appError_('REQUEST_REUSED', 'Lần gửi trước (mất kết nối trước khi nhận được phản hồi) ĐÃ tạo phiếu ' + prev.handover_code +
            ' lúc ' + formatDisplayDateTime_(prev.created_at) + ' với nội dung trước khi bạn sửa. Nội dung vừa sửa CHƯA được lưu — mở phiếu ' +
            prev.handover_code + ' để kiểm tra rồi sửa (hoặc hủy) phiếu đó.', { existing: { id: prev.handover_id, code: prev.handover_code } });
        }
        // Gửi lại đúng yêu cầu đó (mạng chập chờn / bấm 2 lần) → trả phiếu đã tạo, đồng bộ lại kho nếu cần.
        if (prev.handover_type === 'OFFICE_SUPPLY') {
          syncHandoverStock_(prev, existingItems, actor, 'HANDOVER_RESERVE');
        }
        return { duplicate: true, record: prev, warnings: [] };
      }
    }
    var now = nowIso_();
    var id = uuid_();
    var revision = uuid_();
    var warnings = [];
    if (plan) {
      vppValidateAllocation_(plan, scope, id); // INSUFFICIENT_STOCK / NORM_EXCEEDED (đọc tồn mới nhất trong khóa)
    }
    var code = nextHandoverCode_();
    var receiver = people.receiver;
    var record = {
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
      public_token_nonce: tokenNonce,
      handover_type: input.handoverType,
      created_user_agent: client.userAgent,
      client_request_id: requestId,
      vpp_scope_id: scope ? scope.scopeId : '',
      created_by: actorLabel_(actor),
      items_revision: revision
    };
    // Nội dung ghi TRƯỚC, dòng phiếu ghi SAU: lỗi giữa chừng chỉ để lại vài dòng nội dung không thuộc phiếu nào (không hiện ở
    // đâu, không giữ chỗ kho) — không bao giờ có phiếu rỗng mà lần gửi lại (cùng clientRequestId) trả về như phiếu hợp lệ.
    appendItemRows_(id, items, now, revision);
    appendObjects_(SHEETS.HANDOVERS, [record]);
    var savedItems = items.map(function (item, i) {
      var copy = Object.assign({}, item);
      copy.itemOrder = i + 1;
      return copy;
    });
    // Phiếu đã lưu → lịch sử là bước phụ: lỗi ghi lịch sử không biến phiếu đã tạo thành "lỗi" (hiện ở trang Cài đặt).
    afterCommit_('handover_created_history', code, function () {
      appendHistory_(id, 'CREATED', actorLabel_(actor), '', STATUS.PENDING,
        'Tạo phiếu ' + code + ' (' + (HANDOVER_TYPES[input.handoverType] || input.handoverType) + ') gồm ' + items.length +
          ' nội dung.',
        { ipHash: client.ipHash, userAgent: client.userAgent, itemCount: items.length, actor: actor });
    });
    if (plan) {
      // Phiếu đã ghi xong mới giữ chỗ: nếu bước này lỗi, lần gửi lại cùng clientRequestId (hoặc "Đối soát kho") tự bổ sung
      // — không mất phiếu, không giữ chỗ 2 lần.
      warnings = syncHandoverStock_(record, savedItems, actor, 'HANDOVER_RESERVE');
    }
    return { duplicate: false, record: record, warnings: warnings };
  });

  var rec = created.record;
  var receiverInfo = created.duplicate
    ? {
        employeeId: rec.receiver_employee_id, name: rec.receiver_name, department: rec.receiver_department || '',
        position: rec.receiver_position || '', email: rec.receiver_email || ''
      }
    : {
        employeeId: people.receiver.employeeId, name: people.receiver.fullName, department: people.receiver.department,
        position: people.receiver.position, email: people.receiver.email
      };
  var out = createdSummary_(rec, receiverInfo, created.warnings);
  if (created.duplicate) {
    out.duplicate = true;
    out.tokenHash = rec.public_token_hash || '';
    out.tokenNonce = rec.public_token_nonce || '';
  }
  logInfo_('handover.created', { code: rec.handover_code, duplicate: created.duplicate });
  return out;
}

// ============================================================================
// Public API (người nhận qua link)
// ============================================================================

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
    handover: toPublicHandover_(found.record, loadItems_(found.record.handover_id, found.record)),
    categories: getCategories_()
  };
}

/** Trạng thái không cho phép thao tác → lỗi thân thiện. */
function assertPending_(rec) {
  if (rec.status === STATUS.PENDING) {
    // Lần lưu sửa phiếu trước lỗi giữa chừng (dòng phiếu có thể đã đổi một phần): chưa cho ký / yêu cầu sửa / gửi mã.
    if (rec.edit_pending) {
      throw appError_('INVALID_STATE', 'Biên bản đang được quản trị viên cập nhật (lần lưu trước chưa hoàn tất). Vui lòng mở lại link ' +
        'sau ít phút hoặc liên hệ quản trị viên.', { updating: true });
    }
    return;
  }
  if (rec.status === STATUS.CONFIRMED) {
    throw appError_('ALREADY_CONFIRMED', 'Biên bản đã được xác nhận lúc ' + formatDisplayDateTime_(rec.confirmed_at) + '.', {
      confirmedAt: rec.confirmed_at
    });
  }
  if (rec.status === STATUS.CANCELLED) throw appError_('INVALID_STATE', 'Biên bản đã bị hủy.');
  if (rec.status === STATUS.REVISION_REQUESTED) {
    throw appError_('INVALID_STATE', 'Bạn đã gửi yêu cầu chỉnh sửa. Vui lòng chờ quản trị viên cập nhật biên bản.');
  }
  throw appError_('INVALID_STATE', 'Trạng thái biên bản không hợp lệ.');
}

/** Nội dung phải trùng với bản người nhận đã xem (chống "ký nội dung đã bị sửa trong lúc đang mở trang"). */
function assertContentUnchanged_(rec, items, expectedHash) {
  var current = computeContentHash_(rec, items);
  if (current !== expectedHash) {
    throw appError_('CONFLICT', 'Biên bản vừa được cập nhật. Vui lòng xem lại nội dung mới trước khi thao tác.', {
      contentChanged: true
    });
  }
  return current;
}

function apiConfirmHandover_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  if (data.agreed !== true) {
    throw validationError_({ agreed: 'Bạn cần tích xác nhận đã kiểm tra và nhận đủ các nội dung bàn giao' });
  }
  var expectedHash = requireContentHash_(data.contentHash);
  var comment = cleanText_(data.comment);
  if (comment.length > LIMITS.RECEIVER_COMMENT) throw validationError_({ comment: 'Tối đa ' + LIMITS.RECEIVER_COMMENT + ' ký tự' });
  var signatureBytes = decodeSignaturePng_(data.signatureBase64);
  var client = sanitizeClient_(data.client);
  var sealKey = sealKeyOf_(data);
  enforceRateLimit_('confirm', tokenHash.slice(0, 32), 10, 600);

  var outcome = withScriptLock_(function () {
    var found = findHandoverByTokenHash_(tokenHash);
    if (!found) throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
    var rec = found.record;
    assertPending_(rec);
    var items = loadItems_(rec.handover_id, rec);
    var contentHash = assertContentUnchanged_(rec, items, expectedHash);
    // Chống "người cầm link ký thay": mã OTP gửi tới email người nhận (kiểm tra trước khi lưu chữ ký).
    var otp = otpPolicy_(rec);
    if (otp.blocked) {
      throw appError_('OTP_REQUIRED', 'Biên bản bắt buộc mã xác nhận qua email nhưng người nhận chưa có email trong hệ thống. ' +
        'Vui lòng liên hệ quản trị viên.');
    }
    if (otp.required) verifyConfirmOtp_(rec.handover_id, otp.email, data.otp);

    var now = nowIso_();
    var file = saveSignatureFile_(rec.handover_code, signatureBytes, now);
    var sameDevice = Boolean(rec.created_ip_hash) && rec.created_ip_hash === client.ipHash &&
      Boolean(rec.created_user_agent) && rec.created_user_agent === client.userAgent;
    var changes = {
      status: STATUS.CONFIRMED,
      confirmed_at: now,
      updated_at: now,
      signature_file_id: file.id,
      signature_file_url: file.url,
      confirmed_ip_hash: client.ipHash,
      user_agent: client.userAgent,
      receiver_comment: comment,
      content_hash: contentHash,
      signature_sha256: sha256BytesHex_(signatureBytes),
      confirm_method: otp.method
    };
    // Mã băm TOÀN BỘ biên bản đã ký + niêm phong (ghi cùng lần với trạng thái, trước cột trạng thái).
    changes.record_hash = computeRecordHash_(Object.assign({}, rec, changes));
    changes.record_seal = recordSeal_(changes.record_hash, sealKey);
    try {
      // Trạng thái ghi trước, kho đồng bộ sau: nếu bước kho lỗi, "Đối soát kho" bổ sung — không bao giờ trừ 2 lần.
      updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    } catch (e) {
      trashFileQuietly_(file.id); // không để lại file chữ ký mồ côi
      throw e;
    }
    // Từ đây biên bản ĐÃ ký (trạng thái đã ghi): các bước sau là bước phụ — lỗi không được báo "chưa ký" cho người nhận.
    var merged = Object.assign({}, rec, changes);
    if (otp.required) afterCommit_('confirm_consume_otp', rec.handover_code, function () { consumeConfirmOtp_(rec.handover_id); });
    var methodNote = otp.method === CONFIRM_METHODS.OTP_EMAIL ? ' Xác thực bằng mã OTP gửi tới ' + otp.emailMasked + '.'
      : otp.method === CONFIRM_METHODS.NO_EMAIL ? ' ⚠ Ký không có mã OTP (người nhận chưa có email).' : '';
    afterCommit_('confirm_history', rec.handover_code, function () {
      appendHistory_(rec.handover_id, 'CONFIRMED', rec.receiver_name, rec.status, STATUS.CONFIRMED,
        (comment ? 'Người nhận ký xác nhận. Ghi chú: ' + comment : 'Người nhận ký xác nhận.') + methodNote +
          (sameDevice ? ' ⚠ Ký trên cùng thiết bị và mạng với lúc tạo phiếu.' : ''),
        {
          ipHash: client.ipHash, userAgent: client.userAgent, signatureFileId: file.id, contentHash: contentHash, sameDevice: sameDevice,
          confirmMethod: otp.method, otpEmail: otp.emailMasked
        });
    });
    var stockError = '';
    if (effectiveHandoverType_(merged, items) === 'OFFICE_SUPPLY') {
      try {
        syncHandoverStock_(merged, items, { id: rec.receiver_employee_id || 'receiver', name: rec.receiver_name }, 'HANDOVER_CONFIRM');
      } catch (e) {
        // Người nhận đã ký (đã nhận hàng) → phiếu vẫn xác nhận; lệch kho được ghi vào lịch sử phiếu, hiện ở
        // "Dữ liệu cần kiểm tra" và báo email cho quản trị viên để "Đối soát kho".
        logError_('confirm.stock_sync', e);
        stockError = String(e && e.message ? e.message : e);
        afterCommit_('confirm_stock_history', rec.handover_code, function () {
          appendHistory_(rec.handover_id, 'STOCK_SYNC_FAILED', 'Hệ thống', STATUS.CONFIRMED, STATUS.CONFIRMED,
            'Chưa xuất kho được khi người nhận ký: ' + stockError + ' — cần "Đối soát kho".', { error: stockError });
        });
      }
    }
    return { rec: merged, stockError: stockError };
  });

  var result = outcome.rec;
  if (outcome.stockError) {
    notifyAfterCommit_('STOCK_SYNC_FAILED', function () { return notifyStockSyncFailed_(result, outcome.stockError); });
  }
  logInfo_('handover.confirmed', { code: result.handover_code, method: result.confirm_method, sealed: Boolean(result.record_seal) });
  return { id: result.handover_id, handover: toPublicHandover_(result, loadItems_(result.handover_id, result)) };
}

function apiRequestRevision_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  var expectedHash = requireContentHash_(data.contentHash);
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
    assertContentUnchanged_(rec, loadItems_(rec.handover_id, rec), expectedHash);
    var now = nowIso_();
    var changes = {
      status: STATUS.REVISION_REQUESTED,
      revision_requested_at: now,
      updated_at: now,
      receiver_comment: reason
    };
    // Văn phòng phẩm: giữ nguyên số lượng đang giữ chỗ cho tới khi admin sửa hoặc hủy phiếu.
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    afterCommit_('revision_history', rec.handover_code, function () {
      appendHistory_(rec.handover_id, 'REVISION_REQUESTED', rec.receiver_name, rec.status, STATUS.REVISION_REQUESTED, reason,
        { ipHash: client.ipHash, userAgent: client.userAgent });
    });
    return Object.assign({}, rec, changes);
  });

  // Báo quản trị viên (email, nếu đã cấu hình NOTIFY_EMAILS). Lỗi gửi được ghi lại, không làm hỏng yêu cầu đã lưu.
  notifyAfterCommit_('REVISION_REQUESTED', function () { return notifyRevisionRequested_(result, reason); });
  return { id: result.handover_id, handover: toPublicHandover_(result, loadItems_(result.handover_id, result)) };
}

function apiGetPdfByToken_(data) {
  var tokenHash = requireTokenHash_(data.tokenHash);
  var client = sanitizeClient_(data.client);
  if (isLookupBlocked_(client.ipHash)) {
    throw appError_('RATE_LIMITED', 'Bạn đã mở quá nhiều link không hợp lệ. Vui lòng thử lại sau ít phút.');
  }
  enforceRateLimit_('pdf', tokenHash.slice(0, 32), 20, 600);
  var found = findHandoverByTokenHash_(tokenHash);
  if (!found) {
    registerLookupMiss_(client.ipHash);
    throw appError_('NOT_FOUND', 'Link xác nhận không hợp lệ hoặc đã được thay bằng link mới.');
  }
  if (found.record.status !== STATUS.CONFIRMED) {
    throw appError_('INVALID_STATE', 'Chỉ tải được PDF sau khi biên bản đã được xác nhận.');
  }
  return readDriveFile_(ensurePdf_(found.record.handover_id, false, null, sealKeyOf_(data)), found.record.handover_code + '.pdf',
    'application/pdf');
}

/** Gọi nền từ Worker (ctx.waitUntil) ngay sau khi xác nhận. */
function apiGeneratePdf_(data) {
  var id = requireHandoverId_(data.id);
  ensurePdf_(id, false, null, sealKeyOf_(data));
  return { pdfAvailable: true };
}

// ============================================================================
// Admin API
// ============================================================================

/** Số nội dung + loại của từng phiếu (chỉ phiên bản đã chốt) — đọc vài cột thay vì cả bảng. */
function summarizeItems_() {
  var rows = readColumns_(SHEETS.ITEMS, ['handover_id', 'category', 'superseded_at', 'revision_id']);
  var revisions = committedRevisionMap_();
  var out = {};
  rows.forEach(function (r) {
    if (!r.handover_id || !isCommittedItemRow_(r, revisions[r.handover_id])) return;
    var info = out[r.handover_id] || (out[r.handover_id] = { count: 0, categories: {} });
    info.count++;
    var cat = String(r.category || '').trim().toUpperCase();
    if (cat) info.categories[cat] = true;
  });
  return out;
}

function containsNormalized_(values, needle) {
  for (var i = 0; i < values.length; i++) {
    if (normalizeText_(values[i]).indexOf(needle) >= 0) return true;
  }
  return false;
}

function summaryHandoverType_(h, info, categories) {
  var stored = String(h.handover_type || '').trim().toUpperCase();
  if (HANDOVER_TYPES[stored]) return stored;
  var types = {};
  Object.keys((info && info.categories) || {}).forEach(function (code) {
    var c = categories[code];
    types[c ? c.handoverType : 'OTHER'] = true;
  });
  var keys = Object.keys(types);
  return keys.length === 1 ? keys[0] : 'OTHER';
}

function matchesFilters_(h, info, f, type) {
  if (f.status && h.status !== f.status) return false;
  if (f.handoverType && type !== f.handoverType) return false;
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
  return listHandovers_(readTable_(SHEETS.HANDOVERS).rows, q || {});
}

function listHandovers_(handovers, q) {
  // exportAll (xuất CSV từ trang quản trị): một trang tối đa APP.EXPORT_MAX_ROWS dòng theo đúng bộ lọc.
  var exportAll = q.exportAll === true;
  var filters = {
    page: exportAll ? 1 : clampInt_(q.page, 1, 100000, 1),
    pageSize: exportAll ? APP.EXPORT_MAX_ROWS : clampInt_(q.pageSize, 5, 100, 20),
    code: normalizeText_(q.code),
    employeeName: normalizeText_(q.employeeName),
    employeeId: normalizeText_(q.employeeId),
    sender: normalizeText_(q.sender),
    receiver: normalizeText_(q.receiver),
    department: normalizeText_(q.department),
    category: String(q.category || '').trim().toUpperCase(),
    handoverType: HANDOVER_TYPES[String(q.handoverType || '').toUpperCase()] ? String(q.handoverType).toUpperCase() : '',
    status: STATUS[q.status] ? q.status : '',
    from: isValidDateOnly_(q.from) ? q.from : '',
    to: isValidDateOnly_(q.to) ? q.to : ''
  };

  var itemInfo = summarizeItems_();
  var categories = getCategoryMap_();
  var stats = { total: 0, PENDING: 0, CONFIRMED: 0, REVISION_REQUESTED: 0, CANCELLED: 0 };
  var departments = {};
  var matched = [];
  handovers.forEach(function (h) {
    if (!h.handover_id) return;
    stats.total++;
    if (stats[h.status] !== undefined) stats[h.status]++;
    if (h.receiver_department) departments[h.receiver_department] = true;
    var type = summaryHandoverType_(h, itemInfo[h.handover_id], categories);
    if (matchesFilters_(h, itemInfo[h.handover_id], filters, type)) matched.push({ h: h, type: type });
  });
  matched.sort(function (a, b) {
    if (a.h.created_at !== b.h.created_at) return a.h.created_at < b.h.created_at ? 1 : -1;
    return a.h.handover_code < b.h.handover_code ? 1 : -1;
  });

  var start = (filters.page - 1) * filters.pageSize;
  return {
    items: matched.slice(start, start + filters.pageSize).map(function (m) {
      var h = m.h;
      var info = itemInfo[h.handover_id] || { count: 0, categories: {} };
      return {
        id: h.handover_id,
        code: h.handover_code,
        handoverType: m.type,
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

function buildAdminDetail_(rec, sealKey) {
  return {
    handover: toAdminHandover_(rec, loadItems_(rec.handover_id, rec), loadHistory_(rec.handover_id), sealKey),
    categories: getCategories_()
  };
}

function apiAdminGetHandover_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  return buildAdminDetail_(found.record, sealKeyOf_(data));
}

function apiAdminUpdateHandover_(data) {
  var id = requireHandoverId_(data.id);
  var input = validateHandoverInput_(data);
  var candidateHash = requireTokenHash_(data.candidateTokenHash);
  var candidateNonce = requireNonce_(data.candidateTokenNonce);
  var client = sanitizeClient_(data.client);
  var actor = sanitizeActor_(data.actor);
  var expectedHash = data.expectedContentHash ? requireContentHash_(data.expectedContentHash) : '';
  var people = resolveParticipants_(input);
  var plan = input.handoverType === 'OFFICE_SUPPLY' ? vppPrepareSupplyItems_(input.supplies) : null;

  var outcome = withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    if (rec.status !== STATUS.PENDING && rec.status !== STATUS.REVISION_REQUESTED) {
      throw appError_('INVALID_STATE', 'Chỉ sửa được biên bản đang "Chờ xác nhận" hoặc "Yêu cầu chỉnh sửa".');
    }
    var previousItems = loadItems_(id, rec);
    var currentHash = computeContentHash_(rec, previousItems);
    // Lần lưu trước lỗi giữa chừng (còn dấu "đang sửa"): một phần cột phiếu có thể đã ghi nên mã nội dung hiện tại khác bản gốc —
    // lưu lại từ ĐÚNG bản gốc đó vẫn được (ghi tiếp cho trọn), không báo xung đột oan.
    var pendingEdit = parseEditPending_(rec.edit_pending);
    var baseHash = pendingEdit ? pendingEdit.baseHash : currentHash;
    // Chống ghi đè âm thầm: nội dung đã khác bản quản trị viên mở để sửa (quản trị viên khác vừa lưu) → báo xung đột.
    if (expectedHash && expectedHash !== currentHash && expectedHash !== baseHash) {
      throw appError_('CONFLICT', 'Biên bản đã được thay đổi sau khi bạn mở trang sửa (quản trị viên khác vừa lưu, hoặc lần lưu ' +
        'trước của bạn đã được ghi). Tải lại để xem bản mới nhất rồi sửa tiếp.', { contentChanged: true });
    }
    var currentType = effectiveHandoverType_(rec, previousItems);
    var stored = String(rec.handover_type || '').toUpperCase();
    if ((stored && stored !== input.handoverType) || (!stored && input.handoverType === 'OFFICE_SUPPLY') ||
        (stored === '' && currentType !== input.handoverType && input.handoverType !== 'OTHER')) {
      throw appError_('INVALID_STATE', 'Không thể đổi loại phiếu (' + (HANDOVER_TYPES[currentType] || currentType) +
        '). Hãy hủy phiếu và tạo phiếu mới.');
    }
    var now = nowIso_();
    var receiver = people.receiver;
    var scope = plan ? resolveDepartmentScope_(receiver.department) : null;
    var items;
    if (plan) {
      vppValidateAllocation_(plan, scope, id);
      items = plan.items;
    } else {
      var allowInactive = {};
      previousItems.forEach(function (i) { allowInactive[i.category] = true; });
      items = applyCategoryRules_(input.items, input.handoverType, allowInactive);
    }
    // So với người nhận TRƯỚC khi sửa: lần sửa trước lỗi giữa chừng có thể đã ghi cột người nhận (và đổi link) mà chưa chốt.
    var baseReceiverId = pendingEdit && pendingEdit.receiverId ? pendingEdit.receiverId : String(rec.receiver_employee_id);
    var receiverChanged = baseReceiverId.toUpperCase() !== receiver.employeeId.toUpperCase();
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
      updated_at: now,
      handover_type: input.handoverType
    };
    if (plan) changes.vpp_scope_id = scope ? scope.scopeId : '';
    if (receiverChanged) {
      // Đổi người nhận → vô hiệu link cũ (đã gửi cho người nhận trước).
      changes.public_token_hash = candidateHash;
      changes.public_token_nonce = candidateNonce;
    }
    // Sửa phiếu TRỌN VẸN (mọi lỗi giữa chừng đều không để lộ nội dung lẫn cũ / mới hay người nhận mới đi với nội dung cũ):
    //   1) dòng nội dung của PHIÊN BẢN MỚI — chưa hiện ở đâu (chỉ phiên bản đã chốt mới được đọc);
    //   2) giữ chỗ kho theo nội dung mới (idempotent theo phiếu);
    //   3) dấu "đang sửa" (1 ô): từ đây tới lúc chốt, người nhận không ký / yêu cầu sửa / xin mã được;
    //   4) các cột phiếu → link mới (nếu đổi người nhận) → trạng thái → CHỐT phiên bản + xóa dấu (cùng một lần ghi, sau cùng).
    // Lỗi ở bất kỳ bước nào → người nhận vẫn thấy bản cũ trọn vẹn (hoặc thấy "đang cập nhật"); lưu lại sẽ ghi tiếp cho trọn.
    var revision = uuid_();
    changes.items_revision = revision;
    changes.edit_pending = '';
    var merged = Object.assign({}, rec, changes);
    appendItemRows_(id, items, now, revision);
    var warnings = [];
    if (plan) {
      var newItems = items.map(function (item, i) {
        var copy = Object.assign({}, item);
        copy.itemOrder = i + 1;
        return copy;
      });
      warnings = syncHandoverStock_(merged, newItems, actor, 'HANDOVER_UPDATE');
    }
    var marker = editPendingMarker_(revision, baseHash, now, baseReceiverId);
    var rowIndex = updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, { edit_pending: marker });
    updateRowFields_(SHEETS.HANDOVERS, rowIndex, Object.assign({}, rec, { edit_pending: marker }), changes);
    // Dòng nội dung cũ (và của lần sửa trước chưa chốt) → superseded_at: chỉ để người xem Sheet dễ đọc (hệ thống đọc theo phiên bản).
    afterCommit_('update_supersede_items', rec.handover_code, function () { supersedeOtherRevisions_(id, revision, now); });
    // Nội dung đã đổi (có thể cả người nhận) → mã OTP đã gửi trước đó không còn dùng được, bộ đếm gửi mã tính lại.
    afterCommit_('update_clear_otp', rec.handover_code, function () { clearConfirmOtp_(id); });
    afterCommit_('update_history', rec.handover_code, function () {
      var baseReceiverName = baseReceiverId.toUpperCase() === String(rec.receiver_employee_id).toUpperCase()
        ? rec.receiver_name
        : ((findEmployeeById_(baseReceiverId) || {}).fullName || baseReceiverId);
      appendHistory_(id, 'UPDATED', actorLabel_(actor), rec.status, STATUS.PENDING,
        'Cập nhật biên bản (' + previousItems.length + ' → ' + items.length + ' nội dung)' +
          (receiverChanged ? '. Đổi người nhận: ' + baseReceiverName + ' → ' + receiver.fullName + ', đã cấp link mới.' : '.'),
        {
          ipHash: client.ipHash, receiverChanged: receiverChanged, previousNote: rec.note, previousItems: previousItems,
          actor: actor
        });
    });
    return { record: merged, linkRotated: receiverChanged, warnings: warnings };
  });

  var detail = buildAdminDetail_(outcome.record, sealKeyOf_(data));
  detail.linkRotated = outcome.linkRotated;
  detail.warnings = outcome.warnings;
  return detail;
}

function apiAdminCancelHandover_(data) {
  var id = requireHandoverId_(data.id);
  var reason = cleanText_(data.reason);
  if (reason.length > LIMITS.CANCEL_REASON) throw validationError_({ reason: 'Tối đa ' + LIMITS.CANCEL_REASON + ' ký tự' });
  var client = sanitizeClient_(data.client);
  var actor = sanitizeActor_(data.actor);

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
    if (rec.edit_pending) changes.edit_pending = ''; // hủy phiếu đang sửa dở: bỏ luôn lần sửa chưa chốt
    var merged = Object.assign({}, rec, changes);
    var items = loadItems_(id, rec);
    // Trả số lượng đang giữ chỗ TRƯỚC, rồi mới ghi trạng thái hủy: lỗi kho → phiếu chưa bị hủy, quản trị viên thấy lỗi và hủy
    // lại sau khi đối soát — không có phiếu "đã hủy" mà kho vẫn giữ hàng cho nó (bấm hủy lại chỉ gặp "đã hủy trước đó").
    if (effectiveHandoverType_(merged, items) === 'OFFICE_SUPPLY') {
      syncHandoverStock_(merged, items, actor, 'HANDOVER_CANCEL');
    }
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, changes);
    afterCommit_('cancel_clear_otp', rec.handover_code, function () { clearConfirmOtp_(id); });
    afterCommit_('cancel_history', rec.handover_code, function () {
      appendHistory_(id, 'CANCELLED', actorLabel_(actor), rec.status, STATUS.CANCELLED, reason || 'Hủy biên bản.',
        { ipHash: client.ipHash, actor: actor });
    });
    return merged;
  });
  return buildAdminDetail_(record, sealKeyOf_(data));
}

function apiAdminRegenerateLink_(data) {
  var id = requireHandoverId_(data.id);
  var tokenHash = requireTokenHash_(data.tokenHash);
  var tokenNonce = requireNonce_(data.tokenNonce);
  var client = sanitizeClient_(data.client);
  var actor = sanitizeActor_(data.actor);
  return withScriptLock_(function () {
    var found = findHandoverById_(id);
    if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    var rec = found.record;
    if (rec.status === STATUS.CANCELLED) throw appError_('INVALID_STATE', 'Biên bản đã bị hủy.');
    // Không đổi updated_at: nội dung không thay đổi nên trang người nhận đang mở (link mới) vẫn hợp lệ.
    // (updateRowFields_ ghi nonce trước, hash sau: lỗi giữa chừng thì link cũ vẫn dùng được.)
    updateRowFields_(SHEETS.HANDOVERS, found.rowIndex, rec, {
      public_token_hash: tokenHash,
      public_token_nonce: tokenNonce
    });
    // Link cũ có thể đã lộ: mã OTP đã gửi qua link cũ hết hiệu lực, bộ đếm gửi mã tính lại (mở khóa khi đã gửi quá số lần).
    afterCommit_('regenerate_clear_otp', rec.handover_code, function () { clearConfirmOtp_(id); });
    afterCommit_('regenerate_history', rec.handover_code, function () {
      appendHistory_(id, 'LINK_REGENERATED', actorLabel_(actor), rec.status, rec.status,
        'Cấp link xác nhận mới; link cũ và mã xác nhận đã gửi (nếu có) hết hiệu lực.', { ipHash: client.ipHash, actor: actor });
    });
    return { code: rec.handover_code };
  });
}

function apiAdminGetSignature_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  var rec = found.record;
  if (!rec.signature_file_id) throw appError_('NOT_FOUND', 'Biên bản chưa có chữ ký.');
  var got = getSystemFile_(rec.signature_file_id, 'image/png'); // file ngoài thư mục hệ thống / sai định dạng → DRIVE_ERROR
  // Cột chữ ký (file / mã băm) bị đổi sau khi ký — ví dụ chép từ phiếu khác: mã băm toàn biên bản / niêm phong không còn khớp.
  var recordHash = computeRecordHash_(rec);
  var sealKey = sealKeyOf_(data);
  if ((rec.record_hash && recordHash !== rec.record_hash) ||
      (rec.record_seal && sealKey && !timingSafeEqual_(recordSeal_(recordHash, sealKey), String(rec.record_seal).toLowerCase()))) {
    throw appError_('INTEGRITY_ERROR', 'Dữ liệu chữ ký của biên bản trên Google Sheet đã bị sửa sau khi ký (không khớp mã toàn vẹn) — không ' +
      'hiện như chữ ký của biên bản này. Hãy kiểm tra lịch sử chỉnh sửa của Sheet.');
  }
  var bytes = got.blob.getBytes();
  // Ảnh trên Drive phải đúng ảnh lúc ký (mã băm lưu cùng biên bản): file bị thay / cột file_id bị đổi sang chữ ký của phiếu
  // khác → không hiện như chữ ký của phiếu này.
  if (rec.signature_sha256 && sha256BytesHex_(bytes) !== String(rec.signature_sha256).toLowerCase()) {
    throw appError_('INTEGRITY_ERROR', 'Ảnh chữ ký trên Google Drive không khớp với chữ ký lúc xác nhận (file bị thay hoặc dữ liệu chữ ký ' +
      'trên Sheet bị sửa). Hãy kiểm tra lịch sử chỉnh sửa của Sheet / Drive.');
  }
  return { fileName: got.file.getName() || rec.handover_code + '-signature.png', mimeType: 'image/png', base64: Utilities.base64Encode(bytes) };
}

function apiAdminGetPdf_(data) {
  var found = findHandoverById_(requireHandoverId_(data.id));
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  return readDriveFile_(ensurePdf_(found.record.handover_id, false, null, sealKeyOf_(data)), found.record.handover_code + '.pdf',
    'application/pdf');
}

function apiAdminGeneratePdf_(data) {
  var actor = sanitizeActor_(data.actor);
  ensurePdf_(requireHandoverId_(data.id), data.force === true, actor, sealKeyOf_(data));
  return { pdfAvailable: true };
}

/** Tổng quan cho trang chủ quản trị: thống kê phiếu, việc cần xử lý, cảnh báo văn phòng phẩm. */
function apiAdminOverview_() {
  var handovers = readTable_(SHEETS.HANDOVERS).rows;
  var list = listHandovers_(handovers, { page: 1, pageSize: 8 });
  var revision = handovers
    .filter(function (h) { return h.status === STATUS.REVISION_REQUESTED; })
    .sort(function (a, b) { return a.revision_requested_at < b.revision_requested_at ? 1 : -1; })
    .slice(0, 10)
    .map(function (h) {
      return {
        id: h.handover_id, code: h.handover_code, receiverName: h.receiver_name, receiverComment: h.receiver_comment || '',
        revisionRequestedAt: h.revision_requested_at || ''
      };
    });
  return {
    stats: list.stats,
    revisionRequested: revision,
    recent: list.items.slice(0, 8),
    vpp: vppAlertsSummary_(),
    // Gửi email thông báo / mã OTP lỗi gần đây → hiện cảnh báo trên Tổng quan (không im lặng).
    notify: notifyStatus_()
  };
}

/** Số việc cần xử lý cho huy hiệu trên thanh menu quản trị — chỉ đọc cột trạng thái (nhẹ). */
function apiAdminBadges_() {
  var revision = readColumns_(SHEETS.HANDOVERS, ['handover_id', 'status']).filter(function (h) {
    return h.status === STATUS.REVISION_REQUESTED;
  }).length;
  var proposals = readColumns_(SHEETS.VPP_PROPOSALS, ['proposal_id', 'status']).filter(function (p) {
    return p.status === PROPOSAL_STATUS.SUBMITTED;
  }).length;
  return { revisionRequested: revision, submittedProposals: proposals };
}
