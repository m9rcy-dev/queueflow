import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, built on HOTP, RFC 4226) — the
 * scheme Google Authenticator, Microsoft Authenticator and the rest all
 * implement with these defaults: HMAC-SHA1, 6 digits, 30-second steps.
 * Hand-rolled on node:crypto rather than a dependency, since it's a few
 * lines and the RFC's own test vectors pin it down (totp.spec.ts).
 */

export const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next step too — tolerates ~30s of phone clock drift. */
const DRIFT_STEPS = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 160-bit secret, base32-encoded — the length RFC 4226 recommends and authenticator apps expect. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
}

/** The code for one time step (HOTP with the step as the counter). */
export function codeForStep(secretBase32: string, step: number, digits: number = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * The time step `code` is valid for (within ±1 step of now), or null. The
 * caller enforces replay protection by only accepting a step later than
 * the last one used. Compared in constant time.
 */
export function matchingStep(secretBase32: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (constantTimeEqual(codeForStep(secretBase32, step), code)) return step;
  }
  return null;
}

/**
 * The `otpauth://` link encoded in the setup QR code (the de-facto "Key
 * Uri Format" every authenticator app reads). `issuer` is what the app
 * shows as the entry's name; `account` is shown beneath it.
 */
export function otpauthUri(secretBase32: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
