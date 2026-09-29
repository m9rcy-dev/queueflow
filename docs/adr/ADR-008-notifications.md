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
  free tier (3,000 emails + 100 SMS/calls per month, no card), $20/mo Pro beyond that. **Verify actual
  NZ-destination SMS pricing on Pingram's pricing page before relying on the free tier for real
  sends** — the advertised free allowance is described as "100 SMS to the US," NZ pricing isn't
  confirmed.
- **Email and SMS are independently swappable, not one combined interface** (revised at Phase 8,
  2026-09-29) — `EmailProvider` and `SmsProvider` are two separate abstract classes, each with its
  own config switch (`EMAIL_PROVIDER`/`SMS_PROVIDER`, values `mock`/`pingram`), rather than a single
  `NotificationProvider` branching on channel internally. A business could end up using Pingram for
  email and a different vendor for SMS (or vice versa) without touching `NotificationsService` or
  either provider's own class — adding a new vendor for one channel is a new provider class plus one
  more branch in `notifications.module.ts`'s factory, never a change to the other channel or to
  anything that calls `send()`. Selecting an unimplemented value for either switch fails loudly at
  application startup (a clear error naming the bad value) rather than silently falling back to mock
  — a production misconfiguration should never be mistaken for "it's actually sending."
- `PingramEmailProvider` is Phase 8's real implementation (`POST https://api.{region}.pingram.io/email`,
  `Authorization: Bearer <PINGRAM_API_KEY>`); `SmsProvider` only has `MockSmsProvider` so far — real
  SMS is deliberately still a later adapter (see below), and picking `SMS_PROVIDER=pingram` (or
  anything but `mock`) throws at boot rather than pretending to work.
- **Pingram's account data is regional** (`us`/`eu`/`ca`, each a genuinely separate host —
  `api.pingram.io`, `api.eu.pingram.io`, `api.ca.pingram.io`) — discovered the hard way during live
  verification: a real, valid key 404'd with "Account not found" against the default `us` host, and
  succeeded immediately against `eu` once that was confirmed as the account's actual region (checked
  against Pingram's own Node SDK source, which encodes exactly this host map). `PINGRAM_REGION` (new
  env var, defaults `us` to match Pingram's own SDK default) selects the host; an unrecognized value
  throws rather than silently hitting the wrong one.
- **Notification channel is customer-selectable** (SMS vs Email), defaulting to Email — only
  meaningful for signed-up customers who have both on file. Anonymous walk-ins only ever gave a
  phone number, so SMS is their only option by construction. Guest-card users (ADR-005) get nothing.
- **Notification sending never blocks a queue operation** — outbox pattern (built Phase 7): the
  transaction that updates queue state also writes an outbox row; sending itself is a fire-and-forget
  pass afterward, never awaited by the request. Threshold re-evaluation (approaching/nearly-next/
  called/recalled) runs inside the same transaction as the mutation, persists `*NotifiedAt` timestamps
  so nothing double-fires.
- **Per-tenant SMS cap and kill switch** — good practice once real SMS spend starts (a real
  `SmsProvider` implementation), not urgent while only `MockSmsProvider` exists.

## Alternatives

- SMS-first (as the original plan implied) — rejected for now on cost grounds specific to this
  project's current phase; can flip per-tenant later without any architecture change.
- One combined `NotificationProvider` interface branching on channel internally — rejected at Phase 8
  in favor of two independent interfaces (see Decision above), specifically so email and SMS vendors
  can be swapped one at a time.

## Consequences

- Compliance specifics (sender ID, STOP-handling, delivery receipts) depend on whichever SMS
  provider is finalized — revisit once a real `SmsProvider` is built, not before.
- Consent text is versioned and recorded at signup/join from day one (G-48), even before real legal
  copy exists — the structural requirement is decided now, the actual copy comes before any real
  business's customer data is collected.
- **Verified 2026-09-29**: a real email, sent through the live Pingram API with a real account key
  (region `eu`), was received. `PingramEmailProvider`'s wiring, auth, region selection, and error
  handling are all confirmed correct against the real service, not just mocks.
- Today, every queue notification is SMS-channel by construction (anonymous walk-ins only ever supply
  a phone — see G-32) — until Phase 9's customer accounts capture a real email address, switching
  `EMAIL_PROVIDER=pingram` wires up real email sending but has no live queue traffic to exercise it.
  `PingramEmailProvider` is still fully built and unit/integration-tested (including a real customer
  record with an email set directly, proving the EMAIL-channel routing itself), just not yet reachable
  through the anonymous join flow.
