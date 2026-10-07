# QueueFlow

A multi-tenant digital queue and appointment platform — replacing physical queue numbers with
QR-based digital queues, appointment check-in, and live public displays.

**Start here:** [`AGENTS.md`](./AGENTS.md) — canonical instructions for any AI coding session or
developer working on this repo. Read it before making changes.

## Documentation map

- [`docs/QueueFlow_Detailed_Plan.md`](./docs/QueueFlow_Detailed_Plan.md) — the frozen product/architecture baseline.
- [`docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md`](./docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md) — visual direction.
- [`docs/plan-review.md`](./docs/plan-review.md) — the **living decisions log**. Every gap, contradiction,
  and open question from the plan review, with resolutions. This overrides the plan document where
  they conflict.
- [`docs/adr/`](./docs/adr/) — formal Architecture Decision Records for the major choices.
- [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — current phase, current task, known issues. Read this every session.

## Stack

Node 22, NestJS + Prisma + PostgreSQL (API), Next.js 15 + React 19 (web), pnpm workspaces. Redis
(Upstash) for realtime fan-out and rate limiting is planned for when there's more than one API
instance; today it's a single instance (D-06). See the ADRs in `docs/adr/` for why.

## Local development

```bash
cp .env.example apps/api/.env # the API reads apps/api/.env; fill in real values
docker compose up -d          # local Postgres, Redis and Mailpit
pnpm install
pnpm --filter @queueflow/api run db:migrate
pnpm dev                      # starts both apps/api and apps/web
```

Or run both in the background with `scripts/dev.sh` (`restart`, `stop`, `lan`). Logs go to
`.dev-logs/api.log` and `.dev-logs/web.log`.

- API: http://localhost:4001 (health check at `/health`)
- Web: http://localhost:4000
- Settings live in **`apps/api/.env`**; a root `.env` is not read. The API reads it only at
  start-up, so restart `pnpm dev` after changing it.
- Email inbox (Mailpit): http://localhost:8026. With `EMAIL_PROVIDER="smtp"` (the `.env.example`
  default), every email the API sends lands here, including login codes, invites and queue
  notifications.
- Platform admin: http://localhost:4000/platform. Put your email in `PLATFORM_ADMIN_EMAILS` to
  sign in.

### Testing from a phone

Run `scripts/dev.sh lan`. It restarts both apps and prints the address to open on a phone on the
same Wi-Fi, e.g. `http://192.168.1.20:4000`. In development the web app talks to the API on port
4001 of whatever address it was opened from, so nothing else needs changing. `lan` mode also
points email links at that address.

QR codes encode the address they were created from. Open the QR Codes page (or a poster's Print
view) from the phone address, not `localhost`, before scanning. Allow incoming connections for
`node` if macOS asks.

## Entry points

Every sign-in is passwordless: enter your email and type the 6-digit code that's emailed to you
(in Mailpit when running locally), or a code from your authenticator app if you've set one up.
`<code>` and `<token>` are the parts of the links that QueueFlow generates.

### QueueFlow platform admin (root)

| Page                     | What it's for                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `/platform`              | Sign in, if your email is in `PLATFORM_ADMIN_EMAILS`. Lists every business and its services   |
| `/platform/onboard`      | Onboard a business: its name, the owner, Appointments on/off. The owner gets a welcome email  |
| `/platform/tenants/<id>` | One business: the services it has switched on, locations, service list, team, 30-day activity |

### Business owner and admin

Sign in at **`/admin/login`**. Their menu has Queues, Appointments (if switched on), Hours, QR
Codes, Locations, Staff and Settings. Account, Set up PIN and Log out are in the profile menu at
the bottom.

- **A new business:** the Queues page shows a **Get started** checklist (location, services,
  queue, QR poster, logo).
- **QR Codes:** customer posters, TV board links, guest cards and the customer sign-up poster.
- **Staff:** invite people. An invitee gets an email linking to **`/invite/<token>`**.
- **Settings:** the logo, Appointments on/off, appointment rules.
- **Hours:** everyone's clocked hours, with CSV export and fixes for forgotten clock-outs.

**One person in several businesses:** sign in once and choose the business. On the login page,
**Sign in as someone else** switches people.

### Manager (runs one location)

Same sign-in: **`/admin/login`**. Their menu has Queues, Appointments, Hours, QR Codes, Location
(their own) and Staff. They manage their location's details, hours, services, queues, codes and
Staff members, and see and fix hours there.

### Staff (works at one location)

Same sign-in: **`/admin/login`**. Their menu has Queues, Appointments and Hours (their own).

- **The queue dashboard** (`/admin/queues/<id>`): Clock in / Clock out, Call Next, Start,
  Complete, hand over, add a walk-in, and Scan.
- **Scan** (`/admin/queues/<id>/scan`) reads guest cards, customers' personal codes and booking
  check-in codes. A USB or Bluetooth 2D scanner in keyboard mode types into it. **Use camera**
  reads codes with a phone's or tablet's camera instead, the backup when there's no scanner. The
  camera needs an `https://` address, or `localhost` on the same computer; browsers don't offer
  it on plain `http://<ip>`.
- **Account:** "Name customers see" sets the name shown on the TV board and on the join page.
- **A shared counter tablet:** once someone chooses "Trust this device" on the dashboard, staff
  switch in with their PIN at `/admin/login`.

### Customer

Customers don't need an account for the queue or for booking.

| Page                   | How they get there                      | What it's for                                                               |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `/q/<code>`            | Scanning the business's poster          | Join the queue (with an optional email for the ticket link), or book        |
| `/q/<code>/book`       | "Book an appointment" on the page above | Pick a service and time. The confirmation email has an add-to-calendar link |
| `/queue/t/<token>`     | After joining, or from the email        | The live ticket: place in line, wait estimate, QR code                      |
| `/appointment/<token>` | After booking, or from the email        | The booking: add to calendar, check in, its QR code, cancel                 |
| `/c/<code>`            | Scanning the business's sign-up poster  | Create an account or sign in                                                |
| `/c/portal`            | After signing in                        | **Home:** their personal QR, live ticket, next booking, Join / Book         |
| `/c/portal/visits`     | The menu (a tab bar on phones)          | Recent visits                                                               |
| `/c/portal/account`    | The menu                                | Their details, login codes by email or authenticator app, log out           |

Going back to a poster's page on the same phone offers "You're already in this queue" or "You
have a booking here" with a link back to it.

A signed-in customer gets their name, phone and email filled in on the join and booking forms.
Emails carry the QR code as an image. "You're in the queue" has the ticket's QR; booking
confirmations and reminders have the check-in QR. The API serves these images, so
`API_PUBLIC_URL` must be its public address.

### TV board

**`/display/<code>`**, opened on the screen at the location (the link is on the QR Codes page). It
shows Now serving (with staff names), the next three in line large, and the rest of the queue.

## Quality gate

```bash
pnpm quality
# = build && format:check && lint && typecheck && test && test:integration
```

Must pass before any task is considered done — see `AGENTS.md` §6–7. The web build goes to
`apps/web/.next-build`, so it's safe to run while `pnpm dev` is running.

## Deploying

Vercel (web), Render (API), Neon (Postgres) and Pingram (email). Follow
**`docs/runbooks/deploy.md`**; the `render.yaml` Blueprint and `apps/web/vercel.json` hold the
build settings. In production the API refuses to start until every required setting is present
and safe (ADR-019). After each deploy, run:

```bash
scripts/smoke.sh https://api.q.m9rcy.dev https://q.m9rcy.dev
```

## Repository structure

```text
queueflow/
├── apps/
│   ├── api/       NestJS + Prisma
│   └── web/       Next.js
├── packages/
│   ├── types/         shared TS types
│   ├── validation/    shared Zod schemas
│   ├── api-client/    typed fetch client
│   └── ui/            shared design-system components
├── docs/
│   ├── adr/           architecture decision records
│   └── status/         per-phase detail (linked from PROJECT_STATUS.md)
├── AGENTS.md
├── PROJECT_STATUS.md
└── docker-compose.yml  local Postgres + Redis
```
