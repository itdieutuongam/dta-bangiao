import type { ReactNode } from 'react';

/** Tiêu đề trang quản trị: tiêu đề + mô tả + nút thao tác (xuống dòng trên mobile). */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-brand-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-stone-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
