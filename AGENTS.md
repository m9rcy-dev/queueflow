# AGENTS.md — QueueFlow

Instructions for any AI coding session (or developer) working on this repository.
Applies to `apps/web`, `apps/api`, and every package under `packages/`.

---

## 1. Before You Start

Every session, in this order:

1. Read `docs/QueueFlow_Detailed_Plan.md` (the product/architecture baseline) and `docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md` (visual direction) — only the sections relevant to the task at hand; they're long, don't re-read cover to cover every session.
2. Read `docs/plan-review.md` — this is the **living decisions log**. Every D-/G-/C- numbered item there overrides the plan document where they conflict; the plan is the frozen baseline, this file is what actually got decided. Check it before assuming a gap is still open.
3. Read `docs/roadmap.md` — the **authoritative phase list**. It supersedes the plan document's own §88 phase numbering (that numbering predates the MVP cut and the customer-identity work). This is what "what phase are we on" actually means.
4. Read `PROJECT_STATUS.md` (current phase, current task, known issues).
5. Read any ADRs under `docs/adr/` relevant to the task at hand.
6. Inspect the existing implementation before writing new code — do not assume, check.
7. Run `git status` to see what's already in flight.
8. Run or inspect the current quality gate (`pnpm quality`).

Work only on the task listed under **Next Task** in `PROJECT_STATUS.md` unless there is a documented blocker. Do not rewrite working architecture without justification. Do not perform unrelated refactoring while completing a task.

---

## 2. Project Conventions (already decided — do not re-litigate without discussion)

These were decided across planning and a detailed plan review (`docs/plan-review.md`, IDs referenced below); this is the quick-reference summary so no session re-derives or contradicts them by accident.

- **Stack: NestJS + Prisma + PostgreSQL + Next.js, pnpm workspaces** (ADR-001, D-01). One language across web and API; shared `packages/{types,validation,api-client}`.
- **Modular monolith, not microservices.** Explicit domain modules (tenant, location, service, queue, customer, notification, auth…) inside one Nest app. No Kafka. No premature service extraction.
- **Multi-tenant from the first migration.** Shared schema, `tenant_id` on every tenant-owned table, enforced **in the query itself** (`findFirst({ where: { id, tenantId } })`), never fetch-then-check (ADR-003, G-04). Cross-tenant isolation gets explicit integration tests, not just code review.
- **One queue per location, many services attached** (D-04) — a `queue_service` join, `queue_entry.service_id` records which one the customer picked. All services in one location share one FIFO line. Plain FIFO position, no eligibility rules in MVP (G-11).
- **Auth is OTP-only, no passwords, ever** (ADR-004, D-03). Staff/business: email OTP (6-digit, 10 min TTL, 5 max attempts, 60s resend cooldown, 5 codes/email/hour — G-05). Trusted device + per-staff PIN for shared counter tablets (D-03a) — every queue action records the acting staff member, not just "the device." Customer accounts are tenant-scoped, not global (D-09) — one account per business, visible across every location under that tenant.
- **The `code` model is unified, not the plan's original QR-only framing** (§4.5 of the review, ADR-005). One resolvable concept spanning: `GENERAL/LOCATION/QUEUE/SERVICE/TABLE/APPOINTMENT/KIOSK/COUNTER` (place/business-owned, printed), `CUSTOMER_IDENTITY` (customer-owned, persistent), `GUEST_CARD` (location-owned, numbered pool, anonymous, recycled), `APPOINTMENT_TICKET` (appointment-owned, Phase C). One resolver, the scanning app branches on type. **Do not build a generalized capability/plugin registry** — this is the single biggest over-engineering risk in the whole plan (plan §9). Two toggleable capabilities only: `Queue` and `Appointment`. `QR Management` and `Dashboard` are always-on, not togglable.
- **Guest cards are individually numbered and tracked** (`guest_1`…`guest_N`, D-14), zero personal data, scan is idempotent (re-scan of an active card re-shows status, never duplicates — hard requirement, G-54), auto-released when the linked entry reaches a terminal state. No self-cancel for guest-card users — staff-assisted only.
- **Counter hardware, settled** (D-10): one scanner (reads guest cards or a signed-up customer's personal code, instant join, zero staff confirmation), a separate staff device (queue view + call next/cancel/manually-add), one public TV (ticket number only, **no names, no PII** — C-01). No separate unattended "kiosk terminal."
- **Queue concurrency:** `SELECT … FOR UPDATE SKIP LOCKED` via `$queryRaw` inside the Call Next transaction, plus a `version` column for optimistic locking on the transition itself (ADR-006, G-20). Two staff must never receive the same entry.
- **Realtime: SSE first, single API instance for MVP, Redis (Upstash) from day one** (ADR-007, D-06) — not deferred behind an interface, adopted now, because it also backs rate limiting (G-38). OTP codes still live in Postgres (`LoginCode`), not Redis.
- **Notifications: email is the default channel** (ADR-008, D-03/G-29) — free, avoids SMS cost during the hobby phase. Pingram identified as the likely single provider for both email and SMS (verify actual NZ SMS pricing before relying on it). Signed-up customers can prefer SMS; anonymous walk-ins only ever have a phone, so SMS is their only option by construction; guest-card users get nothing. Notification sending must never block a queue operation — outbox pattern, not synchronous send.
- **Hosting: Render (API) + Vercel (web), free tier, deliberately, for this hobby/sample phase** (ADR-009, D-05). Revisit and move to a paid always-on tier only when a real business is expected to depend on it during trading hours — not before. Domain: `q.m9rcy.dev`.
- **MVP boundary: queue + display + notifications only** (D-02). Appointments, historical analytics trends, multi-location, `PLATFORM_ADMIN`, barcode support, kiosk-mode camera scanning, i18n translation — all explicitly deferred. See `docs/plan-review.md` §1 "MVP scope" and Phase list below.
- **Money/rounding, idempotency-key patterns, ownership-in-the-query, archive-vs-hard-delete** — no domain-specific rules exist yet for QueueFlow the way budget-terry has for money; when a analogous situation arises (e.g. archiving a service with existing queue history), follow budget-terry's pattern (`/Users/m9rcy/dev/ai/budget-terry`) as prior art, don't invent a new convention from scratch.

---

## 3. Clean Code Rules

- Functions have one clear responsibility; keep methods short enough to understand at a glance.
- Prefer descriptive names over comments.
- Avoid hidden side effects, premature optimization, and unnecessary abstractions.
- No generic utility dumping grounds — shared logic goes in the package it actually belongs to.
- Keep domain/business rules independent of HTTP/controller concerns. Keep database access out of controllers. Keep business logic out of React components.
- Validate input at system boundaries (API request bodies via Zod DTOs), not defensively everywhere.
- Do not duplicate domain rules across web/api — shared rules live in `packages/`.
- Prefer composition over inheritance.
- Treat lint warnings as errors to fix, not noise. Delete dead code rather than commenting it out.
- Comments explain **why**, not what — if removing a comment wouldn't confuse a future reader, don't write it.
- **Do not build a generalized abstraction for a problem you don't have yet.** This plan's own biggest risk (see plan §9) is over-generalizing the QR/capability model before one queue works. The same discipline applies everywhere: build the concrete case, generalize only when a second real case demands it.

---

## 4. Documentation Requirements

- Public or non-obvious methods need a short doc comment covering purpose, inputs/outputs, errors, and important business rules — not restating the method name.
- Any change to behavior, architecture, configuration, or setup requires updating the relevant doc under `docs/` in the same change, not as a follow-up.
- New architectural decisions (not implementation details) get an ADR under `docs/adr/`, not just a mention in a commit message or chat. If a decision already has a D-/G-/C- entry in `docs/plan-review.md`, writing the ADR is transcription, not re-deciding.

---

## 5. Testing Requirements

- **Unit tests** cover domain/business logic heavily: queue state machine transitions, position/estimated-wait formulas, ticket-number allocation, notification threshold evaluation, OTP verification logic, tenant-scoping helpers.
- **Integration tests** use a real local Postgres via Testcontainers — verify migrations, repository behavior, constraints, and API validation. No mocking the database for these.
- **API tests** cover, per important endpoint: success, validation failure, not-found, conflict where applicable, and persistence verification.
- **Tenant isolation must be integration-tested explicitly** for every resource, from the first one built — a user/customer must never retrieve another tenant's data. This is not optional and not deferred.
- **Concurrency tests** for Call Next — two simultaneous requests must never select the same queue entry (G-20).
- **Idempotency tests** — replayed `Idempotency-Key` returns the same resource, doesn't duplicate (G-21); guest-card re-scan re-shows status, doesn't duplicate (G-54).
- **`pnpm quality` passing is necessary but not sufficient evidence the app actually runs.** budget-terry lost real time to `ERR_MODULE_NOT_FOUND` from shared packages being ESM with extensionless imports while Nest runs CJS — passing build/typecheck/Jest the whole time without ever booting. **Compile all shared packages as CommonJS** to match `apps/api`'s runtime, and **boot the real dev server at least once per phase** (`pnpm --filter @queueflow/api run start:dev`, and `apps/web`'s `dev` script when touched) — not just at the end of a long session.

---

## 6. Quality Gate

```bash
pnpm quality
# = build && format:check && lint && typecheck && test && test:integration
```

`build` runs first because workspace packages (`@queueflow/types`, `@queueflow/validation`) are consumed via their compiled `dist` output, not raw source.

This must pass before any task is considered done — never skip checks because a step seems redundant or slow.

---

## 7. Definition of Done

A task is complete only when:

- Acceptance criteria are satisfied.
- Unit and integration tests exist where applicable, and actually pass — never claim tests passed without running them.
- Linter, formatter, and type checking pass.
- The application builds, and the real dev server was actually booted (§5).
- Relevant documentation is updated.
- `PROJECT_STATUS.md` is updated (see §8).
- No known blocker is left unrecorded.

Full E2E coverage (Playwright) is reserved for the two critical journeys — the anonymous walk-in vertical slice, and (once built) the appointment check-in slice — not required on every phase. Every phase still needs unit + integration + API tests.

---

## 8. Resumable Development / End of Session

Before finishing any session:

1. Run the relevant tests, and the full quality gate where feasible.
2. Update `PROJECT_STATUS.md`: move completed work to **Completed** (one line, linking to `docs/status/phase-NN.md` for detail — do not write a changelog essay inline, budget-terry's `PROJECT_STATUS.md` grew to 104KB doing exactly that), record any new decisions under **Decisions Made** (or as a new ADR), write an exact **Next Task**, and record **Known Issues** honestly.
3. Leave the repository in a state where a new session can resume from `PROJECT_STATUS.md` alone, without needing prior chat history.
4. **Hard cap: `PROJECT_STATUS.md` stays under ~200 lines.** Detail goes to `docs/status/phase-NN.md`, decisions go to ADRs, history stays in git.

Prefer **one small, fully complete vertical slice** (API + database + UI + tests + docs for one feature) over multiple partially-implemented layers.

---

## 9. Git

```text
main
  └── feature/QF-xxx-description
```

Conventional commits: `feat(queue): ...`, `fix(auth): ...`, `test(notifications): ...`, `docs(adr): ...`.
