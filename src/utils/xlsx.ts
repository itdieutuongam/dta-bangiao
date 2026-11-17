/**
 * Đọc tệp Excel .xlsx ngay trên trình duyệt — không thư viện ngoài, không gửi tệp lên máy chủ.
 * .xlsx là tệp ZIP chứa XML: đọc mục lục ZIP, giải nén ĐÚNG các phần cần (workbook, sharedStrings, sheet được chọn) bằng
 * DecompressionStream('deflate-raw') của trình duyệt, rồi đọc ô bằng biểu thức chính quy (không thực thi gì trong tệp).
 * Ảnh / bản vẽ trong tệp (cột HÌNH) được bỏ qua. Giá trị ô: chuỗi, số, true/false; ô lỗi công thức trả chuỗi "#REF!"…
 */

export type CellValue = string | number | boolean | null;

export class XlsxError extends Error {}

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_PART_BYTES = 40 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('Tệp không phải Excel .xlsx hợp lệ (không đọc được mục lục ZIP).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new XlsxError('Tệp .xlsx bị hỏng (mục lục ZIP sai).');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readPart(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.size > MAX_PART_BYTES) throw new XlsxError(`Phần "${name}" trong tệp quá lớn.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.offset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) throw new XlsxError('Tệp .xlsx bị hỏng.');
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let raw: Uint8Array;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) raw = await inflateRaw(data);
  else throw new XlsxError('Tệp .xlsx dùng kiểu nén không hỗ trợ.');
  if (raw.length > MAX_PART_BYTES) throw new XlsxError(`Phần "${name}" trong tệp quá lớn.`);
  return new TextDecoder('utf-8').decode(raw);
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] !== '#') return XML_ENTITIES[e]!;
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Excel mã hóa ký tự điều khiển trong chuỗi dạng _x000D_. */
function decodeOoxmlEscapes(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : null;
}

/** Nối các <t> của một chuỗi (rich text), bỏ phần phiên âm <rPh>. */
function textOf(xml: string): string {
  let out = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeOoxmlEscapes(decodeXml(m[1]!));
  }
  return out;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(m[1] ? textOf(m[1]) : '');
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function parseSheet(xml: string, strings: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rm[1]!, 'r');
    const rowIndex = r ? parseInt(r, 10) - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (!rm[2] || rowIndex < 0 || rowIndex > 1_048_575) continue;
    const cells: CellValue[] = [];
    let nextCol = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1]!;
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const inner = cm[2] ?? '';
      const type = attr(tag, 't') ?? 'n';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: CellValue = null;
      if (type === 's') value = v === undefined ? null : (strings[parseInt(v, 10)] ?? null);
      else if (type === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (type === 'str' || type === 'e' || type === 'd') value = v === undefined ? null : decodeOoxmlEscapes(decodeXml(v));
      else if (type === 'b') value = v === undefined ? null : v.trim() === '1';
      else if (v !== undefined && v.trim() !== '') {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      if (col >= 0 && col < 16384) cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[rowIndex] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

export interface XlsxWorkbook {
  sheetNames: string[];
  /** Ô của sheet (hàng × cột, đánh số từ 0). null nếu không có sheet tên này. */
  readSheet(name: string): Promise<CellValue[][] | null>;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `xl/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<XlsxWorkbook> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > MAX_FILE_BYTES) throw new XlsxError('Tệp quá lớn (tối đa 40 MB).');
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new XlsxError('Tệp không phải Excel .xlsx (hãy lưu lại dưới dạng "Excel Workbook (.xlsx)"; tệp .xls cũ chưa hỗ trợ).');
  }
  const entries = readZipDirectory(bytes);
  const workbook = await readPart(bytes, entries, 'xl/workbook.xml');
  if (!workbook) throw new XlsxError('Tệp không có workbook Excel.');
  const rels = (await readPart(bytes, entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1]!, 'Id');
    const target = attr(m[1]!, 'Target');
    if (id && target) targets.set(id, resolveTarget(target));
  }
  const sheets: Array<{ name: string; path: string }> = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1]!, 'name');
    const rid = attr(m[1]!, 'r:id');
    const path = rid ? targets.get(rid) : undefined;
    if (name && path) sheets.push({ name, path });
  }
  let strings: string[] | null = null;
  return {
    sheetNames: sheets.map((s) => s.name),
    async readSheet(name: string) {
      const sheet = sheets.find((s) => s.name === name);
      if (!sheet) return null;
      strings ??= parseSharedStrings(await readPart(bytes, entries, 'xl/sharedStrings.xml'));
      const xml = await readPart(bytes, entries, sheet.path);
      return xml === null ? null : parseSheet(xml, strings);
    },
  };
}
