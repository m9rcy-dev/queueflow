import { Injectable, NotFoundException } from "@nestjs/common";
import type { CodeContextType, CodeResolution, CodeSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { generateShortPublicCode } from "../common/short-code.util";
import { generateSecurePublicToken } from "../common/secure-token.util";

/**
 * Which contexts get the short, printed, explicitly-not-secret alphabet
 * (G-39) vs. the long, high-entropy one. QUEUE/DISPLAY/GENERAL are business
 * posters — reading one only reveals *which* queue/tenant, no capability.
 * CUSTOMER_IDENTITY and GUEST_CARD are different: presenting one at the
 * scanner (Phase 10) instantly joins a queue *as that customer* or *holding
 * that card* — a real capability, not just a context pointer — so these get
 * the same 128-bit-minimum treatment as queue_entry.publicToken (G-39's own
 * "ticket public_token, identity/guest codes" grouping). Neither is ever
 * hand-typed (always scanned), so the longer string costs nothing in UX.
 */
const SECRET_CONTEXT_TYPES: ReadonlySet<CodeContextType> = new Set([
  "CUSTOMER_IDENTITY",
  "GUEST_CARD",
]);

/**
 * The minimal code resolver (Phases 4, 6, 9 & 10, §4.5/ADR-005) — QUEUE,
 * DISPLAY, GENERAL, CUSTOMER_IDENTITY, and GUEST_CARD contexts. A generic
 * `code → context` lookup, deliberately not the full unified model yet
 * (see the schema comment on the Code model for why). `resolve()` itself
 * only ever understands QUEUE and GENERAL codes (both one-shot public
 * landing pages) — DISPLAY codes are resolved by the display module's own
 * SSE endpoint (a live feed, not a single REST lookup), and
 * CUSTOMER_IDENTITY/GUEST_CARD are only ever consumed via the
 * staff-authenticated scan endpoint (QueueEntriesService.joinByScan,
 * Phase 10), never this public one.
 */
@Injectable()
export class CodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesService: QueuesService,
  ) {}

  async createForQueue(
    tenantId: string,
    queueId: string,
    contextType: CodeContextType = "QUEUE",
  ): Promise<CodeSummary> {
    await this.queuesService.findOwnedQueue(tenantId, queueId); // 404s for another tenant's queue
    return this.mintCode({ tenantId, queueId, contextType });
  }

  async listForQueue(tenantId: string, queueId: string): Promise<CodeSummary[]> {
    await this.queuesService.findOwnedQueue(tenantId, queueId);
    const codes = await this.prisma.code.findMany({ where: { tenantId, queueId } });
    return codes.map(toCodeSummary);
  }

  /** Mints the tenant's "sign up here" poster code (Phase 9, D-10, G-56) — not queue-bound, so no findOwnedQueue check needed; the caller's own tenantId (from their JWT) is trust enough. */
  async createGeneral(tenantId: string): Promise<CodeSummary> {
    return this.mintCode({ tenantId, contextType: "GENERAL" });
  }

  async listGeneral(tenantId: string): Promise<CodeSummary[]> {
    const codes = await this.prisma.code.findMany({
      where: { tenantId, contextType: "GENERAL" },
      orderBy: { createdAt: "desc" },
    });
    return codes.map(toCodeSummary);
  }

  /** Rotation (Phase 11, same precedent as DISPLAY/CUSTOMER_IDENTITY): deactivates every currently-active GENERAL code for this tenant, then mints one fresh — never reuses a publicCode. */
  async regenerateGeneral(tenantId: string): Promise<CodeSummary> {
    await this.prisma.code.updateMany({
      where: { tenantId, contextType: "GENERAL", active: true },
      data: { active: false },
    });
    return this.mintCode({ tenantId, contextType: "GENERAL" });
  }

  async deactivateGeneral(tenantId: string, codeId: string): Promise<void> {
    const result = await this.prisma.code.updateMany({
      where: { id: codeId, tenantId, contextType: "GENERAL" },
      data: { active: false },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: "CODE_NOT_FOUND", message: "Code not found." });
    }
  }

  /** A customer's persistent "loyalty card" code (Phase 9, G-52) — idempotent: reuses the existing active one rather than minting a duplicate on every call. */
  async createForCustomer(tenantId: string, customerId: string): Promise<CodeSummary> {
    const existing = await this.prisma.code.findFirst({
      where: { tenantId, customerId, contextType: "CUSTOMER_IDENTITY", active: true },
    });
    if (existing) return toCodeSummary(existing);
    return this.mintCode({ tenantId, customerId, contextType: "CUSTOMER_IDENTITY" });
  }

  /** Rotation (same precedent as DISPLAY, G-07): deactivate whatever's active, mint a fresh one — never reuse the same publicCode. */
  async regenerateForCustomer(tenantId: string, customerId: string): Promise<CodeSummary> {
    await this.prisma.code.updateMany({
      where: { tenantId, customerId, contextType: "CUSTOMER_IDENTITY", active: true },
      data: { active: false },
    });
    return this.mintCode({ tenantId, customerId, contextType: "CUSTOMER_IDENTITY" });
  }

  /**
   * Mints one guest card at a specific printed number (Phase 10, D-14) —
   * called by GuestCardsService when growing a location's pool. No
   * idempotent-reuse check here (unlike createForCustomer): pool sizing
   * always asks for a specific next-available guestNumber, never "give me
   * a card, any card."
   */
  async createGuestCard(
    tenantId: string,
    locationId: string,
    guestNumber: number,
  ): Promise<CodeSummary> {
    return this.mintCode({ tenantId, locationId, guestNumber, contextType: "GUEST_CARD" });
  }

  /**
   * Rotation (G-07): a display code has no auth of its own, so if a screen
   * is repurposed or the link leaks, the fix is deactivating this code and
   * minting a fresh one — never reusing the same publicCode. Applies to
   * any code kind, not just DISPLAY (a leaked QUEUE code is the same
   * story).
   */
  async deactivate(tenantId: string, queueId: string, codeId: string): Promise<void> {
    await this.queuesService.findOwnedQueue(tenantId, queueId);
    const result = await this.prisma.code.updateMany({
      where: { id: codeId, tenantId, queueId },
      data: { active: false },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: "CODE_NOT_FOUND", message: "Code not found." });
    }
  }

  /**
   * Public resolver — no tenant context exists here, same shape as the
   * queue-join flow (Phase 3): the code itself carries all the context
   * needed. Never returns anything beyond what a customer landing page
   * needs (plan §13.4 — "must not return sensitive administrative data").
   */
  async resolve(publicCode: string): Promise<CodeResolution> {
    const code = await this.prisma.code.findUnique({
      where: { publicCode },
      include: {
        tenant: true,
        queue: {
          include: {
            location: true,
            tenant: true,
            queueServices: { include: { service: true } },
          },
        },
      },
    });
    if (!code || !code.active) {
      throw notFoundCode();
    }

    if (code.contextType === "QUEUE") {
      if (!code.queue) throw notFoundCode();
      // Phase 13: the same poster also offers booking when the tenant has
      // the Appointment capability on and this location has something
      // bookable — "a customer's phone scanning QUEUE shows join/book
      // options" (§4.5).
      const appointmentServices = code.queue.tenant.appointmentEnabled
        ? await this.prisma.service.findMany({
            where: { locationId: code.queue.locationId, active: true, appointmentEnabled: true },
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true, name: true, durationMinutes: true },
          })
        : [];
      return {
        contextType: "QUEUE",
        tenant: { name: code.queue.tenant.name },
        location: { id: code.queue.location.id, name: code.queue.location.name },
        queue: { id: code.queue.id, name: code.queue.name, status: code.queue.status },
        capabilities:
          appointmentServices.length > 0 ? ["JOIN_QUEUE", "BOOK_APPOINTMENT"] : ["JOIN_QUEUE"],
        appointmentServices,
        // Only what a customer can actually join right now — not the whole catalog (plan §13.4).
        services: code.queue.queueServices
          .map((qs) => qs.service)
          .filter((service) => service.active && service.queueEnabled)
          .map((service) => ({
            id: service.id,
            name: service.name,
            durationMinutes: service.durationMinutes,
          })),
      };
    }

    if (code.contextType === "GENERAL") {
      return {
        contextType: "GENERAL",
        tenant: { id: code.tenant.id, name: code.tenant.name },
        capabilities: ["CREATE_ACCOUNT"],
      };
    }

    // DISPLAY, CUSTOMER_IDENTITY, and GUEST_CARD get the exact same uniform
    // rejection as a nonexistent or deactivated code (G-07/G-39's "no
    // signal" pattern) — this endpoint doesn't understand any of them.
    throw notFoundCode();
  }

  /**
   * Collision odds on either alphabet are astronomically low, but retry
   * once rather than trust that blindly.
   */
  private async mintCode(data: {
    tenantId: string;
    contextType: CodeContextType;
    queueId?: string;
    customerId?: string;
    locationId?: string;
    guestNumber?: number;
  }): Promise<CodeSummary> {
    const generatePublicCode = SECRET_CONTEXT_TYPES.has(data.contextType)
      ? generateSecurePublicToken
      : generateShortPublicCode;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const code = await this.prisma.code.create({
          data: { ...data, publicCode: generatePublicCode() },
        });
        return toCodeSummary(code);
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
    throw new Error("unreachable");
  }
}

function notFoundCode(): NotFoundException {
  return new NotFoundException({ code: "CODE_NOT_FOUND", message: "This code isn't recognized." });
}

function toCodeSummary(code: {
  id: string;
  publicCode: string;
  contextType: CodeSummary["contextType"];
  active: boolean;
  queueId: string | null;
  customerId: string | null;
}): CodeSummary {
  return {
    id: code.id,
    publicCode: code.publicCode,
    contextType: code.contextType,
    active: code.active,
    queueId: code.queueId,
    customerId: code.customerId,
  };
}
