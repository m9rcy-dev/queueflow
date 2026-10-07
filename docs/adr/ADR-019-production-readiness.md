# ADR-019: Production Readiness for the First Deploy

**Status:** Accepted
**Date:** 2026-10-07
**Related:** ADR-009 (hosting), ADR-018 (platform onboarding), D-06 (single instance), G-29 (SMS)

## Context

Phase 20 puts QueueFlow online. A release audit found the code was ready for local use, not for
the internet:

- **Settings that weren't checked.** A missing `JWT_ACCESS_SECRET` silently fell back to a
  development value that's in the public code, so anyone could forge a login. A missing
  `WEB_APP_URL` or `API_PUBLIC_URL` put `localhost` links in emails, and the default email
  provider (`mock`) would never send a login code.
- **Every visitor would look identical.** Behind Render's proxy, the API saw the proxy's address
  for everyone, so a single shared rate limit would lock all customers out after a handful of
  joins.
- **CORS allowed any website.**
- **Known security issues in dependencies:** 53 advisories, including 2 critical and 21 high,
  mostly in Next.js 14.

## Decision

**Start-up checks.** With `NODE_ENV=production`, the API checks its settings before starting
(`config/production-config.ts`) and **refuses to start**, listing every problem. It requires:

- a database;
- a random `JWT_ACCESS_SECRET` of at least 32 characters (not the development value);
- a 32-byte `AUTHENTICATOR_ENCRYPTION_KEY`;
- `https` `WEB_APP_URL` and `API_PUBLIC_URL`;
- a real email provider, with its own settings;
- rate limiting left on.

It warns, without stopping, when there's no SMS provider, no platform admins, or scheduled jobs
are off. Outside production nothing changes.

**Network edge.**

- **CORS:** only the web app's origin (`WEB_APP_URL`, or `CORS_ORIGINS`) in production; any origin
  locally, which keeps phone testing over the Mac's IP working.
- **Proxy:** `trust proxy` is set to **one hop** (Render's load balancer; `TRUST_PROXY_HOPS`
  overrides). Rate limits then key on the real visitor, and an address a client adds to
  `X-Forwarded-For` is ignored. `GET /health/ip` echoes what the API sees, to check this after a
  deploy.
- **Health:** `GET /health` now asks the database, so Render never routes traffic to a deploy that
  can't reach it.
- **Shutdown:** shutdown hooks finish requests and close the database cleanly on redeploys.

**Public business sign-up is off in production** (`BUSINESS_SIGNUP_ENABLED`, default off there;
on locally and in tests). Businesses are onboarded at `/platform` (ADR-018). This answers the
roadmap's open "sign-up screen" item: there's no public screen, and a platform admin onboards each
business.

**Dependencies.** Next.js 14 → **15.5**, which requires React 18 → **19**. nodemailer → 10. pnpm
overrides force patched lodash, qs, body-parser, multer, file-type, uuid and postcss. That leaves
2 advisories (from 53), neither reachable:

- **NestJS core (moderate):** fixed only in NestJS 11, a major upgrade (Express 5) scheduled after
  launch rather than rushed into it.
- **`deepmerge-ts` (high):** used only by Prisma's command-line tool to read its own config file.

**Runtime.** Node **22** (`.nvmrc`, `engines`); Node 20 reached end of life in April 2026.

**Deploy shape (ADR-009).**

- **Render:** a Blueprint (`render.yaml`) on the free plan in Singapore, one instance. Migrations
  run in the start command, because the free plan has no pre-deploy step. Render generates the two
  secrets.
- **Vercel:** `apps/web/vercel.json` builds the monorepo from `apps/web`. A Vercel build without
  `NEXT_PUBLIC_API_URL` fails on purpose, since the address is built into the pages.
- **Neon:** Postgres 16 in AWS Singapore, using the direct (non-pooled) connection string.
- **Pingram** for email.

`docs/runbooks/deploy.md` is the step-by-step guide. `scripts/smoke.sh` checks a deploy from the
outside.

**Local quality gate.** `pnpm quality` builds the web app into `.next-build`, so it no longer
breaks a running `next dev`. `next-env.d.ts` is no longer tracked, because Next regenerates it.

## Consequences

- A production deploy can't start half-configured. The cost is that settings must be complete on
  the very first deploy, and the runbook lists them.
- Changing `JWT_ACCESS_SECRET` signs everyone out. Changing `AUTHENTICATOR_ENCRYPTION_KEY` breaks
  existing authenticator logins (emailed codes still work), so it must never be rotated casually.
- On the free plan the API sleeps when idle: cold starts, and paused reminders and no-shows.
  Upgrading to Starter is a one-line change (`plan: starter`), to be done before a real business
  depends on it.
- No SMS: phone-only customers get no alerts. The join form now recommends an email and says why.
