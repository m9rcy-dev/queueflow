import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * The one suite that deliberately leaves real rate limiting switched on
 * (G-38) — every other integration suite disables it since they
 * legitimately need to make more requests than a real anonymous customer
 * would in a window. Each dimension below gets its own fully isolated
 * Postgres container + app instance — the join route's IP-based and
 * phone-based counters are two independent in-process guards (one global,
 * one local), and sharing a single app instance across their tests would
 * make each test's expected count depend on exactly how many requests a
 * *different* test already made from the same process. Fresh instances
 * side-step that entirely rather than trying to account for it.
 */
describe("Rate limiting (integration, G-38)", () => {
  jest.setTimeout(180_000);

  function recoverCodeFromHash(codeHash: string): string {
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = i.toString().padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) {
        return candidate;
      }
    }
    throw new Error("Could not recover code from hash");
  }

  async function bootApp(): Promise<{
    container: StartedPostgreSqlContainer;
    app: INestApplication;
    prisma: PrismaClient;
  }> {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    process.env.EMAIL_PROVIDER = "mock";
    process.env.SMS_PROVIDER = "mock";
    delete process.env.DISABLE_RATE_LIMITING;

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    const prisma = new PrismaClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0); // one bound port per suite — see jest-integration.config.js
    return { container, app, prisma };
  }

  async function setUpQueue(app: INestApplication, prisma: PrismaClient, email: string) {
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName: "Rate Ltd", ownerName: "Owner R", email })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const owner = (
      await request(app.getHttpServer())
        .post("/auth/login/verify")
        .send({ email, code: recoverCodeFromHash(latest.codeHash) })
        .expect(201)
    ).body as { accessToken: string };

    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Rate Shop", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 15 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "Rate Queue" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ serviceId: service.body.id })
      .expect(201);
    return { queueId: queue.body.id as string, serviceId: service.body.id as string };
  }

  describe("join: 5/hour per phone", () => {
    let container: StartedPostgreSqlContainer;
    let app: INestApplication;
    let prisma: PrismaClient;

    beforeAll(async () => {
      ({ container, app, prisma } = await bootApp());
    });
    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
      await container?.stop();
    });

    it("allows 5 joins from the same phone, rejects the 6th with 429", async () => {
      const { queueId, serviceId } = await setUpQueue(app, prisma, "phone-owner@example.com");
      const attempt = () =>
        request(app.getHttpServer())
          .post(`/public/queues/${queueId}/entries`)
          .send({ serviceId, customerName: "Phone Test", customerPhone: "021 555 1111" });

      // Cancel each ticket immediately after joining — otherwise the 2nd
      // attempt hits G-34's "max active tickets per customer" (409) before
      // ever reaching the rate limiter this test actually means to exercise.
      for (let i = 0; i < 5; i += 1) {
        const res = await attempt();
        expect(res.status).toBe(201);
        await request(app.getHttpServer())
          .post(`/public/queue-entries/${res.body.publicToken}/cancel`)
          .send({})
          .expect(201);
      }
      const sixth = await attempt();
      expect(sixth.status).toBe(429);
    });
  });

  describe("join: 20/hour per IP", () => {
    let container: StartedPostgreSqlContainer;
    let app: INestApplication;
    let prisma: PrismaClient;

    beforeAll(async () => {
      ({ container, app, prisma } = await bootApp());
    });
    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
      await container?.stop();
    });

    it("allows 20 joins from distinct phones (same IP — the test runner), rejects the 21st with 429", async () => {
      const { queueId, serviceId } = await setUpQueue(app, prisma, "ip-owner@example.com");
      const attempt = (phone: string) =>
        request(app.getHttpServer())
          .post(`/public/queues/${queueId}/entries`)
          .send({ serviceId, customerName: "IP Test", customerPhone: phone });

      // Distinct phones throughout, so the per-phone guard (5/hour) never
      // fires — only the shared IP counter should be the thing that trips.
      for (let i = 0; i < 20; i += 1) {
        const res = await attempt(`02166600${String(i).padStart(2, "0")}`);
        expect(res.status).toBe(201);
      }
      const twentyFirst = await attempt("0219999999");
      expect(twentyFirst.status).toBe(429);
    });
  });

  describe("public ticket read: 60/min per token", () => {
    let container: StartedPostgreSqlContainer;
    let app: INestApplication;
    let prisma: PrismaClient;

    beforeAll(async () => {
      ({ container, app, prisma } = await bootApp());
    });
    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
      await container?.stop();
    });

    it("allows 60 reads of the same ticket, rejects the 61st with 429 — a different ticket is unaffected", async () => {
      const { queueId, serviceId } = await setUpQueue(app, prisma, "token-owner@example.com");
      const joinRes = await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Token Test", customerPhone: "021 555 2222" })
        .expect(201);
      const token = joinRes.body.publicToken as string;

      for (let i = 0; i < 60; i += 1) {
        const res = await request(app.getHttpServer()).get(`/public/queue-entries/${token}`);
        expect(res.status).toBe(200);
      }
      const sixtyFirst = await request(app.getHttpServer()).get(`/public/queue-entries/${token}`);
      expect(sixtyFirst.status).toBe(429);

      // A second customer's own ticket is a different token — unaffected
      // by the first ticket's exhausted count.
      const otherJoin = await request(app.getHttpServer())
        .post(`/public/queues/${queueId}/entries`)
        .send({ serviceId, customerName: "Other Token Test", customerPhone: "021 555 3333" })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/public/queue-entries/${otherJoin.body.publicToken}`)
        .expect(200);
    });
  });
});
