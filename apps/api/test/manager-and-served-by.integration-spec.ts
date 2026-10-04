import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Phase 17 (ADR-016) — real Postgres. Managers run their own location
 * (and nothing else); Staff only operate; every served customer records
 * who served them, including hand-overs; a signed-up customer sees their
 * recent visits.
 */
describe("Managers, served-by & customer visits (integration)", () => {
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
    const email = `mgr-owner-${counter}@example.com`;
    await request(server())
      .post("/auth/business-signup")
      .send({ businessName: `Mgr Biz ${counter}`, ownerName: "Owner", email })
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
    return { auth: bearer(res.body.accessToken), tenantId: res.body.tenant.id as string };
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
      .send({ locationId: location.body.id, name: `${name} Cut`, durationMinutes: 20 })
      .expect(201);
    const queue = await request(server())
      .post("/tenants/me/queues")
      .set(auth)
      .send({ locationId: location.body.id, name: `${name} Queue` })
      .expect(201);
    await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set(auth)
      .send({ serviceId: service.body.id })
      .expect(201);
    return {
      locationId: location.body.id as string,
      serviceId: service.body.id as string,
      queueId: queue.body.id as string,
    };
  }

  async function invite(
    inviter: Record<string, string>,
    role: "MANAGER" | "STAFF",
    locationId: string,
    name: string,
  ) {
    counter += 1;
    const email = `mgr-member-${counter}@example.com`;
    const created = await request(server())
      .post("/tenants/me/invites")
      .set(inviter)
      .send({ email, role, locationId })
      .expect(201);
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: created.body.id } });
    await request(server()).post(`/auth/invites/${row.token}/request`).expect(202);
    const withCode = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: row.id } });
    const res = await request(server())
      .post(`/auth/invites/${row.token}/verify`)
      .send({ code: recoverCodeFromHash(withCode.codeHash!), displayName: name })
      .expect(201);
    const membership = await prisma.tenantUser.findFirstOrThrow({ where: { user: { email } } });
    return { auth: bearer(res.body.accessToken), tenantUserId: membership.id, inviteId: row.id };
  }

  async function walkIn(
    auth: Record<string, string>,
    loc: { queueId: string; serviceId: string },
    phone: string,
  ) {
    const res = await request(server())
      .post(`/tenants/me/queues/${loc.queueId}/entries`)
      .set(auth)
      .send({ serviceId: loc.serviceId, customerName: "Walk", customerPhone: phone })
      .expect(201);
    return res.body as { id: string };
  }

  it("a Manager runs their own location: hours, closures, services, queues, codes, guest cards", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Alpha");
    const manager = await invite(owner.auth, "MANAGER", a.locationId, "Mia Manager");
    const m = manager.auth;

    await request(server())
      .patch(`/tenants/me/locations/${a.locationId}`)
      .set(m)
      .send({ name: "Alpha Central" })
      .expect(200);
    await request(server())
      .put(`/tenants/me/locations/${a.locationId}/business-hours`)
      .set(m)
      .send({ entries: [{ dayOfWeek: 1, opensAtMinutes: 540, closesAtMinutes: 1020 }] })
      .expect(200);
    const closure = await request(server())
      .post(`/tenants/me/locations/${a.locationId}/closures`)
      .set(m)
      .send({ date: "2030-01-01" })
      .expect(201);
    await request(server())
      .delete(`/tenants/me/locations/${a.locationId}/closures/${closure.body.closure.id}`)
      .set(m)
      .expect(204);
    const service = await request(server())
      .post("/tenants/me/services")
      .set(m)
      .send({ locationId: a.locationId, name: "Beard", durationMinutes: 15 })
      .expect(201);
    await request(server())
      .patch(`/tenants/me/services/${service.body.id}`)
      .set(m)
      .send({ durationMinutes: 20 })
      .expect(200);
    const queue = await request(server())
      .post("/tenants/me/queues")
      .set(m)
      .send({ locationId: a.locationId, name: "Second chair" })
      .expect(201);
    await request(server())
      .patch(`/tenants/me/queues/${queue.body.id}`)
      .set(m)
      .send({ servingCapacity: 2 })
      .expect(200);
    await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set(m)
      .send({ serviceId: service.body.id })
      .expect(201);
    const code = await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set(m)
      .send({})
      .expect(201);
    await request(server())
      .post(`/tenants/me/queues/${queue.body.id}/codes/${code.body.id}/deactivate`)
      .set(m)
      .expect(204);
    await request(server())
      .put(`/tenants/me/locations/${a.locationId}/guest-cards`)
      .set(m)
      .send({ poolSize: 3 })
      .expect(200);
  });

  it("a Manager gets the not-found response for every management route on another location", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Bravo");
    const b = await addLocation(owner.auth, "Charlie");
    const m = (await invite(owner.auth, "MANAGER", a.locationId, "Max")).auth;
    const bCode = await request(server())
      .post(`/tenants/me/queues/${b.queueId}/codes`)
      .set(owner.auth)
      .send({})
      .expect(201);
    const bClosure = await request(server())
      .post(`/tenants/me/locations/${b.locationId}/closures`)
      .set(owner.auth)
      .send({ date: "2030-01-02" })
      .expect(201);

    const probes: Array<{
      method: "patch" | "put" | "post" | "delete";
      path: string;
      body?: object;
    }> = [
      { method: "patch", path: `/tenants/me/locations/${b.locationId}`, body: { name: "X" } },
      {
        method: "put",
        path: `/tenants/me/locations/${b.locationId}/business-hours`,
        body: { entries: [] },
      },
      {
        method: "post",
        path: `/tenants/me/locations/${b.locationId}/closures`,
        body: { date: "2030-01-03" },
      },
      {
        method: "delete",
        path: `/tenants/me/locations/${b.locationId}/closures/${bClosure.body.closure.id}`,
      },
      {
        method: "post",
        path: "/tenants/me/services",
        body: { locationId: b.locationId, name: "X", durationMinutes: 10 },
      },
      {
        method: "patch",
        path: `/tenants/me/services/${b.serviceId}`,
        body: { durationMinutes: 5 },
      },
      { method: "post", path: "/tenants/me/queues", body: { locationId: b.locationId, name: "X" } },
      { method: "patch", path: `/tenants/me/queues/${b.queueId}`, body: { servingCapacity: 3 } },
      {
        method: "post",
        path: `/tenants/me/queues/${b.queueId}/services`,
        body: { serviceId: b.serviceId },
      },
      // Their own queue, but another location's service.
      {
        method: "post",
        path: `/tenants/me/queues/${a.queueId}/services`,
        body: { serviceId: b.serviceId },
      },
      { method: "post", path: `/tenants/me/queues/${b.queueId}/codes`, body: {} },
      { method: "post", path: `/tenants/me/queues/${b.queueId}/codes/${bCode.body.id}/deactivate` },
      {
        method: "put",
        path: `/tenants/me/locations/${b.locationId}/guest-cards`,
        body: { poolSize: 2 },
      },
      {
        method: "post",
        path: "/tenants/me/invites",
        body: { email: "x@example.com", role: "STAFF", locationId: b.locationId },
      },
    ];
    for (const probe of probes) {
      const res = await request(server())
        [probe.method](probe.path)
        .set(m)
        .send(probe.body ?? {});
      expect({ route: `${probe.method} ${probe.path}`, status: res.status }).toEqual({
        route: `${probe.method} ${probe.path}`,
        status: 404,
      });
    }
    expect((await prisma.location.findUniqueOrThrow({ where: { id: b.locationId } })).name).toBe(
      "Charlie",
    );
    expect(await prisma.locationClosure.count({ where: { locationId: b.locationId } })).toBe(1);
  });

  it("a Manager manages only Staff at their location; business-wide things stay owner/admin", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Delta");
    const b = await addLocation(owner.auth, "Echo");
    const manager = await invite(owner.auth, "MANAGER", a.locationId, "Dana");
    const fellowManager = await invite(owner.auth, "MANAGER", a.locationId, "Finn");
    const bStaff = await invite(owner.auth, "STAFF", b.locationId, "Bella");
    const m = manager.auth;

    // Invites: Staff at their own location only.
    const staffInvite = await request(server())
      .post("/tenants/me/invites")
      .set(m)
      .send({ email: "new-staff@example.com", role: "STAFF", locationId: a.locationId })
      .expect(201);
    const asManager = await request(server())
      .post("/tenants/me/invites")
      .set(m)
      .send({ email: "new-mgr@example.com", role: "MANAGER", locationId: a.locationId })
      .expect(403);
    expect(asManager.body.code).toBe("MANAGER_CAN_ONLY_INVITE_STAFF");

    // They see their location's team and invites only.
    const roster = await request(server()).get("/tenants/me/staff").set(m).expect(200);
    const names = roster.body.map((r: { displayName: string }) => r.displayName).sort();
    expect(names).toEqual(["Dana", "Finn"]);
    const invites = await request(server()).get("/tenants/me/invites").set(m).expect(200);
    expect(
      invites.body.every(
        (i: { location: { id: string } | null }) => i.location?.id === a.locationId,
      ),
    ).toBe(true);
    await request(server()).delete(`/tenants/me/invites/${staffInvite.body.id}`).set(m).expect(204);
    await request(server()).delete(`/tenants/me/invites/${bStaff.inviteId}`).set(m).expect(404);

    // Removal: Staff at their location yes; a fellow manager no; another location's staff "not found".
    const aStaff = await invite(owner.auth, "STAFF", a.locationId, "Ari");
    await request(server()).delete(`/tenants/me/staff/${aStaff.tenantUserId}`).set(m).expect(204);
    const onManager = await request(server())
      .delete(`/tenants/me/staff/${fellowManager.tenantUserId}`)
      .set(m)
      .expect(403);
    expect(onManager.body.code).toBe("MANAGER_CAN_ONLY_MANAGE_STAFF");
    await request(server()).delete(`/tenants/me/staff/${bStaff.tenantUserId}`).set(m).expect(404);

    // Role changes, new locations, business settings and the sign-up poster stay owner/admin.
    await request(server())
      .patch(`/tenants/me/staff/${fellowManager.tenantUserId}`)
      .set(m)
      .send({ role: "STAFF", locationId: a.locationId })
      .expect(403);
    await request(server())
      .post("/tenants/me/locations")
      .set(m)
      .send({ name: "New", timezone: "Pacific/Auckland" })
      .expect(403);
    await request(server())
      .patch("/tenants/me/appointment-settings")
      .set(m)
      .send({ bufferMinutes: 5 })
      .expect(403);
    await request(server())
      .post("/tenants/me/codes")
      .set(m)
      .send({ contextType: "GENERAL" })
      .expect(403);
    await request(server())
      .patch("/tenants/me/capabilities")
      .set(m)
      .send({ queueEnabled: false })
      .expect(403);
  });

  it("Staff can operate but not manage their location", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Foxtrot");
    const s = (await invite(owner.auth, "STAFF", a.locationId, "Sam")).auth;
    await request(server())
      .patch(`/tenants/me/locations/${a.locationId}`)
      .set(s)
      .send({ name: "X" })
      .expect(403);
    await request(server())
      .post("/tenants/me/services")
      .set(s)
      .send({ locationId: a.locationId, name: "X", durationMinutes: 10 })
      .expect(403);
    await request(server())
      .post(`/tenants/me/queues/${a.queueId}/codes`)
      .set(s)
      .send({})
      .expect(403);
    await request(server())
      .post("/tenants/me/invites")
      .set(s)
      .send({ email: "y@example.com", role: "STAFF", locationId: a.locationId })
      .expect(403);
    await request(server()).get("/tenants/me/staff").set(s).expect(403);
    // ...but runs the queue fine.
    await walkIn(owner.auth, a, "021 800 0001");
    await request(server()).post(`/tenants/me/queues/${a.queueId}/call-next`).set(s).expect(201);
  });

  it("records who served each customer: whoever pressed Start, or whoever they were handed to", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Golf");
    const b = await addLocation(owner.auth, "Hotel");
    const ana = await invite(owner.auth, "STAFF", a.locationId, "Ana");
    const ben = await invite(owner.auth, "STAFF", a.locationId, "Ben");
    const bOnly = await invite(owner.auth, "STAFF", b.locationId, "Bo");

    // 1) Ana calls and starts: Ana served.
    await walkIn(owner.auth, a, "021 800 0101");
    const first = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ana.auth)
      .expect(201);
    const started = await request(server())
      .post(`/tenants/me/queue-entries/${first.body.id}/start`)
      .set(ana.auth)
      .expect(201);
    expect(started.body).toMatchObject({ assignedStaffName: "Ana", servedByStaffName: "Ana" });

    // 2) Ana calls, hands over to Ben, Ana presses Start for him: Ben stays credited.
    await walkIn(owner.auth, a, "021 800 0102");
    const second = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ana.auth)
      .expect(201);
    const handed = await request(server())
      .post(`/tenants/me/queue-entries/${second.body.id}/hand-over`)
      .set(ana.auth)
      .send({ tenantUserId: ben.tenantUserId })
      .expect(201);
    expect(handed.body.servedByStaffName).toBe("Ben");
    const startedForBen = await request(server())
      .post(`/tenants/me/queue-entries/${second.body.id}/start`)
      .set(ana.auth)
      .expect(201);
    expect(startedForBen.body).toMatchObject({
      assignedStaffName: "Ana",
      servedByStaffName: "Ben",
    });

    // 3) Mid-service hand-over works too.
    const midway = await request(server())
      .post(`/tenants/me/queue-entries/${first.body.id}/hand-over`)
      .set(owner.auth)
      .send({ tenantUserId: ben.tenantUserId })
      .expect(201);
    expect(midway.body.servedByStaffName).toBe("Ben");
    await request(server())
      .post(`/tenants/me/queue-entries/${first.body.id}/complete`)
      .set(ben.auth)
      .expect(201);
    const done = await prisma.queueEntry.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(done.servedByStaffId).toBe(ben.tenantUserId);

    // Refusals: someone from another location; a customer still waiting; a finished one.
    const third = await walkIn(owner.auth, a, "021 800 0103");
    await request(server())
      .post(`/tenants/me/queue-entries/${second.body.id}/hand-over`)
      .set(owner.auth)
      .send({ tenantUserId: bOnly.tenantUserId })
      .expect(404);
    await request(server())
      .post(`/tenants/me/queue-entries/${third.id}/hand-over`)
      .set(owner.auth)
      .send({ tenantUserId: ben.tenantUserId })
      .expect(409);
    await request(server())
      .post(`/tenants/me/queue-entries/${first.body.id}/hand-over`)
      .set(owner.auth)
      .send({ tenantUserId: ana.tenantUserId })
      .expect(409);
    // Another location's staff can't hand over this location's customer at all.
    await request(server())
      .post(`/tenants/me/queue-entries/${second.body.id}/hand-over`)
      .set(bOnly.auth)
      .send({ tenantUserId: bOnly.tenantUserId })
      .expect(404);
  });

  it("a signed-up customer sees their recent visits, with who served them", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "India");
    const staff = await invite(owner.auth, "STAFF", a.locationId, "Isla");
    const email = `visits-${randomUUID()}@example.com`;
    const phone = "021 800 0201";
    await request(server())
      .post("/public/customers/signup")
      .send({ tenantId: owner.tenantId, name: "Viv", phone, email })
      .expect(202);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_email: { tenantId: owner.tenantId, email } },
    });
    const latest = await prisma.customerLoginCode.findFirstOrThrow({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });
    const session = await request(server())
      .post("/public/customers/login/verify")
      .send({ tenantId: owner.tenantId, email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);
    const c = bearer(session.body.accessToken);

    // A finished visit, then a live one.
    await walkIn(owner.auth, a, phone);
    const called = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(staff.auth)
      .expect(201);
    await request(server())
      .post(`/tenants/me/queue-entries/${called.body.id}/start`)
      .set(staff.auth)
      .expect(201);
    await request(server())
      .post(`/tenants/me/queue-entries/${called.body.id}/complete`)
      .set(staff.auth)
      .expect(201);
    await walkIn(owner.auth, a, phone);

    const visits = await request(server()).get("/customers/me/visits").set(c).expect(200);
    expect(visits.body).toHaveLength(2);
    expect(visits.body[0]).toMatchObject({
      status: "WAITING",
      queueName: "India Queue",
      locationName: "India",
    });
    expect(visits.body[0].publicToken).toBeTruthy();
    expect(visits.body[1]).toMatchObject({
      status: "COMPLETED",
      servedByName: "Isla",
      publicToken: null,
    });
  });
});
