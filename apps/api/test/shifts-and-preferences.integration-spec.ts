import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Phase 18 (Staff on Shift & Preferred Staff, ADR-017) — real Postgres.
 * The queue-engine change (Call Next skipping customers who want someone
 * else) gets the same concurrency treatment as ADR-006's original rule.
 */
describe("Shifts & preferred staff (integration)", () => {
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
    const email = `shift-owner-${counter}@example.com`;
    await request(server())
      .post("/auth/business-signup")
      .send({ businessName: `Shift Biz ${counter}`, ownerName: "Owner", email })
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
    const email = `shift-staff-${counter}@example.com`;
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

  function join(
    loc: { queueId: string; serviceId: string },
    phone: string,
    preferredStaffId: string | null = null,
  ) {
    return request(server()).post(`/public/queues/${loc.queueId}/entries`).send({
      serviceId: loc.serviceId,
      customerName: "C",
      customerPhone: phone,
      preferredStaffId,
    });
  }

  const clockIn = (auth: Record<string, string>, locationId?: string) =>
    request(server())
      .post("/tenants/me/shifts/clock-in")
      .set(auth)
      .send(locationId ? { locationId } : {});

  it("clocks in and out; one open shift per person, even under a double tap", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Alpha");
    const b = await addLocation(owner.auth, "Bravo");
    const ana = await staff(owner.auth, a.locationId, "Ana");

    const [first, second] = await Promise.all([clockIn(ana.auth), clockIn(ana.auth)]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.locationName).toBe("Alpha");
    expect(await prisma.staffShift.count({ where: { tenantUserId: ana.id, endedAt: null } })).toBe(
      1,
    );

    // A location-bound member can't clock in elsewhere.
    await clockIn(ana.auth, b.locationId).expect(404);
    // An owner with two locations must say where; and can't be on two shifts.
    const ambiguous = await clockIn(owner.auth).expect(409);
    expect(ambiguous.body.code).toBe("LOCATION_REQUIRED");
    await clockIn(owner.auth, a.locationId).expect(201);
    const elsewhere = await clockIn(owner.auth, b.locationId).expect(409);
    expect(elsewhere.body.code).toBe("ALREADY_ON_SHIFT");

    const onShift = await request(server())
      .get(`/tenants/me/locations/${a.locationId}/on-shift`)
      .set(owner.auth)
      .expect(200);
    expect(onShift.body.map((s: { name: string }) => s.name)).toEqual(["Ana", "Owner"]);

    await request(server()).post("/tenants/me/shifts/clock-out").set(ana.auth).expect(204);
    const mine = await request(server()).get("/tenants/me/shifts/me").set(ana.auth).expect(200);
    expect(mine.body.shift).toBeNull();
  });

  it("customers can only ask for someone on shift; the join page lists them by public name", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Charlie");
    const ana = await staff(owner.auth, a.locationId, "Ana Smith");
    const ben = await staff(owner.auth, a.locationId, "Ben");
    await request(server())
      .patch("/auth/me/public-name")
      .set(ana.auth)
      .send({ publicName: "Ace" })
      .expect(200);
    await clockIn(ana.auth).expect(201);

    const resolved = await request(server()).get(`/public/codes/${a.posterCode}`).expect(200);
    expect(resolved.body.onShiftStaff).toEqual([{ tenantUserId: ana.id, name: "Ace" }]);

    const offShift = await join(a, "021 900 0001", ben.id).expect(409);
    expect(offShift.body.code).toBe("STAFF_NOT_ON_SHIFT");
    const joined = await join(a, "021 900 0002", ana.id).expect(201);
    const ticket = await request(server())
      .get(`/public/queue-entries/${joined.body.publicToken}`)
      .expect(200);
    expect(ticket.body.preferredStaffName).toBe("Ace");
  });

  it("Call Next skips customers waiting for someone else, who keep their place; positions count each line", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Delta");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    const ben = await staff(owner.auth, a.locationId, "Ben");
    await clockIn(ana.auth).expect(201);
    await clockIn(ben.auth).expect(201);

    const forAna = (await join(a, "021 900 0101", ana.id).expect(201)).body;
    const anyone = (await join(a, "021 900 0102").expect(201)).body;
    const forBen = (await join(a, "021 900 0103", ben.id).expect(201)).body;

    // Positions: each customer's own line.
    expect(forAna.position).toBe(1); // first for Ana
    expect(anyone.position).toBe(1); // first "anyone" — Ana's customer isn't in their way
    expect(forBen.position).toBe(2); // the "anyone" customer is ahead in Ben's line

    // Ben is first to call: he skips Ana's customer (who stays first in line) and takes "anyone".
    const benFirst = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ben.auth)
      .expect(201);
    expect(benFirst.body.id).toBe(anyone.id);
    const benSecond = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ben.auth)
      .expect(201);
    expect(benSecond.body.id).toBe(forBen.id);
    const benThird = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ben.auth)
      .expect(404);
    expect(benThird.body.message).toMatch(/for you/);

    const anaFirst = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ana.auth)
      .expect(201);
    expect(anaFirst.body.id).toBe(forAna.id);
  });

  it("two staff calling at the same moment never get the same customer, nor one meant for the other", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Echo");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    const ben = await staff(owner.auth, a.locationId, "Ben");
    await clockIn(ana.auth).expect(201);
    await clockIn(ben.auth).expect(201);
    const ids = {
      ana: [] as string[],
      ben: [] as string[],
      anyone: [] as string[],
    };
    for (let i = 0; i < 4; i += 1) {
      ids.ana.push((await join(a, `021 900 02${i}1`, ana.id).expect(201)).body.id);
      ids.anyone.push((await join(a, `021 900 02${i}2`).expect(201)).body.id);
      ids.ben.push((await join(a, `021 900 02${i}3`, ben.id).expect(201)).body.id);
    }

    for (let round = 0; round < 4; round += 1) {
      const [byAna, byBen] = await Promise.all([
        request(server()).post(`/tenants/me/queues/${a.queueId}/call-next`).set(ana.auth),
        request(server()).post(`/tenants/me/queues/${a.queueId}/call-next`).set(ben.auth),
      ]);
      expect(byAna.status).toBe(201);
      expect(byBen.status).toBe(201);
      expect(byAna.body.id).not.toBe(byBen.body.id);
      expect(ids.ben).not.toContain(byAna.body.id);
      expect(ids.ana).not.toContain(byBen.body.id);
    }
    // Each entry called at most once.
    const called = await prisma.queueEntry.count({
      where: { queueId: a.queueId, status: "CALLED" },
    });
    expect(called).toBe(8);
  });

  it("clocking out sends that person's waiting customers back to 'anyone', in place, and tells them", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Foxtrot");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    await clockIn(ana.auth).expect(201);
    const early = (await join(a, "021 900 0301").expect(201)).body;
    const forAna = (await join(a, "021 900 0302", ana.id).expect(201)).body;
    const before = await prisma.queueEntry.findUniqueOrThrow({ where: { id: forAna.id } });

    await request(server()).post("/tenants/me/shifts/clock-out").set(ana.auth).expect(204);

    const after = await prisma.queueEntry.findUniqueOrThrow({ where: { id: forAna.id } });
    expect(after.preferredStaffId).toBeNull();
    expect(after.joinedAt.getTime()).toBe(before.joinedAt.getTime()); // same place in line
    const notice = await prisma.notificationOutbox.findFirstOrThrow({
      where: { queueEntryId: forAna.id, type: "PREFERRED_STAFF_UNAVAILABLE" },
    });
    expect(notice.body).toContain("Ana has finished");
    // And the early "anyone" customer is still ahead of them.
    const ticket = await request(server())
      .get(`/public/queue-entries/${forAna.publicToken}`)
      .expect(200);
    expect(ticket.body.position).toBe(2);
    expect(early.position).toBe(1);
  });

  it("removing a member ends their shift and releases their customers too", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Golf");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    await clockIn(ana.auth).expect(201);
    const forAna = (await join(a, "021 900 0401", ana.id).expect(201)).body;
    await request(server()).delete(`/tenants/me/staff/${ana.id}`).set(owner.auth).expect(204);
    expect(
      (await prisma.queueEntry.findUniqueOrThrow({ where: { id: forAna.id } })).preferredStaffId,
    ).toBeNull();
    expect(await prisma.staffShift.count({ where: { tenantUserId: ana.id, endedAt: null } })).toBe(
      0,
    );
  });

  it("staff can change a waiting customer's preference at the counter", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Hotel");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    const ben = await staff(owner.auth, a.locationId, "Ben");
    await clockIn(ana.auth).expect(201);
    const waiting = (await join(a, "021 900 0501").expect(201)).body;

    const set = await request(server())
      .patch(`/tenants/me/queue-entries/${waiting.id}/preference`)
      .set(ana.auth)
      .send({ preferredStaffId: ana.id })
      .expect(200);
    expect(set.body.preferredStaffName).toBe("Ana");
    await request(server())
      .patch(`/tenants/me/queue-entries/${waiting.id}/preference`)
      .set(ana.auth)
      .send({ preferredStaffId: ben.id })
      .expect(409); // Ben isn't on shift
    await request(server())
      .patch(`/tenants/me/queue-entries/${waiting.id}/preference`)
      .set(ana.auth)
      .send({ preferredStaffId: null })
      .expect(200);

    await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ana.auth)
      .expect(201);
    await request(server())
      .patch(`/tenants/me/queue-entries/${waiting.id}/preference`)
      .set(ana.auth)
      .send({ preferredStaffId: ana.id })
      .expect(409); // already called
  });

  it("the TV board names who's serving, and who each waiting customer is waiting for", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "India");
    const ana = await staff(owner.auth, a.locationId, "Ana");
    await request(server())
      .patch("/auth/me/public-name")
      .set(ana.auth)
      .send({ publicName: "Ace" })
      .expect(200);
    await clockIn(ana.auth).expect(201);
    const display = await request(server())
      .post(`/tenants/me/queues/${a.queueId}/codes`)
      .set(owner.auth)
      .send({ contextType: "DISPLAY" })
      .expect(201);
    await join(a, "021 900 0601").expect(201);
    await join(a, "021 900 0602", ana.id).expect(201);
    await request(server())
      .post(`/tenants/me/queues/${a.queueId}/call-next`)
      .set(ana.auth)
      .expect(201);

    const snapshot = await prisma.code.findUniqueOrThrow({
      where: { publicCode: display.body.publicCode },
    });
    expect(snapshot.contextType).toBe("DISPLAY");
    const { DisplaysService } = await import("../src/displays/displays.service");
    const board = await app.get(DisplaysService).getSnapshot(a.queueId);
    expect(board.nowServing).toEqual([expect.objectContaining({ staffName: "Ace" })]);
    expect(board.next).toEqual([expect.objectContaining({ preferredStaffName: "Ace" })]);
  });
  it("joining with an email sends the ticket link there, and later notices too (Phase 19)", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Juliet");
    const joined = await request(server())
      .post(`/public/queues/${a.queueId}/entries`)
      .send({
        serviceId: a.serviceId,
        customerName: "C",
        customerPhone: "021 900 0701",
        customerEmail: "c@example.com",
      })
      .expect(201);
    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.body.id } });
    expect(entry.contactEmail).toBe("c@example.com");
    const sent = await prisma.notificationOutbox.findMany({
      where: { queueEntryId: entry.id },
      orderBy: { createdAt: "asc" },
    });
    const welcome = sent.find((n) => n.type === "JOINED");
    expect(welcome).toMatchObject({ channel: "EMAIL", recipient: "c@example.com" });
    expect(welcome!.body).toContain(`/queue/t/${joined.body.publicToken}`);
    // First in line, so "nearly next" goes to the same email, not SMS.
    expect(sent.find((n) => n.type === "NEARLY_NEXT")).toMatchObject({ channel: "EMAIL" });

    // Without an email: no "you're in" message, notices by SMS.
    const plain = await request(server())
      .post(`/public/queues/${a.queueId}/entries`)
      .send({ serviceId: a.serviceId, customerName: "D", customerPhone: "021 900 0702" })
      .expect(201);
    const plainSent = await prisma.notificationOutbox.findMany({
      where: { queueEntryId: plain.body.id },
    });
    expect(plainSent.some((n) => n.type === "JOINED")).toBe(false);
    expect(plainSent.every((n) => n.channel === "SMS")).toBe(true);
  });
  it("a signed-in customer sees where they can join or book, with no poster in hand (Phase 19)", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Kilo");
    // A second location with a queue but no customer poster isn't offered.
    await request(server())
      .post("/tenants/me/locations")
      .set(owner.auth)
      .send({ name: "Lima", timezone: "Pacific/Auckland" })
      .expect(201);
    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { name: `Shift Biz ${counter}` },
    });

    const email = `cust-${counter}@example.com`;
    await request(server())
      .post("/public/customers/signup")
      .send({ tenantId: tenant.id, name: "Cara", phone: "021 900 0801", email })
      .expect(202);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
    const code = await prisma.customerLoginCode.findFirstOrThrow({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });
    const session = await request(server())
      .post("/public/customers/login/verify")
      .send({ tenantId: tenant.id, email, code: recoverCodeFromHash(code.codeHash) })
      .expect(201);

    const locations = await request(server())
      .get("/customers/me/locations")
      .set(bearer(session.body.accessToken))
      .expect(200);
    expect(locations.body).toEqual([
      {
        id: a.locationId,
        name: "Kilo",
        address: null,
        queues: [{ name: "Kilo Queue", status: "ACTIVE", code: a.posterCode }],
        canBook: false, // the business hasn't switched appointments on
      },
    ]);
    // Staff tokens don't open the customer area.
    await request(server()).get("/customers/me/locations").set(owner.auth).expect(401);
  });

  it("the 'you're in' email carries the ticket's QR as an image (Phase 19)", async () => {
    const owner = await signUpOwner();
    const a = await addLocation(owner.auth, "Mike");
    const joined = await request(server())
      .post(`/public/queues/${a.queueId}/entries`)
      .send({
        serviceId: a.serviceId,
        customerName: "E",
        customerPhone: "021 900 0901",
        customerEmail: "e@example.com",
      })
      .expect(201);
    const token = joined.body.publicToken as string;
    const email = await prisma.notificationOutbox.findFirstOrThrow({
      where: { queueEntryId: joined.body.id, type: "JOINED" },
    });
    expect(email.htmlBody).toContain(`/public/queue-entries/${token}/qr.png`);
    expect(email.htmlBody).toContain(`/queue/t/${token}`); // the link too, clickable

    const image = await request(server())
      .get(`/public/queue-entries/${token}/qr.png`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect((image.body as Buffer).subarray(1, 4).toString()).toBe("PNG");
    await request(server()).get("/public/queue-entries/not-a-real-token/qr.png").expect(404);
  });
});
