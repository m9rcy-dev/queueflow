/**
 * Auth/tenant domain types shared between apps/api and apps/web.
 * Mirrors the Prisma schema (apps/api/prisma/schema.prisma) — keep in sync
 * by hand since this package doesn't generate from Prisma (Phase 1 scope).
 */

export type TenantRole = "TENANT_OWNER" | "TENANT_ADMIN" | "MANAGER" | "STAFF";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  ownerName: string;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  /** Phase 16: path to the business logo on the API (prefix the API base URL), or null if none uploaded. */
  logoPath: string | null;
}

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  role: TenantRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Returned by login-code verify when the user belongs to exactly one tenant. */
export interface AuthSuccessResponse extends AuthTokens {
  requiresTenantSelection: false;
  user: AuthenticatedUser;
  tenant: TenantSummary;
  role: TenantRole;
}

/**
 * Returned by login-code verify when the user belongs to more than one
 * tenant (G-03) — no access/refresh token is issued yet. The client must
 * call select-tenant with the pendingToken and a chosen tenantId.
 */
export interface AuthTenantSelectionRequired {
  requiresTenantSelection: true;
  pendingToken: string;
  tenants: MembershipSummary[];
}

export type LoginVerifyResponse = AuthSuccessResponse | AuthTenantSelectionRequired;

export interface InviteSummary {
  id: string;
  email: string;
  role: TenantRole;
  /** Phase 16: set for MANAGER/STAFF invites — the location they'll work at. */
  location: { id: string; name: string } | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/** What the invite-acceptance page shows before asking for the emailed code (Phase 16). */
export interface InviteDetails {
  tenantName: string;
  email: string;
  role: TenantRole;
  locationName: string | null;
}

/** The tenant's current staff roster — removed members excluded. Role/location edits and removal arrived in Phase 16. */
export interface TenantMemberSummary {
  tenantUserId: string;
  displayName: string;
  email: string;
  role: TenantRole;
  /** MANAGER/STAFF only (ADR-015); null = every location (owner/admin), or a bound member not yet assigned. */
  location: { id: string; name: string } | null;
}

/**
 * Shared counter-tablet trust + PIN switching (D-03a). "Trust this device"
 * (an already-logged-in staff member opts in) returns a `TrustDeviceResponse`;
 * on every subsequent app load, the stored token is exchanged via
 * device-context for the list of staff who can PIN-switch in on it.
 */
export interface TrustDeviceResponse {
  deviceTrustToken: string;
  expiresAt: string;
}

export interface DeviceStaffOption {
  tenantUserId: string;
  displayName: string;
  role: TenantRole;
  hasPin: boolean;
}

export interface DeviceContextResponse {
  /** Rotated on every call (ADR-004's rotation pattern) — always persist this one, not the token that was sent. */
  deviceTrustToken: string;
  tenant: { id: string; name: string };
  /** The location this tablet belongs to (Phase 16); null only for tablets trusted before then. */
  location: { id: string; name: string } | null;
  staff: DeviceStaffOption[];
}

/** Phase 15 (ADR-014) — whether an account logs in with an authenticator app instead of an emailed code. */
export interface AuthenticatorStatus {
  enabled: boolean;
}

/** Setup step 1: shown as a QR (otpauthUri) plus the secret for typing in by hand. */
export interface AuthenticatorSetup {
  otpauthUri: string;
  secret: string;
}

/**
 * GET /auth/me (Phase 17): who's signed in, for the app shell — name and
 * email for the profile footer, role and location for the menu, whether
 * appointments are on (the Appointments item hides when they're off).
 */
export interface StaffProfile {
  userId: string;
  tenantId: string;
  tenantUserId: string;
  role: TenantRole;
  locationId: string | null;
  displayName: string;
  email: string;
  tenantName: string;
  locationName: string | null;
  appointmentEnabled: boolean;
}

/** Someone who can serve at a location — the hand-over picker (Phase 17). */
export interface TeamMemberOption {
  tenantUserId: string;
  displayName: string;
  role: TenantRole;
}
