/**
 * A plain fixed-window counter, shared by every rate-limiting dimension
 * that `@nestjs/throttler`'s IP-keyed guard can't express directly (G-38)
 * — tracking by phone number or by ticket token instead of IP. In-process
 * only, correct for a single API instance (D-06); Redis is the documented
 * swap once horizontal scaling is needed, same as every other in-process
 * state in this codebase (SSE fan-out, notification processing).
 *
 * Expired buckets are swept lazily on `consume()` rather than on a timer —
 * simplest correct option at hobby-phase traffic, and avoids one more
 * `setInterval` to manage.
 */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweptAt = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true (and records the hit) if under the limit; false if this key has already exhausted its window. */
  consume(key: string): boolean {
    const now = Date.now();
    this.sweepIfDue(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  }

  /** Prunes expired entries at most once per window — bounds memory for keys (phone numbers, tokens) that never come back, without a dedicated timer. */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweptAt < this.windowMs) return;
    this.lastSweptAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
