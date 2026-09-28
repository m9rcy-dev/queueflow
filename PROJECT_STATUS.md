# Project Status

Last Updated: 2026-09-28
Current Phase: Phase 5 — Staff Queue UI (see `docs/roadmap.md` — the authoritative 13-phase list, Phases 0–4 done)
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

## Decisions Made

See `docs/plan-review.md` (D-01–D-16) and `docs/adr/`. Additions made during implementation: `RefreshToken` scoped by `tenantId` (Phase 1); no separate `Staff` entity (Phase 2); `Customer` entity introduced in Phase 3 rather than Phase 9, since G-34's cap enforcement needed it immediately.

## Known Issues

- **G-40 partial**: Cloudflare Turnstile (the specific bot-check the plan calls for on the join POST) is not integrated — only IP-based rate limiting (`@nestjs/throttler`, 5/min on join) ships. Adding Turnstile requires an external Cloudflare account/site key.
- Real SMS/email provider (Pingram) not yet integrated — `MailService` is `ConsoleMailService`. Phase 8's job.
- Network-level rate limiting (G-38, Redis/Upstash-backed, for horizontal-scale/multi-instance deployments) not yet wired — deferred to Phase 12 as scoped. Current rate limiting is in-process only, correct for the current single-instance deployment (D-06).
- No background job/scheduler exists — business-hours-based auto-closing (as a fallback to staff-controlled closing, G-16) and auto-no-show-after-grace-period (G-15) are both designed but not implemented; staff must act manually for now.
- SSE realtime is in-process (`EventEmitter`) only — correct for single-instance (D-06), but will need a Redis pub/sub swap before horizontal scaling or the future high-volume "flash crowd" workstream (see `docs/roadmap.md`'s future-enhancements section).
- Testcontainers' Ryuk reaper sidecar hangs in this sandboxed Docker dev environment; `apps/api`'s `test:integration` script sets `TESTCONTAINERS_RYUK_DISABLED=true` to work around it (see `test/jest-integration.config.js` for the full explanation). Not an application bug — purely an environment quirk of this Docker setup.

## Next Task

**Phase 5 — Staff Queue UI**, per `docs/roadmap.md`:

1. Staff-facing queue view (list of active/waiting entries, live-updating) plus the full lifecycle action set already built in Phase 3's API: Call Next, Start, Complete, Skip/Requeue, No Show, Recall, Cancel, and manually adding a walk-in from the staff side.
2. **Trusted device + per-staff PIN** (D-03a) — this is the first phase where a real shared counter device exists, so it's the natural point to build shift-change switching (a device stays logged in; individual staff PIN-switch in/out) rather than front-loading it into Phase 1's auth.
3. Reuse/extend `packages/api-client` with an authenticated staff client (Bearer token attachment, refresh-and-retry-once) and `packages/ui` components as needed for the staff views.

Acceptance (per roadmap): staff can operate the complete queue lifecycle from one device; every action attributes to the acting staff member; concurrency tests pass (Phase 3 already proved the underlying concurrency; Phase 5 proves the UI drives it correctly).
