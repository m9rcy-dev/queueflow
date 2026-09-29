import { z } from "zod";

/**
 * Minting a code (Phase 4 QUEUE / Phase 6 DISPLAY) — defaults to QUEUE
 * since that's the original, still-most-common case. GENERAL is minted
 * through the same generic per-queue endpoint's schema shape but via the
 * separate tenant-level `tenants/me/codes` endpoint (it isn't queue-bound).
 * CUSTOMER_IDENTITY is deliberately excluded — it's never minted through a
 * generic "create a code" call, only via CustomersService alongside
 * creating/regenerating a customer's own identity code.
 */
export const createCodeSchema = z.object({
  contextType: z.enum(["QUEUE", "DISPLAY", "GENERAL"]).optional(),
});
export type CreateCodeInput = z.infer<typeof createCodeSchema>;
