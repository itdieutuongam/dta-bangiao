import { normalizeVietnamese } from '../../shared/text';

export interface SearchableProduct {
  productName: string;
  /** Danh mục công khai (/de-xuat-vpp) không có mã sản phẩm. */
  productCode?: string;
  unit: string;
  category: string;
}

/**
 * Tìm văn phòng phẩm theo tên / mã / ĐVT / nhóm — không phân biệt dấu, hoa thường.
 * "but bi" khớp "Bút bi Thiên Long 027, xanh"; nhiều từ khóa = phải khớp tất cả.
 */
export function searchProducts<T extends SearchableProduct>(products: T[], query: string, limit = 500): T[] {
  const q = normalizeVietnamese(query);
  if (!q) return products.slice(0, limit);
  const tokens = q.split(' ');
  const scored: Array<{ product: T; score: number }> = [];
  for (const product of products) {
    const name = normalizeVietnamese(product.productName);
    const code = normalizeVietnamese(product.productCode ?? '');
    const haystack = normalizeVietnamese([product.productName, code, product.unit, product.category].join(' '));
    if (!tokens.every((token) => haystack.includes(token))) continue;
    let score = 0;
    if (code && code === q) score += 100;
    if (name.startsWith(q)) score += 50;
    else if (name.includes(q)) score += 30;
    scored.push({ product, score });
  }
  scored.sort((a, b) => b.score - a.score || a.product.productName.localeCompare(b.product.productName, 'vi'));
  return scored.slice(0, limit).map((s) => s.product);
}
