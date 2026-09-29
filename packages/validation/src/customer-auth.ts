import { z } from "zod";

/** 6-digit OTP code (G-05), same shape as staff login (packages/validation/src/auth.ts). */
const otpCodeSchema = z.string().regex(/^\d{6}$/, "Code must be 6 digits");

/**
 * Self-service signup via a GENERAL "sign up here" code (D-10, G-56).
 * Email is required here (unlike staffCreateCustomerSchema below) since
 * it's the only way this customer can prove ownership of the account
 * later — login is email-OTP only, and there's no staff member vouching
 * for them in person.
 */
export const customerSignupSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30),
  email: z.string().trim().toLowerCase().email(),
});
export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;

export const customerRequestLoginCodeSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
});
export type CustomerRequestLoginCodeInput = z.infer<typeof customerRequestLoginCodeSchema>;

export const customerVerifyLoginCodeSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  code: otpCodeSchema,
});
export type CustomerVerifyLoginCodeInput = z.infer<typeof customerVerifyLoginCodeSchema>;

export const customerRefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type CustomerRefreshTokenInput = z.infer<typeof customerRefreshTokenSchema>;

export const customerLogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type CustomerLogoutInput = z.infer<typeof customerLogoutSchema>;

/**
 * Staff-initiated in-person signup (G-56) — a tenant-authenticated call,
 * so tenantId comes from the caller's own session, not the body. Email is
 * optional: staff has already verified the person face-to-face, so there's
 * no OTP to prove; without one on file, this customer just can't use
 * self-service login later (they can still be given a fresh email at any
 * point some future "update profile" flow — not built in Phase 9).
 */
export const staffCreateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30),
  email: z.string().trim().toLowerCase().email().optional(),
});
export type StaffCreateCustomerInput = z.infer<typeof staffCreateCustomerSchema>;
