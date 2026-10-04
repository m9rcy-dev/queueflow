import type { TenantRole } from "@queueflow/types";

/** Owner and admins run the business; managers and staff each work at one location (ADR-015). Mirrors the API's @Roles — the API is the real enforcement, this only hides what would be refused. */
export function isBusinessAdmin(role: TenantRole): boolean {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN";
}
