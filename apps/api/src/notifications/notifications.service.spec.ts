import { Test } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service";
import { NotificationProvider } from "./notification-provider";
import { PrismaService } from "../prisma/prisma.service";

describe("NotificationsService", () => {
  let service: NotificationsService;
  let prisma: { notificationOutbox: Record<string, jest.Mock> };
  let provider: { send: jest.Mock };

  const pendingRow = {
    id: "outbox-1",
    channel: "SMS" as const,
    recipient: "+64211234567",
    body: "You're up next!",
    status: "PENDING" as const,
  };

  beforeEach(async () => {
    prisma = {
      notificationOutbox: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    provider = { send: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationProvider, useValue: provider },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe("enqueue", () => {
    it("writes a PENDING row via the given transaction client", async () => {
      const tx = { notificationOutbox: { create: jest.fn() } };
      await service.enqueue(tx as never, {
        tenantId: "tenant-1",
        queueEntryId: "entry-1",
        type: "CALLED",
        channel: "SMS",
        recipient: "+64211234567",
        body: "It's your turn!",
      });

      expect(tx.notificationOutbox.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-1",
          queueEntryId: "entry-1",
          type: "CALLED",
          channel: "SMS",
          recipient: "+64211234567",
          body: "It's your turn!",
        },
      });
    });
  });

  describe("processPending", () => {
    it("claims a pending row, sends it, and marks it SENT", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([pendingRow]);
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

      await service.processPending();

      expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
        where: { id: "outbox-1", status: "PENDING" },
        data: { status: "SENT", sentAt: expect.any(Date) },
      });
      expect(provider.send).toHaveBeenCalledWith({
        channel: "SMS",
        recipient: "+64211234567",
        body: "You're up next!",
      });
    });

    it("never sends a row it couldn't claim — the acceptance criterion: duplicate processing doesn't duplicate delivery", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([pendingRow]);
      // Simulates another concurrent processPending() call having already claimed it.
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });

      await service.processPending();

      expect(provider.send).not.toHaveBeenCalled();
    });

    it("reverts to PENDING if the provider throws, so a later pass can retry", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([pendingRow]);
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });
      provider.send.mockRejectedValue(new Error("provider down"));

      await expect(service.processPending()).rejects.toThrow("provider down");

      expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: "outbox-1" },
        data: { status: "PENDING", sentAt: null },
      });
    });

    it("does nothing when there's nothing pending", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([]);
      await service.processPending();
      expect(provider.send).not.toHaveBeenCalled();
    });
  });
});
