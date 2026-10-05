import { z } from "zod";

/** Same "nearlyNext must not be looser than approaching" check on both create and update — a same-request misconfiguration, not a DB constraint (see schema comment on Queue). */
function refineThresholdOrdering<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (data: { approachingThreshold?: number; nearlyNextThreshold?: number }) =>
      data.approachingThreshold === undefined ||
      data.nearlyNextThreshold === undefined ||
      data.nearlyNextThreshold <= data.approachingThreshold,
    {
      message: "nearlyNextThreshold must be <= approachingThreshold",
      path: ["nearlyNextThreshold"],
    },
  );
}

const queueConfigFields = {
  servingCapacity: z.number().int().min(1).max(50).optional(),
  maxActiveTicketsPerCustomer: z.number().int().min(1).max(10).optional(),
  maxRecallCount: z.number().int().min(0).max(10).optional(),
  recallGracePeriodMinutes: z.number().int().min(1).max(60).optional(),
  // Notification thresholds (G-31/Phase 7), in people-ahead.
  approachingThreshold: z.number().int().min(0).max(100).optional(),
  nearlyNextThreshold: z.number().int().min(0).max(100).optional(),
};

export const createQueueSchema = refineThresholdOrdering(
  z.object({
    locationId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    ...queueConfigFields,
  }),
);
export type CreateQueueInput = z.infer<typeof createQueueSchema>;

export const updateQueueConfigSchema = refineThresholdOrdering(
  z.object({
    name: z.string().trim().min(1).max(200).optional(),
    ...queueConfigFields,
  }),
);
export type UpdateQueueConfigInput = z.infer<typeof updateQueueConfigSchema>;

export const updateQueueStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]),
});
export type UpdateQueueStatusInput = z.infer<typeof updateQueueStatusSchema>;

export const attachServiceSchema = z.object({
  serviceId: z.string().uuid(),
});
export type AttachServiceInput = z.infer<typeof attachServiceSchema>;

/**
 * The anonymous walk-in join (plan §19 — "own phone scan, type name +
 * mobile"). idempotencyKey is generated and persisted by the browser
 * across retries (G-21) — the server never invents one.
 */
export const joinQueueSchema = z.object({
  serviceId: z.string().uuid(),
  customerName: z.string().trim().min(1).max(200),
  customerPhone: z.string().trim().min(1).max(30),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
  /** Phase 18: who they'd like to be served by (on shift now); omitted/null = anyone. */
  preferredStaffId: z.string().uuid().nullable().optional(),
  /** Phase 19: optional — the ticket link (and its QR) is emailed so it isn't lost. Blank = none. */
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

/**
 * The physical counter scanner's one input (Phase 10, D-10/D-11) — whatever
 * publicCode it just read off a guest card or a customer's personal QR.
 * No service/name/phone fields: both scan kinds are self-serve-instant,
 * no confirmation step (D-11).
 */
export const scanCodeSchema = z.object({
  // 100, not 50: secret codes are 27 chars when minted by the API, but the
  // Phase 14 backfill migration gave older bookings 64-char check-in codes.
  code: z.string().trim().min(1).max(100),
});
export type ScanCodeInput = z.infer<typeof scanCodeSchema>;

export const cancelEntrySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelEntryInput = z.infer<typeof cancelEntrySchema>;

export const listQueueEntriesQuerySchema = z.object({
  status: z
    .enum(["WAITING", "CALLED", "SERVING", "COMPLETED", "CANCELLED", "SKIPPED", "NO_SHOW"])
    .optional(),
});
export type ListQueueEntriesQuery = z.infer<typeof listQueueEntriesQuerySchema>;

/** Phase 17 — hand a called/in-progress customer to another team member. */
export const handOverSchema = z.object({
  tenantUserId: z.string().uuid(),
});
export type HandOverInput = z.infer<typeof handOverSchema>;

/** Phase 18 — change who a waiting customer wants; null = anyone. */
export const setPreferenceSchema = z.object({
  preferredStaffId: z.string().uuid().nullable(),
});
export type SetPreferenceInput = z.infer<typeof setPreferenceSchema>;
