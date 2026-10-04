import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AppointmentJobsService } from "../src/appointments/appointment-jobs.service";
import { formatLocalDate } from "../src/common/timezone.util";

const MINUTE = 60_000;

/**
 * Check-in tests are about "today" and "N minutes from now", so the
 * location's timezone is chosen where it's currently mid-day — otherwise a
 * run near local midnight would push "start in 5 minutes" onto tomorrow.
 */
function midDayTimezone(): string {
  const candidates = [
    "Pacific/Auckland",
    "Asia/Tokyo",
    "Asia/Kolkata",
    "Europe/London",
    "America/New_York",
    "America/Los_Angeles",
  ];
  for (const tz of candidates) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(
        new Date(),
      ),
    );
    if (hour >= 3 && hour <= 20) return tz;
  }
  throw new Error("No mid-day timezone found");
}

/**
 * Phase 14 (Appointment Check-In & Mixed Queue, ADR-013) — real Postgres.
 * Covers: check-in by link, scanner and staff, all idempotent and race-safe;
 * the G-25 priority order in Call Next, positions, and under concurrent
 * Call Next; no-show marking and same-day restore; reminder idempotency;
 * tenant isolation of the new endpoints.
 */
describe("Appointment check-in (integration)", () => {
  jest.setTimeout(120_000);

  const TZ = midDayTimezone();
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;
  let jobs: AppointmentJobsService;
  let counter = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = "integration-test-secret";
    process.env.EMAIL_PROVIDER = "mock";
    process.env.SMS_PROVIDER = "mock";
    process.env.DISABLE_RATE_LIMITING = "true";
    // The tests drive the jobs themselves with a chosen `now`.
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
    jobs = app.get(AppointmentJobsService);
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

  async function signUp(name: string) {
    counter += 1;
    const email = `checkin-${counter}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/business-signup")
      .send({ businessName: name, ownerName: "Owner", email })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const latest = await prisma.loginCode.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const res = await request(app.getHttpServer())
      .post("/auth/login/verify")
      .send({ email, code: recoverCodeFromHash(latest.codeHash) })
      .expect(201);
    return res.body as { accessToken: string; tenant: { id: string } };
  }

  /** A tenant with appointments on, one location, one service attached to one active queue. */
  async function setUpBusiness(name: string) {
    const owner = await signUp(name);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const server = app.getHttpServer();
    await request(server)
      .patch("/tenants/me/capabilities")
      .set(auth)
      .send({ appointmentEnabled: true })
      .expect(200);
    const location = await request(server)
      .post("/tenants/me/locations")
      .set(auth)
      .send({ name: `${name} Shop`, timezone: TZ })
      .expect(201);
    const service = await request(server)
      .post("/tenants/me/services")
      .set(auth)
      .send({
        locationId: location.body.id,
        name: "Consult",
        durationMinutes: 20,
        appointmentEnabled: true,
      })
      .expect(201);
    const queue = await request(server)
      .post("/tenants/me/queues")
      .set(auth)
      .send({ locationId: location.body.id, name: "Main" })
      .expect(201);
    await request(server)
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set(auth)
      .send({ serviceId: service.body.id })
      .expect(201);
    return {
      tenantId: owner.tenant.id,
      auth,
      locationId: location.body.id as string,
      serviceId: service.body.id as string,
      queueId: queue.body.id as string,
    };
  }

  type Business = Awaited<ReturnType<typeof setUpBusiness>>;

  /** Inserted directly so the start time can be anything (the booking API only offers future grid slots). */
  async function createAppointment(
    biz: Business,
    startsAt: Date,
    extra: { status?: "BOOKED" | "CANCELLED"; createdAt?: Date } = {},
  ) {
    counter += 1;
    const customer = await prisma.customer.create({
      data: {
        tenantId: biz.tenantId,
        phoneE164: `+6421${String(counter).padStart(7, "0")}`,
        firstName: `Booker ${counter}`,
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        tenantId: biz.tenantId,
        locationId: biz.locationId,
        serviceId: biz.serviceId,
        customerId: customer.id,
        publicToken: `appt_${randomUUID()}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * MINUTE),
        occupiedUntil: new Date(startsAt.getTime() + 20 * MINUTE),
        localDate: new Date(`${formatLocalDate(TZ, startsAt)}T00:00:00Z`),
        status: extra.status ?? "BOOKED",
        ...(extra.createdAt && { createdAt: extra.createdAt }),
      },
    });
    const code = await prisma.code.create({
      data: {
        tenantId: biz.tenantId,
        contextType: "APPOINTMENT_TICKET",
        appointmentId: appointment.id,
        // Same 64-char shape the backfill migration mints, which must stay scannable.
        publicCode: `${randomUUID()}${randomUUID()}`.replace(/-/g, ""),
      },
    });
    return { appointment, ticketCode: code.publicCode };
  }

  const minutesFromNow = (m: number): Date => new Date(Date.now() + m * MINUTE);

  async function joinWalkIn(biz: Business, name: string) {
    counter += 1;
    const res = await request(app.getHttpServer())
      .post(`/public/queues/${biz.queueId}/entries`)
      .send({
        serviceId: biz.serviceId,
        customerName: name,
        customerPhone: `021 9${String(counter).padStart(6, "0")}`,
      })
      .expect(201);
    return res.body as { id: string; publicToken: string; ticketNumber: number };
  }

  function callNext(biz: Business) {
    return request(app.getHttpServer())
      .post(`/tenants/me/queues/${biz.queueId}/call-next`)
      .set(biz.auth);
  }

  it("checks in by link: creates a priority-tagged entry, marks CHECKED_IN, and is idempotent", async () => {
    const biz = await setUpBusiness("Link Check-in");
    const startsAt = minutesFromNow(30);
    const { appointment } = await createAppointment(biz, startsAt);

    const before = await request(app.getHttpServer())
      .get(`/public/appointments/${appointment.publicToken}`)
      .expect(200);
    expect(before.body.canCheckIn).toBe(true);
    expect(before.body.checkInCode).toBeTruthy();

    const first = await request(app.getHttpServer())
      .post(`/public/appointments/${appointment.publicToken}/check-in`)
      .expect(201);
    expect(first.body.status).toBe("WAITING");
    expect(first.body.publicToken).toBeTruthy();

    const again = await request(app.getHttpServer())
      .post(`/public/appointments/${appointment.publicToken}/check-in`)
      .expect(201);
    expect(again.body.publicToken).toBe(first.body.publicToken);

    const entry = await prisma.queueEntry.findUniqueOrThrow({
      where: { publicToken: first.body.publicToken },
    });
    expect(entry.appointmentId).toBe(appointment.id);
    // priorityFrom = startsAt minus the default 10-minute window.
    expect(entry.priorityFrom?.getTime()).toBe(startsAt.getTime() - 10 * MINUTE);
    const reloaded = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(reloaded.status).toBe("CHECKED_IN");
    expect(reloaded.checkedInAt).not.toBeNull();

    const after = await request(app.getHttpServer())
      .get(`/public/appointments/${appointment.publicToken}`)
      .expect(200);
    expect(after.body.queueTicketToken).toBe(first.body.publicToken);
    expect(after.body.canCheckIn).toBe(false);
  });

  it("serializes simultaneous check-ins (scan + link + staff) into one queue entry", async () => {
    const biz = await setUpBusiness("Check-in Race");
    const { appointment, ticketCode } = await createAppointment(biz, minutesFromNow(30));
    const server = app.getHttpServer();

    const results = await Promise.all([
      request(server).post(`/public/appointments/${appointment.publicToken}/check-in`),
      request(server)
        .post(`/tenants/me/queues/${biz.queueId}/scan`)
        .set(biz.auth)
        .send({ code: ticketCode }),
      request(server)
        .post(`/tenants/me/appointments/${appointment.id}/check-in`)
        .set(biz.auth)
        .send({}),
      request(server).post(`/public/appointments/${appointment.publicToken}/check-in`),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.queueEntry.count({ where: { appointmentId: appointment.id } })).toBe(1);
  });

  it("checks in by scanner, and rejects a ticket from another location with the uniform 404", async () => {
    const biz = await setUpBusiness("Scanner Check-in");
    const { appointment, ticketCode } = await createAppointment(biz, minutesFromNow(30));
    const scanned = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${biz.queueId}/scan`)
      .set(biz.auth)
      .send({ code: ticketCode })
      .expect(201);
    expect(scanned.body.appointmentStartsAt).toBe(appointment.startsAt.toISOString());

    // A second location's queue, same tenant.
    const otherLocation = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set(biz.auth)
      .send({ name: "Elsewhere", timezone: TZ })
      .expect(201);
    const otherQueue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set(biz.auth)
      .send({ locationId: otherLocation.body.id, name: "Other" })
      .expect(201);
    const elsewhere = await createAppointment(biz, minutesFromNow(40));
    const res = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${otherQueue.body.id}/scan`)
      .set(biz.auth)
      .send({ code: elsewhere.ticketCode })
      .expect(404);
    expect(res.body.code).toBe("SCAN_CODE_NOT_FOUND");
  });

  it("refuses check-in on another day, or for a cancelled booking", async () => {
    const biz = await setUpBusiness("Check-in Rules");
    const tomorrow = await createAppointment(biz, minutesFromNow(24 * 60 + 5));
    const notToday = await request(app.getHttpServer())
      .post(`/public/appointments/${tomorrow.appointment.publicToken}/check-in`)
      .expect(409);
    expect(notToday.body.code).toBe("APPOINTMENT_NOT_TODAY");

    const cancelled = await createAppointment(biz, minutesFromNow(30), { status: "CANCELLED" });
    const res = await request(app.getHttpServer())
      .post(`/public/appointments/${cancelled.appointment.publicToken}/check-in`)
      .expect(409);
    expect(res.body.code).toBe("APPOINTMENT_NOT_CHECKABLE");
  });

  it("calls an open-window appointment before earlier walk-ins, and an early one in normal order (G-25)", async () => {
    const biz = await setUpBusiness("Priority Order");
    const walk1 = await joinWalkIn(biz, "Walk One");
    const walk2 = await joinWalkIn(biz, "Walk Two");

    // Starts in 5 min: its 10-min window is already open.
    const soon = await createAppointment(biz, minutesFromNow(5));
    const soonEntry = await request(app.getHttpServer())
      .post(`/public/appointments/${soon.appointment.publicToken}/check-in`)
      .expect(201);
    expect(soonEntry.body.position).toBe(1);

    // Starts in 2 hours: checked in early, so it waits behind the walk-ins already here.
    const later = await createAppointment(biz, minutesFromNow(120));
    const laterEntry = await request(app.getHttpServer())
      .post(`/public/appointments/${later.appointment.publicToken}/check-in`)
      .expect(201);
    expect(laterEntry.body.position).toBe(4);

    const list = await request(app.getHttpServer())
      .get(`/tenants/me/queues/${biz.queueId}/entries`)
      .query({ status: "WAITING" })
      .set(biz.auth)
      .expect(200);
    expect(list.body.map((e: { id: string }) => e.id)).toEqual([
      soonEntry.body.id,
      walk1.id,
      walk2.id,
      laterEntry.body.id,
    ]);
    expect(list.body[0].priorityActive).toBe(true);
    expect(list.body[3].priorityActive).toBe(false);

    const calledFirst = await callNext(biz).expect(201);
    expect(calledFirst.body.id).toBe(soonEntry.body.id);
    const calledSecond = await callNext(biz).expect(201);
    expect(calledSecond.body.id).toBe(walk1.id);
  });

  it("never gives two concurrent Call Nexts the same entry, and serves priority first", async () => {
    const biz = await setUpBusiness("Priority Race");
    await joinWalkIn(biz, "Walk A");
    await joinWalkIn(biz, "Walk B");
    const appts = [
      await createAppointment(biz, minutesFromNow(3)),
      await createAppointment(biz, minutesFromNow(6)),
    ];
    const apptEntryIds: string[] = [];
    for (const { appointment } of appts) {
      const res = await request(app.getHttpServer())
        .post(`/public/appointments/${appointment.publicToken}/check-in`)
        .expect(201);
      apptEntryIds.push(res.body.id);
    }

    const [a, b] = await Promise.all([callNext(biz), callNext(biz)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    // The two priority entries are the first two called, whichever staff got which.
    expect(new Set([a.body.id, b.body.id])).toEqual(new Set(apptEntryIds));
  });

  it("marks no-shows after the grace period, lets staff restore one the same day, and the restore sticks", async () => {
    const biz = await setUpBusiness("No Shows");
    const missed = await createAppointment(biz, minutesFromNow(-20));
    const stillInGrace = await createAppointment(biz, minutesFromNow(-5));

    const marked = await jobs.markNoShows();
    expect(marked).toContain(missed.appointment.id);
    expect(marked).not.toContain(stillInGrace.appointment.id);

    const scanMissed = await request(app.getHttpServer())
      .post(`/tenants/me/queues/${biz.queueId}/scan`)
      .set(biz.auth)
      .send({ code: missed.ticketCode })
      .expect(409);
    expect(scanMissed.body.code).toBe("APPOINTMENT_NOT_CHECKABLE");

    const restored = await request(app.getHttpServer())
      .post(`/tenants/me/appointments/${missed.appointment.id}/restore`)
      .set(biz.auth)
      .expect(201);
    expect(restored.body.status).toBe("BOOKED");
    expect(restored.body.noShowAt).not.toBeNull(); // the record stays

    expect(await jobs.markNoShows()).not.toContain(missed.appointment.id);
    await request(app.getHttpServer())
      .post(`/tenants/me/appointments/${missed.appointment.id}/check-in`)
      .set(biz.auth)
      .send({})
      .expect(201);

    // Restoring something that isn't a no-show is refused.
    const notNoShow = await request(app.getHttpServer())
      .post(`/tenants/me/appointments/${stillInGrace.appointment.id}/restore`)
      .set(biz.auth)
      .expect(409);
    expect(notNoShow.body.code).toBe("APPOINTMENT_NOT_RESTORABLE");
  });

  it("sends the nearest due reminder exactly once, however often the job runs", async () => {
    const biz = await setUpBusiness("Reminders");
    // Booked three days ago, starting in 90 minutes: both the 24h and the
    // 2h reminders are due — only the 2h one should go.
    const { appointment } = await createAppointment(biz, minutesFromNow(90), {
      createdAt: new Date(Date.now() - 3 * 24 * 60 * MINUTE),
    });

    const [first, second] = await Promise.all([jobs.sendDueReminders(), jobs.sendDueReminders()]);
    expect(first + second).toBe(1);
    expect(await jobs.sendDueReminders()).toBe(0);

    const reminders = await prisma.notificationOutbox.findMany({
      where: { appointmentId: appointment.id, type: "APPOINTMENT_REMINDER" },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].reminderOffsetMinutes).toBe(120);
    expect(reminders[0].body).toContain(`/appointment/${appointment.publicToken}`);
  });

  it("isolates check-in and restore by tenant", async () => {
    const a = await setUpBusiness("Tenant A Check-in");
    const b = await setUpBusiness("Tenant B Check-in");
    const { appointment, ticketCode } = await createAppointment(a, minutesFromNow(30));
    const server = app.getHttpServer();

    await request(server)
      .post(`/tenants/me/appointments/${appointment.id}/check-in`)
      .set(b.auth)
      .send({})
      .expect(404);
    await request(server)
      .post(`/tenants/me/appointments/${appointment.id}/restore`)
      .set(b.auth)
      .expect(404);
    await request(server)
      .post(`/tenants/me/queues/${b.queueId}/scan`)
      .set(b.auth)
      .send({ code: ticketCode })
      .expect(404);

    const untouched = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(untouched.status).toBe("BOOKED");
  });

  it("mints a check-in ticket code with every booking", async () => {
    const biz = await setUpBusiness("Ticket On Booking");
    // A full day of hours on tomorrow's weekday so the booking API has slots.
    const tomorrow = formatLocalDate(TZ, minutesFromNow(24 * 60));
    const dayOfWeek = new Date(`${tomorrow}T00:00:00Z`).getUTCDay();
    await request(app.getHttpServer())
      .put(`/tenants/me/locations/${biz.locationId}/business-hours`)
      .set(biz.auth)
      .send({ entries: [{ dayOfWeek, opensAtMinutes: 540, closesAtMinutes: 1020 }] })
      .expect(200);
    const availability = await request(app.getHttpServer())
      .get(`/public/locations/${biz.locationId}/appointment-availability`)
      .query({ serviceId: biz.serviceId, date: tomorrow })
      .expect(200);
    const booked = await request(app.getHttpServer())
      .post(`/public/locations/${biz.locationId}/appointments`)
      .send({
        serviceId: biz.serviceId,
        startsAt: availability.body.slots[0].startsAt,
        customerName: "Booker",
        customerPhone: "021 444 1000",
      })
      .expect(201);
    expect(booked.body.checkInCode).toBeTruthy();
    expect(booked.body.canCheckIn).toBe(false); // not today

    const code = await prisma.code.findUniqueOrThrow({
      where: { publicCode: booked.body.checkInCode },
    });
    expect(code.contextType).toBe("APPOINTMENT_TICKET");
    // Secret, and never resolvable through the public code endpoint.
    await request(app.getHttpServer()).get(`/public/codes/${code.publicCode}`).expect(404);
  });
});
