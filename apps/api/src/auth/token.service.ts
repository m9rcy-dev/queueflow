import { randomBytes, randomInt, createHash } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { TenantRole } from "@queueflow/types";

const LOGIN_CODE_TTL_MINUTES = 10;
const PENDING_TOKEN_TTL = "5m";
const PENDING_TOKEN_PURPOSE = "tenant-selection";

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

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: TenantRole;
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

  generateAccessToken(payload: AccessTokenPayload): string {
    const expiresIn = this.configService.get("JWT_ACCESS_TTL") ?? "1h";
    return this.jwtService.sign(payload, { expiresIn });
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
