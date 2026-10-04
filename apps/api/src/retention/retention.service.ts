import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const RETENTION_DAYS = 90;

export interface PurgeStalePiiResult {
  anonymizedCustomerIds: string[];
}

/**
 * G-37 (90-day PII purge), Phase 12. Platform-wide — there's no
 * PLATFORM_ADMIN console and no tenant-scoped reason to trigger this
 * per-tenant, so it's a plain internal method the cron calls, not an HTTP
 * endpoint. Anonymizes (does not delete) the Customer row: QueueEntry/Code
 * history stays intact for analytics, just no longer attributable to a
 * real person.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeStalePii(): Promise<PurgeStalePiiResult> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Customers whose last COMPLETED entry is older than the cutoff, with
    // nothing left to anonymize already, and no currently-active entry
    // anywhere. Prisma's query builder can't express the correlated
    // "MAX(completedAt) per customer" filter directly, hence raw SQL.
    const stale = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM customers c
      WHERE (c."firstName" IS NOT NULL OR c."email" IS NOT NULL)
        AND c.id IN (
          SELECT qe."customerId"
          FROM queue_entries qe
          WHERE qe.status = 'COMPLETED' AND qe."customerId" IS NOT NULL
          GROUP BY qe."customerId"
          HAVING MAX(qe."completedAt") < ${cutoff}
        )
        AND NOT EXISTS (
          -- Mirrors queue-entries.service.ts's ACTIVE_STATUSES — a customer
          -- mid-visit anywhere must never be anonymized, even if their last
          -- *completed* entry elsewhere is stale. Not something G-37 spells
          -- out explicitly; it's the obvious safety condition for not
          -- breaking live notifications out from under someone. Inlined as
          -- literals (not bound params) since enum-column comparisons need
          -- the literal's "unknown" type to resolve against the Postgres
          -- enum — a bound text parameter doesn't implicitly cast the same
          -- way and errors.
          SELECT 1 FROM queue_entries qe2
          WHERE qe2."customerId" = c.id
            AND qe2.status IN ('WAITING', 'CALLED', 'SERVING')
        )
        AND NOT EXISTS (
          -- Phase 13: same safety condition for a booking still ahead —
          -- anonymizing would orphan its cancellation/notification contact.
          SELECT 1 FROM appointments a
          WHERE a."customerId" = c.id
            AND a.status = 'BOOKED'
            AND a."startsAt" > NOW()
        )
    `;

    const anonymizedCustomerIds: string[] = [];
    for (const { id } of stale) {
      await this.prisma.customer.update({
        where: { id },
        data: {
          firstName: null,
          email: null,
          phoneE164: `anon-${id}`,
        },
      });
      // Phase 15: an anonymized account can't log in, so its authenticator
      // secret goes too. deleteMany, because most customers never set one up.
      await this.prisma.authenticatorCredential.deleteMany({ where: { customerId: id } });
      anonymizedCustomerIds.push(id);
    }

    if (anonymizedCustomerIds.length > 0) {
      this.logger.log(
        `Anonymized ${anonymizedCustomerIds.length} stale customer(s) (G-37, >${RETENTION_DAYS} days inactive).`,
      );
    }

    return { anonymizedCustomerIds };
  }
}
