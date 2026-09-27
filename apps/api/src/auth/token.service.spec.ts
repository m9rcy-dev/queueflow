import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { TokenService } from "./token.service";

describe("TokenService", () => {
  let service: TokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: new JwtService({ secret: "test-secret" }),
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === "REFRESH_TOKEN_TTL_DAYS" ? "30" : undefined) },
        },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  describe("generateLoginCode", () => {
    it("produces a 6-digit zero-padded code", () => {
      const { code } = service.generateLoginCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it("sets a 10-minute expiry", () => {
      const before = Date.now();
      const { expiresAt } = service.generateLoginCode();
      const diffMinutes = (expiresAt.getTime() - before) / 60_000;
      expect(diffMinutes).toBeGreaterThan(9.9);
      expect(diffMinutes).toBeLessThan(10.1);
    });

    it("hashes the code — the hash never equals the plaintext code", () => {
      const { code, codeHash } = service.generateLoginCode();
      expect(codeHash).not.toBe(code);
      expect(codeHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    });

    it("hashLoginCode is deterministic and matches generateLoginCode's hash", () => {
      const { code, codeHash } = service.generateLoginCode();
      expect(service.hashLoginCode(code)).toBe(codeHash);
    });
  });

  describe("generateRefreshToken", () => {
    it("produces a high-entropy opaque token, not the hash", () => {
      const { token, tokenHash } = service.generateRefreshToken();
      expect(token).not.toBe(tokenHash);
      expect(token.length).toBeGreaterThanOrEqual(32);
    });

    it("two calls never produce the same token", () => {
      const a = service.generateRefreshToken();
      const b = service.generateRefreshToken();
      expect(a.token).not.toBe(b.token);
    });
  });

  describe("access tokens", () => {
    it("round-trips through the JwtService with the expected claims", () => {
      const token = service.generateAccessToken({
        sub: "user-1",
        tenantId: "tenant-1",
        role: "TENANT_OWNER",
      });
      const jwt = new JwtService({ secret: "test-secret" });
      const payload = jwt.verify(token);
      expect(payload.sub).toBe("user-1");
      expect(payload.tenantId).toBe("tenant-1");
      expect(payload.role).toBe("TENANT_OWNER");
    });
  });

  describe("pending tokens (tenant selection, G-03)", () => {
    it("verifies a token it just generated", () => {
      const pending = service.generatePendingToken("user-1");
      const payload = service.verifyPendingToken(pending);
      expect(payload.sub).toBe("user-1");
      expect(payload.purpose).toBe("tenant-selection");
    });

    it("rejects a garbage token", () => {
      expect(() => service.verifyPendingToken("garbage")).toThrow(UnauthorizedException);
    });

    it("rejects a normal access token presented as a pending token", () => {
      const accessToken = service.generateAccessToken({
        sub: "user-1",
        tenantId: "tenant-1",
        role: "STAFF",
      });
      expect(() => service.verifyPendingToken(accessToken)).toThrow(UnauthorizedException);
    });
  });
});
