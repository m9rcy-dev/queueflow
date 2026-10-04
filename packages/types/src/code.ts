/**
 * The minimal slice of the unified code model (§4.5/ADR-005) built across
 * Phases 4, 6, 9, and 10 — QUEUE (customer join), DISPLAY (the TV board,
 * G-07), GENERAL (the tenant-only "sign up here" poster, D-10),
 * CUSTOMER_IDENTITY (a customer's own persistent "loyalty card" code,
 * G-52), and GUEST_CARD (a location's numbered, anonymous card pool,
 * D-14), and APPOINTMENT_TICKET (one per booking, scanned to check in; Phase 14).
 */
export type CodeContextType =
  "QUEUE" | "DISPLAY" | "GENERAL" | "CUSTOMER_IDENTITY" | "GUEST_CARD" | "APPOINTMENT_TICKET";

export interface CodeSummary {
  /** Phase 11 — needed so a staff-facing listing can target a specific code for deactivation (deactivateCode/deactivateGeneralCode take this, not publicCode). */
  id: string;
  publicCode: string;
  contextType: CodeContextType;
  /** Listing endpoints (listForQueue/listGeneral) return every code ever minted, not just currently-usable ones — a staff UI needs this to tell them apart (Phase 11). */
  active: boolean;
  /** Only set for QUEUE codes. */
  queueId: string | null;
  /** Only set for CUSTOMER_IDENTITY codes. */
  customerId: string | null;
}

/**
 * A location's guest-card pool (Phase 10, D-14) — its own richer shape
 * rather than reusing CodeSummary, since staff need to see the printed
 * number and current occupancy, not just the raw code. Returned by
 * GET/PUT `/tenants/me/locations/:locationId/guest-cards`.
 */
export interface GuestCardSummary {
  id: string;
  publicCode: string;
  /** The printed "guest_N" label — what's written on the physical card, distinct from publicCode (what's actually scanned). */
  guestNumber: number;
  /** True while a QueueEntry currently holds this card — cleared automatically when that entry reaches a terminal state. */
  inUse: boolean;
}

/** What a customer's phone sees immediately after scanning/opening a QUEUE code — deliberately minimal (plan §9's landing page). */
export interface QueueCodeResolution {
  contextType: "QUEUE";
  tenant: { name: string };
  location: { id: string; name: string };
  queue: { id: string; name: string; status: "ACTIVE" | "PAUSED" | "CLOSED" };
  /** BOOK_APPOINTMENT appears only when the tenant has appointments on and this location has at least one bookable service (Phase 13). */
  capabilities: Array<"JOIN_QUEUE" | "BOOK_APPOINTMENT">;
  /** Only services this queue actually accepts right now (active + queueEnabled) — never the full catalog. */
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  /** Active, appointment-enabled services at this queue's location — empty unless BOOK_APPOINTMENT is offered. */
  appointmentServices: Array<{ id: string; name: string; durationMinutes: number }>;
}

/** What a customer sees after scanning a GENERAL "sign up here" poster (Phase 9, D-10) — just enough to reach the signup/login form. */
export interface GeneralCodeResolution {
  contextType: "GENERAL";
  tenant: { id: string; name: string };
  capabilities: ["CREATE_ACCOUNT"];
}

/**
 * DISPLAY, CUSTOMER_IDENTITY, and GUEST_CARD are deliberately not resolved
 * through this endpoint at all (see CodesService.resolve's own comment) —
 * DISPLAY needs a live feed, not a one-shot lookup (its own SSE endpoint
 * instead), and CUSTOMER_IDENTITY/GUEST_CARD are only ever consumed via
 * the staff-authenticated scan endpoint (Phase 10), never this public
 * one. Presenting any of them here gets the same uniform 404 as an
 * unrecognized code.
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
