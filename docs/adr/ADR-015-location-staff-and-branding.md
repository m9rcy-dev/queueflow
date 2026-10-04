# ADR-015: Staff Allocated to One Location, and Business Branding

**Status:** Accepted
**Date:** 2026-10-04
**Related:** ADR-003 (multi-tenancy), ADR-004 (authentication), D-03a (counter tablets), D-04;
supersedes Phase 2's "no per-location staff" note

## Context

A business can have several sites, and in practice most staff work at one of them. Until now every
member of a business could see and operate every location. The user also wanted businesses to
upload a logo for the customer-facing pages. Decided with the user on 2026-10-04.

## Decision

**Who is location-bound.** `TENANT_OWNER` and `TENANT_ADMIN` cover every location. `MANAGER` and
`STAFF` are allocated to exactly one (`TenantUser.locationId`), which is required when they're
invited or reassigned and absent for admins. A bound member with no location yet (e.g. a business
that had no location when the migration ran) can reach nothing location-scoped until assigned.

**Enforcement is server-side, per request.** The JWT strategy already re-reads the membership on
every request, so it now also reads the location. A reassignment or removal takes effect on the
next request, without waiting for the access token to expire. `LocationAccessService` is called by
controllers before any service work:

- `assertLocation` / `assertQueue` / `assertQueueEntry` / `assertService` / `assertAppointment`
  throw for a bound member and another location, and are no-ops (no query) for owner/admin.
- Each refusal is exactly the response the resource's own lookup gives when it doesn't exist (e.g.
  `QUEUE_NOT_FOUND`, "Queue not found."). Another location's queue is indistinguishable from no
  queue, the same principle as cross-tenant access (ADR-003).
- Lists (`locations`, `queues`, `services`) are narrowed to the member's own location; asking for
  another location's list returns an empty list.
- Business-wide data stays business-wide: customer accounts, appointment settings, the sign-up
  poster, the tenant summary. Owner/admin-only routes are unaffected.

An integration test sweeps every location-scoped staff route as a Staff member of another location,
and asserts each response equals the not-found response for a random id. Removing any one guard
fails it (verified by deliberately deleting one).

**Counter tablets belong to a location (D-03a, extended).** `DeviceTrust.locationId`: a tablet's
PIN list shows that location's staff plus owner/admins, and PIN login is refused for anyone else.
The location comes from the member's own location, else the one the client sends (the queue
dashboard sends its queue's), else the business's only location. A multi-location owner/admin who
names none gets `LOCATION_REQUIRED`. Tablets trusted before this phase keep `null`
(business-wide) until they're trusted again.

**Team management.** Owner/admin can change a member's role and location, and remove them. The
owner can't be changed, and nobody can change or remove themselves. Removal is **soft**
(`removedAt`): sessions are revoked and every sign-in route refuses the member, but past queue
actions keep their attribution (D-03a's audit trail; a hard delete would null
`assignedStaffId`). Re-inviting the same email reactivates the membership. Invites carry the
location, the invite email contains a link to a new `/invite/{token}` page, and the invitee gives
their name there (previously invited staff were named by their email address).

**Logo.** One per business, in its own `TenantLogo` table so the bytes are never loaded by the many
queries that read `Tenant`.

- Stored in Postgres rather than on disk (the free hosting tier's disk is wiped on restart) or in
  object storage (no extra account for one small image per business).
- PNG, JPEG or WebP only, identified by magic bytes, never the declared `Content-Type`. No SVG,
  since it can carry script.
- Capped at 500 KB. A streaming middleware cuts off oversize uploads early (413).
- Uploaded as the raw request body, so no multipart library is added.
- Served publicly at `/public/tenants/{id}/logo?v={uploadTime}` with
  `Cache-Control: immutable` (a new upload is a new URL), `nosniff`, and
  `Cross-Origin-Resource-Policy: cross-origin` (helmet's same-origin default would block the web
  app, a different origin). The web CSP's `img-src` allows the API origin.
- Shown on the queue poster page, booking, appointment and live-ticket pages, the TV board, the
  customer portal and sign-up page. API responses carry an API-relative `logoPath` (or `null`).

## Consequences

- A forgotten guard on a new location-scoped route would leak data across a business's sites. The
  route sweep catches it only if the route is added to the sweep, so new routes must be added there
  (noted in the test).
- Logos make the database slightly larger (at most 500 KB per business), which is acceptable.
  Moving to object storage later is a contained change behind `TenantLogoService`.
- A business with several locations must trust each tablet from that location's queue dashboard;
  the "remember this device" checkbox on the login screen can't know which location is meant.
