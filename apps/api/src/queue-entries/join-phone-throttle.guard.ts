import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { normalizePhoneToE164 } from "../common/phone.util";
import { InMemoryRateLimiter } from "../common/in-memory-rate-limiter";

const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000; // G-38: 5 joins/hour per phone

/**
 * G-38's phone-based join limit — a second, independent dimension from the
 * IP-based `@Throttle()` already on this route. Tracks by the request's
 * own `customerPhone`, not IP, so a shared IP (café wifi, a busy location)
 * doesn't block a different phone's legitimate joins, and the same phone
 * spamming through multiple IPs doesn't bypass the limit either.
 *
 * Runs as a local guard, after the global IP-based `AppThrottlerGuard` —
 * the phone isn't known until the body is read, and Zod validation hasn't
 * run yet at the guard stage, so a missing/malformed phone here is simply
 * let through uncounted; `joinQueueSchema` rejects it moments later with
 * its own 400, which is the more useful signal for a client that got the
 * shape wrong.
 */
@Injectable()
export class JoinPhoneThrottleGuard implements CanActivate {
  private readonly limiter = new InMemoryRateLimiter(LIMIT, WINDOW_MS);

  canActivate(context: ExecutionContext): boolean {
    if (process.env.DISABLE_RATE_LIMITING === "true") return true;

    const req = context.switchToHttp().getRequest();
    const rawPhone: unknown = req.body?.customerPhone;
    if (typeof rawPhone !== "string") return true;

    let phoneE164: string;
    try {
      phoneE164 = normalizePhoneToE164(rawPhone);
    } catch {
      return true;
    }

    if (!this.limiter.consume(`phone:${phoneE164}`)) {
      throw new HttpException(
        {
          code: "TOO_MANY_REQUESTS",
          message: "Too many join attempts for this phone number. Please try again later.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
