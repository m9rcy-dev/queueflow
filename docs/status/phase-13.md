# Phase 13 — Appointment Engine

**Status:** Done (2026-10-03). Branch `feature/QF-013-appointment-engine`.
**Decisions:** ADR-012; `plan-review.md` G-22, G-23, G-24, G-26 resolved at the start of the phase.

## What was built

**Decisions first.** The four open appointment questions were put to the user and answered before
any code was written: a location pool of N (no staff choice), a fixed slot grid per tenant, business
hours plus date closures, and the minimal G-26 (reschedule = cancel + rebook, no waitlist, closures
report overlapping bookings). The appointment work was split into Phase 13 (engine) and Phase 14
(check-in and mixed queue) in `docs/roadmap.md`.

**Schema** (`20261003…_add_appointment_engine`):

- `Appointment`: secret `publicToken`, `startsAt`/`endsAt`/`occupiedUntil` (the buffer is stored, so
  later setting changes never move an existing booking's footprint), `localDate`, `BOOKED|CANCELLED`,
  idempotency key, staff audit columns, and the cancellation reason enum + note.
- `LocationClosure`: full day, or a partial `[startMinutes, endMinutes)` range.
- Tenant slot settings and location `appointmentCapacity`/`maxAppointmentsPerDay`.
- `NotificationOutbox` now takes either a `queueEntryId` or an `appointmentId`.

**API** (`apps/api/src/appointments/`):

- `slot-engine.ts`: a pure function. Grid from each period's opening time, closures win, lead time,
  advance window, daily cap, and **peak** overlap against capacity (so back-to-back bookings don't
  falsely fill a capacity-2 pool). DST-safe through the new `localTimeToUtc` in `timezone.util.ts`.
- `AppointmentsService.book`: `SELECT … FOR UPDATE` on the location row, then the slots are
  recomputed inside the lock and the requested start must still be offered. A same-key twin is
  re-checked inside the lock as well (see "Found along the way"). The confirmation goes through the
  outbox in the same transaction.
- Public: availability, book, view, and self-cancel (blocked inside the tenant's notice window).
  Staff: settings, closures (the create response lists the overlapping bookings), month counts, the
  day list, phone booking, and cancel with a required reason. Portal: `GET /customers/me/appointments`.
- The QUEUE code resolver now returns `location.id`, the `BOOK_APPOINTMENT` capability, and
  `appointmentServices` when the tenant has appointments on.
- The retention purge now spares a customer who has a future `BOOKED` appointment.

**Web:** "Book an appointment instead" on `/q/[code]`, the booking flow at `/q/[code]/book`, and the
manage page `/appointment/[token]`. Admin: `/admin/appointments` (month grid with counts, day list,
cancel with reason, phone booking); the location page gains a per-service "Bookable" toggle,
pool/daily-cap fields, and closures; Settings gains the appointment rules. The portal lists upcoming
bookings.

## Tests

- Unit: `slot-engine.spec.ts` (19), timezone helpers (+7, including a DST transition day),
  `notification-copy.spec.ts` (4), and 2 updated specs. **248 unit total.**
- Integration: `appointments.integration-spec.ts` (16). 6 concurrent bookings for the last unit of
  capacity give exactly one 201 and five 409s; a capacity-2 pool fills with exactly 2; concurrent
  same-key replays return one booking; off-grid starts are rejected; the capability gate, the daily
  cap, the customer cancel window, closures and their affected-list, calendar/day/phone
  booking/cancel-with-reason, cross-tenant isolation on all 7 staff endpoints, the QUEUE code offering
  booking, and portal listing with email-channel resolution are all covered. Plus a retention case.
  **94 integration total.**
- Manual: both dev servers booted; booking, the manage page, the staff calendar, staff cancel, and
  the location page were driven in a real browser, and the outbox SMS text was checked in the API log.

## Found along the way

- **An idempotent replay could lose to its own twin.** Two concurrent requests with the same key
  serialized on the location lock; the second one then found the slot taken and returned
  `SLOT_UNAVAILABLE` instead of the original booking. Fixed by re-checking the key inside the lock.
- **The integration suite was already flaky**, not because of this phase. Every suite used
  `app.init()`, so supertest bound and released an ephemeral port per request; with 11 suites in
  parallel, a released port could go to another process before the next request (seen as
  `Parse Error: Expected HTTP/` and as a guest-cards test getting another suite's 404). It failed
  roughly 1 run in 3 once this phase's suite was added. Fixed for all suites with `app.listen(0)`
  (explained in `test/jest-integration.config.js`); 5/5 clean afterwards.
- UI: day chips overflowed the booking card (`<fieldset>` has a min-content minimum width; fixed with
  `min-w-0`), and the staff cancel form stayed stuck on "Cancelling…" after success (row state
  survived the list refresh; now reset).

## Known limitations

- The booking page's 14 day chips start from the **browser's** today, not the location's (the code
  resolution doesn't carry the timezone). The server is authoritative, so the only effect is a chip
  that shows "no times" near midnight for a far-away viewer.
- Public booking is per-IP throttled (20/hour, same as join) but has no per-phone limit or per-customer
  cap on future bookings.
- Changing a service's duration doesn't touch existing bookings (by design, the same as the buffer).
