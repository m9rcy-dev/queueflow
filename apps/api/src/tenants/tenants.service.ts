import { randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { InviteSummary, TenantMemberSummary, TenantSummary } from "@queueflow/types";
import type {
  CreateInviteInput,
  UpdateCapabilitiesInput,
  UpdateMemberInput,
} from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { tenantLogoPath } from "./tenant-logo.service";

const INVITE_TTL_DAYS = 7;

/**
 * Tenant profile and staff-invite management (G-02). Every method here is
 * scoped to one tenantId, supplied by the caller (the controller reads it
 * off the authenticated request) — never trust a tenant ID from the body.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async getTenant(tenantId: string): Promise<TenantSummary> {
    const tenant = await this.findOwnedTenant(tenantId);
    return toTenantSummary(tenant);
  }

  async updateCapabilities(
    tenantId: string,
    input: UpdateCapabilitiesInput,
  ): Promise<TenantSummary> {
    await this.findOwnedTenant(tenantId);
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.queueEnabled !== undefined && { queueEnabled: input.queueEnabled }),
        ...(input.appointmentEnabled !== undefined && {
          appointmentEnabled: input.appointmentEnabled,
        }),
      },
      include: { logo: { select: { updatedAt: true } } },
    });
    return toTenantSummary(tenant);
  }

  /** Current staff roster, with each Manager/Staff member's location (ADR-015). Removed members aren't listed. */
  async listMembers(tenantId: string, onlyLocationId?: string): Promise<TenantMemberSummary[]> {
    await this.findOwnedTenant(tenantId);
    const memberships = await this.prisma.tenantUser.findMany({
      where: { tenantId, removedAt: null, ...(onlyLocationId && { locationId: onlyLocationId }) },
      include: {
        user: { select: { displayName: true, email: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map(toMemberSummary);
  }

  /**
   * Change a member's role and/or location (Phase 16). Refused for the
   * owner (there's exactly one, the person who signed up) and for the
   * caller themselves (no locking yourself out by accident). The location
   * must be this tenant's own.
   */
  async updateMember(
    tenantId: string,
    actorTenantUserId: string,
    tenantUserId: string,
    input: UpdateMemberInput,
  ): Promise<TenantMemberSummary> {
    const member = await this.findChangeableMember(tenantId, actorTenantUserId, tenantUserId);
    const locationId = input.role === "TENANT_ADMIN" ? null : (input.locationId ?? null);
    if (locationId) await this.assertOwnLocation(tenantId, locationId);
    const updated = await this.prisma.tenantUser.update({
      where: { id: member.id },
      data: { role: input.role, locationId },
      include: {
        user: { select: { displayName: true, email: true } },
        location: { select: { id: true, name: true } },
      },
    });
    return toMemberSummary(updated);
  }

  /**
   * Remove a member (Phase 16) — soft: `removedAt` is set and their
   * sessions are revoked, so they're locked out immediately (the JWT
   * strategy re-reads the membership on every request), while queue
   * history they're attributed to keeps their name (D-03a). Re-inviting
   * the same email reactivates the membership.
   */
  async removeMember(tenantId: string, actor: TeamActor, tenantUserId: string): Promise<void> {
    const member = await this.findChangeableMember(tenantId, actor.tenantUserId, tenantUserId);
    assertManagerMayManage(actor, member);
    await this.prisma.$transaction([
      this.prisma.tenantUser.update({
        where: { id: member.id },
        data: { removedAt: new Date(), pinHash: null },
      }),
      this.prisma.refreshToken.updateMany({
        where: { tenantId, userId: member.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /**
   * A manager (Phase 17, ADR-016) may only invite STAFF, and only to their
   * own location — anything else is refused before an invite exists.
   */
  async createInvite(
    tenantId: string,
    input: CreateInviteInput,
    actor: TeamActor,
  ): Promise<InviteSummary> {
    if (actor.role === "MANAGER") {
      if (input.role !== "STAFF") {
        throw new ForbiddenException({
          code: "MANAGER_CAN_ONLY_INVITE_STAFF",
          message: "Managers can invite staff only. Ask the owner or an admin for other roles.",
        });
      }
      if (input.locationId !== actor.locationId) {
        throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
      }
    }
    const tenant = await this.findOwnedTenant(tenantId);

    const existingMembership = await this.prisma.tenantUser.findFirst({
      where: { tenantId, removedAt: null, user: { email: input.email } },
    });
    if (existingMembership) {
      throw new ConflictException({
        code: "ALREADY_A_MEMBER",
        message: "This email already has access to this business.",
      });
    }

    // Revoke any still-pending invite for this email first — one active
    // invite per email per tenant (revoke-and-re-invite, per acceptance
    // criteria).
    await this.prisma.tenantInvite.updateMany({
      where: { tenantId, email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const locationId = input.role === "TENANT_ADMIN" ? null : (input.locationId ?? null);
    if (locationId) await this.assertOwnLocation(tenantId, locationId);

    const invite = await this.prisma.tenantInvite.create({
      data: {
        tenantId,
        email: input.email,
        role: input.role,
        locationId,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      include: { location: { select: { id: true, name: true } } },
    });

    await this.mailService.sendInviteLink(invite.email, tenant.name, invite.token);

    return toInviteSummary(invite);
  }

  async listInvites(tenantId: string, onlyLocationId?: string): Promise<InviteSummary[]> {
    await this.findOwnedTenant(tenantId);
    const invites = await this.prisma.tenantInvite.findMany({
      where: { tenantId, ...(onlyLocationId && { locationId: onlyLocationId }) },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return invites.map(toInviteSummary);
  }

  async revokeInvite(tenantId: string, inviteId: string, actor: TeamActor): Promise<void> {
    await this.findOwnedTenant(tenantId);
    const invite = await this.prisma.tenantInvite.findFirst({ where: { id: inviteId, tenantId } });
    // A manager only sees their own location's invites, so anything else is "not found".
    if (!invite || (actor.role === "MANAGER" && invite.locationId !== actor.locationId)) {
      throw new NotFoundException({ code: "INVITE_NOT_FOUND", message: "Invite not found." });
    }
    await this.prisma.tenantInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  private async findChangeableMember(
    tenantId: string,
    actorTenantUserId: string,
    tenantUserId: string,
  ) {
    const member = await this.prisma.tenantUser.findFirst({
      where: { id: tenantUserId, tenantId, removedAt: null },
    });
    if (!member) {
      throw new NotFoundException({ code: "MEMBER_NOT_FOUND", message: "Staff member not found." });
    }
    if (member.role === "TENANT_OWNER") {
      throw new ForbiddenException({
        code: "OWNER_NOT_CHANGEABLE",
        message: "The business owner's access can't be changed.",
      });
    }
    if (member.id === actorTenantUserId) {
      throw new ForbiddenException({
        code: "CANNOT_CHANGE_SELF",
        message: "You can't change your own access. Ask another admin or the owner.",
      });
    }
    return member;
  }

  /** 404 (not 400) for another tenant's location — same as every cross-resource reference (ADR-003). */
  private async assertOwnLocation(tenantId: string, locationId: string): Promise<void> {
    const location = await this.prisma.location.findFirst({ where: { id: locationId, tenantId } });
    if (!location) {
      throw new NotFoundException({ code: "LOCATION_NOT_FOUND", message: "Location not found." });
    }
  }

  /**
   * Ownership-in-the-query pattern (AGENTS.md §2): every lookup here is
   * scoped by tenantId directly, so a request for another tenant's data is
   * indistinguishable from a request for a nonexistent tenant.
   */
  private async findOwnedTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { logo: { select: { updatedAt: true } } },
    });
    if (!tenant) {
      throw new NotFoundException({ code: "TENANT_NOT_FOUND", message: "Tenant not found." });
    }
    return tenant;
  }
}

function toTenantSummary(tenant: {
  id: string;
  name: string;
  ownerName: string;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  logo: { updatedAt: Date } | null;
}): TenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    ownerName: tenant.ownerName,
    queueEnabled: tenant.queueEnabled,
    appointmentEnabled: tenant.appointmentEnabled,
    logoPath: tenantLogoPath(tenant.id, tenant.logo),
  };
}

/** Who's acting on the team (the signed-in member). */
export interface TeamActor {
  tenantUserId: string;
  role: TenantMemberSummary["role"];
  locationId: string | null;
}

/**
 * Managers (Phase 17, ADR-016) may remove STAFF at their own location only.
 * Another location's member is "not found" (they can't see them);
 * a fellow manager is forbidden.
 */
function assertManagerMayManage(
  actor: TeamActor,
  member: { role: string; locationId: string | null },
): void {
  if (actor.role !== "MANAGER") return;
  if (member.locationId !== actor.locationId) {
    throw new NotFoundException({ code: "MEMBER_NOT_FOUND", message: "Staff member not found." });
  }
  if (member.role !== "STAFF") {
    throw new ForbiddenException({
      code: "MANAGER_CAN_ONLY_MANAGE_STAFF",
      message: "Managers can remove staff only. Ask the owner or an admin.",
    });
  }
}

function toMemberSummary(m: {
  id: string;
  role: TenantMemberSummary["role"];
  user: { displayName: string; email: string };
  location: { id: string; name: string } | null;
}): TenantMemberSummary {
  return {
    tenantUserId: m.id,
    displayName: m.user.displayName,
    email: m.user.email,
    role: m.role,
    location: m.location,
  };
}

function toInviteSummary(invite: {
  id: string;
  email: string;
  role: InviteSummary["role"];
  location: { id: string; name: string } | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): InviteSummary {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    location: invite.location,
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  };
}
