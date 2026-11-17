import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { ITEM_FIELD_KEYS, ITEM_FIELD_META, type ItemFieldKey } from '../../../shared/constants';
import { isHttpUrl } from '../../../shared/text';
import type { Category, CategoryField, HandoverItem } from '../../../shared/types';
import { ISSUE_KIND_LABELS, UNIFORM_CATEGORY_CODE } from '../../../shared/uniform';
import { formatDate } from '../../utils/format';

/**
 * Trường hiển thị: theo cấu hình loại (nhãn, thứ tự riêng) + MỌI trường khác có dữ liệu (nhãn mặc định). Đổi cấu hình
 * LOAI_BAN_GIAO sau khi tạo / ký phiếu (ví dụ bỏ ô Serial) không làm ẩn dữ liệu đã có — người nhận thấy đúng những gì mình ký.
 */
function fieldsFor(category: Category | undefined): CategoryField[] {
  const configured = category?.fields ?? [];
  const shown = new Set<ItemFieldKey>(configured.map((f) => f.key));
  return [
    ...configured,
    ...ITEM_FIELD_KEYS.filter((key) => !shown.has(key)).map((key) => ({ key, label: ITEM_FIELD_META[key].label, required: false })),
  ];
}

function DetailValue({ fieldKey, value }: { fieldKey: ItemFieldKey; value: string }) {
  // Chỉ tạo link cho địa chỉ http(s) hợp lệ — giá trị bị sửa thẳng trên Sheet (bỏ qua kiểm tra khi nhập) hiện dạng chữ.
  if (fieldKey === 'documentUrl' && isHttpUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium break-all text-brand-700 underline underline-offset-2 hover:text-brand-900"
      >
        {value}
        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  if (fieldKey === 'deadline') return <>{formatDate(value)}</>;
  return <span className="break-words whitespace-pre-wrap">{value}</span>;
}

/** Trường đã hiện ở dòng nhãn của dòng đồng phục (size / tình trạng / hình thức + hạn trả) — không lặp lại bên dưới. */
const UNIFORM_SHOWN: ReadonlySet<ItemFieldKey> = new Set(['condition', 'deadline', 'assetCode']);

/**
 * Danh sách nội dung bàn giao (chỉ đọc) — nội dung người dùng luôn render dạng text.
 * showInternal: hiện thêm thông tin nội bộ (lý do vượt định mức / tiêu chuẩn) — chỉ dùng ở trang quản trị.
 * renderExtra: nội dung thêm cho từng dòng (ví dụ "đã trả x / n" của dòng đồng phục ở trang quản trị).
 */
export function HandoverItemsView({
  items,
  categories,
  showInternal = false,
  renderExtra,
}: {
  items: HandoverItem[];
  categories: Category[];
  showInternal?: boolean;
  renderExtra?: (item: HandoverItem) => ReactNode;
}) {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const category = byCode.get(item.category);
        const uniform = item.category === UNIFORM_CATEGORY_CODE;
        const fields = fieldsFor(category);
        const descriptionIsTitle = !item.itemName;
        const title = item.itemName || item.description;
        const details = fields.filter((f) => {
          // Số lượng + ĐVT hiển thị chung ở dòng nhãn phía trên.
          if (f.key === 'itemName' || f.key === 'quantity') return false;
          if (f.key === 'unit' && item.quantity !== null) return false;
          if (f.key === 'description' && descriptionIsTitle) return false;
          if (uniform && UNIFORM_SHOWN.has(f.key)) return false;
          const value = item[f.key];
          return value !== null && value !== undefined && String(value).trim() !== '';
        });
        return (
          <li key={item.itemId || index} className="rounded-lg border border-stone-200 bg-white p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800">
                {index + 1}
              </span>
              <span className="rounded-full bg-gold-100 px-2 py-0.5 font-semibold text-brand-800">
                {category?.name ?? item.category}
              </span>
              {item.quantity !== null && (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                  SL: {item.quantity.toLocaleString('vi-VN')}
                  {item.unit ? ` ${item.unit}` : ''}
                </span>
              )}
            </div>
            <p className="mt-2 font-semibold break-words whitespace-pre-wrap text-stone-900">{title}</p>
            {uniform && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                {item.size && (
                  <span className="rounded-md bg-brand-50 px-2 py-0.5 font-bold text-brand-900 ring-1 ring-brand-200">Size {item.size}</span>
                )}
                {item.condition && <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-700">{item.condition}</span>}
                {item.issueKind === 'CHO_MUON' ? (
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-900 ring-1 ring-sky-200">
                    {ISSUE_KIND_LABELS.CHO_MUON}
                    {item.deadline ? ` — hạn trả ${formatDate(item.deadline)}` : ''}
                  </span>
                ) : (
                  item.issueKind && <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900">{ISSUE_KIND_LABELS.CAP_PHAT}</span>
                )}
              </p>
            )}
            {showInternal && item.overNormReason && (
              <p className="mt-1.5 rounded-md bg-orange-50 px-2.5 py-1.5 text-sm break-words text-orange-900">
                <span className="font-semibold">{uniform ? 'Lý do vượt tiêu chuẩn năm:' : 'Lý do vượt định mức:'}</span> {item.overNormReason}
              </p>
            )}
            {details.length > 0 && (
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {details.map((field) => (
                  <div
                    key={field.key}
                    className={
                      ITEM_FIELD_META[field.key].kind === 'textarea' || field.key === 'documentUrl'
                        ? 'min-w-0 sm:col-span-2'
                        : 'min-w-0'
                    }
                  >
                    <dt className="text-xs text-stone-500">{field.label}</dt>
                    <dd className="text-stone-800">
                      <DetailValue fieldKey={field.key} value={String(item[field.key])} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {renderExtra?.(item)}
          </li>
        );
      })}
    </ol>
  );
}
