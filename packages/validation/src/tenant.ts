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
/**
 * Phase 16 (ADR-015): MANAGER/STAFF work at exactly one location, so they
 * need a locationId; a TENANT_ADMIN covers every location and mustn't
 * have one. Shared by invites and role/location edits.
 */
function refineLocationForRole<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (data: { role: string; locationId?: string | null }) =>
      data.role === "TENANT_ADMIN" ? !data.locationId : Boolean(data.locationId),
    {
      message: "Managers and staff need a location; admins cover every location",
      path: ["locationId"],
    },
  );
}

const assignableRole = z.enum(["TENANT_ADMIN", "MANAGER", "STAFF"]);

export const createInviteSchema = refineLocationForRole(
  z.object({
    email: z.string().trim().toLowerCase().email(),
    role: assignableRole,
    locationId: z.string().uuid().nullable().optional(),
  }),
);
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/** Changing a member's role and/or location (Phase 16). The owner can't be changed, and nobody can change themselves. */
export const updateMemberSchema = refineLocationForRole(
  z.object({
    role: assignableRole,
    locationId: z.string().uuid().nullable().optional(),
  }),
);
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
