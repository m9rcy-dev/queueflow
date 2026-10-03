# ADR-011: Strict CSP on the Web App via Dynamic Rendering

**Status:** Accepted
**Date:** 2026-10-03
**Related:** plan-review.md G-08, G-41

## Context

G-08 resolved Bearer-token auth over httpOnly cookies, paired with "a strict CSP to offset
Bearer's XSS exposure." The API (`apps/api`) already gets a strict CSP for free from `helmet()`.
But the thing G-08 is actually protecting — the access/refresh token — lives in the **web app**'s
`localStorage` (`staff-api-client.ts`, `customer-api-client.ts`), not on the API. An XSS bug would
be exploited in the browser tab running `apps/web`, so that's where the CSP has to be strict; the
API's helmet CSP barely matters to this threat model since the API never renders attacker-reachable
HTML.

`apps/web` (Next.js 14 App Router) had no CSP, and no security headers at all, before this.

## Decision

- Strict, nonce-based CSP via `apps/web/src/middleware.ts`, following Next.js's own documented
  pattern: a fresh nonce per request, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src`
  likewise, `object-src 'none'`, `frame-ancestors 'none'` (stricter than the API's `'self'` — this
  app has no legitimate reason to ever be iframed), `form-action 'self'`, `connect-src 'self'
<API origin>` (the API lives on a different origin, so `default-src 'self'` alone would silently
  break every fetch/EventSource call).
- **`export const dynamic = "force-dynamic"` on the root layout.** Next.js only injects a nonce
  into a page's own script/style tags during server-side rendering — a statically-prerendered page
  has no request to read the nonce from at build time, so every script on it ships with no nonce
  and the browser blocks all of them, API server scripts included. This was caught by actually
  booting a production build and loading it in a real browser, not by reading the header — the
  first version of this CSP looked correct in a `curl` response and **broke the entire app** the
  moment a real page tried to run its own JS.
- Dev-mode gets `'unsafe-eval'` (script) and `'unsafe-inline'` (style) added to the policy — Next's
  webpack HMR / React Refresh needs both and dev-mode CSP correctness doesn't matter the way
  production does.
- Static security headers that don't need a per-request nonce (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) are set separately in
  `next.config.mjs`'s `headers()` — simpler than threading them through middleware too.

## Alternatives

- `script-src 'self' 'unsafe-inline'` (skip nonces entirely) — considered after the first version
  broke the app, rejected once the actual fix (force-dynamic) was found: `'unsafe-inline'` allows
  exactly the DOM-injected-`<script>` style of XSS that G-08 is trying to mitigate, so it would have
  satisfied "ship a CSP header" without satisfying the actual goal.
- Leave CSP only on the API (status quo) — rejected once it was clear the token being protected
  doesn't live there.

## Consequences

- Every route in `apps/web` is now server-rendered per-request rather than statically prerendered
  at build time. Acceptable here: almost every page already needs runtime data (auth-gated admin
  screens, live queue/ticket state) and the app is low-traffic enough (single pilot tenant) that
  static-generation's caching benefit was marginal anyway.
- Any future third-party script/style/font added to the web app must be explicitly allow-listed in
  `middleware.ts`'s CSP string, or it will be silently blocked in production — verify with a real
  production build + browser load (`pnpm build && pnpm start`), not just a `curl` of the headers,
  exactly as this ADR's own first attempt would have passed a header-only check while shipping a
  broken app.
