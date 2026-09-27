# ADR-008: Notification Strategy — Email-First, Provider Abstraction

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-03, G-29, G-30, G-31, G-32

## Context

NZ SMS costs roughly 5–9c per message; at even modest volume this is real recurring spend, while
the project is currently in a cost-conscious hobby/sample phase.

## Decision

- **Email is the default notification channel** for the hobby phase — free, sidesteps the cost
  problem entirely for now.
- **Pingram** (pingram.io) identified as the likely provider — a single API for both email and SMS,
  free tier (3,000 emails + 100 SMS/calls per month, no card), $20/mo Pro beyond that. Sits behind
  the `NotificationProvider` interface either way, so switching providers later is a config change,
  not a rewrite. **Verify actual NZ-destination SMS pricing on Pingram's pricing page before relying
  on the free tier for real sends** — the advertised free allowance is described as "100 SMS to the
  US," NZ pricing isn't confirmed.
- **Notification channel is customer-selectable** (SMS vs Email), defaulting to Email — only
  meaningful for signed-up customers who have both on file. Anonymous walk-ins only ever gave a
  phone number, so SMS is their only option by construction. Guest-card users (ADR-005) get nothing.
- **Notification sending never blocks a queue operation** — outbox pattern: the transaction that
  updates queue state also writes an outbox row; a background worker sends it. Threshold
  re-evaluation (approaching/called) runs inside the same transaction as the mutation, persists
  `*_SENT` flags so nothing double-fires.
- **Per-tenant SMS cap and kill switch** — good practice once real SMS spend starts (Phase 8), not
  urgent while email is the default.

## Alternatives

- SMS-first (as the original plan implied) — rejected for now on cost grounds specific to this
  project's current phase; can flip per-tenant later without any architecture change.
- Two separate vendors (Resend for email, a dedicated SMS API for SMS) — still viable if Pingram's
  NZ SMS pricing doesn't check out; the `NotificationProvider` interface doesn't care either way.

## Consequences

- Compliance specifics (sender ID, STOP-handling, delivery receipts) depend on whichever SMS
  provider is finalized — revisit at Phase 8 when that's chosen (G-30).
- Consent text is versioned and recorded at signup/join from day one (G-48), even before real legal
  copy exists — the structural requirement is decided now, the actual copy comes before any real
  business's customer data is collected.
