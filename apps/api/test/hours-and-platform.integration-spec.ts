import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Phase 19 — the hours report and shift corrections (who may see and fix
 * whose hours), and the platform (root) admin (ADR-018): allow-listed
 * sign-in, its own token, read-only business view.
 */
describe("Hours report & platform admin (integration)", () => {
  jest.setTimeout(180_000);

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
    process.env.DISABLE_SCHEDULED_JOBS = "true";
    process.env.PLATFORM_ADMIN_EMAILS = "root@queueflow.test, Second@QueueFlow.test";

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

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  function recoverCodeFromHash(codeHash: string): string {
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = i.toString().padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) return candidate;
    }
    throw new Error("Could not recover code from hash");
  }

  async function signUpOwner() {
    counter += 1;
    const email = `hours-owner-${counter}@example.com`;
    await request(server())
      .post("/auth/business-signup")
      .send({ businessName: `Hours Biz ${counter}`, ownerName: "Owner", email })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const res = await request(server())
      .post("/auth/login/verify")
      .send({ email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);
    return { auth: bearer(res.body.accessToken) };
  }

  async function addLocation(auth: Record<string, string>, name: string) {
    const location = await request(server())
      .post("/tenants/me/locations")
      .set(auth)
      .send({ name, timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(server())
      .post("/tenants/me/services")
      .set(auth)
      .send({ locationId: location.body.id, name: "Cut", durationMinutes: 30 })
      .expect(201);
    const queue = await request(server())
      .post("/tenants/me/queues")
      .set(auth)
      .send({ locationId: location.body.id, name: `${name} Queue`, servingCapacity: 2 })
      .expect(201);
    await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set(auth)
      .send({ serviceId: service.body.id })
      .expect(201);
    const code = await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set(auth)
      .send({})
      .expect(201);
    return {
      locationId: location.body.id as string,
      serviceId: service.body.id as string,
      queueId: queue.body.id as string,
      posterCode: code.body.publicCode as string,
    };
  }

  async function staff(owner: Record<string, string>, locationId: string, name: string) {
    counter += 1;
    const email = `hours-staff-${counter}@example.com`;
    const created = await request(server())
      .post("/tenants/me/invites")
      .set(owner)
      .send({ email, role: "STAFF", locationId })
      .expect(201);
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: created.body.id } });
    await request(server()).post(`/auth/invites/${row.token}/request`).expect(202);
    const withCode = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: row.id } });
    const res = await request(server())
      .post(`/auth/invites/${row.token}/verify`)
      .send({ code: recoverCodeFromHash(withCode.codeHash!), displayName: name })
      .expect(201);
    const membership = await prisma.tenantUser.findFirstOrThrow({ where: { user: { email } } });
    return { auth: bearer(res.body.accessToken), id: membership.id };
  }

  const clockIn = (auth: Record<string, string>, locationId?: string) =>
    request(server())
      .post("/tenants/me/shifts/clock-in")
      .set(auth)
      .send(locationId ? { locationId } : {});
  const clockOut = (auth: Record<string, string>) =>
    request(server()).post("/tenants/me/shifts/clock-out").set(auth).expect(204);

  const range = () => {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 3600 * 1000).toISOString();
    return { from, to };
  };
  const report = (auth: Record<string, string>, extra: Record<string, string> = {}) =>
    request(server())
      .get("/tenants/me/shifts")
      .query({ ...range(), ...extra })
      .set(auth);

  it("the hours report is scoped by role: owner everyone, Manager their location, Staff themselves", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Alpha");
    const b = await addLocation(owner.auth, "Bravo");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    const ben = await staff(owner.auth, b.locationId, "Ben");
    await clockIn(ana.auth).expect(201);
    await clockOut(ana.auth);
    await clockIn(ana.auth).expect(201); // still open — counts up to now
    await clockIn(ben.auth).expect(201);

    const all = await report(owner.auth).expect(200);
    expect(all.body.shifts).toHaveLength(3);
    expect(all.body.totals.map((t: { staffName: string }) => t.staffName)).toEqual(["Ana", "Ben"]);
    expect(all.body.totals[0].shiftCount).toBe(2);

    const onlyBravo = await report(owner.auth, { locationId: b.locationId }).expect(200);
    expect(onlyBravo.body.shifts.map((s: { staffName: string }) => s.staffName)).toEqual(["Ben"]);

    const anaOwn = await report(ana.auth, { tenantUserId: ben.id }).expect(200);
    expect(new Set(anaOwn.body.shifts.map((s: { staffName: string }) => s.staffName))).toEqual(
      new Set(["Ana"]),
    ); // Staff can't ask for someone else's hours

    // A Manager at Alpha sees Alpha only, and nothing when asking about Bravo.
    counter += 1;
    const managerEmail = `hours-mgr-${counter}@example.com`;
    const invite = await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({ email: managerEmail, role: "MANAGER", locationId: a.locationId })
      .expect(201);
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.body.id } });
    await request(server()).post(`/auth/invites/${row.token}/request`).expect(202);
    const withCode = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: row.id } });
    const mgr = await request(server())
      .post(`/auth/invites/${row.token}/verify`)
      .send({ code: recoverCodeFromHash(withCode.codeHash!), displayName: "Mia" })
      .expect(201);
    const mgrAuth = bearer(mgr.body.accessToken);
    const mine = await report(mgrAuth).expect(200);
    expect(new Set(mine.body.shifts.map((s: { locationName: string }) => s.locationName))).toEqual(
      new Set(["Alpha"]),
    );
    const other = await report(mgrAuth, { locationId: b.locationId }).expect(200);
    expect(other.body.shifts).toEqual([]);
  });

  it("rejects a backwards or over-long range", async () => {
    const owner = await signUpOwner();
    const now = Date.now();
    await request(server())
      .get("/tenants/me/shifts")
      .query({ from: new Date(now).toISOString(), to: new Date(now - 1000).toISOString() })
      .set(owner.auth)
      .expect(400);
    await request(server())
      .get("/tenants/me/shifts")
      .query({
        from: new Date(now - 200 * 24 * 3600 * 1000).toISOString(),
        to: new Date(now).toISOString(),
      })
      .set(owner.auth)
      .expect(400);
  });

  it("a forgotten clock-out can be fixed by someone else — not by the person, not a Staff member", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Charlie");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    const ben = await staff(owner.auth, a.locationId, "Ben");
    await clockIn(ana.auth).expect(201);
    const forAna = await request(server())
      .post(`/public/queues/${a.queueId}/entries`)
      .send({
        serviceId: a.serviceId,
        customerName: "C",
        customerPhone: "021 900 7001",
        preferredStaffId: ana.id,
      })
      .expect(201);
    const shift = await prisma.staffShift.findFirstOrThrow({ where: { tenantUserId: ana.id } });
    const startedAt = new Date(Date.now() - 9 * 3600 * 1000).toISOString();
    const endedAt = new Date(Date.now() - 1 * 3600 * 1000).toISOString();

    // Not their own, not by Staff.
    await request(server())
      .patch(`/tenants/me/shifts/${shift.id}`)
      .set(ana.auth)
      .send({ startedAt, endedAt })
      .expect(404);
    await request(server())
      .patch(`/tenants/me/shifts/${shift.id}`)
      .set(ben.auth)
      .send({ startedAt, endedAt })
      .expect(404);
    // Not into the future, not backwards.
    await request(server())
      .patch(`/tenants/me/shifts/${shift.id}`)
      .set(owner.auth)
      .send({ startedAt, endedAt: new Date(Date.now() + 3600 * 1000).toISOString() })
      .expect(400);
    await request(server())
      .patch(`/tenants/me/shifts/${shift.id}`)
      .set(owner.auth)
      .send({ startedAt: endedAt, endedAt: startedAt })
      .expect(400);

    await request(server())
      .patch(`/tenants/me/shifts/${shift.id}`)
      .set(owner.auth)
      .send({ startedAt, endedAt })
      .expect(204);
    const fixed = await report(owner.auth).expect(200);
    const record = fixed.body.shifts.find((s: { id: string }) => s.id === shift.id);
    expect(record.minutes).toBe(480);
    expect(record.editedByName).toBe("Owner");
    // Closing the shift took Ana off the floor: her customer is back to "anyone".
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: forAna.body.id } });
    expect(entry.preferredStaffId).toBeNull();

    // A second shift overlapping the corrected one is refused.
    await clockIn(ana.auth).expect(201);
    const second = await prisma.staffShift.findFirstOrThrow({
      where: { tenantUserId: ana.id, endedAt: null },
    });
    await request(server())
      .patch(`/tenants/me/shifts/${second.id}`)
      .set(owner.auth)
      .send({ startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), endedAt: null })
      .expect(409);
  });

  async function platformLogin(email: string) {
    await request(server()).post("/platform/login/request").send({ email }).expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return request(server())
      .post("/platform/login/verify")
      .send({ email, code: recoverCodeFromHash(latest.codeHash) });
  }

  it("platform admins sign in by allow-list and see every business with its capabilities", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Delta");
    await request(server())
      .post(`/public/queues/${a.queueId}/entries`)
      .send({ serviceId: a.serviceId, customerName: "C", customerPhone: "021 900 7101" })
      .expect(201);

    const login = await platformLogin("second@queueflow.test"); // case-insensitive match
    expect(login.status).toBe(201);
    const auth = bearer(login.body.accessToken);

    const list = await request(server()).get("/platform/tenants").set(auth).expect(200);
    const biz = list.body.find((t: { name: string }) => t.name === `Hours Biz ${counter}`);
    expect(biz).toMatchObject({
      ownerName: "Owner",
      capabilities: { queue: true, appointments: false },
      locationCount: 1,
      serviceCount: 1,
      memberCount: 1,
      ticketsLast30Days: 1,
    });
    expect(biz.ownerEmail).toMatch(/^hours-owner-/);

    const detail = await request(server()).get(`/platform/tenants/${biz.id}`).set(auth).expect(200);
    expect(detail.body.locations).toEqual([
      expect.objectContaining({ name: "Delta", queueCount: 1 }),
    ]);
    expect(detail.body.services).toEqual([
      expect.objectContaining({ name: "Cut", locationName: "Delta", durationMinutes: 30 }),
    ]);
    expect(detail.body.membersByRole).toEqual({ TENANT_OWNER: 1 });
    // No customer data in the platform view.
    expect(JSON.stringify(detail.body)).not.toContain("021 900 7101");
  });

  it("keeps platform and business sessions apart, and never reveals who the admins are", async () => {
    const owner = await signUpOwner();

    // A business owner's token doesn't open the platform view…
    await request(server()).get("/platform/tenants").set(owner.auth).expect(401);
    await request(server()).get("/platform/tenants").expect(401);

    // …and a platform token doesn't open a business.
    const login = await platformLogin("root@queueflow.test");
    const platformAuth = bearer(login.body.accessToken);
    await request(server()).get("/tenants/me/locations").set(platformAuth).expect(401);

    // Not on the allow-list: the same 202, no code issued, verify fails.
    const outsider = `outsider-${counter}@example.com`;
    const response = await request(server())
      .post("/platform/login/request")
      .send({ email: outsider })
      .expect(202);
    expect(response.body.message).toMatch(/If that email is a QueueFlow admin/);
    expect(await prisma.user.findUnique({ where: { email: outsider } })).toBeNull();
    await request(server())
      .post("/platform/login/verify")
      .send({ email: outsider, code: "123456" })
      .expect(401);

    // A business owner who isn't on the list can't use their staff code here either.
    const ownerUser = await prisma.user.findFirstOrThrow({
      where: { email: `hours-owner-${counter}@example.com` },
    });
    expect(ownerUser).toBeTruthy();
    await request(server())
      .post("/platform/login/request")
      .send({ email: ownerUser.email })
      .expect(202);
    expect(
      await prisma.loginCode.count({ where: { userId: ownerUser.id, consumedAt: null } }),
    ).toBe(0);

    // Taking someone off the allow-list locks them out at once.
    const before = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "second@queueflow.test";
    try {
      await request(server()).get("/platform/tenants").set(platformAuth).expect(401);
    } finally {
      process.env.PLATFORM_ADMIN_EMAILS = before;
    }
  });
});
