import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/** Phase 11 (Business Administration) — the staff roster, the live "today" dashboard, and GENERAL poster-code rotation. The CRUD screens themselves (locations/services/queues) reuse endpoints already covered by earlier phases' own integration suites. */
describe("Business administration (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    process.env.EMAIL_PROVIDER = "mock";
    process.env.SMS_PROVIDER = "mock";
    process.env.DISABLE_RATE_LIMITING = "true";

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // one bound port per suite — see jest-integration.config.js
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

  async function setUpQueue(token: string, suffix: string) {
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Loc ${suffix}`, timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.body.id, name: `Queue ${suffix}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ serviceId: service.body.id })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/tenants/me/queues/${queue.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ACTIVE" })
      .expect(200);
    return { locationId: location.body.id, serviceId: service.body.id, queueId: queue.body.id };
  }

  describe("staff roster", () => {
    it("lists the owner right after signup", async () => {
      const owner = await signUpAndVerify("a-owner@example.com", "A's Shop", "Owner A");
      const res = await request(app.getHttpServer())
        .get("/tenants/me/staff")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({ displayName: "Owner A", role: "TENANT_OWNER" }),
      ]);
    });

    it("includes a staff member once their invite is accepted", async () => {
      const owner = await signUpAndVerify("b-owner@example.com", "B's Shop", "Owner B");
      const inviteRes = await request(app.getHttpServer())
        .post("/tenants/me/invites")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ email: "b-staff@example.com", role: "STAFF" })
        .expect(201);
      const invite = await prisma.tenantInvite.findUniqueOrThrow({
        where: { id: inviteRes.body.id },
      });
      await request(app.getHttpServer()).post(`/auth/invites/${invite.token}/request`).expect(202);
      const inviteRow = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.id } });
      await request(app.getHttpServer())
        .post(`/auth/invites/${invite.token}/verify`)
        .send({ code: recoverCodeFromHash(inviteRow.codeHash!) })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/tenants/me/staff")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ email: "b-staff@example.com", role: "STAFF" }),
        ]),
      );
    });

    it("STAFF cannot list the roster (role-gated, TENANT_OWNER/TENANT_ADMIN only)", async () => {
      const owner = await signUpAndVerify("c-owner@example.com", "C's Shop", "Owner C");
      const inviteRes = await request(app.getHttpServer())
        .post("/tenants/me/invites")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ email: "c-staff@example.com", role: "STAFF" })
        .expect(201);
      const invite = await prisma.tenantInvite.findUniqueOrThrow({
        where: { id: inviteRes.body.id },
      });
      await request(app.getHttpServer()).post(`/auth/invites/${invite.token}/request`).expect(202);
      const inviteRow = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.id } });
      const staffAuth = await request(app.getHttpServer())
        .post(`/auth/invites/${invite.token}/verify`)
        .send({ code: recoverCodeFromHash(inviteRow.codeHash!) })
        .expect(201);

      await request(app.getHttpServer())
        .get("/tenants/me/staff")
        .set("Authorization", `Bearer ${staffAuth.body.accessToken}`)
        .expect(403);
    });
  });

  describe("GENERAL poster-code regeneration", () => {
    it("deactivates the old code and mints a fresh one — the old code stops resolving, the new one works", async () => {
      const owner = await signUpAndVerify("d-owner@example.com", "D's Shop", "Owner D");
      const original = await request(app.getHttpServer())
        .post("/tenants/me/codes")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ contextType: "GENERAL" })
        .expect(201);

      const regenerated = await request(app.getHttpServer())
        .post("/tenants/me/codes/regenerate")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      expect(regenerated.body.publicCode).not.toBe(original.body.publicCode);

      await request(app.getHttpServer())
        .get(`/public/codes/${original.body.publicCode}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/codes/${regenerated.body.publicCode}`)
        .expect(200);
    });
  });

  describe("the live 'today' dashboard (G-14)", () => {
    it("computes waiting/served/abandoned/no-show counts and average wait/service-duration from a real flow", async () => {
      const owner = await signUpAndVerify("e-owner@example.com", "E's Shop", "Owner E");
      const { queueId, serviceId } = await setUpQueue(owner.accessToken, "E");

      // Entry 1: joins, gets called, started, and completed.
      await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Alice", customerPhone: "021 555 0001" })
        .expect(201);
      const called1 = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/call-next`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${called1.body.id}/start`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${called1.body.id}/complete`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);

      // Entry 2: joins, gets called, then no-shows.
      await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Bob", customerPhone: "021 555 0002" })
        .expect(201);
      const called2 = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/call-next`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${called2.body.id}/no-show`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);

      // Entry 3: joins, then cancels itself (abandonment) — still WAITING when it cancels.
      const joined3 = await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Carol", customerPhone: "021 555 0003" })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/public/queue-entries/${joined3.body.publicToken}/cancel`)
        .send({})
        .expect(201);

      // Entry 4: joins and stays WAITING.
      await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Dave", customerPhone: "021 555 0004" })
        .expect(201);

      const stats = await request(app.getHttpServer())
        .get(`/tenants/me/queues/${queueId}/stats/today`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(stats.body).toMatchObject({
        queueId,
        waitingCount: 1,
        servedCount: 1,
        abandonedCount: 1,
        noShowCount: 1,
      });
      expect(stats.body.averageWaitMinutes).toBeGreaterThanOrEqual(0);
      expect(stats.body.averageServiceDurationMinutes).toBeGreaterThanOrEqual(0);
    });

    it("averages are null when the queue has no entries yet today", async () => {
      const owner = await signUpAndVerify("f-owner@example.com", "F's Shop", "Owner F");
      const { queueId } = await setUpQueue(owner.accessToken, "F");

      const stats = await request(app.getHttpServer())
        .get(`/tenants/me/queues/${queueId}/stats/today`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(stats.body).toMatchObject({
        waitingCount: 0,
        servedCount: 0,
        abandonedCount: 0,
        noShowCount: 0,
        averageWaitMinutes: null,
        averageServiceDurationMinutes: null,
      });
    });

    it("blocks reading another tenant's queue stats (404, not a leak)", async () => {
      const tenantA = await signUpAndVerify("g-owner@example.com", "G's Shop", "Owner G");
      const tenantB = await signUpAndVerify("h-owner@example.com", "H's Shop", "Owner H");
      const { queueId } = await setUpQueue(tenantA.accessToken, "G");

      await request(app.getHttpServer())
        .get(`/tenants/me/queues/${queueId}/stats/today`)
        .set("Authorization", `Bearer ${tenantB.accessToken}`)
        .expect(404);
    });
  });
});
