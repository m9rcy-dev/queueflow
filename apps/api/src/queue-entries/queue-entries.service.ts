import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ticketQrImageUrl, ticketUrl } from "../appointments/appointment-links";
import { Prisma, type NotificationChannel, type NotificationType } from "@prisma/client";
import type {
  CustomerActiveEntry,
  CustomerVisit,
  JoinQueueResponse,
  PublicTicketSummary,
  QueueEntryStatus,
  QueueEntrySummary,
  QueueTodayStats,
  StaffQueueEntrySummary,
} from "@queueflow/types";
import type { JoinQueueInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  buildApproachingMessage,
  buildCalledMessage,
  buildJoinedMessage,
  buildNearlyNextMessage,
  buildQrEmailHtml,
  buildRecalledMessage,
} from "../notifications/notification-copy";
import { resolveChannel } from "../notifications/resolve-channel";
import { normalizePhoneToE164 } from "../common/phone.util";
import { getLocationServiceDate } from "../common/timezone.util";
import { generateSecurePublicToken } from "../common/secure-token.util";
import { tenantLogoPath } from "../tenants/tenant-logo.service";
import {
  callNextOrderSql,
  compareQueueOrder,
  competesWith,
  isPriorityActive,
  sortByQueueOrder,
} from "./queue-order";
import { staffPublicName } from "../shifts/staff-name";

/** Rounded to the nearest minute; null (not 0) for an empty set — "no data yet" must never look like "instant" on the dashboard (Phase 11, G-14). */
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function notFoundScanCode(): NotFoundException {
  return new NotFoundException({
    code: "SCAN_CODE_NOT_FOUND",
    message: "This code isn't recognized.",
  });
}

/**
 * BOOKED, and today in the location's timezone — the check-in rules shared
 * by the pre-check and the locked re-check (ADR-013).
 */
function assertCheckInAllowed(appointment: {
  status: string;
  localDate: Date;
  location: { timezone: string };
}): void {
  if (appointment.status !== "BOOKED") {
    throw new ConflictException({
      code: "APPOINTMENT_NOT_CHECKABLE",
      message:
        appointment.status === "CANCELLED"
          ? "This appointment was cancelled."
          : "This appointment was marked as missed. Please see the counter.",
    });
  }
  const today = getLocationServiceDate(appointment.location.timezone);
  if (appointment.localDate.getTime() !== today.getTime()) {
    throw new ConflictException({
      code: "APPOINTMENT_NOT_TODAY",
      message: "You can only check in on the day of your appointment.",
    });
  }
}

const ACTIVE_STATUSES: QueueEntryStatus[] = ["WAITING", "CALLED", "SERVING"];
/** Reaching any of these releases a linked guest card back to its pool (Phase 10, D-14) — SKIPPED is deliberately excluded, since the guest hasn't left, `requeue` brings the entry straight back into WAITING. */
const TERMINAL_FOR_GUEST_CARD_RELEASE: QueueEntryStatus[] = ["COMPLETED", "CANCELLED", "NO_SHOW"];

type EntryRow = {
  id: string;
  tenantId: string;
  queueId: string;
  serviceId: string;
  ticketNumber: number;
  status: QueueEntryStatus;
  recallCount: number;
  joinedAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  publicToken: string;
  priorityFrom: Date | null;
  preferredStaffId: string | null;
};

type StaffEntryRow = EntryRow & {
  // Phase 18: who the customer asked for (null = anyone).
  preferredStaff: { id: string; publicName: string | null; user: { displayName: string } } | null;
  // Phase 17: who did the work (Start / hand-over), distinct from who called.
  servedByStaff: { id: string; user: { displayName: string } } | null;
  customer: { firstName: string | null; phoneE164: string } | null;
  assignedStaff: { id: string; user: { displayName: string } } | null;
  // The GUEST_CARD code currently linked to this entry, if any (Phase 10) — null for every non-guest-card entry.
  guestCard: { guestNumber: number | null } | null;
  // The appointment this entry was checked in from, if any (Phase 14).
  appointment: { startsAt: Date } | null;
};

/**
 * The queue engine (docs/plan-review.md §5 — the highest-risk domain in the
 * whole plan). Position/estimated-wait are always recomputed on read
 * (G-13), never trusted as stored values. Call Next is the one operation
 * that genuinely needs row-level locking (ADR-006); every other transition
 * is a simple conditional update guarded by current status.
 */
@Injectable()
export class QueueEntriesService {
  private readonly logger = new Logger(QueueEntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesService: QueuesService,
    private readonly queueEvents: QueueEventsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The anonymous walk-in join (plan §19). Public — queueId identifies the
   * tenant implicitly (there's no authenticated caller), so every lookup
   * here derives tenantId from the queue itself rather than trusting input.
   */
  async join(queueId: string, input: JoinQueueInput): Promise<JoinQueueResponse> {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { location: true },
    });
    if (!queue) {
      throw new NotFoundException({ code: "QUEUE_NOT_FOUND", message: "Queue not found." });
    }
    if (queue.status !== "ACTIVE") {
      throw new ConflictException({
        code: "QUEUE_NOT_ACTIVE",
        message: "This queue is not currently accepting customers.",
      });
    }

    // Idempotency (G-21) checked before any other side effect — a retried
    // request with the same key returns the original entry, never a
    // duplicate.
    if (input.idempotencyKey) {
      const existing = await this.prisma.queueEntry.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: queue.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        return this.toJoinResponse(
          existing,
          await this.computePosition(existing, queue.servingCapacity),
        );
      }
    }

    const queueService = await this.prisma.queueService.findUnique({
      where: { queueId_serviceId: { queueId, serviceId: input.serviceId } },
      include: { service: true },
    });
    if (!queueService || !queueService.service.active || !queueService.service.queueEnabled) {
      throw new NotFoundException({
        code: "SERVICE_NOT_AVAILABLE",
        message: "This service isn't available for this queue.",
      });
    }

    // Phase 18: a preferred staff member must be on shift here right now.
    if (input.preferredStaffId) {
      await this.assertOnShift(input.preferredStaffId, queue.locationId);
    }

    const phoneE164 = normalizePhoneToE164(input.customerPhone);
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_phoneE164: { tenantId: queue.tenantId, phoneE164 } },
      create: { tenantId: queue.tenantId, phoneE164, firstName: input.customerName },
      update: { firstName: input.customerName },
    });

    // Max active tickets (G-34) — per-queue cap, then the broader
    // per-location cap (only binds once a location has more than one
    // queue; D-04 defaults to one). Known limitation: this is a
    // check-then-create, not serialized against the same customer's other
    // simultaneous join attempt — a real but low-severity race (two tabs,
    // same millisecond) accepted for MVP rather than adding customer-row
    // locking for it.
    const activeInQueue = await this.prisma.queueEntry.count({
      where: { queueId, customerId: customer.id, status: { in: ACTIVE_STATUSES } },
    });
    if (activeInQueue >= queue.maxActiveTicketsPerCustomer) {
      throw new ConflictException({
        code: "TOO_MANY_ACTIVE_TICKETS",
        message: "You already have an active ticket in this queue.",
      });
    }
    const activeAtLocation = await this.prisma.queueEntry.count({
      where: {
        customerId: customer.id,
        status: { in: ACTIVE_STATUSES },
        queue: { locationId: queue.locationId },
      },
    });
    if (activeAtLocation >= queue.location.maxActiveTicketsPerCustomer) {
      throw new ConflictException({
        code: "TOO_MANY_ACTIVE_TICKETS_LOCATION",
        message: "You already have the maximum number of active tickets at this location.",
      });
    }

    const serviceDate = getLocationServiceDate(queue.location.timezone);
    const counter = await this.prisma.queueTicketCounter.upsert({
      where: { queueId_serviceDate: { queueId, serviceDate } },
      create: { queueId, serviceDate, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    // The create and the notification-threshold re-evaluation are one
    // atomic unit (G-31) — a join that lands the new customer straight
    // into "nearly next" territory (a short queue) must enqueue that
    // notification in the same transaction as the entry itself existing.
    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.queueEntry.create({
        data: {
          tenantId: queue.tenantId,
          queueId,
          serviceId: input.serviceId,
          customerId: customer.id,
          publicToken: generateSecurePublicToken(),
          ticketNumber: counter.lastNumber,
          serviceDate,
          idempotencyKey: input.idempotencyKey ?? null,
          preferredStaffId: input.preferredStaffId ?? null,
          contactEmail: input.customerEmail ?? null,
        },
      });
      // Phase 19: they gave an email — send the ticket link so the ticket
      // (and its QR) can't be lost to a closed tab.
      if (created.contactEmail) {
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: queue.tenantId },
          select: { name: true },
        });
        const body = buildJoinedMessage({
          businessName: tenant.name,
          ticketNumber: created.ticketNumber,
          ticketUrl: ticketUrl(this.config, created.publicToken),
        });
        await this.notifications.enqueue(tx, {
          tenantId: queue.tenantId,
          queueEntryId: created.id,
          type: "JOINED",
          channel: "EMAIL",
          recipient: created.contactEmail,
          body,
          htmlBody: buildQrEmailHtml({
            text: body,
            qrImageUrl: ticketQrImageUrl(this.config, created.publicToken),
            qrCaption: `Ticket #${created.ticketNumber}: scan to open your ticket on any phone`,
          }),
        });
      }
      await this.evaluateWaitingThresholds(tx, queueId);
      return created;
    });

    // A new WAITING entry doesn't shift anyone else's position, but every
    // mutation emits unconditionally rather than trying to be clever about
    // which ones could matter to existing watchers — simplicity over a
    // micro-optimization.
    this.queueEvents.emitQueueChanged(queueId);
    this.triggerNotificationProcessing();

    return this.toJoinResponse(entry, await this.computePosition(entry, queue.servingCapacity));
  }

  /**
   * Staff manually adding a walk-in from the counter (roadmap Phase 5) —
   * identical join logic, ownership-checked first since there's now an
   * authenticated tenant caller instead of an anonymous scan.
   */
  async addWalkIn(
    tenantId: string,
    queueId: string,
    input: JoinQueueInput,
  ): Promise<JoinQueueResponse> {
    await this.queuesService.findOwnedQueue(tenantId, queueId);
    return this.join(queueId, input);
  }

  /**
   * The physical counter scanner's one operation (Phase 10, D-10/D-11) —
   * staff-authenticated (the scanner is business hardware, not a
   * customer's own device), instant, no confirmation step. Branches on
   * whichever code kind was actually scanned; anything else (QUEUE/
   * DISPLAY/GENERAL) gets the same uniform rejection as an unrecognized
   * code — this endpoint isn't a general code resolver.
   */
  async joinByScan(
    tenantId: string,
    queueId: string,
    publicCode: string,
  ): Promise<StaffQueueEntrySummary> {
    const queue = await this.prisma.queue.findFirst({
      where: { id: queueId, tenantId },
      include: { location: true },
    });
    if (!queue) {
      throw new NotFoundException({ code: "QUEUE_NOT_FOUND", message: "Queue not found." });
    }
    if (queue.status !== "ACTIVE") {
      throw new ConflictException({
        code: "QUEUE_NOT_ACTIVE",
        message: "This queue is not currently accepting customers.",
      });
    }

    const code = await this.prisma.code.findUnique({ where: { publicCode } });
    if (!code || !code.active || code.tenantId !== tenantId) {
      throw notFoundScanCode();
    }

    if (code.contextType === "GUEST_CARD") {
      return this.joinByGuestCard(tenantId, queue, code);
    }
    if (code.contextType === "CUSTOMER_IDENTITY") {
      return this.joinByCustomerIdentity(tenantId, queue, code);
    }
    if (code.contextType === "APPOINTMENT_TICKET" && code.appointmentId) {
      // A booking for another location gets the same uniform rejection as
      // a guest card from another location's pool.
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: code.appointmentId, tenantId, locationId: queue.locationId },
        select: { id: true },
      });
      if (!appointment) throw notFoundScanCode();
      const { entryId } = await this.checkInAppointment(tenantId, appointment.id, queue.id);
      return this.getByIdForTenant(tenantId, entryId);
    }
    throw notFoundScanCode();
  }

  /** Staff checking a booking in from the day list (Phase 14) — `queueId` optional, see resolveCheckInQueue. */
  async checkInAppointmentByStaff(
    tenantId: string,
    appointmentId: string,
    queueId?: string,
  ): Promise<StaffQueueEntrySummary> {
    const { entryId } = await this.checkInAppointment(tenantId, appointmentId, queueId);
    return this.getByIdForTenant(tenantId, entryId);
  }

  /**
   * The customer's own "I'm here" from their appointment page (§78 method
   * 3). The appointment token is the credential, the same as the queue
   * ticket's. Returns the new ticket's token so the page can open the live
   * ticket.
   */
  async checkInAppointmentByToken(appointmentToken: string): Promise<JoinQueueResponse> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { publicToken: appointmentToken },
      select: { id: true, tenantId: true },
    });
    if (!appointment) {
      throw new NotFoundException({
        code: "APPOINTMENT_NOT_FOUND",
        message: "Appointment not found.",
      });
    }
    const { entryId } = await this.checkInAppointment(appointment.tenantId, appointment.id);
    const entry = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    return this.toJoinResponse(
      entry,
      await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
    );
  }

  /**
   * Appointment check-in (§36, D-12): turns a BOOKED appointment into a
   * WAITING queue entry linked to it, and the appointment into CHECKED_IN.
   * The one implementation behind the scanner, the customer's link, and
   * staff.
   *
   * Rules (ADR-013): only on the appointment's own local date; any time
   * that day (an early arrival waits in normal order until its priority
   * window opens, G-25 — `priorityFrom` is fixed here as startsAt minus
   * the tenant's window); idempotent (§78) — checking in again returns the
   * existing entry. The appointment row is locked for the whole
   * transaction, so two simultaneous check-ins (a scan and a tap, say)
   * produce one entry. The per-customer active-ticket caps (G-34) are not
   * applied: the customer already holds a booking for this visit.
   */
  private async checkInAppointment(
    tenantId: string,
    appointmentId: string,
    queueId?: string,
  ): Promise<{ entryId: string; created: boolean }> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      include: { location: true, tenant: true, queueEntry: { select: { id: true } } },
    });
    if (!appointment) {
      throw new NotFoundException({
        code: "APPOINTMENT_NOT_FOUND",
        message: "Appointment not found.",
      });
    }
    if (appointment.status === "CHECKED_IN" && appointment.queueEntry) {
      return { entryId: appointment.queueEntry.id, created: false };
    }
    assertCheckInAllowed(appointment);

    const queue = await this.resolveCheckInQueue(tenantId, appointment, queueId);
    const serviceDate = getLocationServiceDate(appointment.location.timezone);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
      const current = await tx.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        include: { queueEntry: { select: { id: true } } },
      });
      if (current.status === "CHECKED_IN" && current.queueEntry) {
        return { entryId: current.queueEntry.id, created: false };
      }
      assertCheckInAllowed({ ...current, location: appointment.location });

      const counter = await tx.queueTicketCounter.upsert({
        where: { queueId_serviceDate: { queueId: queue.id, serviceDate } },
        create: { queueId: queue.id, serviceDate, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const created = await tx.queueEntry.create({
        data: {
          tenantId,
          queueId: queue.id,
          serviceId: current.serviceId,
          customerId: current.customerId,
          publicToken: generateSecurePublicToken(),
          ticketNumber: counter.lastNumber,
          serviceDate,
          appointmentId,
          priorityFrom: new Date(
            current.startsAt.getTime() -
              appointment.tenant.appointmentPriorityWindowMinutes * 60_000,
          ),
        },
      });
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "CHECKED_IN", checkedInAt: new Date() },
      });
      await this.evaluateWaitingThresholds(tx, queue.id);
      return { entryId: created.id, created: true };
    });

    if (result.created) {
      this.queueEvents.emitQueueChanged(queue.id);
      this.triggerNotificationProcessing();
    }
    return result;
  }

  /**
   * Which queue a check-in lands in: the one given (it must be at the
   * appointment's location), else the location's active queue that offers
   * the appointment's service, else the location's only active queue (an
   * appointment-only service needn't be attached to any queue). D-04
   * makes one queue per location the norm, so the last two rarely differ.
   */
  private async resolveCheckInQueue(
    tenantId: string,
    appointment: { locationId: string; serviceId: string },
    queueId?: string,
  ): Promise<{ id: string }> {
    const candidates = await this.prisma.queue.findMany({
      where: {
        tenantId,
        locationId: appointment.locationId,
        ...(queueId && { id: queueId }),
      },
      include: { queueServices: { select: { serviceId: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (queueId && candidates.length === 0) {
      throw new NotFoundException({ code: "QUEUE_NOT_FOUND", message: "Queue not found." });
    }
    const active = candidates.filter((q) => q.status === "ACTIVE");
    const chosen =
      active.find((q) => q.queueServices.some((qs) => qs.serviceId === appointment.serviceId)) ??
      (active.length === 1 ? active[0] : undefined);
    if (!chosen) {
      throw new ConflictException({
        code: "NO_QUEUE_FOR_CHECK_IN",
        message: "There's no open queue to check in to right now. Please see the counter.",
      });
    }
    return chosen;
  }

  /**
   * Zero personal data by design (D-14) — customerId stays null the whole
   * way through. The card's own currentEntryId linkage *is* the dedup
   * guarantee (G-54): re-scanning an already-linked card returns the
   * existing entry rather than minting a second one, and a `FOR UPDATE`
   * row lock on the code closes the race between two near-simultaneous
   * scans of the same physical card (whichever transaction commits first
   * wins the claim; the loser sees currentEntryId already set and returns
   * that entry instead of creating an orphaned duplicate).
   */
  private async joinByGuestCard(
    tenantId: string,
    queue: { id: string; locationId: string; servingCapacity: number },
    code: { id: string; locationId: string | null },
  ): Promise<StaffQueueEntrySummary> {
    if (code.locationId !== queue.locationId) {
      // A guest card from a different location's pool — same uniform
      // rejection as garbage input, not a hint about where it does belong.
      throw notFoundScanCode();
    }

    const serviceId = await this.resolveSingleActiveService(queue.id);
    const serviceDate = getLocationServiceDate(
      (await this.prisma.location.findUniqueOrThrow({ where: { id: queue.locationId } })).timezone,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; currentEntryId: string | null }[]>`
        SELECT id, "currentEntryId" FROM codes WHERE id = ${code.id} FOR UPDATE
      `;
      const currentEntryId = locked[0]?.currentEntryId ?? null;
      if (currentEntryId) {
        const existing = await tx.queueEntry.findUnique({ where: { id: currentEntryId } });
        if (existing && ACTIVE_STATUSES.includes(existing.status)) {
          return { entryId: existing.id, created: false };
        }
        // The card thinks it's still held but its entry already reached a
        // terminal state — should have been released already (defensive
        // fallback only); treat the card as free and fall through.
      }

      const counter = await tx.queueTicketCounter.upsert({
        where: { queueId_serviceDate: { queueId: queue.id, serviceDate } },
        create: { queueId: queue.id, serviceDate, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const created = await tx.queueEntry.create({
        data: {
          tenantId,
          queueId: queue.id,
          serviceId,
          customerId: null,
          publicToken: generateSecurePublicToken(),
          ticketNumber: counter.lastNumber,
          serviceDate,
          idempotencyKey: null,
        },
      });
      await tx.code.update({ where: { id: code.id }, data: { currentEntryId: created.id } });
      await this.evaluateWaitingThresholds(tx, queue.id);
      return { entryId: created.id, created: true };
    });

    if (result.created) {
      this.queueEvents.emitQueueChanged(queue.id);
      this.triggerNotificationProcessing();
    }
    return this.getByIdForTenant(tenantId, result.entryId);
  }

  /**
   * A signed-up customer's own identity code (Phase 9/10, D-11). Unlike a
   * guest card, a real customerId exists here, so the ordinary per-location
   * active-ticket cap (G-34) still applies — a scan doesn't bypass it.
   * Re-scanning while already active in *this* queue is idempotent (G-54):
   * returns the existing entry rather than erroring or duplicating.
   */
  private async joinByCustomerIdentity(
    tenantId: string,
    queue: { id: string; locationId: string; servingCapacity: number },
    code: { customerId: string | null },
  ): Promise<StaffQueueEntrySummary> {
    const customerId = code.customerId;
    if (!customerId) throw notFoundScanCode(); // defensive — a CUSTOMER_IDENTITY row always has one

    const existing = await this.prisma.queueEntry.findFirst({
      where: { queueId: queue.id, customerId, status: { in: ACTIVE_STATUSES } },
      orderBy: { joinedAt: "desc" },
    });
    if (existing) {
      return this.getByIdForTenant(tenantId, existing.id);
    }

    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: queue.locationId },
    });
    const activeAtLocation = await this.prisma.queueEntry.count({
      where: {
        customerId,
        status: { in: ACTIVE_STATUSES },
        queue: { locationId: queue.locationId },
      },
    });
    if (activeAtLocation >= location.maxActiveTicketsPerCustomer) {
      throw new ConflictException({
        code: "TOO_MANY_ACTIVE_TICKETS_LOCATION",
        message: "You already have the maximum number of active tickets at this location.",
      });
    }

    const serviceId = await this.resolveSingleActiveService(queue.id);
    const serviceDate = getLocationServiceDate(location.timezone);
    const counter = await this.prisma.queueTicketCounter.upsert({
      where: { queueId_serviceDate: { queueId: queue.id, serviceDate } },
      create: { queueId: queue.id, serviceDate, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.queueEntry.create({
        data: {
          tenantId,
          queueId: queue.id,
          serviceId,
          customerId,
          publicToken: generateSecurePublicToken(),
          ticketNumber: counter.lastNumber,
          serviceDate,
          idempotencyKey: null,
        },
      });
      await this.evaluateWaitingThresholds(tx, queue.id);
      return created;
    });
    this.queueEvents.emitQueueChanged(queue.id);
    this.triggerNotificationProcessing();
    return this.getByIdForTenant(tenantId, entry.id);
  }

  /**
   * Scan-to-join skips the service-picker step entirely (D-11's "no
   * confirmation" requirement) — it only works when there's exactly one
   * active+queueEnabled service to default to. A queue offering more than
   * one service needs the QR-poster or staff walk-in form instead, both of
   * which do offer a picker. Deliberate MVP scoping, not an oversight.
   */
  private async resolveSingleActiveService(queueId: string): Promise<string> {
    const services = await this.prisma.queueService.findMany({
      where: { queueId, service: { active: true, queueEnabled: true } },
      select: { serviceId: true },
    });
    if (services.length !== 1) {
      throw new ConflictException({
        code: "SCAN_REQUIRES_SINGLE_SERVICE",
        message:
          "Scan-to-join needs this queue to have exactly one active service configured — use the walk-in form instead.",
      });
    }
    return services[0].serviceId;
  }

  /** Staff-facing single-entry lookup — includes customer identity and the acting staff member (G-18), never exposed on the public/customer routes. */
  async getByIdForTenant(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    const entry = await this.findOwnedStaffEntry(tenantId, entryId);
    return this.toStaffSummary(
      entry,
      await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
    );
  }

  /** The customer's live ticket — plus the business name and logo for the page header (Phase 16). Never staff or other customers' details. */
  async getByPublicToken(publicToken: string): Promise<PublicTicketSummary> {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { publicToken },
      include: {
        tenant: { include: { logo: { select: { updatedAt: true } } } },
        preferredStaff: { include: { user: { select: { displayName: true } } } },
      },
    });
    if (!entry) {
      throw new NotFoundException({ code: "QUEUE_ENTRY_NOT_FOUND", message: "Ticket not found." });
    }
    return {
      ...this.toSummary(
        entry,
        await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
      ),
      tenant: {
        name: entry.tenant.name,
        logoPath: tenantLogoPath(entry.tenantId, entry.tenant.logo),
      },
      preferredStaffName: entry.preferredStaff ? staffPublicName(entry.preferredStaff) : null,
    };
  }

  /**
   * The customer portal's own live status (Phase 9, G-55) — this customer's
   * currently active entry in this tenant, if any. Most recently joined
   * wins on the rare chance more than one is active (maxActiveTicketsPerCustomer
   * defaults to 1 per queue, but a customer could in principle hold entries
   * in two different queues at once).
   */
  async getActiveForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerActiveEntry | null> {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { tenantId, customerId, status: { in: ACTIVE_STATUSES } },
      orderBy: { joinedAt: "desc" },
      include: { queue: { select: { name: true, servingCapacity: true } } },
    });
    if (!entry) return null;
    const positionInfo = await this.computePosition(entry, entry.queue.servingCapacity);
    return { ...this.toSummary(entry, positionInfo), queueName: entry.queue.name };
  }

  /**
   * The customer's own recent visits in this tenant (Phase 17) — newest
   * first, live ones included. The live ticket token is only returned for
   * an active visit (it's that ticket's credential); finished visits don't
   * need it.
   */
  async listRecentForCustomer(
    tenantId: string,
    customerId: string,
    limit = 10,
  ): Promise<CustomerVisit[]> {
    const entries = await this.prisma.queueEntry.findMany({
      where: { tenantId, customerId },
      orderBy: { joinedAt: "desc" },
      take: limit,
      include: {
        queue: { select: { name: true, location: { select: { name: true } } } },
        service: { select: { name: true } },
        servedByStaff: { include: { user: { select: { displayName: true } } } },
        preferredStaff: { include: { user: { select: { displayName: true } } } },
      },
    });
    return entries.map((entry) => ({
      id: entry.id,
      ticketNumber: entry.ticketNumber,
      status: entry.status,
      queueName: entry.queue.name,
      locationName: entry.queue.location.name,
      serviceName: entry.service.name,
      joinedAt: entry.joinedAt.toISOString(),
      completedAt: entry.completedAt?.toISOString() ?? null,
      servedByName: entry.servedByStaff?.user.displayName ?? null,
      publicToken: ACTIVE_STATUSES.includes(entry.status) ? entry.publicToken : null,
    }));
  }

  async list(
    tenantId: string,
    queueId: string,
    status?: QueueEntryStatus,
  ): Promise<StaffQueueEntrySummary[]> {
    const queue = await this.queuesService.findOwnedQueue(tenantId, queueId);
    // Loaded once, with each entry's own service duration, so position and
    // estimated-wait can be computed for the whole batch without an N+1
    // query per row (the single-entry lookups below do pay that cost, but
    // a staff dashboard listing every entry in the queue is exactly the
    // case worth avoiding it for).
    const entries = await this.prisma.queueEntry.findMany({
      where: { queueId, ...(status && { status }) },
      include: {
        service: { select: { durationMinutes: true } },
        customer: { select: { firstName: true, phoneE164: true } },
        assignedStaff: { include: { user: { select: { displayName: true } } } },
        servedByStaff: { include: { user: { select: { displayName: true } } } },
        preferredStaff: { include: { user: { select: { displayName: true } } } },
        guestCard: { select: { guestNumber: true } },
        appointment: { select: { startsAt: true } },
      },
    });
    const now = new Date();
    return sortByQueueOrder(entries, now).map((entry) =>
      this.toStaffSummary(
        entry,
        this.computePositionSync(entry, entries, queue.servingCapacity, now),
      ),
    );
  }

  /**
   * The live "today" dashboard (Phase 11, G-14) — scoped to the location's
   * local service-day, the same boundary the ticket counter itself resets
   * on (getLocationServiceDate), not a rolling 24h window. Averages are
   * computed only over entries that actually reached the relevant
   * timestamp today (e.g. a WAITING entry contributes nothing to average
   * wait yet) — null, not 0, when there's no data to average.
   */
  async getTodayStats(tenantId: string, queueId: string): Promise<QueueTodayStats> {
    const queue = await this.queuesService.findOwnedQueue(tenantId, queueId);
    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: queue.locationId },
    });
    const serviceDate = getLocationServiceDate(location.timezone);

    const [waitingCount, todaysEntries] = await Promise.all([
      this.prisma.queueEntry.count({ where: { queueId, status: "WAITING" } }),
      this.prisma.queueEntry.findMany({
        where: { queueId, serviceDate },
        select: {
          status: true,
          joinedAt: true,
          calledAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
    ]);

    const waitMinutes = todaysEntries
      .filter((e) => e.calledAt)
      .map((e) => (e.calledAt!.getTime() - e.joinedAt.getTime()) / 60_000);
    const serviceDurationMinutes = todaysEntries
      .filter((e) => e.startedAt && e.completedAt)
      .map((e) => (e.completedAt!.getTime() - e.startedAt!.getTime()) / 60_000);

    return {
      queueId: queue.id,
      queueName: queue.name,
      waitingCount,
      servedCount: todaysEntries.filter((e) => e.status === "COMPLETED").length,
      averageWaitMinutes: average(waitMinutes),
      averageServiceDurationMinutes: average(serviceDurationMinutes),
      abandonedCount: todaysEntries.filter((e) => e.status === "CANCELLED").length,
      noShowCount: todaysEntries.filter((e) => e.status === "NO_SHOW").length,
    };
  }

  /**
   * The one genuinely concurrency-critical operation (ADR-006). Two
   * simultaneous Call Next requests against the same queue must never
   * select the same entry — SELECT ... FOR UPDATE SKIP LOCKED guarantees
   * this at the database level: whichever transaction locks the row first
   * wins it, the other skips straight past to the next eligible one (or
   * finds none).
   */
  async callNext(
    tenantId: string,
    queueId: string,
    staffTenantUserId: string,
  ): Promise<StaffQueueEntrySummary> {
    const queue = await this.queuesService.findOwnedQueue(tenantId, queueId);
    if (queue.status !== "ACTIVE") {
      throw new ConflictException({
        code: "QUEUE_NOT_ACTIVE",
        message: "This queue is not active.",
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Same order as compareQueueOrder (G-25): open-window appointments
      // first, then FIFO.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM queue_entries
        WHERE "queueId" = ${queueId} AND status = 'WAITING'
          -- Phase 18: skip customers waiting for someone else; they keep their place.
          AND ("preferredStaffId" IS NULL OR "preferredStaffId" = ${staffTenantUserId})
        ORDER BY ${callNextOrderSql(new Date())}
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) {
        return null;
      }
      const called = await tx.queueEntry.update({
        where: { id: rows[0].id },
        data: {
          status: "CALLED",
          calledAt: new Date(),
          assignedStaffId: staffTenantUserId,
          version: { increment: 1 },
        },
      });
      await this.enqueueCalledNotification(tx, called.id);
      // Removing this entry from WAITING shifts everyone behind it up one
      // position — same transaction, so their threshold state is
      // consistent with the position they actually ended up at (G-31).
      await this.evaluateWaitingThresholds(tx, queueId);
      return called;
    });

    if (!updated) {
      throw new NotFoundException({
        code: "QUEUE_EMPTY",
        message: "No one is waiting for you right now.",
      });
    }
    this.queueEvents.emitQueueChanged(queueId);
    this.triggerNotificationProcessing();
    return this.getByIdForTenant(tenantId, updated.id);
  }

  /**
   * Phase 17 (ADR-016): whoever presses Start is recorded as serving the
   * customer — unless they were already handed to someone (handOver), in
   * which case that stands.
   */
  async start(
    tenantId: string,
    entryId: string,
    actorTenantUserId: string,
  ): Promise<StaffQueueEntrySummary> {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id: entryId, tenantId },
      select: { servedByStaffId: true },
    });
    await this.transition(tenantId, entryId, ["CALLED"], {
      status: "SERVING",
      startedAt: new Date(),
      servedByStaffId: entry?.servedByStaffId ?? actorTenantUserId,
    });
    return this.getByIdForTenant(tenantId, entryId);
  }

  /**
   * Set or clear who a waiting customer wants (Phase 18) — e.g. they ask at
   * the counter. Only for someone still waiting; the person must be on
   * shift at this location. They keep their place either way.
   */
  async setPreference(
    tenantId: string,
    entryId: string,
    preferredStaffId: string | null,
  ): Promise<StaffQueueEntrySummary> {
    const entry = await this.findOwnedStaffEntry(tenantId, entryId);
    if (entry.status !== "WAITING" && entry.status !== "SKIPPED") {
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: `Only a waiting customer's preference can change — current status is ${entry.status}.`,
      });
    }
    if (preferredStaffId) {
      const queue = await this.prisma.queue.findUniqueOrThrow({
        where: { id: entry.queueId },
        select: { locationId: true },
      });
      await this.assertOnShift(preferredStaffId, queue.locationId);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.queueEntry.update({
        where: { id: entryId },
        data: { preferredStaffId, version: { increment: 1 } },
      });
      // Their line changed, so their position (and notification state) may have.
      await this.evaluateWaitingThresholds(tx, entry.queueId);
    });
    this.queueEvents.emitQueueChanged(entry.queueId);
    this.triggerNotificationProcessing();
    return this.getByIdForTenant(tenantId, entryId);
  }

  /** A preferred staff member must be on shift at the location now (ADR-017). */
  private async assertOnShift(tenantUserId: string, locationId: string): Promise<void> {
    const shift = await this.prisma.staffShift.findFirst({
      where: { tenantUserId, locationId, endedAt: null, tenantUser: { removedAt: null } },
      select: { id: true },
    });
    if (!shift) {
      throw new ConflictException({
        code: "STAFF_NOT_ON_SHIFT",
        message: "That person isn't working right now. Choose someone else, or anyone.",
      });
    }
  }

  /**
   * Hand a called or in-progress customer to another team member (Phase
   * 17) — e.g. Ana called them, Ben is doing the cut. The new person must
   * be an active member who can work at this queue's location (owner/admin,
   * or allocated there), so credit can't land on someone from another site.
   */
  async handOver(
    tenantId: string,
    entryId: string,
    toTenantUserId: string,
  ): Promise<StaffQueueEntrySummary> {
    const entry = await this.findOwnedStaffEntry(tenantId, entryId);
    if (entry.status !== "CALLED" && entry.status !== "SERVING") {
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: `Only a called or in-progress customer can be handed over — current status is ${entry.status}.`,
      });
    }
    const queue = await this.prisma.queue.findUniqueOrThrow({
      where: { id: entry.queueId },
      select: { locationId: true },
    });
    const member = await this.prisma.tenantUser.findFirst({
      where: {
        id: toTenantUserId,
        tenantId,
        removedAt: null,
        OR: [{ role: { in: ["TENANT_OWNER", "TENANT_ADMIN"] } }, { locationId: queue.locationId }],
      },
    });
    if (!member) {
      throw new NotFoundException({
        code: "MEMBER_NOT_FOUND",
        message: "That team member can't serve at this location.",
      });
    }
    await this.prisma.queueEntry.update({
      where: { id: entryId },
      data: { servedByStaffId: member.id, version: { increment: 1 } },
    });
    this.queueEvents.emitQueueChanged(entry.queueId);
    return this.getByIdForTenant(tenantId, entryId);
  }

  async complete(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["SERVING"], {
      status: "COMPLETED",
      completedAt: new Date(),
    });
    return this.getByIdForTenant(tenantId, entryId);
  }

  /** Temporarily out of active ordering — `requeue` is the way back in (G-15). */
  async skip(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["WAITING"], { status: "SKIPPED" });
    return this.getByIdForTenant(tenantId, entryId);
  }

  /**
   * Same ticket number, fresh `joinedAt` — re-enters at the back of the
   * current line rather than its old spot (G-15's explicit resolution).
   */
  async requeue(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["SKIPPED"], {
      status: "WAITING",
      joinedAt: new Date(),
    });
    return this.getByIdForTenant(tenantId, entryId);
  }

  async cancelByStaff(
    tenantId: string,
    entryId: string,
    reason?: string,
  ): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["WAITING", "CALLED"], {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
    });
    return this.getByIdForTenant(tenantId, entryId);
  }

  /** The customer's own "Leave Queue" (plan §24) — same operation, reached via public token instead of a tenant-authenticated route. */
  async cancelByPublicToken(publicToken: string, reason?: string): Promise<QueueEntrySummary> {
    const entry = await this.prisma.queueEntry.findUnique({ where: { publicToken } });
    if (!entry) {
      throw new NotFoundException({ code: "QUEUE_ENTRY_NOT_FOUND", message: "Ticket not found." });
    }
    return this.transition(entry.tenantId, entry.id, ["WAITING", "CALLED"], {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
    });
  }

  async markNoShow(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["CALLED"], { status: "NO_SHOW" });
    return this.getByIdForTenant(tenantId, entryId);
  }

  /**
   * Recall is a notification resend, not a state change (G-15) — the entry
   * stays CALLED. Actual notification delivery is Phase 7's job; this just
   * enforces the per-queue recall cap synchronously.
   */
  async recall(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    const entry = await this.findOwnedEntry(tenantId, entryId);
    if (entry.status !== "CALLED") {
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: `Cannot recall — current status is ${entry.status}.`,
      });
    }
    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: entry.queueId } });
    if (entry.recallCount >= queue.maxRecallCount) {
      throw new ConflictException({
        code: "MAX_RECALLS_REACHED",
        message: "Maximum recall attempts reached for this ticket.",
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.queueEntry.update({
        where: { id: entryId },
        data: { recallCount: { increment: 1 } },
      });
      // Recall is an explicit staff-triggered resend, not a one-time
      // threshold — always enqueues, never gated by calledNotifiedAt
      // (that flag only prevents the automatic CALLED notification from
      // re-firing on unrelated recomputation).
      await this.enqueueRecalledNotification(tx, entryId);
    });
    // Doesn't change status or anyone else's position, but the entry's own
    // watcher (if any) should still see the updated recallCount live.
    this.queueEvents.emitQueueChanged(entry.queueId);
    this.triggerNotificationProcessing();
    return this.getByIdForTenant(tenantId, entryId);
  }

  private async transition(
    tenantId: string,
    entryId: string,
    fromStatuses: QueueEntryStatus[],
    data: Record<string, unknown>,
  ): Promise<QueueEntrySummary> {
    // The transition and the notification-threshold re-evaluation are one
    // atomic unit (G-31) — completing/skipping/cancelling a WAITING or
    // CALLED entry (or requeuing one back into WAITING) can shift every
    // remaining WAITING entry's position, so their threshold state must be
    // updated in the same transaction as whatever caused the shift.
    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.queueEntry.updateMany({
        where: { id: entryId, tenantId, status: { in: fromStatuses } },
        data: { ...data, version: { increment: 1 } },
      });
      if (updateResult.count > 0) {
        const updated = await tx.queueEntry.findFirstOrThrow({ where: { id: entryId, tenantId } });
        await this.evaluateWaitingThresholds(tx, updated.queueId);
        if (TERMINAL_FOR_GUEST_CARD_RELEASE.includes(updated.status)) {
          // A no-op update if no card is linked — cheap enough not to bother
          // checking first, and correct for both staff and public-token
          // cancel (cancelByPublicToken shares this same transition() path).
          await tx.code.updateMany({
            where: { currentEntryId: updated.id },
            data: { currentEntryId: null },
          });
        }
      }
      return updateResult;
    });
    if (result.count === 0) {
      const existing = await this.prisma.queueEntry.findFirst({ where: { id: entryId, tenantId } });
      if (!existing) {
        throw new NotFoundException({
          code: "QUEUE_ENTRY_NOT_FOUND",
          message: "Queue entry not found.",
        });
      }
      throw new ConflictException({
        code: "INVALID_TRANSITION",
        message: `Cannot perform this action — current status is ${existing.status}.`,
      });
    }
    // Deliberately the plain (non-staff) shape here, never the rich one —
    // this helper is shared with cancelByPublicToken, which must never
    // hand a customer back another person's name or the assigned staff
    // member's name. Staff-facing callers re-fetch via getByIdForTenant
    // immediately after calling this.
    const entry = await this.findOwnedEntry(tenantId, entryId);
    const summary = this.toSummary(
      entry,
      await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
    );
    this.queueEvents.emitQueueChanged(summary.queueId);
    this.triggerNotificationProcessing();
    return summary;
  }

  /**
   * G-31's threshold re-evaluation — recomputes every currently-WAITING
   * entry's position (list order = position, cheap at realistic queue
   * sizes, no separate count-ahead query needed) and enqueues
   * APPROACHING/NEARLY_NEXT the first time each is crossed. Checked
   * nearest-first: an entry that jumps straight into "nearly next"
   * territory (several people ahead left at once) gets that one
   * notification, with "approaching" silently marked as sent rather than
   * fired late and redundant (G-31's suppression rule).
   */
  private async evaluateWaitingThresholds(
    tx: Prisma.TransactionClient,
    queueId: string,
  ): Promise<void> {
    const queue = await tx.queue.findUniqueOrThrow({
      where: { id: queueId },
      include: { tenant: { select: { name: true } } },
    });
    const waiting = sortByQueueOrder(
      await tx.queueEntry.findMany({
        where: { queueId, status: "WAITING" },
        include: { customer: { select: { phoneE164: true, email: true } } },
      }),
      new Date(),
    );

    interface Candidate {
      id: string;
      type: NotificationType;
      channel: NotificationChannel;
      recipient: string;
      body: string;
      updateData: Prisma.QueueEntryUpdateInput;
    }
    const candidates: Candidate[] = [];

    for (let index = 0; index < waiting.length; index += 1) {
      const entry = waiting[index];
      // Phase 18: people ahead *in this customer's own line* (competesWith).
      const peopleAhead = waiting
        .slice(0, index)
        .filter((other) => competesWith(other, entry)).length;
      if (!entry.customer) continue; // no contact details to notify — shouldn't happen via the join flow, but never crash on it

      const { channel, recipient } = resolveChannel(entry.customer, entry.contactEmail);

      if (peopleAhead <= queue.nearlyNextThreshold && !entry.nearlyNextNotifiedAt) {
        candidates.push({
          id: entry.id,
          type: "NEARLY_NEXT",
          channel,
          recipient,
          body: buildNearlyNextMessage({
            businessName: queue.tenant.name,
            queueName: queue.name,
            peopleAhead,
          }),
          updateData: {
            nearlyNextNotifiedAt: new Date(),
            approachingNotifiedAt: entry.approachingNotifiedAt ?? new Date(),
          },
        });
      } else if (peopleAhead <= queue.approachingThreshold && !entry.approachingNotifiedAt) {
        candidates.push({
          id: entry.id,
          type: "APPROACHING",
          channel,
          recipient,
          body: buildApproachingMessage({
            businessName: queue.tenant.name,
            queueName: queue.name,
            peopleAhead,
          }),
          updateData: { approachingNotifiedAt: new Date() },
        });
      }
    }
    if (candidates.length === 0) return;

    // Only touch entries we can actually lock right now (ADR-006's own
    // pattern, reused) — a concurrent Call Next against this same queue
    // may already hold one of these rows locked via its own row-lock
    // select. Blocking here to wait for it would deadlock against that
    // other transaction symmetrically waiting on ours (proven by a real
    // concurrent-Call-Next integration test). Skipping a locked row is
    // safe: this same check runs again on the very next mutation.
    const lockable = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM queue_entries
      WHERE id IN (${Prisma.join(candidates.map((c) => c.id))})
      FOR UPDATE SKIP LOCKED
    `;
    const lockableIds = new Set(lockable.map((row) => row.id));

    for (const candidate of candidates) {
      if (!lockableIds.has(candidate.id)) continue;
      await tx.queueEntry.update({ where: { id: candidate.id }, data: candidate.updateData });
      await this.notifications.enqueue(tx, {
        tenantId: queue.tenantId,
        queueEntryId: candidate.id,
        type: candidate.type,
        channel: candidate.channel,
        recipient: candidate.recipient,
        body: candidate.body,
      });
    }
  }

  /** Called once, from callNext, for the specific entry that just got called. */
  private async enqueueCalledNotification(
    tx: Prisma.TransactionClient,
    entryId: string,
  ): Promise<void> {
    const entry = await tx.queueEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        customer: { select: { phoneE164: true, email: true } },
        queue: { include: { tenant: { select: { name: true } } } },
      },
    });
    if (!entry.customer) return;
    const { channel, recipient } = resolveChannel(entry.customer, entry.contactEmail);

    await tx.queueEntry.update({
      where: { id: entryId },
      data: {
        calledNotifiedAt: new Date(),
        // Suppress any still-pending lower-tier notification (G-31) — once
        // called, a stale "approaching"/"nearly next" text would only confuse.
        approachingNotifiedAt: entry.approachingNotifiedAt ?? new Date(),
        nearlyNextNotifiedAt: entry.nearlyNextNotifiedAt ?? new Date(),
      },
    });
    await this.notifications.enqueue(tx, {
      tenantId: entry.tenantId,
      queueEntryId: entry.id,
      type: "CALLED",
      channel,
      recipient,
      body: buildCalledMessage({
        businessName: entry.queue.tenant.name,
        ticketNumber: entry.ticketNumber,
      }),
    });
  }

  /** Called from recall — an explicit staff-triggered resend, never gated by calledNotifiedAt (see recall()'s own comment). */
  private async enqueueRecalledNotification(
    tx: Prisma.TransactionClient,
    entryId: string,
  ): Promise<void> {
    const entry = await tx.queueEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        customer: { select: { phoneE164: true, email: true } },
        queue: { include: { tenant: { select: { name: true } } } },
      },
    });
    if (!entry.customer) return;
    const { channel, recipient } = resolveChannel(entry.customer, entry.contactEmail);

    await this.notifications.enqueue(tx, {
      tenantId: entry.tenantId,
      queueEntryId: entry.id,
      type: "RECALLED",
      channel,
      recipient,
      body: buildRecalledMessage({
        businessName: entry.queue.tenant.name,
        ticketNumber: entry.ticketNumber,
      }),
    });
  }

  /**
   * Fire-and-forget (ADR-008/G-31) — never awaited by the mutation that
   * triggered it, so a slow or down notification provider can never block
   * or fail a queue operation. Re-drains the whole PENDING backlog rather
   * than just this mutation's own new rows; harmless (each row is claimed
   * atomically) and simpler than tracking which rows are "new."
   */
  private triggerNotificationProcessing(): void {
    void this.notifications
      .processPending()
      .catch((err) => this.logger.error("Failed to process notification outbox", err));
  }

  private async findOwnedEntry(tenantId: string, entryId: string): Promise<EntryRow> {
    const entry = await this.prisma.queueEntry.findFirst({ where: { id: entryId, tenantId } });
    if (!entry) {
      throw new NotFoundException({
        code: "QUEUE_ENTRY_NOT_FOUND",
        message: "Queue entry not found.",
      });
    }
    return entry;
  }

  private async findOwnedStaffEntry(tenantId: string, entryId: string): Promise<StaffEntryRow> {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id: entryId, tenantId },
      include: {
        customer: { select: { firstName: true, phoneE164: true } },
        assignedStaff: { include: { user: { select: { displayName: true } } } },
        servedByStaff: { include: { user: { select: { displayName: true } } } },
        preferredStaff: { include: { user: { select: { displayName: true } } } },
        guestCard: { select: { guestNumber: true } },
        appointment: { select: { startsAt: true } },
      },
    });
    if (!entry) {
      throw new NotFoundException({
        code: "QUEUE_ENTRY_NOT_FOUND",
        message: "Queue entry not found.",
      });
    }
    return entry;
  }

  private async servingCapacityFor(queueId: string): Promise<number> {
    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: queueId } });
    return queue.servingCapacity;
  }

  /**
   * Position/estimated-wait computed on read, never stored (G-13), in the
   * shared queue order (compareQueueOrder, G-25). Loads the queue's WAITING
   * entries and counts who sorts ahead — the order depends on the current
   * time, so it can't be a simple "joined before me" query any more.
   */
  private async computePosition(
    entry: EntryRow,
    servingCapacity: number,
  ): Promise<{ position: number | null; estimatedWaitMinutes: number | null }> {
    if (entry.status !== "WAITING") {
      return { position: null, estimatedWaitMinutes: null };
    }
    const waiting = await this.prisma.queueEntry.findMany({
      where: { queueId: entry.queueId, status: "WAITING" },
      include: { service: { select: { durationMinutes: true } } },
    });
    return this.computePositionSync(entry, waiting, servingCapacity, new Date());
  }

  /** Same formula as computePosition, but against an already-fetched batch (used by `list` to avoid N+1 queries). */
  private computePositionSync(
    entry: EntryRow,
    allEntries: (EntryRow & { service: { durationMinutes: number } })[],
    servingCapacity: number,
    now: Date,
  ): { position: number | null; estimatedWaitMinutes: number | null } {
    if (entry.status !== "WAITING") {
      return { position: null, estimatedWaitMinutes: null };
    }
    // Phase 18: only the customer's own line counts (competesWith) — and
    // someone waiting for one particular person is served by just them.
    const ahead = allEntries.filter(
      (row) =>
        row.status === "WAITING" &&
        row.id !== entry.id &&
        competesWith(row, entry) &&
        compareQueueOrder(row, entry, now) < 0,
    );
    const totalDuration = ahead.reduce((sum, row) => sum + row.service.durationMinutes, 0);
    const servers = entry.preferredStaffId ? 1 : Math.max(1, servingCapacity);
    return {
      position: ahead.length + 1,
      estimatedWaitMinutes: Math.ceil(totalDuration / servers),
    };
  }

  private toSummary(
    entry: EntryRow,
    positionInfo: { position: number | null; estimatedWaitMinutes: number | null },
  ): QueueEntrySummary {
    return {
      id: entry.id,
      queueId: entry.queueId,
      serviceId: entry.serviceId,
      ticketNumber: entry.ticketNumber,
      status: entry.status,
      position: positionInfo.position,
      estimatedWaitMinutes: positionInfo.estimatedWaitMinutes,
      recallCount: entry.recallCount,
      joinedAt: entry.joinedAt.toISOString(),
      calledAt: entry.calledAt?.toISOString() ?? null,
      startedAt: entry.startedAt?.toISOString() ?? null,
      completedAt: entry.completedAt?.toISOString() ?? null,
      cancelledAt: entry.cancelledAt?.toISOString() ?? null,
    };
  }

  private toStaffSummary(
    entry: StaffEntryRow,
    positionInfo: { position: number | null; estimatedWaitMinutes: number | null },
  ): StaffQueueEntrySummary {
    return {
      ...this.toSummary(entry, positionInfo),
      customerName:
        entry.customer?.firstName ??
        (entry.guestCard ? `Guest ${entry.guestCard.guestNumber}` : "Walk-in"),
      customerPhone: entry.customer?.phoneE164 ?? "",
      assignedStaffId: entry.assignedStaff?.id ?? null,
      assignedStaffName: entry.assignedStaff?.user.displayName ?? null,
      servedByStaffId: entry.servedByStaff?.id ?? null,
      servedByStaffName: entry.servedByStaff?.user.displayName ?? null,
      preferredStaffId: entry.preferredStaff?.id ?? null,
      preferredStaffName: entry.preferredStaff ? staffPublicName(entry.preferredStaff) : null,
      guestCardNumber: entry.guestCard?.guestNumber ?? null,
      appointmentStartsAt: entry.appointment?.startsAt.toISOString() ?? null,
      priorityActive: isPriorityActive(entry, new Date()),
    };
  }

  private toJoinResponse(
    entry: EntryRow,
    positionInfo: { position: number | null; estimatedWaitMinutes: number | null },
  ): JoinQueueResponse {
    return { ...this.toSummary(entry, positionInfo), publicToken: entry.publicToken };
  }
}
