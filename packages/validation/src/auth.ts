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
  /** Phase 15: "Email me a code instead" — send one even when the account uses an authenticator app. */
  forceEmail: z.boolean().optional(),
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
  /** Phase 16: the invitee's name, asked on the acceptance page (otherwise they'd be shown by email). */
  displayName: z.string().trim().min(1).max(200).optional(),
});
export type VerifyInviteInput = z.infer<typeof verifyInviteSchema>;

/** 4-6 digit PIN (D-03a) — short and typable on a shared counter tablet, not a password. */
const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

export const setPinSchema = z.object({
  pin: pinSchema,
});
export type SetPinInput = z.infer<typeof setPinSchema>;

export const deviceContextSchema = z.object({
  deviceTrustToken: z.string().min(1),
});
export type DeviceContextInput = z.infer<typeof deviceContextSchema>;

export const staffPinLoginSchema = z.object({
  deviceTrustToken: z.string().min(1),
  tenantUserId: z.string().uuid(),
  pin: pinSchema,
});
export type StaffPinLoginInput = z.infer<typeof staffPinLoginSchema>;

/** Phase 15 — confirming authenticator setup with the first code the app shows. */
export const confirmAuthenticatorSchema = z.object({
  code: otpCodeSchema,
});
export type ConfirmAuthenticatorInput = z.infer<typeof confirmAuthenticatorSchema>;

/** Phase 16 — which location a counter tablet is for; optional when it's implied (a location-bound member, or a one-location business). */
export const trustDeviceSchema = z.object({
  locationId: z.string().uuid().optional(),
});
export type TrustDeviceInput = z.infer<typeof trustDeviceSchema>;

/** Phase 18 — clock in; owner/admin say where, a location-bound member needn't. */
export const clockInSchema = z.object({
  locationId: z.string().uuid().optional(),
});
export type ClockInInput = z.infer<typeof clockInSchema>;

/** Phase 18 — the name customers see; null/empty goes back to the display name. */
export const updatePublicNameSchema = z.object({
  publicName: z.string().trim().max(60).nullable(),
});
export type UpdatePublicNameInput = z.infer<typeof updatePublicNameSchema>;

/** Phase 19 — the hours report's range: ISO date-times, `from` inclusive, `to` exclusive (at most ~3 months). */
export const hoursReportQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    locationId: z.string().uuid().optional(),
    tenantUserId: z.string().uuid().optional(),
  })
  .refine((q) => new Date(q.to) > new Date(q.from), { message: "`to` must be after `from`." })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 93 * 24 * 3600 * 1000, {
    message: "Choose a range of at most 3 months.",
  });
export type HoursReportQuery = z.infer<typeof hoursReportQuerySchema>;

/** Phase 19 — correct a shift by hand (e.g. a forgotten clock-out). */
export const updateShiftSchema = z
  .object({
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .refine((v) => v.endedAt === null || new Date(v.endedAt) > new Date(v.startedAt), {
    message: "The end must be after the start.",
  });
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
