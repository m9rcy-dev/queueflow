"use client";

import { useEffect } from "react";

/** Registers public/sw.js once, client-side only (Phase 11, ADR-010) — a no-op in any browser without service worker support, and in dev it just re-registers the same no-op-until-offline worker on every reload. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability/offline-shell is a nice-to-have, never a hard requirement — silently skip if registration fails.
      });
    }
  }, []);
  return null;
}
