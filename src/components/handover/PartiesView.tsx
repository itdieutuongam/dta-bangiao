import type { PersonRef, ReceiverInfo } from '../../../shared/types';

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1 text-sm">
      <dt className="w-24 shrink-0 text-stone-500">{label}</dt>
      <dd className="min-w-0 font-medium break-words text-stone-900">{value}</dd>
    </div>
  );
}

/** Thông tin bên giao / bên nhận. */
export function PartiesView({ sender, receiver }: { sender: PersonRef; receiver: ReceiverInfo }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-stone-200 bg-stone-50/60 p-4" aria-label="Người giao">
        <h3 className="mb-1 text-xs font-bold tracking-wider text-stone-500 uppercase">Người giao</h3>
        <dl>
          <Row label="Họ tên" value={sender.name} />
          <Row label="Mã NV" value={sender.employeeId} />
        </dl>
      </section>
      <section className="rounded-lg border border-brand-200 bg-brand-50/60 p-4" aria-label="Người nhận">
        <h3 className="mb-1 text-xs font-bold tracking-wider text-brand-700 uppercase">Người nhận</h3>
        <dl>
          <Row label="Họ tên" value={receiver.name} />
          <Row label="Mã NV" value={receiver.employeeId} />
          <Row label="Phòng ban" value={receiver.department} />
          <Row label="Chức vụ" value={receiver.position} />
          <Row label="Email" value={receiver.email} />
        </dl>
      </section>
    </div>
  );
}
