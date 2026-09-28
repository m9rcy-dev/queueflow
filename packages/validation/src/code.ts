import { z } from "zod";

/** Minting a code (Phase 4 QUEUE / Phase 6 DISPLAY) — defaults to QUEUE since that's the original, still-most-common case. */
export const createCodeSchema = z.object({
  contextType: z.enum(["QUEUE", "DISPLAY"]).optional(),
});
export type CreateCodeInput = z.infer<typeof createCodeSchema>;
