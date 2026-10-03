import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { PrismaModule } from "../src/prisma/prisma.module";
import { RetentionModule } from "../src/retention/retention.module";
import { RetentionService } from "../src/retention/retention.service";

/**
 * G-37 (90-day PII purge), Phase 12 — proves the raw-SQL stale-candidate
 * query against a real Postgres (Prisma's query builder can't express the
 * correlated "MAX(completedAt) per customer" filter it needs), and proves
 * the active-entry safety guard actually protects a mid-visit customer.
 */
describe("Retention (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let retention: RetentionService;

  let tenantId: string;
  let locationId: string;
  let serviceId: string;
  let queueId: string;
  let nextTicketNumber = 1;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, RetentionModule],
    }).compile();
    retention = moduleRef.get(RetentionService);

    const tenant = await prisma.tenant.create({
      data: { name: "Retention Test Co", ownerName: "Owner" },
    });
    tenantId = tenant.id;
    const location = await prisma.location.create({
      data: { tenantId, name: "Main", timezone: "Pacific/Auckland" },
    });
    locationId = location.id;
    const service = await prisma.service.create({
      data: { tenantId, locationId, name: "Haircut", durationMinutes: 30 },
    });
    serviceId = service.id;
    const queue = await prisma.queue.create({
      data: { tenantId, locationId, name: "Main Queue" },
    });
    queueId = queue.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function createCustomer(phoneE164: string) {
    return prisma.customer.create({
      data: { tenantId, phoneE164, firstName: "Real Name", email: `${phoneE164}@example.com` },
    });
  }

  async function createEntry(customerId: string, status: string, completedAt: Date | null) {
    return prisma.queueEntry.create({
      data: {
        tenantId,
        queueId,
        serviceId,
        customerId,
        publicToken: `tok_${randomUUID()}`,
        ticketNumber: nextTicketNumber++,
        serviceDate: new Date(),
        status: status as never,
        completedAt,
      },
    });
  }

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  it("anonymizes a customer whose last completed entry is over 90 days old", async () => {
    const customer = await createCustomer("+64211000001");
    await createEntry(customer.id, "COMPLETED", daysAgo(100));

    const result = await retention.purgeStalePii();

    expect(result.anonymizedCustomerIds).toContain(customer.id);
    const reloaded = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.firstName).toBeNull();
    expect(reloaded.email).toBeNull();
    expect(reloaded.phoneE164).toBe(`anon-${customer.id}`);
  });

  it("does not touch a customer whose last completed entry is recent", async () => {
    const customer = await createCustomer("+64211000002");
    await createEntry(customer.id, "COMPLETED", daysAgo(10));

    const result = await retention.purgeStalePii();

    expect(result.anonymizedCustomerIds).not.toContain(customer.id);
    const reloaded = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.firstName).toBe("Real Name");
    expect(reloaded.phoneE164).toBe("+64211000002");
  });

  it("protects a customer with a currently-active entry even if their last completed entry is stale", async () => {
    const customer = await createCustomer("+64211000003");
    await createEntry(customer.id, "COMPLETED", daysAgo(200));
    await createEntry(customer.id, "WAITING", null);

    const result = await retention.purgeStalePii();

    expect(result.anonymizedCustomerIds).not.toContain(customer.id);
    const reloaded = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(reloaded.firstName).toBe("Real Name");
  });

  it("protects a customer with a future booked appointment even if their last completed entry is stale (Phase 13)", async () => {
    const customer = await createCustomer("+64211000009");
    await createEntry(customer.id, "COMPLETED", daysAgo(100));
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await prisma.appointment.create({
      data: {
        tenantId,
        locationId,
        serviceId,
        customerId: customer.id,
        publicToken: `appt_${randomUUID()}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        occupiedUntil: new Date(startsAt.getTime() + 30 * 60_000),
        localDate: new Date(startsAt.toISOString().slice(0, 10)),
      },
    });

    const result = await retention.purgeStalePii();

    expect(result.anonymizedCustomerIds).not.toContain(customer.id);
  });

  it("keeps historical QueueEntry rows intact after anonymization, just no longer attributable to a real person", async () => {
    const customer = await createCustomer("+64211000004");
    const entry = await createEntry(customer.id, "COMPLETED", daysAgo(365));

    await retention.purgeStalePii();

    const reloadedEntry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reloadedEntry.customerId).toBe(customer.id);
    expect(reloadedEntry.status).toBe("COMPLETED");
    expect(reloadedEntry.completedAt).not.toBeNull();
  });

  it("is idempotent: running twice anonymizes the same customer once, no error on the second pass", async () => {
    const customer = await createCustomer("+64211000005");
    await createEntry(customer.id, "COMPLETED", daysAgo(100));

    await retention.purgeStalePii();
    const second = await retention.purgeStalePii();

    // Second run finds nothing left to anonymize (firstName/email already
    // null) — the guard against reprocessing already-anonymized customers.
    expect(second.anonymizedCustomerIds).not.toContain(customer.id);
  });
});
