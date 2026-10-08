import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CONDITION_SUGGESTIONS, LIMITS, WORK_STATUS_SUGGESTIONS, type HandoverType, type ItemFieldKey } from '../../../shared/constants';
import type { Category, Employee, HandoverInput } from '../../../shared/types';
import { useUnsavedChangesWarning } from '../../hooks/usePageMeta';
import { ApiClientError, errorMessage } from '../../services/api';
import { EmployeeCombobox } from '../EmployeeCombobox';
import { Button } from '../ui/Button';
import { describedBy, Field } from '../ui/Field';
import { InlineAlert } from '../ui/States';
import {
  categoriesForType,
  countErrors,
  emptyFormItem,
  errorElementIds,
  isItemTouched,
  NO_ERRORS,
  splitErrors,
  validateHandoverForm,
  type FormErrors,
  type FormItem,
  type HandoverFormValues,
} from './formModel';
import { ItemEditor } from './ItemEditor';

interface HandoverFormProps {
  /** Loại phiếu (không gồm Văn phòng phẩm — dùng VppHandoverForm). Chỉ hiện loại nội dung thuộc loại phiếu này. */
  handoverType: Exclude<HandoverType, 'OFFICE_SUPPLY'>;
  employees: Employee[];
  categories: Category[];
  initialValues?: HandoverFormValues;
  submitLabel: string;
  submitIcon?: ReactNode;
  onSubmit: (input: HandoverInput) => Promise<void>;
  onCancel?: () => void;
  /** Thao tác đi kèm thông báo lỗi khi lưu (vd. link mở phiếu đã tạo khi REQUEST_REUSED); clear: ẩn thông báo. */
  submitErrorActions?: (error: unknown, clear: () => void) => ReactNode;
}

export function HandoverForm({
  handoverType,
  employees,
  categories: allCategories,
  initialValues,
  submitLabel,
  submitIcon,
  onSubmit,
  onCancel,
  submitErrorActions,
}: HandoverFormProps) {
  const categories = useMemo(() => categoriesForType(allCategories, handoverType), [allCategories, handoverType]);
  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories]);
  const defaultCategory = activeCategories[0]?.code ?? categories[0]?.code ?? 'KHAC';

  const [values, setValues] = useState<HandoverFormValues>(
    () =>
      initialValues ?? {
        senderName: '',
        senderEmployee: null,
        receiver: null,
        note: '',
        items: [emptyFormItem(defaultCategory)],
      },
  );
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingFocus = useRef<string | null>(null);

  useUnsavedChangesWarning(dirty && !submitting);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    pendingFocus.current = null;
    element?.focus();
  });

  // Loại hiển thị trong ô chọn: loại đang dùng + loại ngừng dùng nhưng đã có trong biên bản (khi sửa).
  const selectableCategories = useMemo(
    () => categories.filter((c) => c.active || values.items.some((item) => item.category === c.code)),
    [categories, values.items],
  );

  const errorCount = countErrors(errors);

  function patch(next: Partial<HandoverFormValues>) {
    setValues((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function clearGeneral(...keys: string[]) {
    setErrors((current) => {
      if (!keys.some((k) => k in current.general)) return current;
      const general = { ...current.general };
      for (const k of keys) delete general[k];
      return { ...current, general };
    });
  }

  function clearItemError(uid: string, key: ItemFieldKey | 'category') {
    setErrors((current) => {
      const bucket = current.items[uid];
      if (!bucket || !(key in bucket)) return current;
      const nextBucket = { ...bucket };
      delete nextBucket[key];
      return { ...current, items: { ...current.items, [uid]: nextBucket } };
    });
  }

  function updateItem(uid: string, updater: (item: FormItem) => FormItem) {
    setValues((current) => ({ ...current, items: current.items.map((item) => (item.uid === uid ? updater(item) : item)) }));
    setDirty(true);
  }

  function addItem() {
    const lastCategory = values.items[values.items.length - 1]?.category;
    const category = activeCategories.some((c) => c.code === lastCategory) ? lastCategory! : defaultCategory;
    const item = emptyFormItem(category);
    patch({ items: [...values.items, item] });
    clearGeneral('items');
    pendingFocus.current = `item-${item.uid}-category`;
  }

  function removeItem(uid: string) {
    const index = values.items.findIndex((item) => item.uid === uid);
    const item = values.items[index];
    if (!item || values.items.length <= 1) return;
    if (isItemTouched(item) && !window.confirm(`Xóa nội dung #${index + 1}?`)) return;
    patch({ items: values.items.filter((i) => i.uid !== uid) });
    setErrors((current) => {
      const items = { ...current.items };
      delete items[uid];
      return { ...current, items };
    });
    pendingFocus.current = 'add-item-button';
  }

  function moveItem(uid: string, direction: -1 | 1) {
    const index = values.items.findIndex((item) => item.uid === uid);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= values.items.length) return;
    const items = [...values.items];
    [items[index], items[target]] = [items[target]!, items[index]!];
    patch({ items });
    const atEdge = (direction < 0 && target === 0) || (direction > 0 && target === items.length - 1);
    pendingFocus.current = `item-${uid}-${(direction < 0) !== atEdge ? 'up' : 'down'}`;
  }

  function focusFirstError(next: FormErrors) {
    window.requestAnimationFrame(() => {
      for (const id of errorElementIds(next, values.items)) {
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          element.focus({ preventScroll: true });
          return;
        }
      }
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    const { input, errors: nextErrors } = validateHandoverForm(values, categories, handoverType);
    if (!input) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }
    setErrors(NO_ERRORS);
    setSubmitting(true);
    try {
      await onSubmit(input);
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length > 0) {
        const mapped = splitErrors(err.fieldErrors, values.items, categories);
        setErrors(mapped);
        focusFirstError(mapped);
      }
      setSubmitError(errorMessage(err, 'Không thể lưu biên bản. Vui lòng thử lại.'));
      setSubmitFailure(err);
    } finally {
      setSubmitting(false);
    }
  }

  const senderError = errors.general['sender.name'] ?? errors.general['sender.employeeId'];

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-describedby={submitError ? 'form-submit-error' : undefined}>
      <datalist id="dta-condition-options">
        {CONDITION_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="dta-work-status-options">
        {WORK_STATUS_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <section className="card p-4 sm:p-6" aria-labelledby="section-people">
        <h2 id="section-people" className="section-title">
          Thông tin bàn giao
        </h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <EmployeeCombobox
            id="sender-name"
            label="Người bàn giao"
            employees={employees}
            selected={values.senderEmployee}
            onSelect={(employee) => {
              patch({ senderEmployee: employee });
              clearGeneral('sender.name', 'sender.employeeId', 'receiverEmployeeId');
            }}
            freeText={{
              value: values.senderName,
              onChange: (value) => {
                patch({ senderName: value });
                clearGeneral('sender.name');
              },
            }}
            excludeEmployeeId={values.receiver?.employeeId}
            required
            error={senderError}
            hint="Chọn từ danh sách hoặc nhập họ tên người bàn giao."
            placeholder="Nhập tên hoặc tìm nhân viên…"
          />
          <EmployeeCombobox
            id="receiver"
            label="Người nhận"
            employees={employees}
            selected={values.receiver}
            onSelect={(employee) => {
              patch({ receiver: employee });
              clearGeneral('receiverEmployeeId');
            }}
            excludeEmployeeId={values.senderEmployee?.employeeId}
            required
            error={errors.general.receiverEmployeeId}
            hint="Bắt buộc chọn từ danh sách nhân viên."
          />
        </div>
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="section-items">
        <h2 id="section-items" className="section-title flex items-center gap-2">
          Nội dung bàn giao
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-800" aria-hidden="true">
            {values.items.length}
          </span>
          <span className="sr-only">({values.items.length} mục)</span>
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          {handoverType === 'OTHER'
            ? 'Một biên bản có thể gồm nhiều nội dung: thiết bị, thẻ, tài khoản, công việc, hồ sơ…'
            : 'Một biên bản có thể gồm nhiều nội dung cùng loại.'}
        </p>
        {activeCategories.length === 0 && (
          <InlineAlert tone="warning" className="mt-3">
            Chưa có loại nội dung nào cho loại phiếu này. Thêm dòng vào sheet LOAI_BAN_GIAO (cột handover_type) rồi bấm “Làm mới dữ liệu”.
          </InlineAlert>
        )}
        {errors.general.items && (
          <InlineAlert className="mt-3">{errors.general.items}</InlineAlert>
        )}
        <div className="mt-4 space-y-4">
          {values.items.map((item, index) => (
            <ItemEditor
              key={item.uid}
              index={index}
              total={values.items.length}
              item={item}
              categories={selectableCategories}
              errors={errors.items[item.uid]}
              onCategoryChange={(code) => {
                updateItem(item.uid, (current) => ({ ...current, category: code }));
                setErrors((current) => {
                  const items = { ...current.items };
                  delete items[item.uid];
                  return { ...current, items };
                });
              }}
              onFieldChange={(key, value) => {
                updateItem(item.uid, (current) => ({ ...current, values: { ...current.values, [key]: value } }));
                clearItemError(item.uid, key);
              }}
              onRemove={() => removeItem(item.uid)}
              onMove={(direction) => moveItem(item.uid, direction)}
            />
          ))}
        </div>
        <button
          id="add-item-button"
          type="button"
          onClick={addItem}
          disabled={values.items.length >= LIMITS.maxItems}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/60 px-4 py-3 text-sm font-bold tracking-wide text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-5" aria-hidden="true" />
          THÊM NỘI DUNG
        </button>
      </section>

      <section className="card p-4 sm:p-6" aria-labelledby="section-note">
        <h2 id="section-note" className="section-title">
          Ghi chú
        </h2>
        <Field
          id="handover-note"
          label={<span className="sr-only">Ghi chú cho biên bản</span>}
          error={errors.general.note}
          hint="Thông tin bổ sung cho cả biên bản (không bắt buộc)."
          className="mt-2"
        >
          <textarea
            id="handover-note"
            className="field-input min-h-24 resize-y"
            rows={3}
            maxLength={LIMITS.handoverNote}
            value={values.note}
            aria-invalid={errors.general.note ? true : undefined}
            aria-describedby={describedBy('handover-note', errors.general.note, 'hint')}
            onChange={(event) => {
              patch({ note: event.target.value });
              clearGeneral('note');
            }}
          />
        </Field>
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 space-y-3 border-t border-stone-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:p-4 sm:shadow-sm">
        {errorCount > 0 && !submitError && (
          <p role="alert" className="text-sm font-medium text-red-700">
            Vui lòng kiểm tra lại {errorCount} mục chưa hợp lệ.
          </p>
        )}
        {submitError && (
          <InlineAlert>
            <span id="form-submit-error">{submitError}</span>
            {submitErrorActions?.(submitFailure, () => setSubmitError(null))}
          </InlineAlert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {onCancel && (
            <Button variant="secondary" size="lg" onClick={onCancel} disabled={submitting}>
              Hủy
            </Button>
          )}
          <Button type="submit" size="lg" loading={submitting} icon={submitIcon} className="sm:min-w-56">
            {submitting ? 'Đang lưu…' : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
