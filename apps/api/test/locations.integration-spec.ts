import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Phase 2 integration tests — real Postgres via Testcontainers (AGENTS.md
 * §5). Focuses on the cross-tenant isolation acceptance criterion carried
 * over from Phase 1 ("the same way Phase 1's was", per PROJECT_STATUS.md's
 * Next Task) plus the location→service ownership cross-check and the
 * split-business-hours round-trip.
 */
describe("Locations & Services (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    // Tests must never depend on a real external provider being configured
    // (or paid/rate-limited) in the developer's local .env — always mock.
    process.env.EMAIL_PROVIDER = "mock";
    process.env.SMS_PROVIDER = "mock";
    // This suite makes far more requests than any real per-route limit
    // (G-40) allows — rate limiting itself is covered by its own dedicated
    // suite (rate-limit.integration-spec.ts), not re-tested here.
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
    const code = recoverCodeFromHash(latest.codeHash);

    const verifyRes = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email, code })
      .expect(201);

    return verifyRes.body as { accessToken: string };
  }

  it("creates a location, sets split business hours, and creates a service under it", async () => {
    const owner = await signUpAndVerify("loc-owner-a@example.com", "Joe's Barbers", "Joe");

    const locationRes = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Christchurch", timezone: "Pacific/Auckland" })
      .expect(201);

    const hoursRes = await request(app.getHttpServer())
      .put(`/tenants/me/locations/${locationRes.body.id}/business-hours`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        entries: [
          { dayOfWeek: 1, opensAtMinutes: 540, closesAtMinutes: 720 },
          { dayOfWeek: 1, opensAtMinutes: 780, closesAtMinutes: 1020 },
        ],
      })
      .expect(200);
    expect(hoursRes.body).toHaveLength(2); // split period survives (plan §39)

    const serviceRes = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: locationRes.body.id, name: "Haircut", durationMinutes: 25 })
      .expect(201);
    expect(serviceRes.body.active).toBe(true);
    expect(serviceRes.body.queueEnabled).toBe(true);
  });

  it("rejects an invalid IANA timezone", async () => {
    const owner = await signUpAndVerify("loc-owner-b@example.com", "Bad TZ Co", "Owner B");
    await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Nowhere", timezone: "Not/ARealZone" })
      .expect(400);
  });

  it("rejects creating a service against another tenant's location (404, not 400)", async () => {
    const tenantA = await signUpAndVerify("loc-owner-c@example.com", "Tenant A", "Owner C");
    const tenantB = await signUpAndVerify("loc-owner-d@example.com", "Tenant B", "Owner D");

    const tenantALocation = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "A's Shop", timezone: "Pacific/Auckland" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ locationId: tenantALocation.body.id, name: "Sneaky Service", durationMinutes: 10 })
      .expect(404);
  });

  it("blocks cross-tenant read/write on both locations and services", async () => {
    const tenantA = await signUpAndVerify("loc-owner-e@example.com", "Tenant E", "Owner E");
    const tenantB = await signUpAndVerify("loc-owner-f@example.com", "Tenant F", "Owner F");

    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "E's Shop", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/tenants/me/locations/${location.body.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/tenants/me/locations/${location.body.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ name: "Hijacked" })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/tenants/me/services/${service.body.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/tenants/me/services/${service.body.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ active: false })
      .expect(404);

    // Tenant B's own list must never include tenant A's data.
    const tenantBLocations = await request(app.getHttpServer())
      .get("/tenants/me/locations")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(200);
    expect(tenantBLocations.body).toEqual([]);

    // The original row must be untouched by tenant B's rejected write.
    const original = await prisma.location.findUniqueOrThrow({ where: { id: location.body.id } });
    expect(original.name).toBe("E's Shop");
  });

  it("blocks STAFF from creating a location (role-gated, TENANT_OWNER/TENANT_ADMIN only)", async () => {
    const owner = await signUpAndVerify("loc-owner-g@example.com", "Tenant G", "Owner G");

    const inviteRes = await request(app.getHttpServer())
      .post("/tenants/me/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ email: "staff-g@example.com", role: "STAFF" })
      .expect(201);
    const invite = await prisma.tenantInvite.findUniqueOrThrow({
      where: { id: inviteRes.body.id },
    });

    await request(app.getHttpServer()).post(`/auth/invites/${invite.token}/request`).expect(202);
    const inviteRow = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.id } });
    const code = recoverCodeFromHash(inviteRow.codeHash!);
    const staffAuth = await request(app.getHttpServer())
      .post(`/auth/invites/${invite.token}/verify`)
      .send({ code })
      .expect(201);

    await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${staffAuth.body.accessToken}`)
      .send({ name: "Should Not Work", timezone: "Pacific/Auckland" })
      .expect(403);
  });
});
