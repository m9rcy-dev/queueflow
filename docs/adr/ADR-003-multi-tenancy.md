# ADR-003: Multi-Tenancy Strategy

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md G-01, G-03, G-04

## Context

QueueFlow is multi-tenant SaaS even at hobby-phase scale (one business today, more later). Tenant
isolation must be enforced server-side from the first migration — never trust a tenant ID supplied
by the browser.

## Decision

- **Shared schema, `tenant_id` on every tenant-owned table**, not schema-per-tenant or Postgres RLS.
- **Enforcement happens in the query itself** — `findFirst({ where: { id, tenantId } })` — never
  fetch-then-check. This is budget-terry's proven pattern; it caught real cross-tenant bugs there.
- **Business signup is a separate entry point from customer signup** (G-01) — business name, owner
  name, email → OTP → capability selection (`Queue`/`Appointment` toggles) → setup wizard.
- **Tenant context lives on the access token.** A user with more than one tenant membership
  (multi-location staff) gets a tenant-selection step after OTP; switching tenant re-issues the token.
- **Customer identity is tenant-scoped, not global** (D-09) — one account per business, visible
  across every location under that tenant. No cross-tenant customer directory.

## Alternatives

- Postgres Row-Level Security — a legitimate later hardening layer, not needed for MVP; adds
  operational complexity (role-per-request, policy testing) disproportionate to current scale.
- Schema-per-tenant — operationally heavy for a single-tenant-today hobby project; premature.

## Consequences

- Every new resource needs an explicit cross-tenant isolation integration test from the day it's
  built (AGENTS.md §5), not added later.
- RLS remains available as a defense-in-depth addition before any real multi-tenant production launch.
