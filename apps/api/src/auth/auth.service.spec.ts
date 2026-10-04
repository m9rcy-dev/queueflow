import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { AuthenticatorService } from "../authenticator/authenticator.service";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { PinService } from "./pin.service";
import { TokenService } from "./token.service";

describe("AuthService", () => {
  let service: AuthService;
  let prisma: {
    user: Record<string, jest.Mock>;
    tenant: Record<string, jest.Mock>;
    tenantUser: Record<string, jest.Mock>;
    loginCode: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
    tenantInvite: Record<string, jest.Mock>;
    deviceTrust: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let tokenService: Record<string, jest.Mock>;
  let mailService: Record<string, jest.Mock>;
  let pinService: Record<string, jest.Mock>;
  let authenticator: {
    isEnabled: jest.Mock;
    check: jest.Mock;
    recordFailure: jest.Mock;
    beginSetup: jest.Mock;
  };

  const user = { id: "user-1", email: "joe@example.com", displayName: "Joe" };
  const tenant = {
    id: "tenant-1",
    name: "Joe's Barbers",
    ownerName: "Joe",
    queueEnabled: true,
    appointmentEnabled: false,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      tenant: { create: jest.fn() },
      tenantUser: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      loginCode: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      tenantInvite: { findUnique: jest.fn(), update: jest.fn() },
      deviceTrust: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    tokenService = {
      generateLoginCode: jest.fn(() => ({
        code: "123456",
        codeHash: "hashed-123456",
        expiresAt: new Date(Date.now() + 600_000),
      })),
      hashLoginCode: jest.fn((code: string) => `hashed-${code}`),
      generateRefreshToken: jest.fn(() => ({
        token: "opaque-refresh-token",
        tokenHash: "hashed-refresh",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })),
      hashRefreshToken: jest.fn(() => "hashed-refresh"),
      generateAccessToken: jest.fn(() => "signed-access-token"),
      generatePendingToken: jest.fn(() => "signed-pending-token"),
      verifyPendingToken: jest.fn(() => ({ sub: user.id, purpose: "tenant-selection" })),
      generateDeviceTrustToken: jest.fn(() => ({
        token: "opaque-device-trust-token",
        tokenHash: "hashed-device-trust",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      })),
      hashDeviceTrustToken: jest.fn(() => "hashed-device-trust"),
    };
    mailService = {
      sendLoginCode: jest.fn(),
      sendInviteCode: jest.fn(),
      sendInviteLink: jest.fn(),
    };
    // Default: no authenticator set up — the Phase 1–14 behaviour.
    authenticator = {
      isEnabled: jest.fn().mockResolvedValue(false),
      check: jest.fn().mockResolvedValue("not-enabled"),
      recordFailure: jest.fn(),
      beginSetup: jest.fn(),
    };
    pinService = {
      hash: jest.fn(async (pin: string) => `hashed-pin-${pin}`),
      verify: jest.fn(async (hash: string, pin: string) => hash === `hashed-pin-${pin}`),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        { provide: MailService, useValue: mailService },
        { provide: PinService, useValue: pinService },
        { provide: AuthenticatorService, useValue: authenticator },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe("signUpBusiness", () => {
    it("rejects an email that already has an account", async () => {
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.signUpBusiness({ businessName: "X", ownerName: "Y", email: user.email }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("creates the user, tenant, and OWNER membership, then sends a code", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const tx = {
        user: { create: jest.fn().mockResolvedValue(user) },
        tenant: { create: jest.fn().mockResolvedValue(tenant) },
        tenantUser: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      await service.signUpBusiness({
        businessName: "Joe's Barbers",
        ownerName: "Joe",
        email: user.email,
      });

      expect(tx.user.create).toHaveBeenCalledWith({
        data: { email: user.email, displayName: "Joe" },
      });
      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: { name: "Joe's Barbers", ownerName: "Joe" },
      });
      expect(tx.tenantUser.create).toHaveBeenCalledWith({
        data: { tenantId: tenant.id, userId: user.id, role: "TENANT_OWNER" },
      });
      expect(mailService.sendLoginCode).toHaveBeenCalledWith(user.email, "123456");
    });
  });

  describe("requestLoginCode", () => {
    it("does nothing (no email sent) for an unknown email — but doesn't throw", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.requestLoginCode("nobody@example.com")).resolves.toBeUndefined();
      expect(mailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it("sends a code for a known email", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await service.requestLoginCode(user.email);
      expect(mailService.sendLoginCode).toHaveBeenCalledWith(user.email, "123456");
    });

    it("sends no email when the account uses an authenticator app (Phase 15)", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      authenticator.isEnabled.mockResolvedValue(true);
      await service.requestLoginCode(user.email);
      expect(mailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it("always emails when asked to ('Email me a code instead'), authenticator or not", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      authenticator.isEnabled.mockResolvedValue(true);
      await service.requestLoginCode(user.email, true);
      expect(mailService.sendLoginCode).toHaveBeenCalledWith(user.email, "123456");
    });
  });

  describe("verifyLoginCode with an authenticator app (Phase 15)", () => {
    it("logs in on a valid authenticator code without touching emailed codes", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      authenticator.check.mockResolvedValue("valid");
      prisma.tenantUser.findMany.mockResolvedValue([
        { tenantId: tenant.id, role: "TENANT_OWNER", tenant },
      ]);
      const result = await service.verifyLoginCode(user.email, "654321");
      expect(result.requiresTenantSelection).toBe(false);
      expect(prisma.loginCode.findFirst).not.toHaveBeenCalled();
    });

    it("counts an authenticator failure only when the emailed code didn't match either", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      authenticator.check.mockResolvedValue("invalid");
      prisma.loginCode.findFirst.mockResolvedValue(null);
      await expect(service.verifyLoginCode(user.email, "000000")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authenticator.recordFailure).toHaveBeenCalledWith({ userId: user.id });
    });

    it("still accepts the emailed code when the authenticator is locked, without counting a failure", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      authenticator.check.mockResolvedValue("locked");
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 0,
      });
      prisma.tenantUser.findMany.mockResolvedValue([
        { tenantId: tenant.id, role: "TENANT_OWNER", tenant },
      ]);
      await expect(service.verifyLoginCode(user.email, "123456")).resolves.toMatchObject({
        requiresTenantSelection: false,
      });
      expect(authenticator.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe("verifyLoginCode", () => {
    it("rejects an unknown email with the generic invalid-code error", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyLoginCode("nobody@example.com", "123456")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects when there is no valid unconsumed code", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.loginCode.findFirst.mockResolvedValue(null);
      await expect(service.verifyLoginCode(user.email, "123456")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("increments attempts and rejects on a wrong code", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 0,
      });

      await expect(service.verifyLoginCode(user.email, "000000")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.loginCode.update).toHaveBeenCalledWith({
        where: { id: "code-1" },
        data: { attempts: { increment: 1 } },
      });
    });

    it("rejects once max attempts have been reached, even with the right code", async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 5,
      });
      await expect(service.verifyLoginCode(user.email, "123456")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("issues a session directly when the user has exactly one membership", async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 0,
      });
      prisma.tenantUser.findMany.mockResolvedValue([
        { tenantId: tenant.id, role: "TENANT_OWNER", tenant },
      ]);

      const result = await service.verifyLoginCode(user.email, "123456");

      expect(result.requiresTenantSelection).toBe(false);
      if (!result.requiresTenantSelection) {
        expect(result.tenant.id).toBe(tenant.id);
        expect(result.role).toBe("TENANT_OWNER");
        expect(result.accessToken).toBe("signed-access-token");
      }
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });

    it("requires tenant selection when the user has more than one membership (G-03)", async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: new Date() });
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 0,
      });
      prisma.tenantUser.findMany.mockResolvedValue([
        { tenantId: "tenant-1", role: "TENANT_OWNER", tenant: { name: "Joe's Barbers" } },
        { tenantId: "tenant-2", role: "STAFF", tenant: { name: "Jane's Salon" } },
      ]);

      const result = await service.verifyLoginCode(user.email, "123456");

      expect(result.requiresTenantSelection).toBe(true);
      if (result.requiresTenantSelection) {
        expect(result.tenants).toHaveLength(2);
        expect(result.pendingToken).toBe("signed-pending-token");
      }
      // No session issued yet — no refresh token persisted.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("rejects when the user has zero memberships", async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: new Date() });
      prisma.loginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hashed-123456",
        attempts: 0,
      });
      prisma.tenantUser.findMany.mockResolvedValue([]);

      await expect(service.verifyLoginCode(user.email, "123456")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("selectTenant", () => {
    it("issues a session for a tenant the user actually belongs to", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue({ role: "STAFF", tenant, user });

      const result = await service.selectTenant("pending-token", tenant.id);

      expect(result.requiresTenantSelection).toBe(false);
      if (!result.requiresTenantSelection) {
        expect(result.role).toBe("STAFF");
      }
    });

    it("rejects a tenant the user doesn't belong to", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue(null);
      await expect(service.selectTenant("pending-token", "some-other-tenant")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("refresh", () => {
    it("rejects a token that doesn't exist", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh("nope")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a revoked token", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        userId: user.id,
        tenantId: tenant.id,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      });
      await expect(service.refresh("revoked")).rejects.toThrow(UnauthorizedException);
    });

    it("revokes the token and rejects if the membership no longer exists", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        userId: user.id,
        tenantId: tenant.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000),
      });
      prisma.tenantUser.findUnique.mockResolvedValue(null);

      await expect(service.refresh("token")).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "rt-1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rotates the token on success", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        userId: user.id,
        tenantId: tenant.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000),
      });
      prisma.tenantUser.findUnique.mockResolvedValue({ role: "TENANT_OWNER" });
      prisma.$transaction.mockResolvedValue(undefined);

      const result = await service.refresh("token");

      expect(result.refreshToken).toBe("opaque-refresh-token");
      expect(result.accessToken).toBe("signed-access-token");
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes the matching, still-active refresh token", async () => {
      await service.logout("some-token");
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: "hashed-refresh", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe("trustDevice (D-03a)", () => {
    it("creates a DeviceTrust row scoped to the tenant and returns the plaintext token", async () => {
      const result = await service.trustDevice(tenant.id);

      expect(prisma.deviceTrust.create).toHaveBeenCalledWith({
        data: {
          tenantId: tenant.id,
          tokenHash: "hashed-device-trust",
          expiresAt: expect.any(Date),
        },
      });
      expect(result.deviceTrustToken).toBe("opaque-device-trust-token");
    });
  });

  describe("getDeviceContext (D-03a)", () => {
    const activeTrust = {
      id: "trust-1",
      tenantId: tenant.id,
      tokenHash: "hashed-device-trust",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000),
    };

    it("rejects an unknown, expired, or revoked trust token", async () => {
      prisma.deviceTrust.findUnique.mockResolvedValue(null);
      await expect(service.getDeviceContext("nope")).rejects.toThrow(UnauthorizedException);
    });

    it("rotates the token and returns the tenant's staff roster with hasPin", async () => {
      prisma.deviceTrust.findUnique.mockResolvedValue(activeTrust);
      prisma.$transaction.mockResolvedValue(undefined);
      prisma.tenant = { ...prisma.tenant, findUniqueOrThrow: jest.fn().mockResolvedValue(tenant) };
      prisma.tenantUser.findMany.mockResolvedValue([
        { id: "tu-1", role: "STAFF", pinHash: "some-hash", user: { displayName: "Alice" } },
        { id: "tu-2", role: "TENANT_OWNER", pinHash: null, user: { displayName: "Joe" } },
      ]);

      const result = await service.getDeviceContext("presented-token");

      expect(result.deviceTrustToken).toBe("opaque-device-trust-token");
      expect(result.tenant).toEqual({ id: tenant.id, name: tenant.name });
      expect(result.staff).toEqual([
        { tenantUserId: "tu-1", displayName: "Alice", role: "STAFF", hasPin: true },
        { tenantUserId: "tu-2", displayName: "Joe", role: "TENANT_OWNER", hasPin: false },
      ]);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("staffPinLogin (D-03a)", () => {
    const activeTrust = {
      id: "trust-1",
      tenantId: tenant.id,
      tokenHash: "hashed-device-trust",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000),
    };
    const membership = {
      id: "tu-1",
      tenantId: tenant.id,
      role: "STAFF" as const,
      pinHash: "hashed-pin-4242",
      pinFailedAttempts: 0,
      pinLockedUntil: null as Date | null,
      user,
      tenant,
    };

    beforeEach(() => {
      prisma.deviceTrust.findUnique.mockResolvedValue(activeTrust);
    });

    it("rejects a device trust token that isn't recognized", async () => {
      prisma.deviceTrust.findUnique.mockResolvedValue(null);
      await expect(service.staffPinLogin("nope", "tu-1", "4242")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects a tenantUserId belonging to a different tenant than the trusted device", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue({ ...membership, tenantId: "other-tenant" });
      await expect(service.staffPinLogin("token", "tu-1", "4242")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects when locked out, without even checking the PIN", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue({
        ...membership,
        pinLockedUntil: new Date(Date.now() + 60_000),
      });
      await expect(service.staffPinLogin("token", "tu-1", "4242")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(pinService.verify).not.toHaveBeenCalled();
    });

    it("rejects an incorrect PIN and records the failed attempt", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue(membership);
      await expect(service.staffPinLogin("token", "tu-1", "0000")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.tenantUser.update).toHaveBeenCalledWith({
        where: { id: "tu-1" },
        data: { pinFailedAttempts: 1 },
      });
    });

    it("locks the membership out after the max number of failed attempts", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue({ ...membership, pinFailedAttempts: 4 });
      await expect(service.staffPinLogin("token", "tu-1", "0000")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.tenantUser.update).toHaveBeenCalledWith({
        where: { id: "tu-1" },
        data: { pinFailedAttempts: 5, pinLockedUntil: expect.any(Date) },
      });
    });

    it("rejects when no PIN has been set at all", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue({ ...membership, pinHash: null });
      await expect(service.staffPinLogin("token", "tu-1", "4242")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("issues a normal session and resets the failure counter on a correct PIN", async () => {
      prisma.tenantUser.findUnique.mockResolvedValue(membership);
      const result = await service.staffPinLogin("token", "tu-1", "4242");

      expect(prisma.tenantUser.update).toHaveBeenCalledWith({
        where: { id: "tu-1" },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
      expect(result.requiresTenantSelection).toBe(false);
      if (!result.requiresTenantSelection) {
        expect(result.accessToken).toBe("signed-access-token");
        expect(result.role).toBe("STAFF");
      }
    });
  });

  describe("setPin", () => {
    it("hashes and stores the PIN, clearing any prior lockout", async () => {
      await service.setPin("tu-1", "4242");
      expect(pinService.hash).toHaveBeenCalledWith("4242");
      expect(prisma.tenantUser.update).toHaveBeenCalledWith({
        where: { id: "tu-1" },
        data: { pinHash: "hashed-pin-4242", pinFailedAttempts: 0, pinLockedUntil: null },
      });
    });
  });
});
