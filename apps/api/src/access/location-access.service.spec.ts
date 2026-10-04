import { NotFoundException } from "@nestjs/common";
import { LocationAccessService } from "./location-access.service";

describe("LocationAccessService (ADR-015)", () => {
  const prisma = { queue: { findFirst: jest.fn() } };
  const access = new LocationAccessService(prisma as never);
  const owner = { tenantId: "t1", role: "TENANT_OWNER" as const, locationId: null };
  const staffA = { tenantId: "t1", role: "STAFF" as const, locationId: "loc-a" };
  const unassigned = { tenantId: "t1", role: "MANAGER" as const, locationId: null };

  beforeEach(() => prisma.queue.findFirst.mockReset());

  it("never restricts owners/admins, and doesn't even query for them", async () => {
    expect(() => access.assertLocation(owner, "loc-b")).not.toThrow();
    await access.assertQueue(owner, "q1");
    expect(prisma.queue.findFirst).not.toHaveBeenCalled();
    expect(access.listLocation(owner, "loc-b")).toBe("loc-b");
    expect(access.listLocation(owner)).toBeUndefined();
  });

  it("refuses another location with that resource's own not-found response", async () => {
    expect(() => access.assertLocation(staffA, "loc-a")).not.toThrow();
    prisma.queue.findFirst.mockResolvedValue({ locationId: "loc-b" });
    await expect(access.assertQueue(staffA, "q1")).rejects.toMatchObject({
      response: { code: "QUEUE_NOT_FOUND", message: "Queue not found." },
    });
    expect(() => access.assertLocation(staffA, "loc-b")).toThrow(NotFoundException);
  });

  it("narrows lists to the user's own location; asking for another matches nothing", () => {
    expect(access.listLocation(staffA)).toBe("loc-a");
    expect(access.listLocation(staffA, "loc-a")).toBe("loc-a");
    const other = access.listLocation(staffA, "loc-b");
    expect(other).not.toBe("loc-b");
    expect(other).not.toBe("loc-a");
  });

  it("gives a bound role with no location nothing at all", () => {
    expect(() => access.assertLocation(unassigned, "loc-a")).toThrow(NotFoundException);
    expect(access.locationFilter(unassigned)).toBeDefined();
    expect(access.locationFilter(unassigned)).not.toBe("loc-a");
  });

  it("leaves a missing resource to the service's own 404", async () => {
    prisma.queue.findFirst.mockResolvedValue(null);
    await expect(access.assertQueue(staffA, "missing")).resolves.toBeUndefined();
  });
});
