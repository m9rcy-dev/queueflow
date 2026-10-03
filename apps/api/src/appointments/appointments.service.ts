import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type AppointmentCancellationReason } from "@prisma/client";
import type {
  AppointmentAvailability,
  AppointmentCalendarDay,
  AppointmentSettings,
  BookAppointmentResponse,
  CreateClosureResponse,
  CustomerUpcomingAppointment,
  LocationClosureSummary,
  PublicAppointmentSummary,
  StaffAppointmentSummary,
} from "@queueflow/types";
import type {
  BookAppointmentInput,
  CreateClosureInput,
  StaffCancelAppointmentInput,
  UpdateAppointmentSettingsInput,
} from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveChannel } from "../notifications/resolve-channel";
import {
  buildAppointmentBookedMessage,
  buildAppointmentCancelledMessage,
  formatAppointmentTime,
} from "../notifications/notification-copy";
import { normalizePhoneToE164 } from "../common/phone.util";
import { generateSecurePublicToken } from "../common/secure-token.util";
import { addDays, dayOfWeekOf, formatLocalDate, localTimeToUtc } from "../common/timezone.util";
import { formatLocalMinutes, generateSlots, type GeneratedSlot } from "./slot-engine";

const MINUTE_MS = 60_000;

type DbClient = PrismaService | Prisma.TransactionClient;

type TenantSettingsRow = {
  name: string;
  appointmentSlotIntervalMinutes: number;
  appointmentBufferMinutes: number;
  appointmentMinLeadMinutes: number;
  appointmentAdvanceDays: number;
  appointmentCancelNoticeMinutes: number;
};

/** Everything slot generation needs that doesn't change per date — loaded once per request. */
type BookingContext = {
  location: {
    id: string;
    tenantId: string;
    name: string;
    address: string | null;
    timezone: string;
    appointmentCapacity: number;
    maxAppointmentsPerDay: number | null;
  };
  tenant: TenantSettingsRow;
  service: { id: string; name: string; durationMinutes: number };
};

const PUBLIC_INCLUDE = {
  service: true,
  location: true,
  tenant: true,
} satisfies Prisma.AppointmentInclude;

const STAFF_INCLUDE = {
  service: true,
  customer: true,
} satisfies Prisma.AppointmentInclude;

type PublicAppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof PUBLIC_INCLUDE }>;
type StaffAppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof STAFF_INCLUDE }>;

function slotUnavailable(): ConflictException {
  return new ConflictException({
    code: "SLOT_UNAVAILABLE",
    message: "That time is no longer available. Please pick another.",
  });
}

function appointmentNotFound(): NotFoundException {
  return new NotFoundException({
    code: "APPOINTMENT_NOT_FOUND",
    message: "Appointment not found.",
  });
}

function serviceNotBookable(): NotFoundException {
  return new NotFoundException({
    code: "SERVICE_NOT_AVAILABLE",
    message: "This service can't be booked here.",
  });
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * The appointment engine (Phase 13, ADR-012): tenant slot settings,
 * location closures, backend-authoritative availability (plan §34), booking
 * with double-booking prevention (§35), cancellation, and the staff
 * calendar. Public methods (availability, book, token lookups) derive the
 * tenant from the location itself, the same as the anonymous queue join;
 * staff methods take tenantId from the token and scope every query by it.
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async getSettings(tenantId: string): Promise<AppointmentSettings> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return toSettings(tenant);
  }

  async updateSettings(
    tenantId: string,
    input: UpdateAppointmentSettingsInput,
  ): Promise<AppointmentSettings> {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.slotIntervalMinutes !== undefined && {
          appointmentSlotIntervalMinutes: input.slotIntervalMinutes,
        }),
        ...(input.bufferMinutes !== undefined && {
          appointmentBufferMinutes: input.bufferMinutes,
        }),
        ...(input.minLeadMinutes !== undefined && {
          appointmentMinLeadMinutes: input.minLeadMinutes,
        }),
        ...(input.advanceDays !== undefined && { appointmentAdvanceDays: input.advanceDays }),
        ...(input.cancelNoticeMinutes !== undefined && {
          appointmentCancelNoticeMinutes: input.cancelNoticeMinutes,
        }),
      },
    });
    return toSettings(tenant);
  }

  /** Closures on or after `from` (default: the location's today), soonest first. */
  async listClosures(
    tenantId: string,
    locationId: string,
    from?: string,
  ): Promise<LocationClosureSummary[]> {
    const location = await this.locationsService.findOwnedLocation(tenantId, locationId);
    const fromDate = from ?? formatLocalDate(location.timezone, new Date());
    const closures = await this.prisma.locationClosure.findMany({
      where: { locationId, date: { gte: dateOnly(fromDate) } },
      orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
    });
    return closures.map(toClosureSummary);
  }

  /**
   * Allowed even over existing bookings (G-26) — the response lists the
   * BOOKED appointments the closure overlaps, so staff can cancel each one
   * with a reason (which notifies the customer). Nothing is auto-cancelled.
   */
  async createClosure(
    tenantId: string,
    locationId: string,
    input: CreateClosureInput,
  ): Promise<CreateClosureResponse> {
    const location = await this.locationsService.findOwnedLocation(tenantId, locationId);
    const closure = await this.prisma.locationClosure.create({
      data: {
        locationId,
        date: dateOnly(input.date),
        startMinutes: input.startMinutes ?? null,
        endMinutes: input.endMinutes ?? null,
        reason: input.reason ?? null,
      },
    });

    const overlapFilter: Prisma.AppointmentWhereInput =
      input.startMinutes === undefined || input.endMinutes === undefined
        ? { localDate: dateOnly(input.date) }
        : {
            startsAt: { lt: localTimeToUtc(input.date, input.endMinutes, location.timezone) },
            endsAt: { gt: localTimeToUtc(input.date, input.startMinutes, location.timezone) },
          };
    const affected = await this.prisma.appointment.findMany({
      where: { tenantId, locationId, status: "BOOKED", ...overlapFilter },
      include: STAFF_INCLUDE,
      orderBy: { startsAt: "asc" },
    });

    return {
      closure: toClosureSummary(closure),
      affectedAppointments: affected.map(toStaffSummary),
    };
  }

  async deleteClosure(tenantId: string, locationId: string, closureId: string): Promise<void> {
    await this.locationsService.findOwnedLocation(tenantId, locationId);
    const deleted = await this.prisma.locationClosure.deleteMany({
      where: { id: closureId, locationId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({ code: "CLOSURE_NOT_FOUND", message: "Closure not found." });
    }
  }

  /** Public — the bookable starts for one service on one location-local date. */
  async getAvailability(
    locationId: string,
    serviceId: string,
    date: string,
  ): Promise<AppointmentAvailability> {
    const context = await this.loadBookingContext(locationId, serviceId);
    const slots = await this.computeSlots(this.prisma, context, date, new Date());
    return {
      date,
      timezone: context.location.timezone,
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        localTime: formatLocalMinutes(slot.localMinutes),
      })),
    };
  }

  /**
   * Books one slot (plan §35). Double-booking prevention (ADR-012): the
   * transaction locks the location row, then recomputes that date's
   * availability *inside* the lock and requires the requested start to
   * still be offered — so concurrent bookings at one location serialize,
   * and the second of two racing requests for the last unit of capacity
   * sees the first's booking and gets SLOT_UNAVAILABLE.
   *
   * `bookedByStaffId` is set when staff book on a customer's behalf (the
   * caller must already have ownership-checked the location).
   */
  async book(
    locationId: string,
    input: BookAppointmentInput,
    bookedByStaffId: string | null = null,
  ): Promise<BookAppointmentResponse> {
    const context = await this.loadBookingContext(locationId, input.serviceId);
    const tenantId = context.location.tenantId;

    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) return this.toBookResponse(existing);
    }

    const startsAt = new Date(input.startsAt);
    const date = formatLocalDate(context.location.timezone, startsAt);
    const phoneE164 = normalizePhoneToE164(input.customerPhone);
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_phoneE164: { tenantId, phoneE164 } },
      create: { tenantId, phoneE164, firstName: input.customerName },
      update: { firstName: input.customerName },
    });

    let appointment: PublicAppointmentRow;
    let replayed = false;
    try {
      appointment = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR UPDATE`;

        // A same-key twin that held the lock first has committed by now —
        // its booking took the slot, so this must replay it rather than
        // see the slot gone and answer SLOT_UNAVAILABLE (G-21).
        if (input.idempotencyKey) {
          const twin = await tx.appointment.findUnique({
            where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
            include: PUBLIC_INCLUDE,
          });
          if (twin) {
            replayed = true;
            return twin;
          }
        }

        const slots = await this.computeSlots(tx, context, date, new Date());
        const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
        if (!slot) throw slotUnavailable();

        const created = await tx.appointment.create({
          data: {
            tenantId,
            locationId,
            serviceId: context.service.id,
            customerId: customer.id,
            publicToken: generateSecurePublicToken(),
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            occupiedUntil: new Date(
              slot.endsAt.getTime() + context.tenant.appointmentBufferMinutes * MINUTE_MS,
            ),
            localDate: dateOnly(date),
            idempotencyKey: input.idempotencyKey ?? null,
            bookedByStaffId,
          },
          include: PUBLIC_INCLUDE,
        });

        const { channel, recipient } = resolveChannel(customer);
        await this.notifications.enqueue(tx, {
          tenantId,
          appointmentId: created.id,
          type: "APPOINTMENT_BOOKED",
          channel,
          recipient,
          body: buildAppointmentBookedMessage({
            businessName: context.tenant.name,
            serviceName: context.service.name,
            when: formatAppointmentTime(created.startsAt, context.location.timezone),
            manageUrl: this.manageUrl(created.publicToken),
          }),
        });
        return created;
      });
    } catch (err) {
      // Belt and braces for the twin check above: if the unique index still
      // catches a same-key race, return the twin's booking, not an error.
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await this.findByIdempotencyKey(tenantId, input.idempotencyKey);
        if (existing) return this.toBookResponse(existing);
      }
      throw err;
    }

    if (!replayed) this.triggerNotificationProcessing();
    return this.toBookResponse(appointment);
  }

  async getByPublicToken(publicToken: string): Promise<PublicAppointmentSummary> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { publicToken },
      include: PUBLIC_INCLUDE,
    });
    if (!appointment) throw appointmentNotFound();
    return toPublicSummary(appointment, new Date());
  }

  /** Customer self-cancel — only while BOOKED and before the tenant's notice cut-off (§76, enforced server-side). */
  async cancelByPublicToken(publicToken: string): Promise<PublicAppointmentSummary> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { publicToken },
      include: PUBLIC_INCLUDE,
    });
    if (!appointment) throw appointmentNotFound();
    const now = new Date();
    if (appointment.status === "BOOKED" && now > cancelDeadline(appointment)) {
      throw new ConflictException({
        code: "CANCELLATION_WINDOW_PASSED",
        message:
          "It's too close to your appointment to cancel online. Please contact the business.",
      });
    }

    await this.cancel(appointment.id, {
      reason: "CUSTOMER_REQUESTED",
      note: null,
      cancelledByStaffId: null,
    });
    return this.getByPublicToken(publicToken);
  }

  /** Staff cancel — any time, with a required reason; notifies the customer. */
  async cancelByStaff(
    tenantId: string,
    staffId: string,
    appointmentId: string,
    input: StaffCancelAppointmentInput,
  ): Promise<StaffAppointmentSummary> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!appointment) throw appointmentNotFound();

    await this.cancel(appointment.id, {
      reason: input.reason,
      note: input.note ?? null,
      cancelledByStaffId: staffId,
    });
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: STAFF_INCLUDE,
    });
    return toStaffSummary(updated);
  }

  /** Per-day BOOKED counts for one month (plan-review §5.5's calendar) — only days with at least one booking. */
  async getCalendar(
    tenantId: string,
    locationId: string,
    month: string,
  ): Promise<AppointmentCalendarDay[]> {
    await this.locationsService.findOwnedLocation(tenantId, locationId);
    const firstDay = `${month}-01`;
    const groups = await this.prisma.appointment.groupBy({
      by: ["localDate"],
      where: {
        tenantId,
        locationId,
        status: "BOOKED",
        localDate: { gte: dateOnly(firstDay), lt: dateOnly(addMonth(firstDay)) },
      },
      _count: { _all: true },
      orderBy: { localDate: "asc" },
    });
    return groups.map((group) => ({
      date: group.localDate.toISOString().slice(0, 10),
      count: group._count._all,
    }));
  }

  /** One day's list, cancelled included (staff need to see what was cancelled and why). */
  async listDay(
    tenantId: string,
    locationId: string,
    date: string,
  ): Promise<StaffAppointmentSummary[]> {
    await this.locationsService.findOwnedLocation(tenantId, locationId);
    const appointments = await this.prisma.appointment.findMany({
      where: { tenantId, locationId, localDate: dateOnly(date) },
      include: STAFF_INCLUDE,
      orderBy: { startsAt: "asc" },
    });
    return appointments.map(toStaffSummary);
  }

  /** A signed-up customer's future BOOKED appointments in this tenant (portal). */
  async listUpcomingForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerUpcomingAppointment[]> {
    const now = new Date();
    const appointments = await this.prisma.appointment.findMany({
      where: { tenantId, customerId, status: "BOOKED", startsAt: { gte: now } },
      include: PUBLIC_INCLUDE,
      orderBy: { startsAt: "asc" },
    });
    return appointments.map((a) => ({ ...toPublicSummary(a, now), publicToken: a.publicToken }));
  }

  /**
   * BOOKED -> CANCELLED as a guarded conditional update (a concurrent
   * second cancel matches zero rows and gets a conflict, never a second
   * notification), with the customer's cancellation notice enqueued in
   * the same transaction (G-31).
   */
  private async cancel(
    appointmentId: string,
    params: {
      reason: AppointmentCancellationReason;
      note: string | null;
      cancelledByStaffId: string | null;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: { id: appointmentId, status: "BOOKED" },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: params.reason,
          cancellationNote: params.note,
          cancelledByStaffId: params.cancelledByStaffId,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          code: "APPOINTMENT_NOT_BOOKED",
          message: "This appointment has already been cancelled.",
        });
      }

      const appointment = await tx.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        include: { customer: true, service: true, location: true, tenant: true },
      });
      const { channel, recipient } = resolveChannel(appointment.customer);
      await this.notifications.enqueue(tx, {
        tenantId: appointment.tenantId,
        appointmentId,
        type: "APPOINTMENT_CANCELLED",
        channel,
        recipient,
        body: buildAppointmentCancelledMessage({
          businessName: appointment.tenant.name,
          serviceName: appointment.service.name,
          when: formatAppointmentTime(appointment.startsAt, appointment.location.timezone),
          cancelledByBusiness: params.cancelledByStaffId !== null,
        }),
      });
    });
    this.triggerNotificationProcessing();
  }

  /**
   * Public entry point's gate: the location exists, its tenant has the
   * Appointment capability on, and the service is active, appointment-
   * enabled, and belongs to this location. Every failure is the same 404
   * — a public caller learns nothing about why.
   */
  private async loadBookingContext(locationId: string, serviceId: string): Promise<BookingContext> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { tenant: true },
    });
    if (!location || !location.tenant.appointmentEnabled) {
      throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
    }
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, locationId, active: true, appointmentEnabled: true },
    });
    if (!service) throw serviceNotBookable();
    return { location, tenant: location.tenant, service };
  }

  /** Gathers one date's inputs and runs the pure slot engine. Takes a client so the booking path can run it inside its locked transaction. */
  private async computeSlots(
    db: DbClient,
    context: BookingContext,
    date: string,
    now: Date,
  ): Promise<GeneratedSlot[]> {
    const { location, tenant, service } = context;
    const dayStart = localTimeToUtc(date, 0, location.timezone);
    const dayEnd = localTimeToUtc(addDays(date, 1), 0, location.timezone);

    const [openPeriods, closures, existing, bookedCountForDay] = await Promise.all([
      db.businessHours.findMany({
        where: { locationId: location.id, dayOfWeek: dayOfWeekOf(date) },
      }),
      db.locationClosure.findMany({ where: { locationId: location.id, date: dateOnly(date) } }),
      db.appointment.findMany({
        where: {
          locationId: location.id,
          status: "BOOKED",
          startsAt: { lt: dayEnd },
          occupiedUntil: { gt: dayStart },
        },
        select: { startsAt: true, occupiedUntil: true },
      }),
      db.appointment.count({
        where: { locationId: location.id, status: "BOOKED", localDate: dateOnly(date) },
      }),
    ]);

    return generateSlots({
      date,
      timezone: location.timezone,
      openPeriods,
      closures,
      serviceDurationMinutes: service.durationMinutes,
      slotIntervalMinutes: tenant.appointmentSlotIntervalMinutes,
      bufferMinutes: tenant.appointmentBufferMinutes,
      capacity: location.appointmentCapacity,
      existing,
      maxPerDay: location.maxAppointmentsPerDay,
      bookedCountForDay,
      earliestStart: new Date(now.getTime() + tenant.appointmentMinLeadMinutes * MINUTE_MS),
      latestDate: addDays(formatLocalDate(location.timezone, now), tenant.appointmentAdvanceDays),
    });
  }

  private findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PublicAppointmentRow | null> {
    return this.prisma.appointment.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      include: PUBLIC_INCLUDE,
    });
  }

  private toBookResponse(appointment: PublicAppointmentRow): BookAppointmentResponse {
    return {
      ...toPublicSummary(appointment, new Date()),
      publicToken: appointment.publicToken,
    };
  }

  private manageUrl(publicToken: string): string {
    const base = this.config.get<string>("WEB_APP_URL") ?? "http://localhost:3000";
    return `${base.replace(/\/$/, "")}/appointment/${publicToken}`;
  }

  /** Same fire-and-forget rule as the queue (ADR-008): never awaited, never fails the booking. */
  private triggerNotificationProcessing(): void {
    void this.notifications
      .processPending()
      .catch((err) => this.logger.error("Failed to process notification outbox", err));
  }
}

function addMonth(firstDayOfMonth: string): string {
  const date = new Date(`${firstDayOfMonth}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function cancelDeadline(appointment: {
  startsAt: Date;
  tenant: { appointmentCancelNoticeMinutes: number };
}): Date {
  return new Date(
    appointment.startsAt.getTime() - appointment.tenant.appointmentCancelNoticeMinutes * MINUTE_MS,
  );
}

function toSettings(tenant: TenantSettingsRow): AppointmentSettings {
  return {
    slotIntervalMinutes: tenant.appointmentSlotIntervalMinutes,
    bufferMinutes: tenant.appointmentBufferMinutes,
    minLeadMinutes: tenant.appointmentMinLeadMinutes,
    advanceDays: tenant.appointmentAdvanceDays,
    cancelNoticeMinutes: tenant.appointmentCancelNoticeMinutes,
  };
}

function toClosureSummary(closure: {
  id: string;
  date: Date;
  startMinutes: number | null;
  endMinutes: number | null;
  reason: string | null;
}): LocationClosureSummary {
  return {
    id: closure.id,
    date: closure.date.toISOString().slice(0, 10),
    startMinutes: closure.startMinutes,
    endMinutes: closure.endMinutes,
    reason: closure.reason,
  };
}

function toPublicSummary(appointment: PublicAppointmentRow, now: Date): PublicAppointmentSummary {
  const deadline = cancelDeadline(appointment);
  return {
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    timezone: appointment.location.timezone,
    tenant: { name: appointment.tenant.name },
    location: { name: appointment.location.name, address: appointment.location.address },
    service: {
      name: appointment.service.name,
      durationMinutes: appointment.service.durationMinutes,
    },
    canCancel: appointment.status === "BOOKED" && now <= deadline,
    cancelDeadline: deadline.toISOString(),
    cancellationReason: appointment.cancellationReason,
  };
}

function toStaffSummary(appointment: StaffAppointmentRow): StaffAppointmentSummary {
  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    service: { id: appointment.service.id, name: appointment.service.name },
    customer: {
      firstName: appointment.customer.firstName,
      phoneE164: appointment.customer.phoneE164,
    },
    bookedByStaff: appointment.bookedByStaffId !== null,
    cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
    cancellationReason: appointment.cancellationReason,
    cancellationNote: appointment.cancellationNote,
  };
}
