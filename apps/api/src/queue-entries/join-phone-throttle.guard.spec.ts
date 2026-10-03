import { type ExecutionContext, HttpException } from "@nestjs/common";
import { JoinPhoneThrottleGuard } from "./join-phone-throttle.guard";

function contextWithBody(body: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
}

describe("JoinPhoneThrottleGuard", () => {
  const originalEnv = process.env.DISABLE_RATE_LIMITING;
  afterEach(() => {
    process.env.DISABLE_RATE_LIMITING = originalEnv;
  });

  it("allows 5 joins for the same phone, blocks the 6th", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new JoinPhoneThrottleGuard();
    const ctx = contextWithBody({ customerPhone: "021 123 4567" });
    for (let i = 0; i < 5; i += 1) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it("normalizes the phone before keying — '021 123 4567' and '+64211234567' share one bucket", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new JoinPhoneThrottleGuard();
    for (let i = 0; i < 5; i += 1) {
      guard.canActivate(contextWithBody({ customerPhone: "021 123 4567" }));
    }
    expect(() => guard.canActivate(contextWithBody({ customerPhone: "+64211234567" }))).toThrow(
      HttpException,
    );
  });

  it("tracks a different phone number independently", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new JoinPhoneThrottleGuard();
    for (let i = 0; i < 5; i += 1) {
      guard.canActivate(contextWithBody({ customerPhone: "021 123 4567" }));
    }
    expect(guard.canActivate(contextWithBody({ customerPhone: "021 999 8888" }))).toBe(true);
  });

  it("lets a missing or malformed phone through uncounted — Zod validation rejects it next, not this guard", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const guard = new JoinPhoneThrottleGuard();
    expect(guard.canActivate(contextWithBody({}))).toBe(true);
    expect(guard.canActivate(contextWithBody({ customerPhone: "not-a-phone" }))).toBe(true);
  });

  it("bypasses entirely when DISABLE_RATE_LIMITING=true", () => {
    process.env.DISABLE_RATE_LIMITING = "true";
    const guard = new JoinPhoneThrottleGuard();
    const ctx = contextWithBody({ customerPhone: "021 123 4567" });
    for (let i = 0; i < 10; i += 1) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });
});
