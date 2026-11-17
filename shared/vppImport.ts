// Chuẩn hóa file Excel theo dõi văn phòng phẩm (sheet "Danh muc" + "Ton kho") thành các dòng cập nhật danh mục + tồn kho.
// Chạy trên trình duyệt (trang Cập nhật từ Excel) — máy chủ (Apps Script VppImport.gs) kiểm tra lại từng dòng.
//
// Quy tắc (theo file thật "Mau_theo_doi_VPP.xlsx"):
//   • Tìm dòng tiêu đề theo tên cột (MÃ / MÃ VPP, TÊN HÀNG HÓA / TÊN VẬT TƯ, ĐV TÍNH / ĐVT, ĐƠN GIÁ, TỒN HIỆN TẠI, TỒN TỐI THIỂU).
//   • Bỏ dòng lỗi công thức (#REF!, #N/A…), dòng thiếu tên.
//   • Mã: bỏ khoảng trắng, chữ hoa; mã không hợp lệ (có dấu tiếng Việt như "CÁI", quá ngắn như "G") → để trống = hệ thống tự cấp mã.
//   • Một mã dùng cho HAI mặt hàng khác tên → mặt hàng sau để trống mã (tự cấp mã mới). Trùng hoàn toàn → bỏ dòng sau.
//   • Tồn của mã trùng lấy theo dòng "Ton kho" CÙNG TÊN (công thức tra cứu theo mã của file gán cùng số cho cả hai mặt hàng).
//   • Dòng "Áo …" là ĐỒNG PHỤC → tách riêng (nhập ở module Đồng phục), không đưa vào văn phòng phẩm trừ khi người dùng chọn.

import { normalizeVietnamese } from './text';
import type { VppImportRow } from './vpp';

export type SheetCell = string | number | boolean | null;

export interface ImportIssue {
  sheet: string;
  line: number;
  name: string;
  message: string;
}

export interface ParsedVppWorkbook {
  /** Dòng văn phòng phẩm gửi máy chủ. */
  rows: VppImportRow[];
  /** Dòng đồng phục ("Áo …") — mặc định KHÔNG nhập vào văn phòng phẩm. */
  uniforms: VppImportRow[];
  skipped: ImportIssue[];
  warnings: ImportIssue[];
  stats: { catalogRows: number; stockRows: number; withStock: number; errorRows: number };
}

export const IMPORT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const ERROR_VALUE = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/i;

type Column = 'code' | 'name' | 'unit' | 'price' | 'stock' | 'minimum';

const HEADER_ALIASES: Record<Column, string[]> = {
  code: ['ma', 'ma vpp', 'ma hang', 'ma sp', 'ma san pham', 'ma vat tu'],
  name: ['ten hang hoa', 'ten vat tu', 'ten san pham', 'ten hang', 'ten'],
  unit: ['dv tinh', 'dvt', 'don vi tinh', 'don vi', 'dv'],
  price: ['don gia', 'gia', 'don gia tham khao'],
  stock: ['ton hien tai', 'ton cuoi', 'ton cuoi ky', 'so luong ton', 'ton kho', 'ton'],
  minimum: ['ton toi thieu', 'muc toi thieu'],
};

function headerKey(value: SheetCell): string {
  return normalizeVietnamese(String(value ?? ''))
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dòng tiêu đề (trong 40 dòng đầu) có cột mã + tên; trả về vị trí từng cột. */
function findHeader(rows: SheetCell[][], wanted: Column[]): { row: number; cols: Partial<Record<Column, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = (rows[r] ?? []).map(headerKey);
    const cols: Partial<Record<Column, number>> = {};
    for (const col of wanted) {
      const idx = cells.findIndex((c) => HEADER_ALIASES[col].includes(c));
      if (idx >= 0) cols[col] = idx;
    }
    if (cols.code !== undefined && cols.name !== undefined) return { row: r, cols };
  }
  return null;
}

function text(value: SheetCell): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function isError(value: SheetCell): boolean {
  return typeof value === 'string' && ERROR_VALUE.test(value.trim());
}

function normalizeCode(value: SheetCell): string {
  return text(value).replace(/\s+/g, '').toUpperCase();
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase('vi-VN') + s.slice(1) : s;
}

/** ĐVT: công thức tra cứu của file trả "0" khi ô gốc trống → coi như chưa có ĐVT. */
function unitOf(value: SheetCell): string {
  const s = text(value);
  return s === '0' || s === '-' ? '' : capitalize(s);
}

/** Số trong ô: số thật, hoặc chữ dạng "45000" / "45.000" (kiểu Việt). Chữ khác ("liên hệ báo giá") → null. */
function numberOf(value: SheetCell): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = text(value).replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

/** Tên chuẩn để so trùng: GIỮ dấu, bỏ hoa / thường, khoảng trắng, dấu câu (khớp accentNameKey_ của Apps Script). */
export function importNameKey(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,;:/\\()[\]{}"'`+*&|_-]+/g, ' ')
    .trim();
}

/** Đồng phục: tên bắt đầu bằng "Áo …" (Áo KD XL, Áo Công Trình, ÁO NAM, Áo tái sử dụng…) — giữ dấu: "Ảo …" không phải áo. */
export function isUniformLike(name: string): boolean {
  return /^(áo|ao)(\s|$)/.test(name.normalize('NFC').trim().toLocaleLowerCase('vi-VN'));
}

interface CatalogRow {
  line: number;
  code: string;
  rawCode: string;
  name: string;
  unit: string;
  price: number | null;
}

interface StockRow {
  line: number;
  code: string;
  name: string;
  unit: string;
  stock: number | null;
  minimum: number | null;
}

export function parseVppWorkbook(catalog: SheetCell[][] | null, stockSheet: SheetCell[][] | null): ParsedVppWorkbook {
  const skipped: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let errorRows = 0;

  // ---------------------------------------------------------------- Danh mục
  const catalogRows: CatalogRow[] = [];
  if (catalog) {
    const header = findHeader(catalog, ['code', 'name', 'unit', 'price']);
    if (!header) throw new Error('Sheet danh mục không có dòng tiêu đề (cần cột "MÃ" và "TÊN HÀNG HÓA").');
    const { cols } = header;
    for (let r = header.row + 1; r < catalog.length; r++) {
      const cells = catalog[r] ?? [];
      const rawCode = cells[cols.code!] ?? null;
      const rawName = cells[cols.name!] ?? null;
      if (text(rawCode) === '' && text(rawName) === '') continue;
      const line = r + 1;
      if (isError(rawCode) || isError(rawName)) {
        errorRows++;
        skipped.push({ sheet: 'Danh mục', line, name: text(rawName), message: 'Dòng lỗi công thức (' + (isError(rawName) ? text(rawName) : text(rawCode)) + ')' });
        continue;
      }
      const name = text(rawName);
      if (!name) {
        skipped.push({ sheet: 'Danh mục', line, name: text(rawCode), message: 'Thiếu tên hàng hóa' });
        continue;
      }
      const rawPrice = cols.price === undefined ? null : (cells[cols.price] ?? null);
      const price = numberOf(rawPrice);
      catalogRows.push({
        line,
        code: normalizeCode(rawCode),
        rawCode: text(rawCode),
        name,
        unit: unitOf(cols.unit === undefined ? null : (cells[cols.unit] ?? null)),
        price: price !== null && price >= 0 ? Math.round(price * 100) / 100 : null,
      });
    }
  }

  // ---------------------------------------------------------------- Tồn kho
  const stockRows: StockRow[] = [];
  if (stockSheet) {
    const header = findHeader(stockSheet, ['code', 'name', 'unit', 'stock', 'minimum']);
    if (!header) throw new Error('Sheet tồn kho không có dòng tiêu đề (cần cột "Mã VPP", "Tên vật tư", "Tồn hiện tại").');
    const { cols } = header;
    if (cols.stock === undefined) throw new Error('Sheet tồn kho thiếu cột "Tồn hiện tại".');
    for (let r = header.row + 1; r < stockSheet.length; r++) {
      const cells = stockSheet[r] ?? [];
      const rawCode = cells[cols.code!] ?? null;
      const rawName = cells[cols.name!] ?? null;
      if (text(rawCode) === '' && text(rawName) === '') continue;
      const line = r + 1;
      if (cells.some(isError)) {
        errorRows++;
        continue; // dòng #REF! của công thức tổng hợp — không có dữ liệu
      }
      const rawStock = cells[cols.stock] ?? null;
      let stock = numberOf(rawStock);
      if (stock !== null && (stock < 0 || !Number.isInteger(stock))) {
        warnings.push({ sheet: 'Tồn kho', line, name: text(rawName), message: `Tồn "${text(rawStock)}" không hợp lệ (âm / số lẻ) — không cập nhật tồn mặt hàng này` });
        stock = null;
      }
      const minimum = cols.minimum === undefined ? null : numberOf(cells[cols.minimum] ?? null);
      stockRows.push({
        line,
        code: normalizeCode(rawCode),
        name: text(rawName),
        unit: unitOf(cols.unit === undefined ? null : (cells[cols.unit] ?? null)),
        stock,
        minimum: minimum !== null && minimum >= 0 && Number.isInteger(minimum) ? minimum : null,
      });
    }
  }

  // ---------------------------------------------------------------- Ghép danh mục ↔ tồn kho
  const stockByCode = new Map<string, StockRow[]>();
  for (const s of stockRows) {
    const list = stockByCode.get(s.code) ?? [];
    list.push(s);
    stockByCode.set(s.code, list);
  }
  const catalogCodeCount = new Map<string, number>();
  for (const c of catalogRows) catalogCodeCount.set(c.code, (catalogCodeCount.get(c.code) ?? 0) + 1);

  const base: Array<CatalogRow & { stock: number | null; minimum: number | null }> = catalogRows.length
    ? catalogRows.map((c) => {
        const candidates = c.code ? (stockByCode.get(c.code) ?? []) : stockRows.filter((s) => importNameKey(s.name) === importNameKey(c.name));
        const shared = (catalogCodeCount.get(c.code) ?? 0) > 1;
        // Mã dùng chung cho nhiều mặt hàng: chỉ nhận dòng tồn CÙNG TÊN (công thức VLOOKUP của file gán cùng số cho cả hai).
        const match = shared ? candidates.find((s) => importNameKey(s.name) === importNameKey(c.name)) : candidates[0];
        return { ...c, stock: match ? match.stock : null, minimum: match ? match.minimum : null };
      })
    : stockRows.map((s) => ({ line: s.line, code: s.code, rawCode: s.code, name: s.name, unit: s.unit, price: null, stock: s.stock, minimum: s.minimum }));

  // Dòng tồn kho không có trong danh mục → vẫn nhập (lấy tên / ĐVT từ sheet tồn kho).
  if (catalogRows.length) {
    const catalogCodes = new Set(catalogRows.map((c) => c.code).filter(Boolean));
    const catalogNames = new Set(catalogRows.map((c) => importNameKey(c.name)));
    for (const s of stockRows) {
      if ((s.code && catalogCodes.has(s.code)) || catalogNames.has(importNameKey(s.name))) continue;
      warnings.push({ sheet: 'Tồn kho', line: s.line, name: s.name, message: 'Có trong sheet tồn kho nhưng không có trong danh mục — vẫn thêm vào danh mục' });
      base.push({ line: s.line, code: s.code, rawCode: s.code, name: s.name, unit: s.unit, price: null, stock: s.stock, minimum: s.minimum });
    }
  }

  // ---------------------------------------------------------------- Mã không hợp lệ / trùng, tên trùng
  const firstByCode = new Map<string, { line: number; name: string }>();
  const firstByName = new Map<string, number>();
  const rows: VppImportRow[] = [];
  const uniforms: VppImportRow[] = [];
  for (const r of base) {
    let code = r.code;
    if (code && !IMPORT_CODE_PATTERN.test(code)) {
      warnings.push({ sheet: 'Danh mục', line: r.line, name: r.name, message: `Mã "${r.rawCode}" không hợp lệ (chỉ gồm chữ không dấu, số, . _ -, ít nhất 2 ký tự) — hệ thống tự cấp mã` });
      code = '';
    }
    const nameKey = importNameKey(r.name);
    const sameName = firstByName.get(nameKey);
    if (code) {
      const first = firstByCode.get(code);
      if (first) {
        if (importNameKey(first.name) === nameKey) {
          skipped.push({ sheet: 'Danh mục', line: r.line, name: r.name, message: `Trùng hoàn toàn với dòng ${first.line}` });
          continue;
        }
        warnings.push({ sheet: 'Danh mục', line: r.line, name: r.name, message: `Mã ${code} đã dùng cho "${first.name}" (dòng ${first.line}) — mặt hàng này được cấp mã mới` });
        code = '';
      } else {
        firstByCode.set(code, { line: r.line, name: r.name });
      }
    }
    if (sameName !== undefined) {
      skipped.push({ sheet: 'Danh mục', line: r.line, name: r.name, message: `Trùng tên với dòng ${sameName}` });
      continue;
    }
    firstByName.set(nameKey, r.line);
    const row: VppImportRow = { line: r.line, code, name: r.name, unit: r.unit, price: r.price, stock: r.stock, minimumStock: r.minimum };
    (isUniformLike(r.name) ? uniforms : rows).push(row);
  }

  return {
    rows,
    uniforms,
    skipped,
    warnings,
    stats: {
      catalogRows: catalogRows.length,
      stockRows: stockRows.length,
      withStock: base.filter((r) => r.stock !== null && r.stock > 0).length,
      errorRows,
    },
  };
}

/** Tìm sheet theo tên không dấu / không phân biệt hoa thường ("Danh muc", "DANH MỤC", "Ton kho"…). */
export function findSheetName(names: string[], ...wanted: string[]): string | null {
  const keys = wanted.map((w) => normalizeVietnamese(w).replace(/\s+/g, ''));
  return names.find((n) => keys.includes(normalizeVietnamese(n).replace(/\s+/g, ''))) ?? null;
}
