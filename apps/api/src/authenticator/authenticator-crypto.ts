import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for authenticator secrets (ADR-014) — AES-256-GCM,
 * stored as `v1.<iv>.<authTag>.<ciphertext>` (base64url parts). GCM's auth
 * tag means a tampered or wrong-key value fails loudly instead of
 * decrypting to garbage. The `v1` prefix leaves room for key rotation.
 */
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognized encrypted secret format");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * The 32-byte key from `AUTHENTICATOR_ENCRYPTION_KEY` (base64). Required in
 * production — boot fails without it rather than silently storing secrets
 * under a known key. Outside production a fixed development key is
 * derived so local dev and tests work with no setup; that key is public
 * (it's in this file) and must never protect real secrets.
 */
export function loadEncryptionKey(
  configured: string | undefined,
  nodeEnv: string | undefined,
): Buffer {
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) {
      throw new Error("AUTHENTICATOR_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    }
    return key;
  }
  if (nodeEnv === "production") {
    throw new Error("AUTHENTICATOR_ENCRYPTION_KEY is required in production.");
  }
  return createHash("sha256").update("queueflow-development-only-authenticator-key").digest();
}
