/**
 * The minimal slice of the unified code model (§4.5/ADR-005) built across
 * Phases 4, 6, and 9 — QUEUE (customer join), DISPLAY (the TV board,
 * G-07), GENERAL (the tenant-only "sign up here" poster, D-10), and
 * CUSTOMER_IDENTITY (a customer's own persistent "loyalty card" code,
 * G-52). GUEST_CARD/APPOINTMENT_TICKET are Phases 10/C's job; do not add
 * them here early.
 */
export type CodeContextType = "QUEUE" | "DISPLAY" | "GENERAL" | "CUSTOMER_IDENTITY";

export interface CodeSummary {
  publicCode: string;
  contextType: CodeContextType;
  /** Only set for QUEUE codes. */
  queueId: string | null;
  /** Only set for CUSTOMER_IDENTITY codes. */
  customerId: string | null;
}

/** What a customer's phone sees immediately after scanning/opening a QUEUE code — deliberately minimal (plan §9's landing page). */
export interface QueueCodeResolution {
  contextType: "QUEUE";
  tenant: { name: string };
  location: { name: string };
  queue: { id: string; name: string; status: "ACTIVE" | "PAUSED" | "CLOSED" };
  capabilities: ["JOIN_QUEUE"];
  /** Only services this queue actually accepts right now (active + queueEnabled) — never the full catalog. */
  services: Array<{ id: string; name: string; durationMinutes: number }>;
}

/** What a customer sees after scanning a GENERAL "sign up here" poster (Phase 9, D-10) — just enough to reach the signup/login form. */
export interface GeneralCodeResolution {
  contextType: "GENERAL";
  tenant: { id: string; name: string };
  capabilities: ["CREATE_ACCOUNT"];
}

/**
 * DISPLAY and CUSTOMER_IDENTITY are deliberately not resolved through this
 * endpoint at all (see CodesService.resolve's own comment) — DISPLAY needs
 * a live feed, not a one-shot lookup (its own SSE endpoint instead), and
 * CUSTOMER_IDENTITY has no public consumer yet (Phase 10's scanner job).
 * Presenting either here gets the same uniform 404 as an unrecognized code.
 */
export type CodeResolution = QueueCodeResolution | GeneralCodeResolution;

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
