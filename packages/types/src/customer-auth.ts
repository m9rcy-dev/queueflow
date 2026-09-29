import type { QueueEntrySummary } from "./queue";

/**
 * Customer accounts (Phase 9, D-09) — tenant-scoped only, never spans
 * tenants (unlike staff, whose User can hold memberships in several).
 * Deliberately not called "user" to keep the two concepts visually
 * distinct throughout the codebase.
 */
export interface CustomerAuthenticatedUser {
  id: string;
  firstName: string | null;
  phoneE164: string;
  email: string | null;
}

export interface CustomerTenantSummary {
  id: string;
  name: string;
}

export interface CustomerAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CustomerAuthResponse extends CustomerAuthTokens {
  customer: CustomerAuthenticatedUser;
  tenant: CustomerTenantSummary;
}

/** Staff-initiated in-person signup's response (G-56) — no tokens, since staff (not the customer) is the one signed in; the identity code is what staff hands the customer. */
export interface StaffCreateCustomerResponse {
  customer: CustomerAuthenticatedUser;
  identityCode: string;
}

/**
 * The customer portal's own view of themself (Phase 9, G-55) — their
 * persistent identity code (G-52) plus whichever queue entry they
 * currently have active in this tenant, if any.
 */
export interface CustomerPortalSummary {
  customer: CustomerAuthenticatedUser;
  tenant: CustomerTenantSummary;
  identityCode: string;
}

/** GET /customers/me/active-entry — null when the customer has nothing active in this tenant right now. */
export interface CustomerActiveEntry extends QueueEntrySummary {
  queueName: string;
}
