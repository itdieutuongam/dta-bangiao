/**
 * Export.gs — xuất CSV cho trang quản trị (GET /api/admin/export/:dataset): handovers · stock · movements · proposals.
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
    INITIAL: 'Tồn đầu kỳ', IN: 'Nhập kho', RESERVE: 'Giữ chỗ', RELEASE: 'Trả giữ chỗ', OUT: 'Xuất kho', ADJUSTMENT: 'Điều chỉnh / kiểm kê'
  },
  proposal: {
    SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', PARTIALLY_APPROVED: 'Duyệt một phần', REJECTED: 'Từ chối', PURCHASED: 'Đã mua',
    RECEIVED: 'Đã nhập kho', CLOSED: 'Đã đóng'
  }
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
  return type === 'OUT' || type === 'RELEASE' ? -Math.abs(quantity) : Math.abs(quantity);
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

/**
 * Admin: { dataset, filters } → { header: { fileBase, rows, total }, body: csv } — filters đã được Worker kiểm tra (zod). Route đánh
 * dấu stream: doPost trả DÒNG phong bì JSON (header) + "\n" + nội dung CSV nguyên văn (Worker chuyển thẳng, không phân tích).
 */
function apiAdminExportCsv_(data) {
  var builders = {
    'handovers.csv': exportHandoversCsv_,
    'stock.csv': exportStockCsv_,
    'movements.csv': exportMovementsCsv_,
    'proposals.csv': exportProposalsCsv_
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
