import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "./authenticator-crypto";

describe("authenticator secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips, with a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const b = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("fails loudly with the wrong key or a tampered value", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("requires a configured 32-byte key in production", () => {
    expect(() => loadEncryptionKey(undefined, "production")).toThrow(/required in production/);
    expect(() => loadEncryptionKey(Buffer.alloc(16).toString("base64"), "production")).toThrow(
      /32 bytes/,
    );
    const configured = randomBytes(32);
    expect(loadEncryptionKey(configured.toString("base64"), "production")).toEqual(configured);
  });

  it("falls back to a fixed development key outside production", () => {
    expect(loadEncryptionKey(undefined, "development")).toHaveLength(32);
  });
});
