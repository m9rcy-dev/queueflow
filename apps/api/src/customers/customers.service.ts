import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CustomerActiveEntry,
  CustomerAuthenticatedUser,
  CustomerLocationOption,
  CustomerPortalSummary,
  StaffCreateCustomerResponse,
} from "@queueflow/types";
import type { CustomerSignupInput, StaffCreateCustomerInput } from "@queueflow/validation";
import { PrismaService } from "../prisma/prisma.service";
import { QueueEntriesService } from "../queue-entries/queue-entries.service";
import { CodesService } from "../codes/codes.service";
import { normalizePhoneToE164 } from "../common/phone.util";
import { tenantLogoPath } from "../tenants/tenant-logo.service";

/**
 * Customer accounts (Phase 9, D-09) — the account-holding half of the
 * customer domain (Customer rows also exist, without an account, for every
 * anonymous walk-in via the join flow; see queue-entries.service.ts's own
 * upsert). Shared by both onboarding paths: staff-initiated in-person
 * signup (G-56) and self-service via a GENERAL "sign up here" code (D-10),
 * which is why upsertCustomer lives here rather than duplicated in
 * CustomerAuthService.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codesService: CodesService,
    private readonly queueEntries: QueueEntriesService,
  ) {}

  /**
   * Where this customer can join or book (Phase 19), so the account works
   * without a poster in hand: every location of their business with a queue
   * that has a customer poster, and whether it takes bookings. Only what the
   * posters already show publicly.
   */
  async listLocations(tenantId: string): Promise<CustomerLocationOption[]> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { appointmentEnabled: true },
    });
    const locations = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        queues: {
          orderBy: { createdAt: "asc" },
          include: {
            codes: {
              where: { contextType: "QUEUE", active: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { publicCode: true },
            },
          },
        },
        services: {
          where: { active: true, appointmentEnabled: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    return locations
      .map((location) => {
        const queues = location.queues
          .filter((queue) => queue.codes.length > 0)
          .map((queue) => ({
            name: queue.name,
            status: queue.status,
            code: queue.codes[0].publicCode,
          }));
        return {
          id: location.id,
          name: location.name,
          address: location.address,
          queues,
          canBook: tenant.appointmentEnabled && location.services.length > 0 && queues.length > 0,
        };
      })
      .filter((location) => location.queues.length > 0);
  }

  /**
   * Upserts on (tenantId, phoneE164) — the exact same key the anonymous
   * join flow upserts on (queue-entries.service.ts), so a customer who
   * later signs up for an account automatically inherits any walk-in
   * history already on file for their phone number, and vice versa: a
   * future anonymous join with the same phone links straight back to this
   * account rather than creating a second row.
   */
  private async upsertCustomer(
    tenantId: string,
    input: { name: string; phone: string; email?: string },
  ) {
    const phoneE164 = normalizePhoneToE164(input.phone);

    if (input.email) {
      const emailConflict = await this.prisma.customer.findUnique({
        where: { tenantId_email: { tenantId, email: input.email } },
      });
      if (emailConflict && emailConflict.phoneE164 !== phoneE164) {
        throw new ConflictException({
          code: "CUSTOMER_EMAIL_ALREADY_REGISTERED",
          message: "This email is already registered to another account. Please log in instead.",
        });
      }
    }

    return this.prisma.customer.upsert({
      where: { tenantId_phoneE164: { tenantId, phoneE164 } },
      create: { tenantId, phoneE164, firstName: input.name, email: input.email ?? null },
      update: { firstName: input.name, ...(input.email && { email: input.email }) },
    });
  }

  /** Staff-initiated in-person signup (G-56) — mints the identity code immediately since staff hands it to the customer right there, no OTP needed (staff already verified the person face-to-face). */
  async createByStaff(
    tenantId: string,
    input: StaffCreateCustomerInput,
  ): Promise<StaffCreateCustomerResponse> {
    const customer = await this.upsertCustomer(tenantId, input);
    const identityCode = await this.codesService.createForCustomer(tenantId, customer.id);
    return { customer: toAuthenticatedUser(customer), identityCode: identityCode.publicCode };
  }

  /** Self-service signup via a GENERAL code (D-10) — called by CustomerAuthService, which sends the OTP afterward; tokens aren't issued until that code is verified. */
  async signUp(tenantId: string, input: CustomerSignupInput) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: "TENANT_NOT_FOUND", message: "Business not found." });
    }
    const customer = await this.upsertCustomer(tenantId, input);
    await this.codesService.createForCustomer(tenantId, customer.id);
    return customer;
  }

  async findById(customerId: string): Promise<CustomerAuthenticatedUser> {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return toAuthenticatedUser(customer);
  }

  /** The portal's landing view (G-55) — identity code plus who they are, minted lazily if this customer somehow doesn't have one yet (e.g. an account created before this code existed). */
  async getPortalSummary(tenantId: string, customerId: string): Promise<CustomerPortalSummary> {
    const [customer, tenant, identityCode] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { logo: { select: { updatedAt: true } } },
      }),
      this.codesService.createForCustomer(tenantId, customerId),
    ]);
    return {
      customer: toAuthenticatedUser(customer),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logoPath: tenantLogoPath(tenant.id, tenant.logo),
      },
      identityCode: identityCode.publicCode,
    };
  }

  async getIdentityCode(tenantId: string, customerId: string): Promise<string> {
    const code = await this.codesService.createForCustomer(tenantId, customerId);
    return code.publicCode;
  }

  /** Rotation (same precedent as DISPLAY/G-07) — for a lost/leaked identity code. */
  async regenerateIdentityCode(tenantId: string, customerId: string): Promise<string> {
    const code = await this.codesService.regenerateForCustomer(tenantId, customerId);
    return code.publicCode;
  }

  async getActiveEntry(tenantId: string, customerId: string): Promise<CustomerActiveEntry | null> {
    return this.queueEntries.getActiveForCustomer(tenantId, customerId);
  }
}

function toAuthenticatedUser(customer: {
  id: string;
  firstName: string | null;
  phoneE164: string;
  email: string | null;
}): CustomerAuthenticatedUser {
  return {
    id: customer.id,
    firstName: customer.firstName,
    phoneE164: customer.phoneE164,
    email: customer.email,
  };
}
