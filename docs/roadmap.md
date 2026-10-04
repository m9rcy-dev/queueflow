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

**Status: ✅ Done** (2026-09-27)

Queue, `Customer` (added ahead of schedule — needed now so G-34's max-active-tickets cap can
actually identify a repeat customer by phone), `QueueService` (D-04's join), `QueueTicketCounter`
(atomic per-queue-per-day allocator, G-10/ADR-006), `QueueEntry` (the full state machine, G-15;
position/estimated-wait always computed on read, never stored, G-13). `Call Next` uses
`SELECT ... FOR UPDATE SKIP LOCKED` via `$queryRaw` (ADR-006). Idempotency keys (G-21).
End-of-day/staff-controlled closing cascade-cancels remaining `WAITING` entries (G-16).
Max-active-tickets enforced at both the per-queue and per-location level (G-34). Public,
unauthenticated join/lookup/cancel routes (`/public/queues/:id/entries`, `/public/queue-entries/:token`)
alongside the staff-authenticated lifecycle actions (call-next/start/complete/skip/requeue/cancel/
no-show/recall) — no customer-facing or staff-facing UI yet, by design (Phases 4-5 build those).

**Acceptance:** customer can join (via a seeded test path — no UI yet), duplicate active entries are
controlled, position is correct, concurrent Call Next cannot select the same entry, invalid
transitions fail, closing the queue blocks new joins. Verified: 74 unit + 19 Testcontainers
integration tests — including a genuine concurrency test (8 simultaneous joins, then 12 simultaneous
Call Next requests via `Promise.all` against real Postgres: exactly 8 succeeded, each claiming a
_distinct_ entry, the other 4 correctly found nothing left) — plus manual end-to-end verification
first, which caught a real bug (`assignedStaffId` was being set to `User.id` instead of the
`TenantUser.id` the foreign key actually requires) before any test was written. See
`PROJECT_STATUS.md` Completed section for detail.

### Phase 4 — Customer Queue UI

**Status: ✅ Done** (2026-09-28)

The anonymous walk-in path: scan a `QUEUE`-context poster with your own phone → name + mobile → join
→ ticket page (showing the QR-as-ticket per §4.5, for recovery) → live position via SSE → leave queue.
Minimal `Code` model scoped to the `QUEUE` context only (§4.5/ADR-005 — `publicCode → {tenant,
location, queue, services, capabilities}`), an admin endpoint to mint one per queue
(`POST /tenants/me/queues/:queueId/codes`), and the public resolver (`GET /public/codes/:code`).
Realtime via `GET /public/queue-entries/:token/events` (SSE), backed by an in-process `EventEmitter`
(single-instance per D-06 — Redis pub/sub is the documented future swap once horizontal scaling is
needed, see the flash-crowd future workstream above); the client always refetches full ticket state on
every event rather than trusting it caught them all (G-27). IP-based rate limiting on the join POST via
`@nestjs/throttler` (5/min) — **partial G-40**: this covers the abuse vector with what already exists
in the stack; Cloudflare Turnstile itself (an external service requiring its own account/site key) was
not integrated and remains a known gap, tracked below. First real content in `packages/api-client`
(anonymous public client: `resolveCode`/`joinQueue`/`getTicket`/`cancelTicket`/`ticketEventsUrl`) and
`packages/ui` (`Button`/`Card`/`Input`/`Badge`, using the design tokens already in
`apps/web/tailwind.config.ts`). Two Next.js pages: `/q/[code]` (landing + join form) and
`/queue/t/[token]` (live ticket page, `EventSource`-driven, leave-queue action).

**Acceptance:** the plan's own first vertical-slice customer half works end to end on a real phone —
verified via a real headless-Chromium Playwright run against the actual booted dev stack (not just
curl): landing page resolves and renders correctly styled, join form submits, redirect to the ticket
page occurs, a Call Next fired from a separate staff-side API call updates the already-rendered ticket
page live with no page reload (screenshotted before/after), and Leave Queue cancels and persists
(cross-checked against `psql`: `CANCELLED` status with `cancelledAt` set). 5 new unit tests (codes
service) + 84 total unit tests, 4 new integration tests (codes) + 1 new integration test (rate
limiting, verifies a real 429 after 5 requests) = 24 total integration tests. `pnpm quality` passes end
to end (build, format, lint, typecheck, unit, integration) in ~24s.

**Known gap carried forward:** Cloudflare Turnstile (G-40's specific bot-check mechanism) is not
integrated — only IP rate limiting ships. Also surfaced and fixed as an environment issue rather than a
regression: Testcontainers' Ryuk reaper sidecar hangs in this sandboxed Docker environment (each
container start then waiting out Jest's 120s hook timeout); `test:integration` now sets
`TESTCONTAINERS_RYUK_DISABLED=true` (documented in `test/jest-integration.config.js`) — every spec's
`afterAll` already calls `container.stop()` explicitly, so this only gives up Ryuk's extra safety net
against an unclean process kill, not normal cleanup.

### Phase 5 — Staff Queue UI

**Status: ✅ Done** (2026-09-28)

Staff device: queue view, Call Next, Start, Complete, Skip/Requeue, No Show, Recall, Cancel, manually
add a walk-in. **Trusted device + per-staff PIN** (D-03a): `TenantUser.pinHash` (argon2id) and a new
tenant-scoped `DeviceTrust` model (same opaque-token-hashed-server-side shape as `RefreshToken`,
rotating on every use) — a shared tablet trusts once (`POST /auth/devices/trust`), then any staff
member picks their name off the roster (`POST /auth/device-context`) and PIN-switches in
(`POST /auth/staff-pin-login`), with a 5-attempt/15-minute lockout. Every queue action now shows the
acting staff member's name (`StaffQueueEntrySummary`, staff-routes-only — verified the public/customer
routes still expose neither that nor the customer's own identity). First-ever web UI for Phase 1's OTP
login (`/admin/login`), a PIN setup page, and the queue dashboard itself (3s-polled, not SSE — see
Known Issues).

**Acceptance:** staff can operate the complete queue lifecycle from one device; every action attributes
to the acting staff member; concurrency tests pass. Verified via a real headless-Chromium run: OTP
login → dashboard → add walk-in → Call Next (live attribution shown) → Start → Complete → set PIN →
trust device → log out → PIN-switch back in. 102 unit + 31 integration tests, `pnpm quality` green.

### Phase 6 — Public Display

**Status: ✅ Done** (2026-09-28)

The TV screen: ticket number only, **no names, no PII** (C-01), fullscreen, auto-reconnect, runs as a
browser tab on whatever screen the business has (ADR-009). `DISPLAY` added to `CodeContextType`
(G-07's resolution: no auth, just a rotatable code — deactivate + mint fresh one to rotate), a new
`GET /public/displays/:code/events` SSE endpoint (`DisplaysModule`) publishing a `DisplaySnapshot` —
now-serving ticket numbers + service names and next-up numbers only, structurally incapable of
carrying customer/staff identity since the underlying queries never select those fields.
`apps/web/src/app/display/[code]`: fullscreen dark board, `EventSource` auto-reconnect plus a 70s
watchdog for a silently-stalled connection. Found and fixed a real bug along the way:
`QueuesService.updateStatus()` never emitted a queue-changed event, so pause/close was invisible to
every SSE watcher (ticket page and display alike) until an unrelated update — now fixed and covered by
a unit test.

**Acceptance:** display runs independently, updates live, survives a network blip, exposes nothing
identifying. Verified via a real headless-Chromium run: empty board → customer joins and gets called
live with no display reload → full-page PII scan found zero matches → pausing the queue updates the
board live → an invalid code shows a sensible message. 113 unit + 34 integration tests, `pnpm quality`
green.

### Phase 7 — Notification Infrastructure

**Status: ✅ Done** (2026-09-29)

Outbox pattern (`NotificationOutbox`: PENDING→SENT, claimed atomically before sending — the
exactly-once guarantee), threshold evaluation in the same transaction as the mutation (G-31 — new
`Queue.approachingThreshold`/`nearlyNextThreshold` and `QueueEntry.*NotifiedAt` gates), and
`MockNotificationProvider` behind the same abstract-class DI pattern as `ConsoleMailService`.
APPROACHING/NEARLY_NEXT re-evaluated across every WAITING entry after any mutation that could shift
positions; nearest-tier-wins suppression (jumping straight to a nearer tier silently marks the
further one sent, never fires it); CALLED fires once from Call Next and suppresses any still-pending
lower tier; RECALLED fires unconditionally on every staff resend. **This completes the plan's original
first vertical slice (§98/C-03)** — scan → join → position updates → staff calls → customer notified
(mock) → complete.

A genuine concurrency bug surfaced and was fixed along the way: two simultaneous Call Next requests on
the same queue could deadlock against each other once threshold re-evaluation started writing to
WAITING rows a sibling transaction had locked via its own `FOR UPDATE SKIP LOCKED` select — fixed by
having the threshold pass claim only the specific rows it's about to write, via the same
skip-if-locked pattern, deferring a locked entry's notification to the queue's next mutation rather
than blocking.

**Acceptance:** called customer receives exactly one (mocked) notification; duplicate processing
doesn't duplicate it; queue operations don't depend on the provider being up. Verified via a dedicated
integration suite (the vertical slice, threshold suppression, cross-entry cascade after a call,
unconditional recall, duplicate-processing-safety, and provider-outage-doesn't-block-the-mutation) plus
a manual curl-driven run cross-checked against the database directly. 125 unit + 40 integration tests,
`pnpm quality` green.

### Phase 8 — Real Notifications (Pingram)

**Status: ✅ Done** (2026-09-29)

Wired the real provider behind independently-swappable `EmailProvider`/`SmsProvider` interfaces
(ADR-008, revised this phase from a single combined interface, per a mid-phase request) — **email
first** (free, default channel) via a real `PingramEmailProvider`, SMS as a later adapter once real
per-tenant cost caps exist (G-29) — only `MockSmsProvider` exists today, and selecting anything else
for `SMS_PROVIDER` throws at startup rather than silently no-op'ing. Discovered along the way that
Pingram's account data is regional (`us`/`eu`/`ca`, separate hosts) — a real, valid key 404'd against
the wrong region's host during live verification; fixed with a `PINGRAM_REGION` config switch,
confirmed against Pingram's own published SDK source. Consent text + versioning (G-48) not yet
started — deferred, not blocking this phase's own acceptance criteria.

**Acceptance:** a real email is delivered through the configured provider; provider failure doesn't
break queue operations; secrets aren't logged. All three verified — a real email was sent through the
live Pingram API and received by the user.

### Phase 9 — Customer Accounts & Portal _(§4.5 Phase A)_

**Status: ✅ Done** (2026-09-29)

Tenant-scoped customer accounts (D-09), `CUSTOMER_IDENTITY` code issuance + regeneration (staff- or
customer-initiated, G-52), login via email OTP, portal (live position + personal code, G-55).
Staff-initiated in-person signup (loyalty-card framing, G-56) plus the self-service "sign up here"
poster — a new minimal `GENERAL` code context (D-10), tenant-only, no queue/customer binding.

`Customer` is the login-capable entity directly (no `TenantUser`-style membership split — a customer
account never spans tenants, unlike staff). New `CustomerLoginCode`/`CustomerRefreshToken` tables mirror
staff's `LoginCode`/`RefreshToken` exactly. A separate `'customer-jwt'` passport strategy + guard
(`CustomerJwtAuthGuard`) keeps a customer token from ever being accepted by a staff route or vice versa
(verified live and in the integration suite) — the staff-wide `JwtAuthGuard` stays untouched. OTP emails
go straight through Phase 8's `EmailProvider` (real Pingram delivery, not the older console-only
`MailService` staff auth uses) — proven live during Phase 8, now actually reachable via real customer
traffic.

Staff-initiated signup (`POST /tenants/me/customers`) mints the identity code immediately, no OTP —
staff already verified the person in person. Self-service signup
(`POST /public/customers/signup`, reached via a `GENERAL` code's landing page) requires an email and
sends a login code before any session is issued. Both paths upsert on `(tenantId, phoneE164)` — the
exact same key the anonymous walk-in join flow already upserts on — so an account holder's future
anonymous joins (or past walk-in history) link to the same `Customer` row automatically; verified live
and in the integration suite, with zero code changes needed in `queue-entries.service.ts`'s `join()`.
Portal: `GET/POST /customers/me/*` (profile, identity code, regenerate, live active-entry). Frontend:
`/c/[code]` (signup-or-login landing) and `/c/portal` (personal QR code, live queue status), a new
`CustomerApiClient` in `@queueflow/api-client`.

**Acceptance:** a customer can be signed up in person or self-serve, log in, see their personal code
and current queue status. No kiosk hardware required yet. Verified via a dedicated integration suite (12
tests: GENERAL code mint/resolve, self-service signup + OTP login, identity-code regeneration, staff
in-person signup, anonymous-join account linking, email-conflict rejection, wrong-OTP rejection,
refresh/logout rotation, cross-token isolation, CUSTOMER_IDENTITY's public non-resolvability) plus
targeted unit tests for `CustomersService`/`CustomerAuthService`/the widened `CodesService`, and a
manual curl- and real-browser-driven run of the whole flow end to end. 162 unit + 53 integration tests,
`pnpm quality` green.

### Phase 10 — Kiosk Hardware & Guest Cards _(§4.5 Phase B)_

**Status: ✅ Done** (2026-09-30)

The physical counter scanner (D-10), numbered guest-card pool (D-14: `guest_1`…`guest_N`, zero data,
idempotent scan, auto-release on terminal state), self-serve instant join for both guest cards and
`CUSTOMER_IDENTITY` codes (D-11), staff-assisted cancel for guest-card users (no self-service path
exists for them by design).

New `GUEST_CARD` code context — a location-owned, numbered, anonymous card (`Code` gained
`locationId`/`guestNumber`/`currentEntryId`, the last a nullable-unique FK to `QueueEntry` tracking
which entry currently "holds" the card; null means free). `QueueEntriesService.joinByScan(tenantId,
queueId, publicCode)` is the scanner's one call — staff-authenticated (D-10's scanner is business
hardware, not a customer's own device), branches on whichever code kind was scanned:

- **Guest card**: `customerId` stays null the whole way through (zero data, D-14). The card's own
  `currentEntryId` linkage _is_ the dedup guarantee (G-54) — re-scanning an already-linked card
  returns the existing entry rather than minting a duplicate, and a `FOR UPDATE` row lock on the code
  closes the race between two near-simultaneous scans of the same physical card.
- **Customer identity**: a real `customerId` exists, so the ordinary per-location active-ticket cap
  (G-34) still applies — a scan doesn't bypass it. Idempotent the same way while already active in
  that queue.
- Anything else (QUEUE/DISPLAY/GENERAL) gets the same uniform 404 as an unrecognized code.

Scan-to-join deliberately skips the service-picker step entirely (D-11's "no confirmation" requirement)
— it only works when the queue has exactly one active+queueEnabled service to default to; a
multi-service queue needs the QR-poster or staff walk-in form instead (both do offer a picker). A
released card is picked back up automatically: any transition reaching COMPLETED/CANCELLED/NO_SHOW
clears `currentEntryId` (SKIPPED is excluded — the guest hasn't left, `requeue` brings the entry
straight back). Staff-assisted cancel for guest-card users needed **zero new code** — the existing
staff dashboard's cancel button already works on any entry regardless of `customerId` being null,
confirmed live.

Pool admin: `GuestCardsService.resize()` reconciles a location's pool to an exact target size —
mints new cards (continuing from the highest `guestNumber` _ever_ assigned at that location, active
or not — a real bug caught during manual verification: `@@unique([locationId, guestNumber])` applies
to deactivated rows too, so naively continuing from the _active_ count collided after a
shrink-then-regrow cycle) or deactivates the highest-numbered _free_ ones, refusing to shrink past a
card that's currently out with a guest.

**Real bug found and fixed during manual verification**: shrinking a pool to 0 and then growing it
again threw a Prisma unique-constraint violation on `(locationId, guestNumber)` — the resize logic
was counting only _active_ cards to pick the next number, but the unique index also covers the
deactivated rows left behind by the shrink. Fixed by sourcing the next number from `MAX(guestNumber)`
across all rows for that location (active or not) instead of `COUNT(active rows)`; a dedicated
regression test (unit + integration) now covers exactly this shrink-to-zero-then-regrow sequence.

Frontend: `/admin/queues/[queueId]/scan` — a focused text input a USB/Bluetooth barcode scanner can
type straight into (Enter submits, same as a person typing it; no special hardware integration
needed), showing a confirmation card after each scan. The queue dashboard gained a "Guest cards" panel
(pool size control, per-card in-use indicator) and a "Scan" button alongside Call Next/Add Walk-in.

**Acceptance:** a physical guest card and a customer's personal code both self-serve-join correctly at
the counter scanner; re-scanning an active card/code never duplicates. Verified via a dedicated
integration suite (10 tests: pool grow/shrink/shrink-refused-while-in-use, the shrink-then-regrow
numbering regression, role-gating, guest-card instant join + idempotent re-scan + auto-release +
post-release re-scan mints a fresh ticket, staff-assisted cancel releasing the card, cross-location
rejection, single-active-service enforcement, customer-identity instant join + idempotent re-scan,
non-GUEST_CARD/CUSTOMER_IDENTITY codes rejected, cross-tenant rejection) plus targeted unit tests for
`GuestCardsService`/the widened `QueueEntriesService`/`CodesService`, a manual curl-driven run of the
whole flow end to end (including the bug found above), and a real-browser (Playwright) run of the
scanner page and guest-card panel. 185 unit + 63 integration tests, `pnpm quality` green.

### Phase 11 — Business Administration

**Status: ✅ Done** (2026-10-02)

QR/code management screens, service/staff/location management UI, business hours, notification
settings, the live "today" dashboard (queue length, average wait, served count — G-14's formulas;
**not** the deferred historical-trend analytics). PWA manifest + service worker (ADR-010).

Almost entirely a frontend phase — every CRUD operation already had a backend endpoint from Phases
1–3 (locations/services/queues/invites/capabilities), so this phase's own backend work was small and
targeted:

- **`GET /tenants/me/staff`** (new) — the current staff roster, read-only (role changes and removing
  an existing member were never a resolved requirement, only invite + revoke-the-invite; see Known
  Issues).
- **`GET /tenants/me/queues/:queueId/stats/today`** (new, G-14) — scoped to the location's local
  service-day (the same boundary the ticket counter itself resets on), not a rolling 24h window.
  `waitingCount` is live; `servedCount`/`abandonedCount`/`noShowCount` and the two averages
  (`calledAt − joinedAt`, `completedAt − startedAt`) are computed over today's entries only. Averages
  are `null`, not `0`, when there's no data yet — a dashboard showing "0 min average wait" before
  anyone's been called would be actively misleading. "Abandonment" doesn't distinguish
  customer-initiated from staff-initiated `CANCELLED` — there's no column recording which path
  cancelled an entry (see the schema comment on `QueueEntry.cancellationReason`); every `CANCELLED`
  counts the same way.
- **`POST /tenants/me/codes/regenerate`** (new) — rotation for the GENERAL "sign up here" poster,
  same deactivate-old-mint-new precedent as DISPLAY (Phase 6) and `CUSTOMER_IDENTITY` (Phase 9); Phase
  9 had only shipped `createGeneral` (always mints a fresh code, several can coexist on purpose — one
  per location's poster) with no rotation story for "this one specific poster leaked."
- **`CodeSummary` widened** to include `id` and `active` — neither was exposed before, but a
  staff-facing code-listing screen needs both (to target a specific code for deactivation, and to
  tell past codes apart from the currently-usable one). Purely additive; nothing existing broke.

Frontend: `/admin/locations` (list + create) and `/admin/locations/[id]` (edit fields, a business-hours
editor — one open period per day, the common case; a day already configured with multiple split
periods via the raw API would need to stay that way via the API too, full-replace semantics mean the
UI can't preserve a second period it doesn't represent — and a nested services list with inline
activate/deactivate); `/admin/staff` (invite, pending-invite list + revoke, and the roster);
`/admin/settings` (tenant capability toggles, the GENERAL poster code with regenerate);
`/admin/queues/[id]/settings` (a Status control — Active/Pause/Close, added after manual verification
surfaced that the existing `PATCH .../status` endpoint from Phase 3 had no staff-facing UI anywhere —
plus the config form, service attach, and QUEUE/DISPLAY code mint/deactivate); the queue dashboard
gained a live stats bar and nav links. **Deliberate UX change**:
`/admin/queues` no longer auto-redirects past a lone queue (Phase 5's original "skip the picker in the
common case" shortcut) — it has to stay reachable and show the "+ New queue" affordance even when
there's only one today, since this is now also how a second queue gets created.

PWA: a hand-rolled `public/sw.js` (no `next-pwa` dependency) that only intercepts same-origin GET
requests — the API lives on a different origin (`NEXT_PUBLIC_API_URL`) and is never touched, so live
queue state, SSE streams, and customer/staff data are never risked being served stale from a cache;
this only helps the app _shell_ reopen (and register as installable) when briefly offline. Manifest +
three generated PNG icons (a simple brand mark, `PIL` since no image tooling was already a
dependency). **Web Push was explicitly descoped** from this phase despite being named in the roadmap
prose — it's real, separate work (VAPID keys, a subscription-storage endpoint, wiring
`NotificationsService` to an actual push-send library), and the phase's own stated acceptance
criterion only requires installability, not push delivery; tracked in Known Issues, not silently
dropped.

**Acceptance:** a business can configure the complete MVP without database access; the app installs
as a PWA on a tablet or desktop. Verified via a dedicated integration suite (7 tests: the staff roster
including role-gating, GENERAL code regeneration, and the live dashboard's stats computed from a real
join → call → complete / call → no-show / cancel-while-waiting flow, plus the null-averages and
cross-tenant-404 cases) plus targeted unit tests for the two new service methods, a manual curl-driven
run of every new/changed endpoint, and a real-browser (Playwright) run of the entire new admin surface
end to end (create a location, set hours, add a service, create a queue, configure it, mint and
deactivate codes, invite and revoke staff, toggle capabilities, regenerate the poster code, confirm
the manifest/icons/service-worker). 192 unit + 70 integration tests, `pnpm quality` green.

### Phase 12 — Hardening

**Status: ✅ Done** (2026-10-03)

Concrete rate-limit numbers in place everywhere (G-38), token entropy audit (G-39), secrets/log
redaction (G-41), backup/restore actually tested against real data, accessibility pass (WCAG AA per
plan §55), retention/deletion job running (90-day PII purge, G-37), dependency scanning.

The token-entropy audit (G-39) found a real gap, not just confirmed compliance: `CUSTOMER_IDENTITY`/
`GUEST_CARD` codes were minted with the same short, printable alphabet as `QUEUE`/`DISPLAY`/`GENERAL`,
despite `plan-review.md` grouping the first two with `queue_entry.publicToken` as "secret tokens"
(128-bit minimum) — presenting one at a scanner is a real capability (instant-join/hold), unlike a
poster code which only reveals context. Fixed by routing those two context types through the same
`generateSecurePublicToken` generator `publicToken` already used.

G-38's concrete numbers are now enforced exactly: join 5/hour per phone + 20/hour per IP, QR
resolution 100/min per IP, public ticket read 60/min per token, SSE 10 concurrent connections per IP.
The phone/token dimensions needed standalone `CanActivate` guards — `@nestjs/throttler`'s named
multi-throttler system only cleanly tracks by IP. **A real enforcement bug was caught specifically by
integration testing, not unit testing**: the new guards were applied via `@UseGuards(...)` but never
registered in the module's `providers` array, so Nest instantiated a fresh, stateless instance per
request — the in-memory counter silently reset every call, meaning nothing was actually being limited
despite every unit test passing (a unit test calls `canActivate()` repeatedly on one manually
constructed instance, which can't expose a DI-resolution bug). Fixed by registering both guards as
providers.

G-41 surfaced the phase's biggest finding: staff auth email (`MailService`) had **no real delivery
path in any environment**, still `ConsoleMailService` (log-only) despite Phase 8 building a fully real
`EmailProvider`/`PingramEmailProvider` system for queue notifications — found via a systematic log-call
audit, not a bug report. Fixed by consolidating onto the existing `EmailProvider` abstraction rather
than building a third parallel provider. Also under G-41/G-08: the web app had no CSP or security
headers at all, even though that's where the Bearer refresh token actually lives (`localStorage`), not
the API. A nonce-based CSP (ADR-011) was added via Next.js middleware — the first version **broke the
app entirely in production** (Next only nonces a page's scripts during dynamic rendering; a
statically-prerendered page ships with no nonce and the browser blocks everything on it), caught by
actually booting a production build in a real browser rather than trusting a `curl` of the response
header, which looked correct the whole time. Fixed by forcing the whole app to render dynamically.
`pnpm audit`'s 79 findings were triaged individually: one real, reachable critical (Next's
`/_next/image` route is live by default even though the app never uses `next/image`, and a critical
AVIF-triggered RCE lives in its request handling) fixed by blocking the route in middleware; everything
else confirmed either not reachable in this app's actual usage or dev/build-tooling never shipped to
production, with the remaining Next.js-14-core findings deferred to a dedicated major-version upgrade
(tracked in `PROJECT_STATUS.md`'s Known Issues). Backup/restore was performed for real against the
real dev database, not just designed — `docs/runbooks/backup-restore.md`.

G-37 (90-day PII purge) is the project's first scheduled background job — a daily `@Cron()`-triggered
`RetentionService.purgeStalePii()`, raw SQL for the correlated "last completed entry per customer"
filter Prisma's query builder can't express, anonymizing (never deleting — history stays for
analytics) a stale customer's PII while explicitly protecting anyone with a currently-active entry
even if their last _completed_ visit elsewhere is stale (a safety condition added beyond G-37's literal
text, documented as such). Deliberately no HTTP endpoint — platform-wide, no `PLATFORM_ADMIN` console
exists to call it from.

The accessibility pass (manual read-through + an automated axe-core/Playwright scan across every
customer and staff flow) found two real issues, both fixed: the card/code scanner input had only a
placeholder, no accessible name; `/admin` and `/display/[code]` genuinely lost their `<title>` after a
client-side navigation, reproduced on a plain reload with zero test tooling involved.

**Acceptance:** security tests pass; a restore has actually been performed once; production readiness
checklist complete for a real pilot business. Met — see `PROJECT_STATUS.md` for the full writeup, test
counts (217 unit + 77 integration), and what's explicitly still deferred (the Next.js major-version
upgrade; a scheduled/automated backup job, as opposed to the manual procedure now proven to work).

**This completed the original 0–12 list.** Phases 13–14 below were added on 2026-10-03, when the
user chose to build the appointment engine next. What remains is genuinely deferred work
(see below) and whatever a real pilot business's actual usage surfaces — not anything already known
and postponed within this list.

---

## Appointment phases (§4.5 Phase C, added 2026-10-03)

The appointment engine came off the deferred list on 2026-10-03. Its open decisions (G-22/23/24/26)
were resolved first, see ADR-012, then it was split in two so that each phase fits one session.

### Phase 13 — Appointment Engine

**Status: ✅ Done** (2026-10-03) — see `docs/status/phase-13.md`

Tenant appointment settings (slot interval, buffer, min lead time, advance window, cancel notice);
per-location pool capacity + daily cap; date closures (full or partial day); backend-authoritative
slot generation (G-22, fixed grid, peak-overlap capacity check, DST-safe); public anonymous booking
from a QUEUE code's landing page, with location-row-locked double-booking prevention and
idempotency; a customer's manage page (secret token) with self-cancel inside the notice window;
staff calendar (count per day for a month → day list) with cancel-with-reason; closures listing
affected bookings; booked/cancelled notifications via the outbox; signed-up customers see upcoming
appointments in their portal.

**Acceptance:** concurrent bookings for the last unit of capacity yield exactly one success; slot
generation unit-tested (grid, buffer, closures, capacity, lead time, window, daily cap, DST);
cross-tenant isolation on every new staff endpoint; customer cancel blocked inside the notice
window; `pnpm quality` green; both dev servers booted.

### Phase 14 — Appointment Check-In & Mixed Queue

**Status: ✅ Done** (2026-10-04) — see `docs/status/phase-14.md`, ADR-013

`APPOINTMENT_TICKET` codes minted with every booking (D-12); check-in by scanner, customer link, or
staff, idempotent and race-safe, on the appointment's day only; `queue_entry.appointmentId`; the G-25
priority rule (open-window appointments first, early check-ins wait in FIFO); no-shows after a grace
period with same-day staff restore (§77); idempotent reminders (§75); both jobs once a minute on
`@nestjs/schedule`.

## Account security

### Phase 15 — Authenticator App Login (TOTP)

**Status: ✅ Done** (2026-10-04) — see `docs/status/phase-15.md`, ADR-014

A per-account login preference: emailed code (default) or a code from an authenticator app (RFC 6238),
for staff and customers alike. The emailed code always stays available ("Email me a code instead"),
so it's a convenience, not a second factor. Setup by QR while logged in, confirmed by a first code;
secret encrypted at rest; replay protection and a separate lockout. Every code box submits by itself
once 6 digits are typed or pasted.

---

### Phase 16 — Team & Branding

**Status: ✅ Done** (2026-10-04) — see `docs/status/phase-16.md`, ADR-015

Managers and staff allocated to one location, with server-side enforcement on every location-scoped
route (a route sweep test proves it); counter tablets bound to a location; an invite-acceptance page
(link in the invite email, name captured); changing a member's role/location and removing them (soft,
history kept); a business logo shown on every customer-facing page and the TV board.

## Next

### Phase 17 — First Deploy

**Status: Not started** (agreed 2026-10-04)

Lock CORS to the web app's origin (it still allows any origin); a `render.yaml` for the API (build,
`prisma migrate deploy`, start, health check); documented Vercel settings for the monorepo web app;
a deploy runbook (Neon, Render, Vercel, Pingram sender verification, every environment variable, DNS
for `q.m9rcy.dev`, smoke-test checklist). Hosting per ADR-009 unless the user decides otherwise.

---

## Explicitly deferred — not scheduled, revisit only on real demand

These are real, not forgotten — each has partial spec already captured so a future phase doesn't
start from nothing:

- ~~**Appointment Engine + Appointment-Ticket Check-In**~~ — scheduled as Phases 13–14 above
  (2026-10-03).
- **Historical analytics/trend reporting** (original plan Phase 11, beyond the live-today numbers
  already in Phase 11 above).
- **`PLATFORM_ADMIN` console** (G-51) — no home until there's a real second tenant needing platform-
  level oversight.
- **Billing/subscriptions** (original plan Phase 14) — after core product validation, per the plan's
  own stated principle.
- **High-volume "flash crowd" queuing** (e.g. concert-ticket-style access, 100k+ simultaneous joins)
  — discussed 2026-09-27. A materially different problem from the walk-in/clinic use case the
  current queue engine targets, not just "the same thing at bigger scale": at that concurrency, the
  ticket-number allocator (`QueueTicketCounter`, a single Postgres row per queue/day) becomes a
  serialization bottleneck — every request contends for the same row. The industry-standard answer
  is a **virtual waiting room** in front of the real join flow (the Ticketmaster/Queue-it/Cloudflare
  Waiting Room pattern): admit people via a very cheap, very fast counter (Redis `INCR`, built for
  exactly this throughput — not Postgres row locking), show them a holding position, and trickle
  admitted requests into the existing `join()` flow at a rate the backend can actually sustain. This
  is Redis's strongest justification in the whole architecture — stronger than SSE fan-out or rate
  limiting — but it's new infrastructure to build when actually prioritized, not something today's
  MVP needs or should build speculatively. **One thing to keep true in the meantime**: the code/QR
  resolver (Phase 4 onward) should stay a generic `code → context` lookup rather than assuming every
  context always writes straight to Postgres synchronously, so this doesn't require ripping out the
  resolver later — a constraint the Phase 4 design already satisfies, not a change to it.

---

## Count, for reference

**18 phases in the active roadmap (0–17)**: 0–16 done, 17 next. Plus 4
explicitly deferred workstreams (analytics trends, platform admin, billing, flash-crowd/waiting-room
queuing) tracked but not scheduled.
