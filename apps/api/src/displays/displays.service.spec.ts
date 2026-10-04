import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DisplaysService } from "./displays.service";
import { PrismaService } from "../prisma/prisma.service";

describe("DisplaysService", () => {
  let service: DisplaysService;
  let prisma: {
    code: Record<string, jest.Mock>;
    queue: Record<string, jest.Mock>;
    queueEntry: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    prisma = {
      code: { findUnique: jest.fn() },
      queue: { findUniqueOrThrow: jest.fn() },
      queueEntry: { findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [DisplaysService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DisplaysService);
  });

  describe("resolveQueueId", () => {
    it("404s for an unknown code", async () => {
      prisma.code.findUnique.mockResolvedValue(null);
      await expect(service.resolveQueueId("NOTREAL1")).rejects.toThrow(NotFoundException);
    });

    it("404s for a deactivated code", async () => {
      prisma.code.findUnique.mockResolvedValue({
        active: false,
        contextType: "DISPLAY",
        queueId: "queue-1",
      });
      await expect(service.resolveQueueId("CODE1234")).rejects.toThrow(NotFoundException);
    });

    it("404s for a QUEUE-context code — this endpoint only ever resolves DISPLAY codes", async () => {
      prisma.code.findUnique.mockResolvedValue({
        active: true,
        contextType: "QUEUE",
        queueId: "queue-1",
      });
      await expect(service.resolveQueueId("CODE1234")).rejects.toThrow(NotFoundException);
    });

    it("resolves an active DISPLAY code to its queueId", async () => {
      prisma.code.findUnique.mockResolvedValue({
        active: true,
        contextType: "DISPLAY",
        queueId: "queue-1",
      });
      await expect(service.resolveQueueId("CODE1234")).resolves.toBe("queue-1");
    });
  });

  describe("getSnapshot", () => {
    it("returns only ticket numbers and service names — never customer or staff identity", async () => {
      prisma.queue.findUniqueOrThrow.mockResolvedValue({
        name: "Main Queue",
        status: "ACTIVE",
        location: { name: "Christchurch" },
        tenant: { name: "Joe's Barbers" },
      });
      prisma.queueEntry.findMany
        .mockResolvedValueOnce([
          { ticketNumber: 12, service: { name: "Haircut" } },
          { ticketNumber: 13, service: { name: "Beard Trim" } },
        ])
        .mockResolvedValueOnce([
          // Returned out of order on purpose: the service sorts by queue order (G-25).
          {
            id: "e15",
            joinedAt: new Date("2026-01-01T00:05:00Z"),
            priorityFrom: null,
            ticketNumber: 15,
          },
          {
            id: "e14",
            joinedAt: new Date("2026-01-01T00:01:00Z"),
            priorityFrom: null,
            ticketNumber: 14,
          },
        ]);

      const result = await service.getSnapshot("queue-1");

      expect(result).toEqual({
        tenant: { name: "Joe's Barbers", logoPath: null },
        location: { name: "Christchurch" },
        queue: { name: "Main Queue", status: "ACTIVE" },
        nowServing: [
          { ticketNumber: 12, serviceName: "Haircut" },
          { ticketNumber: 13, serviceName: "Beard Trim" },
        ],
        next: [14, 15],
      });
      // Neither query ever asked for a customer or staff field in the first place.
      const [nowServingCall, nextCall] = prisma.queueEntry.findMany.mock.calls;
      expect(JSON.stringify(nowServingCall[0].select)).not.toMatch(/customer|assignedStaff/i);
      expect(JSON.stringify(nextCall[0].select)).not.toMatch(/customer|assignedStaff/i);
    });

    it("returns an empty board when no one is called or waiting", async () => {
      prisma.queue.findUniqueOrThrow.mockResolvedValue({
        name: "Main Queue",
        status: "ACTIVE",
        location: { name: "Christchurch" },
        tenant: { name: "Joe's Barbers" },
      });
      prisma.queueEntry.findMany.mockResolvedValue([]);

      const result = await service.getSnapshot("queue-1");

      expect(result.nowServing).toEqual([]);
      expect(result.next).toEqual([]);
    });
  });
});
