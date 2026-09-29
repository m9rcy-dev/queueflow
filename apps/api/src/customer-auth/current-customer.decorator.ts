import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { CustomerRequestUser } from "./customer-request-user.interface";

/** Extracts the authenticated customer/tenant from the request (set by CustomerJwtStrategy) — the customer-portal equivalent of auth/current-user.decorator.ts. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerRequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as CustomerRequestUser;
  },
);
