# QueueFlow — Implementation Roadmap

**Status:** Authoritative. Supersedes `docs/QueueFlow_Detailed_Plan.md` §88's phase numbering for
planning and session tracking purposes — that document stays the frozen product/architecture
baseline (per `AGENTS.md` §1), but its 15-phase list (0–14) predates the MVP cut (D-02) and the
customer-identity work (§4.5/G-57) worked out in `docs/plan-review.md`. This file is the one to
follow for "what phase are we on" and "what's next."

Each phase below is sized to be buildable in roughly one session and end green on `pnpm quality`
(AGENTS.md §7–8) — a complete vertical slice, not a partial layer.

---

## MVP phases (in scope, D-02)

### Phase 0 — Repository & Architecture Skeleton

**Status: ✅ Done** (2026-09-27)

pnpm workspace, NestJS + Prisma API skeleton, Next.js web skeleton, docker-compose, CI, ADRs,
`AGENTS.md`/`PROJECT_STATUS.md`. `pnpm quality` passes; both dev servers boot for real. See
`PROJECT_STATUS.md` Completed section for detail.

### Phase 1 — Tenant & Core Auth

**Status: ✅ Done** (2026-09-27)

Business signup (G-01: name/owner/email → OTP → capability selection → wizard stub), staff invite
(G-02), global `JwtAuthGuard` + `@Public()`, tenant context on the access token + tenant-selector for
multi-membership users (G-03), tenant isolation enforced in the query itself (ADR-003). Prisma:
`Tenant`, `TenantUser`, `LoginCode`, `RefreshToken` (scoped by tenantId too, not just userId).

**Acceptance:** a business can sign up and log back in via OTP; a user can only access their own
tenant's data; unauthorized cross-tenant access is rejected with an explicit integration test.
Verified: 29 unit tests + 7 Testcontainers integration tests (cross-tenant isolation, staff invite
flow, refresh rotation), plus manual end-to-end verification against the real dev server. See
`PROJECT_STATUS.md` Completed section for detail.

### Phase 2 — Locations & Services

**Status: ✅ Done** (2026-09-27)

Location (IANA timezone, validated against the runtime's actual tz database), BusinessHours (one
row per open period — split periods supported, plan §39), Service (per-service `queueEnabled`/
`appointmentEnabled`, distinct from the Tenant-level toggles). **Deliberate scope decision made**:
no separate `Staff` entity — the queue engine (Phase 3) already resolved to plain FIFO with no
per-staff service-capability filtering (G-11), so `TenantUser` is sufficient to represent "who's
staff here." Revisit only if a later phase genuinely needs staff-location-service capability
assignment. The `queue_service` join (D-04) is Phase 3's, not this phase's — a queue doesn't exist
yet to join against.

**Acceptance:** admin can create/edit a location and services; services can be enabled/disabled; a
location has a timezone that later date/time logic will consult. Verified: 13 unit tests + 5
Testcontainers integration tests (cross-tenant isolation on both locations and services, the
location→service ownership cross-check, split-hours round-trip, STAFF role-blocked from creating a
location), plus manual end-to-end verification against the real dev server first. See
`PROJECT_STATUS.md` Completed section for detail.

### Phase 3 — Queue Domain

Queue, `queue_entry`, the full state machine (G-15), FIFO position/estimated-wait formulas
(G-11/G-12, computed on read per G-13), ticket-number allocation (G-10/ADR-006), `FOR UPDATE SKIP
LOCKED` concurrency for Call Next (ADR-006), idempotency keys (G-21), end-of-day/staff-controlled
closing (G-16), max-active-tickets enforcement (G-34).

**Acceptance:** customer can join (via a seeded test path — no UI yet), duplicate active entries are
controlled, position is correct, concurrent Call Next cannot select the same entry, invalid
transitions fail, closing the queue blocks new joins.

### Phase 4 — Customer Queue UI

The anonymous walk-in path: scan a `QUEUE`-context poster with your own phone → name + mobile → join
→ ticket page (showing the QR-as-ticket per §4.5, for recovery) → live position via SSE → leave queue.
Rate limiting + Turnstile on the join POST (G-40).

**Acceptance:** the plan's own first vertical-slice customer half works end to end on a real phone.

### Phase 5 — Staff Queue UI

Staff device: queue view, Call Next, Start, Complete, Skip/Requeue, No Show, Recall, Cancel, manually
add a walk-in. **Trusted device + per-staff PIN lands here** (D-03a) — this is the first phase where a
real shared counter device exists, so it's the natural point to build shift-change switching rather
than front-loading it into Phase 1.

**Acceptance:** staff can operate the complete queue lifecycle from one device; every action attributes
to the acting staff member; concurrency tests pass.

### Phase 6 — Public Display

The TV screen: ticket number only, **no names, no PII** (C-01), fullscreen, auto-reconnect, runs as a
browser tab on whatever screen the business has (ADR-009).

**Acceptance:** display runs independently, updates live, survives a network blip, exposes nothing
identifying.

### Phase 7 — Notification Infrastructure

Outbox pattern (notification never blocks a queue operation), threshold evaluation in the same
transaction as the mutation (G-31), `MockNotificationProvider`. **This completes the plan's original
first vertical slice (§98/C-03)** — scan → join → position updates → staff calls → customer notified
(mock) → complete.

**Acceptance:** called customer receives exactly one (mocked) notification; duplicate processing
doesn't duplicate it; queue operations don't depend on the provider being up.

### Phase 8 — Real Notifications (Pingram)

Wire the real provider behind `NotificationProvider` (ADR-008) — **email first** (free, default
channel), SMS as a later adapter once real per-tenant cost caps exist (G-29). Verify actual NZ SMS
pricing on Pingram before enabling SMS for real. Consent text + versioning (G-48).

**Acceptance:** a real email is delivered through the configured provider; provider failure doesn't
break queue operations; secrets aren't logged.

### Phase 9 — Customer Accounts & Portal _(§4.5 Phase A)_

Tenant-scoped customer accounts (D-09), `CUSTOMER_IDENTITY` code issuance + regeneration (staff- or
customer-initiated, G-52), login via email OTP, portal (live position + personal code, G-55).
Staff-initiated in-person signup (loyalty-card framing, G-56) plus the self-service "sign up here"
poster (reuses `LOCATION`/`GENERAL` capability, no new hardware).

**Acceptance:** a customer can be signed up in person or self-serve, log in, see their personal code
and current queue status. No kiosk hardware required yet.

### Phase 10 — Kiosk Hardware & Guest Cards _(§4.5 Phase B)_

The physical counter scanner (D-10), numbered guest-card pool (D-14: `guest_1`…`guest_N`, zero data,
idempotent scan, auto-release on terminal state), self-serve instant join for both guest cards and
`CUSTOMER_IDENTITY` codes (D-11), staff-assisted cancel for guest-card users (no self-service path
exists for them by design).

**Acceptance:** a physical guest card and a customer's personal code both self-serve-join correctly at
the counter scanner; re-scanning an active card/code never duplicates.

### Phase 11 — Business Administration

QR/code management screens, service/staff/location management UI, business hours, notification
settings, the live "today" dashboard (queue length, average wait, served count — G-14's formulas;
**not** the deferred historical-trend analytics). PWA manifest + service worker (ADR-010) — including
Web Push as an SMS-cost offset for installed, signed-up customers.

**Acceptance:** a business can configure the complete MVP without database access; the app installs
as a PWA on a tablet or desktop.

### Phase 12 — Hardening

Concrete rate-limit numbers in place everywhere (G-38), token entropy audit (G-39), secrets/log
redaction (G-41), backup/restore actually tested against real data, accessibility pass (WCAG AA per
plan §55), retention/deletion job running (90-day PII purge, G-37), dependency scanning.

**Acceptance:** security tests pass; a restore has actually been performed once; production readiness
checklist complete for a real pilot business.

---

## Explicitly deferred — not scheduled, revisit only on real demand

These are real, not forgotten — each has partial spec already captured so a future phase doesn't
start from nothing:

- **Appointment Engine + Appointment-Ticket Check-In** _(§4.5 Phase C, replaces the original plan's
  Phase 9/10)_ — needs G-22 (slot generation), G-23 (optional-staff concurrency), G-24
  (`staff_availability` semantics), and G-26's remaining items (reschedule, waitlist, holiday
  interaction) resolved first. Partial spec already captured: business calendar with day-count
  drill-down, cancel-with-reason, default max-appointments-per-day cap, per-tenant advance-booking
  window (§5.5 addendum in `plan-review.md`).
- **Historical analytics/trend reporting** (original plan Phase 11, beyond the live-today numbers
  already in Phase 11 above).
- **`PLATFORM_ADMIN` console** (G-51) — no home until there's a real second tenant needing platform-
  level oversight.
- **Billing/subscriptions** (original plan Phase 14) — after core product validation, per the plan's
  own stated principle.

---

## Count, for reference

**13 phases in the active roadmap (0–12).** Phase 0 done, 12 remain. Plus 4 explicitly deferred
workstreams (appointments, analytics trends, platform admin, billing) tracked but not scheduled.
