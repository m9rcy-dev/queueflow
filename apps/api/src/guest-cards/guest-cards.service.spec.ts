import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GuestCardsService } from "./guest-cards.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { CodesService } from "../codes/codes.service";

describe("GuestCardsService", () => {
  let service: GuestCardsService;
  let prisma: { code: Record<string, jest.Mock> };
  let locationsService: { findOwnedLocation: jest.Mock };
  let codesService: { createGuestCard: jest.Mock };

  const tenantId = "tenant-1";
  const locationId = "loc-1";

  function card(guestNumber: number, currentEntryId: string | null = null) {
    return {
      id: `code-${guestNumber}`,
      publicCode: `CODE${guestNumber}`,
      guestNumber,
      currentEntryId,
    };
  }

  beforeEach(async () => {
    prisma = {
      code: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { guestNumber: null } }),
      },
    };
    locationsService = { findOwnedLocation: jest.fn() };
    codesService = { createGuestCard: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        GuestCardsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocationsService, useValue: locationsService },
        { provide: CodesService, useValue: codesService },
      ],
    }).compile();

    service = module.get(GuestCardsService);
  });

  describe("list", () => {
    it("404s (via LocationsService) for another tenant's location", async () => {
      locationsService.findOwnedLocation.mockRejectedValue(new Error("not found"));
      await expect(service.list(tenantId, locationId)).rejects.toThrow();
    });

    it("maps active GUEST_CARD codes to the summary shape, inUse reflecting currentEntryId", async () => {
      prisma.code.findMany.mockResolvedValue([card(1), card(2, "entry-1")]);
      const result = await service.list(tenantId, locationId);
      expect(result).toEqual([
        { id: "code-1", publicCode: "CODE1", guestNumber: 1, inUse: false },
        { id: "code-2", publicCode: "CODE2", guestNumber: 2, inUse: true },
      ]);
    });
  });

  describe("resize", () => {
    it("mints cards to grow an empty pool to the requested size", async () => {
      prisma.code.findMany
        .mockResolvedValueOnce([]) // initial state
        .mockResolvedValueOnce([card(1), card(2), card(3)]); // final list() call
      codesService.createGuestCard.mockResolvedValue({});

      const result = await service.resize(tenantId, locationId, 3);

      expect(codesService.createGuestCard).toHaveBeenCalledTimes(3);
      expect(codesService.createGuestCard).toHaveBeenNthCalledWith(1, tenantId, locationId, 1);
      expect(codesService.createGuestCard).toHaveBeenNthCalledWith(2, tenantId, locationId, 2);
      expect(codesService.createGuestCard).toHaveBeenNthCalledWith(3, tenantId, locationId, 3);
      expect(result).toHaveLength(3);
    });

    it("grows an existing pool starting from the next guestNumber", async () => {
      prisma.code.findMany
        .mockResolvedValueOnce([card(1), card(2)])
        .mockResolvedValueOnce([card(1), card(2), card(3), card(4)]);
      prisma.code.aggregate.mockResolvedValue({ _max: { guestNumber: 2 } });
      codesService.createGuestCard.mockResolvedValue({});

      await service.resize(tenantId, locationId, 4);

      expect(codesService.createGuestCard).toHaveBeenCalledTimes(2);
      expect(codesService.createGuestCard).toHaveBeenNthCalledWith(1, tenantId, locationId, 3);
      expect(codesService.createGuestCard).toHaveBeenNthCalledWith(2, tenantId, locationId, 4);
    });

    it("re-growing after a full shrink continues from the highest guestNumber ever used, not from the (now zero) active count — avoids colliding with the deactivated row's unique (locationId, guestNumber)", async () => {
      prisma.code.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([card(4)]);
      // Cards 1-3 were minted and later deactivated (a shrink-to-0 cycle) —
      // aggregate still sees them since it isn't filtered by `active`.
      prisma.code.aggregate.mockResolvedValue({ _max: { guestNumber: 3 } });
      codesService.createGuestCard.mockResolvedValue({});

      await service.resize(tenantId, locationId, 1);

      expect(codesService.createGuestCard).toHaveBeenCalledTimes(1);
      expect(codesService.createGuestCard).toHaveBeenCalledWith(tenantId, locationId, 4);
    });

    it("deactivates the highest-numbered free cards to shrink the pool", async () => {
      prisma.code.findMany
        .mockResolvedValueOnce([card(1), card(2), card(3)])
        .mockResolvedValueOnce([card(1)]);
      prisma.code.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.resize(tenantId, locationId, 1);

      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["code-2", "code-3"] } },
        data: { active: false },
      });
      expect(result).toHaveLength(1);
    });

    it("refuses to shrink past a currently-in-use card (D-14/G-54)", async () => {
      prisma.code.findMany.mockResolvedValueOnce([card(1), card(2, "entry-1"), card(3)]);

      await expect(service.resize(tenantId, locationId, 1)).rejects.toThrow(ConflictException);
      expect(prisma.code.updateMany).not.toHaveBeenCalled();
    });

    it("no-ops when the pool is already the requested size", async () => {
      prisma.code.findMany
        .mockResolvedValueOnce([card(1), card(2)])
        .mockResolvedValueOnce([card(1), card(2)]);

      await service.resize(tenantId, locationId, 2);

      expect(codesService.createGuestCard).not.toHaveBeenCalled();
      expect(prisma.code.updateMany).not.toHaveBeenCalled();
    });
  });
});
