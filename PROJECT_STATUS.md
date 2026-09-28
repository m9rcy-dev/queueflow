# Project Status

Last Updated: 2026-09-28
Current Phase: Phase 7 — Notification Infrastructure (see `docs/roadmap.md` — the authoritative 13-phase list, Phases 0–6 done)
Current Task: See Next Task below

## Completed

### Phase -1 — Planning and Architecture Review

- Reviewed `docs/QueueFlow_Detailed_Plan.md` and `docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md` end to end against a working baseline (`/Users/m9rcy/dev/ai/budget-terry`).
- Wrote `docs/plan-review.md` — full gap/contradiction review, worked through with the user (D-01–D-16, C-01–C-07, G-01–G-51 resolved except appointment-engine specifics and the kiosk config screen, deliberately deferred).
- Wrote `AGENTS.md`, `CLAUDE.md`, `docs/roadmap.md` (the authoritative 13-phase list), ADR-001 through ADR-010. Initialized git.

### Phase 0 — Repository Bootstrap

- Monorepo skeleton: pnpm workspaces, `apps/api` (NestJS + Prisma), `apps/web` (Next.js), `packages/{types,validation,api-client,ui}`, `docker-compose.yml`, CI.

### Phase 1 — Tenant & Core Auth

- Prisma: `User`, `Tenant`, `TenantUser`, `TenantInvite`, `LoginCode`, `RefreshToken` (tenant-scoped).
- Business signup (G-01), OTP login (G-05), tenant selection for multi-membership users (G-03), staff invites (G-02), global `JwtAuthGuard`+`RolesGuard`, refresh rotation.
- Tests: 29 unit + 7 integration (including cross-tenant isolation).

### Phase 2 — Locations & Services

- Prisma: `Location` (IANA timezone, validated against the real tz database), `BusinessHours` (split periods), `Service` (per-service capability toggles). Deliberately no `Staff` entity — `TenantUser` suffices.
- CRUD under `/tenants/me/locations` and `/tenants/me/services`, ownership-in-the-query throughout.
- Tests: 13 unit + 5 integration.

### Phase 3 — Queue Domain

- Prisma: `Customer` (added ahead of schedule — needed for G-34's per-customer cap), `Queue`, `QueueService`, `QueueTicketCounter`, `QueueEntry` (full state machine, G-15).
- Ticket allocation atomic per queue/location-local-day (G-10). Position/estimated-wait always computed on read (G-13/G-11/G-12). Call Next uses `FOR UPDATE SKIP LOCKED` (ADR-006). Idempotency (G-21). Closing a queue cascade-cancels `WAITING` entries and blocks new joins (G-16). Max-active-tickets at both per-queue and per-location level (G-34).
- Public routes: `POST /public/queues/:id/entries` (join), `GET /public/queue-entries/:token`, `POST /public/queue-entries/:token/cancel`. Staff routes: list, call-next, start, complete, skip, requeue, cancel, no-show, recall — under `/tenants/me/queues/...` and `/tenants/me/queue-entries/...`.
- Tests: 74 unit + 19 integration total across the project, including a genuine concurrency test (8 simultaneous joins, then 12 simultaneous Call Next requests via `Promise.all`: exactly 8 succeeded, each claiming a distinct entry). Manual end-to-end verification first caught a real bug — `assignedStaffId` was being set to `User.id` instead of the `TenantUser.id` the foreign key actually requires — before any automated test existed.
- `pnpm quality` passes end to end.

### Phase 4 — Customer Queue UI

- Minimal `Code` model (§4.5/ADR-005), scoped to `QUEUE` context only: `publicCode → {tenant, location, queue, services, capabilities}`. Admin mint endpoint (`POST /tenants/me/queues/:queueId/codes`, `TENANT_OWNER`/`TENANT_ADMIN` only, retries on public-code collision) and public resolver (`GET /public/codes/:code`, 404s uniformly for not-found/inactive so a deactivated code can't be distinguished from a nonexistent one).
- Realtime: `GET /public/queue-entries/:token/events` (SSE via `@Sse()` + RxJS), backed by an in-process `EventEmitter` (`QueueEventsService`, global module) that `QueueEntriesService` emits on after join/callNext/transition/recall. Single-instance only (D-06) — Redis pub/sub is the documented swap when horizontal scaling is needed (see flash-crowd future workstream, `docs/roadmap.md`). Client always refetches full ticket state on every event rather than trusting it caught all of them (G-27); a heartbeat ping keeps the connection alive through proxies.
- Rate limiting: `@nestjs/throttler` globally (100/min default) plus 5/min specifically on the public join POST (G-40, partial — see Known Issues). Custom `AppThrottlerGuard` lets integration tests disable enforcement per-file via `DISABLE_RATE_LIMITING=true` while a dedicated `rate-limit.integration-spec.ts` verifies it's genuinely enforced (5 successes then a real 429).
- `packages/api-client`: `createPublicApiClient(baseUrl)` — anonymous client (no bearer token) for `resolveCode`/`joinQueue`/`getTicket`/`cancelTicket`/`ticketEventsUrl`. `packages/ui`: `Button`/`Card`/`Input`/`Badge`, sharing design tokens with `apps/web/tailwind.config.ts`.
- `apps/web`: `/q/[code]` (landing — resolves the code, lists joinable services, name+mobile form, idempotency key, submits and redirects) and `/queue/t/[token]` (live ticket page — `EventSource`-driven position/status, Leave Queue with confirm).
- Tests: 5 new unit (codes service) → 84 total unit; 4 new integration (codes) + 1 new (rate-limit) → 24 total integration. `pnpm quality` green end to end (~24s).
- Manual verification: full flow driven through a real headless Chromium browser (Playwright, hand-rolled driver script — no `chromium-cli` available in this environment) against the actual booted dev stack — landing renders styled, join submits, redirects to ticket page, a staff-side Call Next fired mid-session updates the already-rendered ticket page live with **no reload** (screenshotted before/after), Leave Queue cancels and persists (cross-checked via `psql`).
- Environment issue found and fixed (not a code regression): Testcontainers' Ryuk reaper sidecar hangs in this sandboxed Docker environment, making every integration test file take ~932s (timing out at Jest's 120s hook limit) instead of ~5-7s. Fixed by setting `TESTCONTAINERS_RYUK_DISABLED=true` in `test:integration` (documented in `test/jest-integration.config.js`); safe because every spec's `afterAll` already calls `container.stop()` explicitly, so only Ryuk's extra safety net against an unclean process kill is given up, not normal cleanup.

### Phase 5 — Staff Queue UI

- **Trusted device + per-staff PIN (D-03a)**: `TenantUser` gained `pinHash`/`pinFailedAttempts`/`pinLockedUntil` (argon2id via a new `PinService`, mirroring budget-terry's password-hashing ADR-011 — a long-lived secret, unlike the OTP codes' fast sha256). New `DeviceTrust` model, tenant-scoped (not user-scoped — one shared tablet, many staff), same opaque-token-hashed-server-side shape as `RefreshToken`, rotating on every use. New endpoints: `POST /auth/devices/trust` (authenticated, "trust this device"), `POST /auth/device-context` (public — presented a trust token, returns the tenant's staff roster for a name-picker, rotating the token), `POST /auth/staff-pin-login` (public — name + PIN, checked against the presented device trust, issues a normal session), `POST /auth/pin` (authenticated — set/change your own PIN). Lockout after 5 failed PIN attempts (15 min), same generic-failure principle as OTP (never reveals which part was wrong); a device trusted for one tenant is verified incapable of authenticating another tenant's staff.
- **Staff queue dashboard** (`apps/web/src/app/admin/queues/[queueId]`): live view (3s poll) of Waiting / Now-serving-or-called / Skipped, every lifecycle action from Phase 3's API (Call Next, Start, Complete, Skip, Requeue, Cancel, No Show, Recall), and a walk-in form (`POST /tenants/me/queues/:queueId/entries`, reuses the same `join()` logic as the QR-scan path). New `GET /tenants/me/queues/:id/joinable-services` mirrors the public resolver's own active+queueEnabled filter for the walk-in form's service picker.
- **Staff identity on every entry (G-18)**: new `StaffQueueEntrySummary` (customer name/phone, assigned staff id/name) returned only from staff-authenticated routes — verified the public/customer routes still return the plain shape with neither field (an integration test asserts `assignedStaffName`/`customerName` are `undefined` on the public ticket-lookup response).
- `apps/web/src/app/admin/login`: real OTP login UI (Phase 1's backend had none until now) that also branches into the device-trust/PIN-picker flow when a trusted-device token is stored locally. `apps/web/src/app/admin/pin-setup`: set/change PIN. `packages/api-client`'s new `StaffApiClient` (Bearer attachment, refresh-and-retry-once except on `/auth/*` paths, mirrors budget-terry's `ApiClient`).
- Tests: 4 new unit (`pin.service.spec.ts`) + 29 auth unit tests (was 19) + 4 new queue-entries unit tests (walk-in + staff-summary enrichment) → 102 total unit; 4 new device-trust/PIN integration tests + 3 new walk-in/joinable-services integration tests → 31 total integration. `pnpm quality` green end to end (~32s).
- Manual verification: the entire flow driven through a real headless Chromium browser — OTP login → dashboard (queue auto-created mid-session via curl, page reloaded, queue appears) → add walk-in → Call Next (dashboard shows "with Priya Owner" live) → Start → Complete → set PIN → trust device → log out → PIN-switch back in, landing on the dashboard again. Screenshotted at each step; console checked for JS errors (only benign, already-caught 401s from the normal "try cached token, fall back to refresh" pattern on full page reloads, doubled by React StrictMode in dev).
- **Known gap carried forward**: Cloudflare Turnstile still not integrated (see Phase 4's note) — unrelated to this phase.

### Phase 6 — Public Display

- **`DISPLAY` added to `CodeContextType`** (was `QUEUE`-only) — G-07's resolution: no auth at all, a display identifies itself purely via a rotatable public code (`Code.active`, same field every context type already uses — deactivate + mint a fresh one is the whole rotation mechanism). `POST /tenants/me/queues/:queueId/codes` now takes an optional `contextType` body (defaults to `QUEUE`); new `POST .../codes/:codeId/deactivate` for rotation, ownership- and tenant-checked like every other staff route.
- The existing `GET /public/codes/:code` resolver (Phase 4's join flow) now explicitly rejects a `DISPLAY` code with the same uniform 404 as an unknown/deactivated one — it only ever understands `QUEUE` codes. A `DISPLAY` code is resolved by a new, separate endpoint instead, since the board needs a live feed, not a one-shot lookup (matches the plan's own original split into two distinct routes).
- New `GET /public/displays/:code/events` (SSE, `DisplaysModule`) — mirrors Phase 4's ticket SSE pattern exactly (initial snapshot, full refetch on every `QueueEventsService` change, heartbeat), but publishes a `DisplaySnapshot` (tenant/location/queue name+status, `nowServing: [{ticketNumber, serviceName}]`, `next: number[]`) that is **structurally incapable of carrying customer or staff identity** — the underlying Prisma queries never select those fields in the first place (defense in depth, not just an omitted DTO field). An integration/unit test and a live-browser PII scan both confirm this.
- **Real bug found and fixed while building this**: `QueuesService.updateStatus()` (pause/close) never called `QueueEventsService.emitQueueChanged()` — pausing or closing a queue was invisible to every SSE watcher (both the Phase 4 ticket page and this phase's display) until their next unrelated update or a manual refresh. Fixed by emitting on every status change; caught by the Playwright verification run (pause didn't show up on the board), not by any pre-existing test — a new unit test now covers it.
- `apps/web/src/app/display/[code]`: fullscreen, dark board — large "Now Serving" ticket numbers + service name (one per currently-CALLED/SERVING entry, so `servingCapacity > 1` shows multiple), a "Next Up" row, and a paused/closed message when the queue isn't accepting. `EventSource` auto-reconnects on a clean drop; a 70s watchdog force-reconnects on a silently-stalled connection (a TV left running for hours needs this more than a customer's own ticket page does). `/display` itself is just a guidance page — no display-picker UI exists (see Known Issues).
- Tests: 6 new unit (`displays.service.spec.ts`) + 4 new codes unit tests (DISPLAY create/deactivate) + 1 new queues unit test (the emit fix) → 113 total unit; 3 new codes integration tests (mint DISPLAY, rotate, cross-tenant-blocked deactivate) → 34 total integration. `pnpm quality` green end to end (~29s).
- Manual verification: real headless-Chromium run — empty board renders → a customer joins and is called **without reloading the display** (ticket number + service name appear live) → a full-page PII scan of the rendered board found zero matches for the customer's name/phone → pausing the queue via the staff API updates the board live to "Queue temporarily paused" → an invalid/unrecognized code shows a sensible message instead of hanging forever.

## Decisions Made

See `docs/plan-review.md` (D-01–D-16) and `docs/adr/`. Additions made during implementation: `RefreshToken` scoped by `tenantId` (Phase 1); no separate `Staff` entity (Phase 2); `Customer` entity introduced in Phase 3 rather than Phase 9, since G-34's cap enforcement needed it immediately.

## Known Issues

- **G-40 partial**: Cloudflare Turnstile (the specific bot-check the plan calls for on the join POST) is not integrated — only IP-based rate limiting (`@nestjs/throttler`, 5/min on join) ships. Adding Turnstile requires an external Cloudflare account/site key.
- Real SMS/email provider (Pingram) not yet integrated — `MailService` is `ConsoleMailService`. Phase 8's job.
- Network-level rate limiting (G-38, Redis/Upstash-backed, for horizontal-scale/multi-instance deployments) not yet wired — deferred to Phase 12 as scoped. Current rate limiting is in-process only, correct for the current single-instance deployment (D-06).
- No background job/scheduler exists — business-hours-based auto-closing (as a fallback to staff-controlled closing, G-16) and auto-no-show-after-grace-period (G-15) are both designed but not implemented; staff must act manually for now.
- SSE realtime is in-process (`EventEmitter`) only — correct for single-instance (D-06), but will need a Redis pub/sub swap before horizontal scaling or the future high-volume "flash crowd" workstream (see `docs/roadmap.md`'s future-enhancements section).
- Testcontainers' Ryuk reaper sidecar hangs in this sandboxed Docker dev environment; `apps/api`'s `test:integration` script sets `TESTCONTAINERS_RYUK_DISABLED=true` to work around it (see `test/jest-integration.config.js` for the full explanation). Not an application bug — purely an environment quirk of this Docker setup.
- The staff dashboard polls every 3s rather than using SSE — deliberate for MVP simplicity (EventSource can't attach an Authorization header, and a query-string token is a security smell not worth taking on this phase); fine at current staff-tablet counts, worth revisiting if multi-tablet live sync becomes a real complaint.
- No staff-facing UI yet for creating/managing locations, services, queues, or codes (including display codes) — Phase 5/6's work assumes these already exist (created via curl/API in this session's manual testing). A business-admin UI for this is not yet scoped into any phase; flag to the user if it's wanted before Phase 11 (Business Administration).
- No display-picker UI — a business owner points the TV's browser at the specific `/display/{code}` URL directly (bookmarked once). Fine for one screen per location (D-10); would need a picker if a business ever wants several distinct boards.

## Next Task

**Phase 7 — Notification Infrastructure**, per `docs/roadmap.md`:

1. Outbox pattern — a notification is written to its own table in the same transaction as the queue mutation that triggers it (G-31's threshold evaluation), then sent asynchronously; a queue operation (join, call-next, etc.) must never block on — or fail because of — the notification provider being slow or down.
2. `MockNotificationProvider` — same reasoning as `ConsoleMailService`: prove the pattern and the business logic (thresholds, exactly-once delivery) before Phase 8 wires up a real provider (Pingram).
3. **This completes the plan's original first vertical slice** (§98/C-03): scan → join → position updates → staff calls → customer notified (mock) → complete. Worth an explicit end-to-end check once built, not just unit tests on the outbox mechanics.

Acceptance (per roadmap): a called customer receives exactly one (mocked) notification; duplicate processing doesn't duplicate it; queue operations don't depend on the provider being up.
