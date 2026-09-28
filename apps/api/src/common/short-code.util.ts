import { randomInt } from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/I/L) — this is printed on
// physical material (posters, cards) and read by humans, not just scanners.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * A short, human-typable, printed code (G-39) — deliberately NOT a secret,
 * unlike queue_entry.publicToken. Anyone who can read a poster can read
 * this; it identifies a *context* (which queue), not a capability.
 */
export function generateShortPublicCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}
