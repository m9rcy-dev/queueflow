export interface LocationSummary {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  /** Appointment pool size (Phase 13, G-23) — how many bookings may overlap at once. */
  appointmentCapacity: number;
  /** Per-day booking ceiling (G-26); null = no cap. */
  maxAppointmentsPerDay: number | null;
}

/** One open period. A day with split hours has two entries with the same dayOfWeek (plan §39). */
export interface BusinessHoursEntry {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  opensAtMinutes: number; // minutes since local midnight
  closesAtMinutes: number;
}
