import { z } from "zod";

/**
 * Capability toggles (G-01/ADR-005). QR Management and the live dashboard
 * are always-on for every tenant and have no toggle — only these two.
 */
export const updateCapabilitiesSchema = z
  .object({
    queueEnabled: z.boolean().optional(),
    appointmentEnabled: z.boolean().optional(),
  })
  .refine((data) => data.queueEnabled !== undefined || data.appointmentEnabled !== undefined, {
    message: "At least one capability must be provided",
  });
export type UpdateCapabilitiesInput = z.infer<typeof updateCapabilitiesSchema>;

/**
 * Staff invite (G-02). TENANT_OWNER is deliberately excluded — there is
 * exactly one owner, the person who signed the business up.
 */
export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["TENANT_ADMIN", "MANAGER", "STAFF"]),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
