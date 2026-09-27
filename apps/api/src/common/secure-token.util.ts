import { randomBytes } from "node:crypto";

/**
 * A long-lived, secret public token (G-39: 128-bit minimum, not a
 * sequential ID) — used for a customer's own ticket link, distinct from
 * the QR poster's short, printed, non-secret public_code (a different
 * threat model entirely, per G-39's note not to conflate the two).
 */
export function generateSecurePublicToken(): string {
  return randomBytes(20).toString("base64url"); // 160 bits, comfortably over the 128-bit floor
}
