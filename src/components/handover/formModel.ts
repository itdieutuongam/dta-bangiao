import { ITEM_FIELD_KEYS, type ItemFieldKey } from '../../../shared/constants';
import { handoverInputSchema, toFieldErrors } from '../../../shared/schemas';
import type { Category, Employee, HandoverInput, HandoverItem, HandoverItemInput } from '../../../shared/types';
import { pickCategoryFields, validateItemsAgainstCategories } from '../../../shared/validation';

export type ItemValues = Record<ItemFieldKey, string>;

export interface FormItem {
  uid: string;
  category: string;
  values: ItemValues;
}

export interface HandoverFormValues {
  senderName: string;
  senderEmployee: Employee | null;
  receiver: Employee | null;
  note: string;
  items: FormItem[];
}

export interface FormErrors {
  general: Record<string, string>;
  items: Record<string, Partial<Record<ItemFieldKey | 'category', string>>>;
}

export const NO_ERRORS: FormErrors = { general: {}, items: {} };

export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyValues(): ItemValues {
  const values = {} as ItemValues;
  for (const key of ITEM_FIELD_KEYS) values[key] = '';
  values.quantity = '1';
  return values;
}

export function emptyFormItem(category: string): FormItem {
  return { uid: newUid(), category, values: emptyValues() };
}

export function formItemFromItem(item: HandoverItem): FormItem {
  const values = emptyValues();
  for (const key of ITEM_FIELD_KEYS) {
    const raw = item[key];
    values[key] = raw === null || raw === undefined ? '' : String(raw);
  }
  return { uid: newUid(), category: item.category, values };
}

export function isItemTouched(item: FormItem): boolean {
  return ITEM_FIELD_KEYS.some((key) => (key === 'quantity' ? item.values.quantity !== '1' && item.values.quantity !== '' : item.values[key].trim() !== ''));
}

function toItemInput(item: FormItem, category: Category | undefined): HandoverItemInput {
  const v = item.values;
  const quantityText = v.quantity.trim();
  const base: HandoverItemInput = {
    category: item.category,
    itemName: v.itemName,
    assetCode: v.assetCode,
    serialNumber: v.serialNumber,
    model: v.model,
    quantity: quantityText === '' ? null : Number(quantityText),
    condition: v.condition,
    description: v.description,
    workStatus: v.workStatus,
    deadline: v.deadline,
    documentUrl: v.documentUrl,
    note: v.note,
  };
  return pickCategoryFields(base, category);
}

export function toHandoverInput(values: HandoverFormValues, categories: Category[]): HandoverInput {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  return {
    sender: values.senderEmployee
      ? { name: values.senderEmployee.fullName, employeeId: values.senderEmployee.employeeId }
      : { name: values.senderName, employeeId: '' },
    receiverEmployeeId: values.receiver?.employeeId ?? '',
    note: values.note,
    items: values.items.map((item) => toItemInput(item, byCode.get(item.category))),
  };
}

/**
 * Lỗi theo đường dẫn ("items.2.itemName") → lỗi theo uid của nội dung (không lệch khi sắp xếp lại).
 * Lỗi thuộc trường không hiển thị trong loại đã chọn được chuyển sang ô đầu tiên của loại đó.
 */
export function splitErrors(fieldErrors: Record<string, string>, items: FormItem[], categories: Category[]): FormErrors {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const result: FormErrors = { general: {}, items: {} };
  for (const [path, message] of Object.entries(fieldErrors)) {
    const m = /^items\.(\d+)\.(\w+)$/.exec(path);
    const item = m ? items[Number(m[1])] : undefined;
    if (!m || !item) {
      if (!(path in result.general)) result.general[path] = message;
      continue;
    }
    const bucket = (result.items[item.uid] ??= {});
    let key = m[2] as ItemFieldKey | 'category';
    const fields = byCode.get(item.category)?.fields ?? [];
    if (key !== 'category' && fields.length > 0 && !fields.some((f) => f.key === key)) {
      key = fields[0]!.key;
    }
    if (!bucket[key]) bucket[key] = message;
  }
  return result;
}

export function validateHandoverForm(
  values: HandoverFormValues,
  categories: Category[],
): { input: HandoverInput | null; errors: FormErrors } {
  const raw = toHandoverInput(values, categories);
  const parsed = handoverInputSchema.safeParse(raw);
  const fieldErrors = parsed.success ? {} : toFieldErrors(parsed.error);
  // Thông báo theo cấu hình loại ("Tên thiết bị là bắt buộc") cụ thể hơn thông báo chung → ưu tiên.
  Object.assign(fieldErrors, validateItemsAgainstCategories(raw.items, categories));
  if (!values.receiver && !fieldErrors.receiverEmployeeId) {
    fieldErrors.receiverEmployeeId = 'Chọn người nhận từ danh sách nhân viên';
  }
  const errors = splitErrors(fieldErrors, values.items, categories);
  const hasErrors = Object.keys(errors.general).length > 0 || Object.keys(errors.items).length > 0;
  return { input: parsed.success && !hasErrors ? parsed.data : null, errors };
}

export function countErrors(errors: FormErrors): number {
  return (
    Object.keys(errors.general).length +
    Object.values(errors.items).reduce((sum, bucket) => sum + Object.keys(bucket).length, 0)
  );
}

/** Id các phần tử DOM có lỗi theo thứ tự hiển thị — để cuộn & focus vào lỗi đầu tiên. */
export function errorElementIds(errors: FormErrors, items: FormItem[]): string[] {
  const ids: string[] = [];
  const general = errors.general;
  if (general['sender.name'] || general['sender.employeeId']) ids.push('sender-name');
  if (general.receiverEmployeeId) ids.push('receiver');
  if (general.items) ids.push('add-item-button');
  for (const item of items) {
    const bucket = errors.items[item.uid];
    if (!bucket) continue;
    if (bucket.category) ids.push(`item-${item.uid}-category`);
    for (const key of ITEM_FIELD_KEYS) if (bucket[key]) ids.push(`item-${item.uid}-${key}`);
  }
  if (general.note) ids.push('handover-note');
  return ids;
}
