import { Injectable } from "@nestjs/common";

/** G-38: 10 concurrent SSE connections per IP — a generous ceiling meant to catch scripted abuse, not normal usage (one tab per customer ticket, one browser per display). */
const MAX_CONCURRENT_PER_IP = 10;

/**
 * Concurrent-connection limiting for SSE endpoints (G-38) — a different
 * shape from the request-RATE throttling everywhere else: this counts
 * *currently open* long-lived connections, not requests per time window,
 * so `@nestjs/throttler` doesn't apply. In-process only (D-06, single
 * instance for MVP); shared across every SSE controller (ticket watch,
 * display board) via one injected singleton.
 */
@Injectable()
export class SseConnectionLimiterService {
  private readonly openByIp = new Map<string, number>();

  /** Call before opening a new SSE stream. Returns false if this IP is already at the concurrent cap — the caller should reject the connection, not open it. */
  tryAcquire(ip: string): boolean {
    if (process.env.DISABLE_RATE_LIMITING === "true") return true;
    const current = this.openByIp.get(ip) ?? 0;
    if (current >= MAX_CONCURRENT_PER_IP) return false;
    this.openByIp.set(ip, current + 1);
    return true;
  }

  /** Call from the stream's own teardown (on close/unsubscribe) — must be paired with every successful tryAcquire(), including ones that preceded a DISABLE_RATE_LIMITING flip, so this is intentionally safe to call even when nothing was ever acquired. */
  release(ip: string): void {
    const current = this.openByIp.get(ip) ?? 0;
    if (current <= 1) {
      this.openByIp.delete(ip);
    } else {
      this.openByIp.set(ip, current - 1);
    }
  }
}
