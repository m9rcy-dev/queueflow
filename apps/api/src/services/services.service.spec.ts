import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ServicesService } from "./services.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";

describe("ServicesService", () => {
  let service: ServicesService;
  let prisma: { service: Record<string, jest.Mock> };
  let locationsService: { get: jest.Mock };

  const tenantId = "tenant-1";
  const locationId = "loc-1";
  const serviceRow = {
    id: "svc-1",
    tenantId,
    locationId,
    name: "Haircut",
    description: null,
    durationMinutes: 25,
    active: true,
    queueEnabled: true,
    appointmentEnabled: false,
    displayOrder: 0,
  };

  beforeEach(async () => {
    prisma = {
      service: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    locationsService = { get: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocationsService, useValue: locationsService },
      ],
    }).compile();

    service = module.get(ServicesService);
  });

  describe("create", () => {
    it("404s (not 400) when the referenced location isn't owned by this tenant", async () => {
      locationsService.get.mockRejectedValue(new NotFoundException());
      await expect(
        service.create(tenantId, {
          locationId: "someone-elses-location",
          name: "X",
          durationMinutes: 10,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it("creates the service once the location ownership check passes", async () => {
      locationsService.get.mockResolvedValue({ id: locationId });
      prisma.service.create.mockResolvedValue(serviceRow);

      const result = await service.create(tenantId, {
        locationId,
        name: "Haircut",
        durationMinutes: 25,
      });

      expect(locationsService.get).toHaveBeenCalledWith(tenantId, locationId);
      expect(prisma.service.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          locationId,
          name: "Haircut",
          description: null,
          durationMinutes: 25,
          queueEnabled: true,
          appointmentEnabled: false,
          displayOrder: 0,
        },
      });
      expect(result.id).toBe(serviceRow.id);
    });
  });

  describe("list", () => {
    it("scopes by tenant, with an optional location filter", async () => {
      prisma.service.findMany.mockResolvedValue([serviceRow]);
      await service.list(tenantId, locationId);
      expect(prisma.service.findMany).toHaveBeenCalledWith({
        where: { tenantId, locationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    it("omits the location filter entirely when none is given", async () => {
      prisma.service.findMany.mockResolvedValue([]);
      await service.list(tenantId);
      expect(prisma.service.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });
  });

  describe("update", () => {
    it("rejects a service belonging to another tenant before writing", async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(service.update(tenantId, "svc-1", { active: false })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it("can toggle active independently of other fields", async () => {
      prisma.service.findFirst.mockResolvedValue(serviceRow);
      prisma.service.update.mockResolvedValue({ ...serviceRow, active: false });

      const result = await service.update(tenantId, "svc-1", { active: false });

      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: "svc-1" },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });
  });
});
