# Phase 16 — Team & Branding

**Status:** Done (2026-10-04). Branch `feature/QF-016-team-and-branding` (from Phase 15's branch).
**Decisions:** ADR-015. Agreed with the user before building:

- Owner/Admin see every location; Manager/Staff work at exactly one.
- A counter tablet belongs to one location.
- Logos are stored in the database.
- This phase covers team and branding; the first deploy follows as Phase 17.

## What was built

**Schema** (`20261004120000_add_location_staff_and_logo`):

- `TenantUser.locationId` and `removedAt`, `TenantInvite.locationId`, `DeviceTrust.locationId`, and
  a `TenantLogo` table.
- Backfill: existing Managers/Staff and their pending invites get their business's first location.

**API:**

- `access/LocationAccessService` (global module). Location checks were added to 33 staff routes
  across locations, services, queues, queue entries, queue codes, guest cards and appointments, and
  the location/queue/service lists are narrowed.
- `RequestUser.locationId`, read fresh on every request in `JwtStrategy`. Removed members are
  refused by the strategy, login, tenant selection, refresh, the tablet staff list and PIN login.
- `PATCH`/`DELETE /tenants/me/staff/:id` (owner/admin; owner and self protected; soft removal
  revokes sessions). Invites validate and carry the location.
- `GET /auth/invites/:token` (details for the acceptance page); invite acceptance takes a
  `displayName` and reactivates a removed membership.
- Tablet trust takes an optional `locationId` (`LOCATION_REQUIRED` when ambiguous); the device
  context returns the tablet's location and only eligible staff.
- `PUT`/`DELETE /tenants/me/logo` and `GET /public/tenants/:id/logo`, with
  `RawImageBodyMiddleware` (streaming, hard limit) and magic-byte validation. `logoPath` was added
  to the tenant, code, display, appointment, portal and public-ticket responses (the public ticket
  is now `PublicTicketSummary`, with the business name too).
- The invite email links to `${WEB_APP_URL}/invite/{token}` instead of a bare code.

**Web:**

- New `/invite/[token]` page: shows the business, role and location; asks the person's name;
  emails a code; the code box auto-submits and signs them in.
- Staff page: invite with role and location, the location on each member, inline change, and
  remove with confirmation.
- `BusinessLogo` on the queue, booking, appointment, ticket, TV board, portal and sign-up pages, and
  a Logo card in Settings (client-side pre-check, server re-check).
- The queue dashboard's "Trust this device" sends its queue's location.
- The admin menu hides Staff/Settings from managers/staff, and those pages explain rather than
  render blank. "+ New queue" and "+ New location" are hidden from non-admins.

**Fixed along the way:**

- The staff client never retried after a token refresh on any `/auth/*` path, so Phase 15's
  authenticator settings (under `/auth/me/authenticator`) failed outright once the access token
  expired. Now only the sign-in endpoints themselves skip the retry.
- The UI package's tsconfig needed the DOM lib (Phase 15's code box reads input values).

## Tests

- Unit: `location-access.service.spec.ts` (5), `tenant-logo.service.spec.ts` (4), and tablet-location
  cases in `auth.service.spec.ts` (+2), plus fixture updates for `logoPath` and member locations.
  **290 unit total.**
- Integration: `team-and-branding.integration-spec.ts` (7), covering:
  - **the route sweep**: 31 location-scoped routes, each refusal byte-identical to a missing id;
    verified by deleting one guard, which made it fail naming that route;
  - list narrowing;
  - invite validation, the email link, invite details and acceptance with a name;
  - reassignment and promotion taking effect on the same token;
  - owner and self protection;
  - soft removal (locked out, refresh refused, history kept, re-invite reactivates);
  - the tablet location (`LOCATION_REQUIRED`, PIN list filtered, another location's staff refused);
  - the logo (role-gated, SVG refused even when labelled PNG, 413 over the limit, public headers,
    shown on the poster page, removal).

  The older suites were updated for the new rules: staff invites and tablets now get a location, and
  exact-match expectations gained `logoPath`. **119 integration total.**

- Manual, with both dev servers on mock providers:
  - uploaded a real PNG in Settings; it showed on the queue poster page and the live ticket, with no
    CSP errors;
  - invited "riccarton-staff@example.com" as Staff at Riccarton; the email had the link; the invite
    page showed the role and location; entered a name; pasting the code joined and signed in;
  - as that staff member, the menu showed only Queues/Appointments/Locations/Account and there was
    no "+ New queue";
  - `/admin/staff` explained instead of rendering blank.

## Known limitations

- The location detail page's edit forms (hours, closures, appointment limits) still show to
  managers/staff viewing their own location; saving is refused by the API (owner/admin-only).
  Hiding them is a small follow-up.
- The login screen's "remember this device" checkbox silently does nothing for a multi-location
  owner/admin (the API needs to know which location). Use the queue dashboard's "Trust this device"
  instead.
- New location-scoped routes must be added to the route sweep test to be covered by it.
- Local demo data now includes a staff member ("Rangi Staff", riccarton-staff@example.com) and a
  test logo for Kiri's Clinic, and the browser profile used for testing is signed in as that staff
  member.
