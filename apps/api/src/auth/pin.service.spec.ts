import { PinService } from "./pin.service";

describe("PinService", () => {
  const service = new PinService();

  it("hashes a PIN and verifies the same PIN against it", async () => {
    const hash = await service.hash("4242");
    expect(hash).not.toBe("4242");
    await expect(service.verify(hash, "4242")).resolves.toBe(true);
  });

  it("rejects a wrong PIN against the hash", async () => {
    const hash = await service.hash("4242");
    await expect(service.verify(hash, "0000")).resolves.toBe(false);
  });

  it("produces a different hash for the same PIN on repeated calls (random salt)", async () => {
    const first = await service.hash("4242");
    const second = await service.hash("4242");
    expect(first).not.toBe(second);
  });
});
