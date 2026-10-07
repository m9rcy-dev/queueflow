# Runbook: Deploying QueueFlow

How to put QueueFlow online, check it, and look after it. Hosting follows ADR-009: **Vercel**
(web app), **Render** (API), **Neon** (Postgres), **Pingram** (email), on the domain
`q.m9rcy.dev`.

```
 customer's phone / staff tablet / TV
            │ https://q.m9rcy.dev
            ▼
   Vercel ── web app (Next.js, apps/web)
            │ https://api.q.m9rcy.dev   (browser → API, CORS-locked to the web app)
            ▼
   Render ── API (NestJS, apps/api) ── Neon Postgres
            │
            └── Pingram (login codes, notifications, QR emails)
```

## Before you start

- The code is on GitHub, with `main` holding the release.
- You can sign in to Vercel, Render, Neon and Pingram. Each can sign in with GitHub.
- You can edit DNS for `m9rcy.dev`.
- You have a terminal with this repository and `openssl`. Render generates the two secrets for
  you; `openssl` is only needed to make them by hand.

## 1. Database: Neon

1. Create a project, choosing **Postgres 16** and region **AWS ap-southeast-1 (Singapore)**. That's
   the same region as the API, so queries don't cross the world.
2. On the project dashboard, open **Connection string**, turn **Connection pooling off** (the direct
   connection), and copy it. It looks like:
   `postgresql://<user>:<password>@ep-…​.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   This is `DATABASE_URL`. Keep `sslmode=require`.

The API creates every table itself on its first start (`prisma migrate deploy`), so there's
nothing else to do here.

## 2. Email: Pingram

1. In Pingram, add and **verify the sender domain** `q.m9rcy.dev`. Pingram shows DNS records
   (SPF/DKIM) to add at your DNS provider. Until they verify, emails may be rejected or go to spam.
2. Create an **API key** (`PINGRAM_API_KEY`). Note the account's **region** (`us`, `eu` or `ca`);
   it must match `PINGRAM_REGION`, or every send fails with "Account not found".
3. The sender address, e.g. `noreply@q.m9rcy.dev`, is `PINGRAM_FROM_EMAIL`.

## 3. API: Render

1. In Render: **New → Blueprint**, connect the GitHub repository, branch `main`. Render reads
   `render.yaml` and proposes one web service, `queueflow-api`.
2. Fill in the values it asks for. These are the `sync: false` ones; Render generates
   `JWT_ACCESS_SECRET` and `AUTHENTICATOR_ENCRYPTION_KEY` itself.

   | Setting                 | Value                                                         |
   | ----------------------- | ------------------------------------------------------------- |
   | `DATABASE_URL`          | the Neon direct connection string from step 1                 |
   | `WEB_APP_URL`           | `https://q.m9rcy.dev`                                         |
   | `API_PUBLIC_URL`        | `https://api.q.m9rcy.dev`                                     |
   | `PINGRAM_API_KEY`       | from step 2                                                   |
   | `PINGRAM_FROM_EMAIL`    | e.g. `noreply@q.m9rcy.dev`                                    |
   | `PLATFORM_ADMIN_EMAILS` | your email (comma-separate several); they can use `/platform` |

3. **Apply.** The first build takes a few minutes. In the **Logs** you should see:
   - `All migrations have been successfully applied.`
   - `QueueFlow API listening on port …`
   - **Warnings, which are expected:** "No SMS provider…".
   - **Errors:** if it says `Refusing to start: N production setting(s) missing or unsafe`, the lines
     above that say exactly which setting to fix. Fix it in **Environment** and the service
     redeploys.
4. Check it: open `https://queueflow-api.onrender.com/health` (your service's own URL). It should
   show `{"status":"ok", …}`.
5. **Settings → Custom Domains → Add** `api.q.m9rcy.dev`. Render shows a CNAME target to add in
   DNS (step 5).

> **Free plan (ADR-009):** the API sleeps after ~15 idle minutes. The first visitor afterwards
> waits ~30 seconds. While it's asleep, scheduled jobs pause: no-shows aren't marked and
> appointment reminders aren't sent. **Before a real business relies on QueueFlow during trading
> hours, change `plan: free` to `plan: starter` in `render.yaml` (about US$7/month, always on).**
> Keep **one instance**: live updates and scheduled jobs run inside the API process.

## 4. Web app: Vercel

1. **Add New → Project** and import the GitHub repository.
2. **Root Directory: `apps/web`**. Framework: **Next.js**, detected automatically.
   `apps/web/vercel.json` already sets the install and build commands for the monorepo, so leave
   them as they are.
3. **Environment Variables:**

   | Setting               | Value                     |
   | --------------------- | ------------------------- |
   | `NEXT_PUBLIC_API_URL` | `https://api.q.m9rcy.dev` |

   It's built into the pages at build time. **After changing it, redeploy**; a setting change
   alone doesn't rebuild. A Vercel build without it fails on purpose.

4. **Settings → General → Node.js Version: 22.x.**
5. **Deploy**, then **Settings → Domains → Add** `q.m9rcy.dev`. Vercel shows the DNS record to add.

## 5. DNS

At your DNS provider for `m9rcy.dev`:

| Name                       | Type        | Value                                                         |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| `q`                        | CNAME       | `cname.vercel-dns.com` (or what Vercel shows)                 |
| `api.q`                    | CNAME       | your Render service's host, e.g. `queueflow-api.onrender.com` |
| Pingram's SPF/DKIM records | TXT / CNAME | exactly as Pingram shows (step 2)                             |

Both Vercel and Render issue HTTPS certificates automatically once DNS resolves (minutes to an
hour).

## 6. Check the deploy

1. **Automatic checks**, from your computer:

   ```
   scripts/smoke.sh https://api.q.m9rcy.dev https://q.m9rcy.dev
   ```

   It checks that:
   - the API and database are up;
   - only the web app may call the API;
   - public sign-up is off;
   - the pages load with their security headers;
   - the pages point at the right API.

   It also prints **the IP the API sees for you**. That should be your own public IP. If it's an
   internal address (`10.…`, `172.…`), every visitor would share one rate limit: set
   `TRUST_PROXY_HOPS` to 2 on Render and re-check.

2. **By hand, about 10 minutes, on a phone where it says so:**
   - [ ] **`https://q.m9rcy.dev/platform`:** sign in with your admin email (the code arrives by
         email) and **onboard a test business** using an email you can read.
   - [ ] **Owner:** sign in at `/admin/login` and follow **Get started**: location, a service, a
         queue, then print the QR poster.
   - [ ] **On a phone:** scan the poster, join with your email, check the "you're in the queue"
         email shows the QR, and open the ticket from it.
   - [ ] **TV board:** open the TV link from QR Codes on another screen; the ticket appears.
   - [ ] **Dashboard:** Clock in, then Call Next. The phone ticket says it's your turn, and the TV
         shows "with <your name>".
   - [ ] **On a phone or iPad:** queue **Scan → Use camera** and scan a customer's personal code.
         The camera only works on https, so this is its first real test.
   - [ ] **Appointments** (Settings → turn on, add a bookable service): book from the poster, and
         check the email has the check-in QR and the calendar link.
   - [ ] **Hours:** the shift shows, and Export CSV downloads.
3. Afterwards, delete the test business's data or keep it as a demo. `/platform` shows every
   business.

## Settings reference

### API (Render)

| Setting                                                                            | Required                   | What it's for                                                                                                                                  |
| ---------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                         | yes (`production`)         | Turns on the start-up checks below                                                                                                             |
| `DATABASE_URL`                                                                     | yes                        | Neon direct connection string, `?sslmode=require`                                                                                              |
| `JWT_ACCESS_SECRET`                                                                | yes, ≥32 random chars      | Signs every login. Changing it signs everyone out                                                                                              |
| `AUTHENTICATOR_ENCRYPTION_KEY`                                                     | yes, 32 bytes base64       | Encrypts authenticator-app secrets. **Never change it**: existing authenticator logins would stop working (people can still use emailed codes) |
| `WEB_APP_URL`                                                                      | yes, https                 | Links in emails; also the allowed origin for CORS                                                                                              |
| `API_PUBLIC_URL`                                                                   | yes, https                 | QR images in emails                                                                                                                            |
| `EMAIL_PROVIDER`                                                                   | yes: `pingram` (or `smtp`) | `mock` is refused in production                                                                                                                |
| `PINGRAM_API_KEY`, `PINGRAM_FROM_EMAIL`, `PINGRAM_REGION`                          | with `pingram`             | Step 2                                                                                                                                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | with `smtp`                | Any SMTP relay                                                                                                                                 |
| `SMS_PROVIDER`                                                                     | `mock`                     | No real SMS yet (see limitations)                                                                                                              |
| `PLATFORM_ADMIN_EMAILS`                                                            | recommended                | Who can sign in at `/platform`. Removing an email locks that person out at once                                                                |
| `CORS_ORIGINS`                                                                     | optional                   | Extra allowed web origins (comma-separated, https); default is `WEB_APP_URL`                                                                   |
| `TRUST_PROXY_HOPS`                                                                 | optional                   | Proxies in front of the API; default 1 (Render)                                                                                                |
| `BUSINESS_SIGNUP_ENABLED`                                                          | optional                   | `true` re-opens the public `POST /auth/business-signup`; off in production otherwise                                                           |
| `DISABLE_SCHEDULED_JOBS`                                                           | no                         | Tests only. In production it stops no-shows and reminders                                                                                      |
| `DISABLE_RATE_LIMITING`                                                            | no                         | Tests only. Refused in production                                                                                                              |

In production the API **refuses to start** if a required setting is missing or unsafe (a short
or development secret, an `http://` address, a `mock` email provider, rate limiting off). It lists
every problem in the log.

### Web (Vercel)

| Setting               | Required | What it's for                                                          |
| --------------------- | -------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | yes      | The API's https address, built into the pages. Redeploy after changing |

## Day-to-day operations

- **Deploying:** merge to `main`. Render and Vercel both deploy automatically. Run
  `scripts/smoke.sh` afterwards.
- **Logs:** Render → `queueflow-api` → Logs (API, scheduled jobs, email errors); Vercel → the
  project → Logs.
- **Rolling back:**
  - **Render:** Deploys → an earlier deploy → **Rollback**.
  - **Vercel:** Deployments → an earlier one → **Promote to Production**.
  - **Database migrations only go forward.** A rollback doesn't undo them, but each migration so
    far only adds things, so older code keeps working with the newer database. Before a migration
    that removes or renames something, take a Neon backup branch first (Neon → Branches → Create
    branch).
- **Backups:** Neon keeps point-in-time history (the length depends on the plan) and can restore
  into a new branch. For a portable copy, see `docs/runbooks/backup-restore.md`.
- **Adding or removing a platform admin:** edit `PLATFORM_ADMIN_EMAILS` on Render. The service
  restarts and the change applies at once.

## Known limitations at launch

- **No SMS.** Customers who give only a phone number get no alerts. The join form asks for an
  email ("recommended") and explains why. Adding real SMS needs a provider account and per-business
  cost limits (G-29).
- **Free plan:** the API sleeps, as described in step 3.
- **One API instance** (D-06). Fine at this scale; growing beyond it needs shared live updates
  (Redis) first.
- **Dependencies:** two advisories remain, neither reachable here:
  - **NestJS core (moderate):** fixed in NestJS 11, a major upgrade planned after launch.
  - **`deepmerge-ts` inside Prisma's command-line tool (high):** only reads Prisma's own config,
    never visitor input.
