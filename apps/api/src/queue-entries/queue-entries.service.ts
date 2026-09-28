import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  JoinQueueResponse,
  QueueEntryStatus,
  QueueEntrySummary,
  StaffQueueEntrySummary,
} from "@queueflow/types";
import type { JoinQueueInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { normalizePhoneToE164 } from "../common/phone.util";
import { getLocationServiceDate } from "../common/timezone.util";
import { generateSecurePublicToken } from "../common/secure-token.util";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesService: QueuesService,
    private readonly queueEvents: QueueEventsService,
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

    const entry = await this.prisma.queueEntry.create({
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

    // A new WAITING entry doesn't shift anyone else's position, but every
    // mutation emits unconditionally rather than trying to be clever about
    // which ones could matter to existing watchers — simplicity over a
    // micro-optimization.
    this.queueEvents.emitQueueChanged(queueId);

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
      return tx.queueEntry.update({
        where: { id: rows[0].id },
        data: {
          status: "CALLED",
          calledAt: new Date(),
          assignedStaffId: staffTenantUserId,
          version: { increment: 1 },
        },
      });
    });

    if (!updated) {
      throw new NotFoundException({ code: "QUEUE_EMPTY", message: "No one is waiting." });
    }
    this.queueEvents.emitQueueChanged(queueId);
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
    await this.prisma.queueEntry.update({
      where: { id: entryId },
      data: { recallCount: { increment: 1 } },
    });
    // Doesn't change status or anyone else's position, but the entry's own
    // watcher (if any) should still see the updated recallCount live.
    this.queueEvents.emitQueueChanged(entry.queueId);
    return this.getByIdForTenant(tenantId, entryId);
  }

  private async transition(
    tenantId: string,
    entryId: string,
    fromStatuses: QueueEntryStatus[],
    data: Record<string, unknown>,
  ): Promise<QueueEntrySummary> {
    const result = await this.prisma.queueEntry.updateMany({
      where: { id: entryId, tenantId, status: { in: fromStatuses } },
      data: { ...data, version: { increment: 1 } },
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
    return summary;
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
