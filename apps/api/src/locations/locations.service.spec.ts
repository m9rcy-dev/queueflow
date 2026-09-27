import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LocationsService } from "./locations.service";
import { PrismaService } from "../prisma/prisma.service";

describe("LocationsService", () => {
  let service: LocationsService;
  let prisma: {
    location: Record<string, jest.Mock>;
    businessHours: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  const tenantId = "tenant-1";
  const location = {
    id: "loc-1",
    tenantId,
    name: "Christchurch",
    address: "123 Main St",
    timezone: "Pacific/Auckland",
  };

  beforeEach(async () => {
    prisma = {
      location: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      businessHours: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [LocationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(LocationsService);
  });

  describe("create", () => {
    it("creates the location scoped to the caller's tenant", async () => {
      prisma.location.create.mockResolvedValue(location);
      const result = await service.create(tenantId, {
        name: "Christchurch",
        address: "123 Main St",
        timezone: "Pacific/Auckland",
      });
      expect(prisma.location.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: "Christchurch",
          address: "123 Main St",
          timezone: "Pacific/Auckland",
        },
      });
      expect(result.id).toBe(location.id);
    });
  });

  describe("get / update — ownership-in-the-query", () => {
    it("throws NotFoundException for a location belonging to another tenant", async () => {
      prisma.location.findFirst.mockResolvedValue(null);
      await expect(service.get("some-other-tenant", "loc-1")).rejects.toThrow(NotFoundException);
      expect(prisma.location.findFirst).toHaveBeenCalledWith({
        where: { id: "loc-1", tenantId: "some-other-tenant" },
      });
    });

    it("returns the location when it belongs to the caller's tenant", async () => {
      prisma.location.findFirst.mockResolvedValue(location);
      const result = await service.get(tenantId, "loc-1");
      expect(result.name).toBe("Christchurch");
    });

    it("update rejects a location it doesn't own before touching the database", async () => {
      prisma.location.findFirst.mockResolvedValue(null);
      await expect(service.update(tenantId, "loc-1", { name: "New Name" })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.location.update).not.toHaveBeenCalled();
    });

    it("update only writes the fields provided", async () => {
      prisma.location.findFirst.mockResolvedValue(location);
      prisma.location.update.mockResolvedValue({ ...location, name: "New Name" });
      await service.update(tenantId, "loc-1", { name: "New Name" });
      expect(prisma.location.update).toHaveBeenCalledWith({
        where: { id: "loc-1" },
        data: { name: "New Name" },
      });
    });
  });

  describe("business hours", () => {
    it("rejects reading hours for a location it doesn't own", async () => {
      prisma.location.findFirst.mockResolvedValue(null);
      await expect(service.getBusinessHours(tenantId, "loc-1")).rejects.toThrow(NotFoundException);
    });

    it("replace is full-delete-then-recreate inside one transaction, not a merge", async () => {
      prisma.location.findFirst.mockResolvedValue(location);
      prisma.$transaction.mockResolvedValue(undefined);
      prisma.businessHours.findMany.mockResolvedValue([
        { dayOfWeek: 1, opensAtMinutes: 540, closesAtMinutes: 720 },
        { dayOfWeek: 1, opensAtMinutes: 780, closesAtMinutes: 1020 },
      ]);

      const result = await service.replaceBusinessHours(tenantId, "loc-1", {
        entries: [
          { dayOfWeek: 1, opensAtMinutes: 540, closesAtMinutes: 720 },
          { dayOfWeek: 1, opensAtMinutes: 780, closesAtMinutes: 1020 },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      const transactionArg = prisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(2); // deleteMany + createMany, in that order
      expect(result).toHaveLength(2); // split period (plan §39) survives round-trip
    });
  });
});
