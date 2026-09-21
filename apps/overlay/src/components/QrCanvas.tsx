import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * The QR is rendered locally — the join URL never leaves the machine, and the
 * launcher works on a lecture-hall network with no internet.
 */
export function QrCanvas({ value, size = 240 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, value, {
      width: size,
      // The spec's quiet zone is four modules. Anything less and phone cameras
      // start failing to find the symbol at all — which reads as "the QR code
      // doesn't work" even though the address behind it is perfectly good.
      margin: 4,
      // Pure white, not the page's off-white: scanners key off contrast, and
      // the extra few percent is free.
      color: { dark: '#000000', light: '#FFFFFF' },
      // A lecture hall scans from an angle, at distance, off a projector.
      errorCorrectionLevel: 'M',
    })
      .then(() => !cancelled && setFailed(false))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="border-2 border-(--lr-dark) rounded-[3px]"
      />
      {/* Readable on purpose: a phone that will not scan can be handed this to
          type, and it is the first thing to check when nobody can connect. */}
      <span className="lr-text text-[12px] break-all text-center max-w-[260px]">
        {failed ? 'QR unavailable — type the URL' : value}
      </span>
    </div>
  );
}
