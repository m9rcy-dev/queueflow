import { Injectable, NotFoundException } from "@nestjs/common";
import type { CodeResolution, CodeSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";
import { generateShortPublicCode } from "../common/short-code.util";

/**
 * The minimal code resolver (Phase 4, §4.5/ADR-005) — QUEUE context only.
 * A generic `code → context` lookup, deliberately not the full unified
 * model yet (see the schema comment on the Code model for why).
 */
@Injectable()
export class CodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queuesService: QueuesService,
  ) {}

  async createForQueue(tenantId: string, queueId: string): Promise<CodeSummary> {
    await this.queuesService.findOwnedQueue(tenantId, queueId); // 404s for another tenant's queue

    // Collision odds on an 8-char, 31-symbol alphabet are astronomically
    // low, but retry once rather than trust that blindly.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const code = await this.prisma.code.create({
          data: {
            tenantId,
            queueId,
            contextType: "QUEUE",
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
    if (!code || !code.active || !code.queue) {
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
