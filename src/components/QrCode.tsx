import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Mã QR dạng SVG (vẽ trực tiếp từ ma trận, không chèn HTML). */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`;
      }
    }
    return { path: d, count: n + 8 };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#1c1917" />
    </svg>
  );
}
