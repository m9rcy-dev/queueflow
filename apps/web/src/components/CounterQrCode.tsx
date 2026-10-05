"use client";

import { useEffect, useState } from "react";
import { TicketQrCode } from "./TicketQrCode";

/**
 * A code the customer shows at the counter (Phase 19): their personal code
 * or a booking's check-in code. Drawn large, because scanners and cameras
 * read a phone screen far more easily when the code is big; tapping it
 * fills the screen with the code on plain white, like a boarding pass.
 */
export function CounterQrCode({ code, alt }: { code: string; alt: string }) {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setFullScreen(true)}
        className="flex flex-col items-center gap-1"
        aria-label={`${alt}: show full screen`}
      >
        <TicketQrCode url={code} size={280} alt={alt} />
        <span className="text-xs text-primary underline">Tap to show full screen</span>
      </button>

      {fullScreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6"
          onClick={() => setFullScreen(false)}
        >
          <TicketQrCode url={code} size={480} alt={alt} />
          <p className="max-w-xs text-center text-sm text-gray-600">
            Turn your screen brightness up and hold your phone steady, about a hand&apos;s width
            from the scanner. Tap anywhere to close.
          </p>
        </div>
      )}
    </>
  );
}
