# Phase 17 — Navigation, Roles & QR Codes

**Status:** Done (2026-10-04). Branch `feature/QF-017-navigation-and-roles` (from Phase 16's branch).
**Decisions:** ADR-016. Agreed with the user: the Manager runs their location; the QR Codes page
covers everything and is printable; the customer Queues section shows current plus the last 10
visits; this phase comes before the deploy. Also recorded for Phase 18: staff names (or aliases) on
the TV board are fine.

## What was built

**TV board:**

- Two panels: **Now serving** and **Waiting**.
- Up to 12 waiting tickets, as large tiles labelled with their place ("2nd", "3rd", …), with the
  next one highlighted.
- A count of people waiting, and "…and N more".
- The logo sits beside the business name.
- Sizes follow the screen (`vw`/`clamp`), so it reads across a room.
- `DisplaySnapshot.waitingCount` is new.

**API:**

- **Manager permissions** across locations, services, queues, codes, guest cards, closures and
  invites. 12 more routes opened to `MANAGER`, each with a location guard, including body ids.
- **Manager team management:** the roster and invites are scoped to their location; they can only
  invite Staff to their own location, and only remove Staff.
- **Who served:** `servedByStaffId` (migration `20261004150000_add_served_by` with a backfill).
  Start records the actor unless the customer was handed over; `POST /queue-entries/:id/hand-over`
  is checked for eligibility.
- New endpoints: `GET /locations/:id/team` (any member there) and `GET /customers/me/visits`.
  `/auth/me` returns the shell profile.

**Web:**

- `Shell` (generic), `AppShell` (business, menu by role) and `CustomerShell`, plus an `icons` set.
  Every admin page moved onto the shell; `AdminNav` was deleted.
- New pages: `/admin/codes` (QR Codes), `/admin/codes/print` (poster) and
  `/admin/codes/guest-cards/[locationId]` (card sheet).
- The queue dashboard shows "with {who's serving}" and a **Hand over to…** picker on called and
  in-progress customers.
- The Staff page has a Manager mode: invite Staff to their location, Remove on Staff only, no
  Change.
- The customer area is now four pages under `/c/portal`: Queues, Appointments, QR Codes, Account.

## Tests

- Unit: 290 (updated for `start`'s actor and `waitingCount`).
- Integration: new `manager-and-served-by.integration-spec.ts` (6), covering:
  - the Manager running their location end to end;
  - **the Manager route sweep**: 14 management routes against another location, all 404, with
    nothing changed. Verified: removing the `attachService` service guard made it fail, naming that
    route. That guard had been mis-inserted during development and was caught while writing this
    test;
  - Manager team limits;
  - Staff refused management but able to operate;
  - served-by via Start and hand-over (before and during service), with refusals for another
    location's staff, a waiting customer and a finished one;
  - customer visits with the served-by name.

  **125 integration total.**

- Manual, on the user's running dev servers (signed in as the Kiri's Clinic demo owner):
  - the sidebar shell with the owner's menu and profile;
  - the QR Codes page;
  - the printable poster;
  - the queue dashboard in the shell;
  - the TV board with 14 waiting (two priority appointments first, as expected).

## Not yet checked in a browser

My browser tab was closed partway (the user was likely using Chrome), so I stopped rather than
interrupt. Not yet seen live:

- the hand-over picker after Call next;
- a Manager's and a Staff member's menus;
- the customer area's four pages;
- the mobile drawer;
- the guest-card print sheet.

The API behind all of them is covered by the integration tests above.

## Found along the way

- **`pnpm quality` breaks a running `next dev`.** Its production build of the web app overwrites the
  `.next` folder the dev server is using, so the running app loses its styling. It happened to the
  user's servers mid-phase; I restarted their web server. Until the build gets its own output
  folder, don't run `pnpm quality` while `pnpm dev` is running (or run `pnpm dev` again
  afterwards).
- A failed migration attempt (an empty migration with a backfill for a missing column) was recorded
  in the local dev database. Postgres rolled it back, so no data changed. It was marked
  rolled-back and redone properly, with a guard so an empty diff can't be applied again.
- The profile footer scrolled off long pages; the sidebar now stays at the window's height.

## Known limitations

- The business sign-up screen is still API-only (Phase 20 at the latest).
- Hand-overs keep only the latest person, not a history (see ADR-016).
- The customer Appointments page links to each booking but can't start a new one (booking still
  starts from a location's QR poster, since the portal doesn't know which location the customer
  wants).
