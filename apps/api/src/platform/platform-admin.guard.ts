import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { TokenService, type PlatformTokenPayload } from "../auth/token.service";
import { isPlatformAdminEmail } from "../auth/auth.service";

export type PlatformRequest = Request & { platformAdmin?: PlatformTokenPayload };

/**
 * Guards /platform/* (Phase 19, ADR-018). The routes are @Public() to the
 * global staff JwtAuthGuard and checked here instead: a platform token
 * (its own signing key), whose email is *still* on the allow-list — taking
 * someone off PLATFORM_ADMIN_EMAILS locks them out at once, not when the
 * token expires.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = this.tokens.verifyPlatformToken(token);
    if (!isPlatformAdminEmail(this.config.get<string>("PLATFORM_ADMIN_EMAILS"), payload.email)) {
      // Same refusal as a bad token.
      throw new UnauthorizedException({
        code: "PLATFORM_SESSION_INVALID",
        message: "Please sign in again.",
      });
    }
    request.platformAdmin = payload;
    return true;
  }
}
