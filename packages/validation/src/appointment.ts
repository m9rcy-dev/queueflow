import { z } from "zod";

/** A location-local calendar date — never a UTC instant, since "which day" depends on the location's timezone. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Must be a real calendar date",
  });

/** Tenant-wide slot-grid settings (G-22/ADR-012, plan §70). Partial update — only what's sent changes. */
export const updateAppointmentSettingsSchema = z
  .object({
    slotIntervalMinutes: z.number().int().min(5).max(240).optional(),
    bufferMinutes: z.number().int().min(0).max(240).optional(),
    minLeadMinutes: z
      .number()
      .int()
      .min(0)
      .max(14 * 24 * 60)
      .optional(),
    advanceDays: z.number().int().min(0).max(365).optional(),
    cancelNoticeMinutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60)
      .optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one setting must be provided",
  });
export type UpdateAppointmentSettingsInput = z.infer<typeof updateAppointmentSettingsSchema>;

/** Full-day when both minute bounds are omitted; otherwise a [start, end) local-minute range (G-24). */
export const createClosureSchema = z
  .object({
    date: localDateSchema,
    startMinutes: z.number().int().min(0).max(1439).optional(),
    endMinutes: z.number().int().min(1).max(1440).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((data) => (data.startMinutes === undefined) === (data.endMinutes === undefined), {
    message: "startMinutes and endMinutes must be given together (or both omitted for a full day)",
    path: ["endMinutes"],
  })
  .refine(
    (data) =>
      data.startMinutes === undefined ||
      data.endMinutes === undefined ||
      data.endMinutes > data.startMinutes,
    { message: "endMinutes must be after startMinutes", path: ["endMinutes"] },
  );
export type CreateClosureInput = z.infer<typeof createClosureSchema>;

export const listClosuresQuerySchema = z.object({
  from: localDateSchema.optional(),
});
export type ListClosuresQuery = z.infer<typeof listClosuresQuerySchema>;

export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  date: localDateSchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * Same identity fields as a walk-in join (`joinQueueSchema`) — booking is
 * anonymous name + phone (ADR-012). `startsAt` must be one of the slot
 * instants availability returned; the server re-validates it under lock.
 */
export const bookAppointmentSchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  customerName: z.string().trim().min(1).max(200),
  customerPhone: z.string().trim().min(1).max(30),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const appointmentCancellationReasons = [
  "CUSTOMER_REQUESTED",
  "BUSINESS_INITIATED",
  "NO_AVAILABILITY",
  "BUSINESS_CLOSURE",
  "OTHER",
] as const;

/** Staff cancel — the reason is required (plan-review §5.5 calendar requirement). */
export const staffCancelAppointmentSchema = z.object({
  reason: z.enum(appointmentCancellationReasons),
  note: z.string().trim().max(500).optional(),
});
export type StaffCancelAppointmentInput = z.infer<typeof staffCancelAppointmentSchema>;

export const appointmentCalendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be a month in YYYY-MM format"),
});
export type AppointmentCalendarQuery = z.infer<typeof appointmentCalendarQuerySchema>;

export const appointmentDayQuerySchema = z.object({
  date: localDateSchema,
});
export type AppointmentDayQuery = z.infer<typeof appointmentDayQuerySchema>;
