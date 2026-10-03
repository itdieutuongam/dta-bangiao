import { Building2, Hash, Mail, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

interface EmployeeCardProps {
  name: string;
  employeeId?: string;
  department?: string;
  position?: string;
  email?: string;
  action?: ReactNode;
  className?: string;
}

/** Thông tin nhân viên đã chọn (họ tên, mã NV, phòng ban, chức vụ, email). */
export function EmployeeCard({ name, employeeId, department, position, email, action, className }: EmployeeCardProps) {
  return (
    <div className={cn('rounded-lg border border-brand-200 bg-brand-50/70 p-3.5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold break-words text-stone-900">{name}</p>
            {position && <p className="text-sm text-stone-600">{position}</p>}
          </div>
        </div>
        {action}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {employeeId && (
          <div className="flex min-w-0 items-center gap-2 text-stone-700">
            <Hash className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
            <dt className="sr-only">Mã nhân viên</dt>
            <dd className="truncate">
              Mã NV: <span className="font-medium text-stone-900">{employeeId}</span>
            </dd>
          </div>
        )}
        {department && (
          <div className="flex min-w-0 items-center gap-2 text-stone-700">
            <Building2 className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
            <dt className="sr-only">Phòng ban</dt>
            <dd className="truncate">{department}</dd>
          </div>
        )}
        {email && (
          <div className="flex min-w-0 items-center gap-2 text-stone-700 sm:col-span-2">
            <Mail className="size-4 shrink-0 text-stone-400" aria-hidden="true" />
            <dt className="sr-only">Email</dt>
            <dd className="truncate">{email}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
