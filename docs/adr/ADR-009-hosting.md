# ADR-009: Hosting and Deployment — Hobby Phase

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-05, D-07, G-42, G-44

## Context

budget-terry's free-tier pattern (Render + Neon + Vercel, all free) doesn't transparently transfer —
free-tier cold starts and idle scale-down are fine for a personal budgeting app, not obviously fine
for a queue app used live during trading hours. The user made a deliberate, informed choice anyway.

## Decision

- **Render (API) + Vercel (web), free tier, deliberately**, for this hobby/sample phase. Known
  trade-off accepted: cold starts up to ~30s, SSE connections may drop on idle scale-down.
- **Trigger to revisit:** the moment a real business is expected to depend on this during trading
  hours — move to a paid always-on tier (Render Starter ~US$7/mo, or Fly.io) before that happens,
  not after.
- **Domain: `q.m9rcy.dev`** — a subdomain of an already-owned domain, no new registration. The
  resolver path can drop the redundant `/q/` segment (`q.m9rcy.dev/{code}` directly) since the
  subdomain already signals "queue."
- **Infrastructure language aligned to this reality** — no Kubernetes/OpenShift/Helm framing in any
  doc; single container is the actual target (G-42).
- **Public display deployment:** a fullscreen browser tab on whatever screen the business has (a
  smart TV's own browser, or a spare tablet/laptop HDMI'd to a TV) — no special hardware (G-44).

## Alternatives

- Paid always-on from day one — safer, but unnecessary spend before any real business depends on it;
  explicitly deferred rather than silently skipped.

## Consequences

- No formal availability target or on-call rotation for now (G-43) — acceptable at this phase, stated
  explicitly rather than assumed.
- Backup/restore verification should happen once Phase A carries real data, not left until a later
  hardening phase (G-41).
