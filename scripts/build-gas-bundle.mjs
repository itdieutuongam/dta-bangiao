#!/usr/bin/env node
/**
 * Gộp toàn bộ apps-script/*.gs thành MỘT file để dán vào Apps Script editor
 * (thay cho việc tạo và dán từng file).
 *
 *   npm run gas:bundle   →  dist/apps-script/DTA_Handover.gs
 *
 * Các file .gs chỉ khai báo function và hằng số dạng literal, nên gộp theo thứ tự nào cũng chạy đúng.
 * Không sửa file gộp — sửa trong apps-script/*.gs rồi chạy lại lệnh trên.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = [
  'Config.gs',
  'Utils.gs',
  'Security.gs',
  'Employees.gs',
  'Drive.gs',
  'Pdf.gs',
  'Handovers.gs',
  'Notify.gs',
  'Vpp.gs',
  'VppProposals.gs',
  'VppSetup.gs',
  'Export.gs',
  'Setup.gs',
  'Code.gs',
];

export function bundleAppsScript(sourceDir = path.join(ROOT, 'apps-script')) {
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.gs'));
  const ordered = [...ORDER.filter((f) => files.includes(f)), ...files.filter((f) => !ORDER.includes(f)).sort()];
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const rule = '='.repeat(78);
  const header = [
    `// ${rule}`,
    `// DTA HANDOVER – Google Apps Script backend (bản GỘP 1 FILE, v${version})`,
    '//',
    '// Dán TOÀN BỘ nội dung này vào một file .gs trong Apps Script editor (ví dụ "Mã.gs"),',
    '// thay thế nội dung cũ. Sau đó:',
    '//   1. Cài đặt dự án → Thuộc tính tập lệnh → thêm BACKEND_SHARED_SECRET',
    '//   2. Chọn hàm setupDatabase → Chạy (cấp quyền khi được hỏi)',
    '//   3. Triển khai → Tùy chọn triển khai mới → Ứng dụng web (Tôi / Bất kỳ ai)',
    '//',
    '// Được tạo tự động từ apps-script/*.gs bằng `npm run gas:bundle` — không sửa trực tiếp file này.',
    `// Gồm: ${ordered.join(', ')}`,
    `// ${rule}`,
    '',
  ].join('\n');
  const parts = ordered.map((file) => {
    const source = fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/\r\n?/g, '\n').trim();
    return `// ${rule}\n// ${file}\n// ${rule}\n\n${source}\n`;
  });
  return `${header}\n${parts.join('\n')}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = path.join(ROOT, 'dist', 'apps-script');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'DTA_Handover.gs');
  const bundle = bundleAppsScript();
  fs.writeFileSync(outFile, bundle, 'utf8');
  console.log(`Đã tạo ${path.relative(ROOT, outFile)} (${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB, ${bundle.split('\n').length} dòng)`);
  console.log('Mở file, chọn tất cả (Ctrl+A), sao chép và dán vào Apps Script editor.');
}
