import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import type { CustomerAccessTokenPayload } from "../auth/token.service";
import type { CustomerRequestUser } from "./customer-request-user.interface";

/**
 * A separate passport strategy from staff's JwtStrategy (named "jwt",
 * used by the global JwtAuthGuard) — registered under "customer-jwt" so a
 * customer token is only ever accepted by routes that explicitly opt in
 * via CustomerJwtAuthGuard, never by the staff-wide default guard, and
 * vice versa (D-09: a customer account never spans tenants, and must
 * never be usable as a staff credential even accidentally).
 */
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, "customer-jwt") {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_ACCESS_SECRET") ?? "dev-only-change-me",
    });
  }

  async validate(payload: CustomerAccessTokenPayload): Promise<CustomerRequestUser> {
    if (payload.type !== "customer") {
      throw new UnauthorizedException({
        code: "INVALID_CUSTOMER_TOKEN",
        message: "Your session has expired. Please log in again.",
      });
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
    if (!customer || customer.tenantId !== payload.tenantId) {
      throw new UnauthorizedException({
        code: "INVALID_CUSTOMER_TOKEN",
        message: "Your session has expired. Please log in again.",
      });
    }
    return { customerId: customer.id, tenantId: customer.tenantId };
  }
}
