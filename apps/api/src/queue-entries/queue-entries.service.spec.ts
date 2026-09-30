import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { QueueEntriesService } from "./queue-entries.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { NotificationsService } from "../notifications/notifications.service";

describe("QueueEntriesService", () => {
  let service: QueueEntriesService;
  let prisma: {
    queue: Record<string, jest.Mock>;
    queueEntry: Record<string, jest.Mock>;
    queueService: Record<string, jest.Mock>;
    customer: Record<string, jest.Mock>;
    queueTicketCounter: Record<string, jest.Mock>;
    code: Record<string, jest.Mock>;
    location: Record<string, jest.Mock>;
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let queuesService: { findOwnedQueue: jest.Mock };
  let queueEvents: { emitQueueChanged: jest.Mock };
  let notifications: { enqueue: jest.Mock; processPending: jest.Mock };

  const tenantId = "tenant-1";
  const queueRow = {
    id: "queue-1",
    tenantId,
    locationId: "loc-1",
    name: "Main Queue",
    status: "ACTIVE",
    servingCapacity: 1,
    maxActiveTicketsPerCustomer: 1,
    maxRecallCount: 2,
    approachingThreshold: 5,
    nearlyNextThreshold: 2,
    location: { id: "loc-1", timezone: "Pacific/Auckland", maxActiveTicketsPerCustomer: 2 },
    tenant: { name: "Test Biz" },
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
    approachingNotifiedAt: null,
    nearlyNextNotifiedAt: null,
  };
  const customerContact = { phoneE164: "+64211234567", email: null };

  beforeEach(async () => {
    prisma = {
      queue: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(queueRow),
        findUniqueOrThrow: jest.fn().mockResolvedValue(queueRow),
      },
      queueEntry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue(entry),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...entry, customer: customerContact, queue: queueRow }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      queueService: { findUnique: jest.fn(), findMany: jest.fn() },
      customer: { upsert: jest.fn() },
      queueTicketCounter: { upsert: jest.fn() },
      code: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      location: { findUniqueOrThrow: jest.fn().mockResolvedValue(queueRow.location) },
      // Defaults to forwarding straight to `prisma` itself — every test
      // that doesn't care about transactional mechanics just sees its
      // usual mocked methods. callNext's own tests override this with a
      // dedicated tx object for the row-lock query (ADR-006).
      $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
      // evaluateWaitingThresholds' own FOR UPDATE SKIP LOCKED claim query
      // (see its own describe block below for what "lockable" needs to
      // resolve to per test — only reached when there's at least one
      // notification candidate).
      $queryRaw: jest.fn(),
    };
    queuesService = { findOwnedQueue: jest.fn() };
    queueEvents = { emitQueueChanged: jest.fn() };
    notifications = { enqueue: jest.fn(), processPending: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        QueueEntriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueuesService, useValue: queuesService },
        { provide: QueueEventsService, useValue: queueEvents },
        { provide: NotificationsService, useValue: notifications },
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
      expect(queueEvents.emitQueueChanged).toHaveBeenCalledWith("queue-1");
    });
  });

  describe("notification thresholds (G-31)", () => {
    function mockSuccessfulJoin(createdEntry: { id: string; ticketNumber: number }): void {
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue({
        service: { active: true, queueEnabled: true, durationMinutes: 20 },
      });
      prisma.customer.upsert.mockResolvedValue({ id: "cust-1" });
      prisma.queueEntry.count.mockResolvedValue(0);
      prisma.queueTicketCounter.upsert.mockResolvedValue({ lastNumber: createdEntry.ticketNumber });
      prisma.queueEntry.create.mockResolvedValue(createdEntry);
    }
    const joinInput = {
      serviceId: "svc-1",
      customerName: "Alice",
      customerPhone: "0211234567",
    };

    it("fires NEARLY_NEXT (not APPROACHING) when the new entrant lands within the nearly-next threshold", async () => {
      const created = { ...entry, id: "entry-2", ticketNumber: 2 };
      mockSuccessfulJoin(created);
      // nearlyNextThreshold is 2 — this entry is 2nd in line (index 1 = 1 person ahead).
      prisma.queueEntry.findMany.mockResolvedValue([
        { ...entry, id: "entry-1", customer: customerContact, service: { durationMinutes: 20 } },
        { ...created, customer: customerContact, service: { durationMinutes: 20 } },
      ]);
      // Nothing else concurrently holds either row locked (ADR-006's SKIP LOCKED claim).
      prisma.$queryRaw.mockResolvedValue([{ id: "entry-1" }, { id: "entry-2" }]);

      await service.join("queue-1", joinInput);

      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "NEARLY_NEXT", queueEntryId: "entry-2" }),
      );
      expect(notifications.enqueue).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "APPROACHING", queueEntryId: "entry-2" }),
      );
      // Suppression (G-31): jumping straight to nearly-next also stamps
      // approaching as sent, without a separate APPROACHING enqueue.
      expect(prisma.queueEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-2" },
        data: expect.objectContaining({
          nearlyNextNotifiedAt: expect.any(Date),
          approachingNotifiedAt: expect.any(Date),
        }),
      });
    });

    it("fires APPROACHING for an entry within that threshold but not the nearer nearly-next one", async () => {
      const created = { ...entry, id: "entry-2", ticketNumber: 2 };
      mockSuccessfulJoin(created);
      // approachingThreshold is 5, nearlyNextThreshold is 2 — 4 people ahead lands in the approaching band only.
      prisma.queueEntry.findMany.mockResolvedValue([
        { ...entry, id: "e1", customer: customerContact, service: { durationMinutes: 20 } },
        { ...entry, id: "e2", customer: customerContact, service: { durationMinutes: 20 } },
        { ...entry, id: "e3", customer: customerContact, service: { durationMinutes: 20 } },
        { ...entry, id: "e4", customer: customerContact, service: { durationMinutes: 20 } },
        { ...created, customer: customerContact, service: { durationMinutes: 20 } },
      ]);
      prisma.$queryRaw.mockResolvedValue(["e1", "e2", "e3", "e4", "entry-2"].map((id) => ({ id })));

      await service.join("queue-1", joinInput);

      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "APPROACHING", queueEntryId: "entry-2" }),
      );
    });

    it("does not notify an entry still beyond both thresholds", async () => {
      const created = { ...entry, id: "entry-2", ticketNumber: 2 };
      mockSuccessfulJoin(created);
      // The 6 entries ahead already had their own notifications fire earlier
      // (already-notified, so this pass doesn't re-fire for them either) —
      // isolates the assertion to entry-2, which sits at 6 people ahead,
      // beyond both approachingThreshold(5) and nearlyNextThreshold(2).
      const farEntries = Array.from({ length: 6 }, (_, i) => ({
        ...entry,
        id: `far-${i}`,
        customer: customerContact,
        service: { durationMinutes: 20 },
        approachingNotifiedAt: new Date(),
        nearlyNextNotifiedAt: new Date(),
      }));
      prisma.queueEntry.findMany.mockResolvedValue([
        ...farEntries,
        { ...created, customer: customerContact, service: { durationMinutes: 20 } },
      ]);

      await service.join("queue-1", joinInput);

      expect(notifications.enqueue).not.toHaveBeenCalled();
    });

    it("never re-fires a threshold that's already been notified", async () => {
      const created = {
        ...entry,
        id: "entry-2",
        ticketNumber: 2,
        approachingNotifiedAt: new Date(),
      };
      mockSuccessfulJoin(created);
      prisma.queueEntry.findMany.mockResolvedValue([
        { ...entry, id: "e1", customer: customerContact, service: { durationMinutes: 20 } },
        { ...entry, id: "e2", customer: customerContact, service: { durationMinutes: 20 } },
        { ...entry, id: "e3", customer: customerContact, service: { durationMinutes: 20 } },
        { ...created, customer: customerContact, service: { durationMinutes: 20 } },
      ]);
      prisma.$queryRaw.mockResolvedValue(["e1", "e2", "e3"].map((id) => ({ id })));

      await service.join("queue-1", joinInput);

      expect(notifications.enqueue).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ queueEntryId: "entry-2" }),
      );
    });
  });

  describe("addWalkIn — staff manually adding a customer (roadmap Phase 5)", () => {
    const joinInput = {
      serviceId: "svc-1",
      customerName: "Alice",
      customerPhone: "0211234567",
    };

    it("404s for a queue owned by another tenant, same as any other staff-authenticated action", async () => {
      queuesService.findOwnedQueue.mockRejectedValue(new NotFoundException());
      await expect(service.addWalkIn(tenantId, "queue-1", joinInput)).rejects.toThrow(
        NotFoundException,
      );
      // Never reaches the join logic (and therefore never touches the DB) once ownership fails.
      expect(prisma.queue.findUnique).not.toHaveBeenCalled();
    });

    it("delegates to the same join logic once ownership is confirmed", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      prisma.queue.findUnique.mockResolvedValue(queueRow);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queueService.findUnique.mockResolvedValue({
        service: { active: true, queueEnabled: true, durationMinutes: 20 },
      });
      prisma.customer.upsert.mockResolvedValue({ id: "cust-1" });
      prisma.queueEntry.count.mockResolvedValue(0);
      prisma.queueTicketCounter.upsert.mockResolvedValue({ lastNumber: 7 });
      prisma.queueEntry.create.mockResolvedValue({ ...entry, ticketNumber: 7 });

      const result = await service.addWalkIn(tenantId, "queue-1", joinInput);

      expect(result.ticketNumber).toBe(7);
      expect(result.publicToken).toBeDefined();
    });
  });

  describe("joinByScan — the physical counter scanner (Phase 10, D-10/D-11)", () => {
    const guestCardCode = {
      id: "code-1",
      tenantId,
      contextType: "GUEST_CARD",
      active: true,
      locationId: "loc-1",
      currentEntryId: null as string | null,
    };
    const identityCode = {
      id: "code-2",
      tenantId,
      contextType: "CUSTOMER_IDENTITY",
      active: true,
      customerId: "cust-1",
    };
    const richStaffEntry = {
      ...entry,
      id: "entry-9",
      customer: null,
      assignedStaff: null,
      guestCard: { guestNumber: 3 },
    };

    it("404s for a queue belonging to another tenant (or that doesn't exist)", async () => {
      prisma.queue.findFirst.mockResolvedValue(null);
      await expect(service.joinByScan(tenantId, "queue-1", "CODE1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects a non-ACTIVE queue", async () => {
      prisma.queue.findFirst.mockResolvedValue({ ...queueRow, status: "PAUSED" });
      await expect(service.joinByScan(tenantId, "queue-1", "CODE1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("404s for an unrecognized, deactivated, or another tenant's code", async () => {
      prisma.code.findUnique.mockResolvedValue(null);
      await expect(service.joinByScan(tenantId, "queue-1", "GARBAGE")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("404s for a QUEUE/DISPLAY/GENERAL code — this endpoint only understands GUEST_CARD/CUSTOMER_IDENTITY", async () => {
      prisma.code.findUnique.mockResolvedValue({ ...guestCardCode, contextType: "GENERAL" });
      await expect(service.joinByScan(tenantId, "queue-1", "CODE1")).rejects.toThrow(
        NotFoundException,
      );
    });

    describe("guest card", () => {
      it("404s for a card belonging to a different location's pool", async () => {
        prisma.code.findUnique.mockResolvedValue({ ...guestCardCode, locationId: "other-loc" });
        await expect(service.joinByScan(tenantId, "queue-1", "CODE1")).rejects.toThrow(
          NotFoundException,
        );
      });

      it("rejects when the queue doesn't have exactly one active service configured", async () => {
        prisma.code.findUnique.mockResolvedValue(guestCardCode);
        prisma.queueService.findMany.mockResolvedValue([]);
        await expect(service.joinByScan(tenantId, "queue-1", "CODE1")).rejects.toThrow(
          ConflictException,
        );
      });

      it("creates a new entry with no customer attached, and links the card to it", async () => {
        prisma.code.findUnique.mockResolvedValue(guestCardCode);
        prisma.queueService.findMany.mockResolvedValue([{ serviceId: "svc-1" }]);
        prisma.$queryRaw.mockResolvedValue([{ id: "code-1", currentEntryId: null }]);
        prisma.queueTicketCounter.upsert.mockResolvedValue({ lastNumber: 5 });
        prisma.queueEntry.create.mockResolvedValue({
          ...entry,
          id: "entry-9",
          customerId: null,
          ticketNumber: 5,
        });
        prisma.queueEntry.findFirst.mockResolvedValue(richStaffEntry);

        const result = await service.joinByScan(tenantId, "queue-1", "CODE1");

        expect(prisma.queueEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ customerId: null, serviceId: "svc-1", ticketNumber: 5 }),
        });
        expect(prisma.code.update).toHaveBeenCalledWith({
          where: { id: "code-1" },
          data: { currentEntryId: "entry-9" },
        });
        expect(result.customerName).toBe("Guest 3");
        expect(result.guestCardNumber).toBe(3);
      });

      it("is idempotent: re-scanning an already-linked card returns the existing entry instead of creating a duplicate (G-54)", async () => {
        prisma.code.findUnique.mockResolvedValue({ ...guestCardCode, currentEntryId: "entry-9" });
        prisma.queueService.findMany.mockResolvedValue([{ serviceId: "svc-1" }]);
        prisma.$queryRaw.mockResolvedValue([{ id: "code-1", currentEntryId: "entry-9" }]);
        prisma.queueEntry.findUnique.mockResolvedValue({ id: "entry-9", status: "WAITING" });
        prisma.queueEntry.findFirst.mockResolvedValue(richStaffEntry);

        const result = await service.joinByScan(tenantId, "queue-1", "CODE1");

        expect(prisma.queueEntry.create).not.toHaveBeenCalled();
        expect(prisma.code.update).not.toHaveBeenCalled();
        expect(result.id).toBe("entry-9");
      });
    });

    describe("customer identity", () => {
      it("creates a new entry attached to the customer", async () => {
        prisma.code.findUnique.mockResolvedValue(identityCode);
        prisma.queueEntry.findFirst
          .mockResolvedValueOnce(null) // no existing active entry in this queue
          .mockResolvedValueOnce({
            ...richStaffEntry,
            id: "entry-10",
            customerId: "cust-1",
            customer: { firstName: "Dana", phoneE164: "+64211234567" },
            guestCard: null,
          });
        prisma.queueEntry.count.mockResolvedValue(0);
        prisma.queueService.findMany.mockResolvedValue([{ serviceId: "svc-1" }]);
        prisma.queueTicketCounter.upsert.mockResolvedValue({ lastNumber: 8 });
        prisma.queueEntry.create.mockResolvedValue({
          ...entry,
          id: "entry-10",
          customerId: "cust-1",
          ticketNumber: 8,
        });

        const result = await service.joinByScan(tenantId, "queue-1", "IDCODE1");

        expect(prisma.queueEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            customerId: "cust-1",
            serviceId: "svc-1",
            ticketNumber: 8,
          }),
        });
        expect(result.customerName).toBe("Dana");
      });

      it("is idempotent: re-scanning while already active in this queue returns the existing entry (G-54)", async () => {
        prisma.code.findUnique.mockResolvedValue(identityCode);
        prisma.queueEntry.findFirst
          .mockResolvedValueOnce({ id: "entry-11", status: "WAITING" }) // already active
          .mockResolvedValueOnce({ ...richStaffEntry, id: "entry-11", guestCard: null });

        const result = await service.joinByScan(tenantId, "queue-1", "IDCODE1");

        expect(prisma.queueEntry.create).not.toHaveBeenCalled();
        expect(result.id).toBe("entry-11");
      });

      it("enforces the per-location active-ticket cap (G-34) — a scan doesn't bypass it", async () => {
        prisma.code.findUnique.mockResolvedValue(identityCode);
        prisma.queueEntry.findFirst.mockResolvedValueOnce(null);
        prisma.queueEntry.count.mockResolvedValue(2); // == location's maxActiveTicketsPerCustomer

        await expect(service.joinByScan(tenantId, "queue-1", "IDCODE1")).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.queueEntry.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("staff-facing summaries include customer and assigned-staff identity (G-18)", () => {
    it("list() enriches every entry with the customer's name and the assigned staff member's name", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      const richEntry = {
        ...entry,
        status: "CALLED",
        service: { durationMinutes: 20 },
        customer: { firstName: "Alice", phoneE164: "+64211234567" },
        assignedStaff: { id: "tu-1", user: { displayName: "Bob the Barber" } },
      };
      prisma.queueEntry.findMany.mockResolvedValue([richEntry]);

      const [result] = await service.list(tenantId, "queue-1");

      expect(result.customerName).toBe("Alice");
      expect(result.customerPhone).toBe("+64211234567");
      expect(result.assignedStaffId).toBe("tu-1");
      expect(result.assignedStaffName).toBe("Bob the Barber");
    });

    it("falls back gracefully when there's no customer or assigned-staff relation yet", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      prisma.queueEntry.findMany.mockResolvedValue([
        { ...entry, service: { durationMinutes: 20 }, customer: null, assignedStaff: null },
      ]);

      const [result] = await service.list(tenantId, "queue-1");

      expect(result.customerName).toBe("Walk-in");
      expect(result.assignedStaffId).toBeNull();
      expect(result.assignedStaffName).toBeNull();
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
        // Spreads prisma's own mocks (so enqueueCalledNotification's and
        // evaluateWaitingThresholds' lookups still resolve) but overrides
        // $queryRaw (the row-lock select) and queueEntry.update (the
        // status transition itself) for this specific scenario.
        const tx = {
          ...prisma,
          $queryRaw: jest.fn().mockResolvedValue([{ id: "entry-1" }]),
          queueEntry: { ...prisma.queueEntry, update: updateMock },
        };
        return cb(tx);
      });
      // callNext re-fetches the staff-rich summary for its response.
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "CALLED" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);

      const result = await service.callNext(tenantId, "queue-1", "staff-1");

      expect(result.status).toBe("CALLED");
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: expect.objectContaining({ status: "CALLED", assignedStaffId: "staff-1" }),
      });
      expect(queueEvents.emitQueueChanged).toHaveBeenCalledWith("queue-1");
      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "CALLED", queueEntryId: "entry-1" }),
      );
    });

    it("does NOT emit a queue-changed event when there was nothing to call (no spurious SSE pushes)", async () => {
      queuesService.findOwnedQueue.mockResolvedValue(queueRow);
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
        return cb(tx);
      });

      await expect(service.callNext(tenantId, "queue-1", "staff-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(queueEvents.emitQueueChanged).not.toHaveBeenCalled();
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
      expect(queueEvents.emitQueueChanged).toHaveBeenCalledWith("queue-1");
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

    it("releases a linked guest card once a transition reaches a terminal state (Phase 10, D-14)", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.findFirstOrThrow.mockResolvedValue({ ...entry, status: "COMPLETED" });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "COMPLETED" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);
      prisma.code.updateMany.mockResolvedValue({ count: 1 });

      await service.complete(tenantId, "entry-1");

      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { currentEntryId: "entry-1" },
        data: { currentEntryId: null },
      });
    });

    it("does not touch guest cards for a non-terminal transition (start: CALLED -> SERVING)", async () => {
      prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
      prisma.queueEntry.findFirstOrThrow.mockResolvedValue({ ...entry, status: "SERVING" });
      prisma.queueEntry.findFirst.mockResolvedValue({ ...entry, status: "SERVING" });
      prisma.queue.findUniqueOrThrow.mockResolvedValue(queueRow);

      await service.start(tenantId, "entry-1");

      expect(prisma.code.updateMany).not.toHaveBeenCalled();
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

    it("always enqueues a RECALLED notification — an explicit resend, never gated by calledNotifiedAt", async () => {
      prisma.queueEntry.findFirst.mockResolvedValue({
        ...entry,
        status: "CALLED",
        recallCount: 0,
        calledNotifiedAt: new Date(), // CALLED was already sent — recall must still fire
      });
      prisma.queue.findUniqueOrThrow.mockResolvedValue({ ...queueRow, maxRecallCount: 2 });
      prisma.queueEntry.update.mockResolvedValue({ ...entry, status: "CALLED", recallCount: 1 });

      await service.recall(tenantId, "entry-1");

      expect(notifications.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "RECALLED", queueEntryId: "entry-1" }),
      );
    });
  });
});
