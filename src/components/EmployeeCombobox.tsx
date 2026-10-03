import { Search, UserRoundPen, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Employee } from '../../shared/types';
import { cn } from '../utils/cn';
import { buildEmployeeIndex, searchEmployees } from '../utils/employeeSearch';
import { EmployeeCard } from './EmployeeCard';
import { Button } from './ui/Button';
import { describedBy, Field } from './ui/Field';

interface EmployeeComboboxProps {
  id: string;
  label: string;
  employees: Employee[];
  selected: Employee | null;
  onSelect: (employee: Employee | null) => void;
  /** Cho phép nhập tên tự do (người bàn giao). Không truyền = bắt buộc chọn từ danh sách. */
  freeText?: { value: string; onChange: (value: string) => void };
  excludeEmployeeId?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  placeholder?: string;
}

/**
 * Ô tìm & chọn nhân viên: tìm theo tên / mã NV / email / phòng ban, có dấu hoặc không dấu.
 * Bàn phím: ↑ ↓ chọn, Enter xác nhận, Esc đóng danh sách.
 */
export function EmployeeCombobox({
  id,
  label,
  employees,
  selected,
  onSelect,
  freeText,
  excludeEmployeeId,
  required,
  error,
  hint,
  placeholder = 'Tên, mã NV, email, phòng ban…',
}: EmployeeComboboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(freeText ? freeText.value : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const index = useMemo(
    () => buildEmployeeIndex(employees.filter((e) => e.employeeId !== excludeEmployeeId)),
    [employees, excludeEmployeeId],
  );
  const results = useMemo(() => searchEmployees(index, query, 30), [index, query]);

  // Đồng bộ ô nhập khi giá trị tự do thay đổi từ bên ngoài (ví dụ reset form).
  useEffect(() => {
    if (freeText) setQuery(freeText.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeText?.value]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(employee: Employee) {
    onSelect(employee);
    if (freeText) {
      freeText.onChange(employee.fullName);
      setQuery(employee.fullName);
    } else {
      setQuery('');
    }
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      // Enter khi danh sách đang mở = chọn nhân viên, không submit form.
      if (open) {
        event.preventDefault();
        if (results[active]) choose(results[active]);
        else setOpen(false);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  // Chế độ bắt buộc chọn (người nhận): đã chọn → hiển thị thẻ thông tin thay cho ô tìm.
  if (!freeText && selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-stone-800" id={`${id}-label`}>
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </span>
        <EmployeeCard
          name={selected.fullName}
          employeeId={selected.employeeId}
          department={selected.department}
          position={selected.position}
          email={selected.email}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelect(null);
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
              aria-label={`Đổi ${label.toLowerCase()}`}
              icon={<UserRoundPen className="size-4" aria-hidden="true" />}
            >
              Đổi
            </Button>
          }
        />
        {error && (
          <p id={`${id}-error`} className="text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  const activeId = open && results[active] ? `${listId}-opt-${active}` : undefined;
  const showList = open && (results.length > 0 || query.trim() !== '');

  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className="field-input pr-9 pl-9"
          placeholder={placeholder}
          value={query}
          maxLength={120}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (freeText) {
              freeText.onChange(event.target.value);
              if (selected) onSelect(null);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700"
            aria-label="Xóa nội dung tìm kiếm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('');
              if (freeText) freeText.onChange('');
              onSelect(null);
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`Danh sách ${label.toLowerCase()}`}
          hidden={!showList}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {results.map((employee, i) => (
            <li
              key={employee.employeeId}
              id={`${listId}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                i === active ? 'bg-brand-50 text-brand-900' : 'text-stone-800',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(employee)}
            >
              <span className="block font-medium">{employee.fullName}</span>
              <span className="block text-xs text-stone-500">
                {[employee.employeeId, employee.department, employee.position].filter(Boolean).join(' · ')}
                {employee.email ? ` · ${employee.email}` : ''}
              </span>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-stone-500" role="presentation">
              {freeText
                ? 'Không có trong danh sách nhân viên — hệ thống sẽ dùng tên bạn nhập.'
                : 'Không tìm thấy nhân viên phù hợp.'}
            </li>
          )}
        </ul>
      </div>
      {freeText && selected && (
        <p className="text-xs text-stone-600">
          Đã chọn từ danh sách: <span className="font-medium">{selected.employeeId}</span>
          {selected.department ? ` · ${selected.department}` : ''}
          {selected.position ? ` · ${selected.position}` : ''}
        </p>
      )}
    </Field>
  );
}
