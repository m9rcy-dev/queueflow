# ADR-013: Appointment Check-In, Walk-In Priority, No-Shows and Reminders

**Status:** Accepted
**Date:** 2026-10-04
**Related:** plan-review.md G-25, D-12; ADR-005, ADR-006, ADR-012; plan §36, §37, §75, §77, §78

## Context

Phase 13 (ADR-012) lets customers book. Phase 14 handles the day itself: turning a booking into a
place in the queue, keeping booked customers from waiting behind walk-ins who arrived after them
(G-25's product contradiction), and dealing with people who don't turn up. The open questions were
put to the user on 2026-10-04 and answered as below.

## Decision

**Check-in creates a queue entry (§36).** A `BOOKED` appointment becomes `CHECKED_IN`, and a
`WAITING` queue entry is created with `queue_entry.appointmentId` set. From then on the visit's
progress (called, serving, completed) lives on the queue entry and is not duplicated on the
appointment. There is one implementation (`QueueEntriesService.checkInAppointment`) behind three
routes (§78):

- the counter scanner reading the booking's `APPOINTMENT_TICKET` code,
- the customer tapping "I'm here" on their appointment page (the secret appointment token is the
  credential),
- staff from the day list.

Check-in is allowed only on the appointment's own local date, at any time that day. It is
idempotent: the appointment row is locked for the transaction, so simultaneous attempts produce one
entry. The per-customer active-ticket caps (G-34) don't apply, since the customer already holds a
booking for this visit. The queue used is the location's active queue that offers the service, or
the location's only active queue.

**The check-in code (D-12, ADR-005).** Each appointment gets an `APPOINTMENT_TICKET` row in the
unified `Code` table, minted in the booking transaction. It's a secret token (G-39), consumed only
by the staff scan endpoint; the public code resolver treats it as unrecognized. Appointments booked
before Phase 14 got codes from a backfill migration.

**Walk-in priority (G-25).** A per-tenant `appointmentPriorityWindowMinutes` (default 10). At
check-in the entry stores `priorityFrom = startsAt − window`. Queue order is:

1. entries whose `priorityFrom <= now`, earliest `priorityFrom` first (earliest appointment first);
2. everyone else by `joinedAt`, including a booking checked in before its window, which waits in
   normal order until the window opens (no-one is turned away for being early);
3. `id` for exact ties.

The rule lives in one place, `queue-entries/queue-order.ts`, as a JS comparator used by positions,
the staff list, notification thresholds and the TV board, and as the matching `ORDER BY` inside Call
Next's `FOR UPDATE SKIP LOCKED` select (ADR-006, unchanged otherwise). Because the order depends on
the current time, an entry can move up without any write. That is consistent with positions always
being computed on read (G-13). Threshold notifications catch up on the next queue mutation.

The inert `queue_entry.priority` integer (G-35) stays unused. A time-dependent rule can't be a stored
number.

**No-shows (§77).** A per-tenant `appointmentNoShowGraceMinutes` (default 10). A job marks `BOOKED`
appointments `NO_SHOW` once `startsAt + grace` has passed, setting `noShowAt`. Staff can restore a
no-show to `BOOKED` on the same local day; `noShowAt` is kept as the record and is also what stops the
job re-marking it.

**Reminders (§75).** A per-tenant list `appointmentReminderOffsetsMinutes` (default 24h and 2h,
at most 3). Each reminder is an outbox row of type `APPOINTMENT_REMINDER` with
`reminderOffsetMinutes`, and a unique index on `(appointmentId, type, reminderOffsetMinutes)` makes a
repeat insert a no-op. So reminders are idempotent across overlapping job runs or instances.
Postgres treats NULLs as distinct, so non-reminder rows are unaffected. Two further rules: an offset
whose moment had passed when the booking was made is skipped, and only the nearest due offset is
sent, so a job that was down doesn't send a burst of stale reminders.

**Scheduling.** Both jobs run once a minute on `@nestjs/schedule`, the same infrastructure as the
retention purge. `DISABLE_SCHEDULED_JOBS=true` turns the cron off for tests that drive the jobs
directly.

## Consequences

- The ordering rule is now duplicated in two languages (TS comparator and SQL). They're next to each
  other in one file, and integration tests assert that Call Next, the list and positions agree.
- Computing one entry's position now loads the queue's WAITING entries instead of a "joined before
  me" query. That's cheap at realistic queue sizes; revisit if queues get into the thousands.
- Anyone holding an appointment link can check in without being physically present. The plan
  allows link check-in (§78); a presence check would be a later, explicit change.
- The no-show job runs per minute across all tenants with one SQL update. That's fine for the
  single-instance deployment (D-06), and safe even if a second instance ever runs it.
