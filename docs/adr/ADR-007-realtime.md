# ADR-007: Realtime Strategy — SSE, Single Instance, Redis From Day One

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-05, D-06, G-27, G-28

## Context

Queue position, staff dashboard, and public display all need near-real-time updates. The original
plan allowed deferring Redis pub/sub "until needed" behind an interface.

## Decision

- **Server-Sent Events (SSE)**, not WebSockets — one-directional server→client is all that's needed.
- **Single API instance for MVP**, explicit constraint, not an accident of the free hosting tier.
- **Redis (Upstash) adopted now**, not deferred — it earns its place immediately as the rate-limiting
  backend (ADR-002) even before a second instance ever exists, so wiring the event-publisher through
  it costs nothing extra and removes a future migration step entirely.
- **SMS/Email is the primary notification channel, the live page secondary** — a phone locked in a
  pocket is exactly when "you're next" needs to land as a text/email, not a live page update. Client
  refetches current state on `visibilitychange`/focus and on any reconnect; never assumes it caught
  every event in between.
- **PWA + Web Push** (ADR-010) is a genuine near-term complement for signed-up customers who install
  it, not just a distant future idea.

## Alternatives

- WebSockets — rejected, no bidirectional need exists yet; would be introduced only if a concrete
  requirement demanded client→server push over the same channel.
- Defer Redis behind an interface — superseded once Upstash's free tier made "adopt now" free.

## Consequences

- No connection-budget number is fixed yet — deferred to real load testing rather than guessed
  (G-28), acceptable while single-instance/hobby-phase.
- Postgres remains the sole source of truth for queue state; Redis never becomes authoritative.
