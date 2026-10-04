import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { HoursReport, OnShiftStaff, ShiftRecord, ShiftSummary } from "@queueflow/types";
import type { HoursReportQuery, UpdateShiftInput } from "@queueflow/validation";
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
    await this.prisma.staffShift.updateMany({
      where: { tenantUserId, endedAt: null },
      data: { endedAt: new Date() },
    });
    await this.releaseCustomersOf(tenantId, tenantUserId);
  }

  /** Waiting customers who asked for this person go back to "anyone", in place, and are told (ADR-017). */
  private async releaseCustomersOf(tenantId: string, tenantUserId: string): Promise<void> {
    const member = await this.prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId },
      include: { user: { select: { displayName: true } }, tenant: { select: { name: true } } },
    });
    if (!member) return;

    const releasedQueueIds = await this.prisma.$transaction(async (tx) => {
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

  /**
   * The hours report (Phase 19): shifts that started in [from, to), with each
   * person's total. Owner/admin see everyone (optionally one location);
   * a Manager their location; Staff only their own hours. Open shifts count
   * up to now. Pay itself is left to the business's point-of-sale/payroll —
   * this is the time record to feed it (CSV export in the web app).
   */
  async report(actor: ShiftActor, query: HoursReportQuery): Promise<HoursReport> {
    const where: Prisma.StaffShiftWhereInput = {
      tenantId: actor.tenantId,
      startedAt: { gte: new Date(query.from), lt: new Date(query.to) },
    };
    if (actor.role === "STAFF") {
      where.tenantUserId = actor.tenantUserId;
    } else {
      if (query.tenantUserId) where.tenantUserId = query.tenantUserId;
      if (actor.role === "MANAGER") {
        // Their location only; asking about another shows nothing, not an error (ADR-015).
        if (!actor.locationId || (query.locationId && query.locationId !== actor.locationId)) {
          return { from: query.from, to: query.to, shifts: [], totals: [] };
        }
        where.locationId = actor.locationId;
      } else if (query.locationId) {
        where.locationId = query.locationId;
      }
    }

    const rows = await this.prisma.staffShift.findMany({
      where,
      include: {
        tenantUser: MEMBER_INCLUDE,
        editedBy: MEMBER_INCLUDE,
        location: { select: { name: true } },
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
    const now = Date.now();
    const shifts: ShiftRecord[] = rows.map((row) => ({
      id: row.id,
      tenantUserId: row.tenantUserId,
      staffName: row.tenantUser.user.displayName,
      locationId: row.locationId,
      locationName: row.location.name,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      minutes: Math.max(
        0,
        Math.round(((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 60_000),
      ),
      editedByName: row.editedBy?.user.displayName ?? null,
      editedAt: row.editedAt?.toISOString() ?? null,
    }));

    const totals = new Map<string, HoursReport["totals"][number]>();
    for (const shift of shifts) {
      const total = totals.get(shift.tenantUserId) ?? {
        tenantUserId: shift.tenantUserId,
        staffName: shift.staffName,
        minutes: 0,
        shiftCount: 0,
      };
      total.minutes += shift.minutes;
      total.shiftCount += 1;
      totals.set(shift.tenantUserId, total);
    }
    return {
      from: query.from,
      to: query.to,
      shifts,
      totals: [...totals.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)),
    };
  }

  /**
   * Correct a shift's times by hand (Phase 19) — typically a forgotten
   * clock-out. Owner/admin anywhere; a Manager at their location; never
   * your own (hours are pay: someone else signs them off). Records who
   * edited it and when.
   */
  async update(actor: ShiftActor, shiftId: string, input: UpdateShiftInput): Promise<void> {
    const shift = await this.prisma.staffShift.findFirst({
      where: { id: shiftId, tenantId: actor.tenantId },
    });
    if (
      !shift ||
      actor.role === "STAFF" ||
      (actor.role === "MANAGER" && shift.locationId !== actor.locationId)
    ) {
      throw new NotFoundException(SHIFT_NOT_FOUND);
    }
    if (shift.tenantUserId === actor.tenantUserId) {
      throw new ConflictException({
        code: "OWN_SHIFT",
        message: "Someone else needs to correct your own hours.",
      });
    }
    const startedAt = new Date(input.startedAt);
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;
    const now = new Date();
    if (startedAt > now || (endedAt && endedAt > now)) {
      throw new BadRequestException({
        code: "SHIFT_IN_FUTURE",
        message: "Shift times can't be in the future.",
      });
    }
    // Only the shift that's still open may stay open (one open shift per person).
    if (endedAt === null && shift.endedAt !== null) {
      throw new BadRequestException({
        code: "SHIFT_END_REQUIRED",
        message: "A finished shift needs an end time.",
      });
    }
    const overlapping = await this.prisma.staffShift.findFirst({
      where: {
        tenantUserId: shift.tenantUserId,
        id: { not: shift.id },
        startedAt: { lt: endedAt ?? now },
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new ConflictException({
        code: "SHIFT_OVERLAP",
        message: "That overlaps another shift for the same person.",
      });
    }

    const closing = shift.endedAt === null && endedAt !== null;
    await this.prisma.staffShift.update({
      where: { id: shift.id },
      data: { startedAt, endedAt, editedById: actor.tenantUserId, editedAt: now },
    });
    // Closing someone's forgotten shift takes them off the floor, like clocking out.
    if (closing) await this.releaseCustomersOf(shift.tenantId, shift.tenantUserId);
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

const SHIFT_NOT_FOUND = { code: "SHIFT_NOT_FOUND", message: "Shift not found." };
const MEMBER_INCLUDE = { include: { user: { select: { displayName: true } } } } as const;

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
