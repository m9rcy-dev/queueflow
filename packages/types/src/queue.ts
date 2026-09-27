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
