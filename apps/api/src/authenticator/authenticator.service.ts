import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthenticatorSetup, AuthenticatorStatus } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "./authenticator-crypto";
import { generateSecret, matchingStep, otpauthUri } from "./totp";

/** Whose credential — a staff User or a Customer account, never both. */
export type AuthenticatorOwner = { userId: string } | { customerId: string };

/** "not-enabled" and "locked" let the caller fall through to the emailed code without counting a failure. */
export type AuthenticatorCheck = "valid" | "invalid" | "locked" | "not-enabled";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function ownerWhere(owner: AuthenticatorOwner) {
  return "userId" in owner ? { userId: owner.userId } : { customerId: owner.customerId };
}

/**
 * Authenticator-app login (Phase 15, ADR-014), shared by staff and
 * customer auth. The emailed code is never replaced, only made optional:
 * login services ask `check()` first and fall back to the emailed code,
 * and `requestLoginCode` skips the email only when the account has this
 * enabled and the user didn't ask for an email.
 */
@Injectable()
export class AuthenticatorService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.key = loadEncryptionKey(
      config.get<string>("AUTHENTICATOR_ENCRYPTION_KEY"),
      config.get<string>("NODE_ENV"),
    );
  }

  async getStatus(owner: AuthenticatorOwner): Promise<AuthenticatorStatus> {
    const credential = await this.prisma.authenticatorCredential.findUnique({
      where: ownerWhere(owner),
    });
    return { enabled: Boolean(credential?.enabledAt && credential.secretEncrypted) };
  }

  async isEnabled(owner: AuthenticatorOwner): Promise<boolean> {
    return (await this.getStatus(owner)).enabled;
  }

  /**
   * Step 1 of setup (the caller is already logged in). Issues a new secret
   * as *pending* — an existing working authenticator keeps working until
   * the new one is confirmed, so setting up a new phone can't lock anyone
   * out. `issuer`/`account` are what the authenticator app displays.
   */
  async beginSetup(
    owner: AuthenticatorOwner,
    issuer: string,
    account: string,
  ): Promise<AuthenticatorSetup> {
    const secret = generateSecret();
    const pendingSecretEncrypted = encryptSecret(secret, this.key);
    await this.prisma.authenticatorCredential.upsert({
      where: ownerWhere(owner),
      create: { ...ownerWhere(owner), pendingSecretEncrypted },
      update: { pendingSecretEncrypted },
    });
    // A colon separates issuer from account in the otpauth label.
    return { otpauthUri: otpauthUri(secret, issuer.replace(/:/g, " "), account), secret };
  }

  /** Step 2: a first correct code proves the app scanned the QR; only then does it become the login method. */
  async confirmSetup(owner: AuthenticatorOwner, code: string): Promise<AuthenticatorStatus> {
    const credential = await this.prisma.authenticatorCredential.findUnique({
      where: ownerWhere(owner),
    });
    const step = credential?.pendingSecretEncrypted
      ? matchingStep(decryptSecret(credential.pendingSecretEncrypted, this.key), code, new Date())
      : null;
    if (!credential || step === null) {
      throw new BadRequestException({
        code: "INVALID_AUTHENTICATOR_CODE",
        message: "That code doesn't match. Check the app shows QueueFlow and try the current code.",
      });
    }
    await this.prisma.authenticatorCredential.update({
      where: { id: credential.id },
      data: {
        secretEncrypted: credential.pendingSecretEncrypted,
        pendingSecretEncrypted: null,
        enabledAt: new Date(),
        lastUsedStep: step,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    return { enabled: true };
  }

  /** Back to emailed codes. No code needed: someone who lost their phone signs in by email and turns this off. */
  async disable(owner: AuthenticatorOwner): Promise<AuthenticatorStatus> {
    await this.prisma.authenticatorCredential.deleteMany({ where: ownerWhere(owner) });
    return { enabled: false };
  }

  /**
   * Checks a login code against the authenticator. Valid only for a time
   * step later than the last one used (claimed with a guarded update, so a
   * code replayed — even concurrently — succeeds once). A success clears
   * the failure count. Failures are recorded separately by the caller via
   * `recordFailure`, once the emailed code has also failed to match.
   */
  async check(
    owner: AuthenticatorOwner,
    code: string,
    now: Date = new Date(),
  ): Promise<AuthenticatorCheck> {
    const credential = await this.prisma.authenticatorCredential.findUnique({
      where: ownerWhere(owner),
    });
    if (!credential?.enabledAt || !credential.secretEncrypted) return "not-enabled";
    if (credential.lockedUntil && credential.lockedUntil > now) return "locked";

    const step = matchingStep(decryptSecret(credential.secretEncrypted, this.key), code, now);
    if (step === null) return "invalid";

    const claimed = await this.prisma.authenticatorCredential.updateMany({
      where: {
        id: credential.id,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step, failedAttempts: 0, lockedUntil: null },
    });
    return claimed.count === 1 ? "valid" : "invalid";
  }

  /** A wrong code: after 5 in a row the authenticator is locked for 15 minutes. The emailed code keeps working throughout. */
  async recordFailure(owner: AuthenticatorOwner, now: Date = new Date()): Promise<void> {
    const credential = await this.prisma.authenticatorCredential.update({
      where: ownerWhere(owner),
      data: { failedAttempts: { increment: 1 } },
    });
    if (credential.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.authenticatorCredential.update({
        where: { id: credential.id },
        data: {
          failedAttempts: 0,
          lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }
  }
}
