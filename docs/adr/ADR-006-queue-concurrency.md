# ADR-006: Queue Concurrency Strategy

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md G-10, G-20

## Context

Two staff members hitting "Call Next" at the same moment must never receive the same queue entry.
Ticket-number allocation has the same class of race (two simultaneous joins must not get the same
number).

## Decision

- **`SELECT ... FOR UPDATE SKIP LOCKED`** on the next-eligible-entry query inside the Call Next
  transaction, via Prisma `$queryRaw` (no first-class expression for this in Prisma).
- **A `version` column** on `queue_entry` for optimistic locking on the state transition itself.
- **Ticket numbers:** plain sequential integer per queue, reset at location-local midnight, allocated
  via an atomic counter update inside the join transaction; unique per
  `(queue_id, service_date, ticket_number)`.
- **Guest-card claiming (Phase 10, D-14): plain `SELECT ... FOR UPDATE`, not `SKIP LOCKED`.** Two
  near-simultaneous scans of the _same physical card_ should genuinely serialize — the second scanner
  should see the first scan's result (the existing entry, returned idempotently, G-54), not skip past
  it to create a second ticket for the same card. This is the opposite goal from Call Next's
  `SKIP LOCKED` (which deliberately wants the _other_ transaction to move on to a different row) —
  here there is no "different row" to move on to, so blocking briefly for the lock is the correct
  behavior. See `QueueEntriesService.joinByScan`.

## Alternatives

- Advisory locks — viable, but `FOR UPDATE SKIP LOCKED` is the more idiomatic fit for "pick one
  eligible row, skip ones already claimed."
- Pure optimistic locking (retry on conflict) for Call Next — rejected as the primary mechanism;
  under real concurrent load it wastes work compared to skip-locked row selection, though the
  `version` column still guards the transition itself.

## Consequences

- Concurrent integration tests are required for Call Next before it's considered done (AGENTS.md §5).
- Position and estimated-wait are always recomputed on read, never trusted as a stored value
  (G-11–G-13) — the same principle that motivates skip-locked selection over a stored "next in line"
  pointer.
