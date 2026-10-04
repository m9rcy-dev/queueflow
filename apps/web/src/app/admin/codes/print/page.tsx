"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TicketQrCode } from "../../../../components/TicketQrCode";

/**
 * A printable poster for one code (Phase 17) — opened in a new tab from
 * the QR Codes page. Everything it shows comes from the link itself (the
 * poster codes are public anyway), so it needs no session. The browser's
 * own print dialog does the rest; the button and hint are hidden on paper.
 */
function Poster() {
  const params = useSearchParams();
  const url = params.get("url") ?? "";
  const title = params.get("title") ?? "";
  const subtitle = params.get("subtitle") ?? "";
  const caption = params.get("caption") ?? "";

  if (!url) {
    return <p className="p-8 text-center text-text-secondary">Nothing to print.</p>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 bg-white p-10 text-center text-black">
      <h1 className="text-4xl font-bold">{title}</h1>
      {subtitle && <p className="text-xl">{subtitle}</p>}
      <TicketQrCode url={url} size={320} alt={caption || "QR code"} />
      {caption && <p className="text-2xl font-semibold">{caption}</p>}
      <p className="break-all font-mono text-xs text-gray-500">{url}</p>
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-4 rounded-md bg-primary px-6 py-3 font-medium text-white print:hidden"
      >
        Print
      </button>
    </main>
  );
}

export default function PrintPosterPage() {
  return (
    <Suspense>
      <Poster />
    </Suspense>
  );
}
