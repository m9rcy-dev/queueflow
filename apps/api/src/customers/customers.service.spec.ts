import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CustomersService } from "./customers.service";
import { PrismaService } from "../prisma/prisma.service";
import { CodesService } from "../codes/codes.service";
import { QueueEntriesService } from "../queue-entries/queue-entries.service";

describe("CustomersService", () => {
  let service: CustomersService;
  let prisma: {
    customer: Record<string, jest.Mock>;
    tenant: Record<string, jest.Mock>;
  };
  let codesService: { createForCustomer: jest.Mock; regenerateForCustomer: jest.Mock };
  let queueEntriesService: { getActiveForCustomer: jest.Mock };

  const tenantId = "tenant-1";
  const customerRow = {
    id: "cust-1",
    tenantId,
    phoneE164: "+64211234567",
    firstName: "Alice",
    email: null as string | null,
  };

  beforeEach(async () => {
    prisma = {
      customer: { findUnique: jest.fn(), upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
      tenant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    };
    codesService = { createForCustomer: jest.fn(), regenerateForCustomer: jest.fn() };
    queueEntriesService = { getActiveForCustomer: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CodesService, useValue: codesService },
        { provide: QueueEntriesService, useValue: queueEntriesService },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe("createByStaff (G-56)", () => {
    it("upserts the customer by (tenantId, phoneE164) and mints an identity code immediately, no OTP", async () => {
      prisma.customer.findUnique.mockResolvedValue(null); // no email conflict check needed (no email given)
      prisma.customer.upsert.mockResolvedValue(customerRow);
      codesService.createForCustomer.mockResolvedValue({ publicCode: "ABCD1234" });

      const result = await service.createByStaff(tenantId, {
        name: "Alice",
        phone: "021 123 4567",
      });

      expect(prisma.customer.upsert).toHaveBeenCalledWith({
        where: { tenantId_phoneE164: { tenantId, phoneE164: "+64211234567" } },
        create: { tenantId, phoneE164: "+64211234567", firstName: "Alice", email: null },
        update: { firstName: "Alice" },
      });
      expect(codesService.createForCustomer).toHaveBeenCalledWith(tenantId, "cust-1");
      expect(result).toEqual({
        customer: { id: "cust-1", firstName: "Alice", phoneE164: "+64211234567", email: null },
        identityCode: "ABCD1234",
      });
    });

    it("rejects when the email is already registered to a different phone number in this tenant", async () => {
      prisma.customer.findUnique.mockResolvedValue({ ...customerRow, phoneE164: "+64299999999" });

      await expect(
        service.createByStaff(tenantId, {
          name: "Alice",
          phone: "021 123 4567",
          email: "alice@example.com",
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it("allows re-signing up the same phone+email combination (not a conflict with itself)", async () => {
      prisma.customer.findUnique.mockResolvedValue(customerRow); // same phoneE164 as the upsert target
      prisma.customer.upsert.mockResolvedValue({ ...customerRow, email: "alice@example.com" });
      codesService.createForCustomer.mockResolvedValue({ publicCode: "ABCD1234" });

      await expect(
        service.createByStaff(tenantId, {
          name: "Alice",
          phone: "021 123 4567",
          email: "alice@example.com",
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("signUp (self-service via GENERAL code, D-10)", () => {
    it("404s for an unknown tenant", async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.signUp(tenantId, {
          tenantId,
          name: "Bob",
          phone: "021 000 0000",
          email: "bob@example.com",
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
    });

    it("upserts the customer and mints an identity code", async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, name: "Joe's Barbers" });
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.upsert.mockResolvedValue({ ...customerRow, email: "bob@example.com" });
      codesService.createForCustomer.mockResolvedValue({ publicCode: "WXYZ5678" });

      const result = await service.signUp(tenantId, {
        tenantId,
        name: "Bob",
        phone: "021 123 4567",
        email: "bob@example.com",
      });

      expect(codesService.createForCustomer).toHaveBeenCalledWith(tenantId, "cust-1");
      expect(result.email).toBe("bob@example.com");
    });
  });

  describe("getPortalSummary (G-55)", () => {
    it("mints (or reuses) the identity code lazily alongside the customer/tenant lookups", async () => {
      prisma.customer.findUniqueOrThrow.mockResolvedValue(customerRow);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({ id: tenantId, name: "Joe's Barbers" });
      codesService.createForCustomer.mockResolvedValue({ publicCode: "ABCD1234" });

      const result = await service.getPortalSummary(tenantId, "cust-1");

      expect(result).toEqual({
        customer: { id: "cust-1", firstName: "Alice", phoneE164: "+64211234567", email: null },
        tenant: { id: tenantId, name: "Joe's Barbers", logoPath: null },
        identityCode: "ABCD1234",
      });
    });
  });

  describe("regenerateIdentityCode", () => {
    it("delegates to CodesService's rotation (deactivate + mint fresh)", async () => {
      codesService.regenerateForCustomer.mockResolvedValue({ publicCode: "NEWCODE1" });
      const result = await service.regenerateIdentityCode(tenantId, "cust-1");
      expect(codesService.regenerateForCustomer).toHaveBeenCalledWith(tenantId, "cust-1");
      expect(result).toBe("NEWCODE1");
    });
  });

  describe("getActiveEntry", () => {
    it("delegates to QueueEntriesService", async () => {
      queueEntriesService.getActiveForCustomer.mockResolvedValue(null);
      const result = await service.getActiveEntry(tenantId, "cust-1");
      expect(queueEntriesService.getActiveForCustomer).toHaveBeenCalledWith(tenantId, "cust-1");
      expect(result).toBeNull();
    });
  });
});
