import { Eraser, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { LIMITS } from '../../shared/constants';
import { cn } from '../utils/cn';
import { Button } from './ui/Button';

/** Hệ tọa độ logic cố định 600×300 (tỉ lệ 2:1) — độc lập kích thước hiển thị & mật độ điểm ảnh. */
const LOGICAL_WIDTH = 600;
const LOGICAL_HEIGHT = 300;
const BASE_LINE_WIDTH = 2.8;
const INK = '#111827';
/** Tổng độ dài nét tối thiểu (đơn vị logic) để tránh "chữ ký" chỉ là một chấm. */
export const MIN_INK_LENGTH = 60;

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  width: number;
}

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  inkLength: () => number;
  /** PNG đã cắt sát vùng chữ ký, nền trắng, tối đa 600×300. null nếu chưa ký. */
  toPngDataUrl: () => string | null;
}

interface SignaturePadProps {
  ref?: Ref<SignaturePadHandle>;
  onChange?: (hasInk: boolean) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = stroke.width;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0]!.x, pts[0]!.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  // Làm mượt bằng đường cong bậc 2 qua trung điểm các đoạn.
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i]!.x + pts[i + 1]!.x) / 2;
    const midY = (pts[i]!.y + pts[i + 1]!.y) / 2;
    ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, midX, midY);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function strokeLength(stroke: Stroke): number {
  let total = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    total += Math.hypot(stroke.points[i]!.x - stroke.points[i - 1]!.x, stroke.points[i]!.y - stroke.points[i - 1]!.y);
  }
  return total;
}

function exportPng(strokes: Stroke[]): string | null {
  const points = strokes.flatMap((s) => s.points);
  if (points.length === 0) return null;
  const maxWidth = Math.max(...strokes.map((s) => s.width));
  const pad = maxWidth + 8;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= pad;
  minY -= pad;
  const width = maxX + pad - minX;
  const height = maxY + pad - minY;
  // Vừa khung 600×300, giữ tỉ lệ; phóng tối đa 2× khi chữ ký nhỏ.
  const scale = Math.min(LIMITS.signatureExportWidth / width, LIMITS.signatureExportHeight / height, 2);
  const outWidth = Math.max(40, Math.round(width * scale));
  const outHeight = Math.max(20, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
  for (const stroke of strokes) drawStroke(ctx, stroke);
  return canvas.toDataURL('image/png');
}

/** Khung ký tên: chuột, cảm ứng, bút (Pointer Events). Không cuộn trang khi đang ký. */
export function SignaturePad({ ref, onChange, invalid, describedBy, disabled }: SignaturePadProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activePointer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / LOGICAL_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
  }, []);

  const scheduleRedraw = useCallback(() => {
    if (frame.current === null) frame.current = window.requestAnimationFrame(redraw);
  }, [redraw]);

  const notify = useCallback(() => {
    const ink = strokesRef.current.length > 0;
    setHasInk(ink);
    onChange?.(ink);
  }, [onChange]);

  // Kích thước canvas theo khung hiển thị × devicePixelRatio (nét sắc trên màn hình Retina).
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.width * dpr * (LOGICAL_HEIGHT / LOGICAL_WIDTH)));
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [redraw]);

  // iOS Safari cũ: chặn cuộn/zoom khi chạm vào khung ký (bổ sung cho touch-action: none).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prevent = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    canvas.addEventListener('touchstart', prevent, { passive: false });
    canvas.addEventListener('touchmove', prevent, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', prevent);
      canvas.removeEventListener('touchmove', prevent);
    };
  }, []);

  const clear = useCallback(() => {
    strokesRef.current = [];
    activePointer.current = null;
    redraw();
    notify();
  }, [notify, redraw]);

  useImperativeHandle(
    ref,
    () => ({
      clear,
      isEmpty: () => strokesRef.current.length === 0,
      inkLength: () => strokesRef.current.reduce((sum, s) => sum + strokeLength(s), 0),
      toPngDataUrl: () => exportPng(strokesRef.current),
    }),
    [clear],
  );

  function toPoint(event: { clientX: number; clientY: number }): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * LOGICAL_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * LOGICAL_HEIGHT,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
    strokesRef.current.push({ points: [toPoint(event)], width: BASE_LINE_WIDTH * (0.7 + pressure * 0.6) });
    scheduleRedraw();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!stroke) return;
    const native = event.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const e of coalesced.length > 0 ? coalesced : [native]) {
      const point = toPoint(e);
      const last = stroke.points[stroke.points.length - 1]!;
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.75) stroke.points.push(point);
    }
    scheduleRedraw();
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    notify();
  }

  function undo() {
    strokesRef.current.pop();
    redraw();
    notify();
  }

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className={cn(
          'relative w-full overflow-hidden rounded-xl border-2 border-dashed bg-white',
          invalid ? 'border-red-400' : 'border-stone-300',
          disabled && 'opacity-60',
        )}
        style={{ aspectRatio: `${LOGICAL_WIDTH} / ${LOGICAL_HEIGHT}` }}
      >
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-stone-400 select-none">
            Ký tên tại đây
          </span>
        )}
        <span className="pointer-events-none absolute right-[8%] bottom-[22%] left-[8%] border-b border-stone-200" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Khung ký tên. Dùng ngón tay, bút cảm ứng hoặc chuột để ký."
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="absolute inset-0 block size-full cursor-crosshair touch-none select-none"
          style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={!hasInk || disabled}
          icon={<Undo2 className="size-4" aria-hidden="true" />}
        >
          Hoàn tác nét cuối
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={clear}
          disabled={!hasInk || disabled}
          icon={<Eraser className="size-4" aria-hidden="true" />}
        >
          XÓA CHỮ KÝ
        </Button>
      </div>
    </div>
  );
}
