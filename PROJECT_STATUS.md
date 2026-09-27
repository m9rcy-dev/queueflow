# Project Status

Last Updated: 2026-09-27
Current Phase: Phase 2 — Locations & Services (see `docs/roadmap.md` — the authoritative 13-phase list, Phases 0–1 done)
Current Task: See Next Task below

## Completed

### Phase -1 — Planning and Architecture Review

- Reviewed `docs/QueueFlow_Detailed_Plan.md` and `docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md` end to end against a working baseline (`/Users/m9rcy/dev/ai/budget-terry`).
- Wrote `docs/plan-review.md` — a full gap/contradiction review (H-/C-/D-/G- numbered items) and worked through every item in discussion with the user. All D-01–D-16, C-01–C-07, and G-01–G-51 resolved except G-22–24 and part of G-26 (appointment-engine specifics, deliberately deferred to Phase C) and G-53 (kiosk station config screen, deferred to Phase B).
- Wrote `AGENTS.md`, `CLAUDE.md`, `docs/roadmap.md` (the authoritative 13-phase list), ADR-001 through ADR-010. Initialized git.

### Phase 0 — Repository Bootstrap

- Monorepo skeleton: pnpm workspaces, `apps/api` (NestJS + Prisma), `apps/web` (Next.js), `packages/{types,validation,api-client,ui}`, `docker-compose.yml` (local Postgres + Redis), CI, `.env.example`.
- Verified: `pnpm quality` passes end to end; both dev servers boot for real, all placeholder routes respond.

### Phase 1 — Tenant & Core Auth

- Prisma schema: `User`, `Tenant` (with `queueEnabled`/`appointmentEnabled` capability toggles, G-01), `TenantUser` (role: `TENANT_OWNER`/`TENANT_ADMIN`/`MANAGER`/`STAFF`), `TenantInvite` (with its own inline OTP fields, since an invitee may not have a `User` row yet), `LoginCode`, `RefreshToken` (tenant-scoped, not just user-scoped — a token issued for Tenant A must not silently refresh into Tenant B's context for a multi-membership user). Migration `add_tenant_and_auth` applied.
- Business signup (G-01): `POST /auth/business-signup` — business name + owner name + email → creates `User`+`Tenant`+`TenantUser(OWNER)` atomically → sends an OTP. A separate entry point from plain login, not an auto-detect-unknown-email flow; rejects an email that's already registered (409).
- OTP login: `POST /auth/login/request` (silent/generic response whether or not the email exists, G-05) + `POST /auth/login/verify` (6-digit code, 10 min TTL, 5 max attempts, then locked — G-05's numbers). Issues JWT access token (1h) + opaque rotating refresh token (30d) scoped to one tenant.
- Tenant selection (G-03): when a user has more than one `TenantUser` membership, verify returns a short-lived pending token + membership list instead of full tokens; `POST /auth/select-tenant` finishes the login once a tenant is chosen.
- Staff invites (G-02): `POST /tenants/me/invites` (owner/admin only) → `POST /auth/invites/:token/request` + `/verify` (OTP-gated acceptance) → creates the `User` (if needed) + `TenantUser` membership. Revoking and re-inviting the same email works (old pending invite is superseded).
- Global `JwtAuthGuard` (`@Public()` opt-out) + `RolesGuard` (`@Roles(...)`) registered as `APP_GUARD`s — every route protected by default. `JwtStrategy` re-checks the membership (and its current role) on every request rather than trusting the token's role claim, so a revoked membership or role change takes effect immediately, not after the token expires.
- Refresh rotation and logout implemented (revoke-on-rotate, budget-terry's ADR-011 pattern).
- Tests: 29 unit tests (`TokenService`, `AuthService` — every branch: unknown/wrong/locked-out codes, single vs. multi-tenant login, refresh rotation/revocation) + 7 Testcontainers integration tests against real Postgres, including the acceptance-critical cross-tenant isolation test (tenant A cannot see, revoke, or in any way address tenant B's invites — 404, not 403, indistinguishable from nonexistent) and the full staff-invite-accept-then-role-blocked flow.
- Verified manually end-to-end against the real dev server first (two real businesses signed up, real OTPs read out of the mock mail log, real cross-tenant isolation confirmed via `psql`) before writing the automated tests — not the other way around.
- `pnpm quality` passes end to end (build, format, lint, typecheck, 29 unit + 7 integration tests). No password anywhere in the system — `argon2` removed as a dependency (dead weight for an OTP-only system).

## Decisions Made

See `docs/plan-review.md` for the full log (D-01 through D-16) and `docs/adr/` for the formal ADRs. One small addition made during Phase 1 implementation, not yet in either: `RefreshToken` is scoped by `tenantId` as well as `userId` (a session belongs to one tenant context; switching tenants means logging in again via select-tenant, not an implicit refresh-time switch).

## Known Issues

- `packages/api-client` and `packages/ui` are still empty shells — no web UI consumes the Phase 1 auth endpoints yet (Phase 2 onward will need this).
- Real SMS/email provider (Pingram) not yet integrated — `MailService` is `ConsoleMailService` (logs to stdout). See ADR-008; Phase 8's job.
- Rate limiting (G-38's concrete numbers) is not yet wired to Redis/Upstash — OTP attempt-lockout (5 wrong tries) is implemented and tested, but network-level throttling (N requests per IP per hour) is deferred to Phase 12 (Hardening), as the roadmap already scopes it.
- No password reset flow exists anywhere, by design — there are no passwords.

## Next Task

**Phase 2 — Locations & Services**, per `docs/roadmap.md`:

1. Prisma schema: `Location` (tenantId, name, address, timezone), `BusinessHours` (locationId, dayOfWeek, opensAt/closesAt — support split periods per plan §39, so no one-row-per-day constraint), `Service` (tenantId, locationId, name, description, durationMinutes, active, queueEnabled, appointmentEnabled), `queue_service`-style join is actually N/A yet — that join is Phase 3's (queue-to-service), not this phase's.
2. Decide (don't defer silently): is a `Staff` profile a new entity distinct from `TenantUser`, or does Phase 2 only need location/service CRUD with staff-location-service assignment deferred to whenever it's actually consumed? The plan's §11 wants staff associated with locations and capable of specific services, but Phase 2's acceptance criteria below doesn't strictly require it yet — make a deliberate call at the start of that session rather than half-building it.
3. Admin endpoints: CRUD for locations and services, ownership-in-the-query scoped by tenantId (same pattern as Phase 1's `TenantsService`), role-gated to `TENANT_OWNER`/`TENANT_ADMIN`.
4. Continues the setup wizard from Phase 1's capability-selection step.

Acceptance: admin can create/edit a location and services; services can be enabled/disabled; a location has a timezone that later date/time logic (Phase 3's business-hours enforcement, G-16) will actually consult; cross-tenant isolation integration-tested the same way Phase 1's was.
