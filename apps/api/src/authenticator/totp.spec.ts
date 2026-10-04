import {
  base32Decode,
  base32Encode,
  codeForStep,
  generateSecret,
  matchingStep,
  otpauthUri,
  STEP_SECONDS,
  timeStep,
} from "./totp";

// RFC 6238 Appendix B: SHA1 seed is the ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches the RFC test vector at T=%i", (seconds, expected) => {
    const step = timeStep(new Date(seconds * 1000));
    expect(codeForStep(RFC_SECRET, step, 8)).toBe(expected);
  });

  it("6-digit codes are the last 6 digits of the 8-digit ones", () => {
    expect(codeForStep(RFC_SECRET, timeStep(new Date(59_000)))).toBe("287082");
  });

  it("accepts the current step and one either side, nothing further", () => {
    const now = new Date(1_700_000_000_000);
    const step = timeStep(now);
    expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, step), now)).toBe(step);
    expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchingStep(RFC_SECRET, codeForStep(RFC_SECRET, step + 2), now)).toBeNull();
  });

  it("rejects malformed codes without throwing", () => {
    const now = new Date();
    expect(matchingStep(RFC_SECRET, "12345", now)).toBeNull();
    expect(matchingStep(RFC_SECRET, "abcdef", now)).toBeNull();
  });

  it("generates 160-bit secrets that round-trip through base32", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("builds an otpauth link authenticator apps can read", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "QueueFlow", "kiri@example.com");
    expect(uri).toBe(
      `otpauth://totp/QueueFlow%3Akiri%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=QueueFlow&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`,
    );
  });
});
