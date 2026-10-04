# Phase 15 — Authenticator App Login (TOTP)

**Status:** Done (2026-10-04). Branch `feature/QF-015-authenticator-login` (from Phase 14's branch).
**Decisions:** ADR-014 (amends ADR-004). Agreed with the user before building:

- The authenticator is the _primary_ method when selected.
- The emailed code always remains as a fallback.
- It's available to staff and customers, each by their own setting.
- Every code box submits by itself once a full code is typed or pasted.

## What was built

**Schema** (`20261004090000_add_authenticator_credentials`): `AuthenticatorCredential`, owned by
exactly one of a `User` or a `Customer`. It holds the encrypted secret, a pending secret during
setup, `enabledAt`, `lastUsedStep` (replay protection), and a failure count with `lockedUntil`.

**API** (`apps/api/src/authenticator/`):

- `totp.ts`: RFC 6238 on `node:crypto` (base32, ±1 step drift, constant-time compare, `otpauth://`
  link builder).
- `authenticator-crypto.ts`: AES-256-GCM, versioned `v1.` format. `AUTHENTICATOR_ENCRYPTION_KEY` is
  required in production; development uses a fixed key.
- `AuthenticatorService`: setup (pending secret), confirm (first code), disable, `check` (lockout
  and a guarded replay claim), and `recordFailure`.
- Staff and customer login: `requestLoginCode` skips the email for authenticator accounts unless
  `forceEmail`. `verifyLoginCode` checks the authenticator first, then the emailed code, and counts
  an authenticator failure only when both miss.
- Endpoints: `GET/POST/DELETE /auth/me/authenticator` (+ `/setup`, `/confirm`) for staff, and the
  same under `/customers/me/authenticator` for customers.
- The retention purge deletes an anonymized customer's authenticator.

**Web:**

- `OtpCodeInput` in `@queueflow/ui`: one code box that auto-submits at 6 digits, tidies pasted
  "123 456"/"123-456", sets `autocomplete="one-time-code"`, guards against double submits, and
  shows a hint. The UI package's tsconfig gained the DOM lib, which a component library needs.
- Used in staff login, customer login, and authenticator setup. Both login screens use the same
  wording for either kind of code, with "Email me a code instead".
- `AuthenticatorSettings` (QR, grouped manual key, confirm, new phone, switch back) on a new
  `/admin/account` page (with an "Account" nav link) and in the customer portal.

## Tests

- Unit: `totp.spec.ts` (all 6 RFC 6238 SHA-1 test vectors, drift window, malformed input, secret
  round-trip, otpauth format), `authenticator-crypto.spec.ts` (4), and staff auth branches (+5): no
  email for authenticator accounts, `forceEmail` honoured, login on an authenticator code without
  touching emailed codes, failure counted only when both miss, emailed code accepted while locked.
  **279 unit total.**
- Integration: `authenticator.integration-spec.ts` (8), covering:
  - setup, including a wrong confirm code, pending until confirmed, and the secret not stored in
    plaintext;
  - login with no email sent, a replay rejected, and the request response identical for both
    account types;
  - the email fallback logging in;
  - lockout after 5 wrong codes while email still works;
  - the old phone working until the new one is confirmed;
  - turning it off;
  - customer login scoped to one business;
  - staff and customer tokens rejected on each other's routes.

  **112 integration total.**

- Manual, with both dev servers on mock providers: set up on `/admin/account` (QR plus grouped key;
  a spaced "547 207" auto-confirmed with no button press); logged out; requesting a code sent no
  email (row count unchanged); pasting "958 144" in one input event logged straight in; switched the
  demo account back to emailed codes afterwards.

## Not done / limitations

- There's no invite-acceptance screen in the web app (only the API client method), so the shared
  code box isn't used there; invites are accepted via the API today. Worth a small follow-up.
- The customer portal's settings panel is the same component verified on the staff account page,
  but it wasn't separately clicked through in the browser (customer login and portal routes are
  covered by integration tests).
- No "authenticator only" mode (email fallback off, recovery codes). Deliberately deferred per
  ADR-014.
- A user with the authenticator on still gets the emailed code by asking, so account security
  equals today's (email possession). That's by design.
