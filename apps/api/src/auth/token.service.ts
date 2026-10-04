import { randomBytes, randomInt, createHash, createHmac } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { TenantRole } from "@queueflow/types";

const LOGIN_CODE_TTL_MINUTES = 10;
const PENDING_TOKEN_TTL = "5m";
const PENDING_TOKEN_PURPOSE = "tenant-selection";
const DEVICE_TRUST_TTL_DAYS = 90;

export interface GeneratedLoginCode {
  code: string;
  codeHash: string;
  expiresAt: Date;
}

export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface GeneratedDeviceTrustToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: TenantRole;
}

/**
 * Customer accounts (Phase 9, D-09) get their own access-token shape, not
 * AccessTokenPayload — there's no `role` (a customer isn't staff), and the
 * `type` discriminator exists purely as defense-in-depth so a customer
 * token can never be mistaken for (or replayed against) a staff-only route
 * even if both happened to share a JWT secret and a `sub`/`tenantId` shape.
 */
export interface CustomerAccessTokenPayload {
  sub: string;
  tenantId: string;
  type: "customer";
}

export interface PendingTokenPayload {
  sub: string;
  purpose: typeof PENDING_TOKEN_PURPOSE;
}

/**
 * OTP codes, JWT access tokens, opaque refresh tokens, and the short-lived
 * "pending" token used between OTP verification and tenant selection
 * (G-03) — all in one place since they're all "prove who you are, then
 * mint a credential" concerns. Business rules (attempt limits, whether a
 * code is still valid) live in AuthService; this is pure generation/hashing.
 */
const PLATFORM_TOKEN_PURPOSE = "platform-admin";

export interface PlatformTokenPayload {
  sub: string;
  email: string;
  purpose: typeof PLATFORM_TOKEN_PURPOSE;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateLoginCode(): GeneratedLoginCode {
    // 6 digits, zero-padded (G-05) — e.g. "004821".
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MINUTES * 60 * 1000);
    return { code, codeHash: this.hashSecret(code), expiresAt };
  }

  hashLoginCode(code: string): string {
    return this.hashSecret(code);
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(32).toString("base64url");
    const ttlDays = Number(this.configService.get("REFRESH_TOKEN_TTL_DAYS") ?? 30);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    return { token, tokenHash: this.hashSecret(token), expiresAt };
  }

  hashRefreshToken(token: string): string {
    return this.hashSecret(token);
  }

  /**
   * The "tablet trusts once" half of D-03a — same opaque-random-plus-hash
   * shape as a refresh token, but on its own 90-day TTL and its own table
   * (DeviceTrust), since it survives logout by design (a trusted device
   * should skip straight to PIN switching even after signing out).
   */
  generateDeviceTrustToken(): GeneratedDeviceTrustToken {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + DEVICE_TRUST_TTL_DAYS * 24 * 60 * 60 * 1000);
    return { token, tokenHash: this.hashSecret(token), expiresAt };
  }

  hashDeviceTrustToken(token: string): string {
    return this.hashSecret(token);
  }

  generateAccessToken(payload: AccessTokenPayload): string {
    const expiresIn = this.configService.get("JWT_ACCESS_TTL") ?? "1h";
    return this.jwtService.sign(payload, { expiresIn });
  }

  generateCustomerAccessToken(payload: CustomerAccessTokenPayload): string {
    const expiresIn = this.configService.get("JWT_ACCESS_TTL") ?? "1h";
    return this.jwtService.sign(payload, { expiresIn });
  }

  /**
   * Platform (root) admin token (Phase 19, ADR-018). Signed with a key
   * derived from the access secret but distinct from it, so it can never
   * pass as a staff or customer token (and vice versa). Short-lived and
   * not refreshable: the platform view is occasional and read-only.
   */
  generatePlatformToken(userId: string, email: string): string {
    const payload: PlatformTokenPayload = { sub: userId, email, purpose: PLATFORM_TOKEN_PURPOSE };
    return this.jwtService.sign(payload, { expiresIn: "4h", secret: this.platformSecret() });
  }

  /** Throws UnauthorizedException unless `token` is a live platform token. */
  verifyPlatformToken(token: string): PlatformTokenPayload {
    try {
      const payload = this.jwtService.verify<PlatformTokenPayload>(token, {
        secret: this.platformSecret(),
      });
      if (payload.purpose !== PLATFORM_TOKEN_PURPOSE) throw new Error("wrong purpose");
      return payload;
    } catch {
      throw new UnauthorizedException({
        code: "PLATFORM_SESSION_INVALID",
        message: "Please sign in again.",
      });
    }
  }

  private platformSecret(): string {
    const base = this.configService.get<string>("JWT_ACCESS_SECRET") ?? "dev-only-change-me";
    return createHmac("sha256", base).update("queueflow-platform-admin").digest("hex");
  }

  /**
   * Short-lived token proving "this user just completed OTP verification"
   * without yet naming a tenant — used only to call select-tenant (G-03).
   * Deliberately never accepted by the main JwtAuthGuard (different shape,
   * different purpose claim, verified manually here instead of via the
   * passport strategy).
   */
  generatePendingToken(userId: string): string {
    const payload: PendingTokenPayload = { sub: userId, purpose: PENDING_TOKEN_PURPOSE };
    return this.jwtService.sign(payload, { expiresIn: PENDING_TOKEN_TTL });
  }

  verifyPendingToken(token: string): PendingTokenPayload {
    let payload: PendingTokenPayload;
    try {
      payload = this.jwtService.verify<PendingTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_PENDING_TOKEN",
        message: "This tenant-selection request has expired. Please log in again.",
      });
    }
    if (payload.purpose !== PENDING_TOKEN_PURPOSE) {
      throw new UnauthorizedException({
        code: "INVALID_PENDING_TOKEN",
        message: "This tenant-selection request has expired. Please log in again.",
      });
    }
    return payload;
  }

  private hashSecret(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
