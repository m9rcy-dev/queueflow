import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { InMemoryRateLimiter } from "../common/in-memory-rate-limiter";

const LIMIT = 60;
const WINDOW_MS = 60 * 1000; // G-38: 60 reads/min per ticket token

/**
 * G-38's public-ticket-read limit — keyed by the ticket's own token, not
 * IP, since the token itself already identifies exactly which resource is
 * being hammered and by whom (an anonymous customer's own ticket page
 * polling/reconnecting), independent of however many customers happen to
 * share a network.
 */
@Injectable()
export class TicketTokenThrottleGuard implements CanActivate {
  private readonly limiter = new InMemoryRateLimiter(LIMIT, WINDOW_MS);

  canActivate(context: ExecutionContext): boolean {
    if (process.env.DISABLE_RATE_LIMITING === "true") return true;

    const req = context.switchToHttp().getRequest();
    const token: unknown = req.params?.token;
    if (typeof token !== "string" || !token) return true;

    if (!this.limiter.consume(`token:${token}`)) {
      throw new HttpException(
        {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests for this ticket. Please slow down.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
