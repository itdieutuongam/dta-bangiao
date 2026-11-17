/**
 * Export.gs — xuất CSV cho trang quản trị (GET /api/admin/export/:dataset): handovers · stock · movements · proposals ·
 * uniform-stock · uniform-movements · uniform-employees · uniform-holdings.
 *
 * CSV được dựng NGAY TẠI Apps Script: Worker chỉ chuyển nguyên văn bản cho trình duyệt, không lặp từng dòng — xuất vài nghìn
 * dòng không vượt giới hạn CPU 10 ms / request của Cloudflare Workers Free (dựng ở Worker: ~22–33 ms cho 5.000 dòng).
 *   • xuống dòng CRLF, mọi ô trong "…" (Worker thêm BOM UTF-8 để Excel hiển thị đúng tiếng Việt);
 *   • chống CSV / formula injection (OWASP): ô chữ bắt đầu bằng = + - @ (kể cả dạng full-width, sau khoảng trắng) hoặc Tab / CR
 *     được thêm dấu ' phía trước; số giữ nguyên để còn cộng trừ được;
 *   • ngày giờ ISO có múi giờ → "YYYY-MM-DD HH:mm:ss" giờ Việt Nam (bảng tính nhận là ngày giờ); chuỗi khác (ai đó gõ "06/10/2026"
 *     thẳng vào Sheet) giữ NGUYÊN — không đoán ngày / tháng.
 * Tối đa APP.EXPORT_MAX_ROWS dòng / lần theo đúng bộ lọc đang xem; nhiều hơn → total > rows (giao diện nhắc lọc theo ngày).
 */

var CSV_FORMULA_CHARS_ = '=+-@＝＋－＠';
var CSV_ISO_WITH_ZONE_ = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Nhãn hiển thị — khớp shared/vpp.ts (có test so sánh). Literal: không tham chiếu file khác ở top-level. */
var EXPORT_LABELS_ = {
  catalog: { MASTER: 'Danh mục', TEMP: 'Tạm / ngoài định mức', PENDING_APPROVAL: 'Chờ duyệt', ARCHIVED: 'Ngừng dùng' },
  stock: { IN_STOCK: 'Còn hàng', LOW_STOCK: 'Sắp hết', OUT_OF_STOCK: 'Hết hàng', UNKNOWN: 'Chưa rõ tồn' },
  movement: {
    INITIAL: 'Tồn đầu kỳ', IN: 'Nhập kho', RESERVE: 'Giữ chỗ', RELEASE: 'Trả giữ chỗ', OUT: 'Xuất kho', ADJUSTMENT: 'Điều chỉnh / kiểm kê',
    ISSUE: 'Xuất kho (phiếu xuất)'
  },
  voucherType: { IN: 'Phiếu nhập', OUT: 'Phiếu xuất' },
  proposal: {
    SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', PARTIALLY_APPROVED: 'Duyệt một phần', REJECTED: 'Từ chối', PURCHASED: 'Đã mua',
    RECEIVED: 'Đã nhập kho', CLOSED: 'Đã đóng'
  },
  // Đồng phục — khớp shared/uniform.ts.
  uniformMovement: {
    INITIAL: 'Tồn đầu kỳ', IN: 'Nhập kho', RESERVE: 'Giữ chỗ', RELEASE: 'Trả giữ chỗ', OUT: 'Xuất kho (bàn giao)',
    ADJUSTMENT: 'Kiểm kê / điều chỉnh', RETURN: 'Nhận lại (nhân viên trả)', DISPOSE: 'Thanh lý / hủy'
  },
  uniformCondition: { NEW: 'Mới', USED: 'Đã qua sử dụng' },
  uniformGender: { NAM: 'Nam', NU: 'Nữ', UNISEX: 'Nam & nữ' },
  uniformKind: { UNIFORM: 'Đồng phục', PPE: 'Bảo hộ lao động', OTHER: 'Khác' },
  issueKind: { CAP_PHAT: 'Cấp phát', CHO_MUON: 'Cho mượn' }
};

/** Bảng tính có thể hiểu ô là công thức: bắt đầu bằng Tab / CR, hoặc ký tự công thức sau các khoảng trắng / ký tự điều khiển. */
function csvLooksLikeFormula_(value) {
  if (value.charAt(0) === '\t' || value.charAt(0) === '\r') return true;
  var i = 0;
  while (i < value.length && value.charCodeAt(i) <= 0x20) i++;
  return i < value.length && CSV_FORMULA_CHARS_.indexOf(value.charAt(i)) >= 0;
}

function csvCell_(value) {
  var text;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'number') text = isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') text = value ? 'Có' : 'Không';
  else {
    text = String(value);
    if (csvLooksLikeFormula_(text)) text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv_(header, rows) {
  return [header].concat(rows).map(function (row) { return row.map(csvCell_).join(','); }).join('\r\n') + '\r\n';
}

/** ISO CÓ múi giờ → "YYYY-MM-DD HH:mm:ss" giờ Việt Nam; chuỗi khác giữ nguyên (không đoán ngày / tháng, không gán giờ). */
function csvDateTime_(iso) {
  if (!iso) return '';
  var text = String(iso);
  var m = CSV_ISO_WITH_ZONE_.exec(text);
  if (!m) return text;
  if (m[3] === '+07:00') return m[1] + ' ' + m[2];
  var date = new Date(text);
  return isNaN(date.getTime()) ? text : Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/** Số lượng theo chiều tác động (như trang Lịch sử kho): xuất kho / trả giữ chỗ âm, điều chỉnh giữ dấu, còn lại dương. */
function signedMovementQuantity_(type, quantity) {
  if (type === 'ADJUSTMENT') return quantity;
  return type === 'OUT' || type === 'RELEASE' || type === 'ISSUE' ? -Math.abs(quantity) : Math.abs(quantity);
}

function exportHandoversCsv_(filters) {
  var data = listHandovers_(readTable_(SHEETS.HANDOVERS).rows, Object.assign({}, filters, { exportAll: true }));
  var categories = getCategoryMap_();
  return {
    fileBase: 'bien-ban-ban-giao',
    header: [
      'Mã biên bản', 'Loại phiếu', 'Trạng thái', 'Ngày tạo', 'Cập nhật', 'Ngày xác nhận', 'Người giao', 'Mã NV người giao',
      'Người nhận', 'Mã NV người nhận', 'Phòng ban người nhận', 'Số nội dung', 'Loại nội dung'
    ],
    rows: data.items.map(function (h) {
      return [
        h.code, HANDOVER_TYPES[h.handoverType] || h.handoverType, STATUS_LABELS[h.status] || h.status,
        csvDateTime_(h.createdAt), csvDateTime_(h.updatedAt), csvDateTime_(h.confirmedAt), h.senderName, h.senderEmployeeId,
        h.receiverName, h.receiverEmployeeId, h.receiverDepartment, h.itemCount,
        h.categories.map(function (code) { return categories[code] ? categories[code].name : code; }).join(', ')
      ];
    }),
    total: data.total
  };
}

function exportStockCsv_(filters) {
  var data = apiVppListProducts_(filters);
  return {
    fileBase: 'ton-kho-van-phong-pham',
    header: [
      'Mã SP', 'Tên sản phẩm', 'Nhóm', 'ĐVT', 'Danh mục', 'Tồn thực tế', 'Đang giữ chỗ', 'Khả dụng', 'Tồn tối thiểu',
      'Tình trạng', 'Tồn đầu kỳ (ghi nhận gốc)', 'Giá tham khảo (VND)', 'Số định mức áp dụng', 'Ghi chú'
    ],
    rows: data.products.map(function (p) {
      return [
        p.productCode, p.productName, p.category, p.unit, EXPORT_LABELS_.catalog[p.catalogStatus] || p.catalogStatus,
        p.stock.onHand, p.stock.reserved, p.stock.available, p.stock.minimumStock,
        EXPORT_LABELS_.stock[p.stock.status] || p.stock.status, p.stock.rawInitialValue, p.referencePrice, p.normCount || 0, p.note
      ];
    }),
    total: data.products.length
  };
}

function exportMovementsCsv_(filters) {
  var data = apiVppListMovements_(Object.assign({}, filters, { exportAll: true }));
  return {
    fileBase: 'lich-su-kho',
    header: [
      'Thời gian', 'Mã SP', 'Sản phẩm', 'ĐVT', 'Loại', 'Số lượng', 'Tồn trước', 'Tồn sau', 'Giữ chỗ trước', 'Giữ chỗ sau',
      'Phiếu bàn giao', 'Đề xuất', 'Người thao tác', 'Lý do'
    ],
    rows: data.items.map(function (m) {
      return [
        csvDateTime_(m.createdAt), m.productCode, m.productName, m.unit, EXPORT_LABELS_.movement[m.movementType] || m.movementType,
        signedMovementQuantity_(m.movementType, m.quantity), m.onHandBefore, m.onHandAfter, m.reservedBefore, m.reservedAfter,
        m.handoverCode, m.proposalCode, m.actorName, m.reason
      ];
    }),
    total: data.total
  };
}

function exportProposalsCsv_(filters) {
  var data = apiVppListProposals_(Object.assign({}, filters, { exportAll: true }));
  return {
    fileBase: 'de-xuat-van-phong-pham',
    header: [
      'Mã đề xuất', 'Ngày gửi', 'Trạng thái', 'Người đề xuất', 'Mã NV', 'Chức vụ', 'Phòng ban', 'Số dòng', 'Ngoài định mức',
      'SP mới chờ quyết định', 'Ước tính (VND)', 'Lý do', 'Ghi chú quản trị', 'Duyệt lúc', 'Người duyệt', 'Nhập kho lúc', 'Đóng lúc'
    ],
    rows: data.items.map(function (p) {
      return [
        p.proposalCode, csvDateTime_(p.createdAt), EXPORT_LABELS_.proposal[p.status] || p.status, p.requesterName,
        p.requesterEmployeeId, p.requesterPosition, p.department, p.itemCount, p.outsideNormCount, p.pendingProductCount,
        p.estimatedTotal, p.reason, p.adminNote, csvDateTime_(p.reviewedAt), p.reviewedBy, csvDateTime_(p.receivedAt),
        csvDateTime_(p.closedAt)
      ];
    }),
    total: data.total
  };
}

/** Dòng hàng của phiếu nhập / xuất kho VPP (như sheet "Nhap VPP" / "Xuat VPP" của file Excel cũ) theo bộ lọc trang Phiếu nhập / xuất. */
function exportVppVoucherLinesCsv_(filters) {
  var data = apiVppListVouchers_(Object.assign({}, filters, { exportAll: true }));
  var products = loadProductMap_();
  var rows = [];
  data.items.forEach(function (v) {
    voucherLines_(v.voucherId, products).forEach(function (l) {
      rows.push([
        v.voucherCode, EXPORT_LABELS_.voucherType[v.voucherType] || v.voucherType, v.voucherDate, l.productCode, l.productName, l.unit,
        l.quantity, l.unitPrice, l.amount, v.voucherType === 'IN' ? (STOCK_IN_REASONS[v.reasonType] || v.reasonType) : '', v.supplier,
        v.invoiceNo, v.department, v.receiverName, v.note, v.actorName, csvDateTime_(v.createdAt)
      ]);
    });
  });
  var capped = exportCapped_(rows);
  return {
    fileBase: 'phieu-nhap-xuat-vpp',
    header: [
      'Số phiếu', 'Loại', 'Ngày', 'Mã VPP', 'Tên vật tư', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Lý do nhập', 'Nhà cung cấp',
      'Số hóa đơn', 'Phòng ban', 'Người nhận', 'Ghi chú', 'Người lập', 'Lập lúc'
    ],
    rows: capped.rows,
    total: capped.total
  };
}

// ---------------------------------------------------------------- Đồng phục

function uniformMovementQuantity_(type, quantity) {
  if (type === 'ADJUSTMENT') return quantity;
  return type === 'OUT' || type === 'RELEASE' || type === 'DISPOSE' ? -Math.abs(quantity) : Math.abs(quantity);
}

function exportCapped_(rows) {
  return { rows: rows.slice(0, APP.EXPORT_MAX_ROWS), total: rows.length };
}

/** Tồn kho đồng phục: một dòng / mặt hàng (mẫu × size × tình trạng). */
function exportUniformStockCsv_(filters) {
  var data = apiDpListStock_({ q: filters.q, includeInactive: filters.includeInactive === true });
  var L = EXPORT_LABELS_;
  var rows = [];
  data.models.forEach(function (m) {
    m.skus.forEach(function (s) {
      var t = s.totals || { received: 0, handedOver: 0, returned: 0, disposed: 0, adjusted: 0 };
      rows.push([
        m.modelCode, m.modelName, L.uniformKind[m.kind] || m.kind, L.uniformGender[m.gender] || m.gender, s.size,
        L.uniformCondition[s.condition] || s.condition, s.skuCode, t.received, t.handedOver, t.returned, t.adjusted, t.disposed,
        s.stock.onHand, s.stock.reserved, s.stock.available,
        s.stock.minimumStock, L.stock[s.stock.status] || s.stock.status, m.unit, m.referencePrice, m.countsTowardQuota,
        m.appliesTo, m.active && s.active
      ]);
    });
  });
  var capped = exportCapped_(rows);
  return {
    fileBase: 'ton-kho-dong-phuc',
    header: [
      'Mã mẫu', 'Mẫu', 'Loại', 'Giới tính', 'Size', 'Tình trạng hàng', 'Mã hàng', 'Tồn đầu kỳ (gồm nhập bổ sung)', 'Đã bàn giao',
      'Trả về kho', 'Kiểm kê (±)', 'Thanh lý', 'Tồn thực tế', 'Đang giữ chỗ', 'Khả dụng',
      'Tồn tối thiểu', 'Tình trạng tồn', 'ĐVT', 'Giá tham khảo (VND)', 'Tính tiêu chuẩn năm', 'Đối tượng sử dụng', 'Đang dùng'
    ],
    rows: capped.rows,
    total: capped.total
  };
}

function exportUniformMovementsCsv_(filters) {
  var data = apiDpListMovements_(Object.assign({}, filters, { exportAll: true }));
  var L = EXPORT_LABELS_;
  return {
    fileBase: 'lich-su-kho-dong-phuc',
    header: [
      'Thời gian', 'Mã hàng', 'Mẫu', 'Size', 'Tình trạng hàng', 'Loại', 'Số lượng', 'Tồn trước', 'Tồn sau', 'Giữ chỗ trước',
      'Giữ chỗ sau', 'Phiếu bàn giao', 'Mã NV', 'Người thao tác', 'Lý do'
    ],
    rows: data.items.map(function (m) {
      return [
        csvDateTime_(m.createdAt), m.skuCode, m.modelName, m.size, L.uniformCondition[m.condition] || m.condition,
        L.uniformMovement[m.movementType] || m.movementType, uniformMovementQuantity_(m.movementType, m.quantity), m.onHandBefore,
        m.onHandAfter, m.reservedBefore, m.reservedAfter, m.handoverCode, m.employeeId, m.actorName, m.reason
      ];
    }),
    total: data.total
  };
}

/** Sổ cấp phát theo nhân viên của một năm — kèm phần tiêu chuẩn còn lại (lập danh sách đặt may). */
function exportUniformEmployeesCsv_(filters) {
  var data = apiDpListEmployees_(filters);
  var L = EXPORT_LABELS_;
  var capped = exportCapped_(data.employees.map(function (e) {
    var u = e.usage;
    return [
      data.year, e.employeeId, e.fullName, e.department, e.position, e.status === 'ACTIVE' ? 'Đang làm' : 'Ngừng',
      L.uniformGender[e.gender] || '', e.uniformSize, e.scope ? e.scope.scopeName : (u.source === 'NONE' ? 'Không áp dụng' : 'Mặc định'),
      u.yearlyQuota, u.issued, u.legacy, u.pending, u.remaining, e.holdings.loaned, e.holdings.overdue, e.holdings.holding,
      csvDateTime_(e.lastIssuedAt)
    ];
  }));
  return {
    fileBase: 'cap-phat-dong-phuc-' + data.year,
    header: [
      'Năm', 'Mã NV', 'Họ tên', 'Phòng ban', 'Chức vụ', 'Trạng thái', 'Giới tính', 'Size', 'Nhóm tiêu chuẩn', 'Tiêu chuẩn năm',
      'Đã cấp (phiếu đồng phục)', 'Đã cấp (ghi ở phiếu cũ)', 'Chờ ký', 'Còn lại', 'Đang mượn', 'Mượn quá hạn', 'Đang giữ (tổng)',
      'Lần cấp gần nhất'
    ],
    rows: capped.rows,
    total: capped.total
  };
}

function exportUniformHoldingsCsv_(filters) {
  var data = apiDpListHoldings_(filters);
  var L = EXPORT_LABELS_;
  var capped = exportCapped_(data.items.map(function (h) {
    return [
      h.employeeName, h.employeeId, h.department, h.handoverCode, L.issueKind[h.issueKind] || h.issueKind, h.modelName, h.size,
      L.uniformCondition[h.condition] || h.condition, h.skuCode, h.quantity, h.returned, h.outstanding, h.dueDate, h.overdue,
      csvDateTime_(h.confirmedAt)
    ];
  }));
  return {
    fileBase: 'muon-tra-dong-phuc',
    header: [
      'Nhân viên', 'Mã NV', 'Phòng ban', 'Phiếu bàn giao', 'Hình thức', 'Mẫu', 'Size', 'Tình trạng hàng', 'Mã hàng', 'SL nhận',
      'Đã trả / thu hồi', 'Còn giữ', 'Hạn trả', 'Quá hạn', 'Ký nhận lúc'
    ],
    rows: capped.rows,
    total: capped.total
  };
}

/**
 * Admin: { dataset, filters } → { header: { fileBase, rows, total }, body: csv } — filters đã được Worker kiểm tra (zod). Route đánh
 * dấu stream: doPost trả DÒNG phong bì JSON (header) + "\n" + nội dung CSV nguyên văn (Worker chuyển thẳng, không phân tích).
 */
function apiAdminExportCsv_(data) {
  var builders = {
    'handovers.csv': exportHandoversCsv_,
    'stock.csv': exportStockCsv_,
    'movements.csv': exportMovementsCsv_,
    'proposals.csv': exportProposalsCsv_,
    'vpp-vouchers.csv': exportVppVoucherLinesCsv_,
    'uniform-stock.csv': exportUniformStockCsv_,
    'uniform-movements.csv': exportUniformMovementsCsv_,
    'uniform-employees.csv': exportUniformEmployeesCsv_,
    'uniform-holdings.csv': exportUniformHoldingsCsv_
  };
  var dataset = String(data.dataset || '');
  if (!Object.prototype.hasOwnProperty.call(builders, dataset)) throw appError_('NOT_FOUND', 'Không có dữ liệu xuất này.');
  var filters = data.filters && typeof data.filters === 'object' && !Array.isArray(data.filters) ? data.filters : {};
  var table = builders[dataset](filters);
  return {
    header: { fileBase: table.fileBase, rows: table.rows.length, total: table.total },
    body: toCsv_(table.header, table.rows)
  };
}
