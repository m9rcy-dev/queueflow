# ADR-002: PostgreSQL + Prisma, Redis (Upstash) for Pub/Sub and Rate Limiting

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-01, D-06

## Context

Stack choice needed to be made together: NestJS pairs naturally with either Spring-style JPA or a
TypeScript ORM. See ADR discussion in plan-review.md §7 for the full reasoning — summarized here.

## Decision

- **PostgreSQL** is the single source of truth for all domain state. Never Redis.
- **Prisma** as the ORM/migration tool, matching budget-terry's proven setup (Testcontainers
  integration harness, `pnpm quality`, seed scripts all directly reusable).
- **Redis (Upstash free tier)** adopted from day one, not deferred behind an interface. Two uses:
  (1) the event-publisher/SSE fan-out layer, so a second API instance is a non-event later; (2) the
  backend for rate limiting (atomic increment+expire), which benefits even a single instance.
- **Local dev uses Docker Postgres + Docker Redis, never Upstash directly** — same discipline as
  budget-terry's "local Docker Postgres, never Neon directly."

## Alternatives

- Defer Redis entirely, single-instance-only interface (the original plan-review recommendation) —
  superseded once a genuinely free, adequate Redis tier (Upstash) was identified; no reason to defer
  something free that also solves rate limiting today.
- Drizzle/Kysely instead of Prisma — would express `FOR UPDATE SKIP LOCKED` (ADR-006) natively, but
  loses budget-terry's directly-copyable migration/seed/Testcontainers tooling. Not worth it.

## Consequences

- Prisma has no first-class `FOR UPDATE SKIP LOCKED` — handled via `$queryRaw` in the two places that
  need it (Call Next selection, ticket-number allocation). See ADR-006.
- Compile shared `packages/*` as CommonJS, not ESM — budget-terry lost real time to
  `ERR_MODULE_NOT_FOUND` getting this wrong (AGENTS.md §5).
