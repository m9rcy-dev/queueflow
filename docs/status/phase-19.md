# Phase 19: Hours, Branding, Platform Admin & Local Email

**Status:** Done (2026-10-05). Branch `feature/QF-019-hours-platform-branding`, from Phase 18's
branch.

**Decisions:** ADR-018. From the user:

- QueueFlow records hours only; pay goes to a point-of-sale system later;
- a QueueFlow logo, visible alongside the business's logo;
- a root admin who can see every business and the services it subscribes to;
- Mailpit for local email.

My defaults, easy to change:

- **Hours visibility:** Staff see their own hours, Managers their location's, owner/admin everyone's.
- **Corrections:** someone else must fix your hours.
- **Platform admins:** set by an email allow-list.
- **Platform view:** read-only, with no customer data.
- **Services subscribed:** read as the business's capabilities (Queue, Appointments). The business's
  own service list is shown as well.

## What was built

**Local email:**

- `mailpit` in `docker-compose.yml`, on ports 1026/8026 so it doesn't clash with budget-terry's.
- `SmtpEmailProvider` (`EMAIL_PROVIDER=smtp`), now the `.env.example` default.
- Verified: a platform login code arrived in the Mailpit inbox.

**Hours:**

- `GET /tenants/me/shifts`, scoped by role, with totals.
- `PATCH /tenants/me/shifts/:id` to correct a shift, recorded as "corrected by" (migration
  `20261005100000_add_shift_edits`).
- **Hours** page (in everyone's menu):
  - This week / Last week / This month / Last month / Custom;
  - a location filter;
  - totals and every shift;
  - **Export CSV**;
  - **Fix** on someone else's shift.

**Branding:**

- The `QueueFlowLogo`, `QueueFlowMark` and `PoweredByQueueFlow` components, plus
  `public/queueflow-mark.svg`. The app icons were regenerated from it.
- The business logo is now in the app shell header, for both business and customer, with "Powered
  by QueueFlow" in the sidebar footer.
- Staff sign-in shows the QueueFlow logo, plus the business logo on a trusted tablet.
  `/auth/me` and the device context now include the logo path.
- Customer pages (join, booking, ticket, appointment, sign-up) have a "Powered by QueueFlow"
  footer, and the TV board has it in the header.

**Platform admin:**

- `PLATFORM_ADMIN_EMAILS` allow-list.
- Endpoints: `/platform/login/request`, `/platform/login/verify`, `/platform/me`,
  `/platform/tenants` and `/platform/tenants/:id`.
- The platform token has its own signing key, and the allow-list is re-checked on every request.
- Web: `/platform` (sign in, then a searchable business list) and `/platform/tenants/[id]`
  (capabilities, locations, services, team, 30-day activity).

## Tests

- **Unit, 298:** the allow-list matching (case, spacing, no substring matches), the SMTP provider
  (Mailpit defaults, credentials, escaped HTML), and the device context's logo.
- **Integration, 138:** new `hours-and-platform.integration-spec.ts` (5 tests), covering:
  - report scoping for all four roles, including a Staff member asking for someone else's hours
    and a Manager asking about another location;
  - range validation;
  - corrections: not your own, not by Staff, no future times, no backwards times, no overlaps;
    edits are recorded, and closing a forgotten shift releases that person's customers;
  - platform sign-in and the business view: capabilities, counts, locations, services, and no
    customer data;
  - session separation in both directions; non-admins get the same 202 with no code issued or
    account created; removing an email from the list locks that admin out at once.
- **Manual, against a check API on port 4002** (EMAIL_PROVIDER=smtp, an admin email allowed):
  requesting a platform code put it in Mailpit; signing in with it returned a token; the business
  list showed the real local businesses (Demo Barbers, Kiri's Clinic, …) with their capabilities.
  The check server and its test emails were removed afterwards.

## Not yet checked in a browser

The new and re-branded screens haven't been opened:

- Hours;
- `/platform`;
- the shells with logos;
- the sign-in pages;
- the TV board's corner mark.

A second web dev server would share `.next` with the user's running one and break it, the same
way `pnpm quality` did in Phase 17. All of these pass typecheck and lint.

## To use locally

- Run `docker compose up -d mailpit`, set `EMAIL_PROVIDER="smtp"` in `.env`, and open
  http://localhost:8026.
- Add your email to `PLATFORM_ADMIN_EMAILS` in `.env`, restart `pnpm dev`, then open
  http://localhost:4000/platform.
