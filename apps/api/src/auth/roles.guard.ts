import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantRole } from "@queueflow/types";
import { ROLES_KEY } from "./roles.decorator";
import type { RequestUser } from "./request-user.interface";

/** Runs after JwtAuthGuard — checks req.user.role against @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: "INSUFFICIENT_ROLE",
        message: "You do not have permission to perform this action.",
      });
    }
    return true;
  }
}
