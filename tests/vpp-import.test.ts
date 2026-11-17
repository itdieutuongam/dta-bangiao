import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findSheetName, isUniformLike, parseVppWorkbook, type SheetCell } from '../shared/vppImport';
import { readXlsx, XlsxError } from '../src/utils/xlsx';

/**
 * Cập nhật văn phòng phẩm từ Excel — phía trình duyệt: đọc .xlsx (ZIP + XML, không thư viện ngoài) và chuẩn hóa sheet
 * "Danh muc" + "Ton kho" (mã trùng / không hợp lệ, dòng #REF!, tồn của mã dùng chung, dòng đồng phục).
 */

/** Dựng tệp ZIP tối giản (mục nén deflate hoặc lưu thẳng) — đủ để thử bộ đọc .xlsx. */
function zip(files: Array<{ name: string; text: string; store?: boolean }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.text, 'utf8');
    const data = f.store ? raw : zlib.deflateRawSync(raw);
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(f.store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(f.store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Huong dan" sheetId="1" r:id="rId1"/><sheet name="Danh muc" sheetId="2" r:id="rId2"/><sheet name="Ton kho" sheetId="3" r:id="rId3"/></sheets></workbook>`;
const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="worksheet" Target="worksheets/sheet3.xml"/></Relationships>`;
const STRINGS = `<sst count="6" uniqueCount="6"><si><t>MÃ</t></si><si><t xml:space="preserve">TÊN HÀNG HÓA</t></si>
<si><r><t>Giấy A4 </t></r><r><rPr><b/></rPr><t>Excel</t></r><rPh><t>x</t></rPh></si><si><t>Ream</t></si><si><t>Bao &amp; túi_x000D_</t></si><si/></sst>`;
const SHEET1 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hướng dẫn</t></is></c></row></sheetData></worksheet>';
const SHEET2 = `<worksheet><sheetData>
<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="E3" t="str"><v>ĐƠN GIÁ</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t> G1113 </t></is></c><c r="B4" t="s"><v>2</v></c><c r="C4" t="s"><v>3</v></c><c r="E4"><v>55600</v></c></row>
<row r="5"><c r="A5" t="e"><v>#REF!</v></c><c r="B5" t="b"><v>1</v></c><c r="E5"><v>1.5E2</v></c></row>
<row><c t="inlineStr"><is><t>X1</t></is></c><c t="s"><v>4</v></c></row>
</sheetData></worksheet>`;

describe('Đọc tệp .xlsx trên trình duyệt (không thư viện ngoài)', () => {
  it('đọc tên sheet, chuỗi dùng chung (rich text, bỏ phiên âm, &amp;, _x000D_), chuỗi trong ô, số, lỗi, đúng / sai, ô không có địa chỉ', async () => {
    const file = zip([
      { name: '[Content_Types].xml', text: '<Types/>', store: true },
      { name: 'xl/workbook.xml', text: WORKBOOK },
      { name: 'xl/_rels/workbook.xml.rels', text: RELS, store: true },
      { name: 'xl/sharedStrings.xml', text: STRINGS },
      { name: 'xl/worksheets/sheet1.xml', text: SHEET1 },
      { name: 'xl/worksheets/sheet2.xml', text: SHEET2 },
      { name: 'xl/worksheets/sheet3.xml', text: '<worksheet><sheetData/></worksheet>' },
      { name: 'xl/media/image1.png', text: 'không phải ảnh — không bao giờ được đọc' },
    ]);
    const wb = await readXlsx(file);
    expect(wb.sheetNames).toEqual(['Huong dan', 'Danh muc', 'Ton kho']);
    expect(findSheetName(wb.sheetNames, 'danh mục')).toBe('Danh muc');
    expect(findSheetName(wb.sheetNames, 'TON KHO')).toBe('Ton kho');
    const rows = (await wb.readSheet('Danh muc'))!;
    expect(rows[0]).toEqual([]);
    expect(rows[2]).toEqual(['MÃ', 'TÊN HÀNG HÓA', null, null, 'ĐƠN GIÁ']);
    expect(rows[3]).toEqual([' G1113 ', 'Giấy A4 Excel', 'Ream', null, 55600]);
    expect(rows[4]).toEqual(['#REF!', true, null, null, 150]);
    expect(rows[5]).toEqual(['X1', 'Bao & túi\r']);
    expect(await wb.readSheet('Ton kho')).toEqual([]);
    expect(await wb.readSheet('Không có')).toBeNull();
    expect((await wb.readSheet('Huong dan'))![0]).toEqual(['Hướng dẫn']);
  });

  it('tệp không phải .xlsx → báo lỗi dễ hiểu', async () => {
    await expect(readXlsx(new TextEncoder().encode('MÃ,TÊN\nG1,Giấy'))).rejects.toThrow(XlsxError);
    await expect(readXlsx(new Uint8Array([0x50, 0x4b, 3, 4, ...Array.from({ length: 40 }, () => 0)]))).rejects.toThrow(/không đọc được mục lục ZIP|hỏng/);
  });
});

describe('Chuẩn hóa sheet "Danh muc" + "Ton kho"', () => {
  const catalog: SheetCell[][] = [
    ['CÔNG TY CỔ PHẦN', null],
    [null],
    ['MÃ', 'TÊN HÀNG HÓA', 'ĐV TÍNH', 'HÌNH', 'ĐƠN GIÁ'],
    ['G1112', 'Giấy A4 Excel 70 gsm', 'Ream', null, 45000],
    ['SP000058 ', 'Giấy A3 Double A 70 gsm', 'Ream', null, 152000],
    ['SP000058 ', 'Giấy A3 Double A 80 gsm', 'Ream', null, 186000],
    ['Y5276', 'Bút lông dầu đen', null, null, '7.500'],
    ['Y5276', 'Chổi quét bàn phím', 'cái', null, null],
    ['CÁI', 'Máy tính Casio các loại', 'Cái', null, 'liên hệ báo giá'],
    ['G', 'Decal Tomy A4', 'Hộp/100 tờ', null, 155000],
    ['G1112', 'Giấy A4 Excel 70 gsm', 'Ream', null, 45000],
    ['K1', 'Kẹp  bướm\n19mm', 'hộp nhỏ', null, 12000],
    ['K2', 'Kẹp bướm 19mm', 'hộp nhỏ', null, 12000],
    ['AOKDXL', 'Áo KD XL', 'Cái', null, null],
    ['#REF!', '#REF!', null, null, null],
    [null, null, null, null, null],
  ];
  const stock: SheetCell[][] = [
    ['Mã VPP', 'Tên vật tư', 'ĐVT', 'Tồn đầu kỳ', 'Tổng nhập', 'Tổng xuất', 'Tồn hiện tại', 'Tồn tối thiểu', 'Trạng thái'],
    ['#REF!', '#REF!', '#REF!', '#REF!', '#REF!', '#REF!', '#REF!', '#REF!', '#REF!'],
    ['G1112', 'Giấy A4 Excel 70 gsm', 'Ream', 0, 5, 2, 3, 1, 'Phát sinh'],
    ['Y5276', 'Bút lông dầu đen', 0, 0, 14, 0, 14, 0, 'Phát sinh'], // ĐVT = 0: công thức tra cứu trên ô trống
    ['Y5276', 'Bút lông dầu đen', 0, 0, 14, 0, 14, 0, 'Phát sinh'],
    ['SP000058', 'Giấy A3 Double A 70 gsm', 'Ream', 0, 0, 0, 0, 0, ''],
    ['AOKDXL', 'Áo KD XL', 'Cái', 0, 20, 4, 16, 0, 'Phát sinh'],
    ['Z9', 'Dao rọc giấy Deli', 'Cái', 0, 2, 0, 2, 0, 'Phát sinh'],
    ['K1', 'Kẹp bướm 19mm', 'Hộp nhỏ', 0, 1, 0, -1, 0, ''],
  ];

  it('mã trùng / không hợp lệ, trùng hoàn toàn, trùng tên, giá dạng chữ, ĐVT viết hoa chữ đầu, dòng #REF!, đồng phục tách riêng', () => {
    const out = parseVppWorkbook(catalog, stock);
    const byName = Object.fromEntries(out.rows.map((r) => [r.name, r]));
    expect(byName['Giấy A4 Excel 70 gsm']).toMatchObject({ line: 4, code: 'G1112', unit: 'Ream', price: 45000, stock: 3, minimumStock: 1 });
    expect(byName['Giấy A3 Double A 70 gsm']).toMatchObject({ code: 'SP000058', stock: 0 });
    expect(byName['Giấy A3 Double A 80 gsm']).toMatchObject({ code: '', stock: null }); // mã dùng chung → cấp mã mới, không lấy tồn của mặt hàng kia
    expect(byName['Bút lông dầu đen']).toMatchObject({ code: 'Y5276', price: 7500, stock: 14 });
    expect(byName['Chổi quét bàn phím']).toMatchObject({ code: '', unit: 'Cái', stock: null });
    expect(byName['Máy tính Casio các loại']).toMatchObject({ code: '', price: null });
    expect(byName['Decal Tomy A4']).toMatchObject({ code: '' });
    expect(byName['Kẹp bướm 19mm']).toMatchObject({ code: 'K1', unit: 'Hộp nhỏ', stock: null }); // tồn -1 không hợp lệ
    expect(byName['Dao rọc giấy Deli']).toMatchObject({ code: 'Z9', stock: 2 }); // chỉ có ở sheet tồn kho
    expect(out.rows.filter((r) => r.name === 'Giấy A4 Excel 70 gsm')).toHaveLength(1);
    expect(out.uniforms).toEqual([expect.objectContaining({ code: 'AOKDXL', name: 'Áo KD XL', stock: 16 })]);

    const skipped = out.skipped.map((s) => `${s.line}:${s.message}`);
    expect(skipped).toEqual(expect.arrayContaining(['11:Trùng hoàn toàn với dòng 4', '13:Trùng tên với dòng 12', expect.stringMatching(/^15:Dòng lỗi công thức/)]));
    const warnings = out.warnings.map((w) => w.message).join('\n');
    expect(warnings).toContain('Mã SP000058 đã dùng cho "Giấy A3 Double A 70 gsm"');
    expect(warnings).toContain('Mã "CÁI" không hợp lệ');
    expect(warnings).toContain('Mã "G" không hợp lệ');
    expect(warnings).toContain('không có trong danh mục');
    expect(warnings).toContain('Tồn "-1" không hợp lệ');
    expect(out.stats).toMatchObject({ catalogRows: 11, errorRows: 2 });
  });

  it('chỉ có sheet tồn kho; nhận dạng đồng phục; không có dòng tiêu đề → lỗi', () => {
    const onlyStock = parseVppWorkbook(null, stock);
    expect(onlyStock.rows.map((r) => r.name)).toContain('Dao rọc giấy Deli');
    expect(onlyStock.rows.find((r) => r.name === 'Bút lông dầu đen')).toMatchObject({ unit: '', stock: 14 }); // ĐVT "0" → trống
    expect(isUniformLike('ÁO NAM')).toBe(true);
    expect(isUniformLike('Áo tái sử dụng')).toBe(true);
    expect(isUniformLike('Áo')).toBe(true);
    expect(isUniformLike('Ảo thuật')).toBe(false);
    expect(isUniformLike('Bao áo')).toBe(false);
    expect(() => parseVppWorkbook([['a', 'b']], null)).toThrow(/tiêu đề/);
  });
});

// Kiểm tra với file Excel thật (không đưa vào repo): DTA_VPP_XLSX=<đường dẫn> npx vitest run tests/vpp-import.test.ts
const realFile = process.env.DTA_VPP_XLSX;
describe.skipIf(!realFile || !fs.existsSync(realFile))('File Excel thật (DTA_VPP_XLSX)', () => {
  it('đọc được sheet Danh muc + Ton kho và chuẩn hóa', async () => {
    const wb = await readXlsx(fs.readFileSync(realFile!));
    const catalog = await wb.readSheet(findSheetName(wb.sheetNames, 'Danh muc')!);
    const stockRows = await wb.readSheet(findSheetName(wb.sheetNames, 'Ton kho')!);
    const out = parseVppWorkbook(catalog, stockRows);
    console.log(JSON.stringify({ stats: out.stats, rows: out.rows.length, uniforms: out.uniforms.map((u) => `${u.name}: ${u.stock}`), skipped: out.skipped, warnings: out.warnings.length }, null, 1));
    console.log(out.warnings.map((w) => `${w.sheet} dòng ${w.line}: ${w.name} — ${w.message}`).join('\n'));
    console.log(out.rows.filter((r) => r.stock).map((r) => `${r.code || '(tự cấp)'} ${r.name}: ${r.stock}`).join('\n'));
    expect(out.rows.length).toBeGreaterThan(400);
  });
});
