/**
 * Bộ giả lập Google Apps Script — CHỈ DÙNG CHO KIỂM THỬ CỤC BỘ.
 *
 * Nạp nguyên văn các file apps-script/*.gs vào một VM context với các service giả lập
 * (SpreadsheetApp, DriveApp, CacheService, LockService, PropertiesService, Utilities,
 * HtmlService, ContentService…). Mục đích: chạy được toàn bộ luồng
 * Browser → Worker → "Apps Script" → "Sheet/Drive" trên máy dev và trong test tự động.
 *
 * Không phải backend production: dữ liệu chỉ nằm trong bộ nhớ, PDF là PDF giả.
 * Mô phỏng một số hành vi quan trọng của Google Sheets:
 *   - Ô không định dạng văn bản (@) tự đổi "0901" → số, "2026-10-15" → ngày.
 *   - Chuỗi bắt đầu bằng "=" bị hiểu là công thức (phát hiện thiếu chống formula injection).
 *   - Ghi ngoài số dòng/cột của sheet → lỗi như Sheets thật.
 *   - CacheService giới hạn 100KB / giá trị.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------- bytes

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (bytes) => Buffer.from(Array.from(bytes, (b) => b & 0xff));
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

function fakePdf(html, title) {
  const text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img[^>]*>/gi, '[image]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  return Buffer.from(`%PDF-1.4\n% DTA Handover GAS emulator – fake PDF (${title})\n% ${text}\n%%EOF\n`, 'utf8');
}

class BlobMock {
  constructor(bytes, contentType, name) {
    this._bytes = Buffer.from(bytes);
    this._type = contentType || 'application/octet-stream';
    this._name = name || null;
  }
  getBytes() {
    return toSigned(this._bytes);
  }
  getDataAsString() {
    return this._bytes.toString('utf8');
  }
  getContentType() {
    return this._type;
  }
  setContentType(type) {
    this._type = type;
    return this;
  }
  getName() {
    return this._name;
  }
  setName(name) {
    this._name = name;
    return this;
  }
  copyBlob() {
    return new BlobMock(this._bytes, this._type, this._name);
  }
  getAs(mime) {
    if (mime !== 'application/pdf') throw new Error(`Emulator: unsupported conversion to ${mime}`);
    const html = this._bytes.toString('utf8');
    BlobMock.lastPdfHtml = html;
    return new BlobMock(fakePdf(html, this._name || ''), 'application/pdf', (this._name || 'document').replace(/\.[^.]+$/, '') + '.pdf');
  }
}
BlobMock.lastPdfHtml = '';

// ---------------------------------------------------------------- Utilities

function formatDate(date, tz, pattern) {
  const d = new Date(date);
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)) {
    parts[p.type] = p.value;
  }
  const map = { y: parts.year, M: parts.month, d: parts.day, H: parts.hour === '24' ? '00' : parts.hour, m: parts.minute, s: parts.second };
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const run = /^(y+|M+|d+|H+|m+|s+)/.exec(pattern.slice(i));
    if (run) {
      out += map[run[0][0]];
      i += run[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function createUtilities() {
  const bufferOf = (value) => (typeof value === 'string' ? Buffer.from(value, 'utf8') : toBuffer(value));
  return {
    Charset: { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' },
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' },
    computeHmacSha256Signature(value, key) {
      return toSigned(crypto.createHmac('sha256', bufferOf(key)).update(bufferOf(value)).digest());
    },
    computeDigest(algorithm, value) {
      const algo = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' }[algorithm];
      return toSigned(crypto.createHash(algo).update(bufferOf(value)).digest());
    },
    base64Encode(data) {
      return bufferOf(data).toString('base64');
    },
    base64Decode(text) {
      if (!/^[A-Za-z0-9+/=\s]*$/.test(String(text))) throw new Error('Could not decode string.');
      return toSigned(Buffer.from(String(text), 'base64'));
    },
    newBlob(data, contentType, name) {
      return new BlobMock(bufferOf(data), contentType, name);
    },
    getUuid() {
      return crypto.randomUUID();
    },
    formatDate,
    sleep() {},
  };
}

// ---------------------------------------------------------------- Properties / Cache / Lock

class PropertiesMock {
  constructor(store) {
    this.store = store;
  }
  getProperty(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setProperty(key, value) {
    this.store[key] = String(value);
    return this;
  }
  setProperties(obj) {
    for (const [k, v] of Object.entries(obj)) this.store[k] = String(v);
    return this;
  }
  getProperties() {
    return { ...this.store };
  }
  deleteProperty(key) {
    delete this.store[key];
    return this;
  }
}

class CacheMock {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }
  put(key, value, ttl = 600) {
    const text = String(value);
    if (key.length > 250) throw new Error('Argument too large: key');
    if (Buffer.byteLength(text, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
    // Tài liệu Apps Script giới hạn thời hạn 1…21600 giây (6 giờ); giá trị ngoài khoảng có thể bị từ chối trên máy chủ thật —
    // giả lập báo lỗi (thay vì âm thầm cắt bớt) để phát hiện sớm khi chạy test.
    if (!(ttl >= 1 && ttl <= 21600)) throw new Error(`Argument too large: expirationInSeconds (${ttl})`);
    this.map.set(key, { value: text, expires: Date.now() + ttl * 1000 });
  }
  getAll(keys) {
    const out = {};
    for (const key of keys) {
      const v = this.get(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }
  putAll(values, ttl) {
    for (const [k, v] of Object.entries(values)) this.put(k, v, ttl);
  }
  remove(key) {
    this.map.delete(key);
  }
  removeAll(keys) {
    for (const key of keys) this.map.delete(key);
  }
}

class LockMock {
  constructor(state) {
    this.state = state;
    this.held = false;
  }
  tryLock() {
    if (this.state.locked) return false;
    this.state.locked = true;
    this.held = true;
    return true;
  }
  waitLock(ms) {
    if (!this.tryLock(ms)) throw new Error('Lock timeout');
  }
  hasLock() {
    return this.held;
  }
  releaseLock() {
    if (this.held) {
      this.state.locked = false;
      this.held = false;
    }
  }
}

// ---------------------------------------------------------------- Spreadsheet

function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (isDate(value)) return formatDate(value, 'Asia/Ho_Chi_Minh', 'M/d/yyyy');
  if (typeof value === 'object' && value.__formula) return '#FORMULA!';
  return String(value);
}

class RangeMock {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getRow() {
    return this.row;
  }
  getColumn() {
    return this.col;
  }
  getNumRows() {
    return this.numRows;
  }
  getNumColumns() {
    return this.numCols;
  }
  getSheet() {
    return this.sheet;
  }
  _cells(fn) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) fn(this.row + r, this.col + c, r, c);
  }
  getValues() {
    this.sheet._touch();
    const out = Array.from({ length: this.numRows }, () => Array.from({ length: this.numCols }, () => ''));
    this._cells((R, C, r, c) => {
      const v = this.sheet._get(R, C);
      out[r][c] = v && typeof v === 'object' && v.__formula ? '#FORMULA!' : isDate(v) ? new Date(v.getTime()) : v;
    });
    return out;
  }
  getDisplayValues() {
    const out = Array.from({ length: this.numRows }, () => Array.from({ length: this.numCols }, () => ''));
    this._cells((R, C, r, c) => {
      out[r][c] = displayValue(this.sheet._get(R, C));
    });
    return out;
  }
  getValue() {
    return this.getValues()[0][0];
  }
  _coerce(value, R, C) {
    if (value === null || value === undefined) return '';
    if (isDate(value) || typeof value === 'number' || typeof value === 'boolean') return value;
    const s = String(value);
    if (s.startsWith("'")) return s.slice(1); // dấu ' = ép kiểu văn bản (ẩn)
    if (s.startsWith('=')) return { __formula: s }; // Sheets hiểu là công thức
    if (this.sheet._getFormat(R, C) === '@') return s;
    const t = s.trim();
    if (/^[-+]?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00+07:00`);
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
    return s;
  }
  setValues(values) {
    this.sheet._touch();
    if (!Array.isArray(values) || values.length !== this.numRows || values.some((row) => row.length !== this.numCols)) {
      throw new Error(
        `The number of rows/columns in the data does not match the range (${this.numRows}x${this.numCols}).`,
      );
    }
    this._cells((R, C, r, c) => this.sheet._set(R, C, this._coerce(values[r][c], R, C)));
    return this;
  }
  setValue(value) {
    this.sheet._touch();
    this.sheet._set(this.row, this.col, this._coerce(value, this.row, this.col));
    return this;
  }
  setNumberFormat(format) {
    this._cells((R, C) => this.sheet._setFormat(R, C, format));
    return this;
  }
  getNumberFormat() {
    return this.sheet._getFormat(this.row, this.col) || 'General';
  }
  setFontWeight() {
    return this;
  }
  setBackground() {
    return this;
  }
  setFontColor() {
    return this;
  }
  setWrap() {
    return this;
  }
  clearContent() {
    this._cells((R, C) => this.sheet._set(R, C, ''));
    return this;
  }
  createTextFinder(text) {
    return new TextFinderMock(this, text);
  }
}

class TextFinderMock {
  constructor(range, text) {
    this.range = range;
    this.text = String(text);
    this.entire = false;
    this.caseSensitive = false;
    this.cursor = 0;
  }
  matchEntireCell(flag) {
    this.entire = Boolean(flag);
    return this;
  }
  matchCase(flag) {
    this.caseSensitive = Boolean(flag);
    return this;
  }
  findAll() {
    this.range.sheet._touch();
    const found = [];
    const needle = this.caseSensitive ? this.text : this.text.toLowerCase();
    this.range._cells((R, C) => {
      let hay = displayValue(this.range.sheet._get(R, C));
      if (!this.caseSensitive) hay = hay.toLowerCase();
      if (this.entire ? hay === needle : hay.includes(needle)) found.push(new RangeMock(this.range.sheet, R, C, 1, 1));
    });
    return found;
  }
  findNext() {
    const all = this.findAll();
    return all[this.cursor++] ?? null;
  }
}

class SheetMock {
  constructor(spreadsheet, name) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.data = []; // data[r][c] (0-based)
    this.fmt = [];
    this.maxRows = 1000;
    this.maxCols = 26;
    this.frozenRows = 0;
    this.protections = [];
  }
  _touch() {
    if (this.spreadsheet.runtime.faults.consume('sheets')) {
      throw new Error('Service Spreadsheets failed while accessing document (emulated fault).');
    }
  }
  _get(R, C) {
    const row = this.data[R - 1];
    return row ? (row[C - 1] ?? '') : '';
  }
  _set(R, C, value) {
    if (R > this.maxRows || C > this.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    (this.data[R - 1] ??= [])[C - 1] = value;
  }
  _getFormat(R, C) {
    const row = this.fmt[R - 1];
    return row ? row[C - 1] : undefined;
  }
  _setFormat(R, C, format) {
    (this.fmt[R - 1] ??= [])[C - 1] = format;
  }
  getName() {
    return this.name;
  }
  getParent() {
    return this.spreadsheet;
  }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) {
      const row = this.data[r];
      if (row && row.some((v) => v !== '' && v !== null && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) {
      if (!row) continue;
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
          max = Math.max(max, c + 1);
          break;
        }
      }
    }
    return max;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  /** RangeList cho danh sách ô dạng A1 đơn ("Q5", "AB12") — đủ cho setValue / setNumberFormat. */
  getRangeList(notations) {
    const ranges = notations.map((a1) => {
      const m = /^([A-Z]+)(\d+)$/.exec(String(a1));
      if (!m) throw new Error(`Emulator: unsupported A1 notation ${a1}`);
      let col = 0;
      for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
      return this.getRange(Number(m[2]), col, 1, 1);
    });
    return {
      getRanges: () => ranges,
      setValue: (value) => {
        for (const r of ranges) r.setValue(value);
      },
      setNumberFormat: (format) => {
        for (const r of ranges) r.setNumberFormat(format);
      },
    };
  }
  protect() {
    const protection = new ProtectionMock(this);
    this.protections.push(protection);
    return protection;
  }
  getProtections() {
    return [...this.protections];
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (typeof row !== 'number') throw new Error('Emulator: A1 notation is not supported');
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error('The starting row/column and number of rows/columns of the range must be at least 1.');
    }
    if (row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    return new RangeMock(this, row, col, numRows, numCols);
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  insertRowsAfter(after, count) {
    if (after < this.data.length) {
      this.data.splice(after, 0, ...Array.from({ length: count }, () => []));
      this.fmt.splice(after, 0, ...Array.from({ length: count }, () => (this.fmt[after - 1] ? [...this.fmt[after - 1]] : [])));
    }
    this.maxRows += count;
    return this;
  }
  insertColumnsAfter(after, count) {
    for (const row of this.data) if (row && row.length > after) row.splice(after, 0, ...Array.from({ length: count }, () => ''));
    this.maxCols += count;
    return this;
  }
  deleteRows(start, count) {
    if (start + count - 1 > this.maxRows) throw new Error('Those rows are out of bounds.');
    if (this.maxRows - count <= this.frozenRows) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    this.data.splice(start - 1, count);
    this.fmt.splice(start - 1, count);
    this.maxRows -= count;
    return this;
  }
  deleteRow(row) {
    return this.deleteRows(row, 1);
  }
  setFrozenRows(n) {
    this.frozenRows = n;
    return this;
  }
  getFrozenRows() {
    return this.frozenRows;
  }
  /** Tiện ích cho test: đọc sheet thành object theo dòng tiêu đề. */
  toObjects() {
    const lastRow = this.getLastRow();
    const lastCol = this.getLastColumn();
    if (lastRow < 1) return [];
    const headers = Array.from({ length: lastCol }, (_, c) => String(this._get(1, c + 1)));
    const rows = [];
    for (let r = 2; r <= lastRow; r++) {
      const obj = {};
      headers.forEach((h, c) => {
        obj[h] = this._get(r, c + 1);
      });
      rows.push(obj);
    }
    return rows;
  }
}

class ProtectionMock {
  constructor(sheet) {
    this.sheet = sheet;
    this.description = '';
    this.editors = [{ getEmail: () => 'editor@example.com' }];
    this.domainEdit = true;
  }
  setDescription(text) {
    this.description = text;
    return this;
  }
  getDescription() {
    return this.description;
  }
  addEditor(user) {
    const email = typeof user === 'string' ? user : user.getEmail();
    if (!this.editors.some((e) => e.getEmail() === email)) this.editors.push({ getEmail: () => email });
    return this;
  }
  getEditors() {
    return [...this.editors];
  }
  removeEditors(users) {
    const emails = users.map((u) => (typeof u === 'string' ? u : u.getEmail()));
    this.editors = this.editors.filter((e) => !emails.includes(e.getEmail()));
    return this;
  }
  canDomainEdit() {
    return this.domainEdit;
  }
  setDomainEdit(flag) {
    this.domainEdit = Boolean(flag);
    return this;
  }
}

class SpreadsheetMock {
  constructor(runtime, id, name) {
    this.runtime = runtime;
    this.id = id;
    this.name = name;
    this.sheets = [];
    this.timeZone = 'America/Los_Angeles';
    this.insertSheet('Sheet1');
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.name === name) ?? null;
  }
  getSheets() {
    return [...this.sheets];
  }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const sheet = new SheetMock(this, name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet) {
    if (this.sheets.length <= 1) throw new Error('A spreadsheet must have at least one sheet.');
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
  getSpreadsheetTimeZone() {
    return this.timeZone;
  }
  setSpreadsheetTimeZone(tz) {
    this.timeZone = tz;
  }
  toast() {}
}

// ---------------------------------------------------------------- Drive

class FileMock {
  constructor(drive, id, name, parent, blob) {
    Object.assign(this, { drive, id, name, parent, trashed: false });
    this.bytes = blob ? Buffer.from(blob._bytes) : Buffer.alloc(0);
    this.mime = blob ? blob.getContentType() : 'application/octet-stream';
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getUrl() {
    return `https://drive.google.com/file/d/${this.id}/view`;
  }
  getMimeType() {
    return this.mime;
  }
  getBlob() {
    return new BlobMock(this.bytes, this.mime, this.name);
  }
  getParents() {
    return iterator(this.parent ? [this.parent] : []);
  }
  moveTo(folder) {
    this.parent = folder;
    return this;
  }
  isTrashed() {
    return this.trashed;
  }
  setTrashed(flag) {
    this.trashed = Boolean(flag);
    return this;
  }
  makeCopy(name, folder) {
    if (this.drive.runtime.faults.consume('drive')) throw new Error('Service Drive failed (emulated fault).');
    const copy = new FileMock(this.drive, this.drive.newId(), name, folder, null);
    copy.mime = this.mime;
    this.drive.items.set(copy.id, copy);
    return copy;
  }
}

function iterator(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

class FolderMock {
  constructor(drive, id, name, parent) {
    Object.assign(this, { drive, id, name, parent, trashed: false });
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getUrl() {
    return `https://drive.google.com/drive/folders/${this.id}`;
  }
  isTrashed() {
    return this.trashed;
  }
  setTrashed(flag) {
    this.trashed = Boolean(flag);
    return this;
  }
  getParents() {
    return iterator(this.parent ? [this.parent] : []);
  }
  getFoldersByName(name) {
    return iterator([...this.drive.items.values()].filter((x) => x instanceof FolderMock && x.parent === this && x.name === name));
  }
  getFiles() {
    return iterator([...this.drive.items.values()].filter((x) => x instanceof FileMock && x.parent === this));
  }
  createFolder(name) {
    return this.drive.createFolderIn(name, this);
  }
  createFile(blob) {
    if (this.drive.runtime.faults.consume('drive')) throw new Error('Service Drive failed (emulated fault).');
    const file = new FileMock(this.drive, this.drive.newId(), blob.getName() || 'Untitled', this, blob);
    this.drive.items.set(file.id, file);
    return file;
  }
}

class DriveMock {
  constructor(runtime) {
    this.runtime = runtime;
    this.items = new Map();
    this.counter = 0;
    this.root = this.createFolderIn('My Drive', null);
  }
  newId() {
    this.counter += 1;
    return `drv${String(this.counter).padStart(6, '0')}${crypto.randomBytes(6).toString('hex')}`;
  }
  createFolderIn(name, parent) {
    const folder = new FolderMock(this, this.newId(), name, parent);
    this.items.set(folder.id, folder);
    return folder;
  }
  getRootFolder() {
    return this.root;
  }
  createFolder(name) {
    return this.createFolderIn(name, this.root);
  }
  getFolderById(id) {
    const item = this.items.get(String(id));
    if (!(item instanceof FolderMock)) throw new Error('No item with the given ID could be found, or you do not have permission to access it.');
    return item;
  }
  getFileById(id) {
    const item = this.items.get(String(id));
    if (!(item instanceof FileMock)) throw new Error('No item with the given ID could be found, or you do not have permission to access it.');
    return item;
  }
  /** Tiện ích cho test: đường dẫn đầy đủ của file. */
  pathOf(item) {
    const parts = [];
    for (let cur = item; cur && cur.parent; cur = cur.parent) parts.unshift(cur.name);
    return parts.join('/');
  }
}

// ---------------------------------------------------------------- runtime

class Faults {
  constructor() {
    this.pending = { sheets: 0, drive: 0 };
  }
  set(target, count = 1) {
    this.pending[target] = count;
  }
  consume(target) {
    if (this.pending[target] > 0) {
      this.pending[target] -= 1;
      return true;
    }
    return false;
  }
}

/**
 * Tạo runtime Apps Script giả lập.
 * @param {{ scriptDir: string, properties?: Record<string,string>, bound?: boolean, quiet?: boolean }} options
 */
export function createGasRuntime(options) {
  const runtime = { faults: new Faults(), logs: [] };
  const properties = { ...options.properties };
  const cache = new CacheMock();
  const lockState = { locked: false };
  const drive = new DriveMock(runtime);
  const spreadsheet = new SpreadsheetMock(runtime, `ss${crypto.randomBytes(8).toString('hex')}`, 'DTA Handover (emulator)');
  // Spreadsheet cũng là một file trên Drive (để backupNow() hoạt động).
  const ssFile = new FileMock(drive, spreadsheet.id, spreadsheet.name, drive.root, null);
  ssFile.mime = 'application/vnd.google-apps.spreadsheet';
  drive.items.set(spreadsheet.id, ssFile);

  const log = (level) => (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    runtime.logs.push({ level, line });
    if (!options.quiet && level === 'error') console.error(`[gas] ${line}`);
  };

  const triggers = [];
  // MailApp giả lập: không gửi thật — lưu thư vào runtime.mail (test / chạy thử local đọc mã OTP, thông báo).
  // options.mailQuota: hạn mức còn lại trong ngày (mặc định 100 như Gmail thường); faults 'mail' → MailApp ném lỗi.
  const mail = [];
  const mailState = { quota: options.mailQuota ?? 100 };
  // Giao diện Sheet giả lập (menu): options.ui.responses = các giá trị lần lượt nhập vào hộp thoại prompt
  // (null = bấm Hủy). Không truyền options.ui = giống chạy trong trình soạn thảo (getUi() báo lỗi).
  const uiState = options.ui ? { responses: [...(options.ui.responses ?? [])], alerts: [], prompts: [] } : null;
  const fakeUi = uiState && {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL' },
    prompt(title, text) {
      uiState.prompts.push({ title, text });
      const answer = uiState.responses.shift();
      return {
        getSelectedButton: () => (answer === null || answer === undefined ? 'CANCEL' : 'OK'),
        getResponseText: () => answer ?? '',
      };
    },
    alert(title, text) {
      uiState.alerts.push({ title, text: text ?? '' });
      return 'OK';
    },
  };
  const globals = {
    console: { log: log('info'), info: log('info'), warn: log('warn'), error: log('error') },
    Logger: { log: log('info') },
    Utilities: createUtilities(),
    PropertiesService: { getScriptProperties: () => new PropertiesMock(properties) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => new LockMock(lockState) },
    Session: {
      getScriptTimeZone: () => 'Asia/Ho_Chi_Minh',
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      openById(id) {
        if (id !== spreadsheet.id) throw new Error(`Unexpected error while getting the method or property openById on object SpreadsheetApp.`);
        return spreadsheet;
      },
      getActiveSpreadsheet: () => (options.bound === false ? null : spreadsheet),
      getActive: () => (options.bound === false ? null : spreadsheet),
      // faults 'flush' → lỗi khi đẩy dữ liệu đã ghi (như Sheets lỗi lúc lưu) — kiểm tra lỗi không bị coi là thành công.
      flush() {
        if (runtime.faults.consume('flush')) throw new Error('Service Spreadsheets failed while flushing (emulated fault).');
      },
      getUi() {
        if (fakeUi) return fakeUi;
        throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
      },
    },
    DriveApp: {
      getRootFolder: () => drive.getRootFolder(),
      createFolder: (name) => drive.createFolder(name),
      getFolderById: (id) => drive.getFolderById(id),
      getFileById: (id) => drive.getFileById(id),
    },
    HtmlService: {
      createHtmlOutput(html) {
        const blob = new BlobMock(Buffer.from(String(html), 'utf8'), 'text/html', 'output.html');
        return {
          getContent: () => String(html),
          getBlob: () => blob,
          getAs: (mime) => blob.getAs(mime),
          setTitle() {
            return this;
          },
        };
      },
    },
    MailApp: {
      getRemainingDailyQuota: () => mailState.quota,
      sendEmail(message) {
        if (!message || typeof message !== 'object') throw new Error('MailApp.sendEmail (emulator): chỉ hỗ trợ dạng sendEmail({ to, subject, … })');
        if (runtime.faults.consume('mail')) throw new Error('Service invoked too many times for one day: email.');
        const recipients = String(message.to ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!recipients.length) throw new Error('Invalid argument: recipient');
        if (mailState.quota < recipients.length) throw new Error('Service invoked too many times for one day: email.');
        mailState.quota -= recipients.length;
        const entry = {
          to: recipients.join(', '),
          subject: String(message.subject ?? ''),
          body: String(message.body ?? ''),
          htmlBody: String(message.htmlBody ?? ''),
          name: String(message.name ?? ''),
          at: new Date().toISOString(),
        };
        mail.push(entry);
        if (options.onMail) options.onMail(entry);
      },
    },
    MimeType: { PDF: 'application/pdf', HTML: 'text/html', PNG: 'image/png', JPEG: 'image/jpeg', JSON: 'application/json', PLAIN_TEXT: 'text/plain' },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(content) {
        return {
          _content: String(content),
          _mime: 'text/plain',
          setMimeType(mime) {
            this._mime = mime;
            return this;
          },
          getContent() {
            return this._content;
          },
          getMimeType() {
            return this._mime;
          },
        };
      },
    },
    ScriptApp: {
      WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY' },
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(handler) {
        const trigger = { getHandlerFunction: () => handler };
        const builder = {
          timeBased: () => builder,
          onWeekDay: () => builder,
          atHour: () => builder,
          everyDays: () => builder,
          create: () => {
            triggers.push(trigger);
            return trigger;
          },
        };
        return builder;
      },
    },
  };

  const context = vm.createContext(globals);
  const sources = fs
    .readdirSync(options.scriptDir)
    .filter((f) => f.endsWith('.gs'))
    .sort()
    .map((file) => {
      const full = path.join(options.scriptDir, file);
      return new vm.Script(fs.readFileSync(full, 'utf8'), { filename: full });
    });
  // Mỗi lần gọi = một "execution" mới như Apps Script thật: chạy lại top-level để reset biến global.
  const freshExecution = () => {
    lockState.locked = false;
    for (const script of sources) script.runInContext(context);
  };
  freshExecution();

  return {
    context,
    spreadsheet,
    drive,
    cache,
    properties,
    lockState,
    logs: runtime.logs,
    faults: runtime.faults,
    ui: uiState,
    /** Thư MailApp đã "gửi" (không gửi thật) — mới nhất ở cuối. */
    mail,
    mailState,
    triggers,
    get lastPdfHtml() {
      return BlobMock.lastPdfHtml;
    },
    /** Gọi một hàm top-level trong script (ví dụ setupDatabase). */
    run(name, ...args) {
      freshExecution();
      if (typeof context[name] !== 'function') throw new Error(`Không có hàm ${name} trong Apps Script`);
      return context[name](...args);
    },
    /** Mô phỏng Web App: trả về chuỗi JSON như ContentService. */
    doPost(body) {
      freshExecution();
      const output = context.doPost({ postData: { contents: body, type: 'application/json', length: body.length }, parameter: {} });
      return output.getContent();
    },
    doGet() {
      freshExecution();
      return context.doGet({ parameter: {} }).getContent();
    },
    sheet(name) {
      return spreadsheet.getSheetByName(name);
    },
  };
}

/** Ký request giống Worker (worker/services/gas.ts) — dùng trong test gọi thẳng runtime. */
export function signGasRequest(secret, action, payload, scope = 'public', overrides = {}) {
  const ts = overrides.ts ?? String(Date.now());
  const requestId = overrides.requestId ?? crypto.randomUUID();
  const payloadText = JSON.stringify(payload ?? {}).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  const sig = crypto.createHmac('sha256', secret).update(['v1', action, scope, ts, requestId, payloadText].join('\n'), 'utf8').digest('hex');
  return JSON.stringify({ v: 1, action, scope, ts, requestId, payload: payloadText, sig: overrides.sig ?? sig });
}
