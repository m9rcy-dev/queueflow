import { z } from "zod";

/** 6-digit OTP code (G-05). */
const otpCodeSchema = z.string().regex(/^\d{6}$/, "Code must be 6 digits");

/**
 * Business signup (G-01) — a separate entry point from customer signup.
 * Creates the tenant, the owner's user record, and sends a login code to
 * verify the email — it does not itself log anyone in.
 */
export const businessSignupSchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  ownerName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
});
export type BusinessSignupInput = z.infer<typeof businessSignupSchema>;

export const requestLoginCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type RequestLoginCodeInput = z.infer<typeof requestLoginCodeSchema>;

export const verifyLoginCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: otpCodeSchema,
});
export type VerifyLoginCodeInput = z.infer<typeof verifyLoginCodeSchema>;

/** Second step when verifyLoginCode returned requiresTenantSelection (G-03). */
export const selectTenantSchema = z.object({
  pendingToken: z.string().min(1),
  tenantId: z.string().uuid(),
});
export type SelectTenantInput = z.infer<typeof selectTenantSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const verifyInviteSchema = z.object({
  code: otpCodeSchema,
});
export type VerifyInviteInput = z.infer<typeof verifyInviteSchema>;
