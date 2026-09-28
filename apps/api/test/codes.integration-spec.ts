import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/** Phase 4's minimal code resolver (§4.5/ADR-005, QUEUE context only). */
describe("Codes / QR resolver (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    process.env.DISABLE_RATE_LIMITING = "true";

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

  it("creates a code for a queue and resolves it publicly with the right landing info", async () => {
    const owner = await signUpAndVerify("code-owner-a@example.com", "Joe's Barbers", "Joe");
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Christchurch", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "Main Queue" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ serviceId: service.body.id })
      .expect(201);

    const codeRes = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(codeRes.body.publicCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/); // no 0/O/1/I/L

    const resolved = await request(app.getHttpServer())
      .get(`/public/codes/${codeRes.body.publicCode}`)
      .expect(200);
    expect(resolved.body).toEqual({
      contextType: "QUEUE",
      tenant: { name: "Joe's Barbers" },
      location: { name: "Christchurch" },
      queue: { id: queue.body.id, name: "Main Queue", status: "ACTIVE" },
      capabilities: ["JOIN_QUEUE"],
      services: [{ id: service.body.id, name: "Haircut", durationMinutes: 20 }],
    });
  });

  it("404s for an unrecognized code, without distinguishing it from a deactivated one", async () => {
    await request(app.getHttpServer()).get("/public/codes/NOTAREAL").expect(404);
  });

  it("blocks creating a code for another tenant's queue (404, not a leak)", async () => {
    const tenantA = await signUpAndVerify("code-owner-b@example.com", "Tenant A", "Owner B");
    const tenantB = await signUpAndVerify("code-owner-c@example.com", "Tenant B", "Owner C");

    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "A's Shop", timezone: "Pacific/Auckland" })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ locationId: location.body.id, name: "A's Queue" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
  });

  it("STAFF cannot create a code (role-gated, TENANT_OWNER/TENANT_ADMIN only)", async () => {
    const owner = await signUpAndVerify("code-owner-d@example.com", "Tenant D", "Owner D");
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "D's Shop", timezone: "Pacific/Auckland" })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "D's Queue" })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post("/tenants/me/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ email: "staff-d@example.com", role: "STAFF" })
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
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set("Authorization", `Bearer ${staffAuth.body.accessToken}`)
      .expect(403);
  });
});
