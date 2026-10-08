import { ChevronRight, Link2, ShieldCheck, ShoppingCart, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/usePageMeta';

function EntryCard({ to, icon: Icon, title, description }: { to: string; icon: LucideIcon; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="card group flex items-center gap-4 p-5 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-gold-400"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-brand-900">{title}</span>
        <span className="mt-0.5 block text-sm text-stone-600">{description}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/** Trang chủ công khai: chỉ dẫn tới đề xuất VPP, khu quản trị; nhắc người nhận dùng link xác nhận. */
export default function HomePage() {
  useDocumentTitle('Trang chủ');
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:py-12">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-brand-900 sm:text-3xl">Hệ thống bàn giao nội bộ</h1>
        <p className="mt-2 text-sm text-stone-600">Diệu Tướng Am — biên bản bàn giao & văn phòng phẩm</p>
      </div>

      <div className="space-y-3">
        <EntryCard
          to="/de-xuat-vpp"
          icon={ShoppingCart}
          title="Đề xuất văn phòng phẩm"
          description="Nhân viên đề xuất mua văn phòng phẩm theo định mức của phòng ban."
        />
        <EntryCard
          to="/admin"
          icon={ShieldCheck}
          title="Quản trị"
          description="Tạo và quản lý phiếu bàn giao, kho văn phòng phẩm (dành cho quản trị viên)."
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white/70 p-4 text-sm text-stone-700">
        <Link2 className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <p>
          <strong className="text-stone-900">Bạn nhận được biên bản bàn giao?</strong> Mở đúng link xác nhận được gửi cho bạn (qua tin nhắn,
          email hoặc mã QR) để kiểm tra nội dung và ký xác nhận trên điện thoại của chính bạn.
        </p>
      </div>
    </div>
  );
}
