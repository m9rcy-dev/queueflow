import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CustomerAuthService } from "./customer-auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "../auth/token.service";
import { EmailProvider } from "../notifications/email-provider";
import { CustomersService } from "../customers/customers.service";

describe("CustomerAuthService", () => {
  let service: CustomerAuthService;
  let prisma: {
    customer: Record<string, jest.Mock>;
    customerLoginCode: Record<string, jest.Mock>;
    customerRefreshToken: Record<string, jest.Mock>;
    tenant: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let tokenService: Record<string, jest.Mock>;
  let emailProvider: { send: jest.Mock };
  let customersService: { signUp: jest.Mock };

  const tenantId = "tenant-1";
  const customer = {
    id: "cust-1",
    tenantId,
    phoneE164: "+64211234567",
    firstName: "Alice",
    email: "alice@example.com",
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn() },
      customerLoginCode: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      customerRefreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      tenant: { findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    tokenService = {
      generateLoginCode: jest.fn(() => ({
        code: "123456",
        codeHash: "hash1",
        expiresAt: new Date(),
      })),
      hashLoginCode: jest.fn((code: string) => `hash-of-${code}`),
      generateRefreshToken: jest.fn(() => ({
        token: "refresh-plain",
        tokenHash: "refresh-hash",
        expiresAt: new Date(Date.now() + 1000),
      })),
      hashRefreshToken: jest.fn((token: string) => `hash-of-${token}`),
      generateCustomerAccessToken: jest.fn(() => "access-token"),
    };
    emailProvider = { send: jest.fn() };
    customersService = { signUp: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CustomerAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        { provide: EmailProvider, useValue: emailProvider },
        { provide: CustomersService, useValue: customersService },
      ],
    }).compile();

    service = module.get(CustomerAuthService);
  });

  describe("signUp", () => {
    it("creates the account via CustomersService, then sends an OTP to the given email", async () => {
      customersService.signUp.mockResolvedValue(customer);

      await service.signUp({
        tenantId,
        name: "Alice",
        phone: "021 123 4567",
        email: "alice@example.com",
      });

      expect(customersService.signUp).toHaveBeenCalledWith(tenantId, {
        tenantId,
        name: "Alice",
        phone: "021 123 4567",
        email: "alice@example.com",
      });
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "alice@example.com",
          body: expect.stringContaining("123456"),
        }),
      );
      expect(prisma.customerLoginCode.create).toHaveBeenCalledWith({
        data: { customerId: "cust-1", codeHash: "hash1", expiresAt: expect.any(Date) },
      });
    });
  });

  describe("requestLoginCode (G-05)", () => {
    it("silently no-ops for an unknown email", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await service.requestLoginCode(tenantId, "nobody@example.com");
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it("sends a fresh OTP for a known email", async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      await service.requestLoginCode(tenantId, "alice@example.com");
      expect(emailProvider.send).toHaveBeenCalled();
    });
  });

  describe("verifyLoginCode", () => {
    it("401s for an unknown email — same failure as a wrong code (G-05)", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyLoginCode(tenantId, "nobody@example.com", "123456"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("401s when the code doesn't match, and records the failed attempt", async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.customerLoginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hash-of-654321",
        attempts: 0,
      });

      await expect(
        service.verifyLoginCode(tenantId, "alice@example.com", "123456"),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.customerLoginCode.update).toHaveBeenCalledWith({
        where: { id: "code-1" },
        data: { attempts: { increment: 1 } },
      });
    });

    it("issues a session (access + refresh token) on a correct code", async () => {
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.customerLoginCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: "hash-of-123456",
        attempts: 0,
      });
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({ id: tenantId, name: "Joe's Barbers" });

      const result = await service.verifyLoginCode(tenantId, "alice@example.com", "123456");

      expect(prisma.customerLoginCode.update).toHaveBeenCalledWith({
        where: { id: "code-1" },
        data: { consumedAt: expect.any(Date) },
      });
      expect(tokenService.generateCustomerAccessToken).toHaveBeenCalledWith({
        sub: "cust-1",
        tenantId,
        type: "customer",
      });
      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-plain",
        customer: {
          id: "cust-1",
          firstName: "Alice",
          phoneE164: "+64211234567",
          email: "alice@example.com",
        },
        tenant: { id: tenantId, name: "Joe's Barbers" },
      });
    });
  });

  describe("refresh (ADR-004 rotation)", () => {
    it("401s for an unknown/expired/revoked refresh token", async () => {
      prisma.customerRefreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh("bad-token")).rejects.toThrow(UnauthorizedException);
    });

    it("404s if the customer behind the token no longer exists", async () => {
      prisma.customerRefreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        customerId: "cust-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.refresh("plain-token")).rejects.toThrow(NotFoundException);
    });

    it("rotates: revokes the old token and issues a new one", async () => {
      prisma.customerRefreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        customerId: "cust-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.customer.findUnique.mockResolvedValue(customer);

      const result = await service.refresh("plain-token");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: "access-token", refreshToken: "refresh-plain" });
    });
  });

  describe("logout", () => {
    it("revokes the matching, still-active refresh token", async () => {
      await service.logout("plain-token");
      expect(prisma.customerRefreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: "hash-of-plain-token", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
