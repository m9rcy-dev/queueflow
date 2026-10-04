import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/** Customer accounts (Phase 9, D-09) — self-service signup/login, staff in-person signup, and the portal (identity code, active entry). */
describe("Customer accounts & portal (integration)", () => {
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

  async function signUpBusinessAndVerify(email: string, businessName: string, ownerName: string) {
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
    return verifyRes.body as { accessToken: string; tenant: { id: string; name: string } };
  }

  async function signUpCustomerAndVerify(
    tenantId: string,
    email: string,
    name: string,
    phone: string,
  ) {
    await request(app.getHttpServer())
      .post("/public/customers/signup")
      .send({ tenantId, name, phone, email })
      .expect(202);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_email: { tenantId, email } },
    });
    const latest = await prisma.customerLoginCode.findFirstOrThrow({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });
    const verifyRes = await request(app.getHttpServer())
      .post("/public/customers/login/verify")
      .send({ tenantId, email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);
    return verifyRes.body as {
      accessToken: string;
      refreshToken: string;
      customer: { id: string };
    };
  }

  it("mints and publicly resolves a GENERAL 'sign up here' code (D-10)", async () => {
    const owner = await signUpBusinessAndVerify("g-owner@example.com", "G's Shop", "Owner G");

    const codeRes = await request(app.getHttpServer())
      .post("/tenants/me/codes")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ contextType: "GENERAL" })
      .expect(201);
    expect(codeRes.body.contextType).toBe("GENERAL");

    const resolved = await request(app.getHttpServer())
      .get(`/public/codes/${codeRes.body.publicCode}`)
      .expect(200);
    expect(resolved.body).toEqual({
      contextType: "GENERAL",
      tenant: { id: owner.tenant.id, name: "G's Shop", logoPath: null },
      capabilities: ["CREATE_ACCOUNT"],
    });
  });

  it("self-service signup + OTP login issues a working session, and the portal shows the identity code", async () => {
    const owner = await signUpBusinessAndVerify("h-owner@example.com", "H's Shop", "Owner H");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "h-customer@example.com",
      "Hana Customer",
      "021 555 0001",
    );

    const me = await request(app.getHttpServer())
      .get("/customers/me")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      customer: {
        firstName: "Hana Customer",
        phoneE164: "+64215550001",
        email: "h-customer@example.com",
      },
      tenant: { id: owner.tenant.id, name: "H's Shop" },
    });
    // Phase 12 (G-39 audit): CUSTOMER_IDENTITY is a secret, capability-bearing
    // token (scanning it instant-joins a queue as this customer), so it uses
    // the long high-entropy alphabet, not the short printed one QUEUE/
    // DISPLAY/GENERAL use.
    expect(me.body.identityCode.length).toBeGreaterThanOrEqual(25);

    const identity = await request(app.getHttpServer())
      .get("/customers/me/identity-code")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);
    expect(identity.body.publicCode).toBe(me.body.identityCode);
  });

  it("regenerating the identity code rotates it — the old code no longer belongs to this customer", async () => {
    const owner = await signUpBusinessAndVerify("i-owner@example.com", "I's Shop", "Owner I");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "i-customer@example.com",
      "Ivy Customer",
      "021 555 0002",
    );

    const before = await request(app.getHttpServer())
      .get("/customers/me/identity-code")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);

    const regenerated = await request(app.getHttpServer())
      .post("/customers/me/identity-code/regenerate")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(201);
    expect(regenerated.body.publicCode).not.toBe(before.body.publicCode);

    const after = await request(app.getHttpServer())
      .get("/customers/me/identity-code")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);
    expect(after.body.publicCode).toBe(regenerated.body.publicCode);
  });

  it("staff in-person signup (G-56) mints an identity code immediately, no OTP required", async () => {
    const owner = await signUpBusinessAndVerify("j-owner@example.com", "J's Shop", "Owner J");

    const created = await request(app.getHttpServer())
      .post("/tenants/me/customers")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Jamie Walker", phone: "021 555 0003" })
      .expect(201);

    expect(created.body.customer).toMatchObject({ firstName: "Jamie Walker", email: null });
    // Phase 12 (G-39 audit): see the identical comment above.
    expect(created.body.identityCode.length).toBeGreaterThanOrEqual(25);
  });

  it("an anonymous queue join with an account-holder's own phone number links to their existing account — the portal's active-entry reflects it live", async () => {
    const owner = await signUpBusinessAndVerify("k-owner@example.com", "K's Shop", "Owner K");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "k-customer@example.com",
      "Kai Customer",
      "021 555 0004",
    );

    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "K's Location", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ locationId: location.body.id, name: "K's Queue" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ serviceId: service.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/public/queues/${queue.body.id}/entries`)
      .send({
        serviceId: service.body.id,
        customerName: "Kai Walk-in",
        customerPhone: "021 555 0004",
      })
      .expect(201);

    const activeEntry = await request(app.getHttpServer())
      .get("/customers/me/active-entry")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);
    expect(activeEntry.body).toMatchObject({
      queueId: queue.body.id,
      queueName: "K's Queue",
      status: "WAITING",
    });

    // Confirms it's really the same Customer row, not a duplicate.
    const customerCount = await prisma.customer.count({ where: { tenantId: owner.tenant.id } });
    expect(customerCount).toBe(1);
  });

  it("returns an empty body (no active entry) when the customer has nothing active in this tenant", async () => {
    const owner = await signUpBusinessAndVerify("l-owner@example.com", "L's Shop", "Owner L");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "l-customer@example.com",
      "Lee Customer",
      "021 555 0005",
    );

    const res = await request(app.getHttpServer())
      .get("/customers/me/active-entry")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it("rejects signup with an email already registered to a different phone number in the same tenant (409)", async () => {
    const owner = await signUpBusinessAndVerify("m-owner@example.com", "M's Shop", "Owner M");
    await signUpCustomerAndVerify(
      owner.tenant.id,
      "m-customer@example.com",
      "Max One",
      "021 555 0006",
    );

    await request(app.getHttpServer())
      .post("/public/customers/signup")
      .send({
        tenantId: owner.tenant.id,
        name: "Max Two",
        phone: "021 555 0007",
        email: "m-customer@example.com",
      })
      .expect(409);
  });

  it("silently no-ops requesting a login code for an unknown email (G-05)", async () => {
    const owner = await signUpBusinessAndVerify("n-owner@example.com", "N's Shop", "Owner N");
    await request(app.getHttpServer())
      .post("/public/customers/login/request")
      .send({ tenantId: owner.tenant.id, email: "nobody@example.com" })
      .expect(202);
  });

  it("rejects an incorrect OTP code (401), without revealing which part was wrong", async () => {
    const owner = await signUpBusinessAndVerify("o-owner@example.com", "O's Shop", "Owner O");
    await request(app.getHttpServer())
      .post("/public/customers/signup")
      .send({
        tenantId: owner.tenant.id,
        name: "Oli Customer",
        phone: "021 555 0008",
        email: "o-customer@example.com",
      })
      .expect(202);

    await request(app.getHttpServer())
      .post("/public/customers/login/verify")
      .send({ tenantId: owner.tenant.id, email: "o-customer@example.com", code: "000000" })
      .expect(401);
  });

  it("refresh rotates the token (old one is revoked); logout revokes the current one", async () => {
    const owner = await signUpBusinessAndVerify("p-owner@example.com", "P's Shop", "Owner P");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "p-customer@example.com",
      "Pia Customer",
      "021 555 0009",
    );

    const refreshed = await request(app.getHttpServer())
      .post("/public/customers/refresh")
      .send({ refreshToken: customerAuth.refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .post("/public/customers/refresh")
      .send({ refreshToken: customerAuth.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post("/public/customers/logout")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post("/public/customers/refresh")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it("a customer token is rejected on a staff route, and a staff token is rejected on a customer portal route (D-09 isolation)", async () => {
    const owner = await signUpBusinessAndVerify("q-owner@example.com", "Q's Shop", "Owner Q");
    const customerAuth = await signUpCustomerAndVerify(
      owner.tenant.id,
      "q-customer@example.com",
      "Quinn Customer",
      "021 555 0010",
    );

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${customerAuth.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get("/customers/me")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(401);
  });

  it("404s resolving a CUSTOMER_IDENTITY code publicly — no public consumer exists yet (Phase 10's job)", async () => {
    const owner = await signUpBusinessAndVerify("r-owner@example.com", "R's Shop", "Owner R");
    const created = await request(app.getHttpServer())
      .post("/tenants/me/customers")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Remy Walker", phone: "021 555 0011" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/public/codes/${created.body.identityCode}`)
      .expect(404);
  });
});
