# ADR-014: Authenticator App Login (TOTP) as an Optional Primary Method

**Status:** Accepted
**Date:** 2026-10-04
**Amends:** ADR-004 (OTP-only authentication)
**Related:** plan-review.md G-05, G-39, D-03, D-09

## Context

ADR-004 made login OTP-only with no passwords: a 6-digit code emailed to staff or customers. The user
asked for a second way to get that code: a time-based code from an authenticator app (Google
Authenticator, Microsoft Authenticator, etc.), chosen per account in the user's preferences. The
decisions below were made with the user on 2026-10-04.

Authenticator apps are usually a _second_ factor next to a password. QueueFlow has no password, so
the question was whether this replaces the emailed code or adds to it.

## Decision

**Optional primary method, email always available.** An account's login method is either the
emailed code (default) or an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30-second
steps). With the authenticator on, requesting a login code sends no email. "Email me a code
instead" (`forceEmail`) always sends one, so a lost phone never locks anyone out.

This is a **convenience, not extra security**: anyone who controls the inbox can still log in,
exactly as today. A true second factor ("authenticator only", email fallback off, mandatory
recovery codes) is a possible later option, e.g. for owners. It isn't built.

**For everyone, by their own setting.** Both staff (`User`, one credential across all their
businesses) and customers (`Customer`, one per business, D-09, so the app shows
"QueueFlow (Business name)").

**Storage.** One `AuthenticatorCredential` table owned by exactly one of a user or a customer. The
base32 secret is **encrypted** with AES-256-GCM (`AUTHENTICATOR_ENCRYPTION_KEY`, 32 bytes base64),
not hashed, because the server needs it to compute codes. Production refuses to boot without the
key; development uses a fixed, public key.

**Setup.** Only while logged in. Setup issues a _pending_ secret (QR from an `otpauth://` link,
plus the key for manual entry). It becomes active only after the user enters a first correct code.
Setting up a new phone leaves the old one working until the new one is confirmed. Turning it off
needs no code, so someone who lost their phone can sign in by email and switch back.

**Verification.** One code box accepts either kind of code. The authenticator is checked first,
then the latest emailed code. In that order, typing authenticator codes never burns the emailed
code's attempts.

- Authenticator codes are accepted for the current step ±1 (about 30s of clock drift), compared in
  constant time.
- Replay protection: a step is accepted only if it is later than the last one used, claimed with a
  guarded update, so even a concurrent replay succeeds once.
- Lockout: 5 failures lock the authenticator for 15 minutes, counted separately from emailed-code
  attempts. A failure only counts when the emailed code didn't match either. The emailed code keeps
  working during a lockout, so someone hammering a stranger's account can't lock them out.

**No enumeration signal (G-05).** The request endpoint responds identically whatever the account's
method. The code screen always says "from your authenticator app, or the one we emailed", with
"Email me a code instead" beneath.

**Code entry UX.** Every code box (staff login, customer login, setup confirmation) is one shared
component. It submits as soon as it holds 6 digits, typed or pasted (spaces and dashes are
stripped), sets `autocomplete="one-time-code"` so phones can offer emailed codes, ignores input
while a check is in flight, and shows a hint that it auto-submits (WCAG 3.2.2).

**Unchanged:** shared counter tablets still use trusted-device + PIN switching (D-03a); the PIN is
not a login code and is out of scope.

## Consequences

- A new production secret to manage (`AUTHENTICATOR_ENCRYPTION_KEY`). Losing it makes every stored
  secret undecryptable; affected users fall back to emailed codes and set the app up again. The
  `v1.` ciphertext prefix leaves room for key rotation.
- TOTP is hand-rolled on `node:crypto` (about 60 lines) rather than taken from a library. It's
  pinned by RFC 6238's own test vectors in `totp.spec.ts`.
- Customers using several businesses get several app entries. That's acceptable, and follows from
  D-09.
