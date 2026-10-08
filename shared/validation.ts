import { ITEM_FIELD_KEYS } from './constants';
import type { Category, HandoverItemInput } from './types';

/** Kiểm tra trường bắt buộc theo cấu hình LOAI_BAN_GIAO (dùng ở frontend; Apps Script kiểm tra lại). */
export function validateItemsAgainstCategories(
  items: HandoverItemInput[],
  categories: Category[],
): Record<string, string> {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const errors: Record<string, string> = {};
  items.forEach((item, index) => {
    const category = byCode.get(item.category);
    if (!category) {
      errors[`items.${index}.category`] = 'Loại bàn giao không tồn tại';
      return;
    }
    for (const field of category.fields) {
      if (!field.required) continue;
      const value = item[field.key];
      const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
      const path = `items.${index}.${field.key}`;
      if (empty && !(path in errors)) errors[path] = `${field.label} là bắt buộc`;
    }
  });
  return errors;
}

/** Xóa giá trị của các trường không hiển thị trong loại bàn giao đã chọn. */
export function pickCategoryFields(item: HandoverItemInput, category: Category | undefined): HandoverItemInput {
  if (!category) return item;
  const allowed = new Set<string>(category.fields.map((f) => f.key));
  const out: HandoverItemInput = { ...item };
  for (const key of ITEM_FIELD_KEYS) {
    if (allowed.has(key)) continue;
    if (key === 'quantity') out.quantity = null;
    else out[key] = '';
  }
  return out;
}

export function emptyItem(category: string): HandoverItemInput {
  return {
    category,
    itemName: '',
    assetCode: '',
    serialNumber: '',
    model: '',
    quantity: 1,
    unit: '',
    condition: '',
    description: '',
    workStatus: '',
    deadline: '',
    documentUrl: '',
    note: '',
  };
}
