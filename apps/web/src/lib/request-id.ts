/**
 * A random ID for one join/booking attempt, so a retried request isn't
 * counted twice (G-21). `crypto.randomUUID()` exists only on secure pages
 * (https or localhost) — on a phone testing over http://<mac-ip> it's
 * missing and the page crashed (Phase 20). `getRandomValues` exists
 * everywhere, so build the same RFC 4122 version-4 UUID from it.
 */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
