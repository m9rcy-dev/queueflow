import { SseConnectionLimiterService } from "./sse-connection-limiter.service";

describe("SseConnectionLimiterService", () => {
  const originalEnv = process.env.DISABLE_RATE_LIMITING;
  afterEach(() => {
    process.env.DISABLE_RATE_LIMITING = originalEnv;
  });

  it("allows up to 10 concurrent connections per IP, then rejects the 11th", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const limiter = new SseConnectionLimiterService();
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    }
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
  });

  it("releasing a connection frees up a slot", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const limiter = new SseConnectionLimiterService();
    for (let i = 0; i < 10; i += 1) {
      limiter.tryAcquire("1.2.3.4");
    }
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
    limiter.release("1.2.3.4");
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
  });

  it("tracks each IP independently", () => {
    delete process.env.DISABLE_RATE_LIMITING;
    const limiter = new SseConnectionLimiterService();
    for (let i = 0; i < 10; i += 1) {
      limiter.tryAcquire("1.2.3.4");
    }
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
    expect(limiter.tryAcquire("5.6.7.8")).toBe(true);
  });

  it("release is a safe no-op when nothing was ever acquired for that IP", () => {
    const limiter = new SseConnectionLimiterService();
    expect(() => limiter.release("9.9.9.9")).not.toThrow();
  });

  it("bypasses entirely when DISABLE_RATE_LIMITING=true (test-suite escape hatch)", () => {
    process.env.DISABLE_RATE_LIMITING = "true";
    const limiter = new SseConnectionLimiterService();
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    }
  });
});
