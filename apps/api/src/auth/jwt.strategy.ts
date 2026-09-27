import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import type { AccessTokenPayload } from "./token.service";
import type { RequestUser } from "./request-user.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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

  /**
   * Re-checks the membership on every request rather than trusting the
   * token's role claim — a revoked membership or a role change takes effect
   * immediately, not only after the access token expires (up to 60 minutes
   * later otherwise). Cheap: TenantUser is unique-indexed on
   * (tenantId, userId).
   */
  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    const membership = await this.prisma.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: payload.tenantId, userId: payload.sub } },
    });
    if (!membership) {
      throw new UnauthorizedException({
        code: "MEMBERSHIP_REVOKED",
        message: "Your access to this business has been revoked.",
      });
    }
    return { userId: payload.sub, tenantId: payload.tenantId, role: membership.role };
  }
}
