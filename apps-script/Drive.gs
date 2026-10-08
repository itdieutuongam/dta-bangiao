/**
 * Drive.gs — lưu chữ ký & PDF trên Google Drive.
 *
 *   DTA_HANDOVER/
 *     signatures/YYYY/MM/BG-YYYYMMDD-XXXX-signature.png
 *     pdf/YYYY/MM/BG-YYYYMMDD-XXXX.pdf
 *     pdf-archive/YYYY/MM/   (PDF cũ khi "Tạo lại PDF" — giữ lại, không xóa)
 *     backups/            (bản sao Spreadsheet do backupNow() / nâng cấp tạo)
 *
 * File mặc định PRIVATE (chỉ chủ sở hữu script). Hệ thống KHÔNG chia sẻ "Anyone with the link";
 * người dùng tải file qua Worker (API có kiểm tra quyền).
 * Chỉ trả về file nằm trong thư mục DTA_HANDOVER và đúng định dạng (PNG / PDF) — kể cả khi ID file trong Sheet
 * bị sửa tay trỏ tới file khác.
 * Shared Drive: DriveApp hoạt động với thư mục Shared Drive; nếu cần có thể bật Advanced Drive
 * Service (Drive API v3) và đặt Script Property USE_ADVANCED_DRIVE = true.
 */

function getRootFolder_() {
  var id = getProp_(PROP.DRIVE_FOLDER_ID);
  if (!id) throw appError_('NOT_CONFIGURED', 'Chưa cấu hình DRIVE_FOLDER_ID. Hãy chạy setupDatabase().');
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw appError_('DRIVE_ERROR', 'Không truy cập được thư mục Drive (DRIVE_FOLDER_ID sai hoặc không có quyền).');
  }
}

function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var folder = it.next();
    if (!folder.isTrashed()) return folder;
  }
  return parent.createFolder(name);
}

/** Thư mục <kind>/YYYY/MM (ID được nhớ trong Script Properties để không phải duyệt lại). */
function getMonthFolder_(kind, isoDate) {
  var iso = String(isoDate || nowIso_());
  var year = iso.slice(0, 4);
  var month = iso.slice(5, 7);
  var key = 'FOLDER_' + kind.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_' + year + '_' + month;
  var cachedId = getProp_(key);
  if (cachedId) {
    try {
      var cached = DriveApp.getFolderById(cachedId);
      if (!cached.isTrashed()) return cached;
    } catch (e) {
      // thư mục đã bị xóa → tạo lại bên dưới
    }
  }
  var root = getRootFolder_();
  var folder = getOrCreateChildFolder_(getOrCreateChildFolder_(getOrCreateChildFolder_(root, kind), year), month);
  setProp_(key, folder.getId());
  return folder;
}

function useAdvancedDrive_() {
  return getProp_(PROP.USE_ADVANCED_DRIVE).toLowerCase() === 'true' && typeof Drive !== 'undefined' && Drive.Files;
}

function createFileInFolder_(folder, blob) {
  if (useAdvancedDrive_()) {
    var created = Drive.Files.create(
      { name: blob.getName(), parents: [folder.getId()], mimeType: blob.getContentType() },
      blob,
      { supportsAllDrives: true, fields: 'id' }
    );
    return DriveApp.getFileById(created.id);
  }
  return folder.createFile(blob);
}

/** Kiểm tra base64 là ảnh PNG hợp lệ, dung lượng ≤ 300KB. Trả về mảng byte. */
function decodeSignaturePng_(base64) {
  var s = String(base64 || '');
  var invalid = { signature: 'Dữ liệu chữ ký không hợp lệ. Vui lòng ký lại.' };
  if (!s || s.length > Math.ceil((APP.SIGNATURE_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    throw validationError_(invalid);
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(s);
  } catch (e) {
    throw validationError_(invalid);
  }
  if (bytes.length > APP.SIGNATURE_MAX_BYTES) throw validationError_({ signature: 'Ảnh chữ ký quá lớn.' });
  var magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33) throw validationError_(invalid);
  for (var i = 0; i < magic.length; i++) {
    if ((bytes[i] & 0xff) !== magic[i]) throw validationError_({ signature: 'Chữ ký phải là ảnh PNG.' });
  }
  return bytes;
}

function saveSignatureFile_(code, bytes, isoNow) {
  try {
    var folder = getMonthFolder_('signatures', isoNow);
    var file = createFileInFolder_(folder, Utilities.newBlob(bytes, 'image/png', code + '-signature.png'));
    return { id: file.getId(), url: file.getUrl() };
  } catch (e) {
    if (e && e.appCode) throw e;
    logError_('saveSignatureFile_', e);
    throw appError_('DRIVE_ERROR', 'Không lưu được chữ ký vào Google Drive. Vui lòng thử lại.');
  }
}

/** File có nằm (trực tiếp hoặc gián tiếp, tối đa 6 cấp) trong thư mục gốc DTA_HANDOVER không. */
function isInsideRootFolder_(file) {
  var rootId = getProp_(PROP.DRIVE_FOLDER_ID);
  if (!rootId) return false;
  var queue = [file];
  for (var depth = 0; depth < 6 && queue.length; depth++) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      var parents = queue[i].getParents();
      while (parents.hasNext()) {
        var p = parents.next();
        if (p.getId() === rootId) return true;
        next.push(p);
      }
    }
    queue = next;
  }
  return false;
}

/** Đọc file Drive hợp lệ của hệ thống (đúng thư mục + đúng định dạng). */
function getSystemFile_(fileId, expectedMime) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    logError_('getSystemFile_', e);
    throw appError_('DRIVE_ERROR', 'Không đọc được file trên Google Drive.');
  }
  var blob = file.getBlob();
  var mime = String(blob.getContentType() || '').toLowerCase();
  if ((expectedMime && mime !== expectedMime) || !isInsideRootFolder_(file)) {
    logError_('getSystemFile_.rejected', appError_('DRIVE_ERROR', 'File không thuộc hệ thống: ' + fileId + ' (' + mime + ')'));
    throw appError_('DRIVE_ERROR', 'File trên Google Drive không hợp lệ (sai định dạng hoặc không thuộc thư mục hệ thống).');
  }
  return { file: file, blob: blob };
}

/** Đọc file Drive → { fileName, mimeType, base64 } để Worker trả về trình duyệt. */
function readDriveFile_(fileId, fallbackName, expectedMime) {
  var got = getSystemFile_(fileId, expectedMime);
  return {
    fileName: got.file.getName() || fallbackName,
    mimeType: expectedMime || got.blob.getContentType() || 'application/octet-stream',
    base64: Utilities.base64Encode(got.blob.getBytes())
  };
}

/** Ảnh dạng data URI để nhúng vào PDF. Chữ ký: chỉ PNG trong thư mục hệ thống; logo: PNG/JPEG bất kỳ admin chọn. */
function loadImageDataUri_(fileId, options) {
  if (!fileId) return '';
  options = options || {};
  try {
    var blob;
    if (options.systemFile) {
      blob = getSystemFile_(fileId, 'image/png').blob;
    } else {
      blob = DriveApp.getFileById(fileId).getBlob();
    }
    var type = String(blob.getContentType() || '').toLowerCase();
    if (type !== 'image/png' && type !== 'image/jpeg') return '';
    return 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    logError_('loadImageDataUri_', e);
    return '';
  }
}

function driveFileExists_(fileId) {
  if (!fileId) return false;
  try {
    return !DriveApp.getFileById(fileId).isTrashed();
  } catch (e) {
    return false;
  }
}

function trashFileQuietly_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    logError_('trashFileQuietly_', e);
  }
}

/** Chuyển PDF cũ sang pdf-archive/YYYY/MM (giữ bằng chứng; không xóa). Lỗi → giữ nguyên chỗ cũ. */
function archivePdfQuietly_(fileId) {
  if (!fileId) return;
  try {
    var file = DriveApp.getFileById(fileId);
    file.moveTo(getMonthFolder_('pdf-archive', nowIso_()));
  } catch (e) {
    logError_('archivePdfQuietly_', e);
  }
}
