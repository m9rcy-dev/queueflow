"use client";

/**
 * Tickets and bookings this browser has made (Phase 19), so a customer who
 * closes the tab or presses back can get back to their ticket (and its QR)
 * from the same poster. Only the secret page tokens are kept — the pages
 * themselves load the live status. Device-local; the emailed link covers a
 * different device.
 */
export interface SavedVisit {
  kind: "ticket" | "appointment";
  token: string;
  /** The queue (tickets) or location (bookings) it belongs to — what a poster page matches on. */
  scopeId: string;
  savedAt: number;
}

const KEY = "queueflow.savedVisits";
const MAX = 20;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // bookings can be weeks ahead

function read(): SavedVisit[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter(
      (v): v is SavedVisit =>
        typeof v === "object" &&
        v !== null &&
        (v.kind === "ticket" || v.kind === "appointment") &&
        typeof v.token === "string" &&
        typeof v.scopeId === "string" &&
        typeof v.savedAt === "number" &&
        v.savedAt > cutoff,
    );
  } catch {
    return [];
  }
}

export function saveVisit(visit: Omit<SavedVisit, "savedAt">): void {
  try {
    const rest = read().filter((v) => v.token !== visit.token);
    localStorage.setItem(
      KEY,
      JSON.stringify([{ ...visit, savedAt: Date.now() }, ...rest].slice(0, MAX)),
    );
  } catch {
    // Storage blocked (private mode) — the emailed link still works.
  }
}

export function forgetVisit(token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(read().filter((v) => v.token !== token)));
  } catch {
    // ignore
  }
}

export function savedVisits(kind: SavedVisit["kind"], scopeId: string): SavedVisit[] {
  return read().filter((v) => v.kind === kind && v.scopeId === scopeId);
}
