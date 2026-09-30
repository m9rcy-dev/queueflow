# ADR-005: Unified Code Model (QR/Identity/Guest-Card/Appointment-Ticket)

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md §4.5, D-09–D-16, G-36, G-52–G-58

## Context

The original plan's QR Context Platform (§4) treats a QR as a pointer to a **place** (queue, table,
service, location). Design discussion surfaced a second, necessary direction: a code that identifies
a **person or booking** instead (a customer's own account, a numbered anonymous guest card, a specific
appointment). These are not two systems — one resolver, wider set of types.

## Decision

One `code` concept: `code → resolve → {type, owner, payload}`. Types:

```text
GENERAL, LOCATION, QUEUE, SERVICE, TABLE, APPOINTMENT, KIOSK, COUNTER   ← place/business-owned, printed
CUSTOMER_IDENTITY                                                      ← customer-owned, persistent
GUEST_CARD                                                             ← location-owned, numbered pool, anonymous, recycled
APPOINTMENT_TICKET                                                     ← appointment-owned, one per booking (Phase C)
PRODUCT, PAYMENT                                                       ← future, unchanged
```

The scanning app branches on `type`; the resolver itself doesn't care who's holding the scanner.
A ticket shown as a QR (for recovery) and a dedicated "sign up here" poster are **not** new types —
they reuse the existing ticket-token resolution and the `LOCATION`/`GENERAL` capability set
respectively.

**Guest cards are individually numbered and tracked** (`guest_1`…`guest_N`), not identical/generic —
idempotent scan (re-scan of an active card re-shows status, never duplicates), auto-released when
the linked entry reaches a terminal state, zero personal data by design.

**Counter hardware, settled:** one physical scanner (reads guest cards or a customer's personal
code, instant join, zero staff confirmation) + a separate staff device (queue view, call next,
cancel, manually add) + one public TV (ticket number only, no PII). No separate unattended kiosk
terminal.

## Alternatives

- Two separate systems (context resolver + identity resolver) — considered and rejected during
  design discussion; unnecessarily duplicates the resolution mechanism for no benefit.
- A generalized `context`/`capability`/`context_capability` table set — explicitly rejected (plan §9,
  G-36) as the single biggest over-engineering risk in the plan. Two toggleable capabilities only:
  `Queue` and `Appointment`.

## Consequences

- Storage carries `owner_type`/`owner_id` alongside `context_type`/`context_id` on one table, rather
  than forking into a second resolver. Lifecycle rules (creation, rotation, expiry) differ per kind
  at the service layer — normal branching, not an architectural fork.
- `APPOINTMENT_TICKET` doesn't exist before the appointment engine does — rides with Phase C.
- **Built incrementally as concrete nullable FK columns, not the generalized `owner_type`/`owner_id`
  pair this ADR originally sketched** — `Code` gained `queueId` (Phase 4, `QUEUE`), then `customerId`
  (Phase 9, `CUSTOMER_IDENTITY`), then `locationId`/`guestNumber`/`currentEntryId` (Phase 10,
  `GUEST_CARD`), each nullable and populated only for its own context type, rather than a single
  polymorphic owner reference up front. `GENERAL` (Phase 9, the "sign up here" poster) needed neither
  — just `tenantId`, which every code already carries. `APPOINTMENT_TICKET` (Phase C) is the only
  type left unbuilt. Deliberate: the same "build the concrete case only" discipline as everywhere
  else in this codebase (see schema comments on `CodeContextType`) — four owner-kind-specific column
  groups on one table turned out perfectly manageable in practice; the generalized polymorphic column
  never became necessary, and revisiting that tradeoff isn't worth it unless a fifth kind's shape
  looks nothing like the first four.
- **`currentEntryId` (Phase 10) is the one column that isn't a pure "which owner" pointer** — it
  tracks _current occupancy_ of a recyclable card (null = free, set = held by that QueueEntry right
  now), a genuinely different kind of state than "which queue/customer/location owns this code
  forever." Modeled as a nullable-unique FK on `Code` rather than a separate join table, claimed and
  released under a `FOR UPDATE` row lock (claim, in `QueueEntriesService.joinByScan`) and a plain
  `updateMany` (release, in `.transition()`) respectively — see those two call sites for the
  concurrency reasoning.
