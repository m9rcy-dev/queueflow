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
 * (G-40) — every other integration suite disables it (see the comment in
 * each) since they legitimately need to make more requests than a real
 * anonymous customer would in a minute.
 */
describe("Rate limiting on the public join endpoint (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    delete process.env.DISABLE_RATE_LIMITING;

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
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

  it("allows 5 joins per minute and rejects the 6th with 429 (G-40)", async () => {
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName: "Rate Ltd", ownerName: "Owner R", email: "rate-owner@example.com" })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "rate-owner@example.com" },
    });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const owner = (
      await request(app.getHttpServer())
        .post("/auth/login/verify")
        .send({ email: "rate-owner@example.com", code: recoverCodeFromHash(latest.codeHash) })
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

    const attempt = (phone: string) =>
      request(app.getHttpServer())
        .post(`/public/queues/${queue.body.id}/entries`)
        .send({ serviceId: service.body.id, customerName: "Rate Test", customerPhone: phone });

    for (let i = 0; i < 5; i += 1) {
      const res = await attempt(`02100000${i}`);
      expect(res.status).toBe(201);
    }
    const sixth = await attempt("0210000099");
    expect(sixth.status).toBe(429);
  });
});
