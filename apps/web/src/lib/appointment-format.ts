import type { AppointmentCancellationReason } from "@queueflow/types";

/**
 * Appointment display helpers (Phase 13). Every time is shown in the
 * location's own timezone — never the viewer's browser timezone, which can
 * differ (a customer abroad, a staff laptop set to UTC).
 */
export function formatTimeIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDateTimeIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** A YYYY-MM-DD calendar date as "Tue 10 Nov" — formatted as UTC since it's already a plain date. */
export function formatLocalDate(date: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Today's YYYY-MM-DD in a timezone. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function minutesToClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function clockToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export const CANCELLATION_REASON_LABELS: Record<AppointmentCancellationReason, string> = {
  CUSTOMER_REQUESTED: "Customer requested",
  BUSINESS_INITIATED: "Business initiated",
  NO_AVAILABILITY: "No availability",
  BUSINESS_CLOSURE: "Business closure",
  OTHER: "Other",
};
