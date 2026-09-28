import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { QueueSummary } from "@queueflow/types";
import type {
  AttachServiceInput,
  CreateQueueInput,
  UpdateQueueConfigInput,
  UpdateQueueStatusInput,
} from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { QueueEventsService } from "../queue-events/queue-events.service";

@Injectable()
export class QueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
    private readonly queueEvents: QueueEventsService,
  ) {}

  async create(tenantId: string, input: CreateQueueInput): Promise<QueueSummary> {
    await this.locationsService.get(tenantId, input.locationId); // 404s for another tenant's location

    const queue = await this.prisma.queue.create({
      data: {
        tenantId,
        locationId: input.locationId,
        name: input.name,
        servingCapacity: input.servingCapacity ?? 1,
        maxActiveTicketsPerCustomer: input.maxActiveTicketsPerCustomer ?? 1,
        maxRecallCount: input.maxRecallCount ?? 2,
        recallGracePeriodMinutes: input.recallGracePeriodMinutes ?? 5,
        approachingThreshold: input.approachingThreshold ?? 5,
        nearlyNextThreshold: input.nearlyNextThreshold ?? 2,
      },
    });
    return toQueueSummary(queue);
  }

  async list(tenantId: string, locationId?: string): Promise<QueueSummary[]> {
    const queues = await this.prisma.queue.findMany({
      where: { tenantId, ...(locationId && { locationId }) },
      orderBy: { createdAt: "asc" },
    });
    return queues.map(toQueueSummary);
  }

  async get(tenantId: string, queueId: string): Promise<QueueSummary> {
    const queue = await this.findOwnedQueue(tenantId, queueId);
    return toQueueSummary(queue);
  }

  async updateConfig(
    tenantId: string,
    queueId: string,
    input: UpdateQueueConfigInput,
  ): Promise<QueueSummary> {
    await this.findOwnedQueue(tenantId, queueId);
    const queue = await this.prisma.queue.update({
      where: { id: queueId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.servingCapacity !== undefined && { servingCapacity: input.servingCapacity }),
        ...(input.maxActiveTicketsPerCustomer !== undefined && {
          maxActiveTicketsPerCustomer: input.maxActiveTicketsPerCustomer,
        }),
        ...(input.maxRecallCount !== undefined && { maxRecallCount: input.maxRecallCount }),
        ...(input.recallGracePeriodMinutes !== undefined && {
          recallGracePeriodMinutes: input.recallGracePeriodMinutes,
        }),
        ...(input.approachingThreshold !== undefined && {
          approachingThreshold: input.approachingThreshold,
        }),
        ...(input.nearlyNextThreshold !== undefined && {
          nearlyNextThreshold: input.nearlyNextThreshold,
        }),
      },
    });
    return toQueueSummary(queue);
  }

  /**
   * Staff-controlled queue open/pause/close (G-16). Closing (not pausing)
   * cascade-cancels every still-WAITING entry in the same transaction —
   * pausing only blocks new joins and leaves existing waiting customers
   * alone (plan §72: "existing customers remain visible").
   */
  async updateStatus(
    tenantId: string,
    queueId: string,
    input: UpdateQueueStatusInput,
  ): Promise<QueueSummary> {
    await this.findOwnedQueue(tenantId, queueId);

    const [queue] = await this.prisma.$transaction([
      this.prisma.queue.update({ where: { id: queueId }, data: { status: input.status } }),
      ...(input.status === "CLOSED"
        ? [
            this.prisma.queueEntry.updateMany({
              where: { queueId, status: "WAITING" },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            }),
          ]
        : []),
    ]);
    // Status changes (and CLOSED's mass-cancellation) affect every SSE
    // watcher on this queue — the customer ticket page and the public
    // display alike — so this needs the same signal any other mutation
    // gives them, even though it doesn't go through queue-entries'
    // transition() helper.
    this.queueEvents.emitQueueChanged(queueId);
    return toQueueSummary(queue);
  }

  /** A queue can only accept a service that actually belongs to the same location (not just the same tenant). */
  async attachService(tenantId: string, queueId: string, input: AttachServiceInput): Promise<void> {
    const queue = await this.findOwnedQueue(tenantId, queueId);
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, tenantId },
    });
    if (!service) {
      throw new NotFoundException({ code: "SERVICE_NOT_FOUND", message: "Service not found." });
    }
    if (service.locationId !== queue.locationId) {
      throw new ConflictException({
        code: "SERVICE_LOCATION_MISMATCH",
        message: "This service belongs to a different location than the queue.",
      });
    }

    await this.prisma.queueService.upsert({
      where: { queueId_serviceId: { queueId, serviceId: input.serviceId } },
      create: { queueId, serviceId: input.serviceId },
      update: {},
    });
  }

  async listServiceIds(tenantId: string, queueId: string): Promise<string[]> {
    await this.findOwnedQueue(tenantId, queueId);
    const rows = await this.prisma.queueService.findMany({
      where: { queueId },
      select: { serviceId: true },
    });
    return rows.map((row) => row.serviceId);
  }

  /**
   * What a customer could actually join right now — same filter
   * CodesService.resolve() applies to the public landing page, exposed
   * here too so the staff walk-in form offers exactly the same choices
   * rather than the tenant's whole service catalog (including inactive or
   * appointment-only services).
   */
  async listJoinableServices(
    tenantId: string,
    queueId: string,
  ): Promise<Array<{ id: string; name: string; durationMinutes: number }>> {
    await this.findOwnedQueue(tenantId, queueId);
    const rows = await this.prisma.queueService.findMany({
      where: { queueId },
      include: { service: true },
    });
    return rows
      .map((row) => row.service)
      .filter((service) => service.active && service.queueEnabled)
      .map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
      }));
  }

  /** Exposed for QueueEntriesService — same ownership-checked lookup, avoids a second, divergent query there. */
  async findOwnedQueue(tenantId: string, queueId: string) {
    const queue = await this.prisma.queue.findFirst({ where: { id: queueId, tenantId } });
    if (!queue) {
      throw new NotFoundException({ code: "QUEUE_NOT_FOUND", message: "Queue not found." });
    }
    return queue;
  }
}

function toQueueSummary(queue: {
  id: string;
  locationId: string;
  name: string;
  status: QueueSummary["status"];
  servingCapacity: number;
  maxActiveTicketsPerCustomer: number;
  maxRecallCount: number;
  recallGracePeriodMinutes: number;
  approachingThreshold: number;
  nearlyNextThreshold: number;
}): QueueSummary {
  return {
    id: queue.id,
    locationId: queue.locationId,
    name: queue.name,
    status: queue.status,
    servingCapacity: queue.servingCapacity,
    maxActiveTicketsPerCustomer: queue.maxActiveTicketsPerCustomer,
    maxRecallCount: queue.maxRecallCount,
    recallGracePeriodMinutes: queue.recallGracePeriodMinutes,
    approachingThreshold: queue.approachingThreshold,
    nearlyNextThreshold: queue.nearlyNextThreshold,
  };
}
