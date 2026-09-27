import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { QueueEntriesService } from "./queue-entries.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";

describe("QueueEntriesService", () => {
  let service: QueueEntriesService;
  let prisma: {
    queue: Record<string, jest.Mock>;
    queueEntry: Record<string, jest.Mock>;
    queueService: Record<string, jest.Mock>;
    customer: Record<string, jest.Mock>;
    queueTicketCounter: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let queuesService: { findOwnedQueue: jest.Mock };

  const tenantId = "tenant-1";
  const queueRow = {
    id: "queue-1",
    tenantId,
    locationId: "loc-1",
    status: "ACTIVE",
    servingCapacity: 1,
    maxActiveTicketsPerCustomer: 1,
    maxRecallCount: 2,
    location: { id: "loc-1", timezone: "Pacific/Auckland", maxActiveTicketsPerCustomer: 2 },
  };
  const entry = {
    id: "entry-1",
    tenantId,
    queueId: "queue-1",
    serviceId: "svc-1",
    customerId: "cust-1",
    ticketNumber: 1,
    status: "WAITING",
    recallCount: 0,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    calledAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    publicToken: "tok_abc123",
  };

  beforeEach(async () => {
    prisma = {
      queue: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      queueEntry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      queueService: { findUnique: jest.fn() },
      customer: { upsert: jest.fn() },
      queueTicketCounter: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    queuesService = { findOwnedQueue: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        QueueEntriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueuesService, useValue: queuesService },
      ],
    }).compile();

    service = module.get(QueueEntriesService);
  });

  describe("join", () => {
    const joinInput = {
      serviceId: "svc-1",
      customerName: "Alice",
      customerPhone: "0211234567",
    };

    it("404s when the queue doesn't exist", async () => {
      prisma.queue.findUnique.mockResolvedValue(null);
      await expect(service.join("queue-1", joinInput)).rejects.toThrow(NotFoundException);
    });

    it("rejects joining a non-ACTIVE queue", async () => {
      prisma.queue.findUnique.mockResolvedValue({ ...queueRow, status: "PAUSED" });
      await expect(service.join("queue-1", joinInput)).rejects.toThrow(ConflictException);
    });

    it("idempotency: a retried request with the same key returns the original entry, doesn't create a new one", async () => {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(entry);

      const result = await service.join("queue-1", { ...joinInput, idempotencyKey: "retry-key-1" });

      expect(result.id).toBe(entry.id);
      expect(prisma.queueEntry.create).not.toHaveBeenCalled();
    });

    it("rejects a service not attached to (or inactive/disabled on) this queue", async () => {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue(null);

      await expect(service.join("queue-1", joinInput)).rejects.toThrow(NotFoundException);
    });

    it("enforces the per-queue max-active-tickets cap (G-34)", async () => {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue({
        service: { active: true, queueEnabled: true, durationMinutes: 20 },
      });
      prisma.customer.upsert.mockResolvedValue({ id: "cust-1" });
      prisma.queueEntry.count.mockResolvedValueOnce(1); // already at the per-queue cap of 1

      await expect(service.join("queue-1", joinInput)).rejects.toThrow(ConflictException);
      expect(prisma.queueTicketCounter.upsert).not.toHaveBeenCalled();
    });

    it("enforces the per-location max-active-tickets cap once the per-queue cap passes", async () => {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue({
        service: { active: true, queueEnabled: true, durationMinutes: 20 },
      });
      prisma.customer.upsert.mockResolvedValue({ id: "cust-1" });
      prisma.queueEntry.count
        .mockResolvedValueOnce(0) // per-queue: fine
        .mockResolvedValueOnce(2); // per-location: already at the cap of 2

      await expect(service.join("queue-1", joinInput)).rejects.toThrow(ConflictException);
    });

    it("creates the entry with an atomically allocated ticket number on success", async () => {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue({
        service: { active: true, queueEnabled: true, durationMinutes: 20 },
      });
      prisma.customer.upsert.mockResolvedValue({ id: "cust-1" });
      prisma.queueEntry.count.mockResolvedValue(0);
      prisma.queueTicketCounter.upsert.mockResolvedValue({ lastNumber: 5 });
      prisma.queueEntry.create.mockResolvedValue({ ...entry, ticketNumber: 5 });

      const result = await service.join("queue-1", joinInput);

      expect(result.ticketNumber).toBe(5);
      expect(result.publicToken).toBeDefined();
      expect(prisma.queueEntry.create.mock.calls[0][0].data.customerId).toBe("cust-1");
    });
  });

  describe("callNext — the concurrency-critical operation (ADR-006)", () => {
    it("rejects calling next on a non-ACTIVE queue", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ ...queueRow, status: "CLOSED" });
      await expect(service.callNext(tenantId, "queue-1", "staff-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws QUEUE_EMPTY when the row-locked select finds nothing (all rows locked or none waiting)", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
        return cb(tx);
      });

      await expect(service.callNext(tenantId, "queue-1", "staff-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("transitions the row-locked entry to CALLED and assigns the acting staff member", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      const updateMock = jest.fn().mockResolvedValue({ ...entry, status: "CALLED" });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: "entry-1" }]),
          queueEntry: { update: updateMock },
        };
        return cb(tx);
      });

      const result = await service.callNext(tenantId, "queue-1", "staff-1");

      expect(result.status).toBe("CALLED");
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: expect.objectContaining({ status: "CALLED", assignedStaffId: "staff-1" }),
      });
    });
  });

  describe("state transitions", () => {
    it("start: CALLED -> SERVING succeeds", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "SERVING" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);

      const result = await service.start(tenantId, "entry-1");
      expect(result.status).toBe("SERVING");
      expect(prisma.queueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: "entry-1", tenantId, status: { in: ["CALLED"] } },
        data: expect.objectContaining({ status: "SERVING" }),
      });
    });

    it("start: rejects when the entry isn't actually CALLED (already-transitioned race)", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "WAITING" });

      await expect(service.start(tenantId, "entry-1")).rejects.toThrow(ConflictException);
    });

    it("any transition 404s for an entry that doesn't exist (or belongs to another tenant)", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
      prisma.queueEntry.findFirst.mockResolvedValue(null);

      await expect(service.complete(tenantId, "entry-1")).rejects.toThrow(NotFoundException);
    });

    it("requeue (SKIPPED -> WAITING) gives a fresh joinedAt, same ticket number", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "WAITING" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);

      await service.requeue(tenantId, "entry-1");

      const updateCall = prisma.queueEntry.updateMany.mock.calls[0][0];
      expect(updateCall.where.status).toEqual({ in: ["SKIPPED"] });
      expect(updateCall.data.joinedAt).toBeInstanceOf(Date);
      // Ticket number is never part of the transition's data — it's immutable once allocated.
      expect(updateCall.data.ticketNumber).toBeUndefined();
    });

    it("cancelByStaff persists the given reason", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "CANCELLED" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);

      await service.cancelByStaff(tenantId, "entry-1", "customer requested");

      const updateCall = prisma.queueEntry.updateMany.mock.calls[0][0];
      expect(updateCall.data.cancellationReason).toBe("customer requested");
    });
  });

  describe("recall — a notification resend, not a state change (G-15)", () => {
    it("rejects recalling an entry that isn't CALLED", async () => {
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "WAITING" });
      await expect(service.recall(tenantId, "entry-1")).rejects.toThrow(ConflictException);
    });

    it("rejects once the queue's configured max recall count is reached", async () => {
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "CALLED", recallCount: 2 });
      prisma.queue.findUniqueOrThrow.mockResolvedValue({ ...queueRow, maxRecallCount: 2 });

      await expect(service.recall(tenantId, "entry-1")).rejects.toThrow(ConflictException);
    });

    it("increments recallCount without changing status", async () => {
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "CALLED", recallCount: 0 });
      prisma.queue.findUniqueOrThrow.mockResolvedValue({ ...queueRow, maxRecallCount: 2 });
      prisma.queueEntry.update.mockResolvedValue({ ...entry, status: "CALLED", recallCount: 1 });

      const result = await service.recall(tenantId, "entry-1");

      expect(result.status).toBe("CALLED");
      expect(prisma.queueEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: { recallCount: { increment: 1 } },
      });
    });
  });
});
