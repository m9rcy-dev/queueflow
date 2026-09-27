import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Full-stack integration tests against a real Postgres (Testcontainers,
 * AGENTS.md §5) — not mocks. Covers the Phase 1 acceptance criteria
 * verbatim: a business can sign up and log back in via OTP; a user can
 * only access their own tenant's data; unauthorized cross-tenant access is
 * rejected.
 */
describe("Auth + tenant isolation (integration)", () => {
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
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await container?.stop();
  });

  /**
   * Test-only helper: the OTP is one-way hashed in the database (by
   * design, ADR-004), so there's no plaintext to read back. Rather than
   * scrape the mock mail provider's log output (brittle, format-coupled),
   * this recovers the code by brute-forcing the small 6-digit space against
   * the stored hash — deterministic, and only possible in a test precisely
   * because the code space is intentionally small.
   */
  function recoverCodeFromHash(codeHash: string): string {
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = i.toString().padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) {
        return candidate;
      }
    }
    throw new Error("Could not recover code from hash");
  }

  async function getLoginCodeFor(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return recoverCodeFromHash(latest.codeHash);
  }

  async function getInviteCode(inviteId: string): Promise<string> {
    const invite = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: inviteId } });
    return recoverCodeFromHash(invite.codeHash!);
  }

  async function signUpAndVerify(email: string, businessName: string, ownerName: string) {
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName, ownerName, email })
      .expect(202);

    const code = await getLoginCodeFor(email);

    const verifyRes = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email, code })
      .expect(201);

    return verifyRes.body as {
      accessToken: string;
      refreshToken: string;
      tenant: { id: string };
    };
  }

  it("rejects every route except explicitly public ones without a token", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).get("/tenants/me").expect(401);
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("signs up a business and logs back in via OTP", async () => {
    const { accessToken, tenant } = await signUpAndVerify(
      "owner-a@example.com",
      "Joe's Barbers",
      "Joe",
    );

    const res = await request(app.getHttpServer())
      .get("/tenants/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(tenant.id);
    expect(res.body.name).toBe("Joe's Barbers");
  });

  it("rejects signing up the same email twice", async () => {
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName: "Dup", ownerName: "Dup", email: "owner-a@example.com" })
      .expect(409);
  });

  it("rejects a wrong OTP code with a generic message and never leaks whether the email exists", async () => {
    const wrongEmail = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email: "nobody-at-all@example.com", code: "000000" })
      .expect(401);
    const wrongCode = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email: "owner-a@example.com", code: "000000" })
      .expect(401);

    expect(wrongEmail.body.message).toBe(wrongCode.body.message);
  });

  it("blocks cross-tenant access — the core Phase 1 acceptance criterion", async () => {
    const tenantA = await signUpAndVerify("owner-b@example.com", "Tenant A Co", "Owner A");
    const tenantB = await signUpAndVerify("owner-c@example.com", "Tenant B Co", "Owner B");

    const inviteRes = await request(app.getHttpServer())
      .post("/tenants/me/invites")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ email: "staff-a@example.com", role: "STAFF" })
      .expect(201);
    const tenantAInviteId = inviteRes.body.id;

    const tenantBInvites = await request(app.getHttpServer())
      .get("/tenants/me/invites")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(200);
    expect(
      tenantBInvites.body.find((i: { id: string }) => i.id === tenantAInviteId),
    ).toBeUndefined();

    await request(app.getHttpServer())
      .delete(`/tenants/me/invites/${tenantAInviteId}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);

    const tenantBProfile = await request(app.getHttpServer())
      .get("/tenants/me")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(200);
    expect(tenantBProfile.body.id).toBe(tenantB.tenant.id);
    expect(tenantBProfile.body.id).not.toBe(tenantA.tenant.id);
  });

  it("completes the full staff invite flow and enforces role restrictions", async () => {
    const owner = await signUpAndVerify("owner-d@example.com", "Invite Co", "Owner D");

    const inviteRes = await request(app.getHttpServer())
      .post("/tenants/me/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ email: "new-staff@example.com", role: "STAFF" })
      .expect(201);

    const inviteRow = await prisma.tenantInvite.findUniqueOrThrow({
      where: { id: inviteRes.body.id },
    });

    await request(app.getHttpServer()).post(`/auth/invites/${inviteRow.token}/request`).expect(202);
    const code = await getInviteCode(inviteRow.id);

    const acceptRes = await request(app.getHttpServer())
      .post(`/auth/invites/${inviteRow.token}/verify`)
      .send({ code })
      .expect(201);

    expect(acceptRes.body.role).toBe("STAFF");
    expect(acceptRes.body.tenant.id).toBe(owner.tenant.id);

    await request(app.getHttpServer())
      .post("/tenants/me/invites")
      .set("Authorization", `Bearer ${acceptRes.body.accessToken}`)
      .send({ email: "another@example.com", role: "STAFF" })
      .expect(403);
  });

  it("rotates refresh tokens and rejects reuse of a rotated-out token", async () => {
    const owner = await signUpAndVerify("owner-e@example.com", "Refresh Co", "Owner E");

    const refreshRes = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    expect(refreshRes.body.accessToken).toBeDefined();

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
  });
});
