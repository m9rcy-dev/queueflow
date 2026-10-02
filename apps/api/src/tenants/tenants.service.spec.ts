import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TenantsService } from "./tenants.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";

describe("TenantsService", () => {
  let service: TenantsService;
  let prisma: {
    tenant: Record<string, jest.Mock>;
    tenantUser: Record<string, jest.Mock>;
  };

  const tenantId = "tenant-1";

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      tenantUser: { findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: { sendInviteLink: jest.fn() } },
      ],
    }).compile();

    service = module.get(TenantsService);
  });

  describe("listMembers (Phase 11 — the staff roster)", () => {
    it("404s for a nonexistent tenant", async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.listMembers(tenantId)).rejects.toThrow(NotFoundException);
    });

    it("maps memberships to the roster shape, oldest first", async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
      prisma.tenantUser.findMany.mockResolvedValue([
        {
          id: "tu-1",
          role: "TENANT_OWNER",
          user: { displayName: "Joe Owner", email: "joe@example.com" },
        },
        {
          id: "tu-2",
          role: "STAFF",
          user: { displayName: "Ana Staff", email: "ana@example.com" },
        },
      ]);

      const result = await service.listMembers(tenantId);

      expect(prisma.tenantUser.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        include: { user: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual([
        {
          tenantUserId: "tu-1",
          displayName: "Joe Owner",
          email: "joe@example.com",
          role: "TENANT_OWNER",
        },
        { tenantUserId: "tu-2", displayName: "Ana Staff", email: "ana@example.com", role: "STAFF" },
      ]);
    });
  });
});
