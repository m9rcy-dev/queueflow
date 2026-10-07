import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  const prisma = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();
    controller = module.get(HealthController);
  });

  it("reports ok with a timestamp when the database answers", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(new Date(result.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("answers 503 when the database doesn't (Phase 20) — a deploy that can't reach it never goes live", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
