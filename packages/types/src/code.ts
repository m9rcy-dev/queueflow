/**
 * The minimal slice of the unified code model (§4.5/ADR-005) built in
 * Phase 4 — QUEUE context only. CUSTOMER_IDENTITY/GUEST_CARD/
 * APPOINTMENT_TICKET are Phases 9/10/C's job; do not add them here early.
 */
export type CodeContextType = "QUEUE";

export interface CodeSummary {
  publicCode: string;
  contextType: CodeContextType;
  queueId: string;
}

/** What a customer's phone sees immediately after scanning/opening a code — deliberately minimal (plan §9's landing page). */
export interface CodeResolution {
  contextType: CodeContextType;
  tenant: { name: string };
  location: { name: string };
  queue: { id: string; name: string; status: "ACTIVE" | "PAUSED" | "CLOSED" };
  capabilities: ["JOIN_QUEUE"];
  /** Only services this queue actually accepts right now (active + queueEnabled) — never the full catalog. */
  services: Array<{ id: string; name: string; durationMinutes: number }>;
}
