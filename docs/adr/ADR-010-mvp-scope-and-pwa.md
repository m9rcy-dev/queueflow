# ADR-010: MVP Scope Boundary, and PWA

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-02, G-49

## Context

The original plan's MVP is everything except billing — roughly 3–5x too large for solo,
session-bounded AI-assisted development. A boundary had to be drawn deliberately.

## Decision

- **MVP = queue + display + notifications only** (plan Phases 0–8). Deferred: appointments (Phases
  9–10), historical/trend analytics (Phase 11 — a live "today" dashboard ships with MVP, the trend
  analysis doesn't), multi-location beyond what one tenant naturally has, `PLATFORM_ADMIN` console,
  barcode support (cut entirely, QR/manual short-code covers the same resilience), i18n translation
  (a `t()` wrapper ships now, English-only content).
- **The three-phase customer-identity split** (plan-review.md G-57): Phase A (accounts, identity
  codes, portal, no new hardware) → Phase B (kiosk scanner hardware + guest-card pool) → Phase C
  (appointment engine + appointment-ticket check-in).
- **Build the app as an installable PWA** — manifest + service worker, from early on rather than
  bolted on later. Concretely useful here, not just generically nice: Web Push offsets SMS cost
  (ADR-008) for signed-up customers who install it; fullscreen/no-browser-chrome suits the counter
  staff device and public TV (ADR-005); offline/cache resilience helps the SSE reliability gaps
  (ADR-007); ships without app-store review, fitting the solo development pace.

## Alternatives

- Build the full plan's MVP as originally scoped — rejected, would take many months of
  session-bounded work before any real pilot is reachable.
- Native app now — rejected, explicitly future per the plan's own stated shape (browser + mobile
  browser now, native later); PWA covers most of the near-term ambition at near-zero cost.

## Consequences

- Every phase in `PROJECT_STATUS.md`'s roadmap should be sized to roughly one session, ending green
  on the quality gate — not the original plan's much larger per-phase grouping.
- Appointments, once Phase C actually starts, already have a partial spec captured (business
  calendar view with day-count drill-down, cancel-with-reason, a default max-appointments-per-day
  cap, per-tenant advance-booking-window) — see plan-review.md §5.5 addendum — so that work isn't
  starting from nothing.
