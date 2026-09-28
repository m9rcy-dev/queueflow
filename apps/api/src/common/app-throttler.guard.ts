import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Thin subclass so integration tests can disable rate limiting entirely
 * via an env flag, checked fresh on every request. `@Throttle(...)`
 * decorator values are literal arguments evaluated once at class-import
 * time — too early to read an env var a test sets in `beforeAll` — so
 * this is the seam that actually lets tests toggle it at request time
 * without changing the real per-route limits (G-40) to suit test
 * convenience.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.DISABLE_RATE_LIMITING === "true") {
      return true;
    }
    return super.canActivate(context);
  }
}
