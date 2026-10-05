import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { addDays, formatLocalDate } from "../src/common/timezone.util";

const TZ = "Pacific/Auckland";

/**
 * Phase 13 (Appointment Engine, ADR-012) — real Postgres via Testcontainers.
 * The acceptance criteria: concurrent bookings for the last unit of
 * capacity yield exactly one success; idempotent retries; closures and the
 * daily cap shape availability; customer cancel blocked inside the notice
 * window; staff calendar + cancel-with-reason; cross-tenant isolation on
 * every staff endpoint.
 */
describe("Appointments (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;
  let emailCounter = 0;

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

  async function signUpAndVerify(businessName: string) {
    emailCounter += 1;
    const email = `appt-owner-${emailCounter}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName, ownerName: "Owner", email })
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
    return verifyRes.body as { accessToken: string; tenant: { id: string } };
  }

  /** A tenant with appointments on, one location open 09:00–17:00 every day, and one 30-minute bookable service. */
  async function setUpBookableBusiness(name: string, locationOverrides: object = {}) {
    const owner = await signUpAndVerify(name);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    await request(app.getHttpServer())
      .patch("/tenants/me/capabilities")
      .set(auth)
      .send({ appointmentEnabled: true })
      .expect(200);
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set(auth)
      .send({ name: `${name} Shop`, timezone: TZ })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/tenants/me/locations/${location.body.id}/business-hours`)
      .set(auth)
      .send({
        entries: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          opensAtMinutes: 540,
          closesAtMinutes: 1020,
        })),
      })
      .expect(200);
    if (Object.keys(locationOverrides).length > 0) {
      await request(app.getHttpServer())
        .patch(`/tenants/me/locations/${location.body.id}`)
        .set(auth)
        .send(locationOverrides)
        .expect(200);
    }
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set(auth)
      .send({
        locationId: location.body.id,
        name: "Consult",
        durationMinutes: 30,
        appointmentEnabled: true,
      })
      .expect(201);
    return {
      owner,
      auth,
      locationId: location.body.id as string,
      serviceId: service.body.id as string,
    };
  }

  /** A date safely inside the default lead time and advance window. */
  const bookingDate = (): string => addDays(formatLocalDate(TZ, new Date()), 3);

  async function availability(locationId: string, serviceId: string, date = bookingDate()) {
    const res = await request(app.getHttpServer())
      .get(`/public/locations/${locationId}/appointment-availability`)
      .query({ serviceId, date })
      .expect(200);
    return res.body as { slots: Array<{ startsAt: string; localTime: string }> };
  }

  async function slotAt(locationId: string, serviceId: string, localTime: string) {
    const { slots } = await availability(locationId, serviceId);
    const slot = slots.find((s) => s.localTime === localTime);
    if (!slot) throw new Error(`No ${localTime} slot offered`);
    return slot.startsAt;
  }

  function book(locationId: string, body: object) {
    return request(app.getHttpServer())
      .post(`/public/locations/${locationId}/appointments`)
      .send(body);
  }

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `021 700 ${String(phoneCounter).padStart(4, "0")}`;
  }

  it("offers grid slots, books one, removes it from availability, and enqueues a confirmation", async () => {
    const biz = await setUpBookableBusiness("Booking Basics");
    const { slots } = await availability(biz.locationId, biz.serviceId);
    // 09:00..16:30 on a 15-minute grid, a 30-minute service: 31 starts.
    expect(slots).toHaveLength(31);
    expect(slots[0].localTime).toBe("09:00");

    const res = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: slots[0].startsAt,
      customerName: "Ana",
      customerPhone: nextPhone(),
    }).expect(201);
    expect(res.body.status).toBe("BOOKED");
    expect(res.body.publicToken.length).toBeGreaterThanOrEqual(27);
    expect(res.body.canCancel).toBe(true);

    const after = await availability(biz.locationId, biz.serviceId);
    expect(after.slots.map((s) => s.localTime)).not.toContain("09:00");
    expect(after.slots.map((s) => s.localTime)).not.toContain("09:15");
    expect(after.slots[0].localTime).toBe("09:30");

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { publicToken: res.body.publicToken },
    });
    const outbox = await prisma.notificationOutbox.findMany({
      where: { appointmentId: appointment.id },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].type).toBe("APPOINTMENT_BOOKED");
    expect(outbox[0].queueEntryId).toBeNull();
    expect(outbox[0].body).toContain(`/appointment/${res.body.publicToken}`);

    const publicView = await request(app.getHttpServer())
      .get(`/public/appointments/${res.body.publicToken}`)
      .expect(200);
    expect(publicView.body.service.name).toBe("Consult");
    expect(publicView.body).not.toHaveProperty("customer");
  });

  it("emails the confirmation with an add-to-calendar link when an email is given (Phase 19)", async () => {
    const biz = await setUpBookableBusiness("Booking Email");
    const { slots } = await availability(biz.locationId, biz.serviceId);

    const withEmail = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: slots[0].startsAt,
      customerName: "Ana",
      customerPhone: nextPhone(),
      customerEmail: " Ana@Example.com ",
    }).expect(201);
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { publicToken: withEmail.body.publicToken },
    });
    expect(appointment.contactEmail).toBe("ana@example.com");
    const [confirmation] = await prisma.notificationOutbox.findMany({
      where: { appointmentId: appointment.id, type: "APPOINTMENT_BOOKED" },
    });
    expect(confirmation).toMatchObject({ channel: "EMAIL", recipient: "ana@example.com" });
    expect(confirmation.body).toContain("calendar.google.com/calendar/render");
    expect(confirmation.body).toContain(`/appointment/${withEmail.body.publicToken}`);
    // The contact email is for this booking only — it never becomes an account login.
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: appointment.customerId },
    });
    expect(customer.email).toBeNull();

    // A blank email is the same as none: SMS, no calendar link.
    const blank = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: slots[4].startsAt,
      customerName: "Ben",
      customerPhone: nextPhone(),
      customerEmail: "",
    }).expect(201);
    const blankRow = await prisma.appointment.findUniqueOrThrow({
      where: { publicToken: blank.body.publicToken },
    });
    const [sms] = await prisma.notificationOutbox.findMany({
      where: { appointmentId: blankRow.id, type: "APPOINTMENT_BOOKED" },
    });
    expect(sms.channel).toBe("SMS");
    expect(sms.body).not.toContain("calendar.google.com");

    await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: slots[8].startsAt,
      customerName: "Cy",
      customerPhone: nextPhone(),
      customerEmail: "not-an-email",
    }).expect(400);
  });

  it("serializes concurrent bookings — exactly one wins the last unit of capacity", async () => {
    const biz = await setUpBookableBusiness("Race Capacity One");
    const startsAt = await slotAt(biz.locationId, biz.serviceId, "10:00");

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        book(biz.locationId, {
          serviceId: biz.serviceId,
          startsAt,
          customerName: "Racer",
          customerPhone: nextPhone(),
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("SLOT_UNAVAILABLE");
    expect(await prisma.appointment.count({ where: { locationId: biz.locationId } })).toBe(1);
  });

  it("fills a capacity-2 pool with exactly two concurrent bookings", async () => {
    const biz = await setUpBookableBusiness("Race Capacity Two", { appointmentCapacity: 2 });
    const startsAt = await slotAt(biz.locationId, biz.serviceId, "11:00");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        book(biz.locationId, {
          serviceId: biz.serviceId,
          startsAt,
          customerName: "Racer",
          customerPhone: nextPhone(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await prisma.appointment.count({ where: { locationId: biz.locationId } })).toBe(2);
  });

  it("returns the same booking for a replayed idempotency key (G-21), even concurrently", async () => {
    const biz = await setUpBookableBusiness("Idempotent Booker");
    const startsAt = await slotAt(biz.locationId, biz.serviceId, "12:00");
    const body = {
      serviceId: biz.serviceId,
      startsAt,
      customerName: "Retry",
      customerPhone: nextPhone(),
      idempotencyKey: "appt-key-1",
    };

    const [first, second] = await Promise.all([
      book(biz.locationId, body),
      book(biz.locationId, body),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.publicToken).toBe(first.body.publicToken);
    expect(await prisma.appointment.count({ where: { locationId: biz.locationId } })).toBe(1);
  });

  it("rejects a start that isn't an offered slot", async () => {
    const biz = await setUpBookableBusiness("Off Grid");
    const offered = await slotAt(biz.locationId, biz.serviceId, "09:00");
    const offGrid = new Date(new Date(offered).getTime() + 7 * 60_000).toISOString();
    const res = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: offGrid,
      customerName: "Odd",
      customerPhone: nextPhone(),
    }).expect(409);
    expect(res.body.code).toBe("SLOT_UNAVAILABLE");
  });

  it("validates the booking body", async () => {
    const biz = await setUpBookableBusiness("Bad Body");
    await book(biz.locationId, { serviceId: biz.serviceId, startsAt: "tomorrow" }).expect(400);
  });

  it("404s availability when the tenant's Appointment capability is off", async () => {
    const biz = await setUpBookableBusiness("Capability Off");
    await request(app.getHttpServer())
      .patch("/tenants/me/capabilities")
      .set(biz.auth)
      .send({ appointmentEnabled: false })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/public/locations/${biz.locationId}/appointment-availability`)
      .query({ serviceId: biz.serviceId, date: bookingDate() })
      .expect(404);
  });

  it("enforces the daily cap", async () => {
    const biz = await setUpBookableBusiness("Daily Cap", { maxAppointmentsPerDay: 1 });
    const startsAt = await slotAt(biz.locationId, biz.serviceId, "09:00");
    await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt,
      customerName: "First",
      customerPhone: nextPhone(),
    }).expect(201);
    expect((await availability(biz.locationId, biz.serviceId)).slots).toHaveLength(0);
  });

  it("lets a customer cancel inside the window, once, and blocks it past the notice cut-off", async () => {
    const biz = await setUpBookableBusiness("Customer Cancel");
    const first = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: await slotAt(biz.locationId, biz.serviceId, "09:00"),
      customerName: "Early",
      customerPhone: nextPhone(),
    }).expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/public/appointments/${first.body.publicToken}/cancel`)
      .expect(201);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.cancellationReason).toBe("CUSTOMER_REQUESTED");
    expect(cancelled.body.canCancel).toBe(false);
    const again = await request(app.getHttpServer())
      .post(`/public/appointments/${first.body.publicToken}/cancel`)
      .expect(409);
    expect(again.body.code).toBe("APPOINTMENT_NOT_BOOKED");
    // The slot is free again.
    expect((await availability(biz.locationId, biz.serviceId)).slots[0].localTime).toBe("09:00");

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { publicToken: first.body.publicToken },
    });
    expect(
      await prisma.notificationOutbox.count({
        where: { appointmentId: appointment.id, type: "APPOINTMENT_CANCELLED" },
      }),
    ).toBe(1);

    const second = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: await slotAt(biz.locationId, biz.serviceId, "10:00"),
      customerName: "Late",
      customerPhone: nextPhone(),
    }).expect(201);
    await request(app.getHttpServer())
      .patch("/tenants/me/appointment-settings")
      .set(biz.auth)
      .send({ cancelNoticeMinutes: 7 * 24 * 60 })
      .expect(200);
    const blocked = await request(app.getHttpServer())
      .post(`/public/appointments/${second.body.publicToken}/cancel`)
      .expect(409);
    expect(blocked.body.code).toBe("CANCELLATION_WINDOW_PASSED");
  });

  it("closures remove slots and report the bookings they overlap (G-26)", async () => {
    const biz = await setUpBookableBusiness("Closures");
    const date = bookingDate();
    const booked = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: await slotAt(biz.locationId, biz.serviceId, "10:00"),
      customerName: "Overlapped",
      customerPhone: nextPhone(),
    }).expect(201);

    const partial = await request(app.getHttpServer())
      .post(`/tenants/me/locations/${biz.locationId}/closures`)
      .set(biz.auth)
      .send({ date, startMinutes: 600, endMinutes: 720, reason: "Staff training" })
      .expect(201);
    expect(partial.body.closure).toMatchObject({ date, startMinutes: 600, endMinutes: 720 });
    expect(partial.body.affectedAppointments).toHaveLength(1);
    expect(partial.body.affectedAppointments[0].status).toBe("BOOKED");
    // Not auto-cancelled.
    const stillBooked = await request(app.getHttpServer())
      .get(`/public/appointments/${booked.body.publicToken}`)
      .expect(200);
    expect(stillBooked.body.status).toBe("BOOKED");

    const times = (await availability(biz.locationId, biz.serviceId)).slots.map((s) => s.localTime);
    expect(times).toContain("09:30");
    expect(times).not.toContain("09:45"); // would run into 10:00
    expect(times).not.toContain("11:45");
    expect(times).toContain("12:00");

    const fullDay = await request(app.getHttpServer())
      .post(`/tenants/me/locations/${biz.locationId}/closures`)
      .set(biz.auth)
      .send({ date })
      .expect(201);
    expect((await availability(biz.locationId, biz.serviceId)).slots).toHaveLength(0);

    const listed = await request(app.getHttpServer())
      .get(`/tenants/me/locations/${biz.locationId}/closures`)
      .set(biz.auth)
      .expect(200);
    expect(listed.body).toHaveLength(2);

    await request(app.getHttpServer())
      .delete(`/tenants/me/locations/${biz.locationId}/closures/${fullDay.body.closure.id}`)
      .set(biz.auth)
      .expect(204);
    expect((await availability(biz.locationId, biz.serviceId)).slots.length).toBeGreaterThan(0);
  });

  it("rejects a half-specified closure range", async () => {
    const biz = await setUpBookableBusiness("Half Closure");
    await request(app.getHttpServer())
      .post(`/tenants/me/locations/${biz.locationId}/closures`)
      .set(biz.auth)
      .send({ date: bookingDate(), startMinutes: 600 })
      .expect(400);
  });

  it("staff calendar counts BOOKED per day, lists the day, books by phone, and cancels with a required reason", async () => {
    const biz = await setUpBookableBusiness("Staff Calendar");
    const date = bookingDate();

    // Slots are resolved before each request is built: supertest closes the
    // shared server when any request finishes, so awaiting a nested request
    // mid-chain would break the outer one.
    const thirteen = await slotAt(biz.locationId, biz.serviceId, "13:00");
    const staffBooked = await request(app.getHttpServer())
      .post(`/tenants/me/locations/${biz.locationId}/appointments`)
      .set(biz.auth)
      .send({
        serviceId: biz.serviceId,
        startsAt: thirteen,
        customerName: "Phone Booking",
        customerPhone: nextPhone(),
      })
      .expect(201);
    await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: await slotAt(biz.locationId, biz.serviceId, "14:00"),
      customerName: "Online Booking",
      customerPhone: nextPhone(),
    }).expect(201);

    const month = date.slice(0, 7);
    const calendar = await request(app.getHttpServer())
      .get(`/tenants/me/locations/${biz.locationId}/appointments/calendar`)
      .query({ month })
      .set(biz.auth)
      .expect(200);
    expect(calendar.body).toEqual([{ date, count: 2 }]);

    const day = await request(app.getHttpServer())
      .get(`/tenants/me/locations/${biz.locationId}/appointments`)
      .query({ date })
      .set(biz.auth)
      .expect(200);
    expect(day.body).toHaveLength(2);
    expect(day.body[0].customer.firstName).toBe("Phone Booking");
    expect(day.body[0].bookedByStaff).toBe(true);
    expect(day.body[1].bookedByStaff).toBe(false);

    const target = day.body[0].id;
    await request(app.getHttpServer())
      .post(`/tenants/me/appointments/${target}/cancel`)
      .set(biz.auth)
      .send({})
      .expect(400);
    const cancelled = await request(app.getHttpServer())
      .post(`/tenants/me/appointments/${target}/cancel`)
      .set(biz.auth)
      .send({ reason: "NO_AVAILABILITY", note: "Practitioner ill" })
      .expect(201);
    expect(cancelled.body).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "NO_AVAILABILITY",
      cancellationNote: "Practitioner ill",
    });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: target } });
    expect(row.cancelledByStaffId).not.toBeNull();
    expect(staffBooked.body.status).toBe("BOOKED");

    const recount = await request(app.getHttpServer())
      .get(`/tenants/me/locations/${biz.locationId}/appointments/calendar`)
      .query({ month })
      .set(biz.auth)
      .expect(200);
    expect(recount.body).toEqual([{ date, count: 1 }]);
  });

  it("isolates every staff appointment endpoint by tenant", async () => {
    const a = await setUpBookableBusiness("Tenant A Appts");
    const b = await setUpBookableBusiness("Tenant B Appts");
    const date = bookingDate();
    const aBooking = await book(a.locationId, {
      serviceId: a.serviceId,
      startsAt: await slotAt(a.locationId, a.serviceId, "15:00"),
      customerName: "A Customer",
      customerPhone: nextPhone(),
    }).expect(201);
    const aAppointment = await prisma.appointment.findUniqueOrThrow({
      where: { publicToken: aBooking.body.publicToken },
    });
    const server = app.getHttpServer();

    await request(server)
      .get(`/tenants/me/locations/${a.locationId}/appointments`)
      .query({ date })
      .set(b.auth)
      .expect(404);
    await request(server)
      .get(`/tenants/me/locations/${a.locationId}/appointments/calendar`)
      .query({ month: date.slice(0, 7) })
      .set(b.auth)
      .expect(404);
    await request(server)
      .get(`/tenants/me/locations/${a.locationId}/closures`)
      .set(b.auth)
      .expect(404);
    await request(server)
      .post(`/tenants/me/locations/${a.locationId}/closures`)
      .set(b.auth)
      .send({ date })
      .expect(404);
    const sixteen = await slotAt(a.locationId, a.serviceId, "16:00");
    await request(server)
      .post(`/tenants/me/locations/${a.locationId}/appointments`)
      .set(b.auth)
      .send({
        serviceId: a.serviceId,
        startsAt: sixteen,
        customerName: "Intruder",
        customerPhone: nextPhone(),
      })
      .expect(404);
    await request(server)
      .post(`/tenants/me/appointments/${aAppointment.id}/cancel`)
      .set(b.auth)
      .send({ reason: "OTHER" })
      .expect(404);
    // A's service can't be booked through B's location either.
    await request(server)
      .get(`/public/locations/${b.locationId}/appointment-availability`)
      .query({ serviceId: a.serviceId, date })
      .expect(404);

    const untouched = await prisma.appointment.findUniqueOrThrow({
      where: { id: aAppointment.id },
    });
    expect(untouched.status).toBe("BOOKED");
    expect(await prisma.locationClosure.count({ where: { locationId: a.locationId } })).toBe(0);
  });

  it("offers BOOK_APPOINTMENT on the location's QUEUE code when something is bookable", async () => {
    const biz = await setUpBookableBusiness("Code Offers Booking");
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set(biz.auth)
      .send({ locationId: biz.locationId, name: "Main" })
      .expect(201);
    const code = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/codes`)
      .set(biz.auth)
      .expect(201);

    const resolved = await request(app.getHttpServer())
      .get(`/public/codes/${code.body.publicCode}`)
      .expect(200);
    expect(resolved.body.capabilities).toEqual(["JOIN_QUEUE", "BOOK_APPOINTMENT"]);
    expect(resolved.body.location.id).toBe(biz.locationId);
    expect(resolved.body.appointmentServices).toEqual([
      { id: biz.serviceId, name: "Consult", durationMinutes: 30 },
    ]);
  });

  it("shows a signed-up customer their upcoming bookings in the portal", async () => {
    const biz = await setUpBookableBusiness("Portal Bookings");
    const phone = "021 555 9911";
    const email = "portal-booker@example.com";
    await request(app.getHttpServer())
      .post("/public/customers/signup")
      .send({ tenantId: biz.owner.tenant.id, name: "Pat", phone, email })
      .expect(202);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_email: { tenantId: biz.owner.tenant.id, email } },
    });
    const latest = await prisma.customerLoginCode.findFirstOrThrow({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });
    const session = await request(app.getHttpServer())
      .post("/public/customers/login/verify")
      .send({ tenantId: biz.owner.tenant.id, email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);

    // Booked anonymously, with the account's phone — still lands in the portal.
    const booked = await book(biz.locationId, {
      serviceId: biz.serviceId,
      startsAt: await slotAt(biz.locationId, biz.serviceId, "09:00"),
      customerName: "Pat",
      customerPhone: phone,
    }).expect(201);

    const upcoming = await request(app.getHttpServer())
      .get("/customers/me/appointments")
      .set("Authorization", `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(upcoming.body).toHaveLength(1);
    expect(upcoming.body[0].publicToken).toBe(booked.body.publicToken);

    // An account holder gets the confirmation by email (resolveChannel).
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { type: "APPOINTMENT_BOOKED", recipient: email },
    });
    expect(outbox.channel).toBe("EMAIL");
  });

  it("validates and applies appointment settings", async () => {
    const biz = await setUpBookableBusiness("Settings");
    await request(app.getHttpServer())
      .patch("/tenants/me/appointment-settings")
      .set(biz.auth)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch("/tenants/me/appointment-settings")
      .set(biz.auth)
      .send({ slotIntervalMinutes: 60 })
      .expect(200);
    const settings = await request(app.getHttpServer())
      .get("/tenants/me/appointment-settings")
      .set(biz.auth)
      .expect(200);
    expect(settings.body.slotIntervalMinutes).toBe(60);
    const { slots } = await availability(biz.locationId, biz.serviceId);
    expect(slots.map((s) => s.localTime).slice(0, 3)).toEqual(["09:00", "10:00", "11:00"]);
  });
});
