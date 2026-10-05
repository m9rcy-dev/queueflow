import { Test } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service";
import { EmailProvider } from "./email-provider";
import { SmsProvider } from "./sms-provider";
import { PrismaService } from "../prisma/prisma.service";

describe("NotificationsService", () => {
  let service: NotificationsService;
  let prisma: { notificationOutbox: Record<string, jest.Mock> };
  let emailProvider: { send: jest.Mock };
  let smsProvider: { send: jest.Mock };

  const smsPendingRow = {
    id: "outbox-1",
    type: "CALLED" as const,
    channel: "SMS" as const,
    recipient: "+64211234567",
    body: "You're up next!",
    status: "PENDING" as const,
  };
  const emailPendingRow = {
    id: "outbox-2",
    type: "CALLED" as const,
    channel: "EMAIL" as const,
    recipient: "alice@example.com",
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
    emailProvider = { send: jest.fn().mockResolvedValue(undefined) };
    smsProvider = { send: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailProvider, useValue: emailProvider },
        { provide: SmsProvider, useValue: smsProvider },
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
          appointmentId: null,
          type: "CALLED",
          channel: "SMS",
          recipient: "+64211234567",
          body: "It's your turn!",
          htmlBody: null, // SMS — never HTML (Phase 19)
        },
      });
    });
  });

  describe("processPending", () => {
    it("routes an SMS row to SmsProvider", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([smsPendingRow]);
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

      await service.processPending();

      expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
        where: { id: "outbox-1", status: "PENDING" },
        data: { status: "SENT", sentAt: expect.any(Date) },
      });
      expect(smsProvider.send).toHaveBeenCalledWith({
        to: "+64211234567",
        body: "You're up next!",
      });
      expect(emailProvider.send).not.toHaveBeenCalled();
    });

    it("routes an EMAIL row to EmailProvider, with a subject derived from the notification type", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([emailPendingRow]);
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

      await service.processPending();

      expect(emailProvider.send).toHaveBeenCalledWith({
        to: "alice@example.com",
        subject: "It's your turn!",
        body: "You're up next!",
      });
      expect(smsProvider.send).not.toHaveBeenCalled();
    });

    it("never sends a row it couldn't claim — the acceptance criterion: duplicate processing doesn't duplicate delivery", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([smsPendingRow]);
      // Simulates another concurrent processPending() call having already claimed it.
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });

      await service.processPending();

      expect(smsProvider.send).not.toHaveBeenCalled();
    });

    it("reverts to PENDING if the provider throws, so a later pass can retry", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([smsPendingRow]);
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });
      smsProvider.send.mockRejectedValue(new Error("provider down"));

      await expect(service.processPending()).rejects.toThrow("provider down");

      expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: "outbox-1" },
        data: { status: "PENDING", sentAt: null },
      });
    });

    it("does nothing when there's nothing pending", async () => {
      prisma.notificationOutbox.findMany.mockResolvedValue([]);
      await service.processPending();
      expect(smsProvider.send).not.toHaveBeenCalled();
      expect(emailProvider.send).not.toHaveBeenCalled();
    });
  });
});
