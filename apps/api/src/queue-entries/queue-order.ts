import { Prisma } from "@prisma/client";

/** The fields queue order depends on — every WAITING-entry list is sorted by these. */
export interface QueueOrderFields {
  id: string;
  joinedAt: Date;
  priorityFrom: Date | null;
}

/**
 * The one queue-order rule (G-25/ADR-013), shared by Call Next, positions,
 * the staff list, notification thresholds, and the TV board, so they can
 * never disagree about who is next:
 *
 * 1. Checked-in appointments whose priority window has opened
 *    (`priorityFrom <= now`) go first, earliest priorityFrom first — i.e.
 *    earliest appointment first.
 * 2. Everyone else in plain FIFO (`joinedAt`) — including an appointment
 *    checked in before its window, which waits like a walk-in until then.
 * 3. `id` breaks exact ties, as before.
 *
 * Depends on `now`, so an entry can move up without any mutation; that's
 * fine because position is always computed on read (G-13).
 * `callNextOrderSql` is the same rule in SQL and must stay in step.
 */
export function compareQueueOrder(a: QueueOrderFields, b: QueueOrderFields, now: Date): number {
  const aPriority = isPriorityActive(a, now);
  const bPriority = isPriorityActive(b, now);
  if (aPriority !== bPriority) return aPriority ? -1 : 1;
  if (aPriority && bPriority) {
    const diff = a.priorityFrom!.getTime() - b.priorityFrom!.getTime();
    if (diff !== 0) return diff;
  }
  const joinedDiff = a.joinedAt.getTime() - b.joinedAt.getTime();
  if (joinedDiff !== 0) return joinedDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isPriorityActive(entry: { priorityFrom: Date | null }, now: Date): boolean {
  return entry.priorityFrom !== null && entry.priorityFrom.getTime() <= now.getTime();
}

export function sortByQueueOrder<T extends QueueOrderFields>(entries: T[], now: Date): T[] {
  return [...entries].sort((a, b) => compareQueueOrder(a, b, now));
}

/** compareQueueOrder as an ORDER BY clause, for Call Next's row-locking select (ADR-006). */
export function callNextOrderSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE WHEN "priorityFrom" IS NOT NULL AND "priorityFrom" <= ${now} THEN 0 ELSE 1 END ASC,
    CASE WHEN "priorityFrom" IS NOT NULL AND "priorityFrom" <= ${now} THEN "priorityFrom" END ASC NULLS LAST,
    "joinedAt" ASC,
    id ASC
  `;
}
