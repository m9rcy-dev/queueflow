# Project Status

Last Updated: 2026-09-27
Current Phase: Phase 4 — Customer Queue UI (see `docs/roadmap.md` — the authoritative 13-phase list, Phases 0–3 done)
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

## Decisions Made

See `docs/plan-review.md` (D-01–D-16) and `docs/adr/`. Additions made during implementation: `RefreshToken` scoped by `tenantId` (Phase 1); no separate `Staff` entity (Phase 2); `Customer` entity introduced in Phase 3 rather than Phase 9, since G-34's cap enforcement needed it immediately.

## Known Issues

- **No code/QR resolver exists yet.** Phase 3's public join API takes a raw `queueId` directly in the URL — it does not go through the unified `code` model (§4.5/ADR-005: `CUSTOMER_IDENTITY`, `GUEST_CARD`, etc.). Phase 4 needs at minimum a small resolver for the `QUEUE` context type (a `code` → `{tenantId, locationId, queueId}` lookup) so a printed/scanned QR doesn't have to embed a raw internal UUID. Do not build the _full_ ADR-005 model now — `CUSTOMER_IDENTITY`/`GUEST_CARD`/`APPOINTMENT_TICKET` are Phases 9/10/C's job; build only what the anonymous walk-in needs.
- **No realtime (SSE) exists yet.** Phase 4's "live position" requirement needs a `GET /public/queue-entries/:token/events` SSE endpoint — not built in Phase 3, which only proved the engine via plain request/response.
- `packages/api-client` and `packages/ui` are still empty shells — Phase 4 is genuinely the first phase that needs them filled in.
- Real SMS/email provider (Pingram) not yet integrated — `MailService` is `ConsoleMailService`. Phase 8's job.
- Network-level rate limiting (G-38, Redis/Upstash-backed) not yet wired — deferred to Phase 12 as scoped. G-40's Turnstile on the join POST is also not yet added — the public join endpoint has no bot/abuse protection yet.
- No background job/scheduler exists — business-hours-based auto-closing (as a fallback to staff-controlled closing, G-16) and auto-no-show-after-grace-period (G-15) are both designed but not implemented; staff must act manually for now.

## Next Task

**Phase 4 — Customer Queue UI**, per `docs/roadmap.md`:

1. **Minimal code resolver** (see Known Issues above): a `Code` model scoped to the `QUEUE` context type only for now — `publicCode → {tenant, location, queue, capabilities}` — plus an admin endpoint to generate one for a queue. Do not build the other ADR-005 code kinds yet.
2. **SSE endpoint**: `GET /public/queue-entries/:token/events` streaming position/status changes, with the client refetching current state on reconnect (G-27) rather than trusting it caught every event.
3. **Rate limiting + bot check on the join POST** (G-40) — this is the first genuinely public-unauthenticated write endpoint in the system; it should not ship without at least a basic protection.
4. Next.js pages in `apps/web`: QR-landing/context page → service selection → name+mobile form → ticket confirmation page (showing the ticket-as-QR per §4.5, for recovery) → live ticket page (SSE-updated) → leave-queue button.
5. Fill in `packages/api-client` with a typed fetch client for the public endpoints, and `packages/ui` with the first real shared components (Button, Card, Input, Badge) per the visual doc's design tokens (already in `apps/web/tailwind.config.ts`).

Acceptance: the plan's own first vertical-slice customer half works end to end on a real phone — scan/open a link, join, see live position update without a page refresh, leave the queue.
