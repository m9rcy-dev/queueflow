import type { TenantRole } from "@queueflow/types";

/** Shape attached to `req.user` by JwtStrategy after a valid access token. */
export interface RequestUser {
  userId: string;
  tenantId: string;
  /** The TenantUser row's own id — distinct from userId, and what any FK to "the acting staff member" (e.g. QueueEntry.assignedStaffId) must reference. */
  tenantUserId: string;
  role: TenantRole;
  /** Phase 16 (ADR-015): the one location a MANAGER/STAFF member works at; null for TENANT_OWNER/TENANT_ADMIN (every location). Read fresh from the membership on every request. */
  locationId: string | null;
}
