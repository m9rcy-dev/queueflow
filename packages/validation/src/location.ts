import { z } from "zod";

/**
 * Validates against the runtime's actual IANA timezone database
 * (`Intl.supportedValuesOf`, Node 18+ and all modern browsers) rather than a
 * hand-maintained list or a loose regex — a bad timezone here silently
 * breaks every business-hours/scheduling calculation from Phase 3 onward.
 * Falls back to a basic shape check if the runtime doesn't support the API.
 */
function isValidTimezone(value: string): boolean {
  try {
    const supported = Intl.supportedValuesOf?.("timeZone");
    if (supported) {
      return supported.includes(value);
    }
  } catch {
    // fall through to the loose check below
  }
  return /^[A-Za-z_]+\/[A-Za-z_]+$/.test(value);
}

const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimezone, { message: "Must be a valid IANA timezone (e.g. Pacific/Auckland)" });

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  timezone: timezoneSchema,
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

/** Appointment pool fields (Phase 13, G-23/ADR-012) are update-only — a new location starts at capacity 1, no daily cap. */
export const updateLocationSchema = createLocationSchema.partial().extend({
  appointmentCapacity: z.number().int().min(1).max(100).optional(),
  maxAppointmentsPerDay: z.number().int().min(1).max(1000).nullable().optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

const businessHoursEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAtMinutes: z.number().int().min(0).max(1439),
    closesAtMinutes: z.number().int().min(0).max(1439),
  })
  .refine((entry) => entry.closesAtMinutes > entry.opensAtMinutes, {
    message: "closesAtMinutes must be after opensAtMinutes",
    path: ["closesAtMinutes"],
  });

/** Full-replace semantics (budget-terry's Budget-update pattern) — the whole week is sent each time. */
export const replaceBusinessHoursSchema = z.object({
  entries: z.array(businessHoursEntrySchema).max(14), // at most 2 split periods/day, 7 days
});
export type ReplaceBusinessHoursInput = z.infer<typeof replaceBusinessHoursSchema>;
