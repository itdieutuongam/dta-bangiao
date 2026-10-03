import { FileQuestion } from 'lucide-react';
import { ButtonLink } from '../components/ui/Button';
import { useDocumentTitle } from '../hooks/usePageMeta';

export default function NotFoundPage() {
  useDocumentTitle('Không tìm thấy trang');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
      <FileQuestion className="size-12 text-stone-400" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-stone-900">Không tìm thấy trang</h1>
      <p className="text-sm text-stone-600">Đường dẫn không tồn tại hoặc đã bị thay đổi.</p>
      <ButtonLink to="/" variant="primary">
        Về trang tạo bàn giao
      </ButtonLink>
    </div>
  );
}
