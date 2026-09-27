import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Phase 3 integration tests — the highest-risk domain in the whole plan
 * (docs/plan-review.md §5). The concurrency test below is the one the
 * acceptance criteria explicitly calls for: "concurrent Call Next cannot
 * select the same entry (proven with an actual concurrent integration
 * test)" — fired as genuinely parallel HTTP requests via Promise.all
 * against a real Postgres, not sequential calls.
 */
describe("Queue domain (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // The concurrency test below fires a dozen-plus genuinely parallel
    // connections at once — harmless, but past Node's default per-emitter
    // listener cap, which otherwise logs a spurious leak warning.
    app.getHttpServer().setMaxListeners(30);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await container?.stop();
  });

  function recoverCodeFromHash(codeHash: string): string {
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = i.toString().padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) {
        return candidate;
      }
    }
    throw new Error("Could not recover code from hash");
  }

  async function signUpAndVerify(email: string, businessName: string, ownerName: string) {
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName, ownerName, email })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const verifyRes = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);
    return verifyRes.body as { accessToken: string };
  }

  /** Sets up one location + one active service + one queue with that service attached — the minimum needed for a customer to join. */
  async function setUpQueue(accessToken: string) {
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Christchurch", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locationId: location.body.id, name: "Main Queue" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ serviceId: service.body.id })
      .expect(201);
    return { locationId: location.body.id, serviceId: service.body.id, queueId: queue.body.id };
  }

  // Deliberately not `async` — returning the supertest Test object directly
  // (rather than a resolved response) is what lets callers chain
  // `.expect(...)` before awaiting it themselves.
  function join(
    queueId: string,
    serviceId: string,
    name: string,
    phone: string,
    idempotencyKey?: string,
  ) {
    return request(app.getHttpServer())
      .post(`/public/queues/${queueId}/entries`)
      .send({
        serviceId,
        customerName: name,
        customerPhone: phone,
        ...(idempotencyKey && { idempotencyKey }),
      });
  }

  it("runs the full lifecycle: join -> call-next -> start -> complete, with correct position/wait", async () => {
    const owner = await signUpAndVerify("q-owner-a@example.com", "Joe's Barbers", "Joe");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const first = await join(queueId, serviceId, "Alice", "0211111111").expect(201);
    expect(first.body.ticketNumber).toBe(1);
    expect(first.body.position).toBe(1);
    expect(first.body.estimatedWaitMinutes).toBe(0);
    expect(first.body.publicToken).toBeDefined();

    const second = await join(queueId, serviceId, "Bob", "0212222222").expect(201);
    expect(second.body.ticketNumber).toBe(2);
    expect(second.body.position).toBe(2);
    expect(second.body.estimatedWaitMinutes).toBe(20); // one 20-min service ahead, capacity 1

    const called = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(called.body.id).toBe(first.body.id); // FIFO — oldest first
    expect(called.body.status).toBe("CALLED");

    const started = await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${called.body.id}/start`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(started.body.status).toBe("SERVING");

    const completed = await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${called.body.id}/complete`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(completed.body.status).toBe("COMPLETED");

    // Completing twice is an invalid transition, not a silent no-op.
    await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${called.body.id}/complete`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(409);
  });

  it("concurrent Call Next: N simultaneous requests against N waiting entries each claim a distinct entry — the core Phase 3 acceptance criterion", async () => {
    const owner = await signUpAndVerify("q-owner-b@example.com", "Concurrency Co", "Owner B");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const entryCount = 8;
    const joinResults = await Promise.all(
      Array.from({ length: entryCount }, (_, i) =>
        join(queueId, serviceId, `Customer${i}`, `021${String(i).padStart(7, "0")}`),
      ),
    );
    joinResults.forEach((res) => expect(res.status).toBe(201));

    // Fire genuinely parallel Call Next requests — more than there are
    // waiting entries, so some must correctly find nothing left.
    const callNextResults = await Promise.all(
      Array.from({ length: entryCount + 4 }, () =>
        request(app.getHttpServer())
          .post(`/tenants/me/queues/${queueId}/call-next`)
          .set("Authorization", `Bearer ${owner.accessToken}`),
      ),
    );

    const successes = callNextResults.filter((res) => res.status === 201);
    const empties = callNextResults.filter((res) => res.status === 404);
    expect(successes).toHaveLength(entryCount);
    expect(empties).toHaveLength(4);

    // The critical assertion: every successful call claimed a *different*
    // entry — no two requests were both handed the same customer.
    const claimedIds = successes.map((res) => res.body.id);
    expect(new Set(claimedIds).size).toBe(entryCount);

    // And the database agrees: exactly entryCount entries are CALLED, none WAITING.
    const stillWaiting = await prisma.queueEntry.count({ where: { queueId, status: "WAITING" } });
    const called = await prisma.queueEntry.count({ where: { queueId, status: "CALLED" } });
    expect(stillWaiting).toBe(0);
    expect(called).toBe(entryCount);
  });

  it("idempotent join: a retried request with the same key never creates a duplicate ticket", async () => {
    const owner = await signUpAndVerify("q-owner-c@example.com", "Idempotency Co", "Owner C");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const first = await join(queueId, serviceId, "Alice", "0213333333", "retry-key-x").expect(201);
    const second = await join(queueId, serviceId, "Alice", "0213333333", "retry-key-x").expect(201);

    expect(second.body.id).toBe(first.body.id);
    const count = await prisma.queueEntry.count({ where: { queueId } });
    expect(count).toBe(1);
  });

  it("enforces max active tickets per customer per queue (G-34)", async () => {
    const owner = await signUpAndVerify("q-owner-d@example.com", "Cap Co", "Owner D");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    await join(queueId, serviceId, "Alice", "0214444444").expect(201);
    const secondAttempt = await join(queueId, serviceId, "Alice", "0214444444");
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.code).toBe("TOO_MANY_ACTIVE_TICKETS");
  });

  it("closing a queue cascade-cancels waiting entries and blocks new joins", async () => {
    const owner = await signUpAndVerify("q-owner-e@example.com", "Close Co", "Owner E");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const entry = await join(queueId, serviceId, "Alice", "0215555555").expect(201);

    await request(app.getHttpServer())
      .patch(`/tenants/me/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ status: "CLOSED" })
      .expect(200);

    const cancelled = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.body.id } });
    expect(cancelled.status).toBe("CANCELLED");

    const rejectedJoin = await join(queueId, serviceId, "Bob", "0216666666");
    expect(rejectedJoin.status).toBe(409);
    expect(rejectedJoin.body.code).toBe("QUEUE_NOT_ACTIVE");
  });

  it("blocks cross-tenant access to queues and entries (404, not 403 or a data leak)", async () => {
    const tenantA = await signUpAndVerify("q-owner-f@example.com", "Tenant F", "Owner F");
    const tenantB = await signUpAndVerify("q-owner-g@example.com", "Tenant G", "Owner G");
    const { queueId, serviceId } = await setUpQueue(tenantA.accessToken);
    const entry = await join(queueId, serviceId, "Alice", "0217777777").expect(201);

    await request(app.getHttpServer())
      .get(`/tenants/me/queues/${queueId}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/tenants/me/queue-entries/${entry.body.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);

    // Tenant A's entry must be untouched by tenant B's rejected attempt.
    const untouched = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.body.id } });
    expect(untouched.status).toBe("WAITING");
  });

  it("a customer can look up and cancel their own ticket by public token, without any auth", async () => {
    const owner = await signUpAndVerify("q-owner-h@example.com", "Public Co", "Owner H");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);
    const entry = await join(queueId, serviceId, "Alice", "0218888888").expect(201);

    const looked = await request(app.getHttpServer())
      .get(`/public/queue-entries/${entry.body.publicToken}`)
      .expect(200);
    expect(looked.body.id).toBe(entry.body.id);

    const cancelled = await request(app.getHttpServer())
      .post(`/public/queue-entries/${entry.body.publicToken}/cancel`)
      .send({ reason: "changed my mind" })
      .expect(201);
    expect(cancelled.body.status).toBe("CANCELLED");

    const row = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entry.body.id } });
    expect(row.cancellationReason).toBe("changed my mind");
  });
});
