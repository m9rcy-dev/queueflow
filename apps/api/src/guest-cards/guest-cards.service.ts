import { ConflictException, Injectable } from "@nestjs/common";
import type { GuestCardSummary } from "@queueflow/types";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { CodesService } from "../codes/codes.service";

/**
 * A location's numbered, anonymous guest-card pool (Phase 10, D-14) — the
 * admin-configurable side of the feature; the actual scan-to-join
 * consumption lives in QueueEntriesService.joinByScan, which is the only
 * other place `Code.currentEntryId` is ever touched.
 */
@Injectable()
export class GuestCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationsService: LocationsService,
    private readonly codesService: CodesService,
  ) {}

  async list(tenantId: string, locationId: string): Promise<GuestCardSummary[]> {
    await this.locationsService.findOwnedLocation(tenantId, locationId);
    const cards = await this.prisma.code.findMany({
      where: { tenantId, locationId, contextType: "GUEST_CARD", active: true },
      orderBy: { guestNumber: "asc" },
    });
    return cards.map(toGuestCardSummary);
  }

  /**
   * Reconciles the pool to exactly `poolSize` active cards — mints new
   * ones (next guestNumber onward) if growing, deactivates the
   * highest-numbered *free* ones if shrinking. Refuses to shrink past a
   * currently-in-use card (D-14/G-54's dedup guarantee depends on an
   * in-use card staying resolvable for its idempotent re-scan) rather than
   * silently leaving the pool larger than asked — the physical card is
   * still out with a guest.
   */
  async resize(
    tenantId: string,
    locationId: string,
    poolSize: number,
  ): Promise<GuestCardSummary[]> {
    await this.locationsService.findOwnedLocation(tenantId, locationId);
    const existing = await this.prisma.code.findMany({
      where: { tenantId, locationId, contextType: "GUEST_CARD", active: true },
      orderBy: { guestNumber: "asc" },
    });

    if (existing.length < poolSize) {
      // Numbering always continues from the highest guestNumber *ever*
      // assigned at this location, active or not — `@@unique([locationId,
      // guestNumber])` applies to deactivated rows too, so re-growing after
      // a shrink can't reuse a retired number (same real-world intuition:
      // a destroyed card #3 doesn't get its number printed on a new one).
      const highestEver = await this.prisma.code.aggregate({
        where: { tenantId, locationId, contextType: "GUEST_CARD" },
        _max: { guestNumber: true },
      });
      let nextNumber = (highestEver._max.guestNumber ?? 0) + 1;
      const toMint = poolSize - existing.length;
      for (let i = 0; i < toMint; i += 1) {
        await this.codesService.createGuestCard(tenantId, locationId, nextNumber);
        nextNumber += 1;
      }
    } else if (existing.length > poolSize) {
      const toRemove = existing.slice(poolSize); // already sorted ascending — these are the highest-numbered
      const stillInUse = toRemove.filter((card) => card.currentEntryId !== null);
      if (stillInUse.length > 0) {
        throw new ConflictException({
          code: "GUEST_CARDS_IN_USE",
          message: `Cannot shrink the pool to ${poolSize} — guest card${stillInUse.length > 1 ? "s" : ""} ${stillInUse.map((card) => card.guestNumber).join(", ")} ${stillInUse.length > 1 ? "are" : "is"} currently in use. Try again once returned.`,
        });
      }
      await this.prisma.code.updateMany({
        where: { id: { in: toRemove.map((card) => card.id) } },
        data: { active: false },
      });
    }

    return this.list(tenantId, locationId);
  }
}

function toGuestCardSummary(code: {
  id: string;
  publicCode: string;
  guestNumber: number | null;
  currentEntryId: string | null;
}): GuestCardSummary {
  return {
    id: code.id,
    publicCode: code.publicCode,
    // guestNumber is only ever null for non-GUEST_CARD rows, which this
    // query never returns (see the contextType filter above).
    guestNumber: code.guestNumber!,
    inUse: code.currentEntryId !== null,
  };
}
