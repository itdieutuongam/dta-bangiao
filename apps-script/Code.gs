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

function doPost(e) {
  var action = '';
  try {
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw) throw appError_('BAD_REQUEST', 'Thiếu nội dung request.');
    if (raw.length > APP.MAX_REQUEST_CHARS) throw appError_('BAD_REQUEST', 'Request quá lớn.');

    var request = verifyRequest_(raw);
    action = request.action;
    var routes = getRoutes_();
    var route = Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
    if (!route) throw appError_('BAD_REQUEST', 'Action không hợp lệ: ' + action);
    if (!scopeAllows_(route.scope, request.scope)) throw appError_('FORBIDDEN', 'Không đủ quyền thực hiện ' + action + '.');

    var data = route.handler(request.payload, request);
    return jsonOutput_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    return jsonOutput_({ ok: false, error: toErrorPayload_(err, action) });
  }
}

/** Bảng action → handler. scope: public (mọi request hợp lệ) · system · admin. */
function getRoutes_() {
  return {
    health: { scope: 'public', handler: apiHealth_ },
    listEmployees: { scope: 'public', handler: apiListEmployees_ },
    listCategories: { scope: 'public', handler: apiListCategories_ },
    createHandover: { scope: 'public', handler: apiCreateHandover_ },
    getHandoverByToken: { scope: 'public', handler: apiGetHandoverByToken_ },
    confirmHandover: { scope: 'public', handler: apiConfirmHandover_ },
    requestRevision: { scope: 'public', handler: apiRequestRevision_ },
    getPdfByToken: { scope: 'public', handler: apiGetPdfByToken_ },
    generatePdf: { scope: 'system', handler: apiGeneratePdf_ },
    adminListHandovers: { scope: 'admin', handler: apiAdminListHandovers_ },
    adminGetHandover: { scope: 'admin', handler: apiAdminGetHandover_ },
    adminUpdateHandover: { scope: 'admin', handler: apiAdminUpdateHandover_ },
    adminCancelHandover: { scope: 'admin', handler: apiAdminCancelHandover_ },
    adminRegenerateLink: { scope: 'admin', handler: apiAdminRegenerateLink_ },
    adminGetSignature: { scope: 'admin', handler: apiAdminGetSignature_ },
    adminGetPdf: { scope: 'admin', handler: apiAdminGetPdf_ },
    adminGeneratePdf: { scope: 'admin', handler: apiAdminGeneratePdf_ },
    refreshCache: { scope: 'admin', handler: apiRefreshCache_ }
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
    if (/^(INTERNAL|DRIVE_ERROR|SHEET_ERROR|PDF_ERROR|NOT_CONFIGURED|UNAUTHORIZED|FORBIDDEN)$/.test(err.appCode)) {
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

/** Kiểm tra Sheet + Drive (dùng cho GET /api/health). */
function apiHealth_() {
  var database = 'error';
  var drive = 'error';
  try {
    var ss = getSpreadsheet_();
    var missing = Object.keys(HEADERS).filter(function (name) { return !ss.getSheetByName(name); });
    database = missing.length ? 'error' : 'ok';
  } catch (e) {
    logError_('health.database', e);
  }
  try {
    getRootFolder_().getName();
    drive = 'ok';
  } catch (e) {
    logError_('health.drive', e);
  }
  return { database: database, drive: drive, version: APP.VERSION, time: nowIso_() };
}

/** Xóa cache nhân viên / loại bàn giao / cấu hình (sau khi sửa Sheet). */
function apiRefreshCache_() {
  invalidateCaches_();
  return { employees: getEmployees_().length, categories: getCategories_().length };
}
