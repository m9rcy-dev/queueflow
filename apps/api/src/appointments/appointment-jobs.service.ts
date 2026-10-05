import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveChannel } from "../notifications/resolve-channel";
import {
  buildAppointmentReminderMessage,
  formatAppointmentTime,
} from "../notifications/notification-copy";
import { appointmentManageUrl } from "./appointment-links";

const MINUTE_MS = 60_000;
/** Matches the validation cap on a reminder offset — nothing further ahead can be due. */
const MAX_REMINDER_OFFSET_MINUTES = 14 * 24 * 60;

/**
 * The appointment engine's time-driven half (Phase 14, ADR-013): no-shows
 * (§77) and reminders (§75), once a minute on the same `@nestjs/schedule`
 * infrastructure as the retention purge. Both are safe to run twice or on
 * overlapping ticks — each change is a guarded update or an insert that a
 * unique index turns into a no-op — so a slow tick or a second instance
 * can't double-mark or double-send.
 *
 * `DISABLE_SCHEDULED_JOBS=true` skips the cron (integration tests call the
 * methods directly with a chosen `now`, and mustn't race a background tick).
 */
@Injectable()
export class AppointmentJobsService {
  private readonly logger = new Logger(AppointmentJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (process.env.DISABLE_SCHEDULED_JOBS === "true") return;
    try {
      await this.markNoShows();
      await this.sendDueReminders();
    } catch (err) {
      this.logger.error("Appointment jobs tick failed", err);
    }
  }

  /**
   * BOOKED -> NO_SHOW once startsAt + the tenant's grace period has passed
   * without a check-in. `noShowAt IS NULL` excludes appointments staff have
   * already restored (ADR-013), so a restore sticks. Raw SQL because the
   * grace period is per tenant — a join Prisma's updateMany can't express.
   */
  async markNoShows(now: Date = new Date()): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE appointments a
      SET status = 'NO_SHOW', "noShowAt" = ${now}, "updatedAt" = ${now}
      FROM tenants t
      WHERE a."tenantId" = t.id
        AND a.status = 'BOOKED'
        AND a."noShowAt" IS NULL
        AND a."startsAt" + make_interval(mins => t."appointmentNoShowGraceMinutes") < ${now}
      RETURNING a.id
    `;
    if (rows.length > 0) {
      this.logger.log(`Marked ${rows.length} appointment(s) as no-show (§77).`);
    }
    return rows.map((row) => row.id);
  }

  /**
   * Enqueues each BOOKED appointment's reminder (§75). Per appointment, at
   * most one row per configured offset ever exists — the outbox's unique
   * (appointmentId, type, reminderOffsetMinutes) index makes a repeat
   * insert a no-op. Rules:
   * - an offset is due once now >= startsAt - offset;
   * - an offset whose moment had already passed when the booking was made
   *   is skipped (no "24 hours to go" for a booking made 3 hours ahead);
   * - only the nearest due offset is sent, so a job that was down for a
   *   while sends one reminder, not a burst of stale ones.
   */
  async sendDueReminders(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.appointment.findMany({
      where: {
        status: "BOOKED",
        startsAt: {
          gt: now,
          lte: new Date(now.getTime() + MAX_REMINDER_OFFSET_MINUTES * MINUTE_MS),
        },
      },
      include: { tenant: true, customer: true, service: true, location: true },
    });

    const rows: Prisma.NotificationOutboxCreateManyInput[] = [];
    for (const appointment of candidates) {
      const offset = nearestDueOffset(
        appointment.tenant.appointmentReminderOffsetsMinutes,
        appointment.startsAt,
        appointment.createdAt,
        now,
      );
      if (offset === null) continue;
      const { channel, recipient } = resolveChannel(appointment.customer, appointment.contactEmail);
      rows.push({
        tenantId: appointment.tenantId,
        appointmentId: appointment.id,
        type: "APPOINTMENT_REMINDER",
        reminderOffsetMinutes: offset,
        channel,
        recipient,
        body: buildAppointmentReminderMessage({
          businessName: appointment.tenant.name,
          serviceName: appointment.service.name,
          when: formatAppointmentTime(appointment.startsAt, appointment.location.timezone),
          manageUrl: appointmentManageUrl(this.config, appointment.publicToken),
        }),
      });
    }
    if (rows.length === 0) return 0;

    const { count } = await this.prisma.notificationOutbox.createMany({
      data: rows,
      skipDuplicates: true,
    });
    if (count > 0) {
      void this.notifications
        .processPending()
        .catch((err) => this.logger.error("Failed to process notification outbox", err));
    }
    return count;
  }
}

/** The smallest configured offset that is due now and was still ahead when the booking was made; null if none. */
export function nearestDueOffset(
  offsetsMinutes: number[],
  startsAt: Date,
  bookedAt: Date,
  now: Date,
): number | null {
  const due = offsetsMinutes.filter((offset) => {
    const reminderAt = startsAt.getTime() - offset * MINUTE_MS;
    return reminderAt <= now.getTime() && reminderAt >= bookedAt.getTime();
  });
  return due.length === 0 ? null : Math.min(...due);
}
