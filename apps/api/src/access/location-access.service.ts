import { Injectable, NotFoundException } from "@nestjs/common";
import type { TenantRole } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";

/** Roles that work at exactly one location (ADR-015); everyone else sees the whole business. */
export const LOCATION_BOUND_ROLES: TenantRole[] = ["MANAGER", "STAFF"];

export interface LocationScopedUser {
  tenantId: string;
  role: TenantRole;
  locationId: string | null;
}

/**
 * Location-level access (Phase 16, ADR-015), layered on top of tenant
 * isolation: a MANAGER/STAFF member can only reach their own location's
 * data. Called by controllers before the service does any work, so the
 * business logic is unchanged. Owner/admin calls return immediately
 * without a query.
 *
 * Every refusal is exactly the 404 a nonexistent resource gets — another
 * location's queue is indistinguishable from no queue at all, exactly
 * like another tenant's (ADR-003). A bound role with no location assigned
 * yet can reach nothing.
 */
@Injectable()
export class LocationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isBound(user: LocationScopedUser): boolean {
    return LOCATION_BOUND_ROLES.includes(user.role);
  }

  /**
   * For list queries: the location a bound user is limited to, or
   * `undefined` for "no restriction". A bound user with no location gets
   * an id that matches nothing, so lists come back empty rather than full.
   */
  locationFilter(user: LocationScopedUser): string | undefined {
    if (!this.isBound(user)) return undefined;
    return user.locationId ?? NO_LOCATION;
  }

  /**
   * The location filter for a list endpoint that also takes an optional
   * `?locationId=`: unbound users get exactly what they asked for; bound
   * users get their own location, and asking for any other one matches
   * nothing (an empty list, not an error — same as an empty location).
   */
  listLocation(user: LocationScopedUser, requested?: string): string | undefined {
    const own = this.locationFilter(user);
    if (own === undefined) return requested;
    return requested === undefined || requested === own ? own : NO_LOCATION;
  }

  assertLocation(
    user: LocationScopedUser,
    locationId: string,
    refusal: NotFoundBody = LOCATION_NOT_FOUND,
  ): void {
    if (this.isBound(user) && user.locationId !== locationId) {
      throw new NotFoundException(refusal);
    }
  }

  async assertQueue(user: LocationScopedUser, queueId: string): Promise<void> {
    if (!this.isBound(user)) return;
    const queue = await this.prisma.queue.findFirst({
      where: { id: queueId, tenantId: user.tenantId },
      select: { locationId: true },
    });
    if (!queue) return; // let the service produce its own normal 404
    this.assertLocation(user, queue.locationId, QUEUE_NOT_FOUND);
  }

  async assertQueueEntry(user: LocationScopedUser, entryId: string): Promise<void> {
    if (!this.isBound(user)) return;
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id: entryId, tenantId: user.tenantId },
      select: { queue: { select: { locationId: true } } },
    });
    if (!entry) return;
    this.assertLocation(user, entry.queue.locationId, QUEUE_ENTRY_NOT_FOUND);
  }

  async assertService(user: LocationScopedUser, serviceId: string): Promise<void> {
    if (!this.isBound(user)) return;
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, tenantId: user.tenantId },
      select: { locationId: true },
    });
    if (!service) return;
    this.assertLocation(user, service.locationId, SERVICE_NOT_FOUND);
  }

  async assertAppointment(user: LocationScopedUser, appointmentId: string): Promise<void> {
    if (!this.isBound(user)) return;
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId: user.tenantId },
      select: { locationId: true },
    });
    if (!appointment) return;
    this.assertLocation(user, appointment.locationId, APPOINTMENT_NOT_FOUND);
  }
}

type NotFoundBody = { code: string; message: string };

/** Matches no real (uuid) location id, so a filtered query returns nothing. */
const NO_LOCATION = "__no_location__";

// Each refusal is byte-for-byte the response that resource's own lookup
// gives when it doesn't exist, so the two can't be told apart.
const LOCATION_NOT_FOUND = { code: "LOCATION_NOT_FOUND", message: "Location not found." };
const QUEUE_NOT_FOUND = { code: "QUEUE_NOT_FOUND", message: "Queue not found." };
const QUEUE_ENTRY_NOT_FOUND = { code: "QUEUE_ENTRY_NOT_FOUND", message: "Queue entry not found." };
const SERVICE_NOT_FOUND = { code: "SERVICE_NOT_FOUND", message: "Service not found." };
const APPOINTMENT_NOT_FOUND = { code: "APPOINTMENT_NOT_FOUND", message: "Appointment not found." };
