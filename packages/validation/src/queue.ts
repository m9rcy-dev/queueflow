import { z } from "zod";

export const createQueueSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  servingCapacity: z.number().int().min(1).max(50).optional(),
  maxActiveTicketsPerCustomer: z.number().int().min(1).max(10).optional(),
  maxRecallCount: z.number().int().min(0).max(10).optional(),
  recallGracePeriodMinutes: z.number().int().min(1).max(60).optional(),
});
export type CreateQueueInput = z.infer<typeof createQueueSchema>;

export const updateQueueConfigSchema = createQueueSchema
  .omit({ locationId: true, name: true })
  .partial()
  .extend({ name: z.string().trim().min(1).max(200).optional() });
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
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

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
