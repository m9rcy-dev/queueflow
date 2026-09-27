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

@Injectable()
export class QueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
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
  };
}
