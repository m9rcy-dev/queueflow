import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { InviteSummary, TenantSummary } from "@queueflow/types";
import type { CreateInviteInput, UpdateCapabilitiesInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";

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
    });
    return toTenantSummary(tenant);
  }

  async createInvite(tenantId: string, input: CreateInviteInput): Promise<InviteSummary> {
    const tenant = await this.findOwnedTenant(tenantId);

    const existingMembership = await this.prisma.tenantUser.findFirst({
      where: { tenantId, user: { email: input.email } },
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

    const invite = await this.prisma.tenantInvite.create({
      data: {
        tenantId,
        email: input.email,
        role: input.role,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.mailService.sendInviteLink(invite.email, tenant.name, invite.token);

    return toInviteSummary(invite);
  }

  async listInvites(tenantId: string): Promise<InviteSummary[]> {
    await this.findOwnedTenant(tenantId);
    const invites = await this.prisma.tenantInvite.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return invites.map(toInviteSummary);
  }

  async revokeInvite(tenantId: string, inviteId: string): Promise<void> {
    await this.findOwnedTenant(tenantId);
    const invite = await this.prisma.tenantInvite.findFirst({ where: { id: inviteId, tenantId } });
    if (!invite) {
      throw new NotFoundException({ code: "INVITE_NOT_FOUND", message: "Invite not found." });
    }
    await this.prisma.tenantInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Ownership-in-the-query pattern (AGENTS.md §2): every lookup here is
   * scoped by tenantId directly, so a request for another tenant's data is
   * indistinguishable from a request for a nonexistent tenant.
   */
  private async findOwnedTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
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
}): TenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    ownerName: tenant.ownerName,
    queueEnabled: tenant.queueEnabled,
    appointmentEnabled: tenant.appointmentEnabled,
  };
}

function toInviteSummary(invite: {
  id: string;
  email: string;
  role: InviteSummary["role"];
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): InviteSummary {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  };
}
