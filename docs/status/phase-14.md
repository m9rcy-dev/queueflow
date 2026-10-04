# Phase 14 — Appointment Check-In & Mixed Queue

**Status:** Done (2026-10-04). Branch `feature/QF-014-appointment-check-in` (from Phase 13's branch).
**Decisions:** ADR-013; `plan-review.md` G-25 resolved. Asked and answered at the start of the
phase: a 10-minute priority window set per business, early arrivals checked in and waiting in normal
order, staff can undo a no-show the same day.

## What was built

**Schema** (`20261003120000_add_appointment_check_in`, plus `…120100_backfill_appointment_ticket_codes`):

- Appointment statuses `CHECKED_IN`/`NO_SHOW`, with `checkedInAt`/`noShowAt`.
- `queue_entry.appointmentId` (unique) and `priorityFrom`.
- The `APPOINTMENT_TICKET` code type with `code.appointmentId`.
- Tenant settings: priority window, no-show grace, reminder offsets.
- The outbox gains `reminderOffsetMinutes` and the unique index that makes reminders idempotent.
- The backfill is a separate migration because Postgres won't use a new enum value in the
  transaction that adds it.

**API:**

- `queue-entries/queue-order.ts`: the single queue-order rule (G-25), as a comparator plus Call
  Next's matching `ORDER BY`. It's now used by Call Next, positions, the staff list, notification
  thresholds and the TV board.
- `QueueEntriesService.checkInAppointment`: one implementation behind scanner, link and staff
  check-in. It locks the appointment row, is idempotent, works only on the booking's day, and picks
  the location's queue.
- New endpoints: `POST /public/appointments/:token/check-in`,
  `POST /tenants/me/appointments/:id/check-in`, `POST /tenants/me/appointments/:id/restore`. The
  scan endpoint now understands `APPOINTMENT_TICKET`.
- `AppointmentJobsService`: no-shows and reminders every minute; `DISABLE_SCHEDULED_JOBS` for tests.
- Every booking now mints its check-in code in the booking transaction. The public summary carries
  `checkInCode`, `canCheckIn` and `queueTicketToken`. Calendar counts and slot capacity include
  `CHECKED_IN`.

**Web:**

- Appointment page: "I'm here" button, a check-in QR, a link to the live ticket once checked in, and
  missed-appointment copy.
- Staff day list: "Check in" and "Undo no-show" for today's bookings, plus status badges.
- Queue dashboard: an "Appointment 6:47 PM · priority" badge.
- Scanner page: shows "Checked in" for bookings.
- Settings: priority window, no-show grace, and reminders in hours.

## Tests

- Unit: `queue-order.spec.ts` (6), `appointment-jobs.service.spec.ts` (5), plus fixture updates in
  the queue and display specs (they now carry `priorityFrom`, and one relied on mock array order
  instead of `joinedAt`). **259 unit total.**
- Integration: `appointment-check-in.integration-spec.ts` (10), covering:
  - link check-in, idempotent;
  - 4 simultaneous check-ins by scan, link and staff giving one entry;
  - the scanner, including the other-location 404;
  - wrong-day and cancelled refusals;
  - priority order across the list, positions and Call Next;
  - concurrent Call Next with priority entries;
  - no-show marking with a restore that sticks;
  - a reminder sent exactly once under concurrent job runs;
  - tenant isolation;
  - every booking minting a code.

  **104 integration total.** The suite picks a location timezone where it's currently mid-day, so
  "starts in 5 minutes" never crosses local midnight.

- Manual, with both dev servers on mock providers: link check-in landed on the live ticket at
  position 1 ahead of two earlier walk-ins; the dashboard showed the priority badge; a scanner
  check-in worked; the real once-a-minute job marked a past booking as a no-show; staff undo stuck
  past later job ticks and "Check in" was offered again.

## Found along the way

- **Backfilled check-in codes were unscannable.** The scan endpoint capped codes at 50 characters,
  but the backfill mints 64. API-minted codes are 27, so the tests (with short fixture codes) missed
  it; the manual browser check caught it. Fixed by raising the cap to 100, and the test fixtures now
  use the 64-character shape.

## Known limitations

- Anyone with an appointment link can check in without being physically present (§78 allows link
  check-in).
- The queue dashboard formats the appointment time with the device's own clock, which is correct for
  a counter tablet at the location.
- A checked-in appointment stays `CHECKED_IN` after its queue entry completes; progress lives on the
  entry, not duplicated.
- Threshold notifications ("nearly your turn") for walk-ins pushed back when a priority window
  opens only update on the next queue mutation, not on the minute.
