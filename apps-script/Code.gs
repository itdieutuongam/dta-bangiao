/**
 * Code.gs — điểm vào Web App (JSON API, chỉ phục vụ Cloudflare Worker).
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as:     Me (tài khoản sở hữu Sheet/Drive)
 *   Who has access: Anyone
 * Người dùng cuối KHÔNG truy cập URL này; mọi request phải có chữ ký HMAC hợp lệ (Security.gs).
 */

function doGet() {
  return jsonOutput_({
    ok: true,
    data: {
      service: APP.NAME,
      version: APP.VERSION,
      message: 'DTA Handover Apps Script API đang hoạt động. Endpoint chỉ nhận POST có chữ ký từ Cloudflare Worker.'
    }
  });
}

/** Action chạy được cả khi cơ sở dữ liệu chưa nâng cấp (để chẩn đoán). */
var SCHEMA_EXEMPT_ACTIONS_ = { health: true, adminSystemInfo: true };

/**
 * Phiên bản code của CHÍNH file này — phải bằng APP.VERSION (Config.gs). Khác nhau = dự án Apps Script đang trộn code nhiều phiên
 * bản: thường do dán bản gộp vào Code.gs nhưng còn các file .gs cũ (v1) nạp SAU, ghi đè hằng số / hàm mới (bỏ qua OTP, mã băm…).
 * Giữ cùng giá trị với APP.VERSION và package.json (có test kiểm tra).
 */
var CODE_VERSION_ = '2.0.0';

/** Code đủ và cùng một phiên bản? Không → từ chối MỌI thao tác với hướng dẫn sửa (không chạy tiếp với code trộn lẫn). */
function assertCodeConsistent_() {
  var configVersion = typeof APP === 'object' && APP ? APP.VERSION : '';
  if (configVersion !== CODE_VERSION_ || typeof APP.SCHEMA_VERSION !== 'number') {
    throw appError_('NOT_CONFIGURED', 'Dự án Apps Script đang trộn code nhiều phiên bản (Config ' + (configVersion || '?') + ', Code ' +
      CODE_VERSION_ + ') — thường do còn file .gs cũ sau khi dán bản gộp. Xóa các file .gs khác, chỉ giữ một file DTA_Handover.gs, ' +
      'rồi Deploy → Manage deployments → New version.');
  }
}

/** Bảng định tuyến; thiếu file .gs (handler chưa được định nghĩa) → NOT_CONFIGURED nêu tên còn thiếu, không phải lỗi INTERNAL. */
function loadRoutes_() {
  try {
    return getRoutes_();
  } catch (e) {
    if (e instanceof ReferenceError) {
      throw appError_('NOT_CONFIGURED', 'Dự án Apps Script thiếu code (' + e.message + ') — hãy dán bản gộp dist/apps-script/DTA_Handover.gs ' +
        '(hoặc đủ các file .gs liệt kê trong README) rồi tạo New version.');
    }
    throw e;
  }
}

function doPost(e) {
  var action = '';
  try {
    assertCodeConsistent_();
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw) throw appError_('BAD_REQUEST', 'Thiếu nội dung request.');
    if (raw.length > APP.MAX_REQUEST_CHARS) throw appError_('BAD_REQUEST', 'Request quá lớn.');

    var request = verifyRequest_(raw);
    action = request.action;
    var routes = loadRoutes_();
    var route = Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
    if (!route) {
      throw appError_('UNKNOWN_ACTION', 'Apps Script chưa hỗ trợ thao tác "' + action + '" — hãy cập nhật code Apps Script lên v' +
        APP.VERSION + ' trở lên và tạo New version deployment.');
    }
    if (!scopeAllows_(route.scope, request.scope)) throw appError_('FORBIDDEN', 'Không đủ quyền thực hiện ' + action + '.');
    if (!SCHEMA_EXEMPT_ACTIONS_[action]) requireSchemaReady_();

    var data = route.handler(request.payload, request);
    if (route.stream) {
      // Tệp văn bản lớn (xuất CSV): DÒNG đầu là phong bì JSON nhỏ (JSON.stringify không có xuống dòng), phần sau là nội dung
      // nguyên văn — Worker đọc dòng đầu rồi chuyển thẳng phần còn lại cho trình duyệt (không phân tích hàng MB: giới hạn CPU).
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data.header }) + '\n' + data.body)
        .setMimeType(ContentService.MimeType.TEXT);
    }
    return jsonOutput_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    return jsonOutput_({ ok: false, error: toErrorPayload_(err, action) });
  }
}

/**
 * Bảng action → handler. scope: public (mọi request hợp lệ) · system · admin. stream: handler trả { header, body } — phản hồi là
 * dòng phong bì JSON + nội dung văn bản nguyên văn (xem doPost).
 */
function getRoutes_() {
  return {
    // Công khai (người nhận qua link, trang đề xuất VPP)
    health: { scope: 'public', handler: apiHealth_ },
    getHandoverByToken: { scope: 'public', handler: apiGetHandoverByToken_ },
    requestConfirmOtp: { scope: 'public', handler: apiRequestConfirmOtp_ },
    confirmHandover: { scope: 'public', handler: apiConfirmHandover_ },
    requestRevision: { scope: 'public', handler: apiRequestRevision_ },
    getPdfByToken: { scope: 'public', handler: apiGetPdfByToken_ },
    vppEmployeeLookup: { scope: 'public', handler: apiVppEmployeeLookup_ },
    vppPublicCatalog: { scope: 'public', handler: apiVppPublicCatalog_ },
    vppSubmitProposal: { scope: 'public', handler: apiVppSubmitProposal_ },
    // Hệ thống (Worker gọi nền)
    generatePdf: { scope: 'system', handler: apiGeneratePdf_ },
    // Quản trị — phiếu bàn giao (CHỈ admin tạo / sửa / hủy phiếu)
    adminOverview: { scope: 'admin', handler: apiAdminOverview_ },
    adminBadges: { scope: 'admin', handler: apiAdminBadges_ },
    adminSystemInfo: { scope: 'admin', handler: apiAdminSystemInfo_ },
    adminListEmployees: { scope: 'admin', handler: apiAdminListEmployees_ },
    adminListCategories: { scope: 'admin', handler: apiAdminListCategories_ },
    adminCreateHandover: { scope: 'admin', handler: apiAdminCreateHandover_ },
    adminListHandovers: { scope: 'admin', handler: apiAdminListHandovers_ },
    adminGetHandover: { scope: 'admin', handler: apiAdminGetHandover_ },
    adminUpdateHandover: { scope: 'admin', handler: apiAdminUpdateHandover_ },
    adminCancelHandover: { scope: 'admin', handler: apiAdminCancelHandover_ },
    adminRegenerateLink: { scope: 'admin', handler: apiAdminRegenerateLink_ },
    adminGetSignature: { scope: 'admin', handler: apiAdminGetSignature_ },
    adminGetPdf: { scope: 'admin', handler: apiAdminGetPdf_ },
    adminGeneratePdf: { scope: 'admin', handler: apiAdminGeneratePdf_ },
    adminExportCsv: { scope: 'admin', handler: apiAdminExportCsv_, stream: true },
    refreshCache: { scope: 'admin', handler: apiRefreshCache_ },
    // Quản trị — văn phòng phẩm
    vppDashboard: { scope: 'admin', handler: apiVppDashboard_ },
    vppListProducts: { scope: 'admin', handler: apiVppListProducts_ },
    vppSaveProduct: { scope: 'admin', handler: apiVppSaveProduct_ },
    vppListNorms: { scope: 'admin', handler: apiVppListNorms_ },
    vppSaveNorm: { scope: 'admin', handler: apiVppSaveNorm_ },
    vppSetScopeMapping: { scope: 'admin', handler: apiVppSetScopeMapping_ },
    vppStockIn: { scope: 'admin', handler: apiVppStockIn_ },
    vppStockAdjust: { scope: 'admin', handler: apiVppStockAdjust_ },
    vppListMovements: { scope: 'admin', handler: apiVppListMovements_ },
    vppHandoverContext: { scope: 'admin', handler: apiVppHandoverContext_ },
    vppReconcileHandover: { scope: 'admin', handler: apiVppReconcileHandover_ },
    vppDataReview: { scope: 'admin', handler: apiVppDataReview_ },
    vppMergeProduct: { scope: 'admin', handler: apiVppMergeProduct_ },
    vppPromoteProduct: { scope: 'admin', handler: apiVppPromoteProduct_ },
    vppSkipReview: { scope: 'admin', handler: apiVppSkipReview_ },
    vppSyncStock: { scope: 'admin', handler: apiVppSyncStock_ },
    vppListProposals: { scope: 'admin', handler: apiVppListProposals_ },
    vppGetProposal: { scope: 'admin', handler: apiVppGetProposal_ },
    vppReviewProposal: { scope: 'admin', handler: apiVppReviewProposal_ },
    vppRejectProposal: { scope: 'admin', handler: apiVppRejectProposal_ },
    vppSetProposalStatus: { scope: 'admin', handler: apiVppSetProposalStatus_ },
    vppReceiveProposal: { scope: 'admin', handler: apiVppReceiveProposal_ },
    vppProductDecision: { scope: 'admin', handler: apiVppProductDecision_ }
  };
}

function scopeAllows_(required, actual) {
  if (required === 'public') return actual === 'public' || actual === 'system' || actual === 'admin';
  if (required === 'system') return actual === 'system' || actual === 'admin';
  if (required === 'admin') return actual === 'admin';
  return false;
}

function toErrorPayload_(err, action) {
  if (err && err.appCode) {
    if (/^(INTERNAL|DRIVE_ERROR|SHEET_ERROR|PDF_ERROR|NOT_CONFIGURED|UNAUTHORIZED|FORBIDDEN|UNKNOWN_ACTION|INTEGRITY_ERROR|STOCK_INCONSISTENT|MAIL_ERROR)$/.test(err.appCode)) {
      logError_('doPost:' + action, err);
    }
    var out = { code: err.appCode, message: String(err.message) };
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  logError_('doPost:' + action, err);
  return { code: 'INTERNAL', message: 'Lỗi xử lý tại máy chủ dữ liệu (Apps Script).' };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function schemaVersion_() {
  return parseInt(getProp_(PROP.SCHEMA_VERSION), 10) || 0;
}

/** Kiểm tra Sheet + Drive (dùng cho GET /api/health). */
function apiHealth_() {
  var database = 'error';
  var drive = 'error';
  var schemaReady = schemaVersion_() >= APP.SCHEMA_VERSION;
  try {
    var ss = getSpreadsheet_();
    var missing = Object.keys(HEADERS).filter(function (name) { return !ss.getSheetByName(name); });
    database = missing.length || !schemaReady ? 'error' : 'ok';
  } catch (e) {
    logError_('health.database', e);
  }
  try {
    getRootFolder_().getName();
    drive = 'ok';
  } catch (e) {
    logError_('health.drive', e);
  }
  return { database: database, drive: drive, version: APP.VERSION, schemaReady: schemaReady, time: nowIso_() };
}

/** Trang Cài đặt (admin): phiên bản, cấu trúc dữ liệu, sheet thiếu cột — không trả secret. */
function apiAdminSystemInfo_() {
  var schema = schemaVersion_();
  var info = {
    version: APP.VERSION,
    schemaVersion: schema,
    requiredSchemaVersion: APP.SCHEMA_VERSION,
    schemaReady: schema >= APP.SCHEMA_VERSION,
    sheets: [],
    spreadsheetName: '',
    spreadsheetUrl: '',
    driveFolderUrl: '',
    pendingChanges: []
  };
  try {
    var ss = getSpreadsheet_();
    info.spreadsheetName = ss.getName();
    info.spreadsheetUrl = ss.getUrl();
    info.pendingChanges = schemaChangesNeeded_(ss);
    info.sheets = Object.keys(HEADERS).map(function (name) {
      var sheet = ss.getSheetByName(name);
      return { name: name, exists: Boolean(sheet), rows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0 };
    });
  } catch (e) {
    logError_('system.spreadsheet', e);
    info.pendingChanges = ['Không mở được Google Sheet: ' + e.message];
  }
  try {
    info.driveFolderUrl = getRootFolder_().getUrl();
  } catch (e) {
    logError_('system.drive', e);
    info.driveFolderUrl = '';
    info.pendingChanges.push('Không mở được thư mục Drive DTA_HANDOVER: ' + e.message);
  }
  // Email (mã OTP, thông báo): số người nhận thông báo, lỗi gửi gần nhất, hạn mức còn lại / chưa cấp quyền gửi mail.
  // Trang Cài đặt là trang chẩn đoán: lỗi đọc CAU_HINH hiện thành mục cần xử lý, không làm hỏng cả trang.
  var settingsError = '';
  try {
    info.notify = notifyStatus_();
  } catch (e) {
    logError_('system.notify_status', e);
    settingsError = 'Không đọc được cấu hình email trong CAU_HINH: ' + e.message;
    info.pendingChanges.push(settingsError);
    info.notify = notifyStatusWithoutSettings_();
  }
  try {
    info.notify.mailQuotaRemaining = MailApp.getRemainingDailyQuota();
    info.notify.mailError = settingsError;
  } catch (e) {
    logError_('system.mail_quota', e);
    info.notify.mailQuotaRemaining = null;
    info.notify.mailError = 'Chưa dùng được MailApp (thường do chưa cấp quyền gửi email cho script): ' + e.message;
  }
  // Bước phụ (ghi lịch sử…) lỗi sau khi thao tác đã lưu — quản trị viên cần biết để kiểm tra sheet LICH_SU.
  readPostCommitErrors_().forEach(function (x) {
    info.pendingChanges.push('Đã lưu thao tác nhưng bước phụ "' + x.context + '"' + (x.ref ? ' (' + x.ref + ')' : '') +
      ' lỗi lúc ' + formatDisplayDateTime_(x.at) + ': ' + x.message + ' — kiểm tra sheet LICH_SU / VPP.');
  });
  return info;
}

/** Xóa cache nhân viên / loại bàn giao / cấu hình / danh mục VPP (sau khi sửa Sheet). */
function apiRefreshCache_() {
  invalidateCaches_();
  return { employees: getEmployees_().length, categories: getCategories_().length };
}
