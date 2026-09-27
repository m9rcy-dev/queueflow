export interface LocationSummary {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
}

/** One open period. A day with split hours has two entries with the same dayOfWeek (plan §39). */
export interface BusinessHoursEntry {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  opensAtMinutes: number; // minutes since local midnight
  closesAtMinutes: number;
}
