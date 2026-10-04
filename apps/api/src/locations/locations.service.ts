import { Injectable, NotFoundException } from "@nestjs/common";
import type { BusinessHoursEntry, LocationSummary, TeamMemberOption } from "@queueflow/types";
import type {
  CreateLocationInput,
  ReplaceBusinessHoursInput,
  UpdateLocationInput,
} from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Ownership-in-the-query throughout (AGENTS.md §2): every lookup is scoped
 * by tenantId directly in the where clause, never fetch-then-check — a
 * request for another tenant's location is indistinguishable from a
 * request for a nonexistent one (same pattern as TenantsService).
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, input: CreateLocationInput): Promise<LocationSummary> {
    const location = await this.prisma.location.create({
      data: {
        tenantId,
        name: input.name,
        address: input.address ?? null,
        timezone: input.timezone,
      },
    });
    return toLocationSummary(location);
  }

  /** `onlyLocationId` narrows to one location (a location-bound staff member, ADR-015). */
  async list(tenantId: string, onlyLocationId?: string): Promise<LocationSummary[]> {
    const locations = await this.prisma.location.findMany({
      where: { tenantId, ...(onlyLocationId && { id: onlyLocationId }) },
      orderBy: { createdAt: "asc" },
    });
    return locations.map(toLocationSummary);
  }

  async get(tenantId: string, locationId: string): Promise<LocationSummary> {
    const location = await this.findOwnedLocation(tenantId, locationId);
    return toLocationSummary(location);
  }

  async update(
    tenantId: string,
    locationId: string,
    input: UpdateLocationInput,
  ): Promise<LocationSummary> {
    await this.findOwnedLocation(tenantId, locationId);
    const location = await this.prisma.location.update({
      where: { id: locationId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.appointmentCapacity !== undefined && {
          appointmentCapacity: input.appointmentCapacity,
        }),
        ...(input.maxAppointmentsPerDay !== undefined && {
          maxAppointmentsPerDay: input.maxAppointmentsPerDay,
        }),
      },
    });
    return toLocationSummary(location);
  }

  async getBusinessHours(tenantId: string, locationId: string): Promise<BusinessHoursEntry[]> {
    await this.findOwnedLocation(tenantId, locationId);
    const rows = await this.prisma.businessHours.findMany({
      where: { locationId },
      orderBy: [{ dayOfWeek: "asc" }, { opensAtMinutes: "asc" }],
    });
    return rows.map(toBusinessHoursEntry);
  }

  /**
   * Full-replace, not a merge (same semantics as budget-terry's Budget
   * update) — the whole week is sent each time, so "remove Tuesday's
   * second split period" is just "send the new full list without it."
   */
  async replaceBusinessHours(
    tenantId: string,
    locationId: string,
    input: ReplaceBusinessHoursInput,
  ): Promise<BusinessHoursEntry[]> {
    await this.findOwnedLocation(tenantId, locationId);
    await this.prisma.$transaction([
      this.prisma.businessHours.deleteMany({ where: { locationId } }),
      this.prisma.businessHours.createMany({
        data: input.entries.map((entry) => ({ locationId, ...entry })),
      }),
    ]);
    return this.getBusinessHours(tenantId, locationId);
  }

  /** Who can serve at this location (Phase 17 hand-over picker): its own staff plus owner/admins, active members only. */
  async listTeam(tenantId: string, locationId: string): Promise<TeamMemberOption[]> {
    await this.findOwnedLocation(tenantId, locationId);
    const members = await this.prisma.tenantUser.findMany({
      where: {
        tenantId,
        removedAt: null,
        OR: [{ locationId }, { role: { in: ["TENANT_OWNER", "TENANT_ADMIN"] } }],
      },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({
      tenantUserId: m.id,
      displayName: m.user.displayName,
      role: m.role,
    }));
  }

  /** Public (like QueuesService.findOwnedQueue) so other services — GuestCardsService (Phase 10) — can ownership-check a locationId without duplicating this query. */
  async findOwnedLocation(tenantId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });
    if (!location) {
      throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
    }
    return location;
  }
}

function toLocationSummary(location: {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  appointmentCapacity: number;
  maxAppointmentsPerDay: number | null;
}): LocationSummary {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    timezone: location.timezone,
    appointmentCapacity: location.appointmentCapacity,
    maxAppointmentsPerDay: location.maxAppointmentsPerDay,
  };
}

function toBusinessHoursEntry(row: {
  dayOfWeek: number;
  opensAtMinutes: number;
  closesAtMinutes: number;
}): BusinessHoursEntry {
  return {
    dayOfWeek: row.dayOfWeek,
    opensAtMinutes: row.opensAtMinutes,
    closesAtMinutes: row.closesAtMinutes,
  };
}
