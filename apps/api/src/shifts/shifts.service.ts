import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { OnShiftStaff, ShiftSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveChannel } from "../notifications/resolve-channel";
import { buildPreferredStaffUnavailableMessage } from "../notifications/notification-copy";
import { staffPublicName } from "./staff-name";

export interface ShiftActor {
  tenantId: string;
  tenantUserId: string;
  role: string;
  locationId: string | null;
}

/**
 * Clocking in and out (Phase 18, ADR-017). An open shift is what makes a
 * staff member choosable as "preferred" on the join page; the shift rows
 * are also the time record for hourly pay later (Phase 19).
 *
 * Clocking out (or being removed) automatically hands that person's
 * waiting customers back to "anyone" — they keep their place, and are told.
 */
@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueEvents: QueueEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  async current(actor: ShiftActor): Promise<ShiftSummary | null> {
    const shift = await this.prisma.staffShift.findFirst({
      where: { tenantUserId: actor.tenantUserId, endedAt: null },
      include: { location: { select: { name: true } } },
    });
    return shift ? toShiftSummary(shift) : null;
  }

  /**
   * Clock in at a location — a location-bound member's own (ADR-015);
   * owner/admin say which. Clocking in again where they already are is a
   * no-op; while on shift somewhere else it's refused (clock out first).
   * The "one open shift per member" rule is also a partial unique index,
   * so a double-tap race can't create two.
   */
  async clockIn(actor: ShiftActor, requestedLocationId?: string): Promise<ShiftSummary> {
    const locationId = actor.locationId ?? requestedLocationId;
    if (!locationId) {
      throw new ConflictException({
        code: "LOCATION_REQUIRED",
        message: "Choose which location you're working at.",
      });
    }
    if (actor.locationId && requestedLocationId && requestedLocationId !== actor.locationId) {
      throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
    }
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId: actor.tenantId },
    });
    if (!location) {
      throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
    }

    const open = await this.current(actor);
    if (open) {
      if (open.locationId === locationId) return open;
      throw new ConflictException({
        code: "ALREADY_ON_SHIFT",
        message: `You're clocked in at ${open.locationName}. Clock out there first.`,
      });
    }
    try {
      const shift = await this.prisma.staffShift.create({
        data: { tenantId: actor.tenantId, locationId, tenantUserId: actor.tenantUserId },
        include: { location: { select: { name: true } } },
      });
      return toShiftSummary(shift);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const twin = await this.current(actor);
        if (twin) return twin;
      }
      throw err;
    }
  }

  async clockOut(actor: ShiftActor): Promise<void> {
    await this.endShiftFor(actor.tenantId, actor.tenantUserId);
  }

  /**
   * Ends any open shift and releases the person's waiting customers to
   * "anyone" (ADR-017) — each keeps their place and gets a message. Also
   * used when a member is removed. Safe to call when not on shift.
   */
  async endShiftFor(tenantId: string, tenantUserId: string): Promise<void> {
    const member = await this.prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { user: { select: { displayName: true } }, tenant: { select: { name: true } } },
    });
    if (!member) return;

    const releasedQueueIds = await this.prisma.$transaction(async (tx) => {
      await tx.staffShift.updateMany({
        where: { tenantUserId, endedAt: null },
        data: { endedAt: new Date() },
      });
      const waiting = await tx.queueEntry.findMany({
        where: { tenantId, preferredStaffId: tenantUserId, status: { in: ["WAITING", "SKIPPED"] } },
        include: { customer: { select: { phoneE164: true, email: true } } },
      });
      if (waiting.length === 0) return [];
      await tx.queueEntry.updateMany({
        where: { id: { in: waiting.map((e) => e.id) } },
        data: { preferredStaffId: null },
      });
      for (const entry of waiting) {
        if (!entry.customer) continue;
        const { channel, recipient } = resolveChannel(entry.customer);
        await this.notifications.enqueue(tx, {
          tenantId,
          queueEntryId: entry.id,
          type: "PREFERRED_STAFF_UNAVAILABLE",
          channel,
          recipient,
          body: buildPreferredStaffUnavailableMessage({
            businessName: member.tenant.name,
            staffName: staffPublicName(member),
            ticketNumber: entry.ticketNumber,
          }),
        });
      }
      return [...new Set(waiting.map((e) => e.queueId))];
    });

    for (const queueId of releasedQueueIds) this.queueEvents.emitQueueChanged(queueId);
    if (releasedQueueIds.length > 0) {
      void this.notifications
        .processPending()
        .catch((err) => this.logger.error("Failed to process notification outbox", err));
    }
  }

  /** Who's on shift at a location — the people customers can choose (public names only). */
  async onShift(locationId: string): Promise<OnShiftStaff[]> {
    const shifts = await this.prisma.staffShift.findMany({
      where: { locationId, endedAt: null, tenantUser: { removedAt: null } },
      include: { tenantUser: { include: { user: { select: { displayName: true } } } } },
      orderBy: { startedAt: "asc" },
    });
    return shifts.map((shift) => ({
      tenantUserId: shift.tenantUserId,
      name: staffPublicName(shift.tenantUser),
    }));
  }
}

function toShiftSummary(shift: {
  id: string;
  locationId: string;
  startedAt: Date;
  location: { name: string };
}): ShiftSummary {
  return {
    id: shift.id,
    locationId: shift.locationId,
    locationName: shift.location.name,
    startedAt: shift.startedAt.toISOString(),
  };
}
