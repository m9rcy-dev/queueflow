import { afterEach, describe, expect, it, vi } from "vitest";
import { newRequestId } from "./request-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newRequestId (Phase 20)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID where the browser has it", () => {
    expect(newRequestId()).toMatch(UUID_V4);
  });

  it("still works on an insecure (http) page, where randomUUID is missing", () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    const first = newRequestId();
    expect(first).toMatch(UUID_V4);
    expect(newRequestId()).not.toBe(first);
  });
});
