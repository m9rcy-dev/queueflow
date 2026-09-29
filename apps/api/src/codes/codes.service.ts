import { Injectable, NotFoundException } from "@nestjs/common";
import type { CodeContextType, CodeResolution, CodeSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { generateShortPublicCode } from "../common/short-code.util";

/**
 * The minimal code resolver (Phases 4, 6 & 9, §4.5/ADR-005) — QUEUE,
 * DISPLAY, GENERAL, and CUSTOMER_IDENTITY contexts. A generic
 * `code → context` lookup, deliberately not the full unified model yet
 * (see the schema comment on the Code model for why). `resolve()` itself
 * only ever understands QUEUE and GENERAL codes (both one-shot landing
 * pages) — DISPLAY codes are resolved by the display module's own SSE
 * endpoint (a live feed, not a single REST lookup), and CUSTOMER_IDENTITY
 * has no public consumer yet (Phase 10's scanner job).
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
    const codes = await this.prisma.code.findMany({ where: { tenantId, contextType: "GENERAL" } });
    return codes.map(toCodeSummary);
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
      return {
        contextType: "QUEUE",
        tenant: { name: code.queue.tenant.name },
        location: { name: code.queue.location.name },
        queue: { id: code.queue.id, name: code.queue.name, status: code.queue.status },
        capabilities: ["JOIN_QUEUE"],
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

    // DISPLAY and CUSTOMER_IDENTITY get the exact same uniform rejection as
    // a nonexistent or deactivated code (G-07/G-39's "no signal" pattern) —
    // this endpoint doesn't understand either of them.
    throw notFoundCode();
  }

  /**
   * Collision odds on an 8-char, 31-symbol alphabet are astronomically
   * low, but retry once rather than trust that blindly.
   */
  private async mintCode(data: {
    tenantId: string;
    contextType: CodeContextType;
    queueId?: string;
    customerId?: string;
  }): Promise<CodeSummary> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const code = await this.prisma.code.create({
          data: { ...data, publicCode: generateShortPublicCode() },
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
  publicCode: string;
  contextType: CodeSummary["contextType"];
  queueId: string | null;
  customerId: string | null;
}): CodeSummary {
  return {
    publicCode: code.publicCode,
    contextType: code.contextType,
    queueId: code.queueId,
    customerId: code.customerId,
  };
}
