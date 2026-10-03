import { normalizeVietnamese } from '../../shared/text';
import type { Employee } from '../../shared/types';

export interface IndexedEmployee {
  employee: Employee;
  name: string;
  id: string;
  haystack: string;
}

export function buildEmployeeIndex(employees: Employee[]): IndexedEmployee[] {
  return employees.map((employee) => {
    const name = normalizeVietnamese(employee.fullName);
    const id = normalizeVietnamese(employee.employeeId);
    return {
      employee,
      name,
      id,
      haystack: normalizeVietnamese(
        [employee.fullName, employee.employeeId, employee.email, employee.department, employee.position].join(' '),
      ),
    };
  });
}

/**
 * Tìm theo tên / mã nhân viên / email / phòng ban — không phân biệt dấu, hoa thường.
 * "Pham Danh Thai" khớp "Phạm Danh Thái"; nhiều từ khóa = phải khớp tất cả.
 */
export function searchEmployees(index: IndexedEmployee[], query: string, limit = 30): Employee[] {
  const q = normalizeVietnamese(query);
  if (!q) return index.slice(0, limit).map((entry) => entry.employee);
  const tokens = q.split(' ');
  const scored: Array<{ entry: IndexedEmployee; score: number }> = [];
  for (const entry of index) {
    if (!tokens.every((token) => entry.haystack.includes(token))) continue;
    let score = 0;
    if (entry.id === q) score += 100;
    else if (entry.id.startsWith(q)) score += 60;
    if (entry.name === q) score += 80;
    else if (entry.name.startsWith(q)) score += 50;
    else if (entry.name.includes(q)) score += 30;
    if (entry.name.split(' ').some((word) => word.startsWith(tokens[0]!))) score += 10;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, limit).map((s) => s.entry.employee);
}
