import { Copy } from 'lucide-react';
import { useId, useRef } from 'react';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // thử cách dự phòng bên dưới
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Ô link chỉ đọc + nút sao chép (toast khi thành công). */
export function CopyField({ value, label, buttonLabel = 'SAO CHÉP LINK' }: { value: string; label: string; buttonLabel?: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function handleCopy() {
    if (await copyText(value)) {
      toast.show('Đã sao chép link xác nhận.');
    } else {
      inputRef.current?.select();
      toast.show('Không sao chép tự động được — hãy nhấn giữ và chọn Sao chép.', 'info');
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="field-input min-w-0 flex-1 font-mono text-sm"
        />
        <Button onClick={handleCopy} icon={<Copy className="size-4" aria-hidden="true" />} className="shrink-0">
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

export { copyText };
