import type { ConfigService } from "@nestjs/config";

/** A page on the web app (WEB_APP_URL) — for links in notifications. */
export function webAppUrl(config: ConfigService, path: string): string {
  const base = config.get<string>("WEB_APP_URL") ?? "http://localhost:4000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** A path on the API (API_PUBLIC_URL) — for images in emails (QR codes). */
export function apiPublicUrl(config: ConfigService, path: string): string {
  const base = config.get<string>("API_PUBLIC_URL") ?? "http://localhost:4001";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** Phase 19 — the ticket's QR (opens the live ticket), as an image for the "you're in" email. */
export function ticketQrImageUrl(config: ConfigService, publicToken: string): string {
  return apiPublicUrl(config, `/public/queue-entries/${publicToken}/qr.png`);
}

/** Phase 19 — a booking's check-in QR, as an image for its confirmation and reminder emails. */
export function checkInQrImageUrl(config: ConfigService, publicToken: string): string {
  return apiPublicUrl(config, `/public/appointments/${publicToken}/check-in-qr.png`);
}

/** The customer's appointment page — linked from the booked and reminder notifications. */
export function appointmentManageUrl(config: ConfigService, publicToken: string): string {
  return webAppUrl(config, `/appointment/${publicToken}`);
}

/** Phase 19 — the customer's live ticket page (with its QR), linked from the "you're in" email. */
export function ticketUrl(config: ConfigService, publicToken: string): string {
  return webAppUrl(config, `/queue/t/${publicToken}`);
}

/**
 * Phase 19 — a Google Calendar "add event" link for a booking, so the email
 * itself can put it in a calendar (other calendars use the .ics download on
 * the appointment page).
 */
export function googleCalendarUrl(params: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  details: string;
  location: string;
}): string {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${stamp(params.startsAt)}/${stamp(params.endsAt)}`,
    details: params.details,
    location: params.location,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
