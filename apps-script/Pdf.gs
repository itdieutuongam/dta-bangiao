/**
 * Pdf.gs — sinh PDF biên bản (HTML → PDF bằng HtmlService) và lưu vào Drive/pdf/YYYY/MM.
 * Nội dung tùy biến qua sheet CAU_HINH: ORG_NAME, ORG_FULL_NAME, ORG_ADDRESS, PDF_TITLE, PDF_TITLE_VPP,
 * PDF_SHOW_NATIONAL_HEADER, LOGO_FILE_ID, PDF_FOOTER.
 *
 * Toàn vẹn: trước khi dựng PDF, biên bản hiện tại phải khớp lúc ký (content_hash, record_hash, niêm phong record_seal — xem
 * integrityOf_) và ảnh chữ ký phải khớp signature_sha256 — dữ liệu đã bị sửa trên Sheet / file bị thay → KHÔNG tạo PDF
 * (INTEGRITY_ERROR).
 */

/**
 * Đảm bảo biên bản đã xác nhận có PDF; trả về fileId.
 * Phần nặng (dựng PDF) chạy ngoài khóa; chỉ bước ghi kết quả vào Sheet chạy trong khóa.
 */
function ensurePdf_(handoverId, force, actor, sealKey) {
  var found = findHandoverById_(handoverId);
  if (!found) throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
  var rec = found.record;
  if (rec.status !== STATUS.CONFIRMED) {
    throw appError_('INVALID_STATE', 'Chỉ tạo PDF cho biên bản đã được xác nhận.');
  }
  if (!force && rec.pdf_file_id && driveFileExists_(rec.pdf_file_id)) return rec.pdf_file_id;

  var items = loadItems_(handoverId, rec);
  // Toàn bộ biên bản đã ký (nội dung, ý kiến người nhận, thời điểm lập / ký, chữ ký) phải khớp lúc ký — kể cả niêm phong
  // (khi Worker gửi kèm khóa). Dữ liệu đã bị sửa → không dựng PDF mới từ dữ liệu đã sửa; PDF đang có (bản gốc) vẫn tải được.
  var integrity = integrityOf_(rec, items, sealKey);
  if (integrity.status === 'MISMATCH') {
    throw appError_('INTEGRITY_ERROR',
      'Biên bản trên Google Sheet không còn khớp với bản người nhận đã ký (' + integrityProblem_(integrity) + '). Không tạo PDF từ ' +
      'dữ liệu đã sửa — hãy kiểm tra lịch sử chỉnh sửa của Sheet (bản PDF gốc, nếu có, vẫn giữ nguyên).');
  }
  var signature = loadSignatureForPdf_(rec);

  var html = buildHandoverPdfHtml_(rec, items, getCategoryMap_(), signature, getSettings_());
  var blob;
  try {
    blob = HtmlService.createHtmlOutput(html).getAs(MimeType.PDF);
  } catch (e) {
    logError_('ensurePdf_.convert', e);
    try {
      blob = Utilities.newBlob(html, MimeType.HTML, rec.handover_code + '.html').getAs(MimeType.PDF);
    } catch (e2) {
      logError_('ensurePdf_.convertFallback', e2);
      throw appError_('PDF_ERROR', 'Không tạo được file PDF. Vui lòng thử lại sau.');
    }
  }
  blob.setName(rec.handover_code + '.pdf');

  var file;
  try {
    var folder = withScriptLock_(function () { return getMonthFolder_('pdf', rec.confirmed_at || nowIso_()); });
    file = createFileInFolder_(folder, blob);
  } catch (e) {
    if (e && e.appCode) throw e;
    logError_('ensurePdf_.save', e);
    throw appError_('DRIVE_ERROR', 'Không lưu được PDF vào Google Drive.');
  }

  return withScriptLock_(function () {
    var fresh = findHandoverById_(handoverId);
    if (!fresh) {
      trashFileQuietly_(file.getId());
      throw appError_('NOT_FOUND', 'Không tìm thấy biên bản.');
    }
    var current = fresh.record.pdf_file_id;
    // Một request khác vừa tạo xong PDF → dùng file đó, bỏ file trùng (file vừa tạo, chưa ai dùng).
    if (!force && current && current !== file.getId() && driveFileExists_(current)) {
      trashFileQuietly_(file.getId());
      return current;
    }
    updateRowFields_(SHEETS.HANDOVERS, fresh.rowIndex, fresh.record, {
      pdf_file_id: file.getId(),
      pdf_file_url: file.getUrl()
    });
    // "Tạo lại PDF": bản cũ được lưu trữ trong pdf-archive (không đưa vào thùng rác).
    if (current && current !== file.getId()) archivePdfQuietly_(current);
    appendHistory_(handoverId, 'PDF_GENERATED', actor ? actorLabel_(actor) : 'Hệ thống', fresh.record.status, fresh.record.status,
      'Tạo file PDF ' + rec.handover_code + '.pdf' + (current && force ? ' (bản cũ chuyển vào pdf-archive)' : ''),
      { fileId: file.getId(), force: Boolean(force), previousFileId: current || '' });
    return file.getId();
  });
}

/** Ảnh chữ ký (data URI) + kiểm tra SHA-256 khớp với lúc ký. */
function loadSignatureForPdf_(rec) {
  if (!rec.signature_file_id) return '';
  var got = getSystemFile_(rec.signature_file_id, 'image/png');
  var bytes = got.blob.getBytes();
  if (rec.signature_sha256 && sha256BytesHex_(bytes) !== rec.signature_sha256) {
    throw appError_('INTEGRITY_ERROR', 'Ảnh chữ ký trên Google Drive không khớp với chữ ký lúc xác nhận. Không tạo PDF.');
  }
  return 'data:image/png;base64,' + Utilities.base64Encode(bytes);
}

/**
 * Một dòng nội dung trên PDF. Trường in ra: theo cấu hình loại (nhãn, thứ tự riêng) + MỌI trường khác có dữ liệu (nhãn mặc định)
 * — đổi cấu hình LOAI_BAN_GIAO sau khi ký (ví dụ bỏ ô Serial) không làm mất dữ liệu đã ký khỏi PDF.
 */
function describeItemForPdf_(item, category) {
  var labels = {};
  var order = [];
  (category ? category.fields : []).concat(ITEM_FIELDS).forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(labels, f.key)) return;
    labels[f.key] = f.label;
    order.push(f.key);
  });
  var title = item.itemName;
  var descriptionIsTitle = false;
  if (!title) {
    title = item.description;
    descriptionIsTitle = true;
  }
  var statusKey = item.condition ? 'condition' : item.workStatus ? 'workStatus' : '';
  var details = [];
  order.forEach(function (key) {
    if (key === 'itemName' || key === 'quantity' || key === 'note' || key === statusKey) return;
    if (key === 'description' && descriptionIsTitle) return;
    var value = item[key];
    if (value === null || value === undefined || value === '') return;
    if (key === 'deadline') value = formatDisplayDate_(value);
    details.push({ label: labels[key] || key, value: String(value) });
  });
  return {
    title: title || '',
    details: details,
    status: statusKey ? item[statusKey] : '',
    quantity: item.quantity === null || item.quantity === undefined ? '' : String(item.quantity),
    note: item.note || ''
  };
}

function pdfStyles_() {
  return '@page { size: A4; margin: 16mm 14mm; }' +
    'body { font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; color: #1c1917; line-height: 1.45; }' +
    'table { border-collapse: collapse; width: 100%; }' +
    '.header td { vertical-align: top; }' +
    '.org { width: 45%; }' +
    '.org-name { font-weight: bold; font-size: 13px; color: #5b3a1f; letter-spacing: 0.5px; }' +
    '.org-sub { font-size: 10px; color: #57534e; }' +
    '.nation { text-align: center; }' +
    '.nation-1 { font-weight: bold; font-size: 11.5px; }' +
    '.nation-2 { font-weight: bold; font-size: 12px; }' +
    '.nation-line { color: #57534e; font-size: 10px; }' +
    'h1 { text-align: center; font-size: 18px; margin: 18px 0 2px; color: #3f2a17; letter-spacing: 0.5px; }' +
    '.code { text-align: center; font-size: 12px; margin-bottom: 12px; }' +
    'h2 { font-size: 12.5px; margin: 14px 0 6px; color: #5b3a1f; text-transform: uppercase; }' +
    '.info td { padding: 2px 0; vertical-align: top; }' +
    '.info .label { width: 120px; color: #57534e; }' +
    '.parties td.party { width: 50%; vertical-align: top; padding-right: 10px; }' +
    '.items th { background: #f3eadb; border: 1px solid #a8a29e; padding: 5px 4px; font-size: 11px; }' +
    '.items td { border: 1px solid #a8a29e; padding: 5px 4px; vertical-align: top; }' +
    '.center { text-align: center; }' +
    '.right { text-align: right; }' +
    '.item-title { font-weight: bold; }' +
    '.detail { font-size: 10.5px; margin-top: 2px; }' +
    '.muted { color: #57534e; }' +
    '.note-box { border: 1px solid #d6d3d1; padding: 6px 8px; background: #fafaf9; }' +
    '.sign td { width: 50%; text-align: center; vertical-align: top; padding-top: 6px; }' +
    '.sig-title { font-weight: bold; }' +
    '.sig-sub { font-size: 10px; color: #57534e; font-style: italic; }' +
    '.sig-space { height: 70px; }' +
    '.signature { margin: 4px auto; }' +
    '.sig-name { font-weight: bold; margin-top: 4px; }' +
    '.sig-meta { font-size: 10px; color: #57534e; }' +
    '.footer { margin-top: 18px; border-top: 1px solid #d6d3d1; padding-top: 6px; font-size: 9.5px; color: #57534e; }' +
    '.hash { font-family: "Courier New", monospace; font-size: 8.5px; word-break: break-all; }';
}

function buildHandoverPdfHtml_(rec, items, categoryMap, signatureDataUri, settings) {
  var esc = escapeHtml_;
  var multiline = function (s) { return esc(s).replace(/\n/g, '<br>'); };
  var isSupply = effectiveHandoverType_(rec, items) === 'OFFICE_SUPPLY';
  var orgName = settings.ORG_NAME || 'DIỆU TƯỚNG AM';
  var title = isSupply
    ? (settings.PDF_TITLE_VPP || 'BIÊN BẢN BÀN GIAO VĂN PHÒNG PHẨM')
    : (settings.PDF_TITLE || 'BIÊN BẢN BÀN GIAO');
  var showNational = String(settings.PDF_SHOW_NATIONAL_HEADER || 'TRUE').toUpperCase() !== 'FALSE';
  var logo = settings.LOGO_FILE_ID ? loadImageDataUri_(settings.LOGO_FILE_ID) : '';

  var created = new Date(rec.created_at);
  var dayText = isNaN(created.getTime())
    ? ''
    : 'Hôm nay, ngày ' + Utilities.formatDate(created, APP.TIMEZONE, 'dd') +
      ' tháng ' + Utilities.formatDate(created, APP.TIMEZONE, 'MM') +
      ' năm ' + Utilities.formatDate(created, APP.TIMEZONE, 'yyyy') + ', hai bên tiến hành bàn giao các nội dung sau:';

  var itemsTable;
  if (isSupply) {
    var supplyRows = items.map(function (item, index) {
      return '<tr>' +
        '<td class="center">' + (index + 1) + '</td>' +
        '<td><div class="item-title">' + esc(item.itemName) + '</div></td>' +
        '<td class="center">' + esc(item.unit) + '</td>' +
        '<td class="center">' + esc(item.quantity === null ? '' : String(item.quantity)) + '</td>' +
        '<td>' + multiline(item.note) + '</td>' +
        '</tr>';
    }).join('');
    itemsTable = '<table class="items"><thead><tr>' +
      '<th style="width:28px">STT</th><th>Tên văn phòng phẩm</th><th style="width:70px">ĐVT</th>' +
      '<th style="width:50px">SL</th><th style="width:150px">Ghi chú</th>' +
      '</tr></thead><tbody>' + supplyRows + '</tbody></table>';
  } else {
    var rows = items.map(function (item, index) {
      var cat = categoryMap[item.category];
      var d = describeItemForPdf_(item, cat);
      var detailHtml = d.details.map(function (x) {
        return '<div class="detail"><span class="muted">' + esc(x.label) + ':</span> ' + multiline(x.value) + '</div>';
      }).join('');
      return '<tr>' +
        '<td class="center">' + (index + 1) + '</td>' +
        '<td>' + esc(cat ? cat.name : item.category) + '</td>' +
        '<td><div class="item-title">' + multiline(d.title) + '</div>' + detailHtml + '</td>' +
        '<td class="center">' + esc(d.quantity) + '</td>' +
        '<td>' + multiline(d.status) + '</td>' +
        '<td>' + multiline(d.note) + '</td>' +
        '</tr>';
    }).join('');
    itemsTable = '<table class="items"><thead><tr>' +
      '<th style="width:28px">STT</th><th style="width:80px">Loại</th><th>Nội dung</th>' +
      '<th style="width:34px">SL</th><th style="width:90px">Tình trạng</th><th style="width:110px">Ghi chú</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  var receiverLines = [
    ['Họ và tên', rec.receiver_name],
    ['Mã nhân viên', rec.receiver_employee_id],
    ['Phòng ban', rec.receiver_department],
    ['Chức vụ', rec.receiver_position],
    ['Email', rec.receiver_email]
  ].filter(function (x) { return x[1]; });

  var senderLines = [['Họ và tên', rec.sender_name], ['Mã nhân viên', rec.sender_employee_id]].filter(function (x) { return x[1]; });

  var infoTable = function (lines) {
    return '<table class="info">' + lines.map(function (x) {
      return '<tr><td class="label">' + esc(x[0]) + ':</td><td>' + esc(x[1]) + '</td></tr>';
    }).join('') + '</table>';
  };

  var signatureHtml = signatureDataUri
    ? '<img class="signature" src="' + signatureDataUri + '" width="210" alt="Chữ ký">'
    : '<div class="sig-space"></div>';

  var header = '<table class="header"><tr>' +
    '<td class="org">' +
      (logo ? '<img src="' + logo + '" height="52" alt="Logo"><br>' : '') +
      '<div class="org-name">' + esc(orgName) + '</div>' +
      (settings.ORG_FULL_NAME ? '<div class="org-sub">' + esc(settings.ORG_FULL_NAME) + '</div>' : '') +
      (settings.ORG_ADDRESS ? '<div class="org-sub">' + esc(settings.ORG_ADDRESS) + '</div>' : '') +
    '</td>' +
    (showNational
      ? '<td class="nation"><div class="nation-1">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>' +
        '<div class="nation-2">Độc lập – Tự do – Hạnh phúc</div><div class="nation-line">―――――――――</div></td>'
      : '<td></td>') +
    '</tr></table>';

  var integrityHtml = rec.content_hash
    ? '<br>Mã toàn vẹn nội dung (SHA-256): <span class="hash">' + esc(rec.content_hash) + '</span>' +
      (rec.signature_sha256 ? '<br>Mã toàn vẹn chữ ký (SHA-256): <span class="hash">' + esc(rec.signature_sha256) + '</span>' : '')
    : '';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(rec.handover_code) + '</title><style>' +
    pdfStyles_() +
    '</style></head><body>' +
    header +
    '<h1>' + esc(title) + '</h1>' +
    '<div class="code">Số: <b>' + esc(rec.handover_code) + '</b></div>' +
    (dayText ? '<div>' + esc(dayText) + '</div>' : '') +
    '<table class="parties"><tr>' +
      '<td class="party"><h2>Bên giao</h2>' + infoTable(senderLines) + '</td>' +
      '<td class="party"><h2>Bên nhận</h2>' + infoTable(receiverLines) + '</td>' +
    '</tr></table>' +
    '<h2>' + (isSupply ? 'Danh sách văn phòng phẩm' : 'Nội dung bàn giao') + ' (' + items.length + ')</h2>' +
    itemsTable +
    (rec.note ? '<h2>Ghi chú</h2><div class="note-box">' + multiline(rec.note) + '</div>' : '') +
    (rec.receiver_comment ? '<h2>Ý kiến người nhận</h2><div class="note-box">' + multiline(rec.receiver_comment) + '</div>' : '') +
    '<h2>Xác nhận</h2>' +
    '<div>Người nhận đã kiểm tra và xác nhận đã nhận đầy đủ các nội dung bàn giao nêu trên.</div>' +
    '<table class="sign"><tr>' +
      '<td><div class="sig-title">BÊN GIAO</div><div class="sig-sub">(Người lập biên bản)</div>' +
        '<div class="sig-space"></div><div class="sig-name">' + esc(rec.sender_name) + '</div>' +
        '<div class="sig-meta">Lập lúc ' + esc(formatDisplayDateTime_(rec.created_at)) + '</div></td>' +
      '<td><div class="sig-title">BÊN NHẬN</div><div class="sig-sub">(Đã ký xác nhận điện tử)</div>' +
        signatureHtml + '<div class="sig-name">' + esc(rec.receiver_name) + '</div>' +
        '<div class="sig-meta">Xác nhận lúc ' + esc(formatDisplayDateTime_(rec.confirmed_at)) + '</div></td>' +
    '</tr></table>' +
    '<div class="footer">' + esc(settings.PDF_FOOTER || '') +
      '<br>Mã biên bản: ' + esc(rec.handover_code) + ' · Mã tham chiếu: ' + esc(rec.handover_id) +
      ' · Xuất PDF lúc ' + esc(formatDisplayDateTime_(nowIso_())) + ' (giờ Việt Nam)' +
      integrityHtml + '</div>' +
    '</body></html>';
}
