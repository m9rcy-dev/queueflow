"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The ticket-as-QR (§4.5 of docs/plan-review.md) — a saved/screenshotted
 * copy of this exact page's own URL, so a customer who loses the link (SMS
 * lost, phone borrowed) can still get back to their ticket (G-45). Not a
 * new backend concept — it's just this page's URL rendered as an image.
 */
/** `size` in CSS pixels (Phase 17: print sheets want it bigger); `alt` describes what the code is for. */
export function TicketQrCode({
  url,
  size = 180,
  alt = "QR code for this ticket — scan to save or share this page",
}: {
  url: string;
  size?: number;
  alt?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Rendered at 2x so it stays sharp when printed.
    QRCode.toDataURL(url, { margin: 1, width: size * 2 })
      .then((generated) => {
        if (!cancelled) setDataUrl(generated);
      })
      .catch(() => {
        // Non-critical — the page still works via the link itself.
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (!dataUrl) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not an optimizable remote image
    <img src={dataUrl} alt={alt} width={size} height={size} className="rounded-md" />
  );
}
