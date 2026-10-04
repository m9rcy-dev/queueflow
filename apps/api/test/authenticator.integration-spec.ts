import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { codeForStep, timeStep } from "../src/authenticator/totp";

/**
 * Phase 15 (Authenticator App Login, ADR-014) — real Postgres. Codes are
 * computed here from the secret the setup endpoint returns, exactly as an
 * authenticator app would. Confirming setup uses the current 30-second
 * step, so the first login in each test uses the next step (still inside
 * the ±1 step drift window) — the same step twice is a replay.
 */
describe("Authenticator app login (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;
  let counter = 0;

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
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) return candidate;
    }
    throw new Error("Could not recover code from hash");
  }

  const currentStep = (): number => timeStep(new Date());

  async function latestEmailedStaffCode(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return recoverCodeFromHash(latest.codeHash);
  }

  async function emailedStaffCodeCount(email: string): Promise<number> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return prisma.loginCode.count({ where: { userId: user.id } });
  }

  /** A business owner, logged in by emailed code. */
  async function signUpOwner() {
    counter += 1;
    const email = `totp-owner-${counter}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName: `TOTP Biz ${counter}`, ownerName: "Owner", email })
      .expect(202);
    const res = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email, code: await latestEmailedStaffCode(email) })
      .expect(201);
    return {
      email,
      auth: { Authorization: `Bearer ${res.body.accessToken}` },
      tenantId: res.body.tenant.id as string,
    };
  }

  /** Sets up and confirms an authenticator for the logged-in staff member; returns the secret. */
  async function enableStaffAuthenticator(auth: Record<string, string>): Promise<string> {
    const setup = await request(app.getHttpServer())
      .post("/auth/me/authenticator/setup")
      .set(auth)
      .expect(201);
    const secret = setup.body.secret as string;
    await request(app.getHttpServer())
      .post("/auth/me/authenticator/confirm")
      .set(auth)
      .send({ code: codeForStep(secret, currentStep()) })
      .expect(201);
    return secret;
  }

  function staffVerify(email: string, code: string) {
    return request(app.getHttpServer()).post("/auth/login/verify").send({ email, code });
  }

  it("sets up with a QR link, rejects a wrong confirm code, and stores the secret encrypted", async () => {
    const owner = await signUpOwner();
    const setup = await request(app.getHttpServer())
      .post("/auth/me/authenticator/setup")
      .set(owner.auth)
      .expect(201);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/QueueFlow%3A/);
    expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);

    const wrong = await request(app.getHttpServer())
      .post("/auth/me/authenticator/confirm")
      .set(owner.auth)
      .send({ code: "000000" })
      .expect(400);
    expect(wrong.body.code).toBe("INVALID_AUTHENTICATOR_CODE");
    // Not enabled until confirmed.
    const before = await request(app.getHttpServer())
      .get("/auth/me/authenticator")
      .set(owner.auth)
      .expect(200);
    expect(before.body).toEqual({ enabled: false });

    await request(app.getHttpServer())
      .post("/auth/me/authenticator/confirm")
      .set(owner.auth)
      .send({ code: codeForStep(setup.body.secret, currentStep()) })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get("/auth/me/authenticator")
      .set(owner.auth)
      .expect(200);
    expect(after.body).toEqual({ enabled: true });

    const row = await prisma.authenticatorCredential.findFirstOrThrow({
      where: { user: { email: owner.email } },
    });
    expect(row.secretEncrypted).not.toContain(setup.body.secret);
    expect(row.pendingSecretEncrypted).toBeNull();
  });

  it("logs in with an authenticator code, sends no email, and rejects a replayed code", async () => {
    const owner = await signUpOwner();
    const secret = await enableStaffAuthenticator(owner.auth);
    const emailsBefore = await emailedStaffCodeCount(owner.email);

    const requested = await request(app.getHttpServer())
      .post("/auth/login/request")
      .send({ email: owner.email })
      .expect(202);
    expect(await emailedStaffCodeCount(owner.email)).toBe(emailsBefore);

    const code = codeForStep(secret, currentStep() + 1);
    const res = await staffVerify(owner.email, code).expect(201);
    expect(res.body.accessToken).toBeTruthy();

    const replay = await staffVerify(owner.email, code).expect(401);
    expect(replay.body.code).toBe("INVALID_LOGIN_CODE");

    // The request response is identical for an email-code account (no signal, G-05).
    const plain = await signUpOwner();
    const plainRequested = await request(app.getHttpServer())
      .post("/auth/login/request")
      .send({ email: plain.email })
      .expect(202);
    expect(plainRequested.body).toEqual(requested.body);
  });

  it("'Email me a code instead' always works, and its code logs in", async () => {
    const owner = await signUpOwner();
    await enableStaffAuthenticator(owner.auth);
    const before = await emailedStaffCodeCount(owner.email);

    await request(app.getHttpServer())
      .post("/auth/login/request")
      .send({ email: owner.email, forceEmail: true })
      .expect(202);
    expect(await emailedStaffCodeCount(owner.email)).toBe(before + 1);
    await staffVerify(owner.email, await latestEmailedStaffCode(owner.email)).expect(201);
  });

  it("locks the authenticator after 5 wrong codes, while the emailed code keeps working", async () => {
    const owner = await signUpOwner();
    const secret = await enableStaffAuthenticator(owner.auth);

    for (let i = 0; i < 5; i += 1) {
      await staffVerify(owner.email, "000000").expect(401);
    }
    // Even the right authenticator code is refused while locked...
    await staffVerify(owner.email, codeForStep(secret, currentStep() + 1)).expect(401);
    // ...but the person isn't locked out.
    await request(app.getHttpServer())
      .post("/auth/login/request")
      .send({ email: owner.email, forceEmail: true })
      .expect(202);
    await staffVerify(owner.email, await latestEmailedStaffCode(owner.email)).expect(201);
  });

  it("keeps the old phone working until a new one is confirmed, then only the new one", async () => {
    const owner = await signUpOwner();
    const oldSecret = await enableStaffAuthenticator(owner.auth);

    const newSetup = await request(app.getHttpServer())
      .post("/auth/me/authenticator/setup")
      .set(owner.auth)
      .expect(201);
    const newSecret = newSetup.body.secret as string;
    expect(newSecret).not.toBe(oldSecret);
    // Mid-setup, the old app still logs in.
    await staffVerify(owner.email, codeForStep(oldSecret, currentStep() + 1)).expect(201);

    await request(app.getHttpServer())
      .post("/auth/me/authenticator/confirm")
      .set(owner.auth)
      .send({ code: codeForStep(newSecret, currentStep()) })
      .expect(201);
    await staffVerify(owner.email, codeForStep(oldSecret, currentStep() + 1)).expect(401);
    await staffVerify(owner.email, codeForStep(newSecret, currentStep() + 1)).expect(201);
  });

  it("turning it off goes back to emailed codes", async () => {
    const owner = await signUpOwner();
    await enableStaffAuthenticator(owner.auth);
    await request(app.getHttpServer()).delete("/auth/me/authenticator").set(owner.auth).expect(200);
    const before = await emailedStaffCodeCount(owner.email);
    await request(app.getHttpServer())
      .post("/auth/login/request")
      .send({ email: owner.email })
      .expect(202);
    expect(await emailedStaffCodeCount(owner.email)).toBe(before + 1);
  });

  describe("customers", () => {
    async function signUpCustomer(tenantId: string, email: string, phone: string) {
      await request(app.getHttpServer())
        .post("/public/customers/signup")
        .send({ tenantId, name: "Pat", phone, email })
        .expect(202);
      const customer = await prisma.customer.findUniqueOrThrow({
        where: { tenantId_email: { tenantId, email } },
      });
      const latest = await prisma.customerLoginCode.findFirstOrThrow({
        where: { customerId: customer.id },
        orderBy: { createdAt: "desc" },
      });
      const res = await request(app.getHttpServer())
        .post("/public/customers/login/verify")
        .send({ tenantId, email, code: recoverCodeFromHash(latest.codeHash) })
        .expect(201);
      return { customerId: customer.id, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
    }

    it("a customer logs in with their authenticator, scoped to that business only", async () => {
      const bizA = await signUpOwner();
      const bizB = await signUpOwner();
      const email = "totp-customer@example.com";
      const customerA = await signUpCustomer(bizA.tenantId, email, "021 777 0001");
      // Same person, separate account at another business (D-09).
      await signUpCustomer(bizB.tenantId, email, "021 777 0001");

      const setup = await request(app.getHttpServer())
        .post("/customers/me/authenticator/setup")
        .set(customerA.auth)
        .expect(201);
      // The app entry names the business.
      expect(decodeURIComponent(setup.body.otpauthUri)).toContain("QueueFlow (TOTP Biz");
      await request(app.getHttpServer())
        .post("/customers/me/authenticator/confirm")
        .set(customerA.auth)
        .send({ code: codeForStep(setup.body.secret, currentStep()) })
        .expect(201);

      const before = await prisma.customerLoginCode.count({
        where: { customerId: customerA.customerId },
      });
      await request(app.getHttpServer())
        .post("/public/customers/login/request")
        .send({ tenantId: bizA.tenantId, email })
        .expect(202);
      expect(
        await prisma.customerLoginCode.count({ where: { customerId: customerA.customerId } }),
      ).toBe(before);

      const code = codeForStep(setup.body.secret, currentStep() + 1);
      // Business B's account has no authenticator — A's code means nothing there.
      await request(app.getHttpServer())
        .post("/public/customers/login/verify")
        .send({ tenantId: bizB.tenantId, email, code })
        .expect(401);
      const res = await request(app.getHttpServer())
        .post("/public/customers/login/verify")
        .send({ tenantId: bizA.tenantId, email, code })
        .expect(201);
      expect(res.body.customer.id).toBe(customerA.customerId);
    });

    it("a staff token can't touch a customer's authenticator routes, or vice versa", async () => {
      const owner = await signUpOwner();
      const customer = await signUpCustomer(
        owner.tenantId,
        "totp-cross@example.com",
        "021 777 0002",
      );
      await request(app.getHttpServer())
        .post("/customers/me/authenticator/setup")
        .set(owner.auth)
        .expect(401);
      await request(app.getHttpServer())
        .post("/auth/me/authenticator/setup")
        .set(customer.auth)
        .expect(401);
    });
  });
});
