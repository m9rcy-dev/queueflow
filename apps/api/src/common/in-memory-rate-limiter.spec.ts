import { InMemoryRateLimiter } from "./in-memory-rate-limiter";

describe("InMemoryRateLimiter", () => {
  it("allows up to the configured limit, then rejects", () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(false);
  });

  it("tracks each key independently", () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("b")).toBe(true);
    expect(limiter.consume("a")).toBe(false);
    expect(limiter.consume("b")).toBe(false);
  });

  it("resets a key once its window has elapsed", () => {
    jest.useFakeTimers();
    try {
      const limiter = new InMemoryRateLimiter(1, 1_000);
      expect(limiter.consume("a")).toBe(true);
      expect(limiter.consume("a")).toBe(false);
      jest.advanceTimersByTime(1_001);
      expect(limiter.consume("a")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
