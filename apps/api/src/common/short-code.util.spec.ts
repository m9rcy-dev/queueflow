import { generateShortPublicCode } from "./short-code.util";

describe("generateShortPublicCode", () => {
  it("defaults to 8 characters", () => {
    expect(generateShortPublicCode()).toHaveLength(8);
  });

  it("respects a custom length", () => {
    expect(generateShortPublicCode(12)).toHaveLength(12);
  });

  it("never includes visually ambiguous characters (0/O, 1/I/L) — this is read by humans off a printed card", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateShortPublicCode(16)).not.toMatch(/[01OIL]/);
    }
  });

  it("two calls don't collide in a reasonably-sized sample", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateShortPublicCode()));
    expect(codes.size).toBe(500);
  });
});
