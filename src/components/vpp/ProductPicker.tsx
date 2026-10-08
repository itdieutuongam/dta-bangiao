import { describedBy } from '../ui/Field';

export interface PickableProduct {
  productId: string;
  productName: string;
  unit: string;
  productCode?: string;
}

/** "Bút bi (Cây) · VPP-0001" */
export function productOptionLabel(product: PickableProduct): string {
  return `${product.productName}${product.unit ? ` (${product.unit})` : ''}${product.productCode ? ` · ${product.productCode}` : ''}`;
}

/**
 * Ô tìm + danh sách chọn sản phẩm (listbox) — đặt trong <Field id={id}>. Mục được tô sáng LUÔN là sản phẩm sẽ gửi đi:
 * khi giá trị không khớp mục nào, trình duyệt tự tô sáng mục đầu tiên (bấm vào mục đó cũng không phát sinh sự kiện chọn).
 * Vì vậy: chưa chọn → dòng giữ chỗ không chọn được; sản phẩm đang chọn bị bộ lọc ẩn → vẫn ghim ở đầu danh sách;
 * luôn hiện dòng "Đã chọn: tên (ĐVT)".
 */
export function ProductPicker<T extends PickableProduct>({
  id,
  query,
  onQueryChange,
  options,
  selected,
  onSelect,
  loading = false,
  loadError = false,
  error,
  searchLabel = 'Tìm sản phẩm',
  searchPlaceholder = 'Tìm sản phẩm (có dấu / không dấu)…',
  optionLabel = productOptionLabel,
}: {
  id: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Sản phẩm khớp ô tìm (đã lọc). */
  options: T[];
  selected: T | null;
  onSelect: (product: T) => void;
  loading?: boolean;
  loadError?: boolean;
  /** Lỗi của trường (Field hiển thị) — để gắn aria-invalid / aria-describedby. */
  error?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  optionLabel?: (product: T) => string;
}) {
  const list = selected && !options.some((p) => p.productId === selected.productId) ? [selected, ...options] : options;
  const selectedInfoId = `${id}-selected`;
  return (
    <>
      <input
        type="search"
        className="field-input"
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        id={id}
        size={6}
        className="field-input h-auto"
        value={selected?.productId ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy(id, error), selectedInfoId].filter(Boolean).join(' ')}
        onChange={(e) => {
          const product = list.find((p) => p.productId === e.target.value);
          if (product) onSelect(product);
        }}
      >
        {!selected && (
          <option value="" disabled>
            {loading ? 'Đang tải sản phẩm…' : list.length ? '— Chọn một sản phẩm trong danh sách —' : 'Không có sản phẩm phù hợp'}
          </option>
        )}
        {list.map((p) => (
          <option key={p.productId} value={p.productId}>
            {optionLabel(p)}
          </option>
        ))}
      </select>
      <p id={selectedInfoId} className="text-xs text-stone-600">
        {selected ? (
          <>
            Đã chọn: <strong className="text-stone-900">{selected.productName}</strong> ({selected.unit || 'chưa có ĐVT'})
          </>
        ) : (
          'Chưa chọn sản phẩm.'
        )}
      </p>
      {loadError && <p className="text-xs text-red-700">Không tải được danh sách sản phẩm.</p>}
    </>
  );
}
