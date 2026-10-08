import {
  adminListQuerySchema,
  movementListQuerySchema,
  productListQuerySchema,
  proposalListQuerySchema,
} from '../../shared/schemas';
import { requireAdmin } from '../auth/guards';
import { callGasStream } from '../services/gas';
import { enforceRateLimit } from '../services/rateLimit';
import type { RequestContext } from '../types';
import { vnFileStamp } from '../utils/csv';
import { ApiError, fileResponse } from '../utils/http';
import { logEvent } from '../utils/log';

/**
 * GET /api/admin/export/:dataset — xuất CSV từ trang quản trị (chỉ admin), theo đúng bộ lọc đang xem.
 *   handovers.csv · stock.csv · movements.csv · proposals.csv
 * Apps Script dựng sẵn văn bản CSV (Export.gs: chống formula injection, ngày giờ Việt Nam, CRLF) và trả sau một dòng phong bì
 * nhỏ; Worker chỉ kiểm tra bộ lọc, đọc dòng phong bì, rồi CHUYỂN THẲNG phần CSV (stream, có BOM UTF-8) — CPU của Worker không tăng
 * theo kích thước tệp (Workers Free: 10 ms / request; dựng CSV ở Worker từng tốn ~22–33 ms cho 5.000 dòng). Tối đa EXPORT_MAX_ROWS
 * dòng / lần; nhiều hơn → header X-Export-Truncated: 1 và giao diện nhắc lọc theo khoảng ngày.
 */

/** = APP.EXPORT_MAX_ROWS trong apps-script/Config.gs. */
export const EXPORT_MAX_ROWS = 5000;

/** Bộ lọc hợp lệ của từng loại dữ liệu xuất (cùng schema với trang danh sách tương ứng). */
const DATASETS: Record<string, (query: Record<string, string>) => unknown> = {
  'handovers.csv': (q) => adminListQuerySchema.parse(q),
  'stock.csv': (q) => productListQuerySchema.parse(q),
  'movements.csv': (q) => movementListQuerySchema.parse(q),
  'proposals.csv': (q) => proposalListQuerySchema.parse(q),
};

/** Dòng phong bì của Apps Script (Export.gs) — nội dung CSV đi sau, chuyển thẳng. */
interface GasCsvHeader {
  fileBase: string;
  rows: number;
  total: number;
}

/** BOM UTF-8 — Excel nhận đúng tiếng Việt. */
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/** Stream mới: BOM rồi toàn bộ nội dung `body` (không đọc / chép nội dung vào bộ nhớ Worker). */
function withBom(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(UTF8_BOM);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function exportCsvHandler(c: RequestContext): Promise<Response> {
  const { actor } = await requireAdmin(c);
  const dataset = c.params.dataset ?? '';
  const parseFilters = Object.hasOwn(DATASETS, dataset) ? DATASETS[dataset] : undefined;
  if (!parseFilters) throw new ApiError(404, 'NOT_FOUND', 'Không có dữ liệu xuất này.');
  await enforceRateLimit(c, 'RL_WRITE', 'export');

  const filters = parseFilters(Object.fromEntries(c.url.searchParams));
  const { data, body } = await callGasStream<GasCsvHeader>(c.env, 'adminExportCsv', { dataset, filters, actor }, {
    scope: 'admin',
    timeoutMs: 90_000,
    retries: 1,
  });
  const truncated = data.total > data.rows;
  logEvent('info', c, 'admin.export', { dataset, rows: data.rows, total: data.total, truncated, by: actor.id });
  return fileResponse(withBom(body), 'text/csv; charset=utf-8', `${data.fileBase}-${vnFileStamp()}.csv`, 'attachment', {
    'X-Export-Rows': String(data.rows),
    'X-Export-Total': String(data.total),
    'X-Export-Truncated': truncated ? '1' : '0',
  });
}
