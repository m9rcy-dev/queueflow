import { BadRequestException } from "@nestjs/common";

/**
 * Normalizes a phone number to E.164 (G-33). MVP-scoped to NZ numbers per
 * the plan's initial market (§80) — a number already in `+` international
 * format is passed through as-is (trimmed of spaces/dashes) rather than
 * rejected, so this doesn't hard-block a customer with an overseas number.
 */
export function normalizePhoneToE164(rawPhone: string): string {
  const trimmed = rawPhone.replace(/[\s-()]/g, "");

  if (trimmed.startsWith("+")) {
    if (!/^\+\d{8,15}$/.test(trimmed)) {
      throw invalidPhone();
    }
    return trimmed;
  }

  // NZ local format: 0-prefixed national number, e.g. "021 123 4567".
  if (/^0\d{7,9}$/.test(trimmed)) {
    return `+64${trimmed.slice(1)}`;
  }

  throw invalidPhone();
}

function invalidPhone(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_PHONE_NUMBER",
    message: "Enter a valid mobile number.",
  });
}
