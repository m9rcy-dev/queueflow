# Phase 18: Staff on Shift & Preferred Staff

**Status:** Done (2026-10-05). Branch `feature/QF-018-shifts-and-preferred-staff`, from Phase 17's
branch.

**Decisions:** ADR-017. The user didn't answer the two open questions, so the proposed defaults
were used:

- If a staff member clocks out, their customers go back to "anyone", keeping their place, and are
  told.
- The walk-in queue only gets preferences, not bookings.

Both are easy to revisit.

## What was built

**API:**

- Migration `20261005090000_add_shifts_and_preferred_staff` adds:
  - `staff_shifts`, with a partial unique index allowing one open shift per member;
  - `queue_entries.preferredStaffId`;
  - `tenant_users.publicName`;
  - a new notification type, `PREFERRED_STAFF_UNAVAILABLE`.
- Endpoints:
  - `GET /tenants/me/shifts/me`;
  - `POST /tenants/me/shifts/clock-in` and `/clock-out`;
  - `GET /tenants/me/locations/:id/on-shift`;
  - `PATCH /tenants/me/queue-entries/:id/preference`;
  - `PATCH /auth/me/public-name`.
- Joining accepts `preferredStaffId`, which must be someone on shift at that location. A QUEUE
  code's landing info lists `onShiftStaff` by public name.
- Call Next skips customers waiting for someone else, keeping their place. Positions, wait
  estimates and "nearly your turn" notifications count only the customer's own line (`competesWith`).
- Clocking out, or being removed, releases that person's waiting customers and tells them.
- The TV board snapshot has `nowServing[].staffName` and `next[].preferredStaffName`.
  `next` is now a list of objects rather than ticket numbers.

**Web:**

- **Join page:** "Who would you like?" buttons, "Anyone (quickest)" plus whoever is on shift. They
  are shown only when someone is clocked in.
- **Ticket:** "Waiting for Ana" and "N people ahead for Ana".
- **Queue dashboard:**
  - a shift bar showing Clock in or out and who's working now;
  - Call Next shows "N for you · M waiting" and is disabled when there's nobody for you;
  - waiting customers have a "for Ana" badge and a **Wants** picker.
- **TV board:** "with Ana" under each ticket being served, and "for Ana" on waiting tiles.
- **Account:** a "Name customers see" setting (an alias, or blank for your own name).

## Tests

- Unit: 293. These add `canServe` and `competesWith`, and the board's staff names and aliases.
- Integration: new `shifts-and-preferences.integration-spec.ts` (8 tests), covering:
  - clock in and out, including a double tap racing, the location rules and on-shift listing;
  - choosing only someone on shift, by public name;
  - Call Next skipping while the skipped customer keeps their place, with positions for each line;
  - **two staff calling at the same moment for 4 rounds**: never the same customer, and never one
    meant for the other;
  - clocking out and removal releasing customers in place, with the notice sent;
  - changing a preference at the counter;
  - the TV board names.

  Verified: removing the Call Next filter makes the two Call Next tests fail. **133 integration tests
  in total.**

- Not yet checked in a browser; see below.

## Not yet checked in a browser

To avoid taking over the user's Chrome, the new screens haven't been opened yet: the join page
picker, the dashboard shift bar and Wants picker, the TV tags, and the Account name setting. The
API behind them is covered above.

## Found along the way

- Running `prisma generate` while the user's `pnpm dev` was running left the API watcher reporting
  stale type errors against a half-written Prisma client. The served code was correct. Restarting
  `pnpm dev` clears the errors.
- One full integration run had the new suite fail entirely in setup while every other suite passed.
  It passed on its own and in the next two full runs, so it looks like a container start-up hiccup
  under load.
