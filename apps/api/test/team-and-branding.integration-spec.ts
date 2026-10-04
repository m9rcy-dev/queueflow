import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { MockEmailProvider } from "../src/notifications/mock-email.provider";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("not a real image body, but the signature is what's checked"),
]);

/**
 * Phase 16 (Team & Branding, ADR-015) — real Postgres. The heart of it is
 * the route sweep: a Staff member of location A hits every location-scoped
 * staff route with location B's resources and must get the same 404 a
 * nonexistent id gets — so a route that forgets its location check fails
 * here, not in production.
 */
describe("Team & branding (integration)", () => {
  jest.setTimeout(180_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;
  let mockEmail: MockEmailProvider;
  let counter = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    process.env.EMAIL_PROVIDER = "mock";
    process.env.SMS_PROVIDER = "mock";
    process.env.DISABLE_RATE_LIMITING = "true";
    process.env.DISABLE_SCHEDULED_JOBS = "true";
    process.env.WEB_APP_URL = "https://q.example";

    execSync("npx prisma migrate deploy", {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: "pipe",
    });

    prisma = new PrismaClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0); // one bound port per suite — see jest-integration.config.js
    mockEmail = app.get(MockEmailProvider);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await container?.stop();
  });

  const server = () => app.getHttpServer();

  function recoverCodeFromHash(codeHash: string): string {
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = i.toString().padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codeHash) return candidate;
    }
    throw new Error("Could not recover code from hash");
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function signUpOwner() {
    counter += 1;
    const email = `team-owner-${counter}@example.com`;
    await request(server())
      .post("/auth/business-signup")
      .send({ businessName: `Team Biz ${counter}`, ownerName: "Owner", email })
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

  /** A location with one service attached to one queue. */
  async function addLocation(auth: Record<string, string>, name: string) {
    const location = await request(server())
      .post("/tenants/me/locations")
      .set(auth)
      .send({ name, timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(server())
      .post("/tenants/me/services")
      .set(auth)
      .send({
        locationId: location.body.id,
        name: `${name} Cut`,
        durationMinutes: 20,
        appointmentEnabled: true,
      })
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

  /** Invite → accept through the real invite endpoints; returns the new member's session. */
  async function inviteAndAccept(
    owner: { auth: Record<string, string> },
    role: "TENANT_ADMIN" | "MANAGER" | "STAFF",
    locationId: string | null,
    displayName = "New Person",
  ) {
    counter += 1;
    const email = `team-member-${counter}@example.com`;
    const invite = await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({ email, role, locationId })
      .expect(201);
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.body.id } });
    await request(server()).post(`/auth/invites/${row.token}/request`).expect(202);
    const withCode = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: row.id } });
    const res = await request(server())
      .post(`/auth/invites/${row.token}/verify`)
      .send({ code: recoverCodeFromHash(withCode.codeHash!), displayName })
      .expect(201);
    const membership = await prisma.tenantUser.findFirstOrThrow({
      where: { user: { email } },
    });
    return {
      email,
      auth: bearer(res.body.accessToken),
      refreshToken: res.body.refreshToken as string,
      tenantUserId: membership.id,
      inviteToken: row.token,
    };
  }

  async function createAppointment(
    tenantId: string,
    loc: { locationId: string; serviceId: string },
  ) {
    counter += 1;
    const customer = await prisma.customer.create({
      data: { tenantId, phoneE164: `+6422${String(counter).padStart(7, "0")}`, firstName: "C" },
    });
    const startsAt = new Date(Date.now() + 2 * 24 * 3_600_000);
    return prisma.appointment.create({
      data: {
        tenantId,
        locationId: loc.locationId,
        serviceId: loc.serviceId,
        customerId: customer.id,
        publicToken: `appt_${randomUUID()}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60_000),
        occupiedUntil: new Date(startsAt.getTime() + 20 * 60_000),
        localDate: new Date(startsAt.toISOString().slice(0, 10)),
      },
    });
  }

  it("a Staff member of location A gets the same 404 as a missing id on every location-B route", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Alpha");
    const b = await addLocation(owner.auth, "Bravo");
    const staffA = await inviteAndAccept(owner, "STAFF", a.locationId, "Ana");

    // B-side resources for the per-entry and per-appointment routes.
    const bEntry = await request(server())
      .post(`/tenants/me/queues/${b.queueId}/entries`)
      .set(owner.auth)
      .send({ serviceId: b.serviceId, customerName: "B Walk", customerPhone: "021 400 0001" })
      .expect(201);
    const bAppointment = await createAppointment(owner.tenantId, b);
    const date = bAppointment.localDate.toISOString().slice(0, 10);
    const missing = randomUUID();

    type Probe = { method: "get" | "post" | "patch"; path: string; body?: object; missing: string };
    const probes: Probe[] = [
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}`,
        missing: `/tenants/me/locations/${missing}`,
      },
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}/business-hours`,
        missing: `/tenants/me/locations/${missing}/business-hours`,
      },
      {
        method: "get",
        path: `/tenants/me/services/${b.serviceId}`,
        missing: `/tenants/me/services/${missing}`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}`,
        missing: `/tenants/me/queues/${missing}`,
      },
      {
        method: "patch",
        path: `/tenants/me/queues/${b.queueId}/status`,
        body: { status: "PAUSED" },
        missing: `/tenants/me/queues/${missing}/status`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}/services`,
        missing: `/tenants/me/queues/${missing}/services`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}/joinable-services`,
        missing: `/tenants/me/queues/${missing}/joinable-services`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}/entries`,
        missing: `/tenants/me/queues/${missing}/entries`,
      },
      {
        method: "post",
        path: `/tenants/me/queues/${b.queueId}/call-next`,
        missing: `/tenants/me/queues/${missing}/call-next`,
      },
      {
        method: "post",
        path: `/tenants/me/queues/${b.queueId}/entries`,
        body: { serviceId: b.serviceId, customerName: "X", customerPhone: "021 400 0002" },
        missing: `/tenants/me/queues/${missing}/entries`,
      },
      {
        method: "post",
        path: `/tenants/me/queues/${b.queueId}/scan`,
        body: { code: "anything" },
        missing: `/tenants/me/queues/${missing}/scan`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}/stats/today`,
        missing: `/tenants/me/queues/${missing}/stats/today`,
      },
      {
        method: "get",
        path: `/tenants/me/queues/${b.queueId}/codes`,
        missing: `/tenants/me/queues/${missing}/codes`,
      },
      ...["", "/start", "/complete", "/skip", "/requeue", "/cancel", "/no-show", "/recall"].map(
        (suffix): Probe => ({
          method: suffix ? "post" : "get",
          path: `/tenants/me/queue-entries/${bEntry.body.id}${suffix}`,
          body: suffix === "/cancel" ? {} : undefined,
          missing: `/tenants/me/queue-entries/${missing}${suffix}`,
        }),
      ),
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}/guest-cards`,
        missing: `/tenants/me/locations/${missing}/guest-cards`,
      },
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}/closures`,
        missing: `/tenants/me/locations/${missing}/closures`,
      },
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}/appointments/calendar?month=${date.slice(0, 7)}`,
        missing: `/tenants/me/locations/${missing}/appointments/calendar?month=${date.slice(0, 7)}`,
      },
      {
        method: "get",
        path: `/tenants/me/locations/${b.locationId}/appointments?date=${date}`,
        missing: `/tenants/me/locations/${missing}/appointments?date=${date}`,
      },
      {
        method: "post",
        path: `/tenants/me/locations/${b.locationId}/appointments`,
        body: {
          serviceId: b.serviceId,
          startsAt: bAppointment.startsAt.toISOString(),
          customerName: "X",
          customerPhone: "021 400 0003",
        },
        missing: `/tenants/me/locations/${missing}/appointments`,
      },
      {
        method: "post",
        path: `/tenants/me/appointments/${bAppointment.id}/cancel`,
        body: { reason: "OTHER" },
        missing: `/tenants/me/appointments/${missing}/cancel`,
      },
      {
        method: "post",
        path: `/tenants/me/appointments/${bAppointment.id}/check-in`,
        body: {},
        missing: `/tenants/me/appointments/${missing}/check-in`,
      },
      {
        method: "post",
        path: `/tenants/me/appointments/${bAppointment.id}/restore`,
        missing: `/tenants/me/appointments/${missing}/restore`,
      },
    ];

    for (const probe of probes) {
      const refused = await request(server())
        [probe.method](probe.path)
        .set(staffA.auth)
        .send(probe.body ?? {});
      const absent = await request(server())
        [probe.method](probe.missing)
        .set(staffA.auth)
        .send(probe.body ?? {});
      expect({ route: probe.path, status: refused.status }).toEqual({
        route: probe.path,
        status: 404,
      });
      expect({ route: probe.path, body: refused.body }).toEqual({
        route: probe.path,
        body: absent.body,
      });
    }

    // Nothing on B changed.
    const bQueue = await prisma.queue.findUniqueOrThrow({ where: { id: b.queueId } });
    expect(bQueue.status).toBe("ACTIVE");
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: bEntry.body.id } });
    expect(entry.status).toBe("WAITING");

    // Their own location works, and lists show only it.
    await request(server())
      .get(`/tenants/me/queues/${a.queueId}/entries`)
      .set(staffA.auth)
      .expect(200);
    const locations = await request(server())
      .get("/tenants/me/locations")
      .set(staffA.auth)
      .expect(200);
    expect(locations.body.map((l: { id: string }) => l.id)).toEqual([a.locationId]);
    const queues = await request(server()).get("/tenants/me/queues").set(staffA.auth).expect(200);
    expect(queues.body.map((q: { id: string }) => q.id)).toEqual([a.queueId]);
    const services = await request(server())
      .get("/tenants/me/services")
      .set(staffA.auth)
      .expect(200);
    expect(services.body.map((s: { id: string }) => s.id)).toEqual([a.serviceId]);
    const askedForB = await request(server())
      .get(`/tenants/me/queues?locationId=${b.locationId}`)
      .set(staffA.auth)
      .expect(200);
    expect(askedForB.body).toEqual([]);

    // The owner still sees everything.
    const ownerQueues = await request(server())
      .get("/tenants/me/queues")
      .set(owner.auth)
      .expect(200);
    expect(ownerQueues.body).toHaveLength(2);
  });

  it("invites carry a location: required for staff, shown on the acceptance page, emailed as a link", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Charlie");

    await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({ email: "no-location@example.com", role: "STAFF" })
      .expect(400);
    await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({
        email: "admin-with-location@example.com",
        role: "TENANT_ADMIN",
        locationId: a.locationId,
      })
      .expect(400);

    const invite = await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({ email: "ben@example.com", role: "MANAGER", locationId: a.locationId })
      .expect(201);
    expect(invite.body.location).toEqual({ id: a.locationId, name: "Charlie" });
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.body.id } });

    const sent = mockEmail.sent.find((m) => m.to === "ben@example.com");
    expect(sent?.body).toContain(`https://q.example/invite/${row.token}`);

    const details = await request(server()).get(`/auth/invites/${row.token}`).expect(200);
    expect(details.body).toEqual({
      tenantName: expect.stringContaining("Team Biz"),
      email: "ben@example.com",
      role: "MANAGER",
      locationName: "Charlie",
    });

    const member = await inviteAndAccept(owner, "STAFF", a.locationId, "Bella Staff");
    const roster = await request(server()).get("/tenants/me/staff").set(owner.auth).expect(200);
    expect(roster.body).toContainEqual(
      expect.objectContaining({
        tenantUserId: member.tenantUserId,
        displayName: "Bella Staff",
        role: "STAFF",
        location: { id: a.locationId, name: "Charlie" },
      }),
    );
  });

  it("moving a member to another location takes effect on their very next request", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Delta");
    const b = await addLocation(owner.auth, "Echo");
    const member = await inviteAndAccept(owner, "STAFF", a.locationId);

    await request(server()).get(`/tenants/me/queues/${a.queueId}`).set(member.auth).expect(200);
    await request(server())
      .patch(`/tenants/me/staff/${member.tenantUserId}`)
      .set(owner.auth)
      .send({ role: "STAFF", locationId: b.locationId })
      .expect(200);
    // Same access token as before.
    await request(server()).get(`/tenants/me/queues/${a.queueId}`).set(member.auth).expect(404);
    await request(server()).get(`/tenants/me/queues/${b.queueId}`).set(member.auth).expect(200);

    // Promoted to admin: no location, sees everything.
    await request(server())
      .patch(`/tenants/me/staff/${member.tenantUserId}`)
      .set(owner.auth)
      .send({ role: "TENANT_ADMIN", locationId: b.locationId })
      .expect(400);
    await request(server())
      .patch(`/tenants/me/staff/${member.tenantUserId}`)
      .set(owner.auth)
      .send({ role: "TENANT_ADMIN" })
      .expect(200);
    await request(server()).get(`/tenants/me/queues/${a.queueId}`).set(member.auth).expect(200);
  });

  it("nobody can change the owner or themselves", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Foxtrot");
    const admin = await inviteAndAccept(owner, "TENANT_ADMIN", null);
    const ownerMembership = await prisma.tenantUser.findFirstOrThrow({
      where: { tenantId: owner.tenantId, role: "TENANT_OWNER" },
    });

    const onOwner = await request(server())
      .patch(`/tenants/me/staff/${ownerMembership.id}`)
      .set(admin.auth)
      .send({ role: "STAFF", locationId: a.locationId })
      .expect(403);
    expect(onOwner.body.code).toBe("OWNER_NOT_CHANGEABLE");
    await request(server())
      .delete(`/tenants/me/staff/${ownerMembership.id}`)
      .set(admin.auth)
      .expect(403);
    const onSelf = await request(server())
      .delete(`/tenants/me/staff/${admin.tenantUserId}`)
      .set(admin.auth)
      .expect(403);
    expect(onSelf.body.code).toBe("CANNOT_CHANGE_SELF");
  });

  it("removing a member locks them out at once, keeps their history, and re-inviting brings them back", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Golf");
    const member = await inviteAndAccept(owner, "STAFF", a.locationId, "Gus");
    await request(server())
      .post(`/tenants/me/queues/${a.queueId}/entries`)
      .set(owner.auth)
      .send({ serviceId: a.serviceId, customerName: "Walk", customerPhone: "021 400 0101" })
      .expect(201);
    const called = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(member.auth)
      .expect(201);

    await request(server())
      .delete(`/tenants/me/staff/${member.tenantUserId}`)
      .set(owner.auth)
      .expect(204);

    const locked = await request(server()).get("/tenants/me/queues").set(member.auth).expect(401);
    expect(locked.body.code).toBe("MEMBERSHIP_REVOKED");
    await request(server())
      .post("/auth/refresh")
      .send({ refreshToken: member.refreshToken })
      .expect(401);
    const roster = await request(server()).get("/tenants/me/staff").set(owner.auth).expect(200);
    expect(roster.body.map((m: { tenantUserId: string }) => m.tenantUserId)).not.toContain(
      member.tenantUserId,
    );
    // Their queue action still names them.
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: called.body.id } });
    expect(entry.assignedStaffId).toBe(member.tenantUserId);

    // Re-invite the same email: the old membership comes back, no duplicate.
    const again = await request(server())
      .post("/tenants/me/invites")
      .set(owner.auth)
      .send({ email: member.email, role: "STAFF", locationId: a.locationId })
      .expect(201);
    const row = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: again.body.id } });
    await request(server()).post(`/auth/invites/${row.token}/request`).expect(202);
    const withCode = await prisma.tenantInvite.findUniqueOrThrow({ where: { id: row.id } });
    await request(server())
      .post(`/auth/invites/${row.token}/verify`)
      .send({ code: recoverCodeFromHash(withCode.codeHash!) })
      .expect(201);
    const memberships = await prisma.tenantUser.findMany({
      where: { tenantId: owner.tenantId, user: { email: member.email } },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].removedAt).toBeNull();
  });

  it("a counter tablet belongs to one location: only its staff can PIN in", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Hotel");
    const b = await addLocation(owner.auth, "India");
    const staffA = await inviteAndAccept(owner, "STAFF", a.locationId, "Hana");
    const staffB = await inviteAndAccept(owner, "STAFF", b.locationId, "Ivan");
    for (const member of [staffA, staffB]) {
      await request(server()).post("/auth/pin").set(member.auth).send({ pin: "2468" }).expect(204);
    }

    // A two-location owner must say which location.
    const ambiguous = await request(server())
      .post("/auth/devices/trust")
      .set(owner.auth)
      .send({})
      .expect(400);
    expect(ambiguous.body.code).toBe("LOCATION_REQUIRED");

    // Trusted by Hana: it's location A's tablet.
    const trusted = await request(server())
      .post("/auth/devices/trust")
      .set(staffA.auth)
      .send({})
      .expect(201);
    const context = await request(server())
      .post("/auth/device-context")
      .send({ deviceTrustToken: trusted.body.deviceTrustToken })
      .expect(201);
    expect(context.body.location).toEqual({ id: a.locationId, name: "Hotel" });
    const names = context.body.staff.map((s: { displayName: string }) => s.displayName);
    expect(names).toContain("Hana");
    expect(names).toContain("Owner");
    expect(names).not.toContain("Ivan");

    // Ivan can't PIN into it even knowing his own id and PIN.
    await request(server())
      .post("/auth/staff-pin-login")
      .send({
        deviceTrustToken: context.body.deviceTrustToken,
        tenantUserId: staffB.tenantUserId,
        pin: "2468",
      })
      .expect(401);
    const refreshed = await request(server())
      .post("/auth/device-context")
      .send({ deviceTrustToken: context.body.deviceTrustToken })
      .expect(201);
    await request(server())
      .post("/auth/staff-pin-login")
      .send({
        deviceTrustToken: refreshed.body.deviceTrustToken,
        tenantUserId: staffA.tenantUserId,
        pin: "2468",
      })
      .expect(201);
  });

  it("a business logo: owner uploads, it's served publicly and shows on the queue poster's page", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Juliet");
    const staff = await inviteAndAccept(owner, "STAFF", a.locationId);

    await request(server())
      .put("/tenants/me/logo")
      .set(staff.auth)
      .set("Content-Type", "image/png")
      .send(PNG)
      .expect(403);
    const svg = await request(server())
      .put("/tenants/me/logo")
      .set(owner.auth)
      .set("Content-Type", "image/png") // lying about the type doesn't help
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
      .expect(400);
    expect(svg.body.code).toBe("LOGO_INVALID");
    await request(server())
      .put("/tenants/me/logo")
      .set(owner.auth)
      .set("Content-Type", "image/png")
      .send(Buffer.concat([PNG, Buffer.alloc(700 * 1024)]))
      .expect(413);

    const uploaded = await request(server())
      .put("/tenants/me/logo")
      .set(owner.auth)
      .set("Content-Type", "image/png")
      .send(PNG)
      .expect(200);
    expect(uploaded.body.logoPath).toMatch(
      new RegExp(`^/public/tenants/${owner.tenantId}/logo\\?v=\\d+$`),
    );

    const image = await request(server()).get(uploaded.body.logoPath).expect(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(image.headers["cache-control"]).toContain("immutable");
    expect(Buffer.from(image.body).equals(PNG)).toBe(true);

    const code = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/codes`)
      .set(owner.auth)
      .expect(201);
    const resolved = await request(server())
      .get(`/public/codes/${code.body.publicCode}`)
      .expect(200);
    expect(resolved.body.tenant.logoPath).toBe(uploaded.body.logoPath);

    await request(server()).delete("/tenants/me/logo").set(owner.auth).expect(204);
    await request(server()).get(`/public/tenants/${owner.tenantId}/logo`).expect(404);
    const after = await request(server()).get(`/public/codes/${code.body.publicCode}`).expect(200);
    expect(after.body.tenant.logoPath).toBeNull();
  });
});
