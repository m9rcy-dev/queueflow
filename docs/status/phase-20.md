# Phase 20: First Deploy (release readiness)

**Status:** Done (2026-10-07). Branch `feature/QF-020-first-deploy`, from `main`. Ready to deploy;
the deploy itself is the user's to run, following `docs/runbooks/deploy.md`.

**Decisions:** ADR-019. The roadmap's open item, a business sign-up screen, became "no public
sign-up in production; onboard at `/platform`", following Phase 19's onboarding.

## Release audit: what was found and fixed

| Problem                                                               | Risk                                                                       | Fix                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A missing `JWT_ACCESS_SECRET` fell back to a public development value | Anyone could forge a login                                                 | The API refuses to start in production without a strong secret                |
| Missing `WEB_APP_URL` / `API_PUBLIC_URL` fell back to localhost       | Broken links and QR images in emails                                       | Required, and must be https                                                   |
| The default email provider was `mock`                                 | Login codes never sent                                                     | `mock` refused in production                                                  |
| No `trust proxy` behind Render                                        | Everyone shares one rate limit; 5 joins a minute would block all customers | One hop trusted, so the real visitor IP is used; spoofed headers ignored      |
| CORS allowed any origin                                               | Any site could call the API from a browser                                 | Web app origin only in production                                             |
| Health didn't check the database                                      | A broken deploy could go live                                              | `/health` runs `SELECT 1`                                                     |
| No shutdown hooks                                                     | Cut-off requests on redeploy                                               | `enableShutdownHooks()`                                                       |
| Public business sign-up open                                          | Anyone could create businesses                                             | Off in production (`BUSINESS_SIGNUP_ENABLED`)                                 |
| 53 dependency advisories (2 critical, 21 high)                        | Next.js denial-of-service, nodemailer                                      | Next 15.5.27, React 19.3, nodemailer 10, overrides; 2 left, neither reachable |
| Node 20 end of life                                                   | No security fixes                                                          | Node 22                                                                       |
| `pnpm quality` broke a running `next dev`                             | Developer annoyance                                                        | Builds into `.next-build`                                                     |
| No SMS provider                                                       | Phone-only customers get no alerts                                         | Start-up warning; join form says "Email (recommended)" and why                |

## Deploy artifacts

- `render.yaml`: the API Blueprint (free plan, Singapore, one instance, migrations on start,
  generated secrets, `/health` check).
- `apps/web/vercel.json`: monorepo install and build from `apps/web`. The build fails without
  `NEXT_PUBLIC_API_URL`.
- `docs/runbooks/deploy.md`: Neon, Pingram, Render, Vercel and DNS step by step, the settings
  reference, a post-deploy checklist, operations, rollback and known limitations.
- `scripts/smoke.sh`: outside-in checks of a live deploy, with no accounts or secrets needed.
- `.env.example`: the new settings (`CORS_ORIGINS`, `TRUST_PROXY_HOPS`,
  `BUSINESS_SIGNUP_ENABLED`).

## Follow-up the same day: separate email and SMS providers

The user's decisions:

- **Onboarding:** businesses are onboarded only by platform admins; customers sign themselves up.
- **Hosting:** stays on the free plan.
- **Providers:** email and SMS must be **separate providers**.

What changed:

- **`TwilioSmsProvider`** (`SMS_PROVIDER=twilio`): Twilio's REST API, preferring a Messaging Service
  and otherwise a From number.
- **A per-business daily SMS cap**, `SMS_DAILY_LIMIT_PER_BUSINESS` (default 100). Texts over it are
  marked `SKIPPED` (migration `20261007100000_add_outbox_skipped`), finally meeting G-29's
  "cost caps before real SMS".
- **SMTP requires TLS in production.**
- **Start-up checks** cover the chosen SMS provider's settings, and refuse unknown providers.
- **`render.yaml`** asks for both providers when the Blueprint is set up.
- **`docs/runbooks/deploy.md`** was rewritten as a numbered, step-by-step guide (provider choice,
  Neon, email, Twilio, Render, Vercel, DNS, checks, a user walkthrough, first business, operations,
  troubleshooting).

Tests: **318 unit** (Twilio requests and errors, the SMS cap, the SMS settings checks) and **144
integration**, all passing. A real Twilio send can only be checked with the live account; it's step
10.4 of the runbook.

## Fix from the user's phone test: signed out right after signing in

**What happened.** A customer signed up on a phone and entered the emailed code. Sign-in succeeded,
but the customer area then sent them to the home page ("nothing to see at this address").

**Cause.** Refresh tokens are single-use. The customer area restored the session twice at once,
because React runs start-up effects twice in development (and a page can also restore from two
places, for example the form pre-fill). Over the phone's slower connection, the second request
arrived after the first had used the token. It was refused, and the client wiped the session. The
staff client had the same pattern.

**Fix** (`packages/api-client`):

- **One refresh at a time:** concurrent refreshes share one request.
- **Multiple tabs:** a refused refresh first checks whether another tab already replaced the
  token, and uses it if so.
- **Session hooks:** they ignore results that arrive after cleanup.
- **Signed-out customers** (and Log out) go back to their business's sign-in page instead of the
  bare home page.

**Checked:**

- A simulation reproduced the failure on the old code (both restores failed and the session was
  wiped), and passed on the new code (one refresh, session kept).
- The new regression tests (`apps/web/src/lib/session-refresh.test.ts`) fail on the old code and
  pass on the new.
- A real sign-up over the Mac's Wi-Fi address stayed signed in across page loads, with exactly one
  refresh per load in the database.

## Verification

- **Quality gate** (`pnpm quality`): build, formatting, lint, typecheck, **311 unit and 144
  integration tests**, all passing. Run while the dev servers were up, and they kept working.
- **A production-mode API** (`NODE_ENV=production`, real build):
  - **With settings missing:** it refused to start and listed them.
  - **Fully configured:**
    - CORS allowed the web app's origin and refused another site's;
    - the visitor IP came from `X-Forwarded-For`, and a spoofed extra entry was ignored;
    - business sign-up returned 404;
    - health checked the database.
- **A dry run of the deploy from a fresh clone, as Render does it:**
  - `pnpm install --prod=false` with `NODE_ENV=production`;
  - the Blueprint's build command;
  - then its start command against an **empty** database: 21 migrations applied, the server
    started, and health passed.
- **The whole business journey against that production build:**
  1. platform admin sign-in;
  2. onboard a business;
  3. owner sign-in;
  4. location, service, queue and poster;
  5. clock in;
  6. a customer joins with an email;
  7. the email carries the QR;
  8. the QR image serves;
  9. Call Next;
  10. the hours report.

  All 10 steps passed (`scratchpad/e2e.sh`, not committed). The first attempt failed at step 7
  because of a bug in the test script (it read the wrong email), not the app.

- **Vercel's build command** in the clean clone built successfully, and a build without
  `NEXT_PUBLIC_API_URL` failed as designed. Served in production mode, every page returned 200,
  with HSTS, the CSP pointing at the API, and `upgrade-insecure-requests`.
- **`scripts/smoke.sh`** against production-mode local builds: every check passed except "the web
  app may call it (CORS)", as expected, since production only allows an `https://` web address
  and the local one was `http://`.
- **In a real browser** (Chrome, on `127.0.0.1` so the user's own sessions weren't touched), on
  Next 15 / React 19:
  - **Pages:** join page, TV board, staff sign-in (authenticator account, using "Email me a code
    instead"), the owner's Queues page with Get started, the queue dashboard, Hours, QR Codes,
    Staff, Settings, Appointments, Account, customer sign-in, customer Home, full-screen code, and
    a pre-filled join form.
  - **Live actions:** Clock in, which showed the Wants picker, then Clock out.
  - **No console errors on any page.** This also covers the Phase 17–19 screens that were waiting
    for a browser check.

## Not checked

- **The real hosting** (Render, Vercel, Neon, Pingram, DNS): that's the deploy itself. The
  runbook's checklist covers it.
- **Phone-width layouts** (the customer tab bar), and **camera scanning on a phone or iPad**,
  which needs HTTPS: both are in the post-deploy checklist.
- **The platform console in a browser:** its API is covered by integration tests and the
  production-mode journey above.
