# ADR-018: Hours Only, a Platform Admin, and Co-Branding

**Status:** Accepted
**Date:** 2026-10-05
**Related:** ADR-017 (shifts), ADR-014 (authenticator codes), ADR-015 (location scoping)

## Context

The user decided Phase 19's scope (2026-10-05):

- QueueFlow only records hours. Pay goes through a point-of-sale system, integrated later (or one
  we build ourselves).
- QueueFlow needs its own logo, visible alongside each business's logo when businesses and
  customers sign in.
- The site's administrators need root access to view every business and the services each
  subscribes to.
- Local development needs a real inbox (Mailpit, as in budget-terry).

## Decision

**Hours.** The hours report is `GET /tenants/me/shifts?from&to`. It returns ADR-017's shift rows
in that range, plus each person's total.

- Scope follows the role: owner/admin see everyone; a Manager sees their location (asking about
  another location returns an empty report, not an error); Staff see only their own hours.
- Open shifts count up to now. The range is capped at about 3 months.
- **No pay rules here.** There are no rates, commission or prices. The web page exports a CSV for
  the point-of-sale or payroll system. CSV fields are quoted and a leading `= + - @` is neutralised
  (formula injection).

**Corrections.** `PATCH /tenants/me/shifts/:id` sets new start and end times.

- Allowed: owner/admin anywhere, a Manager at their location.
- Never your own shift, because hours are pay and someone else should sign them off.
- Refused: times in the future, an end before the start, overlapping another shift, or reopening a
  finished shift.
- Each correction records who made it and when (`editedById`, `editedAt`), and the report shows
  "corrected by …".
- Closing someone's forgotten open shift takes them off the floor, the same as clocking out: their
  waiting customers go back to "anyone".

**Platform admin.** QueueFlow's operators are an allow-list of emails in `PLATFORM_ADMIN_EMAILS`,
not a role in any business.

- **Sign-in** is at `/platform`, using an emailed or authenticator code as for staff. An
  allow-listed email with no account gets one. Anyone else gets the same 202 and no code, so the
  endpoint never reveals who the admins are.
- **Token:** the platform token is signed with a key derived from the access secret but different
  from it. A platform token can't be used as a staff or customer token, and the reverse. It lasts
  4 hours and can't be refreshed.
- **Revoking:** every request re-checks the allow-list, so removing an email locks that person out
  immediately.
- **The view is read-only:**
  - each business, its owner and when it joined;
  - its capabilities, i.e. the services it subscribes to (Queue, Appointments);
  - its locations, its own service catalogue and the size of its team;
  - ticket and booking counts for the last 30 days.

  It never shows customer names or phones, or queue contents.

**Co-branding.** QueueFlow's mark is a QR finder pattern as the bowl of a Q, with a line of dots
as the tail (`public/queueflow-mark.svg`, which also produces the app icons). The business leads
and QueueFlow is always visible:

- **App shells (business and customer):** the business's logo and name at the top, "Powered by
  QueueFlow" at the bottom.
- **Staff sign-in:** QueueFlow's logo, plus the business's logo on a trusted counter tablet (it
  knows its business).
- **Customer pages and the TV board:** the business logo first, "Powered by QueueFlow" in the
  footer or corner.

**Local email.** `EMAIL_PROVIDER=smtp` (nodemailer) sends to docker-compose's Mailpit. Its inbox
is at http://localhost:8026, and it uses ports 1026/8026 so it can run next to budget-terry's
Mailpit. Any SMTP relay works with `SMTP_*`. It's the `.env.example` default; Pingram stays the
production choice.

## Consequences

- Phase 19's earlier plan (service prices, commission, recording payments) is dropped for now.
  Service duration exists, but there's no price field yet.
- `PLATFORM_ADMIN_EMAILS` must be set at deploy (Phase 20). If it's empty, nobody can use
  `/platform`, which is the safe default.
- Platform admins can't change anything yet (suspend a business, switch capabilities). That would
  need an audit log first.
- Corrections keep only the latest values and who made them, not every earlier version. That's
  enough for a pay-period sign-off; a full history would be an audit table later.
