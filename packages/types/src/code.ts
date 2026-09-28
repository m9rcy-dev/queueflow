/**
 * The minimal slice of the unified code model (§4.5/ADR-005) built across
 * Phases 4 and 6 — QUEUE (customer join) and DISPLAY (the TV board, G-07)
 * only. CUSTOMER_IDENTITY/GUEST_CARD/APPOINTMENT_TICKET are Phases 9/10/C's
 * job; do not add them here early.
 */
export type CodeContextType = "QUEUE" | "DISPLAY";

export interface CodeSummary {
  publicCode: string;
  contextType: CodeContextType;
  queueId: string;
}

/**
 * What a customer's phone sees immediately after scanning/opening a QUEUE
 * code — deliberately minimal (plan §9's landing page). QUEUE-only: a
 * DISPLAY code is never meant to be resolved through this join-flow
 * endpoint, and is rejected the same uniform way as an unrecognized code
 * (see CodesService.resolve).
 */
export interface CodeResolution {
  contextType: "QUEUE";
  tenant: { name: string };
  location: { name: string };
  queue: { id: string; name: string; status: "ACTIVE" | "PAUSED" | "CLOSED" };
  capabilities: ["JOIN_QUEUE"];
  /** Only services this queue actually accepts right now (active + queueEnabled) — never the full catalog. */
  services: Array<{ id: string; name: string; durationMinutes: number }>;
}

/**
 * The public TV/board's live state (Phase 6, G-07) — ticket numbers and
 * service names only, **never** customer name/phone or the assigned staff
 * member's name (C-01's hard requirement). Pushed in full on every change
 * over the display's own SSE stream (`/public/displays/:code/events`),
 * same "always refetch full state, never trust a missed event" principle
 * as the customer ticket page (G-27).
 */
export interface DisplaySnapshot {
  tenant: { name: string };
  location: { name: string };
  queue: { name: string; status: "ACTIVE" | "PAUSED" | "CLOSED" };
  /** One entry per currently CALLED/SERVING ticket — more than one when servingCapacity > 1 (multiple chairs/counters). */
  nowServing: Array<{ ticketNumber: number; serviceName: string }>;
  /** The next few WAITING ticket numbers, in call order — numbers only, never names. */
  next: number[];
}
