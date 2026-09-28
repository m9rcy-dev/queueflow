import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";

describe("CodesService", () => {
  let service: CodesService;
  let prisma: { code: Record<string, jest.Mock> };
  let queuesService: { findOwnedQueue: jest.Mock };

  const tenantId = "tenant-1";
  const codeRow = {
    publicCode: "ABCD2345",
    contextType: "QUEUE" as const,
    queueId: "queue-1",
    active: true,
  };

  beforeEach(async () => {
    prisma = { code: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } };
    queuesService = { findOwnedQueue: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueuesService, useValue: queuesService },
      ],
    }).compile();

    service = module.get(CodesService);
  });

  describe("createForQueue", () => {
    it("404s for a queue belonging to another tenant", async () => {
      queuesService.findOwnedQueue.mockRejectedValue(new NotFoundException());
      await expect(service.createForQueue(tenantId, "queue-1")).rejects.toThrow(NotFoundException);
      expect(prisma.code.create).not.toHaveBeenCalled();
    });

    it("creates a QUEUE-context code scoped to the given queue", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.create.mockResolvedValue(codeRow);

      const result = await service.createForQueue(tenantId, "queue-1");

      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId, queueId: "queue-1", contextType: "QUEUE" }),
      });
      expect(result.publicCode).toBe("ABCD2345");
    });
  });

  describe("resolve", () => {
    it("404s for an unknown code", async () => {
      prisma.code.findUnique.mockResolvedValue(null);
      await expect(service.resolve("NOTREAL1")).rejects.toThrow(NotFoundException);
    });

    it("404s for a deactivated code (never distinguishes this from 'unknown')", async () => {
      prisma.code.findUnique.mockResolvedValue({ ...codeRow, active: false });
      await expect(service.resolve("ABCD2345")).rejects.toThrow(NotFoundException);
    });

    it("returns only the minimal customer-facing landing info — never admin data", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        queue: {
          id: "queue-1",
          name: "Main Queue",
          status: "ACTIVE",
          location: { name: "Christchurch" },
          tenant: { name: "Joe's Barbers" },
          queueServices: [
            {
              service: {
                id: "svc-1",
                name: "Haircut",
                durationMinutes: 20,
                active: true,
                queueEnabled: true,
              },
            },
            {
              service: {
                id: "svc-2",
                name: "Retired Service",
                durationMinutes: 10,
                active: false,
                queueEnabled: true,
              },
            },
          ],
        },
      });

      const result = await service.resolve("ABCD2345");

      expect(result).toEqual({
        contextType: "QUEUE",
        tenant: { name: "Joe's Barbers" },
        location: { name: "Christchurch" },
        queue: { id: "queue-1", name: "Main Queue", status: "ACTIVE" },
        capabilities: ["JOIN_QUEUE"],
        // The inactive service is filtered out — never offered to a customer.
        services: [{ id: "svc-1", name: "Haircut", durationMinutes: 20 }],
      });
    });
  });
});
