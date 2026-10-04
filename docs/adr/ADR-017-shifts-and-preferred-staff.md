# ADR-017: Staff on Shift and Preferred Staff

**Status:** Accepted
**Date:** 2026-10-05
**Supersedes:** G-11 (plain FIFO position) in part; amends ADR-006's Call Next query
**Related:** ADR-006 (queue concurrency), ADR-016 (who served)

## Context

In a barbershop, customers often want a particular barber. The user described it like this: the
customer is at the top of the queue but wants staff X, who is still with someone else, so the
customer behind can go to whoever is free. Staff names on the TV board are fine, since that is how
staff build their reputation (confirmed 2026-10-04).

G-11 assumed one line in plain arrival order, with every staff member able to serve anyone. That is
no longer true for customers who choose someone.

## Decision

**Shifts.** `staff_shifts` holds one row per period on the floor (`startedAt`, `endedAt`).

- Clock in and out from the queue dashboard.
- A Staff or Manager member clocks in at their own location. An owner or admin says which location.
- A partial unique index allows only one open shift per member, so a double tap can't create two.
- The rows are the time record that Phase 19's hourly pay will add up.

**Preferred staff.** `queue_entries.preferredStaffId` stores who the customer wants; null means
anyone.

- It can be set when joining (the QR join page lists who is on shift), or by staff at the counter
  while the customer is waiting.
- Only someone on shift at that location can be chosen.

**Call Next** adds `AND ("preferredStaffId" IS NULL OR "preferredStaffId" = <caller>)` to the
existing `FOR UPDATE SKIP LOCKED` query (ADR-006).

- The order rule (`callNextOrderSql`) is unchanged. A customer waiting for someone else is skipped
  but keeps their `joinedAt`, so they keep their place.
- Concurrency is unchanged: rows are still locked and skipped one at a time. An integration test has
  two staff calling at the same moment across a mixed line.

**Positions and waits count only the customer's own line** (`competesWith` in `queue-order.ts`):

- A customer waiting for anyone counts only the others waiting for anyone.
- A customer waiting for Ana counts those waiting for Ana plus those waiting for anyone.
- A customer waiting for one person has a wait estimate based on one server, not the queue's
  serving capacity.

The "nearly your turn" notifications use the same count.

**If a staff member clocks out (or is removed)**, their waiting customers go back to "anyone",
keeping their place, and get a `PREFERRED_STAFF_UNAVAILABLE` message. This was proposed to the user
as the default; nobody is left waiting for someone who has gone home.

**Names.** Each member can set a `publicName` (their own name or an alias) for each business; blank
means their display name. The TV board shows "#12 with Ana" (who is serving, else who called them)
and tags waiting tiles "for Ana". Customer names still never appear (C-01).

**Bookings are not included.** Appointments stay pooled per location (ADR-012). A staff preference
for bookings would need per-staff capacity in the slot engine, which is a much bigger change.

## Consequences

- Call Next can now say "No one is waiting for you right now" while others are waiting, because
  they are all waiting for someone else. The dashboard shows "N for you · M waiting".
- A popular staff member's customers can wait longer than the board's order suggests. Their tile
  says "for Ana", so the person in the queue can see why.
- Clocking in is not enforced for Call Next. An owner can still serve without clocking in, and
  only customers waiting for anyone are offered to them.
- A preference is not checked again when the chosen person is busy. The customer simply waits for
  them, which is what they asked for.
