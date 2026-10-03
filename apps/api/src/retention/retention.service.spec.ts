import { Test } from "@nestjs/testing";
import { RetentionService } from "./retention.service";
import { PrismaService } from "../prisma/prisma.service";

describe("RetentionService", () => {
  let service: RetentionService;
  let prisma: { $queryRaw: jest.Mock; customer: { update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      customer: { update: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [RetentionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RetentionService);
  });

  it("anonymizes every customer the stale-candidate query returns", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: "cust-1" }, { id: "cust-2" }]);

    const result = await service.purgeStalePii();

    expect(prisma.customer.update).toHaveBeenCalledTimes(2);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { firstName: null, email: null, phoneE164: "anon-cust-1" },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-2" },
      data: { firstName: null, email: null, phoneE164: "anon-cust-2" },
    });
    expect(result.anonymizedCustomerIds).toEqual(["cust-1", "cust-2"]);
  });

  it("does nothing when no stale candidates are found", async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await service.purgeStalePii();

    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(result.anonymizedCustomerIds).toEqual([]);
  });

  it("passes a cutoff roughly 90 days in the past to the query", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const before = Date.now();

    await service.purgeStalePii();

    // $queryRaw is a tagged-template call — Jest records the call as
    // (templateStringsArray, ...values); the cutoff Date is the one
    // interpolated value.
    const call = prisma.$queryRaw.mock.calls[0];
    const cutoff: Date = call[1];
    const daysAgo = (before - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(89.9);
    expect(daysAgo).toBeLessThan(90.1);
  });
});
