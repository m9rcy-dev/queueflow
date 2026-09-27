import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestUser } from "./request-user.interface";

/** Extracts the authenticated user/tenant/role from the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
