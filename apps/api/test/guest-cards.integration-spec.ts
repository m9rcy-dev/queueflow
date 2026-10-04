import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/** Kiosk hardware & guest cards (Phase 10, D-10/D-11/D-14) — the numbered card pool, and scan-to-join for both guest cards and CUSTOMER_IDENTITY codes. */
describe("Guest cards & scan-to-join (integration)", () => {
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

  /** Location + one active service + one ACTIVE queue with that service attached — the "exactly one service" shape scan-to-join requires. */
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

  /** Phase 16: Staff invites and counter tablets need a location (ADR-015); a fresh one, just for that. */
  async function createLocation(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Main", timezone: "Pacific/Auckland" })
      .expect(201);
    return res.body.id as string;
  }

  describe("guest card pool", () => {
    it("grows an empty pool, then shrinks it, refusing to drop a card that's currently in use", async () => {
      const owner = await signUpAndVerify("a-owner@example.com", "A's Shop", "Owner A");
      const { locationId, queueId } = await setUpQueue(owner.accessToken, "A");

      const grown = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 2 })
        .expect(200);
      expect(grown.body).toEqual([
        expect.objectContaining({ guestNumber: 1, inUse: false }),
        expect.objectContaining({ guestNumber: 2, inUse: false }),
      ]);

      // Put card 1 in use via a scan.
      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: grown.body[0].publicCode })
        .expect(201);

      await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 0 })
        .expect(409);

      // Shrinking to 1 (removing only the free card 2) succeeds.
      const shrunk = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);
      expect(shrunk.body).toEqual([expect.objectContaining({ guestNumber: 1, inUse: true })]);
    });

    it("re-growing after a full shrink continues numbering past every guestNumber ever used at this location (no unique-constraint collision)", async () => {
      const owner = await signUpAndVerify("b-owner@example.com", "B's Shop", "Owner B");
      const { locationId } = await setUpQueue(owner.accessToken, "B");

      await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 3 })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 0 })
        .expect(200);

      const regrown = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);
      expect(regrown.body).toEqual([expect.objectContaining({ guestNumber: 4, inUse: false })]);
    });

    it("STAFF (non-admin) cannot resize the pool (role-gated, TENANT_OWNER/TENANT_ADMIN only)", async () => {
      const owner = await signUpAndVerify("c-owner@example.com", "C's Shop", "Owner C");
      const { locationId } = await setUpQueue(owner.accessToken, "C");

      const inviteRes = await request(app.getHttpServer())
        .post("/tenants/me/invites")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          email: "staff-c@example.com",
          role: "STAFF",
          locationId: await createLocation(owner.accessToken),
        })
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
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${staffAuth.body.accessToken}`)
        .send({ poolSize: 2 })
        .expect(403);
    });
  });

  describe("scan-to-join", () => {
    it("guest card: instant self-serve join, idempotent re-scan, auto-release on completion, and re-scan after release mints a fresh entry", async () => {
      const owner = await signUpAndVerify("d-owner@example.com", "D's Shop", "Owner D");
      const { locationId, queueId } = await setUpQueue(owner.accessToken, "D");
      const pool = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);
      const card = pool.body[0].publicCode;

      const first = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: card })
        .expect(201);
      expect(first.body).toMatchObject({
        ticketNumber: 1,
        status: "WAITING",
        customerName: "Guest 1",
        customerPhone: "",
        guestCardNumber: 1,
      });

      // Idempotent re-scan (G-54/D-11) — same entry, no duplicate ticket.
      const again = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: card })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);

      const afterFirstScan = await request(app.getHttpServer())
        .get(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(afterFirstScan.body).toEqual([expect.objectContaining({ inUse: true })]);

      // Complete the ticket — card should auto-release (D-14).
      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/call-next`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${first.body.id}/start`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${first.body.id}/complete`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(201);

      const afterComplete = await request(app.getHttpServer())
        .get(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(afterComplete.body).toEqual([expect.objectContaining({ inUse: false })]);

      // Re-scanning the now-free card mints a genuinely new ticket.
      const second = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: card })
        .expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(second.body.ticketNumber).toBe(2);
    });

    it("staff-assisted cancel releases a guest card too (no self-service path exists for guest-card users, by design)", async () => {
      const owner = await signUpAndVerify("e-owner@example.com", "E's Shop", "Owner E");
      const { locationId, queueId } = await setUpQueue(owner.accessToken, "E");
      const pool = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);
      const scanRes = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: pool.body[0].publicCode })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/tenants/me/queue-entries/${scanRes.body.id}/cancel`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({})
        .expect(201);

      const afterCancel = await request(app.getHttpServer())
        .get(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(afterCancel.body).toEqual([expect.objectContaining({ inUse: false })]);
    });

    it("rejects a guest card scanned against a different location's queue (404, not a leak)", async () => {
      const owner = await signUpAndVerify("f-owner@example.com", "F's Shop", "Owner F");
      const { queueId } = await setUpQueue(owner.accessToken, "F1");
      const { locationId: otherLocationId } = await setUpQueue(owner.accessToken, "F2");
      const otherPool = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${otherLocationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: otherPool.body[0].publicCode })
        .expect(404);
    });

    it("rejects scanning when the queue has zero or more than one active service configured", async () => {
      const owner = await signUpAndVerify("g-owner@example.com", "G's Shop", "Owner G");
      const { locationId, queueId, serviceId } = await setUpQueue(owner.accessToken, "G");
      const pool = await request(app.getHttpServer())
        .put(`/tenants/me/locations/${locationId}/guest-cards`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ poolSize: 1 })
        .expect(200);

      const secondService = await request(app.getHttpServer())
        .post("/tenants/me/services")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ locationId, name: "Beard Trim", durationMinutes: 10 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/services`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ serviceId: secondService.body.id })
        .expect(201);

      const twoServices = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: pool.body[0].publicCode })
        .expect(409);
      expect(twoServices.body.code).toBe("SCAN_REQUIRES_SINGLE_SERVICE");

      await request(app.getHttpServer())
        .patch(`/tenants/me/services/${serviceId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ active: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/tenants/me/services/${secondService.body.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ active: false })
        .expect(200);

      const zeroServices = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: pool.body[0].publicCode })
        .expect(409);
      expect(zeroServices.body.code).toBe("SCAN_REQUIRES_SINGLE_SERVICE");
    });

    it("customer identity: instant join, idempotent re-scan while active (per-location cap enforcement is covered by unit tests)", async () => {
      const owner = await signUpAndVerify("h-owner@example.com", "H's Shop", "Owner H");
      const { queueId } = await setUpQueue(owner.accessToken, "H");

      const created = await request(app.getHttpServer())
        .post("/tenants/me/customers")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: "Hana Scanner", phone: "021 555 2222" })
        .expect(201);

      const first = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: created.body.identityCode })
        .expect(201);
      expect(first.body).toMatchObject({
        status: "WAITING",
        customerName: "Hana Scanner",
        guestCardNumber: null,
      });

      const again = await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: created.body.identityCode })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);
    });

    it("404s for a QUEUE/DISPLAY/GENERAL code presented to the scanner — it only understands GUEST_CARD/CUSTOMER_IDENTITY", async () => {
      const owner = await signUpAndVerify("i-owner@example.com", "I's Shop", "Owner I");
      const { queueId } = await setUpQueue(owner.accessToken, "I");

      const generalCode = await request(app.getHttpServer())
        .post("/tenants/me/codes")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ contextType: "GENERAL" })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: generalCode.body.publicCode })
        .expect(404);
    });

    it("blocks scanning against another tenant's queue (404, not a leak)", async () => {
      const tenantA = await signUpAndVerify("j-owner@example.com", "J's Shop", "Owner J");
      const tenantB = await signUpAndVerify("k-owner@example.com", "K's Shop", "Owner K");
      const { queueId } = await setUpQueue(tenantA.accessToken, "J");

      await request(app.getHttpServer())
        .post(`/tenants/me/queues/${queueId}/scan`)
        .set("Authorization", `Bearer ${tenantB.accessToken}`)
        .send({ code: "WHATEVER" })
        .expect(404);
    });
  });
});
