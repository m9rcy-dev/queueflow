import { Injectable, NotFoundException } from "@nestjs/common";
import type { DisplaySnapshot } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";

const NEXT_UP_LIMIT = 5;

function codeNotFound(): NotFoundException {
  return new NotFoundException({ code: "CODE_NOT_FOUND", message: "This code isn't recognized." });
}

/**
 * The public TV board (Phase 6, G-07/C-01) — a strictly PII-free
 * projection of a queue's live state. Every query here deliberately
 * selects only ticket numbers and service names, never customer or staff
 * fields, so there is no field to accidentally leak even if a caller
 * changed the response shape later (defense in depth, not just "the DTO
 * omits it").
 */
@Injectable()
export class DisplaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a DISPLAY-context code to the queue it's bound to. Checked
   * once per SSE connection — a code's queueId is set at creation and
   * never reassigned, so there's no need to re-resolve it on every push
   * (unlike the queue/location/tenant names and live counts, which do get
   * refreshed on every push via getSnapshot).
   */
  async resolveQueueId(publicCode: string): Promise<string> {
    const code = await this.prisma.code.findUnique({ where: { publicCode } });
    if (!code || !code.active || code.contextType !== "DISPLAY" || !code.queueId) {
      throw codeNotFound();
    }
    return code.queueId;
  }

  /** Full board snapshot, pushed fresh on every change (G-27) — never a diff. */
  async getSnapshot(queueId: string): Promise<DisplaySnapshot> {
    const queue = await this.prisma.queue.findUniqueOrThrow({
      where: { id: queueId },
      include: { location: true, tenant: true },
    });

    const [nowServingRows, nextRows] = await Promise.all([
      this.prisma.queueEntry.findMany({
        where: { queueId, status: { in: ["CALLED", "SERVING"] } },
        orderBy: { calledAt: "asc" },
        select: { ticketNumber: true, service: { select: { name: true } } },
      }),
      this.prisma.queueEntry.findMany({
        where: { queueId, status: "WAITING" },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        take: NEXT_UP_LIMIT,
        select: { ticketNumber: true },
      }),
    ]);

    return {
      tenant: { name: queue.tenant.name },
      location: { name: queue.location.name },
      queue: { name: queue.name, status: queue.status },
      nowServing: nowServingRows.map((row) => ({
        ticketNumber: row.ticketNumber,
        serviceName: row.service.name,
      })),
      next: nextRows.map((row) => row.ticketNumber),
    };
  }
}
