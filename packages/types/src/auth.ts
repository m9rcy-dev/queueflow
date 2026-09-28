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
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
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
  staff: DeviceStaffOption[];
}
