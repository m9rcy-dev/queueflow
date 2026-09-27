import { Injectable, NotFoundException } from "@nestjs/common";
import type { ServiceSummary } from "@queueflow/types";
import type { CreateServiceInput, UpdateServiceInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
  ) {}

  async create(tenantId: string, input: CreateServiceInput): Promise<ServiceSummary> {
    // Reuses LocationsService's ownership check — a service can only be
    // attached to a location that actually belongs to this tenant. 404s
    // (not 400) for someone else's locationId, same as every other
    // cross-resource reference in this codebase (TenantsService's invite
    // pattern, Phase 1).
    await this.locationsService.get(tenantId, input.locationId);

    const service = await this.prisma.service.create({
      data: {
        tenantId,
        locationId: input.locationId,
        name: input.name,
        description: input.description ?? null,
        durationMinutes: input.durationMinutes,
        queueEnabled: input.queueEnabled ?? true,
        appointmentEnabled: input.appointmentEnabled ?? false,
        displayOrder: input.displayOrder ?? 0,
      },
    });
    return toServiceSummary(service);
  }

  async list(tenantId: string, locationId?: string): Promise<ServiceSummary[]> {
    const services = await this.prisma.service.findMany({
      where: { tenantId, ...(locationId && { locationId }) },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return services.map(toServiceSummary);
  }

  async get(tenantId: string, serviceId: string): Promise<ServiceSummary> {
    const service = await this.findOwnedService(tenantId, serviceId);
    return toServiceSummary(service);
  }

  async update(
    tenantId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<ServiceSummary> {
    await this.findOwnedService(tenantId, serviceId);
    const service = await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
        ...(input.active !== undefined && { active: input.active }),
        ...(input.queueEnabled !== undefined && { queueEnabled: input.queueEnabled }),
        ...(input.appointmentEnabled !== undefined && {
          appointmentEnabled: input.appointmentEnabled,
        }),
        ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
      },
    });
    return toServiceSummary(service);
  }

  private async findOwnedService(tenantId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, tenantId } });
    if (!service) {
      throw new NotFoundException({ code: "SERVICE_NOT_FOUND", message: "Service not found." });
    }
    return service;
  }
}

function toServiceSummary(service: {
  id: string;
  locationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  active: boolean;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  displayOrder: number;
}): ServiceSummary {
  return {
    id: service.id,
    locationId: service.locationId,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    active: service.active,
    queueEnabled: service.queueEnabled,
    appointmentEnabled: service.appointmentEnabled,
    displayOrder: service.displayOrder,
  };
}
