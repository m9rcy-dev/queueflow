# Project Status

Last Updated: 2026-09-27
Current Phase: Phase 3 — Queue Domain (see `docs/roadmap.md` — the authoritative 13-phase list, Phases 0–2 done)
Current Task: See Next Task below

## Completed

### Phase -1 — Planning and Architecture Review

- Reviewed `docs/QueueFlow_Detailed_Plan.md` and `docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md` end to end against a working baseline (`/Users/m9rcy/dev/ai/budget-terry`).
- Wrote `docs/plan-review.md` — a full gap/contradiction review, worked through in discussion with the user (D-01–D-16, C-01–C-07, G-01–G-51 all resolved except appointment-engine specifics and the kiosk config screen, deliberately deferred).
- Wrote `AGENTS.md`, `CLAUDE.md`, `docs/roadmap.md` (the authoritative 13-phase list), ADR-001 through ADR-010. Initialized git.

### Phase 0 — Repository Bootstrap

- Monorepo skeleton: pnpm workspaces, `apps/api` (NestJS + Prisma), `apps/web` (Next.js), `packages/{types,validation,api-client,ui}`, `docker-compose.yml`, CI.
- Verified: `pnpm quality` passes end to end; both dev servers boot for real.

### Phase 1 — Tenant & Core Auth

- Prisma: `User`, `Tenant` (capability toggles), `TenantUser` (role), `TenantInvite`, `LoginCode`, `RefreshToken` (tenant-scoped, not just user-scoped).
- Business signup (G-01, separate from login), OTP login (G-05's exact numbers), tenant selection for multi-membership users (G-03), staff invites (G-02), global `JwtAuthGuard`+`RolesGuard`, refresh rotation, logout.
- Tests: 29 unit + 7 Testcontainers integration tests (including the cross-tenant isolation acceptance test — 404, not 403). Manually verified end-to-end against the real dev server first. `argon2` removed (no passwords anywhere).

### Phase 2 — Locations & Services

- Prisma: `Location` (IANA timezone, validated against the runtime's real tz database via `Intl.supportedValuesOf`), `BusinessHours` (one row per open period, split periods supported per plan §39), `Service` (per-service capability toggles).
- **Deliberate scope decision**: no separate `Staff` entity — `TenantUser` is sufficient, since the queue engine (Phase 3) already resolved to plain FIFO with no per-staff service-capability filtering (G-11). Documented in `docs/roadmap.md` so it isn't silently revisited.
- CRUD endpoints under `/tenants/me/locations` and `/tenants/me/services`, role-gated to `TENANT_OWNER`/`TENANT_ADMIN` for mutations, ownership-in-the-query throughout. Business hours use full-replace semantics (send the whole week each time), not a merge. Service creation cross-checks the referenced location's ownership (404, not 400, for someone else's location — consistent with Phase 1's invite pattern).
- Tests: 13 unit + 5 Testcontainers integration tests (cross-tenant isolation on both resources, the location→service ownership cross-check, split-hours round-trip, STAFF blocked from creating a location). Manually verified end-to-end first (two real businesses, real timezone validation, real cross-tenant 404s) before writing the automated tests.
- `pnpm quality` passes end to end (build, format, lint, typecheck, 42 unit + 12 integration tests total across the project so far).

## Decisions Made

See `docs/plan-review.md` (D-01–D-16) and `docs/adr/` for the formal ADRs. Additions made during implementation, not yet folded into either: `RefreshToken` scoped by `tenantId` as well as `userId` (Phase 1); no separate `Staff` entity for now (Phase 2, see above).

## Known Issues

- `packages/api-client` and `packages/ui` are still empty shells — no web UI consumes any API endpoint yet. This is genuinely due soon (Phase 4's Customer Queue UI is the first phase that needs a real frontend), not indefinitely deferred.
- Real SMS/email provider (Pingram) not yet integrated — `MailService` is `ConsoleMailService` (logs to stdout). Phase 8's job.
- Network-level rate limiting (G-38, Redis/Upstash-backed) not yet wired — OTP attempt-lockout is implemented and tested; per-IP/hour throttling is deferred to Phase 12 (Hardening), as scoped.
- No password reset flow exists anywhere, by design — there are no passwords.

## Next Task

**Phase 3 — Queue Domain**, per `docs/roadmap.md` — the highest-risk phase in the whole plan (see `docs/plan-review.md` §5):

1. Prisma schema: `Queue` (tenantId, locationId, name, status: ACTIVE/PAUSED/CLOSED per G-16), `QueueService` (join, D-04 — one queue per location, many services attached), `QueueEntry` (ticket number, status, position is **computed on read, never stored** per G-13, `joined_at`/`called_at`/`started_at`/`completed_at`/`cancelled_at`, `version` for optimistic locking per ADR-006, `assigned_staff_id` referencing `TenantUser`).
2. The full state machine (G-15): `WAITING → CALLED → SERVING → COMPLETED`, plus `SKIPPED → WAITING` (requeue, same ticket number, fresh `joined_at`), `CALLED → CANCELLED`, and "recall" as a notification resend rather than a state change.
3. Ticket-number allocation (G-10): atomic counter per queue, reset at location-local midnight — this is where `Location.timezone` (Phase 2) first actually gets consumed, not just stored.
4. Call Next: `SELECT ... FOR UPDATE SKIP LOCKED` via `$queryRaw` (ADR-006) — two simultaneous requests must never select the same entry. This needs a genuine concurrency integration test (two parallel requests against a real Postgres), not just sequential ones.
5. Position/estimated-wait formulas exactly as specified in G-11/G-12: plain FIFO count of `WAITING` entries ahead; `ceil(sum(durationMinutes ahead) / max(1, servingCapacity))`.
6. Idempotency keys for joining (G-21) — reuse Phase 1's unique-column-plus-race-fallback pattern.
7. End-of-day/staff-controlled closing (G-16): closing a queue blocks new joins; remaining `WAITING` entries auto-cancel with a notification stub (real notification is Phase 7 — a mock/log call is fine here).
8. Max-active-tickets enforcement (G-34): 1 per queue, 2 per location, tenant-adjustable.

No customer-facing or staff-facing UI yet (that's Phases 4–5) — this phase proves the engine via API + tests only, matching the plan's own "prove the engine before building screens" instinct.

Acceptance: a queue entry can be created via a seeded test path; duplicate active entries are controlled; position is correct; concurrent Call Next cannot select the same entry (proven with an actual concurrent integration test); invalid transitions fail; closing the queue blocks new joins. Cross-tenant isolation integration-tested the same way as Phases 1–2.
