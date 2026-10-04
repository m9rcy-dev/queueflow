# ADR-016: The Manager Role, Role-Based Navigation, and Recording Who Served

**Status:** Accepted
**Date:** 2026-10-04
**Related:** ADR-015 (staff per location); Phase 18–19 plans in `docs/roadmap.md`

## Context

After Phase 16, Manager and Staff had identical permissions, and the admin UI was a row of links on
top of each page. The user asked for budget-terry's navigation pattern, a single place for QR
codes, a proper customer area, and (looking ahead to pay) a record of which staff member served
each customer. Decided with the user on 2026-10-04.

## Decision

**Manager runs their own location.** On top of everything Staff can do, a Manager can:

- edit their location (details, hours, closures, guest-card pool);
- create and edit its services and queues (including attaching only their own location's
  services);
- create and deactivate its queue posters and TV links;
- see its team and invites, invite **Staff** to it, revoke those invites, and remove **Staff** at
  it.

Every one of these is the existing owner/admin route with `MANAGER` added to `@Roles` and a
`LocationAccessService` check (ADR-015), including on body-supplied ids (`locationId`,
`serviceId`). A refusal for another location is the same 404 as a missing resource.

Still owner/admin only: creating locations, changing anyone's role or location, inviting
Admins/Managers, removing a Manager, appointment settings, capabilities, the logo, and the
business sign-up poster. An integration test sweeps the Manager-writable routes against another
location; deleting one guard fails it (verified).

**Navigation.** An app shell after budget-terry's `AppShell`: a left sidebar on desktop and a
hamburger-opened drawer on narrow screens, one menu in both, with the signed-in person at the bottom
opening a profile menu (Account, Set up PIN, Log out). The menu follows the role, and only offers
what the API allows:

| Role        | Menu                                                        |
| ----------- | ----------------------------------------------------------- |
| Owner/Admin | Queues, Appointments, QR Codes, Locations, Staff, Settings  |
| Manager     | Queues, Appointments, QR Codes, Location (their own), Staff |
| Staff       | Queues, Appointments                                        |

Appointments is hidden when the capability is off. `/auth/me` now returns the profile the shell
needs (name, email, business, location, appointments on/off). "Trust this device" stays on a
queue's dashboard because a tablet belongs to that queue's location (ADR-015). The customer area
uses the same shell: Queues (live ticket plus the last 10 visits), Appointments, QR Codes (personal
code plus each booking's check-in code), with Account and Log out under their name.

**QR Codes page.** Every code in one place, grouped by location: each queue's customer poster
(preview, copy, print, create/deactivate) and TV-board link, the guest-card pool with a printable
card sheet, and (owner/admin) the sign-up poster. Printing opens a clean page in a new tab.

**Who served.** `queue_entry.servedByStaffId`, separate from `assignedStaffId` (who called):

- set by whoever presses **Start**, unless the customer was already **handed over**;
- a hand-over (`POST /queue-entries/:id/hand-over`) moves a called or in-progress customer to any
  active member who can work at that location (owner/admin, or allocated there); nobody else;
- existing started entries were backfilled from who called them.

This is what per-staff reporting and pay (Phase 19) will count. A `GET /locations/:id/team` list,
readable by any member of the location, feeds the hand-over picker.

## Consequences

- Manager permissions are spread across about 16 route decorators plus guards. The Manager route
  sweep test is the safety net, so new Manager-writable routes must be added to it.
- Hand-over is only checked for eligibility, not logged as an event; the last value wins. If pay
  disputes need a full history ("who held this customer when"), that's an audit table later.
