import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PlatformTenantDetail, PlatformTenantSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { tenantLogoPath } from "../tenants/tenant-logo.service";

const DAY_MS = 24 * 60 * 60 * 1000;

const SUMMARY_INCLUDE = {
  logo: { select: { updatedAt: true } },
  memberships: {
    where: { removedAt: null },
    select: { role: true, user: { select: { email: true } } },
  },
  _count: { select: { locations: true, services: true } },
} satisfies Prisma.TenantInclude;

type TenantWithSummary = Prisma.TenantGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

/**
 * Read-only platform view (Phase 19, ADR-018): every business, which
 * capabilities it has on, and a few counts. Deliberately no customer
 * names/phones and no queue contents — operators don't need them.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants(): Promise<PlatformTenantSummary[]> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [tenants, tickets, appointments] = await Promise.all([
      this.prisma.tenant.findMany({ include: SUMMARY_INCLUDE, orderBy: { createdAt: "desc" } }),
      this.prisma.queueEntry.groupBy({
        by: ["tenantId"],
        where: { joinedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const ticketCounts = new Map(tickets.map((row) => [row.tenantId, row._count._all]));
    const appointmentCounts = new Map(appointments.map((row) => [row.tenantId, row._count._all]));
    return tenants.map((tenant) =>
      toSummary(tenant, ticketCounts.get(tenant.id) ?? 0, appointmentCounts.get(tenant.id) ?? 0),
    );
  }

  async getTenant(tenantId: string): Promise<PlatformTenantDetail> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        ...SUMMARY_INCLUDE,
        locations: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, timezone: true, _count: { select: { queues: true } } },
        },
        services: {
          orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            active: true,
            appointmentEnabled: true,
            location: { select: { name: true } },
          },
        },
      },
    });
    if (!tenant) {
      throw new NotFoundException({ code: "TENANT_NOT_FOUND", message: "Business not found." });
    }
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [tickets, appointments] = await Promise.all([
      this.prisma.queueEntry.count({ where: { tenantId, joinedAt: { gte: since } } }),
      this.prisma.appointment.count({ where: { tenantId, createdAt: { gte: since } } }),
    ]);
    const membersByRole: Record<string, number> = {};
    for (const member of tenant.memberships) {
      membersByRole[member.role] = (membersByRole[member.role] ?? 0) + 1;
    }
    return {
      ...toSummary(tenant, tickets, appointments),
      locations: tenant.locations.map((location) => ({
        id: location.id,
        name: location.name,
        timezone: location.timezone,
        queueCount: location._count.queues,
      })),
      services: tenant.services.map((service) => ({
        id: service.id,
        name: service.name,
        locationName: service.location.name,
        durationMinutes: service.durationMinutes,
        active: service.active,
        appointmentEnabled: service.appointmentEnabled,
      })),
      membersByRole,
    };
  }
}

function toSummary(
  tenant: TenantWithSummary,
  ticketsLast30Days: number,
  appointmentsLast30Days: number,
): PlatformTenantSummary {
  const owner = tenant.memberships.find((member) => member.role === "TENANT_OWNER");
  return {
    id: tenant.id,
    name: tenant.name,
    ownerName: tenant.ownerName,
    ownerEmail: owner?.user.email ?? null,
    logoPath: tenantLogoPath(tenant.id, tenant.logo),
    createdAt: tenant.createdAt.toISOString(),
    capabilities: { queue: tenant.queueEnabled, appointments: tenant.appointmentEnabled },
    locationCount: tenant._count.locations,
    serviceCount: tenant._count.services,
    memberCount: tenant.memberships.length,
    ticketsLast30Days,
    appointmentsLast30Days,
  };
}
