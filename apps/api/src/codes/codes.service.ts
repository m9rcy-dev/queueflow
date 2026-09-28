import { Injectable, NotFoundException } from "@nestjs/common";
import type { CodeContextType, CodeResolution, CodeSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { generateShortPublicCode } from "../common/short-code.util";

/**
 * The minimal code resolver (Phases 4 & 6, §4.5/ADR-005) — QUEUE and
 * DISPLAY contexts only. A generic `code → context` lookup, deliberately
 * not the full unified model yet (see the schema comment on the Code
 * model for why). `resolve()` itself only ever understands QUEUE codes
 * (the customer join flow) — DISPLAY codes are resolved by the display
 * module's own SSE endpoint, which needs a live feed rather than a single
 * REST lookup.
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

    // Collision odds on an 8-char, 31-symbol alphabet are astronomically
    // low, but retry once rather than trust that blindly.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const code = await this.prisma.code.create({
          data: {
            tenantId,
            queueId,
            contextType,
            publicCode: generateShortPublicCode(),
          },
        });
        return toCodeSummary(code);
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
    throw new Error("unreachable");
  }

  async listForQueue(tenantId: string, queueId: string): Promise<CodeSummary[]> {
    await this.queuesService.findOwnedQueue(tenantId, queueId);
    const codes = await this.prisma.code.findMany({ where: { tenantId, queueId } });
    return codes.map(toCodeSummary);
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
        queue: {
          include: {
            location: true,
            tenant: true,
            queueServices: { include: { service: true } },
          },
        },
      },
    });
    // A DISPLAY code presented here gets the exact same uniform rejection
    // as a nonexistent or deactivated one (G-07/G-39's "no signal" pattern)
    // — this join-flow endpoint only ever understands QUEUE codes; DISPLAY
    // codes are resolved by the display's own SSE endpoint instead.
    if (!code || !code.active || !code.queue || code.contextType !== "QUEUE") {
      throw new NotFoundException({
        code: "CODE_NOT_FOUND",
        message: "This code isn't recognized.",
      });
    }

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
}

function toCodeSummary(code: {
  publicCode: string;
  contextType: CodeSummary["contextType"];
  queueId: string | null;
}): CodeSummary {
  return { publicCode: code.publicCode, contextType: code.contextType, queueId: code.queueId! };
}
