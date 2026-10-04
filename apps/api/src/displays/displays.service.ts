import { Injectable, NotFoundException } from "@nestjs/common";
import type { DisplaySnapshot } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { sortByQueueOrder } from "../queue-entries/queue-order";
import { staffPublicName } from "../shifts/staff-name";
import { tenantLogoPath } from "../tenants/tenant-logo.service";

/**
 * How many waiting tickets the board lists. People in the line watch the
 * board to find their place (the ones not using notifications most of
 * all), so it shows a good stretch of the queue, not just the next few.
 */
const NEXT_UP_LIMIT = 12;

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
      include: { location: true, tenant: { include: { logo: { select: { updatedAt: true } } } } },
    });

    const [nowServingRows, nextRows] = await Promise.all([
      this.prisma.queueEntry.findMany({
        where: { queueId, status: { in: ["CALLED", "SERVING"] } },
        orderBy: { calledAt: "asc" },
        select: {
          ticketNumber: true,
          service: { select: { name: true } },
          // Phase 18: which staff member has them — doing the work, else who called.
          servedByStaff: { select: { publicName: true, user: { select: { displayName: true } } } },
          assignedStaff: { select: { publicName: true, user: { select: { displayName: true } } } },
        },
      }),
      // All WAITING rows, then sorted by the shared queue order (G-25) —
      // the board must show the same "next" Call Next will actually pick.
      this.prisma.queueEntry.findMany({
        where: { queueId, status: "WAITING" },
        select: {
          id: true,
          joinedAt: true,
          priorityFrom: true,
          ticketNumber: true,
          preferredStaff: { select: { publicName: true, user: { select: { displayName: true } } } },
        },
      }),
    ]);
    const next = sortByQueueOrder(nextRows, new Date()).slice(0, NEXT_UP_LIMIT);

    return {
      tenant: {
        name: queue.tenant.name,
        logoPath: tenantLogoPath(queue.tenantId, queue.tenant.logo),
      },
      location: { name: queue.location.name },
      queue: { name: queue.name, status: queue.status },
      nowServing: nowServingRows.map((row) => {
        const staff = row.servedByStaff ?? row.assignedStaff;
        return {
          ticketNumber: row.ticketNumber,
          serviceName: row.service.name,
          staffName: staff ? staffPublicName(staff) : null,
        };
      }),
      next: next.map((row) => ({
        ticketNumber: row.ticketNumber,
        preferredStaffName: row.preferredStaff ? staffPublicName(row.preferredStaff) : null,
      })),
      waitingCount: nextRows.length,
    };
  }
}
