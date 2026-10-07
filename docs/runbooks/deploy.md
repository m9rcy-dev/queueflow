# Runbook: Deploying QueueFlow (step by step)

This takes you from code on GitHub to QueueFlow live at **https://q.m9rcy.dev**. Follow the steps in
order and tick each box as you go. Allow about **2 hours**; most of it is waiting for DNS and email
verification.

```
 customers' phones · staff tablets · TV screens
                 │  https://q.m9rcy.dev
                 ▼
        Vercel ── web app (apps/web)
                 │  https://api.q.m9rcy.dev
                 ▼
        Render ── API (apps/api) ──── Neon (Postgres database)
                 │
                 ├── email provider: Pingram, or any SMTP service
                 └── SMS provider:   Twilio, or none
```

Hosting choices: ADR-009 (free plans for now). Production rules: ADR-019.

---

## Step 0: Collect everything in one place

Create a private note (in a password manager, **not** in the repository) with these headings. You'll
fill them in as you go.

```
DATABASE_URL           =
EMAIL_PROVIDER         =  pingram | smtp
  (pingram) PINGRAM_API_KEY, PINGRAM_REGION, PINGRAM_FROM_EMAIL
  (smtp)    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
SMS_PROVIDER           =  twilio | mock
  (twilio)  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
PLATFORM_ADMIN_EMAILS  =  your email
Render service URL     =
Vercel project URL     =
```

---

## Step 1: Put the release on GitHub

- [ ] **1.1** Merge the release branch into `main` and push it. Render and Vercel deploy from
      `main`:
  ```bash
  git checkout main
  git merge --ff-only feature/QF-020-first-deploy
  git push origin main
  ```
- [ ] **1.2** On GitHub, open `m9rcy-dev/queueflow` and check that the latest commit on `main` is
      "Phase 20: First Deploy…".

---

## Step 2: Choose your providers

Email and SMS are **separate choices**, so you're never tied to one company. You can switch either
later by changing settings on Render; no code changes.

**Email** (required: login codes, invites, tickets, booking confirmations):

| Option                                                                        | Pick it when                                           | Set `EMAIL_PROVIDER` to |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------- |
| **Pingram**                                                                   | You already have the account                           | `pingram`               |
| **Any SMTP service**: Amazon SES, Postmark, Brevo, Mailgun, Google Workspace… | You want to avoid Pingram, or already use one of these | `smtp`                  |

**SMS** (optional: alerts for customers who only give a phone number):

| Option           | What happens                                                                 | Set `SMS_PROVIDER` to |
| ---------------- | ---------------------------------------------------------------------------- | --------------------- |
| **Twilio**       | Customers without an email get "nearly your turn" and "it's your turn" texts | `twilio`              |
| **None for now** | Only customers who give an email get alerts; the join form recommends one    | `mock`                |

SMS costs money per message. QueueFlow limits each business to `SMS_DAILY_LIMIT_PER_BUSINESS`
texts a day (default **100**); anything over that is skipped, not sent.

- [ ] **2.1** Decide your email provider: ______
- [ ] **2.2** Decide your SMS provider: ______

---

## Step 3: Database (Neon)

- [ ] **3.1** Sign in at **neon.tech**, then **New Project**:
  - Name: `queueflow`
  - Postgres version: **16**
  - Region: **AWS Asia Pacific (Singapore) — ap-southeast-1**. That's the same region as the API,
    so queries stay fast.
- [ ] **3.2** On the project dashboard, click **Connect**, switch **Connection pooling off**, and
      copy the connection string. It looks like:
      `postgresql://neondb_owner:…@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
- [ ] **3.3** Save it as `DATABASE_URL`. Keep `?sslmode=require` on the end.

You don't create any tables. The API creates them itself the first time it starts.

---

## Step 4: Email

Do **4A** or **4B**, whichever you chose in step 2.

### 4A: Pingram

- [ ] **4A.1** In Pingram, add the sending domain **`q.m9rcy.dev`**. Pingram shows some DNS records
      (TXT/CNAME); add them at your DNS provider now. They take a while to verify, so start early.
- [ ] **4A.2** Create an **API key**, and save it as `PINGRAM_API_KEY`.
- [ ] **4A.3** Note the account's **region** (`us`, `eu` or `ca`) as `PINGRAM_REGION`. If it's
      wrong, every send fails with "Account not found".
- [ ] **4A.4** Save `PINGRAM_FROM_EMAIL` = `noreply@q.m9rcy.dev`.
- [ ] **4A.5** Wait until Pingram shows the domain as **verified**.

### 4B: An SMTP service (Amazon SES, Postmark, Brevo, Mailgun…)

- [ ] **4B.1** In the provider, add and **verify the sending domain `q.m9rcy.dev`**. Add the SPF
      and DKIM records it shows to your DNS. Unverified domains get rejected or land in spam.
- [ ] **4B.2** Create **SMTP credentials**, and save:
  - `SMTP_HOST`: e.g. `email-smtp.ap-southeast-2.amazonaws.com`, `smtp.postmarkapp.com`,
    `smtp-relay.brevo.com`
  - `SMTP_PORT`: `587`. In production QueueFlow requires the connection to switch to TLS.
  - `SMTP_USER`, `SMTP_PASSWORD`
  - `SMTP_FROM`: `QueueFlow <noreply@q.m9rcy.dev>`
- [ ] **4B.3** If the provider starts you in a **sandbox** (Amazon SES does), request production
      access. In a sandbox it only sends to addresses you've verified yourself.

---

## Step 5: SMS (only if you chose Twilio)

- [ ] **5.1** Create an account at **twilio.com**, then **upgrade it from Trial** (add billing). A
      trial account can only text numbers you've verified yourself.
- [ ] **5.2** **Messaging → Settings → Geo permissions:** turn on **New Zealand**, plus any other
      country your customers' numbers come from. Messages to countries that are switched off are
      blocked.
- [ ] **5.3** Get a sender. **Messaging → Services → Create Messaging Service**, then add a
      sender to it: a phone number you buy in Twilio, or an alphanumeric sender ID if Twilio allows
      it for NZ. Follow Twilio's on-screen guidance for New Zealand.
- [ ] **5.4** Save:
  - `TWILIO_ACCOUNT_SID` (starts `AC…`, on the Console home page)
  - `TWILIO_AUTH_TOKEN` (Console home page; keep it secret)
  - `TWILIO_MESSAGING_SERVICE_SID` (starts `MG…`). Alternatively, set `TWILIO_FROM_NUMBER` to the
    number in `+…` format.
- [ ] **5.5** Optionally, decide a different daily cap than 100 texts per business
      (`SMS_DAILY_LIMIT_PER_BUSINESS`).

---

## Step 6: API (Render)

- [ ] **6.1** Sign in at **render.com** with GitHub, then **New + → Blueprint**.
- [ ] **6.2** Connect the repository **`m9rcy-dev/queueflow`**, branch **`main`**. Render finds
      `render.yaml` and proposes one service, **`queueflow-api`**.
- [ ] **6.3** Render asks for the settings marked "sync: false". Fill in **only** those for your
      chosen providers and **leave the others blank**:

  | Setting                       | Value                               |
  | ----------------------------- | ----------------------------------- |
  | `DATABASE_URL`                | from step 3                         |
  | `WEB_APP_URL`                 | `https://q.m9rcy.dev`               |
  | `API_PUBLIC_URL`              | `https://api.q.m9rcy.dev`           |
  | `PLATFORM_ADMIN_EMAILS`       | your email (comma-separate several) |
  | `EMAIL_PROVIDER`              | `pingram` or `smtp`                 |
  | Pingram **or** SMTP settings  | from step 4                         |
  | `SMS_PROVIDER`                | `twilio` or `mock`                  |
  | Twilio settings (if `twilio`) | from step 5                         |

  Render generates `JWT_ACCESS_SECRET` and `AUTHENTICATOR_ENCRYPTION_KEY` for you. Don't change
  them later (see "Secrets" below).

- [ ] **6.4** Click **Apply**. The first build takes about 5 minutes. Open **queueflow-api →
      Logs** and wait for:
  ```
  All migrations have been successfully applied.
  QueueFlow API listening on port …
  ```
  If you see **`Refusing to start: N production setting(s) missing or unsafe`**, the lines just
  above it name each problem. Fix them under **Environment**; the service redeploys by itself.
- [ ] **6.5** Copy the service URL (e.g. `https://queueflow-api.onrender.com`) into your note.
      Open `<that URL>/health` in a browser. It should show `{"status":"ok", …}`.
- [ ] **6.6** **Settings → Custom Domains → Add Custom Domain:** `api.q.m9rcy.dev`. Render shows
      the DNS record to create; you'll add it in step 8.

> **Free plan:** the API goes to sleep after about 15 idle minutes, and the next visitor waits about
> 30 seconds. While it's asleep, no-shows aren't marked and appointment reminders aren't sent.
> Before a business depends on QueueFlow during opening hours, change `plan: free` to
> `plan: starter` in `render.yaml` (about US$7/month, always on) and push.

---

## Step 7: Web app (Vercel)

- [ ] **7.1** Sign in at **vercel.com** with GitHub, then **Add New… → Project → Import**
      `m9rcy-dev/queueflow`.
- [ ] **7.2** **Root Directory:** click **Edit** and choose **`apps/web`**. Framework: **Next.js**
      (detected). Leave the build and install commands as they are; `apps/web/vercel.json` sets
      them.
- [ ] **7.3** **Environment Variables:** add `NEXT_PUBLIC_API_URL` = `https://api.q.m9rcy.dev`.
      A build without it fails on purpose.
- [ ] **7.4** **Deploy.** It takes about 3 minutes.
- [ ] **7.5** In **Settings → General**, set **Node.js Version** to **22.x**. If it changed,
      redeploy (**Deployments → ⋯ → Redeploy**).
- [ ] **7.6** **Settings → Domains → Add** `q.m9rcy.dev`. Vercel shows the DNS record to create.

> `NEXT_PUBLIC_API_URL` is built into the pages. If you ever change it, **redeploy**: changing the
> setting alone doesn't rebuild.

---

## Step 8: DNS

At the DNS provider for **m9rcy.dev**, create:

| Name                          | Type        | Value                                                      |
| ----------------------------- | ----------- | ---------------------------------------------------------- |
| `q`                           | CNAME       | what Vercel showed in 7.6 (usually `cname.vercel-dns.com`) |
| `api.q`                       | CNAME       | what Render showed in 6.6 (your `….onrender.com` host)     |
| your email provider's records | TXT / CNAME | exactly as shown in step 4 (if not added yet)              |

- [ ] **8.1** Add the records.
- [ ] **8.2** Wait until both Vercel (**Domains**) and Render (**Custom Domains**) show the domain
      as **verified** with a certificate. That takes minutes to an hour.
- [ ] **8.3** Check that `https://api.q.m9rcy.dev/health` shows `{"status":"ok", …}`.
- [ ] **8.4** Check that `https://q.m9rcy.dev/admin/login` shows the QueueFlow sign-in page.

> Test through **`https://q.m9rcy.dev`**, not the temporary `….vercel.app` address. The API only
> accepts requests from the address in `WEB_APP_URL`, so the `vercel.app` address gets "network
> errors". To test before DNS is ready, add the `vercel.app` address to `CORS_ORIGINS` on Render
> temporarily, and remove it afterwards.

---

## Step 9: Automatic checks

- [ ] **9.1** From your computer, in the repository folder, run:
  ```bash
  scripts/smoke.sh https://api.q.m9rcy.dev https://q.m9rcy.dev
  ```
  Every line should be a green ✓, ending with **"All checks passed."**
- [ ] **9.2** The script prints **"the API sees your IP as: …"**. That should be **your own public
      IP**. If it's an internal address (`10.…`, `172.…`, `192.168.…`), set `TRUST_PROXY_HOPS` to
      `2` on Render and run the script again.

---

## Step 10: Try it as a real user (about 15 minutes)

Use a phone for the customer steps.

- [ ] **10.1 Platform:** open `https://q.m9rcy.dev/platform` and sign in with your admin email;
      the code arrives by email. Click **+ Onboard a business** and create a **test business**
      with an email address you can read, using a second address if you have one.
- [ ] **10.2 Owner:** sign in at `https://q.m9rcy.dev/admin/login` as that owner and follow **Get
      started**: add a location, a service and a queue, then print the QR poster.
- [ ] **10.3 Customer, with email:** scan the poster with your phone and join **with an email**. - The "You're in the queue" email arrives **with the QR code**. - Opening the ticket from the email works.
- [ ] **10.4 Customer, phone only** (if SMS is on): join again from another phone **without an
      email**, then on the dashboard press **Call Next** until it's that ticket's turn. The phone
      gets a **text**.
- [ ] **10.5 TV:** open the TV link (QR Codes page) on another screen. Tickets appear, and update
      when you call them.
- [ ] **10.6 Staff:** on the queue dashboard, **Clock in**, then **Call Next**. The TV shows
      "with <your name>".
- [ ] **10.7 Camera scanning** (needs HTTPS, so this is its first real test): on a phone or iPad,
      open the queue's **Scan → Use camera** and scan a customer's personal code (customer area →
      Home → tap the code). It shows "Joined".
- [ ] **10.8 Appointments:** in Settings, turn on Appointments and mark a service bookable. Book
      from the poster; the confirmation email has the **check-in QR** and **Add to Google
      Calendar**.
- [ ] **10.9 Hours:** the shift appears on the Hours page, and **Export CSV** downloads.
- [ ] **10.10 Phone layout:** on a phone, sign in as a customer. The **tab bar** (Home, Visits,
      Bookings, QR Codes, Account) shows along the bottom.

If anything fails, see **Troubleshooting** below. When everything passes, QueueFlow is live.

---

## Step 11: Onboard your first real business

- [ ] **11.1** At `/platform`, **+ Onboard a business** with the business name, the owner's name
      and email, and Appointments on or off. The owner gets a welcome email with the sign-in link.
- [ ] **11.2** The owner signs in and follows **Get started**. Their customers sign up through the
      business's own **customer sign-up poster** (QR Codes page), or just scan the queue poster to
      join without an account.
- [ ] **11.3** Remove the test business's data if you don't want it as a demo.

Businesses can't sign themselves up in production; only platform admins onboard them.

---

## Day-to-day operations

**Releasing an update:**

1. Merge to `main` and push. Render and Vercel deploy by themselves.
2. Run `scripts/smoke.sh` afterwards.

**Logs:** Render → queueflow-api → **Logs** (API, scheduled jobs, email and SMS errors). Vercel →
project → **Logs**.

**Rolling back:**

- **Render:** **Deploys** → an earlier deploy → **Rollback**.
- **Vercel:** **Deployments** → an earlier one → **⋯ → Promote to Production**.
- **Database changes only go forward.** A rollback doesn't undo them. Before an update that removes
  or renames data, create a Neon backup branch first (Neon → Branches → Create branch).

**Backups:** Neon keeps restore history (how long depends on the plan) and can restore into a new
branch. For a portable copy, see `docs/runbooks/backup-restore.md`.

**Switching email or SMS provider:**

1. Change `EMAIL_PROVIDER` / `SMS_PROVIDER` and the new provider's settings on Render
   (**Environment**). The service restarts.
2. Verify the sending domain at the new email provider first.

**Platform admins:** edit `PLATFORM_ADMIN_EMAILS` on Render. Removing an email locks that person out
straight away.

**Secrets:**

- **`JWT_ACCESS_SECRET`:** changing it signs everyone out.
- **`AUTHENTICATOR_ENCRYPTION_KEY`:** **never** change it. Everyone using an authenticator app
  would have to set it up again (they can still use emailed codes).
- **Twilio token or email password:** if exposed, regenerate it at the provider and update it on
  Render.

---

## Troubleshooting

| What you see                                                    | Likely cause and fix                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render log: `Refusing to start: … setting(s) missing or unsafe` | The lines above it name each problem. Fix them under Environment                                                                                                    |
| Render log: `Unknown EMAIL_PROVIDER` / `Unknown SMS_PROVIDER`   | A typo. Use `pingram`/`smtp`, and `twilio`/`mock`                                                                                                                   |
| Render build fails at `prisma migrate deploy`                   | `DATABASE_URL` is wrong, or missing `?sslmode=require`                                                                                                              |
| Site loads, but every action says it can't connect              | You're on the `vercel.app` address (use `q.m9rcy.dev`), or `NEXT_PUBLIC_API_URL` / `WEB_APP_URL` don't match the real addresses. Fix, then **redeploy Vercel**      |
| Vercel build fails: "NEXT_PUBLIC_API_URL must be set"           | Add it (step 7.3) and redeploy                                                                                                                                      |
| Login codes don't arrive                                        | Check spam. Check the domain is **verified** at the email provider, `PINGRAM_REGION` is right, and SES is out of its sandbox. Render logs show the provider's error |
| Texts don't arrive                                              | Twilio still on **trial**, **New Zealand** not on in Geo permissions, or the business hit its daily limit (Render log: "Daily SMS limit reached")                   |
| First page load takes ~30 seconds                               | The free plan was asleep. Expected; upgrade to Starter before real trading                                                                                          |
| Reminders or no-shows didn't happen overnight                   | The free plan was asleep at the time. Upgrade to Starter                                                                                                            |
| Everyone gets "too many requests"                               | The API sees the proxy, not visitors. Set `TRUST_PROXY_HOPS` (step 9.2)                                                                                             |
| Camera scanning says it needs a secure address                  | You're on `http://`. Use `https://q.m9rcy.dev`                                                                                                                      |

---

## Settings reference

### API (Render)

| Setting                                                                                               | Required                            | Notes                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                                                                                            | `production` (set by `render.yaml`) | Turns on the start-up checks                                 |
| `DATABASE_URL`                                                                                        | yes                                 | Neon direct connection string with `?sslmode=require`        |
| `JWT_ACCESS_SECRET`                                                                                   | yes, generated                      | ≥32 random characters. Changing it signs everyone out        |
| `AUTHENTICATOR_ENCRYPTION_KEY`                                                                        | yes, generated                      | 32 bytes, base64. **Never change it**                        |
| `WEB_APP_URL`                                                                                         | yes, https                          | Links in emails; the allowed browser origin                  |
| `API_PUBLIC_URL`                                                                                      | yes, https                          | QR images in emails                                          |
| `PLATFORM_ADMIN_EMAILS`                                                                               | recommended                         | Who can use `/platform`                                      |
| `EMAIL_PROVIDER`                                                                                      | yes                                 | `pingram` or `smtp` (`mock` is refused)                      |
| `PINGRAM_API_KEY`, `PINGRAM_REGION`, `PINGRAM_FROM_EMAIL`                                             | with `pingram`                      |                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`                    | with `smtp`                         | Port 587 needs TLS; set `SMTP_SECURE=true` only for port 465 |
| `SMS_PROVIDER`                                                                                        | yes                                 | `twilio`, or `mock` for no SMS                               |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` | with `twilio`                       |                                                              |
| `SMS_DAILY_LIMIT_PER_BUSINESS`                                                                        | optional                            | Default 100 texts per business per day (UTC)                 |
| `CORS_ORIGINS`                                                                                        | optional                            | Extra allowed web addresses (https, comma-separated)         |
| `TRUST_PROXY_HOPS`                                                                                    | optional                            | Default 1 (Render)                                           |
| `BUSINESS_SIGNUP_ENABLED`                                                                             | leave unset                         | Production keeps public business sign-up off                 |
| `DISABLE_SCHEDULED_JOBS`, `DISABLE_RATE_LIMITING`                                                     | never in production                 | Tests only                                                   |

### Web (Vercel)

| Setting               | Required | Notes                                              |
| --------------------- | -------- | -------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | yes      | `https://api.q.m9rcy.dev`. Redeploy after changing |

## Known limitations at launch

- **Free plan:** sleeping API (step 6).
- **One API instance:** live updates and scheduled jobs run inside it (D-06).
- **Two dependency advisories remain, neither reachable** (ADR-019): NestJS core, fixed by a
  planned NestJS 11 upgrade; and `deepmerge-ts`, used only inside Prisma's command-line tool.
