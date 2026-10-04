import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueuesService } from "../queues/queues.service";

describe("CodesService", () => {
  let service: CodesService;
  let prisma: { code: Record<string, jest.Mock> };
  let queuesService: { findOwnedQueue: jest.Mock };

  const tenantId = "tenant-1";
  const codeRow = {
    id: "code-1",
    publicCode: "ABCD2345",
    contextType: "QUEUE" as const,
    queueId: "queue-1",
    active: true,
  };

  beforeEach(async () => {
    prisma = {
      code: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    queuesService = { findOwnedQueue: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueuesService, useValue: queuesService },
      ],
    }).compile();

    service = module.get(CodesService);
  });

  describe("createForQueue", () => {
    it("404s for a queue belonging to another tenant", async () => {
      queuesService.findOwnedQueue.mockRejectedValue(new NotFoundException());
      await expect(service.createForQueue(tenantId, "queue-1")).rejects.toThrow(NotFoundException);
      expect(prisma.code.create).not.toHaveBeenCalled();
    });

    it("creates a QUEUE-context code scoped to the given queue", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.create.mockResolvedValue(codeRow);

      const result = await service.createForQueue(tenantId, "queue-1");

      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId, queueId: "queue-1", contextType: "QUEUE" }),
      });
      expect(result.publicCode).toBe("ABCD2345");
    });

    it("creates a DISPLAY-context code when asked (Phase 6, G-07)", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.create.mockResolvedValue({ ...codeRow, contextType: "DISPLAY" });

      const result = await service.createForQueue(tenantId, "queue-1", "DISPLAY");

      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contextType: "DISPLAY" }),
      });
      expect(result.contextType).toBe("DISPLAY");
    });
  });

  describe("deactivate (G-07 rotation)", () => {
    it("404s if the code doesn't belong to this tenant/queue", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deactivate(tenantId, "queue-1", "code-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("deactivates a code owned by this tenant/queue", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.updateMany.mockResolvedValue({ count: 1 });
      await service.deactivate(tenantId, "queue-1", "code-1");
      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { id: "code-1", tenantId, queueId: "queue-1" },
        data: { active: false },
      });
    });
  });

  describe("createGeneral (Phase 9, D-10)", () => {
    it("mints a GENERAL-context code with no queueId, no queue ownership check needed", async () => {
      prisma.code.create.mockResolvedValue({ ...codeRow, contextType: "GENERAL", queueId: null });
      const result = await service.createGeneral(tenantId);
      expect(queuesService.findOwnedQueue).not.toHaveBeenCalled();
      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId, contextType: "GENERAL" }),
      });
      expect(result.contextType).toBe("GENERAL");
    });
  });

  describe("regenerateGeneral (Phase 11)", () => {
    it("deactivates every active GENERAL code first, then mints a fresh one (never reuses the old publicCode)", async () => {
      prisma.code.updateMany.mockResolvedValue({ count: 1 });
      prisma.code.create.mockResolvedValue({
        ...codeRow,
        publicCode: "NEWPOSTER",
        contextType: "GENERAL",
        queueId: null,
      });

      const result = await service.regenerateGeneral(tenantId);

      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { tenantId, contextType: "GENERAL", active: true },
        data: { active: false },
      });
      expect(result.publicCode).toBe("NEWPOSTER");
    });
  });

  describe("createGuestCard (Phase 10, D-14)", () => {
    it("mints a GUEST_CARD-context code at a specific location + printed number", async () => {
      prisma.code.create.mockResolvedValue({
        ...codeRow,
        contextType: "GUEST_CARD",
        queueId: null,
        locationId: "loc-1",
        guestNumber: 3,
      });

      const result = await service.createGuestCard(tenantId, "loc-1", 3);

      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          locationId: "loc-1",
          guestNumber: 3,
          contextType: "GUEST_CARD",
        }),
      });
      expect(result.contextType).toBe("GUEST_CARD");
    });
  });

  describe("deactivateGeneral", () => {
    it("404s if the code doesn't belong to this tenant / isn't GENERAL", async () => {
      prisma.code.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deactivateGeneral(tenantId, "code-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("deactivates a GENERAL code owned by this tenant", async () => {
      prisma.code.updateMany.mockResolvedValue({ count: 1 });
      await service.deactivateGeneral(tenantId, "code-1");
      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { id: "code-1", tenantId, contextType: "GENERAL" },
        data: { active: false },
      });
    });
  });

  describe("createForCustomer (Phase 9, G-52)", () => {
    it("reuses an existing active identity code rather than minting a duplicate", async () => {
      const existing = {
        ...codeRow,
        contextType: "CUSTOMER_IDENTITY",
        queueId: null,
        customerId: "cust-1",
      };
      prisma.code.findFirst.mockResolvedValue(existing);

      const result = await service.createForCustomer(tenantId, "cust-1");

      expect(prisma.code.create).not.toHaveBeenCalled();
      expect(result.publicCode).toBe(existing.publicCode);
    });

    it("mints a fresh CUSTOMER_IDENTITY code when none is active yet", async () => {
      prisma.code.findFirst.mockResolvedValue(null);
      prisma.code.create.mockResolvedValue({
        ...codeRow,
        contextType: "CUSTOMER_IDENTITY",
        queueId: null,
        customerId: "cust-1",
      });

      const result = await service.createForCustomer(tenantId, "cust-1");

      expect(prisma.code.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          customerId: "cust-1",
          contextType: "CUSTOMER_IDENTITY",
        }),
      });
      expect(result.contextType).toBe("CUSTOMER_IDENTITY");
    });
  });

  describe("regenerateForCustomer", () => {
    it("deactivates whatever's active first, then mints a new code (never reuses the old publicCode)", async () => {
      prisma.code.updateMany.mockResolvedValue({ count: 1 });
      prisma.code.create.mockResolvedValue({
        ...codeRow,
        publicCode: "NEWCODE1",
        contextType: "CUSTOMER_IDENTITY",
        queueId: null,
        customerId: "cust-1",
      });

      const result = await service.regenerateForCustomer(tenantId, "cust-1");

      expect(prisma.code.updateMany).toHaveBeenCalledWith({
        where: { tenantId, customerId: "cust-1", contextType: "CUSTOMER_IDENTITY", active: true },
        data: { active: false },
      });
      expect(result.publicCode).toBe("NEWCODE1");
    });
  });

  describe("token entropy by context type (Phase 12, G-39 audit)", () => {
    const SHORT_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/; // generateShortPublicCode's alphabet/length
    const SECRET_TOKEN_MIN_LENGTH = 25; // generateSecurePublicToken: 20 raw bytes, base64url-encoded

    function mintedPublicCode(): string {
      const call = prisma.code.create.mock.calls.at(-1);
      return call?.[0]?.data?.publicCode;
    }

    it("QUEUE/DISPLAY/GENERAL get the short, printed, not-secret alphabet", async () => {
      queuesService.findOwnedQueue.mockResolvedValue({ id: "queue-1" });
      prisma.code.create.mockResolvedValue(codeRow);

      await service.createForQueue(tenantId, "queue-1", "QUEUE");
      expect(mintedPublicCode()).toMatch(SHORT_CODE_PATTERN);

      await service.createForQueue(tenantId, "queue-1", "DISPLAY");
      expect(mintedPublicCode()).toMatch(SHORT_CODE_PATTERN);

      await service.createGeneral(tenantId);
      expect(mintedPublicCode()).toMatch(SHORT_CODE_PATTERN);
    });

    it("CUSTOMER_IDENTITY and GUEST_CARD get a long, high-entropy token instead — a real capability when scanned, not just a context pointer", async () => {
      prisma.code.findFirst.mockResolvedValue(null); // createForCustomer's idempotent-reuse check
      prisma.code.create.mockResolvedValue(codeRow);

      await service.createForCustomer(tenantId, "cust-1");
      const identityCode = mintedPublicCode();
      expect(identityCode.length).toBeGreaterThanOrEqual(SECRET_TOKEN_MIN_LENGTH);
      expect(identityCode).not.toMatch(SHORT_CODE_PATTERN);

      await service.createGuestCard(tenantId, "loc-1", 1);
      const guestCode = mintedPublicCode();
      expect(guestCode.length).toBeGreaterThanOrEqual(SECRET_TOKEN_MIN_LENGTH);
      expect(guestCode).not.toMatch(SHORT_CODE_PATTERN);
    });
  });

  describe("resolve", () => {
    it("404s for an unknown code", async () => {
      prisma.code.findUnique.mockResolvedValue(null);
      await expect(service.resolve("NOTREAL1")).rejects.toThrow(NotFoundException);
    });

    it("404s for a deactivated code (never distinguishes this from 'unknown')", async () => {
      prisma.code.findUnique.mockResolvedValue({ ...codeRow, active: false });
      await expect(service.resolve("ABCD2345")).rejects.toThrow(NotFoundException);
    });

    it("404s for a CUSTOMER_IDENTITY code — only the staff-authenticated scan endpoint understands it (Phase 10)", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        contextType: "CUSTOMER_IDENTITY",
        queueId: null,
        customerId: "cust-1",
      });
      await expect(service.resolve("ABCD2345")).rejects.toThrow(NotFoundException);
    });

    it("404s for a GUEST_CARD code — same, staff-scan-only (Phase 10)", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        contextType: "GUEST_CARD",
        queueId: null,
        locationId: "loc-1",
        guestNumber: 3,
      });
      await expect(service.resolve("ABCD2345")).rejects.toThrow(NotFoundException);
    });

    it("resolves a GENERAL code to just the tenant (Phase 9, D-10)", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        contextType: "GENERAL",
        queueId: null,
        tenant: { id: "tenant-1", name: "Joe's Barbers" },
      });

      const result = await service.resolve("ABCD2345");

      expect(result).toEqual({
        contextType: "GENERAL",
        tenant: { id: "tenant-1", name: "Joe's Barbers", logoPath: null },
        capabilities: ["CREATE_ACCOUNT"],
      });
    });

    it("404s for a DISPLAY code — this endpoint only ever resolves QUEUE codes", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        contextType: "DISPLAY",
        queue: { id: "queue-1" },
      });
      await expect(service.resolve("ABCD2345")).rejects.toThrow(NotFoundException);
    });

    it("returns only the minimal customer-facing landing info — never admin data", async () => {
      prisma.code.findUnique.mockResolvedValue({
        ...codeRow,
        queue: {
          id: "queue-1",
          name: "Main Queue",
          status: "ACTIVE",
          locationId: "loc-1",
          location: { id: "loc-1", name: "Christchurch" },
          tenant: { name: "Joe's Barbers", appointmentEnabled: false },
          queueServices: [
            {
              service: {
                id: "svc-1",
                name: "Haircut",
                durationMinutes: 20,
                active: true,
                queueEnabled: true,
              },
            },
            {
              service: {
                id: "svc-2",
                name: "Retired Service",
                durationMinutes: 10,
                active: false,
                queueEnabled: true,
              },
            },
          ],
        },
      });

      const result = await service.resolve("ABCD2345");

      expect(result).toEqual({
        contextType: "QUEUE",
        tenant: { name: "Joe's Barbers", logoPath: null },
        location: { id: "loc-1", name: "Christchurch" },
        queue: { id: "queue-1", name: "Main Queue", status: "ACTIVE" },
        capabilities: ["JOIN_QUEUE"],
        // The inactive service is filtered out — never offered to a customer.
        services: [{ id: "svc-1", name: "Haircut", durationMinutes: 20 }],
        // Appointment capability off for this tenant — nothing bookable offered (Phase 13).
        appointmentServices: [],
      });
    });
  });
});
