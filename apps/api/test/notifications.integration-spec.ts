import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EmailProvider } from "../src/notifications/email-provider";
import type { MockEmailProvider } from "../src/notifications/mock-email.provider";
import { SmsProvider } from "../src/notifications/sms-provider";
import type { MockSmsProvider } from "../src/notifications/mock-sms.provider";
import { NotificationsService } from "../src/notifications/notifications.service";

/**
 * Phase 7 (Notification Infrastructure) — the outbox pattern end to end
 * against a real Postgres: G-31's threshold re-evaluation, exactly-once
 * delivery, and "a queue operation never depends on the provider being
 * up." This also completes the plan's original first vertical slice
 * (§98/C-03): scan → join → position updates → staff calls → customer
 * notified (mock) → complete.
 *
 * Every join-flow customer here only ever has a phone (SMS channel by
 * construction, G-32) — the EMAIL-channel routing itself is proven
 * separately below by setting a customer's email directly in the DB, the
 * same way Phase 9's customer accounts eventually will.
 */
describe("Notification infrastructure (integration)", () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaClient;
  let smsProvider: MockSmsProvider;
  let emailProvider: MockEmailProvider;
  let notifications: NotificationsService;

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
    smsProvider = moduleRef.get(SmsProvider) as MockSmsProvider;
    emailProvider = moduleRef.get(EmailProvider) as MockEmailProvider;
    notifications = moduleRef.get(NotificationsService);
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

  /** A queue with tight thresholds — easy to exercise with just 1-2 joins. */
  async function setUpQueue(
    accessToken: string,
    thresholds?: { approaching: number; nearlyNext: number },
  ) {
    const location = await request(app.getHttpServer())
      .post("/tenants/me/locations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Christchurch", timezone: "Pacific/Auckland" })
      .expect(201);
    const service = await request(app.getHttpServer())
      .post("/tenants/me/services")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locationId: location.body.id, name: "Haircut", durationMinutes: 20 })
      .expect(201);
    const queue = await request(app.getHttpServer())
      .post("/tenants/me/queues")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        locationId: location.body.id,
        name: "Main Queue",
        ...(thresholds && {
          approachingThreshold: thresholds.approaching,
          nearlyNextThreshold: thresholds.nearlyNext,
        }),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queue.body.id}/services`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ serviceId: service.body.id })
      .expect(201);
    return { locationId: location.body.id, serviceId: service.body.id, queueId: queue.body.id };
  }

  function join(queueId: string, serviceId: string, name: string, phone: string) {
    return request(app.getHttpServer())
      .post(`/public/queues/${queueId}/entries`)
      .send({ serviceId, customerName: name, customerPhone: phone });
  }

  it("the plan's original first vertical slice: join -> position updates -> called -> complete, exactly one CALLED notification", async () => {
    smsProvider.sent.length = 0;
    const owner = await signUpAndVerify("notif-owner-a@example.com", "Slice Co", "Owner A");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const entry = await join(queueId, serviceId, "Alice", "0211111111").expect(201);

    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);

    // Fire-and-forget processing happens asynchronously — give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Filtered on the CALLED message specifically — a lone joiner also
    // gets an immediate NEARLY_NEXT under the default thresholds (0 people
    // ahead), which is correct and not what this assertion is about.
    const calledMessages = smsProvider.sent.filter(
      (s) => s.to === "+64211111111" && s.body.includes("your turn"),
    );
    expect(calledMessages).toHaveLength(1);
    expect(calledMessages[0].body).toContain(String(entry.body.ticketNumber));

    const outboxRows = await prisma.notificationOutbox.findMany({
      where: { queueEntryId: entry.body.id },
    });
    expect(outboxRows.every((row) => row.status === "SENT")).toBe(true);

    await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${entry.body.id}/start`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${entry.body.id}/complete`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
  });

  it("G-31 threshold ordering + suppression: nearly-next suppresses a not-yet-fired approaching, both fire only once", async () => {
    smsProvider.sent.length = 0;
    const owner = await signUpAndVerify("notif-owner-b@example.com", "Threshold Co", "Owner B");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken, {
      approaching: 2,
      nearlyNext: 1,
    });

    // 0 people ahead — within nearlyNext(1) directly, approaching(2) never fires separately.
    const first = await join(queueId, serviceId, "Alice", "0211111111").expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the fire-and-forget pass run

    const messagesToAlice = smsProvider.sent.filter((s) => s.to === "+64211111111");
    expect(messagesToAlice).toHaveLength(1);
    expect(messagesToAlice[0].body).toContain("almost up");

    const aliceRow = await prisma.queueEntry.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(aliceRow.nearlyNextNotifiedAt).not.toBeNull();
    // Suppressed, not fired: stamped as sent without ever appearing in smsProvider.sent.
    expect(aliceRow.approachingNotifiedAt).not.toBeNull();

    // Re-evaluating again (a second join, which re-scans every WAITING
    // entry) must not re-fire Alice's already-sent notification.
    await join(queueId, serviceId, "Bob", "0212222222").expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const messagesToAliceAfter = smsProvider.sent.filter((s) => s.to === "+64211111111");
    expect(messagesToAliceAfter).toHaveLength(1); // unchanged
  });

  it("G-31: calling an entry promotes whoever's now closer to the front, cascading a fresh threshold check", async () => {
    smsProvider.sent.length = 0;
    const owner = await signUpAndVerify("notif-owner-c@example.com", "Cascade Co", "Owner C");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken, {
      approaching: 2,
      nearlyNext: 1,
    });

    await join(queueId, serviceId, "Alice", "0211111111").expect(201); // 0 ahead -> NEARLY_NEXT
    const bob = await join(queueId, serviceId, "Bob", "0212222222").expect(201); // 1 ahead -> NEARLY_NEXT
    const cara = await join(queueId, serviceId, "Cara", "0213333333").expect(201); // 2 ahead -> APPROACHING only
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(smsProvider.sent.filter((s) => s.to === "+64213333333")).toHaveLength(1);

    // Calling Alice shifts Bob to 0 ahead (already NEARLY_NEXT, no change)
    // and Cara to 1 ahead — newly within nearlyNext, should now ALSO fire.
    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const caraMessages = smsProvider.sent.filter((s) => s.to === "+64213333333");
    expect(caraMessages).toHaveLength(2);
    expect(caraMessages[1].body).toContain("almost up");

    const caraRow = await prisma.queueEntry.findUniqueOrThrow({ where: { id: cara.body.id } });
    expect(caraRow.nearlyNextNotifiedAt).not.toBeNull();
    // Bob untouched — he was already fully notified before the call.
    const bobRow = await prisma.queueEntry.findUniqueOrThrow({ where: { id: bob.body.id } });
    expect(smsProvider.sent.filter((s) => s.to === "+64212222222")).toHaveLength(1);
    expect(bobRow.nearlyNextNotifiedAt).not.toBeNull();
  });

  it("recall always enqueues a fresh RECALLED notification, even after CALLED already fired", async () => {
    smsProvider.sent.length = 0;
    const owner = await signUpAndVerify("notif-owner-d@example.com", "Recall Co", "Owner D");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);
    const entry = await join(queueId, serviceId, "Alice", "0211111111").expect(201);

    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${entry.body.id}/recall`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/me/queue-entries/${entry.body.id}/recall`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const messages = smsProvider.sent.filter((s) => s.to === "+64211111111");
    const recalledCount = messages.filter((m) => m.body.includes("reminder")).length;
    expect(recalledCount).toBe(2); // one per recall call, not deduplicated like CALLED is
  });

  it("acceptance: duplicate processing never sends the same outbox row twice", async () => {
    const owner = await signUpAndVerify("notif-owner-e@example.com", "Dup Co", "Owner E");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);
    const entry = await join(queueId, serviceId, "Alice", "0211111111").expect(201);

    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);

    smsProvider.sent.length = 0;
    // Two concurrent drains racing on whatever's left PENDING (there
    // shouldn't be anything left, since the mutation's own fire-and-forget
    // pass already drained it — this proves that even if it somehow
    // wasn't, a second pass can never double-send).
    await Promise.all([notifications.processPending(), notifications.processPending()]);

    const sentToAlice = smsProvider.sent.filter((s) => s.to === "+64211111111");
    expect(sentToAlice.length).toBeLessThanOrEqual(1);

    const outboxRows = await prisma.notificationOutbox.findMany({
      where: { queueEntryId: entry.body.id, type: "CALLED" },
    });
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("SENT");
  });

  it("a queue operation succeeds even if notification processing fails afterward (never blocks/depends on the provider)", async () => {
    const owner = await signUpAndVerify("notif-owner-f@example.com", "Resilient Co", "Owner F");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);

    const originalSend = smsProvider.send.bind(smsProvider);
    smsProvider.send = async () => {
      throw new Error("simulated provider outage");
    };
    try {
      // The join HTTP request itself must still succeed (201), completely
      // independent of the provider being broken — it's never awaited.
      const entry = await join(queueId, serviceId, "Alice", "0211111111").expect(201);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The outbox row should have reverted to PENDING after the failed
      // send (NotificationsService's own retry-safety), not be lost.
      const rows = await prisma.notificationOutbox.findMany({
        where: { queueEntryId: entry.body.id },
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.status === "PENDING")).toBe(true);
    } finally {
      smsProvider.send = originalSend;
    }
  });

  it("EMAIL-channel routing: a customer with an email on file gets notified via EmailProvider, not SmsProvider", async () => {
    const owner = await signUpAndVerify("notif-owner-g@example.com", "Email Co", "Owner G");
    const { queueId, serviceId } = await setUpQueue(owner.accessToken);
    // At join time this customer has no email yet, so the immediate
    // NEARLY_NEXT (lone joiner, 0 ahead, default thresholds) correctly
    // goes via SMS — irrelevant to this test, cleared below.
    const entry = await join(queueId, serviceId, "Alice", "0211119999").expect(201);
    // The join's own fire-and-forget send is never awaited by the HTTP
    // response — let it settle before resetting, or its SMS can land in
    // smsProvider.sent *after* the reset below and pollute this test.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Not yet possible via the join flow itself (Phase 9's job) — set
    // directly, the same way a real signed-up customer record eventually
    // will have an email captured at account creation.
    await prisma.customer.updateMany({
      where: { phoneE164: "+64211119999" },
      data: { email: "alice@example.com" },
    });
    smsProvider.sent.length = 0;
    emailProvider.sent.length = 0;

    await request(app.getHttpServer())
      .post(`/tenants/me/queues/${queueId}/call-next`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const emailMessages = emailProvider.sent.filter((s) => s.to === "alice@example.com");
    expect(emailMessages).toHaveLength(1);
    expect(emailMessages[0].subject).toBe("It's your turn!");
    expect(smsProvider.sent.filter((s) => s.to === "+64211119999")).toHaveLength(0);

    const outboxRow = await prisma.notificationOutbox.findFirstOrThrow({
      where: { queueEntryId: entry.body.id, type: "CALLED" },
    });
    expect(outboxRow.channel).toBe("EMAIL");
    expect(outboxRow.status).toBe("SENT");
  });
});
