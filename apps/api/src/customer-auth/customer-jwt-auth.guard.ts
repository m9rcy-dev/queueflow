import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Applied locally via @UseGuards() on the customer portal's routes, which
 * are also marked @Public() to skip the global staff JwtAuthGuard —
 * unlike that guard, this one is never registered globally: customer
 * routes are the deliberate, narrow exception, not the default.
 */
@Injectable()
export class CustomerJwtAuthGuard extends AuthGuard("customer-jwt") {}
