import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NotificationChannel, NotificationType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailProvider } from "./email-provider";
import { SmsProvider } from "./sms-provider";
import { buildEmailSubject } from "./notification-copy";

/** Exactly one subject — a queue entry, or (Phase 13) an appointment. */
export type NotificationSubject = { queueEntryId: string } | { appointmentId: string };

export type EnqueueNotificationParams = NotificationSubject & {
  tenantId: string;
  type: NotificationType;
  channel: NotificationChannel;
  recipient: string;
  body: string;
  /** Phase 19: the email's HTML version (a QR code image); ignored for SMS. */
  htmlBody?: string | null;
};

const PROCESS_BATCH_LIMIT = 50;

/**
 * The outbox pattern itself (ADR-008/G-31). `enqueue` runs inside the
 * caller's own transaction — writing the outbox row is part of the same
 * atomic mutation as the queue change that triggered it, per G-31 —
 * `processPending` runs afterward, standalone, and is never awaited by the
 * request that triggered it (a queue operation must not depend on the
 * notification provider being up).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProvider: EmailProvider,
    private readonly smsProvider: SmsProvider,
    private readonly config: ConfigService,
  ) {}

  /** Must be called with the same `tx` the triggering mutation is using (G-31). */
  async enqueue(tx: Prisma.TransactionClient, params: EnqueueNotificationParams): Promise<void> {
    await tx.notificationOutbox.create({
      data: {
        tenantId: params.tenantId,
        queueEntryId: "queueEntryId" in params ? params.queueEntryId : null,
        appointmentId: "appointmentId" in params ? params.appointmentId : null,
        type: params.type,
        channel: params.channel,
        recipient: params.recipient,
        body: params.body,
        htmlBody: params.channel === "EMAIL" ? (params.htmlBody ?? null) : null,
      },
    });
  }

  /**
   * Claims and sends pending rows, oldest first. Each row is claimed with
   * a guarded `PENDING -> SENT` update *before* the provider is called —
   * only the caller whose update actually matched the row (`count === 1`)
   * proceeds to send it, so two concurrent/duplicate calls to this method
   * can never send the same row twice (the acceptance criterion). On a
   * send failure, the row reverts to PENDING so a later pass retries —
   * there's no backoff/retry-count yet (no background scheduler exists,
   * a documented known limitation), but a transient provider outage still
   * doesn't lose the notification outright.
   */
  async processPending(limit: number = PROCESS_BATCH_LIMIT): Promise<void> {
    const pending = await this.prisma.notificationOutbox.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    for (const row of pending) {
      const claimed = await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "SENT", sentAt: new Date() },
      });
      if (claimed.count === 0) {
        continue; // another concurrent pass already claimed it
      }

      // Phase 20 (G-29): each business sends at most SMS_DAILY_LIMIT_PER_BUSINESS
      // SMS a day (UTC), so a busy day or abuse can't run up the bill. Over the
      // limit the message is skipped for good, not retried later.
      if (row.channel === "SMS" && (await this.overDailySmsLimit(row.tenantId))) {
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: "SKIPPED", sentAt: null },
        });
        this.logger.warn(
          `Daily SMS limit reached for business ${row.tenantId}; skipped a ${row.type} SMS.`,
        );
        continue;
      }

      try {
        if (row.channel === "EMAIL") {
          await this.emailProvider.send({
            to: row.recipient,
            subject: buildEmailSubject(row.type),
            body: row.body,
            html: row.htmlBody ?? undefined,
          });
        } else {
          await this.smsProvider.send({ to: row.recipient, body: row.body });
        }
      } catch (err) {
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: "PENDING", sentAt: null },
        });
        throw err;
      }
    }
  }

  /** True once this business has sent more SMS today (UTC) than allowed — the row being sent is already counted. */
  private async overDailySmsLimit(tenantId: string): Promise<boolean> {
    const limit = Number(this.config.get<string>("SMS_DAILY_LIMIT_PER_BUSINESS") ?? 100);
    if (!Number.isFinite(limit)) return false;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await this.prisma.notificationOutbox.count({
      where: { tenantId, channel: "SMS", status: "SENT", sentAt: { gte: startOfDay } },
    });
    return sentToday > limit;
  }
}
