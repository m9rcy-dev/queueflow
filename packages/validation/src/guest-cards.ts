import { z } from "zod";

/**
 * Resizes a location's guest-card pool (Phase 10, D-14) — full-replace
 * semantics like replaceBusinessHoursSchema: the caller states the target
 * size, the service reconciles (mints new cards / deactivates free ones)
 * rather than the caller listing individual additions/removals. 0 means
 * "no guest cards at this location" (the default — opt-in feature).
 */
export const resizeGuestCardPoolSchema = z.object({
  poolSize: z.number().int().min(0).max(500),
});
export type ResizeGuestCardPoolInput = z.infer<typeof resizeGuestCardPoolSchema>;
