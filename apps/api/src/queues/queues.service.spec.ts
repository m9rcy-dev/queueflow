import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { QueuesService } from "./queues.service";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { QueueEventsService } from "../queue-events/queue-events.service";

describe("QueuesService", () => {
  let service: QueuesService;
  let prisma: {
    queue: Record<string, jest.Mock>;
    queueEntry: Record<string, jest.Mock>;
    queueService: Record<string, jest.Mock>;
    service: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let locationsService: { get: jest.Mock };
  let queueEvents: { emitQueueChanged: jest.Mock };

  const tenantId = "tenant-1";
  const queue = {
    id: "queue-1",
    tenantId,
    locationId: "loc-1",
    name: "Main Queue",
    status: "ACTIVE",
    servingCapacity: 1,
    maxActiveTicketsPerCustomer: 1,
    maxRecallCount: 2,
    recallGracePeriodMinutes: 5,
  };

  beforeEach(async () => {
    prisma = {
      queue: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      queueEntry: { updateMany: jest.fn() },
      queueService: { upsert: jest.fn(), findMany: jest.fn() },
      service: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    locationsService = { get: jest.fn() };
    queueEvents = { emitQueueChanged: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        QueuesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocationsService, useValue: locationsService },
        { provide: QueueEventsService, useValue: queueEvents },
      ],
    }).compile();

    service = module.get(QueuesService);
  });

  describe("create", () => {
    it("404s for a location belonging to another tenant", async () => {
      locationsService.get.mockRejectedValue(new NotFoundException());
      await expect(service.create(tenantId, { locationId: "not-mine", name: "X" })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.queue.create).not.toHaveBeenCalled();
    });

    it("applies documented defaults when config isn't provided", async () => {
      locationsService.get.mockResolvedValue({ id: "loc-1" });
      prisma.queue.create.mockResolvedValue(queue);

      await service.create(tenantId, { locationId: "loc-1", name: "Main Queue" });

      expect(prisma.queue.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          locationId: "loc-1",
          name: "Main Queue",
          servingCapacity: 1,
          maxActiveTicketsPerCustomer: 1,
          maxRecallCount: 2,
          recallGracePeriodMinutes: 5,
          approachingThreshold: 5,
          nearlyNextThreshold: 2,
        },
      });
    });
  });

  describe("updateStatus", () => {
    it("closing cascades to cancel every still-WAITING entry, in the same transaction", async () => {
      prisma.queue.findFirst.mockResolvedValue(queue);
      prisma.$transaction.mockResolvedValue([{ ...queue, status: "CLOSED" }]);

      await service.updateStatus(tenantId, "queue-1", { status: "CLOSED" });

      const transactionArg = prisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(2); // queue.update + queueEntry.updateMany
    });

    it("pausing does NOT cascade-cancel — only closing does (plan §72)", async () => {
      prisma.queue.findFirst.mockResolvedValue(queue);
      prisma.$transaction.mockResolvedValue([{ ...queue, status: "PAUSED" }]);

      await service.updateStatus(tenantId, "queue-1", { status: "PAUSED" });

      const transactionArg = prisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(1); // queue.update only
    });

    it("emits a queue-changed event so live SSE watchers (ticket page, display) see the status change without a refresh", async () => {
      prisma.queue.findFirst.mockResolvedValue(queue);
      prisma.$transaction.mockResolvedValue([{ ...queue, status: "PAUSED" }]);

      await service.updateStatus(tenantId, "queue-1", { status: "PAUSED" });

      expect(queueEvents.emitQueueChanged).toHaveBeenCalledWith("queue-1");
    });
  });

  describe("attachService", () => {
    it("rejects a service that belongs to a different location than the queue", async () => {
      prisma.queue.findFirst.mockResolvedValue(queue);
      prisma.service.findFirst.mockResolvedValue({
        id: "svc-1",
        locationId: "some-other-location",
      });

      await expect(
        service.attachService(tenantId, "queue-1", { serviceId: "svc-1" }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.queueService.upsert).not.toHaveBeenCalled();
    });

    it("attaches when the service belongs to the same location as the queue", async () => {
      prisma.queue.findFirst.mockResolvedValue(queue);
      prisma.service.findFirst.mockResolvedValue({ id: "svc-1", locationId: "loc-1" });
      prisma.queueService.upsert.mockResolvedValue({});

      await service.attachService(tenantId, "queue-1", { serviceId: "svc-1" });

      expect(prisma.queueService.upsert).toHaveBeenCalledWith({
        where: { queueId_serviceId: { queueId: "queue-1", serviceId: "svc-1" } },
        create: { queueId: "queue-1", serviceId: "svc-1" },
        update: {},
      });
    });
  });
});
