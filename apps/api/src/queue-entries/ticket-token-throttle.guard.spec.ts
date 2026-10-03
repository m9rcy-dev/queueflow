import { type ExecutionContext, HttpException } from "@nestjs/common";
import { TicketTokenThrottleGuard } from "./ticket-token-throttle.guard";

function contextWithToken(token: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params: { token } }) }),
  } as unknown as ExecutionContext;
}

describe("TicketTokenThrottleGuard", () => {
  const originalEnv = process.env.DISABLE_RATE_LIMITING;
  afterEach(() => {
    process.env.DISABLE_RATE_LIMITING = originalEnv;
  });

  it("allows 60 reads for the same token, blocks the 61st", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new TicketTokenThrottleGuard();
    const ctx = contextWithToken("tok_abc123");
    for (let i = 0; i < 60; i += 1) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it("tracks a different token independently", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new TicketTokenThrottleGuard();
    for (let i = 0; i < 60; i += 1) {
      guard.canActivate(contextWithToken("tok_abc123"));
    }
    expect(guard.canActivate(contextWithToken("tok_other"))).toBe(true);
  });

  it("lets a missing token through uncounted", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new TicketTokenThrottleGuard();
    expect(guard.canActivate(contextWithToken(undefined))).toBe(true);
  });

  it("bypasses entirely when DISABLE_RATE_LIMITING=true", () => {
    process.env.DISABLE_RATE_LIMITING = "true";
    const guard = new TicketTokenThrottleGuard();
    const ctx = contextWithToken("tok_abc123");
    for (let i = 0; i < 100; i += 1) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });
});
