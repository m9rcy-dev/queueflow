import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type NotificationChannel, type NotificationType } from "@prisma/client";
import type {
  CustomerActiveEntry,
  JoinQueueResponse,
  QueueEntryStatus,
  QueueEntrySummary,
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
  buildNearlyNextMessage,
  buildRecalledMessage,
} from "../notifications/notification-copy";
import { normalizePhoneToE164 } from "../common/phone.util";
import { getLocationServiceDate } from "../common/timezone.util";
import { generateSecurePublicToken } from "../common/secure-token.util";

/** Email if the customer has one on file (not true for any join-flow customer today), SMS otherwise (G-32/ADR-008) — every anonymous walk-in resolves to SMS by construction. */
function resolveChannel(customer: { phoneE164: string; email: string | null }): {
  channel: NotificationChannel;
  recipient: string;
} {
  return customer.email
    ? { channel: "EMAIL", recipient: customer.email }
    : { channel: "SMS", recipient: customer.phoneE164 };
}

const ACTIVE_STATUSES: QueueEntryStatus[] = ["WAITING", "CALLED", "SERVING"];

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
};

type StaffEntryRow = EntryRow & {
  customer: { firstName: string | null; phoneE164: string } | null;
  assignedStaff: { id: string; user: { displayName: string } } | null;
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
        },
      });
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

  /** Staff-facing single-entry lookup — includes customer identity and the acting staff member (G-18), never exposed on the public/customer routes. */
  async getByIdForTenant(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    const entry = await this.findOwnedStaffEntry(tenantId, entryId);
    return this.toStaffSummary(
      entry,
      await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
    );
  }

  async getByPublicToken(publicToken: string): Promise<QueueEntrySummary> {
    const entry = await this.prisma.queueEntry.findUnique({ where: { publicToken } });
    if (!entry) {
      throw new NotFoundException({ code: "QUEUE_ENTRY_NOT_FOUND", message: "Ticket not found." });
    }
    return this.toSummary(
      entry,
      await this.computePosition(entry, await this.servingCapacityFor(entry.queueId)),
    );
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
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      include: {
        service: { select: { durationMinutes: true } },
        customer: { select: { firstName: true, phoneE164: true } },
        assignedStaff: { include: { user: { select: { displayName: true } } } },
      },
    });
    return entries.map((entry) =>
      this.toStaffSummary(entry, this.computePositionSync(entry, entries, queue.servingCapacity)),
    );
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
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM queue_entries
        WHERE "queueId" = ${queueId} AND status = 'WAITING'
        ORDER BY "joinedAt" ASC, id ASC
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
      throw new NotFoundException({ code: "QUEUE_EMPTY", message: "No one is waiting." });
    }
    this.queueEvents.emitQueueChanged(queueId);
    this.triggerNotificationProcessing();
    return this.getByIdForTenant(tenantId, updated.id);
  }

  async start(tenantId: string, entryId: string): Promise<StaffQueueEntrySummary> {
    await this.transition(tenantId, entryId, ["CALLED"], {
      status: "SERVING",
      startedAt: new Date(),
    });
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
    const waiting = await tx.queueEntry.findMany({
      where: { queueId, status: "WAITING" },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      include: { customer: { select: { phoneE164: true, email: true } } },
    });

    interface Candidate {
      id: string;
      type: NotificationType;
      channel: NotificationChannel;
      recipient: string;
      body: string;
      updateData: Prisma.QueueEntryUpdateInput;
    }
    const candidates: Candidate[] = [];

    for (let peopleAhead = 0; peopleAhead < waiting.length; peopleAhead += 1) {
      const entry = waiting[peopleAhead];
      if (!entry.customer) continue; // no contact details to notify — shouldn't happen via the join flow, but never crash on it

      const { channel, recipient } = resolveChannel(entry.customer);

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
    const { channel, recipient } = resolveChannel(entry.customer);

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
    const { channel, recipient } = resolveChannel(entry.customer);

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
   * Position/estimated-wait computed on read, never stored (G-13). Ties in
   * `joinedAt` (same millisecond) are broken by `id` for a fully
   * deterministic order.
   */
  private async computePosition(
    entry: EntryRow,
    servingCapacity: number,
  ): Promise<{ position: number | null; estimatedWaitMinutes: number | null }> {
    if (entry.status !== "WAITING") {
      return { position: null, estimatedWaitMinutes: null };
    }
    const ahead = await this.prisma.queueEntry.findMany({
      where: {
        queueId: entry.queueId,
        status: "WAITING",
        OR: [
          { joinedAt: { lt: entry.joinedAt } },
          { joinedAt: entry.joinedAt, id: { lt: entry.id } },
        ],
      },
      include: { service: { select: { durationMinutes: true } } },
    });
    const totalDuration = ahead.reduce((sum, row) => sum + row.service.durationMinutes, 0);
    return {
      position: ahead.length + 1,
      estimatedWaitMinutes: Math.ceil(totalDuration / Math.max(1, servingCapacity)),
    };
  }

  /** Same formula as computePosition, but against an already-fetched batch (used by `list` to avoid N+1 queries). */
  private computePositionSync(
    entry: EntryRow,
    allEntries: (EntryRow & { service: { durationMinutes: number } })[],
    servingCapacity: number,
  ): { position: number | null; estimatedWaitMinutes: number | null } {
    if (entry.status !== "WAITING") {
      return { position: null, estimatedWaitMinutes: null };
    }
    const ahead = allEntries.filter(
      (row) =>
        row.status === "WAITING" &&
        (row.joinedAt.getTime() < entry.joinedAt.getTime() ||
          (row.joinedAt.getTime() === entry.joinedAt.getTime() && row.id < entry.id)),
    );
    const totalDuration = ahead.reduce((sum, row) => sum + row.service.durationMinutes, 0);
    return {
      position: ahead.length + 1,
      estimatedWaitMinutes: Math.ceil(totalDuration / Math.max(1, servingCapacity)),
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
      customerName: entry.customer?.firstName ?? "Walk-in",
      customerPhone: entry.customer?.phoneE164 ?? "",
      assignedStaffId: entry.assignedStaff?.id ?? null,
      assignedStaffName: entry.assignedStaff?.user.displayName ?? null,
    };
  }

  private toJoinResponse(
    entry: EntryRow,
    positionInfo: { position: number | null; estimatedWaitMinutes: number | null },
  ): JoinQueueResponse {
    return { ...this.toSummary(entry, positionInfo), publicToken: entry.publicToken };
  }
}
