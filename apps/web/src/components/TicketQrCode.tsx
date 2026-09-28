"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The ticket-as-QR (§4.5 of docs/plan-review.md) — a saved/screenshotted
 * copy of this exact page's own URL, so a customer who loses the link (SMS
 * lost, phone borrowed) can still get back to their ticket (G-45). Not a
 * new backend concept — it's just this page's URL rendered as an image.
 */
export function TicketQrCode({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 180 })
      .then((generated) => {
        if (!cancelled) setDataUrl(generated);
      })
      .catch(() => {
        // Non-critical — the page still works via the link itself.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!dataUrl) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not an optimizable remote image
    <img
      src={dataUrl}
      alt="QR code for this ticket — scan to save or share this page"
      width={180}
      height={180}
      className="rounded-md"
    />
  );
}
