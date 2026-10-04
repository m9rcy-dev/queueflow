/** CHECKED_IN and NO_SHOW arrived with Phase 14 (check-in, §77). */
export type AppointmentStatus = "BOOKED" | "CANCELLED" | "CHECKED_IN" | "NO_SHOW";

export type AppointmentCancellationReason =
  "CUSTOMER_REQUESTED" | "BUSINESS_INITIATED" | "NO_AVAILABILITY" | "BUSINESS_CLOSURE" | "OTHER";

/** Tenant-wide slot-grid settings (G-22/ADR-012). */
export interface AppointmentSettings {
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minLeadMinutes: number;
  advanceDays: number;
  cancelNoticeMinutes: number;
  /** G-25: a checked-in appointment goes ahead of walk-ins from this many minutes before its start. */
  priorityWindowMinutes: number;
  /** §77: BOOKED becomes NO_SHOW this long after start without a check-in. */
  noShowGraceMinutes: number;
  /** §75: reminder times, in minutes before start, largest first. */
  reminderOffsetsMinutes: number[];
}

export interface LocationClosureSummary {
  id: string;
  /** Location-local YYYY-MM-DD. */
  date: string;
  /** Both null = closed all day. */
  startMinutes: number | null;
  endMinutes: number | null;
  reason: string | null;
}

/** One bookable start. `localTime` is HH:MM in the location's timezone, for display without client-side tz math. */
export interface AppointmentSlot {
  startsAt: string;
  endsAt: string;
  localTime: string;
}

export interface AppointmentAvailability {
  date: string;
  timezone: string;
  slots: AppointmentSlot[];
}

/** What the customer sees on their own manage page — no other customer's data, no staff names. */
export interface PublicAppointmentSummary {
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  tenant: { name: string };
  location: { name: string; address: string | null };
  service: { name: string; durationMinutes: number };
  /** False once the customer self-cancel window has passed (§76), or already cancelled. */
  canCancel: boolean;
  cancelDeadline: string;
  cancellationReason: AppointmentCancellationReason | null;
  /** The APPOINTMENT_TICKET code (D-12) — shown as a QR for the counter scanner. Null once it can no longer be used. */
  checkInCode: string | null;
  /** True on the appointment's own day while still BOOKED — the "I'm here" button. */
  canCheckIn: boolean;
  /** Once CHECKED_IN: the queue ticket's token, for its live page (/queue/t/{token}). */
  queueTicketToken: string | null;
}

export interface BookAppointmentResponse extends PublicAppointmentSummary {
  publicToken: string;
}

/** A signed-up customer's upcoming bookings in the portal (each still managed via its own token). */
export type CustomerUpcomingAppointment = BookAppointmentResponse;

export interface StaffAppointmentSummary {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  service: { id: string; name: string };
  customer: { firstName: string | null; phoneE164: string };
  /** True when staff booked it on the customer's behalf (a phone booking). */
  bookedByStaff: boolean;
  cancelledAt: string | null;
  cancellationReason: AppointmentCancellationReason | null;
  cancellationNote: string | null;
  checkedInAt: string | null;
  /** Set when the no-show job marked it, and kept even if staff restored it (ADR-013). */
  noShowAt: string | null;
}

export interface AppointmentCalendarDay {
  date: string;
  /** BOOKED + CHECKED_IN — cancelled and no-show ones don't count toward a day's load. */
  count: number;
}

/** Creating a closure over existing bookings is allowed (G-26); these are what staff should now cancel or keep. */
export interface CreateClosureResponse {
  closure: LocationClosureSummary;
  affectedAppointments: StaffAppointmentSummary[];
}
