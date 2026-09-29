# ADR-004: Authentication Strategy — OTP-Only

**Status:** Accepted
**Date:** 2026-09-27
**Related:** plan-review.md D-03, D-03a, G-02, G-05–G-09

## Context

Passwords are a friction point for both staff and customers in a walk-in retail/service context.
The user directed OTP-only, no passwords, from the outset — this ADR records the resulting design,
superseding the original plan's §41 (which specified email/password for MVP).

## Decision

- **Staff/admin: email OTP.** 6-digit code, 10 min expiry, single-use, invalidated after 5 failed
  attempts, 60s resend cooldown, max 5 codes/email/hour, constant response regardless of whether the
  email exists (no user-enumeration signal). Mirrors budget-terry's `LoginCode` model exactly
  (`codeHash`, `expiresAt`, `consumedAt`, `attempts`).
- **Staff invite:** owner invites by email → invite row (token + role + expiry) → invitee OTPs in →
  membership created. Revoke and re-invite supported.
- **Shared counter tablets: trusted device + per-staff PIN** (D-03a). The device trusts itself once
  (long-lived token, reusing budget-terry's `docs/trusted-device-plan.md` shape); each staff member
  then switches via a short PIN rather than re-doing email OTP every shift change. Every queue action
  attributes to the acting staff member (`assigned_staff_id`/audit field), not just "the device."
- **Session/token transport:** JWT access token + opaque rotating refresh token, Bearer, same shape as
  budget-terry's ADR-011 — chosen for native-app readiness and parity. Staff access tokens: 60 min
  (longer than budget-terry's 15, since staff are mid-shift) + 30-day refresh.
- **Display auth:** none. The public TV is unauthenticated, reads a rotatable public code from its
  URL. No `DISPLAY_ONLY` role.
- **Customer phone verification before joining: no.** Rate limiting + optional invisible Turnstile
  instead — the join notification itself is the proof the contact info is real.
- **Customer accounts (Phase 9, D-09): email OTP, same mechanism as staff, but a completely separate
  credential.** `Customer` is the login-capable entity directly — no `TenantUser`-style membership
  split, since a customer account never spans tenants (unlike staff, whose `User` can hold several).
  Tokens are minted by a separate `'customer-jwt'` passport strategy (distinct from staff's `'jwt'`,
  which the global `JwtAuthGuard` uses) with a `type: "customer"` discriminator in the payload as
  defense-in-depth, so a customer token can never be accepted by a staff route or vice versa even if
  both happened to share a JWT secret and a `sub`/`tenantId` shape. `CustomerLoginCode`/
  `CustomerRefreshToken` mirror `LoginCode`/`RefreshToken` exactly.

## Alternatives

- Passkeys/WebAuthn — explicitly descoped, much larger undertaking than the actual need here.
- httpOnly cookies instead of Bearer — stronger against XSS, but loses native-app-readiness and
  cross-origin simplicity; offset with a strict CSP instead.

## Consequences

- No password reset flow to build, ever — OTP replaces it entirely.
- Shared-device PIN switching requires a `staff.pin_hash` field and a lightweight lockout policy on
  repeated bad attempts — not yet designed in detail, needed before Phase 1's staff-device work lands.
