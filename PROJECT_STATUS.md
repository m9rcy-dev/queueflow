# Project Status

Last Updated: 2026-09-27
Current Phase: Phase 0 — Repository and Architecture Skeleton
Current Task: See Next Task below

## Completed

### Phase -1 — Planning and Architecture Review

- Reviewed `docs/QueueFlow_Detailed_Plan.md` and `docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md` end to end against a working baseline (`/Users/m9rcy/dev/ai/budget-terry`).
- Wrote `docs/plan-review.md` — a full gap/contradiction review (H-/C-/D-/G- numbered items) and worked through every item in discussion with the user. All D-01–D-16, C-01–C-07, and G-01–G-51 resolved except G-22–24 and part of G-26 (appointment-engine specifics, deliberately deferred to Phase C) and G-53 (kiosk station config screen, deferred to Phase B).
- Key decisions locked in: NestJS + Prisma + PostgreSQL + Next.js stack (D-01); MVP = queue + display + notifications only, appointments/analytics/multi-location deferred (D-02); OTP-only auth, email-first for staff, trusted-device + per-staff-PIN for shared counter devices (D-03/D-03a); one queue per location with services attached (D-04); Render + Vercel free tier for the hobby phase (D-05); single API instance + Redis (Upstash) adopted from day one (D-06); domain `q.m9rcy.dev` (D-07); capped `PROJECT_STATUS.md` format, this file (D-08); a full customer-identity/kiosk/counter-hardware subsystem — tenant-scoped accounts, a unified `code` model (context codes, personal identity codes, numbered guest cards, appointment tickets), and the physical counter layout (D-09–D-16, §4.5 of the review).
- Created `AGENTS.md` (canonical agent instructions) and `CLAUDE.md` (pointer to it).
- Initialized git repository.

### Phase 0 — Repository Bootstrap (in progress)

- Created the monorepo skeleton: pnpm workspaces, root `package.json` with quality-gate scripts, `.gitignore`, `.nvmrc`, shared `tsconfig.base.json`, `.prettierrc.json`.
- `docker-compose.yml` (local Postgres + local Redis for dev — Upstash is only used in deployed environments, per ADR-002).
- `.env.example` covering both apps.
- Scaffolded `apps/api` (NestJS + Prisma) and `apps/web` (Next.js) — see below for what's actually wired up vs. still a placeholder.
- Scaffolded `packages/{types,validation,api-client,ui}` as empty buildable packages, ready for Phase 1 to fill in.
- Wrote ADR-001 through ADR-010 under `docs/adr/` covering the major decisions from the plan review.

## Decisions Made

See `docs/plan-review.md` for the full log (D-01 through D-16) and `docs/adr/` for the formal ADRs. Nothing new decided outside those two documents — this file doesn't duplicate them.

## Known Issues

- The Prisma schema is intentionally near-empty at this stage — no domain models (Tenant, Queue, Customer, etc.) yet. That's Phase 1's job (Identity and Tenant) and Phase 2/3 after it, not Phase 0's. Don't add domain models before Phase 1 actually starts.
- `packages/api-client` and `packages/ui` are empty shells (a placeholder export each) — they exist so the workspace resolves and builds, not because they have real content yet.
- No CI secrets/deployment configured yet — `.github/workflows/ci.yml` runs the quality gate on push/PR only, no deploy step.
- Real SMS provider (Pingram or otherwise) not yet integrated — `NotificationProvider` is mocked. See ADR-008.

## Next Task

**Phase 1 — Identity and Tenant**, per the plan's phase order (`docs/QueueFlow_Detailed_Plan.md` §88, Phase 1) and this repo's conventions (`AGENTS.md` §2):

1. Prisma schema: `Tenant`, `TenantUser` (with role), `LoginCode` (mirroring budget-terry's shape — `codeHash`, `expiresAt`, `consumedAt`, `attempts`), `RefreshToken`, `DeviceTrust`.
2. Business signup flow (G-01): business name + owner name + email → OTP verify → capability selection (`Queue`/`Appointment` toggles, `QR Management`/`Dashboard` always-on) → first-run setup wizard stub.
3. Staff invite flow (G-02): owner invites by email → token + role + expiry → OTP → membership.
4. Global `JwtAuthGuard` with `@Public()` opt-out — every route protected by default, matching budget-terry's ADR-011 pattern.
5. Tenant context on the access token (G-03); tenant-selection step if a user has more than one membership.
6. Trusted-device + per-staff-PIN mechanism for shared counter devices (D-03a) — reuse budget-terry's `docs/trusted-device-plan.md` shape for the device-trust token, PIN switching is new.

Acceptance: admin can sign up a business and log back in via OTP; a user can only access their own tenant's data; unauthorized tenant access is rejected with an explicit integration test; role permissions are tested.
