import type { TenantRole } from "@queueflow/types";

/** Shape attached to `req.user` by JwtStrategy after a valid access token. */
export interface RequestUser {
  userId: string;
  tenantId: string;
  role: TenantRole;
}
