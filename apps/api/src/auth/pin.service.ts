import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Hashes the per-staff PIN used for shared counter-tablet switching
 * (D-03a). argon2id despite the PIN's low entropy (4-6 digits) — it's a
 * long-lived secret unlike the OTP codes' fast sha256 (TokenService), so it
 * gets the same hashing budget-terry gives real passwords (ADR-011 there).
 */
@Injectable()
export class PinService {
  hash(pin: string): Promise<string> {
    return argon2.hash(pin, { type: argon2.argon2id });
  }

  verify(hash: string, pin: string): Promise<boolean> {
    return argon2.verify(hash, pin);
  }
}
