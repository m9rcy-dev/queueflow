export type QueueStatus = "ACTIVE" | "PAUSED" | "CLOSED";

export type QueueEntryStatus =
  "WAITING" | "CALLED" | "SERVING" | "COMPLETED" | "CANCELLED" | "SKIPPED" | "NO_SHOW";

export interface QueueSummary {
  id: string;
  locationId: string;
  name: string;
  status: QueueStatus;
  servingCapacity: number;
  maxActiveTicketsPerCustomer: number;
  maxRecallCount: number;
  recallGracePeriodMinutes: number;
  /** People-ahead thresholds for the APPROACHING/NEARLY_NEXT notifications (G-31, Phase 7). */
  approachingThreshold: number;
  nearlyNextThreshold: number;
}

/** Staff-facing view — never carries the customer's public ticket token. */
export interface QueueEntrySummary {
  id: string;
  queueId: string;
  serviceId: string;
  ticketNumber: number;
  status: QueueEntryStatus;
  /** 1-indexed; null once the entry leaves WAITING (position stops meaning anything). */
  position: number | null;
  estimatedWaitMinutes: number | null;
  recallCount: number;
  joinedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** Returned once at join time, and from the public token-lookup route — the customer's only way back to their ticket (G-45). */
export interface JoinQueueResponse extends QueueEntrySummary {
  publicToken: string;
}

/**
 * The staff dashboard's view (Phase 5) — adds what a customer's own ticket
 * page has no reason to see: who they are, and which staff member is
 * currently attributed to this entry (G-18/D-03a's audit requirement).
 */
export interface StaffQueueEntrySummary extends QueueEntrySummary {
  customerName: string;
  customerPhone: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  /** Set only for a Phase 10 guest-card entry (customerName falls back to "Guest {N}" in that case too) — lets staff call out a number instead of a name. */
  guestCardNumber: number | null;
  /** Set when this entry came from an appointment check-in (Phase 14). */
  appointmentStartsAt: string | null;
  /** True once a checked-in appointment's priority window has opened (G-25) — it sorts ahead of walk-ins. */
  priorityActive: boolean;
}

/**
 * The live "today" dashboard (Phase 11, G-14) — scoped to the location's
 * local service-day (same boundary `QueueTicketCounter` already resets
 * on), not a rolling 24h window. Averages are null (not 0) when there's
 * no data yet today, so the UI can show "—" instead of a misleading zero.
 * Historical/trend analytics across multiple days is explicitly deferred
 * (ADR-010) — this is "how's today going," nothing more.
 */
export interface QueueTodayStats {
  queueId: string;
  queueName: string;
  /** Live right now, not "today"-scoped — how long the current line actually is. */
  waitingCount: number;
  servedCount: number;
  averageWaitMinutes: number | null;
  averageServiceDurationMinutes: number | null;
  /** Every CANCELLED entry today — staff- and customer-initiated are not distinguished today (see schema comment on QueueEntry.cancellationReason). */
  abandonedCount: number;
  noShowCount: number;
}
