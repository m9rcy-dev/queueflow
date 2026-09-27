import { SetMetadata } from "@nestjs/common";
import type { TenantRole } from "@queueflow/types";

export const ROLES_KEY = "roles";

/** Restricts a route to the given tenant roles (checked by RolesGuard). */
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
