# ADR-012: Appointment Engine — Pooled Capacity, Fixed Grid, Closures

**Status:** Accepted
**Date:** 2026-10-03
**Related:** plan-review.md G-22, G-23, G-24, G-25, G-26, D-02, D-12, D-16; plan §33–§36, §70, §76

## Context

Appointments were deferred out of the MVP (D-02) because plan §33–§35 left the hardest parts
undefined: how slots are generated (G-22), what "select staff (optional)" means for double-booking
(G-23), what `staff_availability` contains (G-24), and what happens with reschedules, waitlists and
closures (G-26). Phase 13 builds the engine, so those questions needed answers first. They were
decided with the user on 2026-10-03.

## Decision

**Capacity: location as a resource pool of size N (G-23).** `Location.appointmentCapacity`
(default 1) is how many appointments can overlap at one location. The customer never picks a staff
member. Per-staff selection would need staff↔service assignment and per-staff schedules, and nothing
needs that yet. `Location.maxAppointmentsPerDay` (nullable, null = no cap) is the per-day ceiling
already decided in G-26.

**Slots: fixed grid per tenant (G-22).** Tenant-level settings (plan §70 "Appointments"):

| Setting                          | Default | Meaning                                                                     |
| -------------------------------- | ------- | --------------------------------------------------------------------------- |
| `appointmentSlotIntervalMinutes` | 15      | Slot starts step by this from each open period's opening time               |
| `appointmentBufferMinutes`       | 0       | Turnaround after each booking; occupies capacity, need not fit before close |
| `appointmentMinLeadMinutes`      | 60      | No slot starting sooner than this from now                                  |
| `appointmentAdvanceDays`         | 30      | Furthest bookable local date is today + this                                |
| `appointmentCancelNoticeMinutes` | 120     | Customer self-cancel cut-off before start (§76); staff can cancel any time  |

A slot `[t, t + duration)` is offered when it fits inside one open period, doesn't overlap any
closure, starts after the lead time, and the **peak** overlap of existing bookings across
`[t, t + duration + buffer)` is below capacity. Peak overlap, not a plain count, so two back-to-back
bookings don't wrongly fill a capacity-2 pool. All of this is local wall-clock minutes in the
location's IANA timezone, converted to UTC instants at the boundary (DST-safe).

**Availability: business hours + date closures (G-24).** No `staff_availability` table, since the
pool model makes it moot. `LocationClosure` is either full-day or a partial-day minute range, and a
closure always wins over business hours. Breaks are partial-day closures.

**Double-booking prevention (§35).** The booking transaction locks the location row
(`SELECT … FOR UPDATE` via `$queryRaw`, same tool as ADR-006), then recomputes that date's
availability **inside** the lock and checks that the requested start is still offered. Concurrent
bookings at one location serialize. That's acceptable at one location's booking volume, and much
simpler than per-slot locking or exclusion constraints. Idempotency is a unique
`(tenantId, idempotencyKey)`, the same as queue joins (G-21).

**Rest of G-26.** Reschedule = cancel + rebook. No waitlist. A closure can be added over existing
bookings; the create response lists the overlapping `BOOKED` appointments so staff can cancel each
one with a reason (which notifies the customer). Nothing is auto-cancelled or blocked.

**Identity.** Public booking is anonymous, with name + phone, the same as a walk-in join. The
`Customer` row is upserted by phone, so a signed-up customer's bookings show up in their portal.
Each appointment gets a secret `publicToken` (G-39/G-45) as the customer's only handle for
viewing or cancelling it. Notifications (booked/cancelled) go through the existing outbox (ADR-008),
which now accepts either a queue entry or an appointment as its subject.

**Phase split.** Phase 13 is the engine: settings, closures, slots, booking, cancel, calendar, and
notifications. Phase 14 is check-in: `APPOINTMENT_TICKET` (D-12), `queue_entry.appointmentId`, the
G-25 priority rule, no-show grace (§77), and reminders (§75). The appointment status enum starts with
`BOOKED`/`CANCELLED` only; Phase 14 adds the check-in states.

## Consequences

- Bookings at a single location are serialized. If one location ever takes many bookings per second,
  revisit with per-slot locking. That is not a realistic load for this product.
- A business that genuinely needs "book with Sam" can't express it yet; that is a future, explicit
  change to G-23, not a silent extension.
- Changing a tenant's grid/buffer settings doesn't move existing bookings; new settings only affect
  which slots are offered from then on.
