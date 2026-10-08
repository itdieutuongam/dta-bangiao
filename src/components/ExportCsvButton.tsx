import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useAdmin } from '../layouts/adminContext';
import { adminExportCsv, type ExportDataset } from '../services/adminApi';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

/**
 * Nút "Xuất CSV" trên các trang danh sách quản trị: xuất đúng bộ lọc đang xem (không phân trang, tối đa 5.000 dòng).
 * File UTF-8 mở được bằng Excel / Google Sheets; ô chữ bắt đầu bằng = + - @ đã được vô hiệu hóa công thức.
 */
export function ExportCsvButton({ dataset, filters }: { dataset: ExportDataset; filters: Record<string, unknown> }) {
  const toast = useToast();
  const { handleError } = useAdmin();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await adminExportCsv(dataset, filters);
      if (result.truncated) {
        toast.show(`Đã xuất ${result.rows}/${result.total} dòng (tối đa 5.000 dòng mỗi lần) — lọc theo khoảng ngày để xuất phần còn lại.`, 'info');
      } else {
        toast.show(`Đã xuất ${result.rows} dòng ra file CSV.`);
      }
    } catch (err) {
      handleError(err, 'Không xuất được file CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void run()} loading={busy} icon={<FileSpreadsheet className="size-4" aria-hidden="true" />}>
      Xuất CSV
    </Button>
  );
}
